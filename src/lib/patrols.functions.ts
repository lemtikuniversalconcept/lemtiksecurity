import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { throwSafeError } from "@/lib/server-errors";
import { recordAuditEvent } from "@/lib/audit.server";
import { getActiveOrgId } from "@/lib/orgs.server";
import { requestRelationshipApi } from "@/lib/relationship-api";

export const listPatrols = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("patrols").select("*")
      .eq("organisation_id", orgId)
      .order("code", { ascending: true });
    if (error) throwSafeError("patrols.list", error, "Unable to load patrols.");
    return data;
  });

export const getPatrol = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const [p, w] = await Promise.all([
      context.supabase.from("patrols").select("*").eq("id", data.id).eq("organisation_id", orgId).maybeSingle(),
      context.supabase.from("patrol_waypoints" as any).select("*").eq("patrol_id", data.id).order("ord", { ascending: true }),
    ]);
    if (p.error) throwSafeError("patrols.get", p.error, "Unable to load patrol.");
    if (!p.data) throwSafeError("patrols.get", new Error("not found"), "Patrol not found.");
    return { patrol: p.data, waypoints: w.data ?? [] };
  });

export const createPatrol = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      code: z.string().min(1).max(20),
      name: z.string().min(1).max(120),
      officer: z.string().min(1).max(120),
      shift: z.string().min(1).max(60),
      waypoints: z.number().int().min(1).max(50),
      location_id: z.string().uuid().nullable().optional(),
      total_duration_minutes: z.number().int().min(5).max(720).optional(),
      grace_period_minutes: z.number().int().min(1).max(60).optional(),
      checkin_method: z.enum(["gps", "qr", "nfc"]).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { error, data: row } = await context.supabase
      .from("patrols")
      .insert({ ...data, checked_in: 0, status: "on_route", organisation_id: orgId })
      .select().single();
    if (error) throwSafeError("patrols.create", error, "Access denied or unable to create patrol.");
    await recordAuditEvent({
      actorId: context.userId, organisationId: orgId,
      entity: "patrol", entityId: row.id, action: "create",
      details: { code: row.code, name: row.name },
    });
    return row;
  });

export const updatePatrolDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(120).optional(),
      officer: z.string().min(1).max(120).optional(),
      shift: z.string().min(1).max(60).optional(),
      total_duration_minutes: z.number().int().min(5).max(720).optional(),
      grace_period_minutes: z.number().int().min(1).max(60).optional(),
      checkin_method: z.enum(["gps", "qr", "nfc"]).optional(),
      location_id: z.string().uuid().nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase.from("patrols").update(patch).eq("id", id);
    if (error) throwSafeError("patrols.updateDetails", error, "Unable to update patrol.");
    return { ok: true };
  });

export const archivePatrol = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), archived: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("patrols")
      .update({ archived_at: data.archived ? new Date().toISOString() : null })
      .eq("id", data.id);
    if (error) throwSafeError("patrols.archive", error, "Unable to archive patrol.");
    return { ok: true };
  });

export const duplicatePatrol = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { data: src, error: e1 } = await context.supabase
      .from("patrols").select("*").eq("id", data.id).single();
    if (e1) throwSafeError("patrols.dup.load", e1, "Unable to load source patrol.");
    const { data: wps } = await context.supabase
      .from("patrol_waypoints" as any).select("*").eq("patrol_id", data.id).order("ord");
    const newCode = `${src.code}-COPY-${Math.floor(Math.random()*900+100)}`;
    const { data: created, error: e2 } = await context.supabase
      .from("patrols").insert({
        code: newCode.slice(0, 20),
        name: `${src.name} (Copy)`.slice(0, 120),
        officer: src.officer, shift: src.shift,
        waypoints: src.waypoints, checked_in: 0, status: "on_route",
        organisation_id: orgId, location_id: src.location_id,
        total_duration_minutes: src.total_duration_minutes,
        grace_period_minutes: src.grace_period_minutes,
        checkin_method: src.checkin_method,
      }).select().single();
    if (e2) throwSafeError("patrols.dup.create", e2, "Unable to duplicate patrol.");
    if (wps && wps.length) {
      const clone = wps.map((w: any) => ({
        patrol_id: created.id, organisation_id: orgId,
        ord: w.ord, name: w.name, coord_x: w.coord_x, coord_y: w.coord_y,
        expected_minutes: w.expected_minutes,
      }));
      await context.supabase.from("patrol_waypoints" as any).insert(clone);
    }
    return created;
  });

// ---- Waypoints ----
const wpItem = z.object({
  id: z.string().uuid().optional(),
  ord: z.number().int().min(0).max(50),
  name: z.string().min(1).max(120),
  coord_x: z.number().nullable().optional(),
  coord_y: z.number().nullable().optional(),
  expected_minutes: z.number().int().min(1).max(120),
});

