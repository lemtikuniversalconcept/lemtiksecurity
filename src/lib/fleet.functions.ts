import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getActiveOrgId } from "@/lib/orgs.server";
import { throwSafeError } from "@/lib/server-errors";
import type { MovementAlert, MovementSubject } from "./movement.functions";
import type { Voyage } from "./voyages.functions";
import type { Corridor } from "./corridor.functions";
import type { Weather } from "./corridor.server";

// M9 Fleet overview: one screen for a maritime operator's duty desk.

export type FleetVoyage = Voyage & {
  boat_name: string;
  progress_pct: number | null; // share of the route already covered
  remaining_m: number | null;
  eta: string | null;
  eta_basis: "current_speed" | "average_speed" | "planned" | null;
  late_by_min: number | null; // ETA later than the planned arrival
};
export type FleetCheckin = { subject_id: string; name: string; every_min: number; last_at: string | null; due_at: string; state: "missed" | "due_soon" | "ok" };
export type FleetCorridor = Pick<Corridor, "id" | "name" | "max_wind_kn" | "curfew_start" | "curfew_end"> & { weather: Weather | null; over_limit: boolean; in_curfew: boolean };
export type FleetOverview = {
  generated_at: string;
  subjects: MovementSubject[];
  voyages: FleetVoyage[];
  planned_today: number;
  completed_today: number;
  checkins: FleetCheckin[];
  alerts: MovementAlert[];
  corridors: FleetCorridor[];
};

type LngLat = [number, number];

/** Distance along the route from the point closest to the boat to the end, and how far along it is. */
function routeRemaining(route: LngLat[], lat: number, lng: number, metres: (a: number, b: number, c: number, d: number) => number) {
  if (route.length < 2) return null;
  const segs: number[] = [];
  for (let i = 1; i < route.length; i++) segs.push(metres(route[i - 1][1], route[i - 1][0], route[i][1], route[i][0]));
  const total = segs.reduce((a, b) => a + b, 0);
  if (!total) return null;
  // Closest point on each segment, in a local flat projection (fine over a few tens of km).
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110_540;
  let best = { d: Infinity, along: 0 };
  let before = 0;
  for (let i = 1; i < route.length; i++) {
    const ax = (route[i - 1][0] - lng) * kx, ay = (route[i - 1][1] - lat) * ky;
    const bx = (route[i][0] - lng) * kx, by = (route[i][1] - lat) * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const px = ax + t * dx, py = ay + t * dy;
    const d = Math.hypot(px, py);
    if (d < best.d) best = { d, along: before + t * segs[i - 1] };
    before += segs[i - 1];
  }
  return { total, remaining: Math.max(0, total - best.along), along: best.along };
}

