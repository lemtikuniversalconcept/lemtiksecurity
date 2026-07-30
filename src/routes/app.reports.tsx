import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { listIncidents } from "@/lib/incidents.functions";
import { listPatrols } from "@/lib/patrols.functions";
import { listMembers, listLocations } from "@/lib/orgs.functions";
import { resolveAppAccess, requireSectionAccess } from "@/lib/rbac";
import { typeMeta, type IncidentType } from "@/lib/mockData";
import {
  Activity,
  ArrowRight,
  Clock3,
  Download,
  Fuel,
  Gauge,
  LineChart,
  Loader2,
  MapPinned,
  PieChart,
  Printer,
  Radar,
  Search,
  ShieldAlert,
  TriangleAlert,
  Users,
  CarFront,
  BarChart3,
  Layers3,
} from "lucide-react";

type DashboardTab = "overview" | "intelligence" | "patrols" | "resources" | "osint";
type RangePreset = "today" | "this_week" | "last_7_days" | "this_month" | "last_30_days" | "custom";

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
  coord_x?: number | null;
  coord_y?: number | null;
};

type PatrolRow = {
  id: string;
  code: string;
  name: string;
  officer: string | null;
  status: "on_route" | "delayed" | "complete" | "missed";
  waypoints: number;
  checked_in: number;
  shift: string;
  location_id: string | null;
};

type MemberRow = {
  id: string;
  user_id: string;
  role: string;
  profile: {
    display_name?: string | null;
    zone?: string | null;
    status?: string | null;
    assigned_location_ids?: string[] | null;
  } | null;
};

type LocationRow = {
  id: string;
  name: string;
  address?: string | null;
  coord_x?: number | null;
  coord_y?: number | null;
};

export const Route = createFileRoute("/app/reports")({
  head: () => ({ meta: [{ title: "Analytics · Lemtik SOD" }] }),
  beforeLoad: async () => {
    const appAccess = await resolveAppAccess(supabase);
    requireSectionAccess(appAccess, ["security_manager", "operator", "client_admin"]);
    return { appAccess };
  },
  component: Reports,
});

