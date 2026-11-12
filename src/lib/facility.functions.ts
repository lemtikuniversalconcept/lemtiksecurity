import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getActiveOrgId } from "@/lib/orgs.server";
import { throwSafeError } from "@/lib/server-errors";
import type { ComplianceFlag } from "./isps.rules";

// One screen for a port facility's security officer: security level per facility, drills and
// exercises due, open breaches, Declarations of Security, today's cargo custody and camera
// alerts. Sections only appear for the modules the organisation has switched on.

const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;
const DAY = 86_400_000;

export type FacilityRow = {
  id: string;
  name: string;
  kind: string;
  security_level: number;
  level_set_at: string;
  level_set_by_name: string | null;
  level_reason: string | null;
  security_officer_name: string | null;
  last_drill_on: string | null;
  next_drill_due: string | null;
  last_exercise_on: string | null;
  plan_expires_on: string | null;
  open_breaches: number;
  unreported_breaches: number;
  flags: ComplianceFlag[];
};
export type AttentionItem = { tone: "fail" | "warn"; area: "isps" | "cargo" | "cameras" | "incidents"; title: string; detail: string; at: string | null; to: string };
export type FacilityOverview = {
  generated_at: string;
  org: string;
  modules: { isps: boolean; cargo: boolean; cameras: boolean };
  facilities: FacilityRow[];
  breaches: { id: string; facility: string; occurred_at: string; category: string; description: string; reported_to_authority: boolean; security_level: number | null }[];
  declarations: { active: number; awaiting_ship: { id: string; reference: string; ship_name: string; facility: string; valid_from: string; created_at: string }[]; today: { id: string; reference: string; ship_name: string; facility: string; valid_from: string; valid_to: string; status: string }[] };
  level_acks: { title: string; level: number | null; created_at: string; total: number; acked: number; waiting: string[] }[];
  cargo: { in_transit: number; planned: number; delivered_today: number; exceptions: number; events_today: { at: string; reference: string; consignment_id: string; kind: string; by: string | null; seals_ok: boolean | null; seal_issue: string | null; note: string | null; party: string | null }[] } | null;
  cameras: { total: number; events_24h: number; recent: { at: string; camera: string; zone: string | null; event: string; confidence: number | null }[] } | null;
  incidents_open: { id: string; code: string; title: string; severity: number; status: string; reported_at: string }[];
  attention: AttentionItem[];
};

const words = (s: string) => s.replace(/_/g, " ");

