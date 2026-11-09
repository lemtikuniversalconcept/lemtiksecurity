import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPlatformDashboard } from "@/lib/platform.functions";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { Empty, Kpi, Notice, PageHeader, Panel, Status, timeAgo, type Tone } from "@/components/nw";
import { requireSectionAccess } from "@/lib/rbac";
import { CommanderDashboard } from "@/components/dashboard/CommanderDashboard";

export const Route = createFileRoute("/app/")({
  head: () => ({ meta: [{ title: "Overview · Lemtik SOD" }] }),
  validateSearch: (search: Record<string, unknown>): { ask?: string } =>
    typeof search.ask === "string" && search.ask.trim() ? { ask: search.ask.trim().slice(0, 300) } : {},
  beforeLoad: async ({ context }) => {
    const access = context.appAccess;
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

function Overview() {
  const { appAccess } = Route.useRouteContext();
  const { ask } = Route.useSearch();
  if (appAccess.specRole === "lemtik_admin") {
    return <PlatformDashboard />;
  }
  return <CommanderDashboard access={appAccess} ask={ask} />;
}

function PlatformDashboard() {
  const loadPlatform = useServerFn(getPlatformDashboard);
  const { data, isLoading, error, refetch, isFetching } = useQuery({ queryKey: ["platform-dashboard"], queryFn: () => loadPlatform() });
  const stats = data?.stats;
  const SERVICE_TONE: Record<string, Tone> = { online: "ok", degraded: "warn", offline: "fail" };

  return (
    <div className="col g16">
      <PageHeader title="Platform" sub="Lemtik internal view across all client organisations. No client operational detail is shown here.">
        <button type="button" className="b b-sec" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4${isFetching ? " animate-spin" : ""}`} /> Refresh
        </button>
      </PageHeader>

      <div className="kpis">
        <Kpi label="Organisations" value={stats ? stats.totalOrganisations : "—"} />
        <Kpi label="Active subscriptions" value={stats ? stats.activeSubscriptions : "—"} delta={stats ? `${stats.trialSubscriptions} on trial` : undefined} />
        <Kpi label="Overdue" value={stats ? stats.overdueSubscriptions : "—"} deltaClass={stats?.overdueSubscriptions ? "up-bad" : ""} delta={stats?.overdueSubscriptions ? "needs follow-up" : undefined} />
        <Kpi label="Incidents, 30 days" value={stats ? stats.incidentsLast30Days : "—"} delta="all organisations" />
        <Kpi label="Services online now" value={stats ? `${stats.activeServices}` : "—"} unit={data ? `/ ${data.services.length}` : undefined} title="Share of monitored services reporting online at this moment. Not an uptime figure." />
        <Kpi label="Revenue this month" value={stats?.revenue ?? "—"} />
      </div>

      {error && <Notice tone="fail">{(error as Error).message}</Notice>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]" style={{ alignItems: "start" }}>
        <Panel title="Services" meta={data ? `${data.services.length}` : undefined} bodyClassName="">
          {isLoading ? (
            <Empty>Loading…</Empty>
          ) : !data?.services.length ? (
            <Empty>No services are reporting.</Empty>
          ) : (
            <div className="scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Status</th>
                    <th>Last activity</th>
                    <th>Collected today</th>
                    <th>Errors 24 h</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.services.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <b>{s.name}</b>
                      </td>
                      <td>
                        <Status tone={SERVICE_TONE[s.status] ?? "neutral"}>{s.status}</Status>
                      </td>
                      <td className="t2">{s.last_activity_at ? timeAgo(s.last_activity_at) : "—"}</td>
                      <td className="mono">{s.items_collected_today}</td>
                      <td className="mono" style={{ color: s.error_count_24h ? "var(--fail)" : undefined }}>
                        {s.error_count_24h}
                      </td>
                      <td>
                        {s.render_url && (
                          <a href={s.render_url} target="_blank" rel="noreferrer noopener" className="b b-sm b-gh">
                            Open <ArrowUpRight className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="col g16">
          <Panel title="Recent sign-ups" bodyClassName="">
            {(data?.recentSignups ?? []).length === 0 ? (
              <Empty>No recent sign-ups.</Empty>
            ) : (
              <div className="list">
                {data!.recentSignups.map((o) => (
                  <Link key={o.id} to="/app/admin/organisations/$id" params={{ id: o.id }} className="row g10" style={{ padding: "9px 14px" }}>
                    <span className="f1 col" style={{ minWidth: 0 }}>
                      <b className="trunc">{o.name}</b>
                      <span className="t3" style={{ fontSize: 12 }}>
                        {o.tier} · {o.status}
                      </span>
                    </span>
                    <span className="t3 mono" style={{ fontSize: 11.5 }}>
                      {timeAgo(o.created_at)}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </Panel>
          <Panel title="Recent client activity" bodyClassName="">
            {(data?.recentActivity ?? []).length === 0 ? (
              <Empty>No recent activity.</Empty>
            ) : (
              <div className="list">
                {data!.recentActivity.map((a) => (
                  <div key={a.id} className="row g10" style={{ padding: "9px 14px" }}>
                    <span className="f1 col" style={{ minWidth: 0 }}>
                      <b className="trunc">{a.org}</b>
                      <span className="t2 trunc" style={{ fontSize: 12.5 }}>
                        {a.summary}
                      </span>
                    </span>
                    <span className="t3 mono" style={{ fontSize: 11.5 }}>
                      {timeAgo(a.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
