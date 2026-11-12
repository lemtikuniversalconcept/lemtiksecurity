import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getActiveOrgId } from "@/lib/orgs.server";
import { throwSafeError } from "@/lib/server-errors";

// Custody exceptions report: every consignment active in a period and everything that went
// wrong in its chain of custody: exceptions recorded, seal mismatches, records made away from
// the checkpoint, gaps longer than allowed, checkpoints never recorded, records entered long
// after the device time, and whether the fingerprinted chain is still intact. Counted from the
// custody records themselves.

const DAY = 86_400_000;
const LATE_ENTRY_MIN = 30;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export type ExceptionKind = "exception" | "seal" | "off_checkpoint" | "gap" | "missed_checkpoint" | "late_entry" | "chain";
export const EXCEPTION_LABEL: Record<ExceptionKind, string> = {
  exception: "Exception recorded",
  seal: "Seal mismatch",
  off_checkpoint: "Recorded away from the checkpoint",
  gap: "No record for longer than allowed",
  missed_checkpoint: "Checkpoint never recorded",
  late_entry: "Entered long after it happened",
  chain: "Custody chain broken",
};
export type CustodyException = { consignment_id: string; reference: string; kind: ExceptionKind; at: string | null; detail: string; by: string | null; via: string | null; seq: number | null; party: string | null };
export type CustodyRow = { id: string; reference: string; description: string; carrier: string | null; consignee: string | null; route: string; status: string; created_at: string; delivered_at: string | null; records: number; chain_intact: boolean; exceptions: number; kinds: ExceptionKind[] };
export type CustodyReport = {
  org: string;
  from: string;
  to: string;
  generated_at: string;
  consignments: CustodyRow[];
  exceptions: CustodyException[];
  by_kind: { kind: ExceptionKind; count: number; consignments: number }[];
  by_carrier: { carrier: string; consignments: number; with_exceptions: number; exceptions: number }[];
  by_party: { party: string; handovers: number; seal_issues: number; exceptions: number }[];
  summary: { consignments: number; delivered: number; with_exceptions: number; exceptions: number; broken_chains: number; median_hours_to_deliver: number | null };
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10;
};
const startOf = (d: string) => Date.parse(`${d}T00:00:00+01:00`);

