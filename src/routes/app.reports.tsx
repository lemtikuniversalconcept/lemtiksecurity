import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { listIncidents } from "@/lib/incidents.functions";
import { typeMeta, type IncidentType } from "@/lib/mockData";
import { Download, FileText, Loader2, Radar, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/app/reports")({
  head: () => ({ meta: [{ title: "Reports · Lemtik SOD" }] }),
  component: Reports,
});

type IncidentRow = {
  id: string;
  code: string;
  type: IncidentType;
  severity: number;
  status: string;
  location: string;
  zone: string;
  officer: string | null;
  reported_at: string;
};

function Reports() {
  const list = useServerFn(listIncidents);
  const { data: incidents = [], isLoading } = useQuery({
    queryKey: ["incidents"],
    queryFn: () => list() as Promise<IncidentRow[]>,
  });

  const live = useMemo(() => {
    const recent48 = incidents.filter((i) => Date.now() - new Date(i.reported_at).getTime() <= 48 * 3600_000);
    const critical48 = recent48.filter((i) => i.severity >= 4).length;
    const byZone = incidents.reduce<Record<string, number>>((acc, incident) => {
      acc[incident.zone] = (acc[incident.zone] ?? 0) + 1;
      return acc;
    }, {});
    const zoneRows = zoneRisk.map((z) => ({
      ...z,
      incidents: byZone[z.zone] ?? 0,
      heat: Math.min(100, Math.max(z.score, (byZone[z.zone] ?? 0) * 18 + critical48 * 4)),
    }));
    const riskScore = Math.min(100, Math.max(42, Math.round((recent48.length * 6) + (critical48 * 11) + (zoneRows.reduce((a, z) => a + z.heat, 0) / Math.max(zoneRows.length, 1)) / 4)));
    return { recent48, critical48, zoneRows, riskScore };
  }, [incidents]);

  const byType = Object.entries(
    incidents.reduce<Record<string, number>>((acc, i) => {
      acc[i.type] = (acc[i.type] || 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const totalType = byType.reduce((a, [, n]) => a + n, 0) || 1;

  // Real hourly distribution from incidents
  const hourly = Array.from({ length: 24 }, () => 0);
  incidents.forEach((i) => {
    const h = new Date(i.reported_at).getHours();
    hourly[h] += 1;
  });
  const hMax = Math.max(1, ...hourly);

  const exportCsv = () => {
    const headers = ["code", "type", "severity", "status", "location", "zone", "officer", "reported_at"];
    const rows = incidents.map((i) =>
      headers.map((h) => JSON.stringify((i as Record<string, unknown>)[h] ?? "")).join(","),
    );
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lemtik-incidents-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const printPdf = () => {
    if (typeof window !== "undefined") window.print();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Intelligence & Reporting</div>
          <h1 className="mt-1 text-2xl font-semibold">Weekly security brief</h1>
          <p className="text-sm text-muted-foreground">Auto-generated · branded for client delivery.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={printPdf} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-xs hover:bg-surface-2">
            <FileText className="h-3.5 w-3.5" /> Print / PDF
          </button>
          <button onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="rounded-lg border border-border bg-card p-6 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Compiling intelligence…
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Kpi label="Total incidents" value={incidents.length} />
        <Kpi label="Resolved" value={incidents.filter((i) => i.status === "resolved").length} />
        <Kpi label="Critical (S4–S5)" value={incidents.filter((i) => i.severity >= 4).length} />
        <Kpi label="Zones impacted" value={new Set(incidents.map((i) => i.zone)).size} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-4">
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Brain 1</div>
              <h2 className="text-sm font-semibold">OSINT threat heatmap - Lagos</h2>
            </div>
            <span className="inline-flex items-center gap-1 rounded-md border border-critical/30 bg-critical/10 px-2 py-1 text-[10px] uppercase tracking-wider text-critical">
              <Radar className="h-3 w-3" /> Active scan
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {live.zoneRows.map((zone) => (
              <div
                key={zone.zone}
                className="rounded-lg border border-border px-3 py-3"
                style={{
                  background: `linear-gradient(135deg, hsl(0 84% 60% / ${Math.max(0.08, zone.heat / 120)}), hsl(0 84% 60% / ${Math.max(0.03, zone.heat / 220)}))`,
                }}
              >
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{zone.zone}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">{zone.score}%</div>
                <div className="mt-1 text-[10px] font-mono text-muted-foreground">{zone.incidents} signals · {zone.trend}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 h-28 rounded-lg border border-border bg-surface p-3">
            <div className="flex h-full items-end gap-2">
              {live.zoneRows.map((zone) => (
                <div key={zone.zone} className="flex-1 flex flex-col items-center justify-end gap-1">
                  <div
                    className="w-full rounded-t bg-gradient-to-t from-critical via-high to-accent/60"
                    style={{ height: `${Math.max(12, zone.heat)}%` }}
                    title={`${zone.zone} ${zone.heat}%`}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 space-y-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Rolling summary</div>
            <h3 className="text-sm font-semibold">Regional risk output</h3>
          </div>
          <div className="rounded-md border border-critical/30 bg-critical/10 px-4 py-3">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-critical">
              <ShieldAlert className="h-3 w-3" /> Dynamic intelligence
            </div>
            <div className="mt-2 text-sm leading-relaxed">
              {live.recent48.length} incidents scraped from public channels within 2km radius over the last 48 hours. Regional Risk Score: {live.riskScore}%.
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Kpi label="48h signals" value={live.recent48.length} />
            <Kpi label="Critical in window" value={live.critical48} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="text-sm font-medium">Incident frequency by hour</div>
          <div className="text-xs text-muted-foreground mb-4">When are incidents happening?</div>
          <div className="flex items-end gap-1 h-40">
            {hourly.map((v, h) => (
              <div key={h} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full rounded-t bg-primary/70"
                  style={{ height: `${(v / hMax) * 100}%` }}
                  title={`${v} incidents at ${h}:00`}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[10px] font-mono text-muted-foreground">
            <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <div className="text-sm font-medium">Incident type breakdown</div>
          <div className="text-xs text-muted-foreground mb-4">Most common categories</div>
          <div className="space-y-3">
            {byType.length === 0 && <div className="text-xs text-muted-foreground">No data yet.</div>}
            {byType.map(([type, count]) => {
              const pct = Math.round((count / totalType) * 100);
              return (
                <div key={type}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span>{typeMeta[type as IncidentType]}</span>
                    <span className="font-mono text-muted-foreground">{count} · {pct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                    <div className="h-full rounded-full bg-primary/70" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {[
          { title: "Daily incident log", desc: `Today · ${incidents.filter((i) => new Date(i.reported_at).toDateString() === new Date().toDateString()).length} incidents`, date: "Auto-generated 07:00" },
          { title: "Weekly summary", desc: `${incidents.length} incidents · ${new Set(incidents.map((i) => i.zone)).size} zones`, date: "Sun 23:59" },
          { title: "Monthly threat analysis", desc: "Patterns, hotspots, recommendations", date: "1st of month" },
        ].map((r) => (
          <div key={r.title} className="rounded-lg border border-border bg-card p-5">
            <div className="grid h-9 w-9 place-items-center rounded-md bg-accent/10 border border-accent/30 text-accent">
              <FileText className="h-4 w-4" />
            </div>
            <div className="mt-3 text-sm font-semibold">{r.title}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{r.desc}</div>
            <div className="text-[10px] font-mono text-muted-foreground mt-3">{r.date}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