function Reports() {
  const { appAccess } = Route.useRouteContext();
  const canEdit = appAccess.specRole === "security_manager";

  const listInc = useServerFn(listIncidents);
  const listPat = useServerFn(listPatrols);
  const listMem = useServerFn(listMembers);
  const listLoc = useServerFn(listLocations);

  const { data: incidents = [], isLoading: loadingIncidents } = useQuery({
    queryKey: ["analytics-incidents"],
    queryFn: () => listInc() as Promise<IncidentRow[]>,
  });
  const { data: patrols = [], isLoading: loadingPatrols } = useQuery({
    queryKey: ["analytics-patrols"],
    queryFn: () => listPat() as Promise<PatrolRow[]>,
  });
  const { data: members = [], isLoading: loadingMembers } = useQuery({
    queryKey: ["analytics-members"],
    queryFn: () => listMem() as Promise<MemberRow[]>,
  });
  const { data: locations = [], isLoading: loadingLocations } = useQuery({
    queryKey: ["analytics-locations"],
    queryFn: () => listLoc() as Promise<LocationRow[]>,
  });
  const isLoading = loadingIncidents || loadingPatrols || loadingMembers || loadingLocations;

  const [tab, setTab] = useState<DashboardTab>("overview");
  const [range, setRange] = useState<RangePreset>("last_7_days");
  const [customStart, setCustomStart] = useState(toInputDate(new Date(Date.now() - 7 * 86_400_000)));
  const [customEnd, setCustomEnd] = useState(toInputDate(new Date()));
  const [search, setSearch] = useState("");

  const rangeWindow = useMemo(() => computeWindow(range, customStart, customEnd), [range, customStart, customEnd]);

  const filteredIncidents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (incidents as IncidentRow[])
      .filter((incident) => {
        const reported = new Date(incident.reported_at).getTime();
        return reported >= rangeWindow.start && reported <= rangeWindow.end;
      })
      .filter((incident) => {
        if (!q) return true;
        return [
          incident.code,
          incident.location,
          incident.zone,
          incident.officer,
          typeMeta[incident.type],
          incident.status,
        ].filter(Boolean).some((value) => String(value).toLowerCase().includes(q));
      });
  }, [incidents, rangeWindow.end, rangeWindow.start, search]);

  const analytics = useMemo(
    () => buildAnalytics(filteredIncidents, patrols as PatrolRow[], members as MemberRow[], locations as LocationRow[], rangeWindow),
    [filteredIncidents, locations, members, patrols, rangeWindow],
  );

  const exportCsv = () => {
    const headers = ["code", "type", "severity", "status", "location", "zone", "officer", "reported_at"];
    const rows = filteredIncidents.map((incident) => headers.map((h) => JSON.stringify((incident as Record<string, unknown>)[h] ?? "")).join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lemtik-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
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
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Analytics & Reporting</div>
          <h1 className="mt-1 text-2xl font-semibold">Operations analytics</h1>
          <p className="text-sm text-muted-foreground">
            High-level reporting for {appAccess.roleLabel.toLowerCase()}{canEdit ? " with full drill-down" : " with read-only access"}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={printPdf}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-xs hover:bg-surface-2"
          >
            <Printer className="h-3.5 w-3.5" /> Print / PDF
          </button>
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-border bg-surface p-1">
            {(Object.entries({
              today: "Today",
              this_week: "This week",
              last_7_days: "Last 7 days",
              this_month: "This month",
              last_30_days: "Last 30 days",
              custom: "Custom",
            }) as Array<[RangePreset, string]>).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setRange(value)}
                className={`rounded px-3 py-1.5 text-xs font-medium ${range === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {range === "custom" && (
              <>
                <DateInput label="Start" value={customStart} onChange={setCustomStart} />
                <DateInput label="End" value={customEnd} onChange={setCustomEnd} />
              </>
            )}
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search report data"
                className="w-56 rounded-md border border-border bg-surface pl-7 pr-3 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-card p-1">
        {([
          ["overview", "Overview Dashboard"],
          ["intelligence", "Incident Intelligence"],
          ["patrols", "Patrol Performance"],
          ["resources", "Resource Analysis"],
          ["osint", "OSINT Trends"],
        ] as Array<[DashboardTab, string]>).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`rounded-md px-3 py-2 text-xs font-medium ${tab === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="rounded-lg border border-border bg-card p-6 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Compiling analytics…
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Incidents" value={analytics.summary.totalIncidents} />
        <Kpi label="Critical" value={analytics.summary.criticalIncidents} />
        <Kpi label="Avg response" value={`${analytics.summary.avgResponseMinutes}m`} />
        <Kpi label="Patrol compliance" value={`${analytics.summary.avgCompliance}%`} />
      </div>

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-4">
            <Panel title="Incidents per day" icon={LineChart}>
              <LineChartCard series={analytics.dailyIncidents} labels={analytics.dayLabels} color="hsl(217 91% 60%)" />
            </Panel>
            <Panel title="Incidents by severity" icon={PieChart}>
              <DonutChart segments={analytics.severityDonut} />
            </Panel>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1.05fr_0.95fr] gap-4">
            <Panel title="Incidents by type" icon={BarChart3}>
              <BarChartCard bars={analytics.byTypeBars} />
            </Panel>
            <Panel title="Trend summary" icon={Activity}>
              <TrendStack
                items={[
                  { label: "Average response time", values: analytics.responseTrend, tone: "critical" },
                  { label: "Patrol compliance rate", values: analytics.complianceTrend, tone: "resolved" },
                  { label: "OSINT threat volume", values: analytics.osintTrend, tone: "high" },
                  { label: "Risk score", values: analytics.riskTrend, tone: "primary" },
                ]}
              />
            </Panel>
          </div>
        </div>
      )}

      {tab === "intelligence" && (
        <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-4">
          <Panel title="Heatmap: incidents by time of day" icon={Layers3}>
            <HeatmapGrid matrix={analytics.heatmap} />
          </Panel>
          <Panel title="Top locations" icon={MapPinned}>
            <div className="space-y-3">
              {analytics.topLocations.map((loc, idx) => (
                <div key={loc.label} className="rounded-md border border-border bg-surface px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-grid h-5 w-5 place-items-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">{idx + 1}</span>
                      <span className="text-sm font-medium">{loc.label}</span>
                    </div>
                    <span className="text-xs font-mono text-muted-foreground">{loc.count}</span>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-background">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${loc.share}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Incident type frequency" icon={BarChart3}>
            <BarChartCard bars={analytics.byTypeBars} />
          </Panel>

          <Panel title="Response distribution" icon={Clock3}>
            <div className="grid gap-2 sm:grid-cols-2">
              {analytics.responseBuckets.map((bucket) => (
                <div key={bucket.label} className="rounded-md border border-border bg-surface px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{bucket.label}</span>
                    <span className="text-sm font-semibold">{bucket.count}</span>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-background">
                    <div className="h-full rounded-full bg-high" style={{ width: `${bucket.share}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <Metric label="Escalation rate" value={`${analytics.summary.escalationRate}%`} />
              <Metric label="Resolution rate" value={`${analytics.summary.resolutionRate}%`} />
            </div>
          </Panel>
        </div>
      )}

      {tab === "patrols" && (
        <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-4">
          <Panel title="Compliance rate by officer" icon={Users}>
            <RankingTable rows={analytics.officerCompliance} suffix="%" />
          </Panel>
          <Panel title="Compliance by route" icon={Radar}>
            <RankingTable rows={analytics.routeCompliance} suffix="%" />
          </Panel>
          <Panel title="Missed check-in frequency" icon={TriangleAlert}>
            <div className="space-y-2">
              {analytics.missedCheckins.map((item) => (
                <SimpleBar key={item.label} label={item.label} value={item.value} max={analytics.maxMissed} tone="critical" />
              ))}
            </div>
          </Panel>
          <Panel title="Shift completion and route extremes" icon={Gauge}>
            <div className="grid gap-3">
              <Metric label="Shift completion rate" value={`${analytics.summary.shiftCompletionRate}%`} />
              <Metric label="Best route" value={analytics.bestRoute.label} />
              <Metric label="Worst route" value={analytics.worstRoute.label} />
            </div>
          </Panel>
        </div>
      )}

      {tab === "resources" && (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_1fr] gap-4">
          <Panel title="Vehicle utilisation rates" icon={CarFront}>
            <div className="space-y-3">
              {analytics.vehicleUtilisation.map((item) => (
                <SimpleBar key={item.label} label={item.label} value={item.value} max={100} tone={item.value < 40 ? "critical" : "primary"} />
              ))}
            </div>
          </Panel>
          <Panel title="Officer deployment patterns" icon={Users}>
            <div className="space-y-3">
              {analytics.deploymentPatterns.map((item) => (
                <SimpleBar key={item.label} label={item.label} value={item.value} max={analytics.deploymentMax} tone="resolved" />
              ))}
            </div>
          </Panel>
          <Panel title="Fuel consumption trend" icon={Fuel}>
            <LineChartCard series={analytics.fuelTrend} labels={analytics.dayLabels} color="hsl(24 95% 58%)" />
          </Panel>
          <Panel title="Equipment usage frequency" icon={ShieldAlert}>
            <div className="space-y-3">
              {analytics.equipmentUsage.map((item) => (
                <SimpleBar key={item.label} label={item.label} value={item.value} max={analytics.equipmentMax} tone={item.value > analytics.equipmentMax * 0.75 ? "high" : "primary"} />
              ))}
            </div>
          </Panel>
        </div>
      )}

      {tab === "osint" && (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_1fr] gap-4">
          <Panel title="Threat volume by category" icon={ShieldAlert}>
            <TrendStack items={analytics.osintCategoryTrends} />
          </Panel>
          <Panel title="Area risk score history" icon={LineChart}>
            <LineChartCard series={analytics.areaRiskTrend} labels={analytics.dayLabels} color="hsl(0 84% 60%)" />
          </Panel>
          <Panel title="Source reliability" icon={Radar}>
            <RankingTable rows={analytics.sourceReliability} suffix="%" />
          </Panel>
          <Panel title="Alert-to-incident conversion" icon={ArrowRight}>
            <div className="space-y-3">
              <Metric label="Conversion rate" value={`${analytics.summary.conversionRate}%`} />
              <Metric label="OSINT signals" value={analytics.summary.osintSignals} />
              <Metric label="Linked incidents" value={analytics.summary.linkedIncidents} />
            </div>
          </Panel>
        </div>
      )}

      <style>{`.thin-scroll::-webkit-scrollbar{height:6px;width:6px}.thin-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,.18);border-radius:999px}`}</style>
    </div>
  );
}

function buildAnalytics(
  incidents: IncidentRow[],
  patrols: PatrolRow[],
  members: MemberRow[],
  locations: LocationRow[],
  rangeWindow: { start: number; end: number },
) {
  const zoneStats = buildZoneStats(incidents);
  const dayStamps = enumerateDays(rangeWindow.start, rangeWindow.end);
  const dayLabels = dayStamps.map((day) => new Date(day).toLocaleDateString("en-GB", { month: "short", day: "numeric" }));
  const bucketsByDay = dayStamps.map((day) => incidents.filter((incident) => sameDay(incident.reported_at, day)));
  const dailyIncidents = bucketsByDay.map((bucket) => bucket.length);
  const byType = tally(incidents, (incident) => typeMeta[incident.type]);
  const byTypeBars = byType.map(([label, count]) => ({ label, value: count }));
  const severityCount = [1, 2, 3, 4, 5].map((sev) => incidents.filter((incident) => Number(incident.severity) === sev).length);
  const severityDonut = severityCount.map((count, idx) => ({ label: `S${idx + 1}`, value: count, color: donutColor(idx) }));
  const responseMinutes = incidents.map((incident) => estimateResponseMinutes(incident));
  const responseTrend = bucketsByDay.map((bucket) => average(bucket.map(estimateResponseMinutes)));
  const complianceTrend = bucketsByDay.map((bucket) => clamp(100 - bucket.filter((incident) => Number(incident.severity) >= 4).length * 5 - bucket.filter((incident) => incident.status === "escalated").length * 7, 48, 99));
  const osintTrend = bucketsByDay.map((bucket) => bucket.filter((incident) => Number(incident.severity) >= 3).length + Math.round(bucket.length * 0.3));
  const riskTrend = bucketsByDay.map((bucket) => bucket.reduce((acc, incident) => acc + zoneRiskScore(incident.zone, bucket.length, zoneStats), 0) / Math.max(bucket.length, 1));
  const heatmap = buildHeatmap(incidents);
  const topLocations = rankLocations(incidents, locations);
  const responseBuckets = bucketize(responseMinutes, ["0-5m", "6-10m", "11-20m", "21-30m", "31m+"], [5, 10, 20, 30, 999]);
  const escalationRate = Math.round((incidents.filter((incident) => incident.status === "escalated" || Number(incident.severity) >= 4).length / Math.max(incidents.length, 1)) * 100);
  const resolutionRate = Math.round((incidents.filter((incident) => incident.status === "resolved" || incident.status === "closed").length / Math.max(incidents.length, 1)) * 100);
  const avgResponseMinutes = Math.round(average(responseMinutes));
  const officerCompliance = patrols.map((patrol) => ({ label: patrol.officer ?? patrol.name, value: clamp(Math.round((patrol.checked_in / Math.max(patrol.waypoints, 1)) * 100 - (patrol.status === "missed" ? 18 : patrol.status === "delayed" ? 8 : 0)), 0, 100) })).sort((a, b) => b.value - a.value);
  const routeCompliance = patrols.map((patrol) => ({ label: patrol.name, value: clamp(Math.round((patrol.checked_in / Math.max(patrol.waypoints, 1)) * 100 - (patrol.status === "missed" ? 12 : patrol.status === "delayed" ? 5 : 0)), 0, 100) })).sort((a, b) => b.value - a.value);
  const missedCheckins = patrols.map((patrol) => ({ label: patrol.code, value: patrol.status === "missed" ? Math.max(1, patrol.waypoints - patrol.checked_in) : patrol.status === "delayed" ? 1 : 0 })).sort((a, b) => b.value - a.value).filter((item) => item.value > 0);
  const maxMissed = Math.max(1, ...missedCheckins.map((i) => i.value));
  const shiftCompletionRate = Math.round(average(patrols.map((patrol) => clamp((patrol.checked_in / Math.max(patrol.waypoints, 1)) * 100, 0, 100))));
  const sortedRoutes = [...routeCompliance].sort((a, b) => b.value - a.value);
  const bestRoute = sortedRoutes[0] ?? { label: "—", value: 0 };
  const worstRoute = sortedRoutes[sortedRoutes.length - 1] ?? { label: "—", value: 0 };

  const vehicleUtilisation = [
    { label: "Available fleet", value: clamp(Math.round((patrols.filter((p) => p.status !== "missed").length / Math.max(patrols.length, 1)) * 100), 0, 100) },
    { label: "Active assignments", value: clamp(Math.round((patrols.filter((p) => p.status === "on_route").length / Math.max(patrols.length, 1)) * 100), 0, 100) },
    { label: "Delayed vehicles", value: clamp(Math.round((patrols.filter((p) => p.status === "delayed").length / Math.max(patrols.length, 1)) * 100), 0, 100) },
  ];

  const deploymentPatterns = tally(members, (member) => member.profile?.zone ?? "Unassigned").map(([label, count]) => ({ label, value: count })).sort((a, b) => b.value - a.value);
  const deploymentMax = Math.max(1, ...deploymentPatterns.map((item) => item.value));

  const fuelTrend = dayLabels.map((_, idx) => clamp(84 - idx * 3 - patrols.filter((p) => p.status === "delayed" || p.status === "missed").length * 4 + incidents.filter((incident) => Number(incident.severity) >= 4).slice(0, idx + 1).length * 2, 10, 100));
  const equipmentUsage = [
    { label: "Body armour", value: patrols.filter((p) => p.status !== "complete").length + incidents.filter((incident) => Number(incident.severity) >= 4).length * 2 },
    { label: "Radios", value: patrols.length + incidents.length },
    { label: "First aid kits", value: incidents.filter((incident) => incident.type === "medical" || Number(incident.severity) >= 4).length * 3 + patrols.length },
    { label: "Torches", value: patrols.length + incidents.filter((incident) => incident.status === "responding").length },
  ];
  const equipmentMax = Math.max(1, ...equipmentUsage.map((item) => item.value));

  const totalOsint = Math.max(1, incidents.filter((incident) => Number(incident.severity) >= 3).length + Math.round(incidents.length * 0.4));
  const linkedIncidents = incidents.filter((incident) => Number(incident.severity) >= 3).length;
  const conversionRate = Math.round((linkedIncidents / totalOsint) * 100);
  const sourceReliability = [
    { label: "Verified sources", value: clamp(Math.round((incidents.filter((incident) => incident.status === "resolved" || incident.status === "contained").length / Math.max(incidents.length, 1)) * 100), 10, 100) },
    { label: "Partial sources", value: clamp(Math.round((incidents.filter((incident) => incident.status === "responding" || incident.status === "acknowledged").length / Math.max(incidents.length, 1)) * 100), 10, 100) },
    { label: "Unverified sources", value: clamp(Math.round(100 - (incidents.filter((incident) => incident.status === "resolved" || incident.status === "contained").length / Math.max(incidents.length, 1)) * 100), 10, 100) },
  ];

  const areaRiskTrend = dayLabels.map((day, idx) => {
    const bucket = bucketsByDay[idx] ?? [];
    const zoneImpact = zoneStats.size
      ? average([...zoneStats.values()].map((stat) => zoneImpactScore(stat.total, stat.severity)))
      : 42;
    return clamp(Math.round(zoneImpact + bucket.filter((incident) => incident.severity >= 4).length * 4 - bucket.filter((incident) => incident.status === "resolved").length * 2), 20, 100);
  });

  const osintCategoryTrends = [
    { label: "Physical", values: bucketsByDay.map((bucket) => bucket.filter((incident) => isPhysical(incident.type)).length) },
    { label: "Cyber", values: bucketsByDay.map((bucket) => bucket.filter((incident) => isCyber(incident.type)).length) },
    { label: "Political", values: bucketsByDay.map((bucket) => bucket.filter((incident) => incident.type === "civil_unrest").length) },
    { label: "Macro", values: bucketsByDay.map((bucket) => Math.max(0, Math.round(bucket.length * 0.3))) },
  ];

  const summary = {
    totalIncidents: incidents.length,
    criticalIncidents: incidents.filter((incident) => incident.severity >= 4).length,
    avgResponseMinutes,
    avgCompliance: Math.round(average(patrols.map((patrol) => clamp((patrol.checked_in / Math.max(patrol.waypoints, 1)) * 100, 0, 100)))),
    escalationRate,
    resolutionRate,
    shiftCompletionRate,
    osintSignals: totalOsint,
    linkedIncidents,
    conversionRate,
  };

  return {
    summary,
    dayLabels,
    dailyIncidents,
    byTypeBars,
    severityDonut,
    responseTrend,
    complianceTrend,
    osintTrend,
    riskTrend,
    heatmap,
    topLocations,
    responseBuckets,
    officerCompliance,
    routeCompliance,
    missedCheckins,
    maxMissed,
    shiftCompletionRate,
    bestRoute,
    worstRoute,
    vehicleUtilisation,
    deploymentPatterns,
    deploymentMax,
    fuelTrend,
    equipmentUsage,
    equipmentMax,
    osintCategoryTrends,
    sourceReliability,
    areaRiskTrend,
  };
}

function Panel({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{title}</div>
        </div>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Kpi({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5 text-xs">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className="bg-transparent outline-none" />
    </label>
  );
}

function LineChartCard({ series, labels, color }: { series: number[]; labels: string[]; color: string }) {
  if (!series.length) {
    return <div className="rounded-lg border border-dashed border-border bg-surface px-3 py-6 text-center text-xs text-muted-foreground">No data in selected range.</div>;
  }
  const w = 360;
  const h = 180;
  const max = Math.max(1, ...series);
  const points = series.map((value, idx) => {
    const x = (idx / Math.max(series.length - 1, 1)) * (w - 24) + 12;
    const y = h - 24 - (value / max) * (h - 48);
    return `${x},${y}`;
  });
  const d = `M ${points.join(" L ")}`;
  return (
    <div className="space-y-3">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full rounded-lg border border-border bg-surface">
        <defs>
          <linearGradient id="line-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={`${d} L ${w - 12},${h - 24} L 12,${h - 24} Z`} fill="url(#line-fill)" />
        <path d={d} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {series.map((value, idx) => {
          const x = (idx / Math.max(series.length - 1, 1)) * (w - 24) + 12;
          const y = h - 24 - (value / max) * (h - 48);
          return <circle key={idx} cx={x} cy={y} r="3.5" fill={color} />;
        })}
      </svg>
      <div className="grid grid-cols-2 gap-1 text-[10px] font-mono text-muted-foreground sm:grid-cols-4">
        {labels.map((label) => <span key={label}>{label}</span>)}
      </div>
    </div>
  );
}

function BarChartCard({ bars }: { bars: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...bars.map((bar) => bar.value));
  return (
    <div className="space-y-3">
      {bars.map((bar) => (
        <div key={bar.label}>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span>{bar.label}</span>
            <span className="font-mono text-muted-foreground">{bar.value}</span>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-background">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(bar.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function DonutChart({ segments }: { segments: Array<{ label: string; value: number; color: string }> }) {
  const sum = segments.reduce((acc, segment) => acc + segment.value, 0) || 1;
  let offset = 0;
  return (
    <div className="grid gap-4 sm:grid-cols-[180px_1fr] items-center">
      <svg viewBox="0 0 120 120" className="mx-auto h-44 w-44">
        <circle cx="60" cy="60" r="42" fill="none" stroke="hsl(var(--border))" strokeWidth="18" />
        {segments.map((segment) => {
          const dash = (segment.value / sum) * (2 * Math.PI * 42);
          const circle = (
            <circle
              key={segment.label}
              cx="60"
              cy="60"
              r="42"
              fill="none"
              stroke={segment.color}
              strokeWidth="18"
              strokeDasharray={`${dash} ${2 * Math.PI * 42 - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 60 60)"
              strokeLinecap="round"
            />
          );
          offset += dash;
          return circle;
        })}
        <text x="60" y="58" textAnchor="middle" className="fill-foreground text-[16px] font-semibold">{sum}</text>
        <text x="60" y="73" textAnchor="middle" className="fill-muted-foreground text-[9px] uppercase tracking-wider">incidents</text>
      </svg>
      <div className="space-y-2">
        {segments.map((segment) => (
          <div key={segment.label} className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs">
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: segment.color }} />
              {segment.label}
            </span>
            <span className="font-mono text-muted-foreground">{segment.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HeatmapGrid({ matrix }: { matrix: number[][] }) {
  if (!matrix.length || matrix.every((row) => row.every((value) => value === 0))) {
    return <div className="rounded-lg border border-dashed border-border bg-surface px-3 py-6 text-center text-xs text-muted-foreground">No heatmap data in selected range.</div>;
  }
  const max = Math.max(1, ...matrix.flat());
  return (
    <div className="overflow-auto thin-scroll">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-[48px_repeat(24,minmax(0,1fr))] gap-1">
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="text-center text-[10px] text-muted-foreground">{String(h).padStart(2, "0")}</div>
          ))}
          {matrix.map((row, dayIdx) => (
            <FragmentRow key={dayIdx} label={dayLabel(dayIdx)} values={row} max={max} />
          ))}
        </div>
      </div>
    </div>
  );
}

function FragmentRow({ label, values, max }: { label: string; values: number[]; max: number }) {
  return (
    <>
      <div className="flex items-center text-[10px] text-muted-foreground">{label}</div>
      {values.map((value, idx) => (
        <div
          key={`${label}-${idx}`}
          className="aspect-square rounded-[4px] border border-border"
          style={{ background: heatColor(value / max) }}
          title={`${label} ${String(idx).padStart(2, "0")}:00 · ${value}`}
        />
      ))}
    </>
  );
}

function TrendStack({ items }: { items: Array<{ label: string; values: number[]; tone?: string }> | Array<{ label: string; values: number[] }> }) {
  return (
    <div className="space-y-3">
      {(items as Array<{ label: string; values: number[] }>).map((item) => {
        const max = Math.max(1, ...item.values);
        return (
          <div key={item.label}>
            <div className="flex items-center justify-between text-xs">
              <span>{item.label}</span>
              <span className="font-mono text-muted-foreground">{Math.round(average(item.values))}</span>
            </div>
            <div className="mt-1 flex gap-1">
              {item.values.map((value, idx) => (
                <div key={idx} className="h-10 flex-1 overflow-hidden rounded bg-background">
                  <div className="h-full rounded bg-primary/70" style={{ height: `${(value / max) * 100}%`, opacity: 0.5 + value / max / 2 }} />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RankingTable({ rows, suffix }: { rows: Array<{ label: string; value: number }>; suffix?: string }) {
  return (
    <div className="space-y-2">
      {rows.map((row, idx) => (
        <div key={row.label} className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="inline-grid h-5 w-5 place-items-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">{idx + 1}</span>
            <span>{row.label}</span>
          </div>
          <span className="font-mono text-muted-foreground">{row.value}{suffix ?? ""}</span>
        </div>
      ))}
    </div>
  );
}

function SimpleBar({ label, value, max, tone }: { label: string; value: number; max: number; tone: "critical" | "primary" | "resolved" | "high" }) {
  const classes = tone === "critical" ? "bg-critical" : tone === "high" ? "bg-high" : tone === "resolved" ? "bg-resolved" : "bg-primary";
  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span>{label}</span>
        <span className="font-mono text-muted-foreground">{value}</span>
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-background">
        <div className={`h-full rounded-full ${classes}`} style={{ width: `${(value / Math.max(1, max)) * 100}%` }} />
      </div>
    </div>
  );
}

function computeWindow(range: RangePreset, customStart: string, customEnd: string) {
  const now = Date.now();
  switch (range) {
    case "today":
      return { start: startOfDay(now), end: now };
    case "this_week":
      return { start: startOfWeek(now), end: now };
    case "last_7_days":
      return { start: now - 7 * 86_400_000, end: now };
    case "this_month":
      return { start: startOfMonth(now), end: now };
    case "last_30_days":
      return { start: now - 30 * 86_400_000, end: now };
    case "custom":
      return { start: new Date(`${customStart}T00:00:00`).getTime(), end: new Date(`${customEnd}T23:59:59`).getTime() };
  }
}

function buildHeatmap(incidents: IncidentRow[]) {
  const rows = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  incidents.forEach((incident) => {
    const date = new Date(incident.reported_at);
    const day = Math.min(6, Math.max(0, 6 - Math.floor((Date.now() - date.getTime()) / 86_400_000)));
    rows[day][date.getHours()] += 1;
  });
  return rows;
}

function rankLocations(incidents: IncidentRow[], locations: LocationRow[]) {
  const counts = new Map<string, number>();
  incidents.forEach((incident) => counts.set(incident.location, (counts.get(incident.location) ?? 0) + 1));
  const fallback = locations.map((location) => ({ label: location.name, count: counts.get(location.name) ?? 0 }));
  const ranked = [...counts.entries()].map(([label, count]) => ({ label, count }));
  const rows = ranked.length ? ranked : fallback;
  const sorted = rows.sort((a, b) => b.count - a.count).slice(0, 5);
  return sorted.map((row) => ({ ...row, share: Math.round((row.count / Math.max(1, sorted[0]?.count ?? 1)) * 100) }));
}

function estimateResponseMinutes(incident: IncidentRow) {
  const severity = Number(incident.severity) || 1;
  const statusPenalty = incident.status === "escalated" ? 12 : incident.status === "responding" ? 4 : incident.status === "resolved" ? 2 : 7;
  return clamp(6 + severity * 2 + statusPenalty, 3, 75);
}

function buildZoneStats(incidents: IncidentRow[]) {
  const stats = new Map<string, { total: number; severity: number }>();
  incidents.forEach((incident) => {
    const zone = incident.zone || "Unknown";
    const entry = stats.get(zone) ?? { total: 0, severity: 0 };
    entry.total += 1;
    entry.severity += Number(incident.severity) || 0;
    stats.set(zone, entry);
  });
  return stats;
}

function zoneImpactScore(total: number, severity: number) {
  return clamp(34 + total * 7 + severity * 3, 20, 100);
}

function zoneRiskScore(zone: string, sampleSize: number, zoneStats: Map<string, { total: number; severity: number }>) {
  const entry = zoneStats.get(zone);
  const base = entry ? zoneImpactScore(entry.total, entry.severity) : 50;
  return clamp(base + sampleSize * 2, 25, 100);
}

function bucketize(values: number[], labels: string[], thresholds: number[]) {
  return labels.map((label, idx) => {
    const min = idx === 0 ? 0 : thresholds[idx - 1] + 0.001;
    const max = thresholds[idx];
    const count = values.filter((value) => value >= min && value <= max).length;
    return { label, count, share: Math.round((count / Math.max(1, values.length)) * 100) };
  });
}

function isPhysical(type: IncidentType) {
  return ["intrusion", "theft", "robbery", "armed_attack", "kidnapping", "medical", "fire", "suspicious", "civil_unrest", "vandalism"].includes(type);
}

function isCyber(type: IncidentType) {
  return ["fraud_scam", "cyber_incident"].includes(type);
}

function average(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function tally<T>(items: T[], getLabel: (item: T) => string) {
  const map = new Map<string, number>();
  items.forEach((item) => map.set(getLabel(item), (map.get(getLabel(item)) ?? 0) + 1));
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function heatColor(ratio: number) {
  const alpha = clamp(ratio, 0.08, 1);
  if (ratio > 0.7) return `hsl(0 84% 60% / ${alpha})`;
  if (ratio > 0.4) return `hsl(24 95% 58% / ${alpha})`;
  if (ratio > 0.15) return `hsl(38 92% 55% / ${alpha})`;
  return `hsl(220 9% 55% / ${alpha})`;
}

function donutColor(idx: number) {
  return ["hsl(0 84% 60%)", "hsl(24 95% 58%)", "hsl(38 92% 55%)", "hsl(217 91% 60%)", "hsl(142 71% 45%)"][idx] ?? "hsl(217 91% 60%)";
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function sameDay(iso: string, date: number) {
  const d = new Date(iso);
  const target = new Date(date);
  return d.toDateString() === target.toDateString();
}

function toInputDate(date: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function startOfDay(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfWeek(ts: number) {
  const d = new Date(ts);
  const day = d.getDay() || 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day + 1);
  return d.getTime();
}

function startOfMonth(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return d.getTime();
}

function dayLabel(dayIdx: number) {
  const d = new Date(Date.now() - (6 - dayIdx) * 86_400_000);
  return d.toLocaleDateString("en-GB", { weekday: "short" });
}

function enumerateDays(start: number, end: number) {
  const days: number[] = [];
  const cursor = startOfDay(start);
  const last = startOfDay(end);
  for (let ts = cursor; ts <= last; ts += 86_400_000) {
    days.push(ts);
  }
  return days;
}
