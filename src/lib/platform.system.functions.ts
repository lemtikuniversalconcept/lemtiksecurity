import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recordBlackboxAudit } from "@/lib/audit.server";
import { throwSafeError } from "@/lib/server-errors";

async function assertPlatformAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "lemtik_admin")
    .maybeSingle();
  if (error) throwSafeError("system.admin.check", error, "Unable to verify platform admin access.");
  if (!data) throw new Error("Access denied.");
}

function toStatus(value?: string | null) {
  return value === "online" || value === "degraded" || value === "offline" ? value : "offline";
}


function envFlag(...names: string[]) {
  return names.some((name) => Boolean(process.env[name]?.trim()));
}

function envNumber(...names: string[]) {
  for (const name of names) {
    const raw = process.env[name];
    if (raw == null || raw.trim() === "") continue;
    const parsed = Number(raw);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

// Having credentials set says nothing about whether a service is up, so this reports
// configuration only.
function statusFromConfigured(configured: boolean, _healthy = true) {
  return configured ? "configured" : "not_configured";
}

function formatShortAgo(iso?: string | null) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export const getPlatformSystemHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context.supabase, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [servicesRes, eventsRes, inviteCountRes, dbHealthRes] = await Promise.all([
      context.supabase
        .from("platform_services")
        .select("id, slug, name, status, last_activity_at, last_collection_at, items_collected_today, error_count_24h, render_url, updated_at")
        .order("name"),
      context.supabase
        .from("platform_events")
        .select("id, organisation_name, event_type, summary, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(12),
      supabaseAdmin
        .from("user_invites")
        .select("id", { count: "exact", head: true })
        .gte("created_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
      supabaseAdmin.rpc("get_platform_db_health"),
    ]);

    if (servicesRes.error) throwSafeError("system.services", servicesRes.error, "Unable to load service health.");
    if (eventsRes.error) throwSafeError("system.events", eventsRes.error, "Unable to load platform events.");
    if (inviteCountRes.error) throwSafeError("system.invites", inviteCountRes.error, "Unable to load invite usage.");
    if (dbHealthRes.error) throwSafeError("system.db", dbHealthRes.error, "Unable to load database health.");

    const services = (servicesRes.data ?? []).map((service: any) => {
      const status = toStatus(service.status);
      return {
        ...service,
        status,
        statusTone: status === "online" ? "resolved" : status === "degraded" ? "warning" : "critical",
        last_activity_label: formatShortAgo(service.last_activity_at),
        last_collection_label: formatShortAgo(service.last_collection_at),
      };
    });

    const dbHealth = (dbHealthRes.data as any) ?? null;

    const emqxConfigured = envFlag("EMQX_URL", "EMQX_BROKER_URL", "EMQX_HOST");
    const redisConfigured = envFlag("UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_URL");
    const groqConfigured = envFlag("GROQ_API_KEY");
    const termiiConfigured = envFlag("TERMII_API_KEY");
    const twilioConfigured = envFlag("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN");
    const resendConfigured = envFlag("RESEND_API_KEY");
    const radarConfigured = envFlag("RADAR_API_KEY");
    const mapboxConfigured = envFlag("MAPBOX_PUBLIC_TOKEN", "VITE_MAPBOX_PUBLIC_TOKEN");

    const inviteUsage = inviteCountRes.count ?? 0;
    const integrations = [
      {
        key: "groq",
        name: "Groq API",
        status: statusFromConfigured(groqConfigured),
        configured: groqConfigured,
        metricLabel: "Daily token usage",
        metricValue: envNumber("GROQ_DAILY_TOKEN_USAGE", "GROQ_TOKENS_TODAY"),
        quotaLabel: "Tokens",
        note: groqConfigured ? "Model calls can be wired to a usage collector." : "API key not configured.",
      },
      {
        key: "termii",
        name: "Termii SMS",
        status: statusFromConfigured(termiiConfigured),
        configured: termiiConfigured,
        metricLabel: "Messages sent today",
        metricValue: envNumber("TERMII_MESSAGES_SENT_TODAY"),
        quotaLabel: "SMS",
        note: termiiConfigured ? "SMS channel is ready for dispatch." : "API key not configured.",
      },
      {
        key: "twilio",
        name: "Twilio WhatsApp",
        status: statusFromConfigured(twilioConfigured),
        configured: twilioConfigured,
        metricLabel: "Messages sent today",
        metricValue: envNumber("TWILIO_WHATSAPP_SENT_TODAY"),
        quotaLabel: "Messages",
        note: twilioConfigured ? "WhatsApp delivery is configured." : "Twilio credentials not configured.",
      },
      {
        key: "resend",
        name: "Resend Email",
        status: statusFromConfigured(resendConfigured),
        configured: resendConfigured,
        metricLabel: "Invites created today",
        metricValue: inviteUsage,
        quotaLabel: "",
        note: "Counted from invite records; not Resend's own quota.",
      },
      {
        key: "radar",
        name: "Radar.io",
        status: statusFromConfigured(radarConfigured),
        configured: radarConfigured,
        metricLabel: "API calls remaining",
        metricValue: envNumber("RADAR_API_CALLS_REMAINING"),
        quotaLabel: "Calls",
        note: radarConfigured ? "Geofencing API can be wired to live usage later." : "API key not configured.",
      },
      {
        key: "mapbox",
        name: "Mapbox",
        status: statusFromConfigured(mapboxConfigured),
        configured: mapboxConfigured,
        metricLabel: "Tile loads today",
        metricValue: envNumber("MAPBOX_TILE_LOADS_TODAY"),
        quotaLabel: "Tiles",
        note: mapboxConfigured ? "Token is available to the map surfaces." : "Token not configured.",
      },
    ].map((integration) => ({
      ...integration,
      metricValueLabel: integration.metricValue == null ? "not tracked" : integration.metricValue.toLocaleString("en-NG"),
    }));

    const brokerConfigured = emqxConfigured;
    const redisStatus = statusFromConfigured(redisConfigured);

    return {
      services,
      database: {
        status: dbHealth?.status ?? "offline",
        activeConnections: Number(dbHealth?.active_connections ?? 0),
        idleConnections: Number(dbHealth?.idle_connections ?? 0),
        maxConnections: Number(dbHealth?.max_connections ?? 0),
        utilisationPct: Number(dbHealth?.utilisation_pct ?? 0),
        longRunningQueries: Number(dbHealth?.long_running_queries ?? 0),
        databaseSizeMb: Number(dbHealth?.database_size_mb ?? 0),
        checkedAt: dbHealth?.checked_at ?? null,
      },
      broker: {
        emqx: {
          status: brokerConfigured ? "configured" : "not_configured",
          configured: brokerConfigured,
          // Not measured: these are only set if someone puts numbers in the environment.
          connectedDevices: envNumber("EMQX_CONNECTED_DEVICES"),
          messagesPerSecond: envNumber("EMQX_MESSAGES_PER_SEC"),
        },
        redis: {
          status: redisStatus,
          configured: redisConfigured,
          memoryUsageMb: envNumber("UPSTASH_REDIS_MEMORY_MB"),
          commandsPerSecond: envNumber("UPSTASH_REDIS_COMMANDS_PER_SEC"),
          cacheHitRate: envNumber("UPSTASH_REDIS_CACHE_HIT_RATE"),
          // Connection URLs can embed credentials, so they never leave the server.
        },
      },
      integrations,
      recentEvents: (eventsRes.data ?? []).map((event: any) => ({
        ...event,
        when: formatShortAgo(event.created_at),
      })),
    };
  });

export const requestPlatformServiceRestart = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ service_slug: z.string().min(1).max(100) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: service, error } = await context.supabase
      .from("platform_services")
      .select("id, slug, name")
      .eq("slug", data.service_slug)
      .maybeSingle();
    if (error) throwSafeError("system.restart.lookup", error, "Unable to locate the service.");
    if (!service) throw new Error("Service not found.");

    await recordBlackboxAudit({
      orgId: null,
      userId: context.userId,
      actionType: "service.restart_requested",
      resourceType: "platform_service",
      resourceId: service.id,
      actionDetail: {
        slug: service.slug,
        name: service.name,
        requested_at: new Date().toISOString(),
      } as any,
    });

    const { error: eventError } = await supabaseAdmin.from("platform_events").insert({
      organisation_id: null,
      organisation_name: "Lemtik Platform",
      event_type: "service.restart_requested",
      summary: `${service.name} — restart requested from admin console`,
      metadata: {
        service_slug: service.slug,
        service_name: service.name,
        requested_by: context.userId,
      },
    });
    if (eventError) throwSafeError("system.restart.event", eventError, "Unable to record the restart request event.");

    return { ok: true };
  });
