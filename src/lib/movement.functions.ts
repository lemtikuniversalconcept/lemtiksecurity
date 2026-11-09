import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getActiveOrgId } from "@/lib/orgs.server";
import { throwSafeError } from "@/lib/server-errors";
import { recordBlackboxAudit } from "@/lib/audit.server";

// Protected Movement: people (students, principals), vehicles and vessels tracked on the move.
// Reads and management go through the signed-in user's Supabase client, so row-level security
// limits them to the org's managers, supervisors and client admins.

export type MovementSubject = {
  id: string;
  organisation_id: string;
  kind: "person" | "vehicle" | "vessel";
  category: string;
  name: string;
  reference: string | null;
  mmsi: string | null;
  phone: string | null;
  emergency_contact: string | null;
  notes: string | null;
  consent_status: "pending" | "granted" | "withdrawn";
  consent_recorded_at: string | null;
  consent_note: string | null;
  tracking_enabled: boolean;
  device_kind: "phone" | "gps_tracker" | "satellite_tracker";
  device_id: string | null;
  tracker_token: string;
  silent_after_minutes: number;
  last_lat: number | null;
  last_lng: number | null;
  last_speed_mps: number | null;
  last_battery: number | null;
  last_seen_at: string | null;
  state: "idle" | "moving" | "stopped" | "silent" | "sos";
  checkin_every_minutes: number | null;
  last_checkin_at: string | null;
  checkin_overdue: boolean;
  stop_alert_minutes: number | null;
  stopped_since: string | null;
  created_at: string;
};

export type MovementGeofence = {
  id: string;
  name: string;
  kind: "safe" | "restricted" | "exclusion";
  center_lat: number;
  center_lng: number;
  radius_m: number;
  alert_on: "enter" | "exit" | "both";
  subject_ids: string[] | null;
  active: boolean;
};

export type MovementAlert = {
  id: string;
  subject_id: string;
  geofence_id: string | null;
  voyage_id: string | null;
  kind: string;
  severity: number;
  message: string;
  lat: number | null;
  lng: number | null;
  acknowledged_at: string | null;
  created_at: string;
};

const sb = (ctx: { supabase: unknown }) => ctx.supabase as any;

export const listMovementSubjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MovementSubject[]> => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { data: probe, error: probeErr } = await sb(context).from("movement_subjects").select("id").eq("organisation_id", orgId).limit(1);
    if (probeErr) throwSafeError("movement.list", probeErr, "Unable to load protected people and assets.");
    if (probe?.length) {
      const { markSilentSubjects } = await import("./movement.server");
      await markSilentSubjects(orgId).catch(() => undefined);
    }
    const { data, error } = await sb(context).from("movement_subjects").select("*").eq("organisation_id", orgId).order("name");
    if (error) throwSafeError("movement.list", error, "Unable to load protected people and assets.");
    return (data ?? []) as MovementSubject[];
  });

const subjectInput = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(["person", "vehicle", "vessel"]),
  category: z.enum(["student", "principal", "staff", "vehicle", "patrol_boat", "crew_boat", "escort_vessel", "supply_vessel", "other"]),
  name: z.string().trim().min(1).max(120),
  reference: z.string().trim().max(120).nullable().optional(),
  mmsi: z.string().trim().regex(/^\d{9}$/, "MMSI is 9 digits").nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  emergency_contact: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  device_kind: z.enum(["phone", "gps_tracker", "satellite_tracker"]),
  device_id: z.string().trim().max(64).nullable().optional(),
  silent_after_minutes: z.number().int().min(1).max(1440),
  checkin_every_minutes: z.number().int().min(5).max(1440).nullable().optional(),
  stop_alert_minutes: z.number().int().min(5).max(720).nullable().optional(),
});

export const saveMovementSubject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => subjectInput.parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const row = {
      kind: data.kind,
      category: data.category,
      name: data.name,
      reference: data.reference || null,
      mmsi: data.kind === "vessel" ? data.mmsi || null : null,
      phone: data.phone || null,
      emergency_contact: data.emergency_contact || null,
      notes: data.notes || null,
      device_kind: data.device_kind,
      device_id: data.device_id || null,
      silent_after_minutes: data.silent_after_minutes,
      checkin_every_minutes: data.checkin_every_minutes ?? null,
      stop_alert_minutes: data.stop_alert_minutes ?? null,
    };
    const q = data.id
      ? sb(context).from("movement_subjects").update(row).eq("id", data.id).eq("organisation_id", orgId).select("id").single()
      : sb(context).from("movement_subjects").insert({ ...row, organisation_id: orgId, created_by: context.userId }).select("id").single();
    const { data: saved, error } = await q;
    if (error) throwSafeError("movement.save", error, error.code === "23505" ? "Another tracker already uses that device ID." : "Unable to save. Only managers and client admins can add people or assets.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "movement_subject", resourceId: saved.id, actionType: data.id ? "update" : "create", actionDetail: { name: data.name, kind: data.kind } });
    return { id: saved.id as string };
  });