export const saveWaypoints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ patrol_id: z.string().uuid(), waypoints: z.array(wpItem).max(50) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    // Replace strategy: delete + insert
    const del = await context.supabase.from("patrol_waypoints" as any).delete().eq("patrol_id", data.patrol_id);
    if (del.error) throwSafeError("wp.del", del.error, "Unable to update waypoints.");
    if (data.waypoints.length) {
      const rows = data.waypoints.map((w, i) => ({
        patrol_id: data.patrol_id, organisation_id: orgId,
        ord: i, name: w.name, coord_x: w.coord_x ?? null, coord_y: w.coord_y ?? null,
        expected_minutes: w.expected_minutes,
      }));
      const ins = await context.supabase.from("patrol_waypoints" as any).insert(rows);
      if (ins.error) throwSafeError("wp.ins", ins.error, "Unable to save waypoints.");
    }
    // sync count on patrol
    await context.supabase.from("patrols")
      .update({ waypoints: data.waypoints.length })
      .eq("id", data.patrol_id);
    return { ok: true, count: data.waypoints.length };
  });

// ---- Shifts ----
export const listShifts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ patrol_id: z.string().uuid().optional(), from: z.string().datetime().optional(), to: z.string().datetime().optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    let q = context.supabase.from("patrol_shifts" as any).select("*").eq("organisation_id", orgId);
    if (data.patrol_id) q = q.eq("patrol_id", data.patrol_id);
    if (data.from) q = q.gte("scheduled_start", data.from);
    if (data.to) q = q.lte("scheduled_start", data.to);
    const { data: rows, error } = await q.order("scheduled_start", { ascending: true });
    if (error) throwSafeError("shifts.list", error, "Unable to load shifts.");
    return rows ?? [];
  });

export const scheduleShift = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      patrol_id: z.string().uuid(),
      officer_id: z.string().uuid().nullable().optional(),
      backup_officer_id: z.string().uuid().nullable().optional(),
      officer_name: z.string().min(1).max(120),
      scheduled_start: z.string().datetime(),
      scheduled_end: z.string().datetime(),
      repeat_days: z.number().int().min(1).max(30).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const days = data.repeat_days ?? 1;
    const rows = Array.from({ length: days }).map((_, i) => {
      const startMs = new Date(data.scheduled_start).getTime() + i * 86_400_000;
      const endMs = new Date(data.scheduled_end).getTime() + i * 86_400_000;
      return {
        patrol_id: data.patrol_id, organisation_id: orgId,
        officer_id: data.officer_id ?? null, backup_officer_id: data.backup_officer_id ?? null,
        officer_name: data.officer_name,
        scheduled_start: new Date(startMs).toISOString(),
        scheduled_end: new Date(endMs).toISOString(),
        status: "scheduled",
      };
    });
    const { error, data: inserted } = await context.supabase.from("patrol_shifts" as any).insert(rows).select();
    if (error) throwSafeError("shifts.schedule", error, "Unable to schedule shift.");
    return inserted;
  });

export const updateShift = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["scheduled", "active", "completed", "cancelled"]).optional(),
      handover_notes: z.string().max(2000).optional(),
      start: z.boolean().optional(),
      end: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {};
    if (data.status) patch.status = data.status;
    if (data.handover_notes !== undefined) patch.handover_notes = data.handover_notes;
    if (data.start) { patch.started_at = new Date().toISOString(); patch.status = "active"; }
    if (data.end) { patch.ended_at = new Date().toISOString(); patch.status = "completed"; }
    patch.updated_at = new Date().toISOString();
    const { error } = await context.supabase.from("patrol_shifts" as any).update(patch).eq("id", data.id);
    if (error) throwSafeError("shifts.update", error, "Unable to update shift.");
    return { ok: true };
  });

// ---- Check-ins ----
function approximateMeters(a: [number, number], b: [number, number]) {
  const lngMeters = (b[0] - a[0]) * 111_320 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
  const latMeters = (b[1] - a[1]) * 110_540;
  return Math.hypot(lngMeters, latMeters);
}

export const listCheckIns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ shift_id: z.string().uuid().optional(), patrol_id: z.string().uuid().optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    let q = context.supabase.from("patrol_check_ins" as any).select("*").eq("organisation_id", orgId);
    if (data.shift_id) q = q.eq("shift_id", data.shift_id);
    if (data.patrol_id) q = q.eq("patrol_id", data.patrol_id);
    const { data: rows, error } = await q.order("created_at", { ascending: false }).limit(200);
    if (error) throwSafeError("ci.list", error, "Unable to load check-ins.");
    return rows ?? [];
  });

