import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowUpRight, Loader2, RefreshCw } from "lucide-react";
import { getPlatformSystemHealth, requestPlatformServiceRestart } from "@/lib/platform.system.functions";
import { requireSectionAccess } from "@/lib/rbac";
import { Empty, Kpi, Notice, PageHeader, Panel, Status, type Tone } from "@/components/nw";

export const Route = createFileRoute("/app/admin/system")({
  head: () => ({ meta: [{ title: "System health · Lemtik Admin" }] }),
  beforeLoad: async ({ context }) => {
    const access = context.appAccess;
    requireSectionAccess(access, ["lemtik_admin"]);
    return { appAccess: access };
  },
  component: SystemHealthPage,
});

const SERVICE_TONE: Record<string, Tone> = { online: "ok", degraded: "warn", offline: "fail" };
const num = (v: number | null | undefined, suffix = "") => (v == null ? "not measured" : `${v.toLocaleString("en-GB")}${suffix}`);

function SystemHealthPage() {
  const loadHealth = useServerFn(getPlatformSystemHealth);
  const restartService = useServerFn(requestPlatformServiceRestart);
  const { data, isLoading, error, refetch, isFetching } = useQuery({ queryKey: ["platform-system-health"], queryFn: () => loadHealth(), refetchInterval: 30_000 });
  const [confirming, setConfirming] = useState<{ slug: string; name: string } | null>(null);

  const restartMut = useMutation({
    mutationFn: (service_slug: string) => restartService({ data: { service_slug } }),
    onSuccess: () => {
      toast.success("Restart request recorded in the audit log. Restart the service from its hosting dashboard.");
      setConfirming(null);
      void refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const services = data?.services ?? [];
  const db = data?.database;
  const broker = data?.broker;
  const online = services.filter((s: any) => s.status === "online").length;
  const errors = services.reduce((sum: number, s: any) => sum + Number(s.error_count_24h ?? 0), 0);

  return (
    <div className="col g16">
      <PageHeader title="System health" sub="Service state from platform records; database figures from the Supabase health check. Refreshes every 30 seconds.">
        <button type="button" className="b b-sec" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4${isFetching ? " animate-spin" : ""}`} /> Refresh
        </button>
      </PageHeader>

      {error && <Notice tone="fail">{(error as Error).message}</Notice>}

      <div className="kpis">
        <Kpi label="Services online" value={services.length ? online : "—"} unit={services.length ? `/ ${services.length}` : undefined} />
        <Kpi label="Service errors, 24 h" value={services.length ? errors : "—"} />
        <Kpi label="DB connection pool" value={db ? `${db.utilisationPct}%` : "—"} delta={db ? `${db.activeConnections} of ${db.maxConnections} connections` : undefined} />
        <Kpi label="Database size" value={db ? db.databaseSizeMb.toLocaleString("en-GB") : "—"} unit={db ? "MB" : undefined} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]" style={{ alignItems: "start" }}>
        <Panel title="Services" meta={`${services.length}`} bodyClassName="">
          {isLoading ? (
            <Empty>
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
            </Empty>
          ) : services.length === 0 ? (
            <Empty>No platform services were returned.</Empty>
          ) : (
            <div className="scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Status</th>
                    <th>Last activity</th>
                    <th>Last collection</th>
                    <th>Collected today</th>
                    <th>Errors 24 h</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {services.map((s: any) => (
                    <tr key={s.id}>
                      <td>
                        <b>{s.name}</b>
                      </td>
                      <td>
                        <Status tone={SERVICE_TONE[s.status] ?? "neutral"}>{s.status}</Status>
                      </td>
                      <td className="t2">{s.last_activity_label}</td>
                      <td className="t2">{s.last_collection_label}</td>
                      <td className="mono">{s.items_collected_today}</td>
                      <td className="mono" style={{ color: Number(s.error_count_24h) ? "var(--fail)" : undefined }}>
                        {s.error_count_24h}
                      </td>
                      <td>
                        <span className="row g6" style={{ justifyContent: "flex-end" }}>
                          {s.render_url && (
                            <a href={s.render_url} target="_blank" rel="noreferrer noopener" className="b b-sm b-gh">
                              Open <ArrowUpRight className="h-3.5 w-3.5" />
                            </a>
                          )}
                          <button type="button" className="b b-sm b-gh" onClick={() => setConfirming({ slug: s.slug, name: s.name })}>
                            Log restart
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="col g16">
          <Panel title="Database" meta={db?.checkedAt ? `checked ${new Date(db.checkedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : undefined}>
            {db ? (
              <div className="col g10">
                <div className="prog" style={{ height: 8 }}>
                  <i style={{ width: `${Math.min(100, db.utilisationPct)}%`, background: db.utilisationPct > 85 ? "var(--fail)" : db.utilisationPct > 65 ? "var(--warn)" : "var(--ok)" }} />
                </div>
                <dl className="kv">
                  <dt>Active connections</dt>
                  <dd className="mono">
                    {db.activeConnections} / {db.maxConnections}
                  </dd>
                  <dt>Idle connections</dt>
                  <dd className="mono">{db.idleConnections}</dd>
                  <dt>Long-running queries</dt>
                  <dd className="mono">{db.longRunningQueries}</dd>
                </dl>
              </div>
            ) : (
              <Empty>No database health data.</Empty>
            )}
          </Panel>

          <Panel title="Infrastructure" meta="configuration only">
            <dl className="kv">
              <dt>EMQX broker</dt>
              <dd>{broker?.emqx.configured ? "Configured" : "Not configured"}</dd>
              <dt>Connected devices</dt>
              <dd className="t2">{num(broker?.emqx.connectedDevices)}</dd>
              <dt>Upstash Redis</dt>
              <dd>{broker?.redis.configured ? "Configured" : "Not configured"}</dd>
              <dt>Redis memory</dt>
              <dd className="t2">{num(broker?.redis.memoryUsageMb, " MB")}</dd>
            </dl>
            <p className="t3" style={{ fontSize: 12, margin: "10px 0 0" }}>
              Lemtik doesn't yet collect live broker or Redis metrics. "Configured" means credentials are set, not that the service is reachable.
            </p>
          </Panel>

          <Panel title="Integrations" bodyClassName="">
            <div className="list">
              {(data?.integrations ?? []).map((i: any) => (
                <div key={i.key} className="row g10" style={{ padding: "9px 14px" }}>
                  <span className="f1 col" style={{ minWidth: 0 }}>
                    <b>{i.name}</b>
                    <span className="t3 trunc" style={{ fontSize: 12 }}>
                      {i.metricLabel}: {i.metricValue == null ? "not measured" : `${i.metricValueLabel} ${i.quotaLabel}`}
                    </span>
                  </span>
                  <Status tone={i.configured ? "blue" : "off"}>{i.configured ? "Configured" : "Not configured"}</Status>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Recent platform events" bodyClassName="">
            {(data?.recentEvents ?? []).length === 0 ? (
              <Empty>No recent events.</Empty>
            ) : (
              <div className="list">
                {data!.recentEvents.slice(0, 8).map((e: any) => (
                  <div key={e.id} className="row g10" style={{ padding: "9px 14px" }}>
                    <span className="f1 col" style={{ minWidth: 0 }}>
                      <b className="trunc">{e.organisation_name}</b>
                      <span className="t2 trunc" style={{ fontSize: 12.5 }}>
                        {e.summary}
                      </span>
                    </span>
                    <span className="t3 mono" style={{ fontSize: 11.5 }}>
                      {e.when}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 grid place-items-center px-4" style={{ background: "rgba(5,7,10,.72)" }} role="dialog" aria-modal="true" aria-label="Log restart">
          <div className="pn w-full" style={{ maxWidth: 440, borderColor: "var(--line-2)" }}>
            <div className="pn-h">
              <h3 style={{ fontSize: 15 }}>Log a restart for {confirming.name}?</h3>
            </div>
            <div className="pn-b col g12">
              <p className="t2" style={{ margin: 0 }}>
                This records a restart request in the platform audit log and events. It doesn't restart the service itself; do that from its hosting dashboard.
              </p>
              <div className="row g8" style={{ justifyContent: "flex-end" }}>
                <button type="button" className="b b-gh" onClick={() => setConfirming(null)}>
                  Cancel
                </button>
                <button type="button" className="b b-pri" disabled={restartMut.isPending} onClick={() => restartMut.mutate(confirming.slug)}>
                  {restartMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Log restart
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
