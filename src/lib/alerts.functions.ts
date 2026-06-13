import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { throwSafeError } from "@/lib/server-errors";
import { getActiveOrgId } from "@/lib/orgs.server";

export const listAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("alerts").select("*")
      .eq("organisation_id", orgId)
      .order("sent_at", { ascending: false })
      .limit(200);
    if (error) throwSafeError("alerts.list", error, "Unable to load alerts.");
    const ids = (data ?? []).map((a) => a.id);
    let readSet = new Set<string>();
    if (ids.length) {
      const { data: reads } = await context.supabase
        .from("notification_reads").select("alert_id").in("alert_id", ids).eq("user_id", context.userId);
      readSet = new Set((reads ?? []).map((r) => r.alert_id as string));
    }
    return (data ?? []).map((a) => ({ ...a, read: readSet.has(a.id) }));
  });

export const listMyNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("alerts").select("id, title, body, severity, alert_type, sent_at, incident_id, recipient_user_ids")
      .eq("organisation_id", orgId)
      .order("sent_at", { ascending: false })
      .limit(40);
    if (error) throwSafeError("alerts.mine", error, "Unable to load notifications.");
    const mine = (data ?? []).filter(
      (a) => !a.recipient_user_ids || a.recipient_user_ids.length === 0 || (a.recipient_user_ids as string[]).includes(context.userId),
    );
    const ids = mine.map((a) => a.id);
    let readSet = new Set<string>();
    if (ids.length) {
      const { data: reads } = await context.supabase
        .from("notification_reads").select("alert_id").in("alert_id", ids).eq("user_id", context.userId);
      readSet = new Set((reads ?? []).map((r) => r.alert_id as string));
    }
    return mine.map((a) => ({ ...a, read: readSet.has(a.id) }));
  });

export const markNotificationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ alert_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("notification_reads")
      .upsert({ alert_id: data.alert_id, user_id: context.userId }, { onConflict: "alert_id,user_id" });
    if (error) throwSafeError("alerts.read", error, "Unable to mark as read.");
    return { ok: true };
  });

export const markAllNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { data: alerts } = await context.supabase
      .from("alerts").select("id").eq("organisation_id", orgId).limit(200);
    const rows = (alerts ?? []).map((a) => ({ alert_id: a.id, user_id: context.userId }));
    if (!rows.length) return { ok: true };
    const { error } = await context.supabase
      .from("notification_reads").upsert(rows, { onConflict: "alert_id,user_id" });
    if (error) throwSafeError("alerts.readAll", error, "Unable to mark all read.");
    return { ok: true };
  });

const prefsInput = z.object({
  enabled_types: z.array(z.string().max(40)).max(20),
  channel_map: z.record(z.string().max(40), z.array(z.string().max(16)).max(5)),
  quiet_hours: z.object({
    enabled: z.boolean(),
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
  }),
  extra_recipients: z.array(z.object({
    label: z.string().max(80),
    phone: z.string().max(40),
    channels: z.array(z.string().max(16)).max(4),
    severity_floor: z.number().int().min(1).max(5),
  })).max(20),
  language: z.enum(["en", "pcm"]),
});

export const getAlertPreferences = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { data } = await context.supabase
      .from("alert_preferences").select("*").eq("organisation_id", orgId).maybeSingle();
    return data ?? {
      organisation_id: orgId,
      enabled_types: [
        "incident_critical","incident_high","incident_assigned",
        "missed_checkin","prolonged_missed","shift_start","shift_handover",
        "daily_summary","weekly_brief","osint_threat","sos",
      ],
      channel_map: {},
      quiet_hours: { enabled: true, start: "23:00", end: "06:00" },
      extra_recipients: [],
      language: "en",
    };
  });

export const updateAlertPreferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => prefsInput.parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("alert_preferences")
      .upsert({ organisation_id: orgId, ...data, updated_at: new Date().toISOString() }, { onConflict: "organisation_id" });
    if (error) throwSafeError("alerts.prefs", error, "Unable to save preferences. Check your access.");
    return { ok: true };
  });

export const sendTestAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { error } = await context.supabase.from("alerts").insert({
      title: "LEMTIK TEST — System check",
      body: "This is a test notification to verify the alerting pipeline.",
      action: "No action required",
      channel: "in-app",
      channels: ["in-app"],
      severity: 2,
      recipients: 1,
      organisation_id: orgId,
      alert_type: "system_test",
      status: "delivered",
      delivered_count: 1,
      recipient_user_ids: [context.userId],
    });
    if (error) throwSafeError("alerts.test", error, "Unable to send test alert.");
    return { ok: true };
  });
