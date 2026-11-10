import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getActiveOrgId } from "@/lib/orgs.server";
import { throwSafeError } from "@/lib/server-errors";
import { recordBlackboxAudit } from "@/lib/audit.server";

// Voyages: a boat's (or a convoy's) planned trip, with a route corridor, planned times, a crew
// list and head counts. Alerts during a voyage (off route, overdue, missed check-in, man
// overboard…) are raised by movement.server.ts as positions arrive.

export type CrewMember = { name: string; role: string };
export type Voyage = {
  id: string;
  subject_id: string;
  name: string;
  status: "planned" | "underway" | "completed" | "cancelled";
  route: [number, number][];
  corridor_m: number;
  planned_departure: string | null;
  planned_arrival: string | null;
  departed_at: string | null;
  arrived_at: string | null;
  crew: CrewMember[];
  departure_count: number | null;
  arrival_count: number | null;
  off_route: boolean;
  overdue_alerted: boolean;
  notes: string | null;
  created_at: string;
};

const COLS = "id, subject_id, name, status, route, corridor_m, planned_departure, planned_arrival, departed_at, arrived_at, crew, departure_count, arrival_count, off_route, overdue_alerted, notes, created_at";
const sb = (ctx: { supabase: unknown }) => ctx.supabase as any;

export const listVoyages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Voyage[]> => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
    const { data, error } = await sb(context)
      .from("movement_voyages")
      .select(COLS)
      .eq("organisation_id", orgId)
      .or(`status.in.(planned,underway),created_at.gte.${since}`)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throwSafeError("voyages.list", error, "Unable to load voyages.");
    return (data ?? []) as Voyage[];
  });

const lngLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

export const saveVoyage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      subject_id: z.string().uuid(),
      name: z.string().trim().min(1).max(160),
      route: z.array(lngLat).max(200),
      corridor_m: z.number().int().min(100).max(50_000),
      planned_departure: z.string().datetime({ offset: true }).nullable(),
      planned_arrival: z.string().datetime({ offset: true }).nullable(),
      crew: z.array(z.object({ name: z.string().trim().min(1).max(120), role: z.string().trim().max(60) })).max(500),
      notes: z.string().trim().max(2000).nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    if (data.planned_departure && data.planned_arrival && Date.parse(data.planned_arrival) <= Date.parse(data.planned_departure)) {
      throwSafeError("voyages.save", new Error("arrival before departure"), "Planned arrival must be after planned departure.");
    }
    const { id, ...row } = data;
    const q = id
      ? sb(context).from("movement_voyages").update(row).eq("id", id).eq("organisation_id", orgId).in("status", ["planned", "underway"]).select("id").single()
      : sb(context).from("movement_voyages").insert({ ...row, organisation_id: orgId, created_by: context.userId }).select("id").single();
    const { data: saved, error } = await q;
    if (error) throwSafeError("voyages.save", error, "Unable to save the voyage. Finished voyages can't be edited.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "movement_voyage", resourceId: saved.id, actionType: id ? "update" : "create", actionDetail: { name: data.name, waypoints: data.route.length, crew: data.crew.length } });
    return { id: saved.id as string };
  });

async function voyageAndSubject(context: any, orgId: string, id: string) {
  const { data: v, error } = await sb(context).from("movement_voyages").select(`${COLS}, organisation_id`).eq("id", id).eq("organisation_id", orgId).maybeSingle();
  if (error || !v) throwSafeError("voyages.get", error ?? new Error("not found"), "Voyage not found.");
  const { data: s } = await sb(context).from("movement_subjects").select("id, organisation_id, name, last_lat, last_lng").eq("id", v.subject_id).maybeSingle();
  return { v: v as Voyage & { organisation_id: string }, s: s as { id: string; organisation_id: string; name: string; last_lat: number | null; last_lng: number | null } | null };
}

export const startVoyage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), departure_count: z.number().int().min(0).max(5000) }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { v, s } = await voyageAndSubject(context, orgId, data.id);
    if (v.status !== "planned") throwSafeError("voyages.start", new Error("not planned"), "Only a planned voyage can be started.");
    const { error } = await sb(context)
      .from("movement_voyages")
      .update({ status: "underway", departed_at: new Date().toISOString(), departure_count: data.departure_count, off_route: false, overdue_alerted: false })
      .eq("id", v.id);
    if (error) throwSafeError("voyages.start", error, error.code === "23505" ? `${s?.name ?? "This boat"} is already on another voyage. Finish that one first.` : "Unable to start the voyage.");
    if (s) {
      const { raiseAlert } = await import("./movement.server");
      const crewNote = v.crew.length && v.crew.length !== data.departure_count ? ` (crew list has ${v.crew.length})` : "";
      await raiseAlert(s, "voyage_started", 1, `${s.name} departed on "${v.name}" with ${data.departure_count} aboard${crewNote}`, s.last_lat != null ? { lat: s.last_lat, lng: s.last_lng! } : null, v.id);
    }
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "movement_voyage", resourceId: v.id, actionType: "start", actionDetail: { departure_count: data.departure_count } });
    return { ok: true };
  });