export const recordCheckIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      shift_id: z.string().uuid(),
      waypoint_id: z.string().uuid(),
      method: z.enum(["gps", "qr", "nfc"]).default("gps"),
      coord_x: z.number().optional(),
      coord_y: z.number().optional(),
      qr_token: z.string().max(64).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { data: wpRaw, error: e1 } = await context.supabase
      .from("patrol_waypoints" as any).select("*").eq("id", data.waypoint_id).maybeSingle();
    if (e1 || !wpRaw) throwSafeError("ci.wp", e1 ?? new Error("nf"), "Waypoint not found.");
    const wp = wpRaw as any;
    const { data: shiftRaw, error: e2 } = await context.supabase
      .from("patrol_shifts" as any).select("*").eq("id", data.shift_id).maybeSingle();
    if (e2 || !shiftRaw) throwSafeError("ci.shift", e2 ?? new Error("nf"), "Shift not found.");
    const shift = shiftRaw as any;
    const { data: prof } = await context.supabase.from("profiles").select("display_name").eq("user_id", context.userId).maybeSingle();

    let distance: number | null = null;
    let status = "on_time";
    if (data.method === "gps" && wp.coord_x != null && wp.coord_y != null && data.coord_x != null && data.coord_y != null) {
      distance = approximateMeters([Number(wp.coord_x), Number(wp.coord_y)], [data.coord_x, data.coord_y]);
      if (distance > 50) status = "out_of_zone";
    }
    if (data.method === "qr" && data.qr_token !== wp.qr_token) {
      throwSafeError("ci.qr", new Error("bad token"), "QR code does not match this waypoint.");
    }

    const expectedAt = new Date(shift.scheduled_start).getTime() + (wp.ord + 1) * wp.expected_minutes * 60_000;
    const minutesLate = Math.max(0, Math.round((Date.now() - expectedAt) / 60_000));
    if (status === "on_time" && minutesLate > 0) status = "late";

    const { error: e3, data: row } = await context.supabase.from("patrol_check_ins" as any).insert({
      shift_id: data.shift_id, waypoint_id: data.waypoint_id,
      patrol_id: shift.patrol_id, organisation_id: orgId,
      officer_id: context.userId, officer_name: prof?.display_name ?? null,
      method: data.method,
      coord_x: data.coord_x ?? null, coord_y: data.coord_y ?? null,
      distance_m: distance, status, minutes_late: minutesLate,
    }).select().single();
    if (e3) throwSafeError("ci.ins", e3, "Unable to record check-in.");
    return row;
  });

export const sosAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      shift_id: z.string().uuid().optional(),
      coord_x: z.number().optional(),
      coord_y: z.number().optional(),
      note: z.string().max(280).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { data: prof } = await context.supabase.from("profiles").select("display_name").eq("user_id", context.userId).maybeSingle();
    const { data: recipients } = await context.supabase
      .from("organisation_members")
      .select("user_id, role")
      .eq("organisation_id", orgId)
      .in("role", ["supervisor", "manager", "client_admin", "lemtik_admin"]);
    const name = prof?.display_name ?? "Officer";
    const locationLabel = data.note?.trim() || (data.coord_x != null && data.coord_y != null ? "Officer live location" : "Officer emergency location");
    const coordsLabel = data.coord_x != null && data.coord_y != null
      ? ` @ ${data.coord_y.toFixed(5)},${data.coord_x.toFixed(5)}`
      : "";
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const incidentPayload = {
      organisation_id: orgId,
      reported_by: context.userId,
      type: "other",
      severity: 5,
      title: `SOS from ${name}`,
      location: locationLabel,
      zone: "Emergency",
      description: data.note ? `SOS trigger: ${data.note}` : "Officer triggered SOS emergency alert.",
      status: "reported",
      coord_x: data.coord_x ?? null,
      coord_y: data.coord_y ?? null,
      shift_id: data.shift_id ?? null,
      client_visible: true,
      quick_report: true,
      occurred_at: new Date().toISOString(),
      suspect_count: 0,
    };
    const { data: incident, error: incidentError } = await supabaseAdmin
      .from("incidents")
      .insert(incidentPayload)
      .select()
      .single();
    if (incidentError) throwSafeError("sos.incident", incidentError, "Unable to create SOS incident.");

    const recipientIds = Array.from(new Set((recipients ?? []).map((row) => row.user_id).filter(Boolean)));
    const { error: alertError, data: alert } = await supabaseAdmin.from("alerts").insert({
      severity: 5,
      channel: "push",
      channels: ["push", "in-app", "whatsapp", "sms"],
      title: `SOS from ${name}`,
      body: `Emergency alert${coordsLabel}. ${data.note ? `Note: ${data.note}` : "Immediate response required."}`,
      action: "Open incident",
      organisation_id: orgId,
      incident_id: incident.id,
      recipients: Math.max(recipientIds.length, 1),
      alert_type: "sos",
      status: "delivered",
      delivered_count: Math.max(recipientIds.length, 1),
      failed_count: 0,
      recipient_user_ids: recipientIds,
      acknowledged: false,
      language: "en",
    }).select().single();
    if (alertError) throwSafeError("sos.alert", alertError, "Unable to broadcast SOS.");

    const { error: activityError } = await supabaseAdmin.from("incident_activity").insert({
      incident_id: incident.id,
      organisation_id: orgId,
      actor_id: context.userId,
      actor_name: name,
      kind: "sos_triggered",
      message: `SOS triggered by ${name}${coordsLabel}.`,
      meta: {
        shift_id: data.shift_id ?? null,
        coord_x: data.coord_x ?? null,
        coord_y: data.coord_y ?? null,
        note: data.note ?? null,
        recipients: recipientIds,
      },
    });
    if (activityError) throwSafeError("sos.activity", activityError, "Unable to log SOS activity.");

    await recordAuditEvent({
      actorId: context.userId,
      organisationId: orgId,
      entity: "incident",
      entityId: incident.id,
      action: "sos_triggered",
      details: { alert_id: alert?.id ?? null, shift_id: data.shift_id ?? null, recipients: recipientIds.length },
    });

    return { incident, alert, recipients: recipientIds.length };
  });