export const getFleetOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FleetOverview> => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const feats = await import("./features.server");
    await feats.assertFeature(orgId, "movement");
    const hasCorridors = await feats.hasFeature(orgId, "corridors");
    const sb = context.supabase as any;
    const { markSilentSubjects } = await import("./movement.server");
    await markSilentSubjects(orgId).catch(() => undefined);

    const dayStart = new Date();
    dayStart.setUTCHours(-1, 0, 0, 0); // midnight in Lagos (UTC+1)
    if (dayStart.getTime() > Date.now()) dayStart.setUTCDate(dayStart.getUTCDate() - 1);

    const [subj, voy, today, alerts, cors] = await Promise.all([
      sb.from("movement_subjects").select("*").eq("organisation_id", orgId).order("name"),
      sb.from("movement_voyages").select("*").eq("organisation_id", orgId).eq("status", "underway").order("departed_at", { ascending: true }).limit(100),
      sb.from("movement_voyages").select("status").eq("organisation_id", orgId).gte("created_at", dayStart.toISOString()).limit(500),
      sb.from("movement_alerts").select("id, subject_id, geofence_id, voyage_id, kind, severity, message, lat, lng, acknowledged_at, created_at").eq("organisation_id", orgId).is("acknowledged_at", null).order("severity", { ascending: false }).order("created_at", { ascending: false }).limit(30),
      hasCorridors
        ? sb.from("movement_corridors").select("id, name, route, max_wind_kn, curfew_start, curfew_end, active").eq("organisation_id", orgId).eq("active", true).limit(12)
        : Promise.resolve({ data: [], error: null }),
    ]);
    for (const r of [subj, voy, today, alerts, cors]) if (r.error) throwSafeError("fleet.overview", r.error, "Unable to load the fleet overview.");

    const subjects = (subj.data ?? []) as MovementSubject[];
    const byId = new Map(subjects.map((s) => [s.id, s]));
    const { metres, weatherAt, inCurfew, DEFAULT_MAX_WIND_KN } = await import("./corridor.server");
    const now = Date.now();

    // Average speed since departure, from the stored track, for boats whose last reported speed is near zero.
    const voyages: FleetVoyage[] = ((voy.data ?? []) as Voyage[]).map((v) => {
      const s = byId.get(v.subject_id);
      const base: FleetVoyage = { ...v, boat_name: s?.name ?? "Unknown boat", progress_pct: null, remaining_m: null, eta: null, eta_basis: null, late_by_min: null };
      if (s?.last_lat != null && s.last_lng != null) {
        const r = routeRemaining(v.route, s.last_lat, s.last_lng, metres);
        if (r) {
          base.remaining_m = Math.round(r.remaining);
          base.progress_pct = Math.round((r.along / r.total) * 100);
          let speed = s.last_speed_mps ?? 0;
          let basis: FleetVoyage["eta_basis"] = "current_speed";
          if (speed < 0.5 && v.departed_at) {
            const secs = (now - new Date(v.departed_at).getTime()) / 1000;
            if (secs > 300) {
              speed = r.along / secs;
              basis = "average_speed";
            }
          }
          if (speed >= 0.5) {
            base.eta = new Date(now + (r.remaining / speed) * 1000).toISOString();
            base.eta_basis = basis;
          }
        }
      }
      if (!base.eta && v.planned_arrival) {
        base.eta = v.planned_arrival;
        base.eta_basis = "planned";
      }
      if (base.eta && v.planned_arrival && base.eta_basis !== "planned") {
        const late = Math.round((new Date(base.eta).getTime() - new Date(v.planned_arrival).getTime()) / 60_000);
        base.late_by_min = late > 5 ? late : null;
      }
      return base;
    });

    const checkins: FleetCheckin[] = subjects
      .filter((s) => s.tracking_enabled && s.checkin_every_minutes)
      .map((s) => {
        const from = s.last_checkin_at ?? s.consent_recorded_at ?? s.created_at;
        const due = new Date(from).getTime() + s.checkin_every_minutes! * 60_000;
        const state: FleetCheckin["state"] = s.checkin_overdue || due < now ? "missed" : due - now < 15 * 60_000 ? "due_soon" : "ok";
        return { subject_id: s.id, name: s.name, every_min: s.checkin_every_minutes!, last_at: s.last_checkin_at, due_at: new Date(due).toISOString(), state };
      })
      .sort((a, b) => a.due_at.localeCompare(b.due_at));

    const corridors: FleetCorridor[] = await Promise.all(
      ((cors.data ?? []) as (Corridor & { route: LngLat[] })[]).map(async (c) => {
        const mid = c.route[Math.floor(c.route.length / 2)];
        const weather = mid ? await weatherAt(mid[1], mid[0]).catch(() => null) : null;
        const limit = c.max_wind_kn ?? DEFAULT_MAX_WIND_KN;
        const over = !!weather && (weather.thunder || Math.max(weather.wind_kn ?? 0, weather.gust_kn != null ? weather.gust_kn * 0.8 : 0) > limit);
        return { id: c.id, name: c.name, max_wind_kn: c.max_wind_kn, curfew_start: c.curfew_start, curfew_end: c.curfew_end, weather, over_limit: over, in_curfew: inCurfew(c.curfew_start, c.curfew_end) };
      }),
    );

    const todays = (today.data ?? []) as { status: string }[];
    return {
      generated_at: new Date().toISOString(),
      subjects,
      voyages,
      planned_today: todays.filter((t) => t.status === "planned").length,
      completed_today: todays.filter((t) => t.status === "completed").length,
      checkins,
      alerts: (alerts.data ?? []) as MovementAlert[],
      corridors,
    };
  });
