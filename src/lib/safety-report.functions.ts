import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getActiveOrgId } from "@/lib/orgs.server";
import { throwSafeError } from "@/lib/server-errors";

// Monthly safety report for an operator: voyages and how many ran on time, check-ins kept and
// missed, alerts and how fast they were acknowledged, escalations, hand-offs to responders,
// search-and-rescue cases and possible-hijack flags, per boat and per corridor, against the
// month before. Every figure is counted from the organisation's own records; nothing is estimated.

const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;
const MIN = 60_000;
const ON_TIME_MIN = 15;
/** Alert kinds that record normal operation rather than a safety event. */
const ROUTINE = new Set(["voyage_started", "voyage_completed", "checkin", "back_on_route", "tracking_resumed", "handoff", "responder_update", "zone_exit"]);

export type MonthStats = {
  voyages: { total: number; completed: number; cancelled: number; still_underway: number; dep_timed: number; dep_on_time: number; arr_timed: number; arr_on_time: number; people: number; headcount_mismatch: number; off_route: number; overdue: number; curfew: number };
  checkins: { kept: number; late: number; missed: number };
  alerts: { total: number; serious: number; acknowledged: number; unacknowledged: number; median_ack_s: number | null; p90_ack_s: number | null; within_2min: number; escalated: number; by_kind: { kind: string; count: number; serious: number; median_ack_s: number | null }[] };
  handoffs: { total: number; confirmed: number; median_confirm_s: number | null; on_scene: number; resolved: number };
  sar: { opened: number; closed: number };
  hijack: { flagged: number; confirmed: number; dismissed: number };
};
export type BoatRow = { id: string; name: string; voyages: number; on_time_pct: number | null; people: number; missed_checkins: number; serious_alerts: number; median_ack_s: number | null; mismatches: number };
export type CorridorRow = { id: string; name: string; voyages: number; serious_alerts: number; off_route: number; curfew: number };
export type SafetyReport = {
  org: string;
  month: string;
  label: string;
  from: string;
  to: string;
  generated_at: string;
  current: MonthStats;
  previous: MonthStats;
  boats: BoatRow[];
  corridors: CorridorRow[];
  serious: { at: string; boat: string; kind: string; severity: number; message: string; ack_s: number | null; escalated: boolean }[];
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
};
const pct = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]);
};

/** Month bounds in Lagos time (UTC+1 all year) as instants. */
function bounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1) - 3600_000);
  const to = new Date(Date.UTC(y, m, 1) - 3600_000);
  return { from: from.toISOString(), to: to.toISOString() };
}
const prevMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

async function load(db: any, orgId: string, from: string, to: string) {
  const voyOr = `and(departed_at.gte.${from},departed_at.lt.${to}),and(departed_at.is.null,planned_departure.gte.${from},planned_departure.lt.${to})`;
  const { fetchAll } = await import("./fetch-all.server");
  let voyages: any[], alerts: any[], checkins: any[], handoffs: any[], sar: any[];
  try {
    [voyages, alerts, checkins, handoffs, sar] = await Promise.all([
      fetchAll(() => db.from("movement_voyages").select("id, subject_id, corridor_id, status, planned_departure, planned_arrival, departed_at, arrived_at, departure_count, arrival_count, off_route, overdue_alerted, curfew_alerted, hijack_flagged_at, hijack_review").eq("organisation_id", orgId).or(voyOr).order("id")),
      fetchAll(() => db.from("movement_alerts").select("id, subject_id, voyage_id, kind, severity, message, created_at, acknowledged_at, escalation_step").eq("organisation_id", orgId).gte("created_at", from).lt("created_at", to).order("id")),
      fetchAll(() => db.from("movement_checkins").select("subject_id, was_overdue").eq("organisation_id", orgId).gte("created_at", from).lt("created_at", to).order("id")),
      fetchAll(() => db.from("movement_handoffs").select("id, created_at, status").eq("organisation_id", orgId).gte("created_at", from).lt("created_at", to).order("id")),
      fetchAll(() => db.from("sar_cases").select("id, status, created_at, closed_at").eq("organisation_id", orgId).gte("created_at", from).lt("created_at", to).order("id")),
    ]);
  } catch (e) {
    throwSafeError("safety.load", e as Error, "Unable to build the safety report.");
  }
  const ups: any[] = [];
  for (let i = 0; i < handoffs!.length; i += 200) {
    const part = handoffs!.slice(i, i + 200).map((x) => x.id);
    ups.push(...(await fetchAll(() => db.from("movement_handoff_updates").select("handoff_id, status, created_at").in("handoff_id", part).in("status", ["acknowledged", "dispatched", "on_scene", "resolved"]).order("created_at", { ascending: true }).order("id"))));
  }
  return { voyages: voyages!, alerts: alerts!, checkins: checkins!, handoffs: handoffs!, updates: ups, sar: sar! };
}