// Existing waypoint check-in (legacy quick increment) kept for compatibility
export const checkInWaypoint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { data: cur, error: e1 } = await context.supabase
      .from("patrols").select("checked_in, waypoints, code").eq("id", data.id).single();
    if (e1) throwSafeError("patrols.checkIn.load", e1, "Unable to load patrol checkpoint.");
    const next = Math.min(cur.checked_in + 1, cur.waypoints);
    const status = next >= cur.waypoints ? "complete" : "on_route";
    const { error } = await context.supabase
      .from("patrols").update({ checked_in: next, status }).eq("id", data.id);
    if (error) throwSafeError("patrols.checkIn.update", error, "Access denied or unable to check in.");
    await recordAuditEvent({
      actorId: context.userId, organisationId: orgId,
      entity: "patrol", entityId: data.id,
      action: "check_in", details: { code: cur.code, checked_in: next, total: cur.waypoints },
    });
    return { ok: true, checked_in: next, status };
  });

export const updatePatrolStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["on_route", "delayed", "missed", "complete"]),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("patrols").update({ status: data.status }).eq("id", data.id);
    if (error) throwSafeError("patrols.updateStatus", error, "Access denied or unable to update patrol.");
    await recordAuditEvent({
      actorId: context.userId, organisationId: orgId,
      entity: "patrol", entityId: data.id,
      action: "status_change", details: { status: data.status },
    });
    return { ok: true };
  });

export const calculateRoute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      start: z.tuple([z.number(), z.number()]),
      destination: z.tuple([z.number(), z.number()]),
      mode: z.enum(["walking", "driving", "cycling"]).optional(),
      incident_id: z.string().uuid().optional(),
      org_id: z.string().uuid().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = data.org_id ?? await getActiveOrgId(context.supabase, context.userId);
    const result = await requestRelationshipApi<{
      geometry?: { coordinates?: [number, number][] };
      duration?: number;
      distance?: number;
      legs?: Array<{ steps?: Array<{ maneuver?: { instruction?: string }; distance?: number }> }>;
    }>("/api/v1/route/calculate", {
      body: {
        org_id: orgId,
        incident_id: data.incident_id ?? null,
        start: { lng: data.start[0], lat: data.start[1] },
        destination: { lng: data.destination[0], lat: data.destination[1] },
        mode: data.mode ?? "walking",
        source: "c4isod-dashboard",
      },
    });
    if (result) return result;

    const midpoint: [number, number] = [
      Number((data.start[0] + data.destination[0]) / 2),
      Number((data.start[1] + data.destination[1]) / 2),
    ];
    const routeDistance = Math.hypot(data.destination[0] - data.start[0], data.destination[1] - data.start[1]) * 111;
    return {
      geometry: { coordinates: [data.start, midpoint, data.destination] },
      distance: routeDistance * 1000,
      duration: Math.max(180, routeDistance * 75),
      legs: [{
        steps: [
          { maneuver: { instruction: "Proceed from the current position." }, distance: routeDistance * 400 },
          { maneuver: { instruction: "Continue on the safest available path." }, distance: routeDistance * 400 },
          { maneuver: { instruction: "Arrive at the destination and report to command." }, distance: routeDistance * 200 },
        ],
      }],
    };
  });
