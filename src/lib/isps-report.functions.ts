import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getActiveOrgId } from "@/lib/orgs.server";
import { throwSafeError } from "@/lib/server-errors";
import type { ComplianceFlag } from "./isps.rules";

// ISPS compliance report for one organisation over a period: each facility's security level
// history and time at each level, drills against the three-month rule, exercises, the plan
// approval, breaches with time to report and close, Declarations of Security, how fast staff
// acknowledged level changes, and notices from the authority. The facility can run it for
// itself; an authority can run it for an organisation that shares ISPS records with it, which
// is logged on that link. Every figure comes from the records; nothing is estimated.

const DAY = 86_400_000;
const DRILL_DAYS = 92;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export type IspsFacilityReport = {
  id: string;
  name: string;
  kind: string;
  identifier: string | null;
  pfso: string | null;
  pfso_phone: string | null;
  plan_approved_on: string | null;
  plan_expires_on: string | null;
  plan_lapsed_days: number;
  level_now: number;
  level_days: Record<1 | 2 | 3, number>;
  level_changes: { at: string; from: number; to: number; reason: string; by: string | null }[];
  drills: { held_on: string; kind: "drill" | "exercise"; scenario: string; participants: number | null; findings: string | null; corrective_actions: string | null; by: string | null }[];
  drill_overdue_days: number;
  longest_drill_gap_days: number | null;
  exercises_in_period: number;
  breaches: { occurred_at: string; category: string; description: string; level: number | null; reported_to_authority: boolean; reported_at: string | null; reported_to: string | null; hours_to_report: number | null; status: string; closed_at: string | null; days_to_close: number | null }[];
  declarations: { reference: string; ship_name: string; ship_imo: string | null; level: number; valid_from: string; valid_to: string; status: string; ship_signed_at: string | null }[];
  flags_now: ComplianceFlag[];
};
export type IspsReport = {
  org: { id: string; name: string };
  viewer_is_authority: boolean;
  from: string;
  to: string;
  generated_at: string;
  generated_by: string;
  facilities: IspsFacilityReport[];
  acks: { broadcasts: number; recipients: number; acknowledged: number; median_ack_min: number | null; within_30min: number };
  notices: { reference: string; title: string; from: string; issued_at: string; respond_by: string | null; first_read_at: string | null; acknowledged_at: string | null; acknowledged_by: string | null; on_time: boolean | null }[];
  summary: { facilities: number; failing_now: number; drills: number; exercises: number; breaches: number; unreported: number; declarations_signed: number; days_at_level_2_or_3: number };
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
};
/** Lagos day bounds (UTC+1) as instants: start of `from`, end of `to`. */
const startOf = (d: string) => Date.parse(`${d}T00:00:00+01:00`);
const endOf = (d: string) => Date.parse(`${d}T00:00:00+01:00`) + DAY;

/**
 * Days in [a, b) when the time since the last drill was over the three-month rule, and the
 * longest gap between drills (counting the open gap up to the end of the period). Before its
 * first drill a facility gets the same three months from the day it was registered.
 */
export function drillOverdue(drillDays: number[], registeredAt: number, a: number, b: number) {
  const pts = [...drillDays].sort((x, y) => x - y);
  let last = pts.filter((p) => p < a).pop() ?? registeredAt;
  let overdue = 0;
  let longest = 0;
  const span = (from: number, to: number) => {
    const lo = Math.max(from + DRILL_DAYS * DAY, a), hi = Math.min(to, b);
    if (hi > lo) overdue += (hi - lo) / DAY;
    longest = Math.max(longest, (Math.min(to, b) - from) / DAY);
  };
  for (const p of pts.filter((x) => x >= a && x < b)) {
    span(last, p);
    last = p;
  }
  span(last, b);
  return { overdue: Math.round(overdue), longest: Math.round(longest) };
}