export const setMovementConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["granted", "withdrawn"]),
      note: z.string().trim().min(3, "Say how consent was given").max(500),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const patch: Record<string, unknown> = {
      consent_status: data.status,
      consent_note: data.note,
      consent_recorded_at: new Date().toISOString(),
      consent_recorded_by: context.userId,
    };
    if (data.status === "withdrawn") Object.assign(patch, { tracking_enabled: false, state: "idle" });
    const { error } = await sb(context).from("movement_subjects").update(patch).eq("id", data.id).eq("organisation_id", orgId);
    if (error) throwSafeError("movement.consent", error, "Unable to record consent.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "movement_subject", resourceId: data.id, actionType: `consent_${data.status}`, actionDetail: { note: data.note } });
    return { ok: true };
  });

export const setMovementTracking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), enabled: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { error } = await sb(context)
      .from("movement_subjects")
      .update(data.enabled ? { tracking_enabled: true, tracking_started_at: new Date().toISOString(), checkin_overdue: false, stop_alerted: false, stopped_since: null } : { tracking_enabled: false, state: "idle" })
      .eq("id", data.id)
      .eq("organisation_id", orgId);
    if (error) throwSafeError("movement.tracking", error, data.enabled ? "Tracking can only be switched on after consent is recorded." : "Unable to switch tracking off.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "movement_subject", resourceId: data.id, actionType: data.enabled ? "tracking_on" : "tracking_off", actionDetail: {} });
    return { ok: true };
  });

export const newTrackerLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
    const { error } = await sb(context).from("movement_subjects").update({ tracker_token: token }).eq("id", data.id).eq("organisation_id", orgId);
    if (error) throwSafeError("movement.token", error, "Unable to make a new tracker link.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "movement_subject", resourceId: data.id, actionType: "tracker_link_rotated", actionDetail: {} });
    return { token };
  });

export const deleteMovementSubject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { error } = await sb(context).from("movement_subjects").delete().eq("id", data.id).eq("organisation_id", orgId);
    if (error) throwSafeError("movement.delete", error, "Unable to remove. Only managers and client admins can do this.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "movement_subject", resourceId: data.id, actionType: "delete", actionDetail: {} });
    return { ok: true };
  });

// ---------- Zones ----------

export const listMovementGeofences = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MovementGeofence[]> => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { data, error } = await sb(context).from("movement_geofences").select("id, name, kind, center_lat, center_lng, radius_m, alert_on, subject_ids, active").eq("organisation_id", orgId).order("name");
    if (error) throwSafeError("movement.zones", error, "Unable to load zones.");
    return (data ?? []) as MovementGeofence[];
  });

export const saveMovementGeofence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      name: z.string().trim().min(1).max(120),
      kind: z.enum(["safe", "restricted", "exclusion"]),
      center_lat: z.number().min(-90).max(90),
      center_lng: z.number().min(-180).max(180),
      radius_m: z.number().int().min(20).max(100_000),
      alert_on: z.enum(["enter", "exit", "both"]),
      subject_ids: z.array(z.string().uuid()).nullable(),
      active: z.boolean(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { id, ...row } = data;
    const q = id
      ? sb(context).from("movement_geofences").update(row).eq("id", id).eq("organisation_id", orgId).select("id").single()
      : sb(context).from("movement_geofences").insert({ ...row, organisation_id: orgId, created_by: context.userId }).select("id").single();
    const { data: saved, error } = await q;
    if (error) throwSafeError("movement.zone.save", error, "Unable to save the zone.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "movement_geofence", resourceId: saved.id, actionType: id ? "update" : "create", actionDetail: { name: data.name, kind: data.kind, radius_m: data.radius_m } });
    return { id: saved.id as string };
  });

export const deleteMovementGeofence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { error } = await sb(context).from("movement_geofences").delete().eq("id", data.id).eq("organisation_id", orgId);
    if (error) throwSafeError("movement.zone.delete", error, "Unable to delete the zone.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "movement_geofence", resourceId: data.id, actionType: "delete", actionDetail: {} });
    return { ok: true };
  });

// ---------- Alerts and trails ----------

export const listMovementAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MovementAlert[]> => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
    const { data, error } = await sb(context)
      .from("movement_alerts")
      .select("id, subject_id, geofence_id, voyage_id, kind, severity, message, lat, lng, acknowledged_at, created_at")
      .eq("organisation_id", orgId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throwSafeError("movement.alerts", error, "Unable to load movement alerts.");
    return (data ?? []) as MovementAlert[];
  });

