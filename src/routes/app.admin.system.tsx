import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import type { ComponentType, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getPlatformSystemHealth, requestPlatformServiceRestart } from "@/lib/platform.system.functions";
import { resolveAppAccess, requireSectionAccess } from "@/lib/rbac";
import {
  Activity,
  CircleAlert,
  Cpu,
  Database,
  Loader2,
  MessageSquareMore,
  RefreshCw,
  Zap,
  ShieldCheck,
  Wifi,
  WifiOff,
  ServerCrash,
  TriangleAlert,
} from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export const Route = createFileRoute("/app/admin/system")({
  head: () => ({ meta: [{ title: "System health · Lemtik Admin" }] }),
  beforeLoad: async () => {
    const access = await resolveAppAccess(supabase);
    requireSectionAccess(access, ["lemtik_admin"]);
    return { appAccess: access };
  },
  component: SystemHealthPage,
});

function SystemHealthPage() {
  const loadHealth = useServerFn(getPlatformSystemHealth);
  const restartService = useServerFn(requestPlatformServiceRestart);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["platform-system-health"],
    queryFn: () => loadHealth(),
    refetchInterval: 30_000,
  });

  const restartMut = useMutation({
    mutationFn: (service_slug: string) => restartService({ data: { service_slug } }),
    onSuccess: () => refetch(),
  });

  const services = data?.services ?? [];
  const responseSeries = data?.responseSeries ?? [];
  const database = data?.database;
  const broker = data?.broker;
  const integrations = data?.integrations ?? [];
  const recentEvents = data?.recentEvents ?? [];

  const serviceStats = useMemo(() => {
    const online = services.filter((service) => service.status === "online").length;
    const degraded = services.filter((service) => service.status === "degraded").length;
    const offline = services.filter((service) => service.status === "offline").length;
    const totalErrors = services.reduce((sum, service) => sum + Number(service.error_count_24h ?? 0), 0);
    return { online, degraded, offline, totalErrors };
  }, [services]);

  const dbTone = database?.status === "online" ? "resolved" : database?.status === "warning" ? "warning" : "critical";
  const brokerTone = broker?.emqx.status === "online" ? "resolved" : "critical";
  const redisTone = broker?.redis.status === "online" ? "resolved" : "critical";

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-white/10 bg-white/5 p-5">
        <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Admin Console</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">System health</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-300">
          Live platform infrastructure view for <code className="rounded bg-white/10 px-1 py-0.5 text-[0.95em]">lemtik_admin</code>. Service state comes from platform records, and database health is read from a Supabase health RPC.
        </p>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Online services" value={services.length ? serviceStats.online.toString() : "—"} icon={ShieldCheck} tone="resolved" />
        <Stat label="Degraded/offline" value={services.length ? `${serviceStats.degraded + serviceStats.offline}` : "—"} icon={TriangleAlert} tone="critical" />
        <Stat label="Service errors 24h" value={services.length ? serviceStats.totalErrors.toString() : "—"} icon={Zap} tone="warning" />
        <Stat label="DB utilisation" value={database ? `${database.utilisationPct}%` : "—"} icon={Database} tone={dbTone} />
      </div>

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-3xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Render services</div>
              <h2 className="text-lg font-semibold">Real-time service health and response trend</h2>
            </div>
            <button
              onClick={() => refetch()}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs hover:bg-surface-2"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>

          <div className="mt-4 h-72 rounded-2xl border border-border bg-surface p-3">
            {isLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading service trend…
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={responseSeries} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
                  <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => `${v}ms`} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value) => [`${Number(value).toLocaleString("en-NG")} ms`, "Avg response"]} />
                  <Line type="monotone" dataKey="response_ms" stroke="var(--primary)" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {services.map((service) => (
              <div key={service.id} className="rounded-2xl border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{service.name}</div>
                    <div className="mt-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{service.status}</div>
                  </div>
                  <StatusPill tone={service.statusTone as "resolved" | "warning" | "critical"}>{service.status.toUpperCase()}</StatusPill>
                </div>

                <div className="mt-3 grid gap-1.5 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between gap-3">
                    <span>Last activity</span>
                    <span>{service.last_activity_label}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Last collection</span>
                    <span>{service.last_collection_label}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Collected today</span>
                    <span>{service.items_collected_today}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Errors 24h</span>
                    <span className={Number(service.error_count_24h ?? 0) > 0 ? "text-critical" : "text-foreground"}>{service.error_count_24h}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Response estimate</span>
                    <span>{service.response_ms} ms</span>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {service.render_url && (
                    <a
                      href={service.render_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-background"
                    >
                      Render URL <MessageSquareMore className="h-3.5 w-3.5" />
                    </a>
                  )}
                  <button
                    onClick={() => {
                      const ok = window.confirm(`Request a restart for ${service.name}? This records the action in the platform audit log.`);
                      if (!ok) return;
                      restartMut.mutate(service.slug);
                    }}
                    disabled={restartMut.isPending}
                    className="inline-flex items-center gap-1 rounded-md border border-critical/30 bg-critical/10 px-2.5 py-1 text-xs text-critical hover:bg-critical/15 disabled:opacity-50"
                  >
                    <ServerCrash className="h-3.5 w-3.5" />
                    Restart trigger
                  </button>
                </div>
              </div>
            ))}

            {services.length === 0 && (
              <div className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted-foreground">
                No platform services were returned.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <Card title="Supabase database health" icon={Database} tone={dbTone}>
            <div className="space-y-3 text-sm">
              <MetricRow label="Active connections" value={database ? `${database.activeConnections}/${database.maxConnections}` : "—"} />
              <MetricRow label="Idle connections" value={database ? database.idleConnections.toString() : "—"} />
              <MetricRow label="Long-running queries" value={database ? database.longRunningQueries.toString() : "—"} />
              <MetricRow label="Storage usage" value={database ? `${database.databaseSizeMb.toLocaleString("en-NG")} MB` : "—"} />
              <div className="rounded-2xl border border-border bg-surface p-3">
                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>Connection pool usage</span>
                  <span>{database ? `${database.utilisationPct}%` : "—"}</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-muted">
                  <div
                    className={`h-2 rounded-full ${dbTone === "critical" ? "bg-critical" : dbTone === "warning" ? "bg-high" : "bg-resolved"}`}
                    style={{ width: `${Math.min(100, database?.utilisationPct ?? 0)}%` }}
                  />
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Checked {database?.checkedAt ? new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(database.checkedAt)) : "—"}
                </div>
              </div>
            </div>
          </Card>

          <Card title="EMQX MQTT broker" icon={broker?.emqx.status === "online" ? Wifi : WifiOff} tone={brokerTone}>
            <div className="space-y-3 text-sm">
              <MetricRow label="Connected devices" value={broker?.emqx.connectedDevices.toLocaleString("en-NG") ?? "—"} />
              <MetricRow label="Messages / sec" value={broker?.emqx.messagesPerSecond.toLocaleString("en-NG") ?? "—"} />
              <MetricRow label="Broker health" value={broker?.emqx.status?.toUpperCase() ?? "—"} />
              <div className="rounded-2xl border border-border bg-surface p-3 text-xs text-muted-foreground">
                {broker?.emqx.configured ? broker?.emqx.brokerUrl ?? "Broker endpoint configured." : "EMQX is not configured in the current environment."}
              </div>
            </div>
          </Card>

          <Card title="Upstash Redis" icon={Cpu} tone={redisTone}>
            <div className="space-y-3 text-sm">
              <MetricRow label="Memory usage" value={broker?.redis.memoryUsageMb.toLocaleString("en-NG") ?? "—"} suffix="MB" />
              <MetricRow label="Commands / sec" value={broker?.redis.commandsPerSecond.toLocaleString("en-NG") ?? "—"} />
              <MetricRow label="Cache hit rate" value={broker?.redis.cacheHitRate != null ? `${broker.redis.cacheHitRate}%` : "—"} />
              <div className="rounded-2xl border border-border bg-surface p-3 text-xs text-muted-foreground">
                {broker?.redis.configured ? broker?.redis.redisUrl ?? "Redis endpoint configured." : "Upstash Redis is not configured in the current environment."}
              </div>
            </div>
          </Card>

          <Card title="Third-party integrations" icon={Activity} tone="muted">
            <div className="space-y-3">
              {integrations.map((integration) => (
                <div key={integration.key} className="rounded-2xl border border-border bg-surface p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{integration.name}</div>
                      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{integration.status}</div>
                    </div>
                    <StatusPill tone={integration.status === "online" ? "resolved" : "critical"}>{integration.status.toUpperCase()}</StatusPill>
                  </div>
                  <div className="mt-3 grid gap-1.5 text-xs text-muted-foreground">
                    <div className="flex items-center justify-between gap-3">
                      <span>{integration.metricLabel}</span>
                      <span className="font-medium text-foreground">{integration.metricValueLabel} {integration.metricValue == null ? "" : integration.quotaLabel}</span>
                    </div>
                    <div>{integration.note}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Recent platform events" icon={CircleAlert} tone="muted">
            <div className="space-y-3">
              {recentEvents.slice(0, 6).map((event) => (
                <div key={event.id} className="rounded-2xl border border-border bg-surface p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">{event.organisation_name}</div>
                      <div className="text-xs text-muted-foreground">{event.summary}</div>
                    </div>
                    <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{event.when}</div>
                  </div>
                </div>
              ))}
              {recentEvents.length === 0 && <div className="text-sm text-muted-foreground">No recent platform events.</div>}
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
}

function Card({
  title,
  icon: Icon,
  tone,
  children,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  tone: "resolved" | "warning" | "critical" | "muted";
  children: ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{title}</div>
        </div>
        <StatusPill tone={tone}>
          <Icon className="h-3.5 w-3.5" />
        </StatusPill>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function MetricRow({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
      <span className="font-medium">{value}{suffix ? ` ${suffix}` : ""}</span>
    </div>
  );
}

function StatusPill({
  tone,
  children,
}: {
  tone: "resolved" | "warning" | "critical" | "muted";
  children: ReactNode;
}) {
  const toneClass =
    tone === "resolved"
      ? "border-resolved/30 bg-resolved/10 text-resolved"
      : tone === "warning"
        ? "border-high/30 bg-high/10 text-high"
        : tone === "critical"
          ? "border-critical/30 bg-critical/10 text-critical"
          : "border-border bg-surface text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${toneClass}`}>
      {children}
    </span>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  tone = "muted",
}: {
  label: string;
  value: string;
  icon: ComponentType<{ className?: string }>;
  tone?: "resolved" | "warning" | "critical" | "muted";
}) {
  const toneClass =
    tone === "resolved"
      ? "border-resolved/30 bg-resolved/10 text-resolved"
      : tone === "warning"
        ? "border-high/30 bg-high/10 text-high"
        : tone === "critical"
          ? "border-critical/30 bg-critical/10 text-critical"
          : "border-border bg-card";
  return (
    <div className={`rounded-3xl border p-4 ${toneClass}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.18em] opacity-80">{label}</div>
        <Icon className="h-4 w-4 opacity-80" />
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}