export const getIspsReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ org_id: z.string().uuid().nullable(), from: day, to: day }).parse(d))
  .handler(async ({ data, context }): Promise<IspsReport> => {
    const myOrg = await getActiveOrgId(context.supabase, context.userId);
    const { admin, roleIn, myName, logEvent } = await import("./links.server");
    const db = await admin();
    const role = await roleIn(db, context.userId, myOrg);
    if (!role || !["manager", "supervisor", "client_admin"].includes(role)) throwSafeError("isps.report", new Error("role"), "Only managers, operators and client admins can produce the compliance report.");
    const orgId = data.org_id ?? myOrg;
    const a = startOf(data.from), b = Math.min(endOf(data.to), Date.now());
    if (!(a < b)) throwSafeError("isps.report", new Error("range"), "Choose a start date before the end date, and not in the future.");
    if (b - a > 3 * 366 * DAY) throwSafeError("isps.report", new Error("range"), "Choose a period of three years or less.");
    const name = await myName(db, context.userId);
    const viewerIsAuthority = orgId !== myOrg;
    if (viewerIsAuthority) {
      const { data: link } = await db.from("org_links").select("id, owner_org_id, partner_org_id, scopes").eq("owner_org_id", orgId).eq("partner_org_id", myOrg).eq("status", "active").gt("expires_at", new Date().toISOString()).contains("scopes", ["isps"]).maybeSingle();
      if (!link) throwSafeError("isps.report", new Error("link"), "That organisation doesn't share ISPS records with you.");
      await logEvent(db, link, { id: context.userId, name, org: myOrg }, "viewed", { area: "isps_report", from: data.from, to: data.to });
    } else {
      await (await import("./features.server")).assertFeature(orgId, "isps");
    }
    const A = new Date(a).toISOString(), B = new Date(b).toISOString();

    const [{ data: org }, { data: fac }, { data: changes }, { data: drills }, { data: br }, { data: dos }, { data: bc }, { data: nrec }] = await Promise.all([
      db.from("organisations").select("id, name").eq("id", orgId).maybeSingle(),
      db.from("isps_facilities").select("id, name, kind, identifier, security_level, level_set_at, security_officer_name, security_officer_phone, plan_approved_on, plan_expires_on, created_at").eq("organisation_id", orgId).order("name"),
      db.from("isps_level_changes").select("facility_id, from_level, to_level, reason, changed_by_name, created_at").eq("organisation_id", orgId).lt("created_at", B).order("created_at", { ascending: true }).limit(5000),
      db.from("isps_drills").select("facility_id, kind, scenario, held_on, participants, findings, corrective_actions, recorded_by_name").eq("organisation_id", orgId).order("held_on", { ascending: true }).limit(5000),
      db.from("isps_breaches").select("facility_id, occurred_at, category, description, security_level, reported_to_authority, reported_at, reported_to, status, closed_at").eq("organisation_id", orgId).gte("occurred_at", A).lt("occurred_at", B).order("occurred_at", { ascending: true }).limit(5000),
      db.from("isps_declarations").select("facility_id, reference, ship_name, ship_imo, security_level, valid_from, valid_to, status, ship_signed_at, created_at").eq("organisation_id", orgId).gte("created_at", A).lt("created_at", B).order("created_at", { ascending: true }).limit(5000),
      db.from("isps_broadcasts").select("id, created_at").eq("organisation_id", orgId).eq("kind", "level_change").gte("created_at", A).lt("created_at", B).limit(1000),
      db.from("authority_notice_recipients").select("notice_id, from_org_id, first_read_at, acknowledged_at, acknowledged_by_name").eq("org_id", orgId).gte("delivered_at", A).lt("delivered_at", B).limit(1000),
    ]);
    if (!org) throwSafeError("isps.report", new Error("org"), "Organisation not found.");

    const { complianceFlags } = await import("./isps.rules");
    const facilities: IspsFacilityReport[] = ((fac ?? []) as any[]).map((f) => {
      const ch = ((changes ?? []) as any[]).filter((c) => c.facility_id === f.id);
      // Level at the start of the period: the last change before it, else the first change's starting level, else today's level.
      const before = ch.filter((c) => Date.parse(c.created_at) < a).pop();
      const inside = ch.filter((c) => Date.parse(c.created_at) >= a);
      let level = before ? before.to_level : inside[0] ? inside[0].from_level : f.security_level;
      let t = Math.max(a, Date.parse(f.created_at));
      const level_days: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 };
      for (const c of inside) {
        const at = Date.parse(c.created_at);
        if (at > t) level_days[level as 1 | 2 | 3] += (at - t) / DAY;
        level = c.to_level;
        t = Math.max(t, at);
      }
      if (b > t) level_days[level as 1 | 2 | 3] += (b - t) / DAY;
      for (const k of [1, 2, 3] as const) level_days[k] = Math.round(level_days[k] * 10) / 10;

      const ds = ((drills ?? []) as any[]).filter((d) => d.facility_id === f.id);
      const drillOnly = ds.filter((d) => d.kind === "drill").map((d) => startOf(d.held_on));
      const { overdue, longest } = drillOverdue(drillOnly, Date.parse(f.created_at), Math.max(a, Date.parse(f.created_at)), b);
      const inPeriod = ds.filter((d) => startOf(d.held_on) >= a && startOf(d.held_on) < b);
      const lapsed = f.plan_expires_on ? Math.max(0, Math.round((b - Math.max(a, endOf(f.plan_expires_on))) / DAY)) : 0;

      const bs = ((br ?? []) as any[]).filter((x) => x.facility_id === f.id);
      const lastDrill = [...drillOnly].filter((x) => x <= Date.now()).pop();
      const lastEx = ds.filter((d) => d.kind === "exercise").pop()?.held_on ?? null;
      return {
        id: f.id,
        name: f.name,
        kind: f.kind,
        identifier: f.identifier,
        pfso: f.security_officer_name,
        pfso_phone: f.security_officer_phone,
        plan_approved_on: f.plan_approved_on,
        plan_expires_on: f.plan_expires_on,
        plan_lapsed_days: lapsed,
        level_now: f.security_level,
        level_days,
        level_changes: inside.map((c) => ({ at: c.created_at, from: c.from_level, to: c.to_level, reason: c.reason, by: c.changed_by_name })),
        drills: inPeriod.map((d) => ({ held_on: d.held_on, kind: d.kind, scenario: d.scenario, participants: d.participants, findings: d.findings, corrective_actions: d.corrective_actions, by: d.recorded_by_name })),
        drill_overdue_days: overdue,
        longest_drill_gap_days: longest,
        exercises_in_period: inPeriod.filter((d) => d.kind === "exercise").length,
        breaches: bs.map((x) => ({
          occurred_at: x.occurred_at, category: x.category, description: x.description, level: x.security_level,
          reported_to_authority: x.reported_to_authority, reported_at: x.reported_at, reported_to: x.reported_to,
          hours_to_report: x.reported_at ? Math.round(((Date.parse(x.reported_at) - Date.parse(x.occurred_at)) / 3600_000) * 10) / 10 : null,
          status: x.status, closed_at: x.closed_at,
          days_to_close: x.closed_at ? Math.round(((Date.parse(x.closed_at) - Date.parse(x.occurred_at)) / DAY) * 10) / 10 : null,
        })),
        declarations: ((dos ?? []) as any[]).filter((d) => d.facility_id === f.id).map((d) => ({ reference: d.reference, ship_name: d.ship_name, ship_imo: d.ship_imo, level: d.security_level, valid_from: d.valid_from, valid_to: d.valid_to, status: d.status, ship_signed_at: d.ship_signed_at })),
        flags_now: complianceFlags({
          last_drill_on: lastDrill != null ? new Date(lastDrill).toISOString().slice(0, 10) : null,
          last_exercise_on: lastEx,
          plan_expires_on: f.plan_expires_on,
          plan_approved_on: f.plan_approved_on,
          security_officer_name: f.security_officer_name,
          unreported_breaches: 0,
          created_at: f.created_at,
        }),
      };
    });

    // Unreported breaches for today's flags count every breach, not only those in the period.
    const { data: unrep } = await db.from("isps_breaches").select("facility_id").eq("organisation_id", orgId).eq("reported_to_authority", false).limit(5000);
    for (const f of facilities) {
      const n = ((unrep ?? []) as any[]).filter((x) => x.facility_id === f.id).length;
      if (n) f.flags_now.push({ code: "breach_unreported", tone: "fail", text: `${n} breach${n === 1 ? "" : "es"} not yet reported to the authority` });
    }

    const bIds = ((bc ?? []) as any[]).map((x) => x.id);
    const { data: recips } = bIds.length ? await db.from("isps_broadcast_recipients").select("broadcast_id, first_sent_at, acknowledged_at").in("broadcast_id", bIds).limit(20000) : { data: [] };
    const ackMins = ((recips ?? []) as any[]).filter((r) => r.acknowledged_at).map((r) => (Date.parse(r.acknowledged_at) - Date.parse(r.first_sent_at)) / 60_000);

    const nIds = ((nrec ?? []) as any[]).map((r) => r.notice_id);
    const { data: notes } = nIds.length ? await db.from("authority_notices").select("id, reference, title, from_org_id, issued_at, respond_by").in("id", nIds) : { data: [] };
    const fromIds = [...new Set(((notes ?? []) as any[]).map((n) => n.from_org_id))];
    const { data: fromOrgs } = fromIds.length ? await db.from("organisations").select("id, name").in("id", fromIds) : { data: [] };
    const notices = ((nrec ?? []) as any[]).map((r) => {
      const n = ((notes ?? []) as any[]).find((x) => x.id === r.notice_id);
      return {
        reference: n?.reference ?? "", title: n?.title ?? "", from: ((fromOrgs ?? []) as any[]).find((o) => o.id === n?.from_org_id)?.name ?? "",
        issued_at: n?.issued_at ?? "", respond_by: n?.respond_by ?? null, first_read_at: r.first_read_at, acknowledged_at: r.acknowledged_at, acknowledged_by: r.acknowledged_by_name,
        on_time: n?.respond_by ? (r.acknowledged_at ? Date.parse(r.acknowledged_at) <= Date.parse(n.respond_by) : Date.parse(n.respond_by) < Date.now() ? false : null) : null,
      };
    }).sort((x, y) => x.issued_at.localeCompare(y.issued_at));

    const all = <T,>(pick: (f: IspsFacilityReport) => T[]) => facilities.flatMap(pick);
    return {
      org: { id: org.id, name: org.name },
      viewer_is_authority: viewerIsAuthority,
      from: data.from,
      to: data.to,
      generated_at: new Date().toISOString(),
      generated_by: name,
      facilities,
      acks: { broadcasts: bIds.length, recipients: (recips ?? []).length, acknowledged: ackMins.length, median_ack_min: median(ackMins), within_30min: ackMins.filter((m) => m <= 30).length },
      notices,
      summary: {
        facilities: facilities.length,
        failing_now: facilities.filter((f) => f.flags_now.some((x) => x.tone === "fail")).length,
        drills: all((f) => f.drills).filter((d) => d.kind === "drill").length,
        exercises: all((f) => f.drills).filter((d) => d.kind === "exercise").length,
        breaches: all((f) => f.breaches).length,
        unreported: all((f) => f.breaches).filter((x) => !x.reported_to_authority).length,
        declarations_signed: all((f) => f.declarations).filter((d) => d.status === "signed").length,
        days_at_level_2_or_3: Math.round(facilities.reduce((n, f) => n + f.level_days[2] + f.level_days[3], 0) * 10) / 10,
      },
    };
  });