export const finishVoyage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), arrival_count: z.number().int().min(0).max(5000) }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { v, s } = await voyageAndSubject(context, orgId, data.id);
    if (v.status !== "underway") throwSafeError("voyages.finish", new Error("not underway"), "Only a voyage that's underway can be finished.");
    const { error } = await sb(context).from("movement_voyages").update({ status: "completed", arrived_at: new Date().toISOString(), arrival_count: data.arrival_count }).eq("id", v.id);
    if (error) throwSafeError("voyages.finish", error, "Unable to finish the voyage.");
    const mismatch = v.departure_count != null && v.departure_count !== data.arrival_count;
    if (s) {
      const { raiseAlert } = await import("./movement.server");
      const at = s.last_lat != null ? { lat: s.last_lat, lng: s.last_lng! } : null;
      if (mismatch) {
        await raiseAlert(s, "headcount_mismatch", 5, `HEAD COUNT MISMATCH on "${v.name}": ${v.departure_count} departed, ${data.arrival_count} arrived`, at, v.id);
      } else {
        await raiseAlert(s, "voyage_completed", 1, `${s.name} arrived: "${v.name}" completed with ${data.arrival_count} aboard`, at, v.id);
      }
    }
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "movement_voyage", resourceId: v.id, actionType: "finish", actionDetail: { departure_count: v.departure_count, arrival_count: data.arrival_count, mismatch } });
    return { ok: true, mismatch };
  });

export const cancelVoyage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { error } = await sb(context).from("movement_voyages").update({ status: "cancelled" }).eq("id", data.id).eq("organisation_id", orgId).in("status", ["planned", "underway"]);
    if (error) throwSafeError("voyages.cancel", error, "Unable to cancel the voyage.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "movement_voyage", resourceId: data.id, actionType: "cancel", actionDetail: {} });
    return { ok: true };
  });

export type VoyageReport = {
  voyage: Voyage;
  subject: { name: string; kind: string; category: string; reference: string | null; mmsi: string | null } | null;
  organisation: string;
  track: [number, number][];
  stats: { distance_m: number; duration_s: number | null; max_speed_kn: number | null; avg_speed_kn: number | null; positions: number };
  alerts: { kind: string; severity: number; message: string; created_at: string; acknowledged_at: string | null }[];
  generated_at: string;
};

export const getVoyageReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<VoyageReport> => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { v } = await voyageAndSubject(context, orgId, data.id);
    const [{ data: subj }, { data: org }] = await Promise.all([
      sb(context).from("movement_subjects").select("name, kind, category, reference, mmsi").eq("id", v.subject_id).maybeSingle(),
      sb(context).from("organisations").select("name").eq("id", orgId).maybeSingle(),
    ]);

    let track: [number, number][] = [];
    let distance = 0;
    let maxSpeed: number | null = null;
    let count = 0;
    if (v.departed_at) {
      const until = v.arrived_at ?? new Date().toISOString();
      const { data: rows } = await sb(context)
        .from("movement_positions")
        .select("lat, lng, accuracy_m, speed_mps, recorded_at")
        .eq("subject_id", v.subject_id)
        .gte("recorded_at", v.departed_at)
        .lte("recorded_at", until)
        .order("recorded_at", { ascending: true })
        .limit(5000);
      const { metres } = await import("./movement.server");
      const good = ((rows ?? []) as { lat: number; lng: number; accuracy_m: number | null; speed_mps: number | null; recorded_at: string }[]).filter((r) => r.accuracy_m == null || r.accuracy_m <= 100);
      count = good.length;
      // A jump faster than ~60 knots between two fixes is a GPS glitch, not travel; leave it out.
      const MAX_MPS = 31;
      for (let i = 0; i < good.length; i++) {
        if (i) {
          const d = metres(good[i - 1].lat, good[i - 1].lng, good[i].lat, good[i].lng);
          const dt = (Date.parse(good[i].recorded_at) - Date.parse(good[i - 1].recorded_at)) / 1000;
          if (dt > 0 && d / dt <= MAX_MPS) distance += d;
        }
        if (good[i].speed_mps != null && good[i].speed_mps! <= MAX_MPS) maxSpeed = Math.max(maxSpeed ?? 0, good[i].speed_mps!);
      }
      track = good.map((r) => [r.lng, r.lat]);
    }
    const durationS = v.departed_at ? ((v.arrived_at ? Date.parse(v.arrived_at) : Date.now()) - Date.parse(v.departed_at)) / 1000 : null;

    const { data: alerts } = await sb(context)
      .from("movement_alerts")
      .select("kind, severity, message, created_at, acknowledged_at")
      .eq("voyage_id", v.id)
      .order("created_at", { ascending: true })
      .limit(500);

    const KN = 1.943844;
    return {
      voyage: v,
      subject: subj ?? null,
      organisation: org?.name ?? "",
      track,
      stats: {
        distance_m: Math.round(distance),
        duration_s: durationS,
        max_speed_kn: maxSpeed == null ? null : Math.round(maxSpeed * KN * 10) / 10,
        avg_speed_kn: durationS && distance ? Math.round((distance / durationS) * KN * 10) / 10 : null,
        positions: count,
      },
      alerts: alerts ?? [],
      generated_at: new Date().toISOString(),
    };
  });

// ---------- Nearby ships (public AIS) ----------

export type NearbyShip = { mmsi: string; name: string | null; lat: number; lng: number; speed_kn: number | null; course: number | null; at: string | null };

export const getNearbyShips = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ west: z.number().min(-180).max(180), south: z.number().min(-90).max(90), east: z.number().min(-180).max(180), north: z.number().min(-90).max(90) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ configured: boolean; ships: NearbyShip[]; listened_s: number; note?: string }> => {
    await getActiveOrgId(context.supabase, context.userId);
    const { aisSnapshot } = await import("./ais.server");
    return aisSnapshot(data);
  });