export const getCustodyReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ from: day, to: day }).parse(d))
  .handler(async ({ data, context }): Promise<CustodyReport> => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    await (await import("./features.server")).assertFeature(orgId, "cargo");
    const { admin, roleIn } = await import("./links.server");
    const db = await admin();
    const role = await roleIn(db, context.userId, orgId);
    if (!role || !["manager", "supervisor", "client_admin"].includes(role)) throwSafeError("custody.report", new Error("role"), "Only managers, operators and client admins can produce the custody report.");
    const a = startOf(data.from), b = Math.min(startOf(data.to) + DAY, Date.now());
    if (!(a < b)) throwSafeError("custody.report", new Error("range"), "Choose a start date before the end date, and not in the future.");
    if (b - a > 3 * 366 * DAY) throwSafeError("custody.report", new Error("range"), "Choose a period of three years or less.");
    const A = new Date(a).toISOString(), B = new Date(b).toISOString();

    // Consignments created in the period, or with any custody record in it.
    const { fetchAll } = await import("./fetch-all.server");
    const [{ data: org }, made, touched] = await Promise.all([
      db.from("organisations").select("name").eq("id", orgId).maybeSingle(),
      fetchAll(() => db.from("cargo_consignments").select("id").eq("organisation_id", orgId).neq("status", "cancelled").gte("created_at", A).lt("created_at", B).order("id")),
      fetchAll(() => db.from("cargo_custody_events").select("consignment_id").eq("organisation_id", orgId).gte("recorded_at", A).lt("recorded_at", B).order("id")),
    ]);
    const ids = [...new Set([...(made as any[]).map((x) => x.id), ...(touched as any[]).map((x) => x.consignment_id)])];
    if (ids.length > 2000) throwSafeError("custody.report", new Error("too many"), "More than 2,000 consignments in that period. Choose a shorter one.");
    const chunks = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
    const cons: any[] = [], evs: any[] = [];
    for (const part of chunks(ids, 200)) {
      const [{ data: c, error }, e] = await Promise.all([
        db.from("cargo_consignments").select("id, reference, description, carrier, consignee, origin, destination, checkpoints, max_gap_hours, status, created_at, delivered_at").in("id", part).neq("status", "cancelled"),
        fetchAll(() => db.from("cargo_custody_events").select("*").in("consignment_id", part).order("consignment_id").order("seq", { ascending: true })),
      ]);
      if (error) throwSafeError("custody.report", error, "Unable to build the custody report.");
      cons.push(...(c ?? []));
      evs.push(...e);
    }
    const { verifyChain } = await import("./cargo.server");

    const exceptions: CustodyException[] = [];
    const rows: CustodyRow[] = cons.map((c) => {
      const ev = evs.filter((e) => e.consignment_id === c.id).sort((x, y) => x.seq - y.seq);
      const add = (x: Omit<CustodyException, "consignment_id" | "reference">) => exceptions.push({ consignment_id: c.id, reference: c.reference, ...x });
      const party = (e: any) => [e.from_party, e.to_party].filter(Boolean).join(" → ") || null;
      for (const e of ev) {
        if (e.kind === "exception") add({ kind: "exception", at: e.recorded_at, detail: e.note || "Exception recorded", by: e.recorded_by_name, via: e.recorded_via, seq: e.seq, party: party(e) });
        if (e.seals_ok === false) add({ kind: "seal", at: e.recorded_at, detail: e.seal_issue || "Seals didn't match the record", by: e.recorded_by_name, via: e.recorded_via, seq: e.seq, party: party(e) });
        if (e.off_checkpoint_m != null) {
          const cp = (Array.isArray(c.checkpoints) ? c.checkpoints : [])[e.checkpoint_index];
          add({ kind: "off_checkpoint", at: e.recorded_at, detail: `${(e.off_checkpoint_m / 1000).toFixed(e.off_checkpoint_m < 10_000 ? 1 : 0)} km from ${cp?.name ?? "the checkpoint"}`, by: e.recorded_by_name, via: e.recorded_via, seq: e.seq, party: null });
        }
        if (e.device_at && Date.parse(e.recorded_at) - Date.parse(e.device_at) > LATE_ENTRY_MIN * 60_000) {
          const m = Math.round((Date.parse(e.recorded_at) - Date.parse(e.device_at)) / 60_000);
          add({ kind: "late_entry", at: e.recorded_at, detail: `Saved ${m < 120 ? `${m} min` : `${Math.round(m / 60)} h`} after the time on the device`, by: e.recorded_by_name, via: e.recorded_via, seq: e.seq, party: null });
        }
      }
      // Gaps while moving: from departure (or first record) until delivery or now.
      const moving = ev.filter((e) => e.kind !== "loaded" && e.kind !== "sealed");
      const end = c.delivered_at ? Date.parse(c.delivered_at) : c.status === "in_transit" ? Date.now() : null;
      const times = moving.map((e) => Date.parse(e.recorded_at));
      if (times.length && end != null) times.push(end);
      for (let i = 1; i < times.length; i++) {
        const h = (times[i] - times[i - 1]) / 3_600_000;
        if (h > c.max_gap_hours) add({ kind: "gap", at: new Date(times[i - 1]).toISOString(), detail: `${Math.round(h * 10) / 10} h with no record (limit ${c.max_gap_hours} h)${i === times.length - 1 && !c.delivered_at ? ", still open" : ""}`, by: null, via: null, seq: moving[i - 1]?.seq ?? null, party: null });
      }
      if (c.status === "delivered") {
        const done = new Set(ev.filter((e) => e.checkpoint_index != null).map((e) => e.checkpoint_index));
        (Array.isArray(c.checkpoints) ? c.checkpoints : []).forEach((cp: any, i: number) => {
          if (!done.has(i)) add({ kind: "missed_checkpoint", at: c.delivered_at, detail: `${cp.name} was never recorded`, by: null, via: null, seq: null, party: null });
        });
      }
      const chain = verifyChain(ev);
      if (!chain.intact) add({ kind: "chain", at: null, detail: chain.reason ?? "The chain doesn't verify", by: null, via: null, seq: chain.broken_at, party: null });
      const mine = exceptions.filter((x) => x.consignment_id === c.id);
      return {
        id: c.id, reference: c.reference, description: c.description, carrier: c.carrier, consignee: c.consignee,
        route: [c.origin, c.destination].filter(Boolean).join(" → "), status: c.status, created_at: c.created_at, delivered_at: c.delivered_at,
        records: ev.length, chain_intact: chain.intact, exceptions: mine.length, kinds: [...new Set(mine.map((x) => x.kind))],
      };
    }).sort((x, y) => y.exceptions - x.exceptions || y.created_at.localeCompare(x.created_at));

    const kinds = Object.keys(EXCEPTION_LABEL) as ExceptionKind[];
    const carriers = new Map<string, CustodyRow[]>();
    for (const r of rows) carriers.set(r.carrier || "Not named", [...(carriers.get(r.carrier || "Not named") ?? []), r]);
    const parties = new Map<string, { handovers: number; seal_issues: number; exceptions: number }>();
    for (const e of evs.filter((x) => x.kind === "handover" || x.kind === "exception" || x.seals_ok === false)) {
      for (const p of [e.from_party, e.to_party].filter(Boolean) as string[]) {
        const k = p.trim();
        const cur = parties.get(k) ?? { handovers: 0, seal_issues: 0, exceptions: 0 };
        if (e.kind === "handover") cur.handovers++;
        if (e.seals_ok === false) cur.seal_issues++;
        if (e.kind === "exception") cur.exceptions++;
        parties.set(k, cur);
      }
    }
    const deliverH = rows.filter((r) => r.delivered_at).map((r) => {
      const dep = evs.find((e) => e.consignment_id === r.id && e.kind === "departed");
      return (Date.parse(r.delivered_at!) - Date.parse(dep?.recorded_at ?? r.created_at)) / 3_600_000;
    });
    return {
      org: org?.name ?? "",
      from: data.from,
      to: data.to,
      generated_at: new Date().toISOString(),
      consignments: rows,
      exceptions: exceptions.sort((x, y) => (x.at ?? "").localeCompare(y.at ?? "")),
      by_kind: kinds.map((k) => ({ kind: k, count: exceptions.filter((x) => x.kind === k).length, consignments: new Set(exceptions.filter((x) => x.kind === k).map((x) => x.consignment_id)).size })).filter((x) => x.count),
      by_carrier: [...carriers.entries()].map(([carrier, rs]) => ({ carrier, consignments: rs.length, with_exceptions: rs.filter((r) => r.exceptions).length, exceptions: rs.reduce((n, r) => n + r.exceptions, 0) })).sort((x, y) => y.exceptions - x.exceptions || y.consignments - x.consignments),
      by_party: [...parties.entries()].map(([party, v]) => ({ party, ...v })).sort((x, y) => y.seal_issues + y.exceptions - (x.seal_issues + x.exceptions) || y.handovers - x.handovers).slice(0, 50),
      summary: {
        consignments: rows.length,
        delivered: rows.filter((r) => r.status === "delivered").length,
        with_exceptions: rows.filter((r) => r.exceptions).length,
        exceptions: exceptions.length,
        broken_chains: rows.filter((r) => !r.chain_intact).length,
        median_hours_to_deliver: median(deliverH),
      },
    };
  });
