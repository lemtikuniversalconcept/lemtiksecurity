import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPlatformDashboard } from "@/lib/platform.functions";
import { weeklyTrend, zoneRisk, type Severity, type IncidentStatus } from "@/lib/mockData";
import { SeverityBadge } from "@/components/SeverityBadge";
import { ArrowUpRight, Activity, ShieldAlert, Clock, MapPin, Radar, Building2, Globe2, Server, CircleDotDashed, AlertTriangle, ReceiptText, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { resolveAppAccess, requireSectionAccess } from "@/lib/rbac";
import { CommanderDashboard } from "@/components/dashboard/CommanderDashboard";

export const Route = createFileRoute("/app/")({
  head: () => ({ meta: [{ title: "Overview · Lemtik SOD" }] }),
  beforeLoad: async () => {
    const access = await resolveAppAccess(supabase);
    if (access.specRole === "field_officer") {
      throw redirect({ to: "/officer/home" });
    }
    if (access.specRole !== "lemtik_admin") {
      requireSectionAccess(access, [
        "security_manager",
        "operator",
        "client_admin",
      ]);
    }
    return { appAccess: access };
  },
  component: Overview,
});

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function Overview() {
  const { appAccess } = Route.useRouteContext();
  if (appAccess.specRole === "lemtik_admin") {
    return <PlatformDashboard />;
  }
  return <CommanderDashboard access={appAccess} />;
}

function PlatformDashboard() {
  const loadPlatform = useServerFn(getPlatformDashboard);
  const { data, isLoading, error } = useQuery({
    queryKey: ["platform-dashboard"],
    queryFn: () => loadPlatform(),
  });

  const stats = data?.stats;

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-white/10 bg-white/5 p-5">
        <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Platform Dashboard</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Lemtik platform control</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-300">
          Bird&apos;s-eye view of the platform. This surface is limited to Lemtik internal administrators and excludes client operational detail.
        </p>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Total organisations" value={stats ? stats.totalOrganisations.toString() : "—"} delta="all clients" icon={Building2} tone="muted" />
        <StatCard label="Active subscriptions" value={stats ? stats.activeSubscriptions.toString() : "—"} delta="live plans" icon={ReceiptText} tone="resolved" />
        <StatCard label="Incidents 30d" value={stats ? stats.incidentsLast30Days.toString() : "—"} delta="all orgs" icon={AlertTriangle} tone="critical" />
        <StatCard label="Platform uptime" value={stats ? `${stats.uptime}%` : "—"} delta="service health" icon={Globe2} tone="resolved" />
        <StatCard label="Active services" value={stats ? stats.activeServices.toString() : "—"} delta="online now" icon={Server} tone="high" />
      </div>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Service health</div>
              <h2 className="mt-1 text-lg font-semibold">Render services panel</h2>
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white hover:bg-white/10"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>

          {isLoading ? (
            <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/40 p-6 text-sm text-slate-300">
              Loading platform health…
            </div>
          ) : error ? (
            <div className="mt-5 rounded-2xl border border-red-300/20 bg-red-300/10 p-4 text-sm text-red-100">
              {(error as Error).message}
            </div>
          ) : (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {data?.services.map((service) => (
                <div key={service.id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{service.name}</div>
                      <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                        {service.status}
                      </div>
                    </div>
                    <span className={`mt-0.5 inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${
                      service.status === "online"
                        ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
                        : service.status === "degraded"
                          ? "border-amber-300/20 bg-amber-300/10 text-amber-100"
                          : "border-red-300/20 bg-red-300/10 text-red-100"
                    }`}>
                      <CircleDotDashed className="h-3 w-3" />
                      {service.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="mt-3 space-y-1.5 text-xs text-slate-300">
                    <div>Last activity: {service.last_activity_at ? timeAgo(service.last_activity_at) : "—"}</div>
                    <div>Last collection: {service.last_collection_at ? timeAgo(service.last_collection_at) : "—"}</div>
                    <div>Items collected today: {service.items_collected_today}</div>
                    <div>Error count 24h: {service.error_count_24h}</div>
                  </div>
                  {service.render_url && (
                    <a
                      href={service.render_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex items-center gap-2 text-xs font-medium text-cyan-200 hover:text-cyan-100"
                    >
                      Render URL <ArrowUpRight className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Subscription overview</div>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3">
                <span className="text-slate-300">Active</span>
                <span className="font-semibold text-white">{stats ? stats.activeSubscriptions : "—"}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3">
                <span className="text-slate-300">Trial</span>
                <span className="font-semibold text-white">{stats ? stats.trialSubscriptions : "—"}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-red-300/20 bg-red-300/10 px-4 py-3">
                <span className="text-red-100">Overdue</span>
                <span className="font-semibold text-red-50">{stats ? stats.overdueSubscriptions : "—"}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3">
                <span className="text-slate-300">Revenue this month</span>
                <span className="font-semibold text-white">{stats?.revenue ?? "—"}</span>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Recent signups</div>
            <div className="mt-4 space-y-3">
              {(data?.recentSignups ?? []).length > 0 ? data!.recentSignups.map((org) => (
                <div key={org.id} className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{org.name}</div>
                      <div className="mt-1 text-xs text-slate-300">
                        {org.tier} · {org.status}
                      </div>
                    </div>
                    <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">
                      {timeAgo(org.created_at)}
                    </div>
                  </div>
                </div>
              )) : (
                <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
                  No recent signups.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Recent client activity</div>
            <div className="mt-4 space-y-3">
              {(data?.recentActivity ?? []).length > 0 ? data!.recentActivity.map((item) => (
                <div key={item.id} className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{item.org}</div>
                      <div className="mt-1 text-sm text-slate-300">{item.summary}</div>
                    </div>
                    <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">
                      {timeAgo(item.created_at)}
                    </div>
                  </div>
                </div>
              )) : (
                <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
                  No recent client activity.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  delta,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  delta: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "critical" | "high" | "resolved" | "muted";
}) {
  const toneClass = {
    critical: "text-critical bg-critical/10 border-critical/30",
    high: "text-high bg-high/10 border-high/30",
    resolved: "text-resolved bg-resolved/10 border-resolved/30",
    muted: "text-muted-foreground bg-muted border-border",
  }[tone];
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider text-slate-400">{label}</div>
        <div className={`grid h-7 w-7 place-items-center rounded-md border ${toneClass}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-white">{value}</div>
      <div className="mt-0.5 text-[11px] text-slate-400">{delta}</div>
    </div>
  );
}

function Stat({ label, value, delta, icon: Icon, tone }: {
  label: string; value: string; delta: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "critical" | "high" | "resolved" | "muted";
}) {
  const toneClass = {
    critical: "text-critical bg-critical/10 border-critical/30",
    high: "text-high bg-high/10 border-high/30",
    resolved: "text-resolved bg-resolved/10 border-resolved/30",
    muted: "text-muted-foreground bg-muted border-border",
  }[tone];
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={`grid h-7 w-7 place-items-center rounded-md border ${toneClass}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{delta}</div>
    </div>
  );
}