export const getFacilityOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FacilityOverview> => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { hasFeature } = await import("./features.server");
    const { roleIn } = await import("./links.server");
    const db = await admin();
    const role = await roleIn(db, context.userId, orgId);
    if (!role || !["manager", "supervisor", "client_admin"].includes(role)) throwSafeError("facility.overview", new Error("role"), "Only managers, operators and client admins can open the facility overview.");
    const [isps, cargo] = await Promise.all([hasFeature(orgId, "isps"), hasFeature(orgId, "cargo")]);
    const now = Date.now();
    // Midnight in Lagos (UTC+1 all year), as an instant.
    const lagos = new Date(now + 3600_000);
    const todayIso = new Date(Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate()) - 3600_000).toISOString();
    const nowIso = new Date(now).toISOString();

    const [{ data: org }, fac, br, drills, dos, bcasts, cons, ev, cams, vis, inc] = await Promise.all([
      db.from("organisations").select("name").eq("id", orgId).maybeSingle(),
      isps ? db.from("isps_facilities").select("id, name, kind, security_level, level_set_at, level_set_by_name, level_reason, security_officer_name, plan_approved_on, plan_expires_on, created_at").eq("organisation_id", orgId).order("name") : { data: [] },
      isps ? db.from("isps_breaches").select("id, facility_id, occurred_at, category, description, reported_to_authority, security_level, status").eq("organisation_id", orgId).order("occurred_at", { ascending: false }).limit(1000) : { data: [] },
      isps ? db.from("isps_drills").select("facility_id, kind, held_on").eq("organisation_id", orgId).order("held_on", { ascending: false }).limit(1000) : { data: [] },
      isps ? db.from("isps_declarations").select("id, facility_id, reference, ship_name, valid_from, valid_to, status, created_at").eq("organisation_id", orgId).neq("status", "cancelled").gte("valid_to", new Date(now - 7 * DAY).toISOString()).order("valid_from", { ascending: true }).limit(300) : { data: [] },
      isps ? db.from("isps_broadcasts").select("id, title, level, created_at, require_ack").eq("organisation_id", orgId).eq("kind", "level_change").eq("require_ack", true).is("closed_at", null).order("created_at", { ascending: false }).limit(10) : { data: [] },
      cargo ? db.from("cargo_consignments").select("id, reference, status, has_exception, delivered_at, last_event_at, max_gap_hours").eq("organisation_id", orgId).neq("status", "cancelled").limit(2000) : { data: [] },
      cargo ? db.from("cargo_custody_events").select("consignment_id, kind, recorded_at, recorded_by_name, seals_ok, seal_issue, note, from_party, to_party").eq("organisation_id", orgId).gte("recorded_at", todayIso).order("recorded_at", { ascending: false }).limit(200) : { data: [] },
      db.from("cctv_ai_cameras").select("camera_id, name, zone").eq("org_id", orgId).limit(500),
      db.from("cctv_ai_vision_events").select("camera_id, event_type, confidence, created_at").eq("org_id", orgId).gte("created_at", new Date(now - DAY).toISOString()).order("created_at", { ascending: false }).limit(200),
      db.from("incidents").select("id, code, title, type, severity, status, reported_at").eq("organisation_id", orgId).not("status", "in", "(resolved,closed)").order("severity", { ascending: false }).order("reported_at", { ascending: false }).limit(20),
    ]);

    const { complianceFlags } = await import("./isps.rules");
    const facName = new Map<string, string>(((fac.data ?? []) as any[]).map((f) => [f.id, f.name]));
    const breaches = (br.data ?? []) as any[];
    const drillRows = (drills.data ?? []) as any[];
    const facilities: FacilityRow[] = ((fac.data ?? []) as any[]).map((f) => {
      const d = drillRows.filter((x) => x.facility_id === f.id);
      const b = breaches.filter((x) => x.facility_id === f.id);
      const last_drill_on = d.find((x) => x.kind === "drill")?.held_on ?? null;
      const row = {
        ...f,
        last_drill_on,
        last_exercise_on: d.find((x) => x.kind === "exercise")?.held_on ?? null,
        open_breaches: b.filter((x) => x.status === "open").length,
        unreported_breaches: b.filter((x) => !x.reported_to_authority).length,
      };
      return { ...row, next_drill_due: last_drill_on ? new Date(Date.parse(last_drill_on) + 92 * DAY).toISOString().slice(0, 10) : null, flags: complianceFlags(row) };
    });

    const attention: AttentionItem[] = [];
    for (const f of facilities) for (const fl of f.flags) if (fl.code !== "officer" || fl.tone === "fail") attention.push({ tone: fl.tone, area: "isps", title: f.name, detail: fl.text, at: null, to: "/app/isps" });
    const openBr = breaches.filter((b) => b.status === "open");
    for (const b of openBr.slice(0, 10)) attention.push({ tone: b.reported_to_authority ? "warn" : "fail", area: "isps", title: `Open breach · ${facName.get(b.facility_id) ?? "Facility"}`, detail: `${words(b.category)}${b.reported_to_authority ? "" : " · not yet reported to the authority"}`, at: b.occurred_at, to: "/app/isps" });

    const decl = (dos.data ?? []) as any[];
    const awaiting = decl.filter((d) => d.status === "awaiting_ship" && Date.parse(d.valid_to) > now);
    for (const d of awaiting.filter((x) => Date.parse(x.valid_from) < now + DAY).slice(0, 5)) attention.push({ tone: Date.parse(d.valid_from) <= now ? "fail" : "warn", area: "isps", title: `Declaration of Security ${d.reference}`, detail: `${d.ship_name} hasn't signed${Date.parse(d.valid_from) <= now ? " and it's already in force" : ""}`, at: d.valid_from, to: "/app/isps" });

    const bl = (bcasts.data ?? []) as any[];
    const { data: recips } = bl.length ? await db.from("isps_broadcast_recipients").select("broadcast_id, name, acknowledged_at").in("broadcast_id", bl.map((b) => b.id)) : { data: [] };
    const level_acks = bl.map((b) => {
      const r = ((recips ?? []) as any[]).filter((x) => x.broadcast_id === b.id);
      return { title: b.title, level: b.level, created_at: b.created_at, total: r.length, acked: r.filter((x) => x.acknowledged_at).length, waiting: r.filter((x) => !x.acknowledged_at).map((x) => x.name ?? "Unnamed") };
    }).filter((b) => b.total > 0);
    for (const b of level_acks) if (b.acked < b.total) attention.push({ tone: "warn", area: "isps", title: b.title, detail: `${b.total - b.acked} of ${b.total} people haven't acknowledged`, at: b.created_at, to: "/app/isps" });

    let cargoOut: FacilityOverview["cargo"] = null;
    if (cargo) {
      const cs = (cons.data ?? []) as any[];
      const ref = new Map<string, string>(cs.map((c) => [c.id, c.reference]));
      const live = cs.filter((c) => c.status === "planned" || c.status === "in_transit");
      for (const c of live.filter((x) => x.has_exception).slice(0, 8)) attention.push({ tone: "fail", area: "cargo", title: `Cargo ${c.reference}`, detail: "Custody exception recorded (seal, damage or shortage)", at: c.last_event_at, to: "/app/cargo" });
      for (const c of cs.filter((x) => x.status === "in_transit" && x.last_event_at && x.max_gap_hours && now - Date.parse(x.last_event_at) > x.max_gap_hours * 3600_000).slice(0, 8)) attention.push({ tone: "warn", area: "cargo", title: `Cargo ${c.reference}`, detail: `No custody record for more than ${c.max_gap_hours} h`, at: c.last_event_at, to: "/app/cargo" });
      cargoOut = {
        in_transit: cs.filter((c) => c.status === "in_transit").length,
        planned: cs.filter((c) => c.status === "planned").length,
        delivered_today: cs.filter((c) => c.status === "delivered" && c.delivered_at && c.delivered_at >= todayIso).length,
        exceptions: live.filter((c) => c.has_exception).length,
        events_today: ((ev.data ?? []) as any[]).map((e) => ({ at: e.recorded_at, reference: ref.get(e.consignment_id) ?? "—", consignment_id: e.consignment_id, kind: e.kind, by: e.recorded_by_name, seals_ok: e.seals_ok, seal_issue: e.seal_issue, note: e.note, party: e.kind === "handover" ? [e.from_party, e.to_party].filter(Boolean).join(" → ") || null : null })),
      };
    }

    const camList = (cams.data ?? []) as any[];
    let camOut: FacilityOverview["cameras"] = null;
    if (camList.length) {
      const cam = new Map(camList.map((c) => [c.camera_id, c]));
      const events = (vis.data ?? []) as any[];
      camOut = { total: camList.length, events_24h: events.length, recent: events.slice(0, 12).map((e) => ({ at: e.created_at, camera: cam.get(e.camera_id)?.name ?? "Camera", zone: cam.get(e.camera_id)?.zone ?? null, event: words(e.event_type), confidence: e.confidence ?? null })) };
      if (events.length) attention.push({ tone: "warn", area: "cameras", title: `${events.length} camera alert${events.length === 1 ? "" : "s"} in 24 hours`, detail: `Latest: ${words(events[0].event_type)} at ${cam.get(events[0].camera_id)?.name ?? "a camera"}`, at: events[0].created_at, to: "/app/sensors" });
    }

    const incidents_open = ((inc.data ?? []) as any[]).map((i) => ({ id: i.id, code: i.code, title: i.title || words(String(i.type ?? "")), severity: i.severity, status: i.status, reported_at: i.reported_at }));
    for (const i of incidents_open.filter((x) => x.severity >= 4).slice(0, 5)) attention.push({ tone: i.severity >= 5 ? "fail" : "warn", area: "incidents", title: `${i.code} · ${i.title}`, detail: `Severity ${i.severity}, ${words(i.status)}`, at: i.reported_at, to: `/app/incidents/${i.id}` });

    attention.sort((a, b) => Number(b.tone === "fail") - Number(a.tone === "fail") || (b.at ?? "").localeCompare(a.at ?? ""));
    return {
      generated_at: nowIso,
      org: org?.name ?? "",
      modules: { isps, cargo, cameras: camList.length > 0 },
      facilities,
      breaches: openBr.slice(0, 20).map((b) => ({ id: b.id, facility: facName.get(b.facility_id) ?? "—", occurred_at: b.occurred_at, category: b.category, description: b.description, reported_to_authority: b.reported_to_authority, security_level: b.security_level })),
      declarations: {
        active: decl.filter((d) => d.status === "signed" && Date.parse(d.valid_from) <= now && Date.parse(d.valid_to) >= now).length,
        awaiting_ship: awaiting.map((d) => ({ id: d.id, reference: d.reference, ship_name: d.ship_name, facility: facName.get(d.facility_id) ?? "—", valid_from: d.valid_from, created_at: d.created_at })),
        today: decl.filter((d) => Date.parse(d.valid_from) <= now + DAY && Date.parse(d.valid_to) >= Date.parse(todayIso)).map((d) => ({ id: d.id, reference: d.reference, ship_name: d.ship_name, facility: facName.get(d.facility_id) ?? "—", valid_from: d.valid_from, valid_to: d.valid_to, status: d.status })),
      },
      level_acks,
      cargo: cargoOut,
      cameras: camOut,
      incidents_open,
      attention,
    };
  });