const ackS = (a: any) => (a.acknowledged_at ? Math.max(0, Math.round((Date.parse(a.acknowledged_at) - Date.parse(a.created_at)) / 1000)) : null);
const onTime = (actual: string | null, planned: string | null) => (actual && planned ? Date.parse(actual) - Date.parse(planned) <= ON_TIME_MIN * MIN : null);

function stats(d: Awaited<ReturnType<typeof load>>): MonthStats {
  const vs = d.voyages;
  const ran = vs.filter((x) => x.status !== "cancelled");
  const dep = ran.map((x) => onTime(x.departed_at, x.planned_departure)).filter((x) => x != null) as boolean[];
  const arr = ran.map((x) => onTime(x.arrived_at, x.planned_arrival)).filter((x) => x != null) as boolean[];
  const safety = d.alerts.filter((a) => !ROUTINE.has(a.kind));
  const serious = safety.filter((a) => a.severity >= 3);
  const acks = serious.map(ackS).filter((x) => x != null) as number[];
  const kinds = new Map<string, any[]>();
  for (const a of safety) kinds.set(a.kind, [...(kinds.get(a.kind) ?? []), a]);
  const firstConfirm = new Map<string, string>();
  for (const u of d.updates) if (!firstConfirm.has(u.handoff_id)) firstConfirm.set(u.handoff_id, u.created_at);
  const confirmS = d.handoffs.filter((x) => firstConfirm.has(x.id)).map((x) => Math.round((Date.parse(firstConfirm.get(x.id)!) - Date.parse(x.created_at)) / 1000));
  return {
    voyages: {
      total: vs.length,
      completed: vs.filter((x) => x.status === "completed").length,
      cancelled: vs.filter((x) => x.status === "cancelled").length,
      still_underway: vs.filter((x) => x.status === "underway").length,
      dep_timed: dep.length,
      dep_on_time: dep.filter(Boolean).length,
      arr_timed: arr.length,
      arr_on_time: arr.filter(Boolean).length,
      people: ran.reduce((n, x) => n + (x.departure_count ?? 0), 0),
      headcount_mismatch: ran.filter((x) => x.departure_count != null && x.arrival_count != null && x.departure_count !== x.arrival_count).length,
      off_route: ran.filter((x) => x.off_route || d.alerts.some((a) => a.voyage_id === x.id && a.kind === "off_route")).length,
      overdue: ran.filter((x) => x.overdue_alerted || d.alerts.some((a) => a.voyage_id === x.id && a.kind === "overdue")).length,
      curfew: ran.filter((x) => x.curfew_alerted || d.alerts.some((a) => a.voyage_id === x.id && a.kind === "curfew")).length,
    },
    checkins: { kept: d.checkins.filter((x) => !x.was_overdue).length, late: d.checkins.filter((x) => x.was_overdue).length, missed: d.alerts.filter((a) => a.kind === "checkin_missed").length },
    alerts: {
      total: safety.length,
      serious: serious.length,
      acknowledged: serious.filter((a) => a.acknowledged_at).length,
      unacknowledged: serious.filter((a) => !a.acknowledged_at).length,
      median_ack_s: median(acks),
      p90_ack_s: pct(acks, 90),
      within_2min: acks.filter((x) => x <= 120).length,
      escalated: serious.filter((a) => (a.escalation_step ?? 0) > 0).length,
      by_kind: [...kinds.entries()]
        .map(([kind, xs]) => ({ kind, count: xs.length, serious: xs.filter((a) => a.severity >= 3).length, median_ack_s: median(xs.filter((a) => a.severity >= 3).map(ackS).filter((x) => x != null) as number[]) }))
        .sort((a, b) => b.serious - a.serious || b.count - a.count),
    },
    handoffs: { total: d.handoffs.length, confirmed: confirmS.length, median_confirm_s: median(confirmS), on_scene: d.handoffs.filter((x) => ["on_scene", "resolved"].includes(x.status)).length, resolved: d.handoffs.filter((x) => x.status === "resolved").length },
    sar: { opened: d.sar.length, closed: d.sar.filter((x) => x.closed_at).length },
    hijack: {
      flagged: vs.filter((x) => x.hijack_flagged_at).length,
      confirmed: vs.filter((x) => x.hijack_review === "confirmed").length,
      dismissed: vs.filter((x) => x.hijack_review === "dismissed").length,
    },
  };
}