export const acknowledgeMovementAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { data: row, error } = await sb(context)
      .from("movement_alerts")
      .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: context.userId })
      .eq("id", data.id)
      .eq("organisation_id", orgId)
      .is("acknowledged_at", null)
      .select("subject_id, kind")
      .maybeSingle();
    if (error) throwSafeError("movement.ack", error, "Unable to acknowledge.");
    // Clearing the last open SOS takes the subject out of SOS state.
    if (row?.kind === "sos" || row?.kind === "man_overboard") {
      const { count } = await sb(context).from("movement_alerts").select("id", { count: "exact", head: true }).eq("subject_id", row.subject_id).in("kind", ["sos", "man_overboard"]).is("acknowledged_at", null);
      if (!count) await sb(context).from("movement_subjects").update({ state: "stopped" }).eq("id", row.subject_id).eq("state", "sos");
    }
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "movement_alert", resourceId: data.id, actionType: "acknowledge", actionDetail: {} });
    return { ok: true };
  });

export const getMovementTrail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ subject_id: z.string().uuid(), hours: z.number().int().min(1).max(72).default(6) }).parse(d))
  .handler(async ({ data, context }) => {
    const since = new Date(Date.now() - data.hours * 3600_000).toISOString();
    const { data: subj, error: sErr } = await sb(context).from("movement_subjects").select("kind").eq("id", data.subject_id).maybeSingle();
    if (sErr || !subj) throwSafeError("movement.trail", sErr ?? new Error("not found"), "Unable to load the trail.");
    const { data: rows, error } = await sb(context)
      .from("movement_positions")
      .select("lat, lng, accuracy_m, recorded_at")
      .eq("subject_id", data.subject_id)
      .gte("recorded_at", since)
      .order("recorded_at", { ascending: true })
      .limit(2000);
    if (error) throwSafeError("movement.trail", error, "Unable to load the trail.");
    const raw = ((rows ?? []) as { lat: number; lng: number; accuracy_m: number | null }[])
      .filter((r) => r.accuracy_m == null || r.accuracy_m <= 100)
      .map((r) => [r.lng, r.lat] as [number, number]);
    // Boats don't follow roads, so only people and vehicles are snapped.
    let snapped: [number, number][] | null = null;
    if (subj.kind !== "vessel" && raw.length >= 3) {
      const { mapboxMatchTrail } = await import("./mapbox.server");
      snapped = await mapboxMatchTrail(raw, subj.kind === "vehicle" ? "driving" : "walking");
    }
    return { raw, snapped, points: raw.length };
  });

// ---------- Tracker (no login: authorised by the subject's secret link) ----------

export const getTrackerInfo = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: z.string().regex(/^[0-9a-f]{32}$/i) }).parse(d))
  .handler(async ({ data }) => {
    const { subjectByToken } = await import("./movement.server");
    const s = await subjectByToken(data.token);
    if (!s) return { found: false as const };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: org } = await (supabaseAdmin as any).from("organisations").select("name").eq("id", s.organisation_id).maybeSingle();
    return {
      found: true as const,
      name: s.name,
      kind: s.kind,
      organisation: (org?.name as string) ?? "your security team",
      consent: s.consent_status,
      tracking: s.tracking_enabled,
      sos: s.state === "sos",
      checkin_every_minutes: s.checkin_every_minutes,
      last_checkin_at: s.last_checkin_at,
    };
  });

export const reportTrackerFix = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      token: z.string().regex(/^[0-9a-f]{32}$/i),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      accuracy_m: z.number().min(0).max(100_000).nullable().optional(),
      speed_mps: z.number().min(0).max(400).nullable().optional(),
      heading: z.number().min(0).max(360).nullable().optional(),
      battery: z.number().int().min(0).max(100).nullable().optional(),
      sos: z.boolean().optional(),
      event: z.enum(["position", "sos", "man_overboard", "checkin"]).optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { subjectByToken, ingestFix } = await import("./movement.server");
    const s = await subjectByToken(data.token);
    if (!s) return { ok: false, reason: "This tracker link isn't valid any more. Ask your security team for a new one." };
    return ingestFix(s, data, "phone", data.event ?? (data.sos ? "sos" : "position"));
  });

/** "All OK" from the crew's phone before it has a GPS fix. */
export const trackerCheckIn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: z.string().regex(/^[0-9a-f]{32}$/i) }).parse(d))
  .handler(async ({ data }) => {
    const { subjectByToken, checkInWithoutFix } = await import("./movement.server");
    const s = await subjectByToken(data.token);
    if (!s) return { ok: false, reason: "This tracker link isn't valid any more. Ask your security team for a new one." };
    return checkInWithoutFix(s);
  });