export const getSafetyReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).parse(d))
  .handler(async ({ data, context }): Promise<SafetyReport> => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    await (await import("./features.server")).assertFeature(orgId, "movement");
    const db = await admin();
    const { roleIn } = await import("./links.server");
    const role = await roleIn(db, context.userId, orgId);
    if (!role || !["manager", "supervisor", "client_admin"].includes(role)) throwSafeError("safety.role", new Error("role"), "Only managers, operators and client admins can open the safety report.");
    const cur = bounds(data.month);
    if (Date.parse(cur.from) > Date.now()) throwSafeError("safety.month", new Error("future"), "That month hasn't started yet.");
    const prev = bounds(prevMonth(data.month));
    const [{ data: org }, d, p, { data: subs }, { data: cors }] = await Promise.all([
      db.from("organisations").select("name").eq("id", orgId).maybeSingle(),
      load(db, orgId, cur.from, cur.to),
      load(db, orgId, prev.from, prev.to),
      import("./fetch-all.server").then(({ fetchAll }) => fetchAll(() => db.from("movement_subjects").select("id, name").eq("organisation_id", orgId).order("id"))).then((data) => ({ data })),
      db.from("movement_corridors").select("id, name").eq("organisation_id", orgId).limit(500),
    ]);
    const subName = new Map<string, string>(((subs ?? []) as any[]).map((s) => [s.id, s.name]));
    const seriousAlerts = d.alerts.filter((a) => !ROUTINE.has(a.kind) && a.severity >= 3);

    const boatIds = new Set<string>([...d.voyages.map((v) => v.subject_id), ...seriousAlerts.map((a) => a.subject_id), ...d.alerts.filter((a) => a.kind === "checkin_missed").map((a) => a.subject_id)].filter(Boolean));
    const boats: BoatRow[] = [...boatIds].map((id) => {
      const vs = d.voyages.filter((v) => v.subject_id === id && v.status !== "cancelled");
      const times = vs.map((v) => onTime(v.arrived_at, v.planned_arrival)).filter((x) => x != null) as boolean[];
      const sa = seriousAlerts.filter((a) => a.subject_id === id);
      return {
        id,
        name: subName.get(id) ?? "Removed",
        voyages: vs.length,
        on_time_pct: times.length ? Math.round((times.filter(Boolean).length / times.length) * 100) : null,
        people: vs.reduce((n, v) => n + (v.departure_count ?? 0), 0),
        missed_checkins: d.alerts.filter((a) => a.subject_id === id && a.kind === "checkin_missed").length,
        serious_alerts: sa.length,
        median_ack_s: median(sa.map(ackS).filter((x) => x != null) as number[]),
        mismatches: vs.filter((v) => v.departure_count != null && v.arrival_count != null && v.departure_count !== v.arrival_count).length,
      };
    }).sort((a, b) => b.serious_alerts - a.serious_alerts || b.voyages - a.voyages);

    const corridors: CorridorRow[] = ((cors ?? []) as any[]).map((c) => {
      const vs = d.voyages.filter((v) => v.corridor_id === c.id && v.status !== "cancelled");
      const ids = new Set(vs.map((v) => v.id));
      return { id: c.id, name: c.name, voyages: vs.length, serious_alerts: seriousAlerts.filter((a) => a.voyage_id && ids.has(a.voyage_id)).length, off_route: vs.filter((v) => v.off_route).length, curfew: vs.filter((v) => v.curfew_alerted).length };
    }).filter((c) => c.voyages > 0).sort((a, b) => b.voyages - a.voyages);

    const label = new Date(Date.parse(cur.from) + 2 * 3600_000).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "Africa/Lagos" });
    return {
      org: org?.name ?? "",
      month: data.month,
      label,
      from: cur.from,
      to: cur.to,
      generated_at: new Date().toISOString(),
      current: stats(d),
      previous: stats(p),
      boats,
      corridors,
      serious: seriousAlerts
        .sort((a, b) => b.severity - a.severity || a.created_at.localeCompare(b.created_at))
        .slice(0, 100)
        .map((a) => ({ at: a.created_at, boat: subName.get(a.subject_id) ?? "—", kind: a.kind, severity: a.severity, message: a.message, ack_s: ackS(a), escalated: (a.escalation_step ?? 0) > 0 })),
    };
  });
