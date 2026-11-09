import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { listIncidents, listIncidentStatusChanges } from "@/lib/incidents.functions";
import { listCheckIns, listPatrols } from "@/lib/patrols.functions";
import { requireSectionAccess } from "@/lib/rbac";
import { typeMeta, type IncidentType } from "@/lib/mockData";
import { Download, Loader2, Printer } from "lucide-react";
import { Empty, Kpi, Notice, Panel, Seg, Status, Tabs, Tag, type Tone } from "@/components/nw";

type Tab = "overview" | "incidents" | "patrols";
type Range = "today" | "7d" | "30d" | "month" | "custom";

type IncidentRow = { id: string; code: string; type: IncidentType; severity: number; status: string; location: string; zone: string; officer: string | null; reported_at: string };
type PatrolRow = { id: string; code: string; name: string; officer: string | null; status: string; waypoints: number; checked_in: number; archived_at?: string | null };
type CheckInRow = { id: string; patrol_id: string; status?: string; created_at: string };
type StatusChange = { incident_id: string; at: string; to: string | null };

const DAY = 86_400_000;
const RESPONDED = new Set(["acknowledged", "responding", "contained", "resolved", "closed", "escalated"]);
const RESOLVED = new Set(["resolved", "closed"]);
const SEV_COLOR = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)"];
const SEV_NAME = ["Minor", "Low", "Medium", "High", "Critical"];
const PATROL_TONE: Record<string, Tone> = { on_route: "ok", delayed: "warn", missed: "fail", complete: "off" };

export const Route = createFileRoute("/app/reports")({
  head: () => ({ meta: [{ title: "Analytics · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    const appAccess = context.appAccess;
    requireSectionAccess(appAccess, ["security_manager", "operator", "client_admin"]);
    return { appAccess };
  },
  component: Analytics,
});

function startOfDay(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function windowFor(range: Range, from: string, to: string) {
  const now = Date.now();
  const today = startOfDay(now);
  switch (range) {
    case "today":
      return { start: today, end: now, label: "Today" };
    case "7d":
      return { start: today - 6 * DAY, end: now, label: "Last 7 days" };
    case "30d":
      return { start: today - 29 * DAY, end: now, label: "Last 30 days" };
    case "month": {
      const d = new Date(now);
      return { start: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), end: now, label: d.toLocaleDateString("en-GB", { month: "long", year: "numeric" }) };
    }
    case "custom": {
      const s = from ? new Date(`${from}T00:00:00`).getTime() : today - 6 * DAY;
      const e = to ? new Date(`${to}T23:59:59`).getTime() : now;
      return { start: Math.min(s, e), end: Math.max(s, e), label: `${new Date(Math.min(s, e)).toLocaleDateString("en-GB")} – ${new Date(Math.max(s, e)).toLocaleDateString("en-GB")}` };
    }
  }
}

function median(values: number[]) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function fmtMinutes(min: number | null) {
  if (min == null) return "—";
  if (min < 1) return `${Math.round(min * 60)}s`;
  if (min < 60) return `${Math.round(min)}m`;
  if (min < 48 * 60) return `${Math.floor(min / 60)}h ${Math.round(min % 60)}m`;
  return `${Math.round(min / 1440)}d`;
}

function toInputDate(t: number) {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function Analytics() {
  const { appAccess } = Route.useRouteContext();
  const listInc = useServerFn(listIncidents);
  const listChanges = useServerFn(listIncidentStatusChanges);
  const listPat = useServerFn(listPatrols);
  const listCi = useServerFn(listCheckIns);

  const [tab, setTab] = useState<Tab>("overview");
  const [range, setRange] = useState<Range>("7d");
  const [from, setFrom] = useState(toInputDate(Date.now() - 6 * DAY));
  const [to, setTo] = useState(toInputDate(Date.now()));
  const [zone, setZone] = useState("");
  const win = useMemo(() => windowFor(range, from, to), [range, from, to]);
  const prevStart = win.start - (win.end - win.start);

  const { data: incidents = [], isLoading, error } = useQuery({ queryKey: ["analytics-incidents"], queryFn: () => listInc() as Promise<IncidentRow[]> });
  const { data: changes = [], isError: changesError } = useQuery({
    queryKey: ["analytics-status-changes", win.start],
    queryFn: () => listChanges({ data: { since: new Date(win.start).toISOString() } }) as Promise<StatusChange[]>,
  });
  const { data: patrols = [] } = useQuery({ queryKey: ["analytics-patrols"], queryFn: () => listPat() as Promise<PatrolRow[]> });
  const { data: checkins = [] } = useQuery({ queryKey: ["analytics-checkins"], queryFn: () => listCi({ data: {} }) as unknown as Promise<CheckInRow[]> });

  const zones = useMemo(() => Array.from(new Set((incidents as IncidentRow[]).map((i) => i.zone).filter(Boolean))).sort(), [incidents]);
  const inZone = (i: IncidentRow) => !zone || i.zone === zone;
  const inWindow = useMemo(
    () => (incidents as IncidentRow[]).filter((i) => inZone(i) && Date.parse(i.reported_at) >= win.start && Date.parse(i.reported_at) <= win.end),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [incidents, win, zone],
  );
  const prevCount = useMemo(
    () => (incidents as IncidentRow[]).filter((i) => inZone(i) && Date.parse(i.reported_at) >= prevStart && Date.parse(i.reported_at) < win.start).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [incidents, prevStart, win.start, zone],
  );

  // Real timings from the activity log: the first move out of "reported", and the first move to resolved/closed.
  const timings = useMemo(() => {
    const byIncident = new Map<string, { responded?: number; resolved?: number }>();
    for (const c of changes as StatusChange[]) {
      if (!c.to) continue;
      const t = Date.parse(c.at);
      const entry = byIncident.get(c.incident_id) ?? {};
      if (RESPONDED.has(c.to) && entry.responded == null) entry.responded = t;
      if (RESOLVED.has(c.to) && entry.resolved == null) entry.resolved = t;
      byIncident.set(c.incident_id, entry);
    }
    const response: number[] = [];
    const resolution: number[] = [];
    for (const i of inWindow) {
      const e = byIncident.get(i.id);
      const rep = Date.parse(i.reported_at);
      if (e?.responded != null && e.responded >= rep) response.push((e.responded - rep) / 60000);
      if (e?.resolved != null && e.resolved >= rep) resolution.push((e.resolved - rep) / 60000);
    }
    return { response, resolution };
  }, [changes, inWindow]);

  const resolvedNow = inWindow.filter((i) => RESOLVED.has(i.status)).length;
  const escalated = inWindow.filter((i) => i.status === "escalated").length;
  const delta = prevCount ? Math.round(((inWindow.length - prevCount) / prevCount) * 100) : null;

  const exportCsv = () => {
    const headers = ["code", "type", "severity", "status", "location", "zone", "officer", "reported_at"] as const;
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [headers.join(","), ...inWindow.map((i) => headers.map((h) => esc(i[h])).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `lemtik-incidents-${toInputDate(win.start)}-to-${toInputDate(win.end)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="col g16">
      <div className="row g12 wrap">
        <div className="col">
          <h1 className="ph1">Analytics</h1>
          <span className="sub">
            {win.label} · {appAccess.orgName} · {zone || "all zones"}
          </span>
        </div>
        <span className="flex-auto" />
        <Seg
          label="Time range"
          value={range}
          onChange={setRange}
          options={[
            { value: "today", label: "Today" },
            { value: "7d", label: "7 days" },
            { value: "30d", label: "30 days" },
            { value: "month", label: "This month" },
            { value: "custom", label: "Custom" },
          ]}
        />
        {range === "custom" && (
          <>
            <input className="in mono" type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: "auto" }} />
            <input className="in mono" type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: "auto" }} />
          </>
        )}
        <select className="in" style={{ width: "auto" }} value={zone} onChange={(e) => setZone(e.target.value)} aria-label="Zone">
          <option value="">Zone: all</option>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
        <button type="button" className="b b-sec" onClick={exportCsv} disabled={!inWindow.length}>
          <Download className="h-4 w-4" /> Export CSV
        </button>
        <button type="button" className="b b-gh" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Print
        </button>
      </div>

      <Tabs
        label="Analytics views"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "overview", label: "Overview" },
          { value: "incidents", label: "Incidents", count: inWindow.length },
          { value: "patrols", label: "Patrols", count: patrols.length },
        ]}
      />

      {error ? (
        <Notice tone="fail">Incidents couldn't be loaded. {(error as Error).message}</Notice>
      ) : isLoading ? (
        <Panel>
          <Empty>
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
          </Empty>
        </Panel>
      ) : (
        <>
          <div className="kpis">
            <Kpi
              label="Incidents"
              value={inWindow.length}
              delta={delta == null ? (prevCount === 0 && inWindow.length ? "None in the previous period" : undefined) : `${delta > 0 ? "▲" : delta < 0 ? "▼" : ""} ${Math.abs(delta)}% vs previous period`}
              deltaClass={delta != null && delta > 0 ? "up-bad" : delta != null && delta < 0 ? "good" : ""}
            />
            <Kpi
              label="Median response"
              value={fmtMinutes(median(timings.response))}
              delta={timings.response.length ? `From report to first status change · ${timings.response.length} measured` : "No status changes logged yet"}
              title="Time from an incident being reported to its first move out of 'reported', from the incident activity log"
            />
            <Kpi label="Median time to resolve" value={fmtMinutes(median(timings.resolution))} delta={timings.resolution.length ? `${timings.resolution.length} resolved in range` : undefined} />
            <Kpi label="Resolved" value={inWindow.length ? `${Math.round((resolvedNow / inWindow.length) * 100)}%` : "—"} delta={`${resolvedNow} of ${inWindow.length}`} />
            <Kpi label="Escalated" value={escalated} delta="Currently marked escalated" />
          </div>
          {changesError && <Notice tone="warn">Response times couldn't be loaded from the activity log, so they show as —.</Notice>}

          {tab === "overview" && <Overview incidents={inWindow} win={win} />}
          {tab === "incidents" && <IncidentsView incidents={inWindow} response={timings.response} />}
          {tab === "patrols" && <PatrolsView patrols={patrols as PatrolRow[]} checkins={(checkins as CheckInRow[]).filter((c) => Date.parse(c.created_at) >= win.start && Date.parse(c.created_at) <= win.end)} />}
        </>
      )}
    </div>
  );
}

function ChartTableToggle({ value, onChange }: { value: "chart" | "table"; onChange: (v: "chart" | "table") => void }) {
  return (
    <Seg
      label="View as"
      value={value}
      onChange={onChange}
      options={[
        { value: "chart", label: "Chart" },
        { value: "table", label: "Table" },
      ]}
    />
  );
}

function Overview({ incidents, win }: { incidents: IncidentRow[]; win: { start: number; end: number } }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const days = useMemo(() => {
    const out: { t: number; count: number }[] = [];
    for (let t = startOfDay(win.start); t <= win.end; t += DAY) out.push({ t, count: 0 });
    for (const i of incidents) {
      const idx = Math.floor((startOfDay(Date.parse(i.reported_at)) - startOfDay(win.start)) / DAY);
      if (out[idx]) out[idx].count += 1;
    }
    return out.slice(-62);
  }, [incidents, win]);
  const peak = days.reduce((m, d) => (d.count > m.count ? d : m), days[0] ?? { t: 0, count: 0 });
  const avg = days.length ? incidents.length / days.length : 0;
  const sev = [1, 2, 3, 4, 5].map((s) => incidents.filter((i) => Math.max(1, Math.min(5, Number(i.severity))) === s).length);
  const byType = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of incidents) m.set(typeMeta[i.type] ?? i.type, (m.get(typeMeta[i.type] ?? i.type) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [incidents]);

  if (!incidents.length) {
    return (
      <Panel>
        <Empty>No incidents were reported in this period.</Empty>
      </Panel>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Panel title="Incidents per day" meta={`Average ${avg.toFixed(1)} · peak ${peak.count} on ${new Date(peak.t).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}`} actions={<ChartTableToggle value={view} onChange={setView} />}>
        {view === "chart" ? (
          <DayBars days={days} />
        ) : (
          <div className="scroll" style={{ maxHeight: 260 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Incidents</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.t}>
                    <td>{new Date(d.t).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</td>
                    <td className="mono">{d.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="col g16">
        <Panel title="By severity" meta={`${incidents.length} total`}>
          <div className="col g10">
            <div className="row" style={{ gap: 2, height: 12 }} role="img" aria-label={sev.map((n, i) => `${SEV_NAME[i]} ${n}`).join(", ")}>
              {[4, 3, 2, 1, 0].map((i) =>
                sev[i] ? <span key={i} title={`${SEV_NAME[i]}: ${sev[i]}`} style={{ flex: sev[i], height: "100%", background: SEV_COLOR[i], borderRadius: 4 }} /> : null,
              )}
            </div>
            <div className="row g12 wrap t2" style={{ fontSize: 12 }}>
              {[4, 3, 2, 1, 0].map((i) => (
                <span key={i} className="row g6">
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: SEV_COLOR[i] }} />
                  {SEV_NAME[i]} · <span className="mono">{sev[i]}</span>
                </span>
              ))}
            </div>
          </div>
        </Panel>
        <Panel title="By type">
          <HBars rows={byType} />
        </Panel>
      </div>
    </div>
  );
}

function DayBars({ days }: { days: { t: number; count: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.count));
  const [hover, setHover] = useState<number | null>(null);
  const step = Math.max(1, Math.ceil(days.length / 10));
  return (
    <div className="col g6">
      <div className="relative" style={{ height: 200 }}>
        {[0.5, 1].map((f) => (
          <div key={f} className="absolute left-0 right-0" style={{ bottom: `${f * 100}%`, borderTop: "1px dashed var(--line-1)" }}>
            <span className="mono t3" style={{ fontSize: 10, position: "absolute", left: 0, top: -14 }}>
              {Math.round(max * f)}
            </span>
          </div>
        ))}
        <div className="absolute inset-0 row" style={{ alignItems: "flex-end", gap: 2, paddingLeft: 22 }} onMouseLeave={() => setHover(null)}>
          {days.map((d, i) => (
            <div key={d.t} className="f1 relative" style={{ height: "100%", display: "flex", alignItems: "flex-end" }} onMouseEnter={() => setHover(i)}>
              <div
                style={{
                  width: "100%",
                  maxWidth: 28,
                  margin: "0 auto",
                  height: `${(d.count / max) * 100}%`,
                  minHeight: d.count ? 3 : 0,
                  background: hover === i ? "var(--blue-hi)" : "var(--blue)",
                  borderRadius: "4px 4px 0 0",
                }}
              />
              {hover === i && (
                <div className="glass" style={{ position: "absolute", bottom: "calc(100% + 4px)", left: "50%", transform: "translateX(-50%)", padding: "4px 8px", fontSize: 12, whiteSpace: "nowrap", zIndex: 2, pointerEvents: "none" }}>
                  <div className="mono t3">{new Date(d.t).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</div>
                  <b>{d.count}</b> incident{d.count === 1 ? "" : "s"}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="row" style={{ gap: 2, paddingLeft: 22 }}>
        {days.map((d, i) => (
          <span key={d.t} className="f1 mono t3" style={{ fontSize: 10, textAlign: "center", visibility: i % step === 0 ? "visible" : "hidden", whiteSpace: "nowrap" }}>
            {new Date(d.t).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
          </span>
        ))}
      </div>
    </div>
  );
}

function HBars({ rows, suffix = "" }: { rows: [string, number][]; suffix?: string }) {
  if (!rows.length) return <Empty>Nothing to show.</Empty>;
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <div className="col g8">
      {rows.map(([label, n]) => (
        <div key={label} className="row g10" title={`${label}: ${n}${suffix}`}>
          <span className="trunc" style={{ width: 150, fontSize: 12.5 }}>
            {label}
          </span>
          <div className="f1" style={{ height: 8 }}>
            <div style={{ width: `${(n / max) * 100}%`, height: "100%", background: "var(--blue)", borderRadius: 4, minWidth: n ? 4 : 0 }} />
          </div>
          <span className="mono t2" style={{ width: 44, textAlign: "right", fontSize: 12 }}>
            {n}
            {suffix}
          </span>
        </div>
      ))}
    </div>
  );
}

function IncidentsView({ incidents, response }: { incidents: IncidentRow[]; response: number[] }) {
  const heat = useMemo(() => {
    const m = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
    for (const i of incidents) {
      const d = new Date(i.reported_at);
      m[(d.getDay() + 6) % 7][d.getHours()] += 1;
    }
    return m;
  }, [incidents]);
  const heatMax = Math.max(1, ...heat.flat());
  const zones = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of incidents) m.set(i.zone || "No zone", (m.get(i.zone || "No zone") ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [incidents]);
  const buckets: [string, number][] = [
    ["Under 5 min", response.filter((m) => m < 5).length],
    ["5–15 min", response.filter((m) => m >= 5 && m < 15).length],
    ["15–30 min", response.filter((m) => m >= 15 && m < 30).length],
    ["30–60 min", response.filter((m) => m >= 30 && m < 60).length],
    ["Over 1 hour", response.filter((m) => m >= 60).length],
  ];
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  if (!incidents.length) {
    return (
      <Panel>
        <Empty>No incidents were reported in this period.</Empty>
      </Panel>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Panel title="When incidents are reported" meta="Day of week × hour, local time">
        <div className="scroll">
          <div className="col" style={{ gap: 2, minWidth: 560 }}>
            {heat.map((row, d) => (
              <div key={d} className="row" style={{ gap: 2 }}>
                <span className="mono t3" style={{ width: 30, fontSize: 10 }}>
                  {DAYS[d]}
                </span>
                {row.map((n, h) => (
                  <span
                    key={h}
                    className="f1"
                    title={`${DAYS[d]} ${String(h).padStart(2, "0")}:00 · ${n} incident${n === 1 ? "" : "s"}`}
                    style={{ height: 18, borderRadius: 3, background: n ? `color-mix(in oklab, var(--blue) ${20 + (n / heatMax) * 80}%, var(--ink-2))` : "var(--ink-2)" }}
                  />
                ))}
              </div>
            ))}
            <div className="row" style={{ gap: 2 }}>
              <span style={{ width: 30 }} />
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h} className="f1 mono t3" style={{ fontSize: 9, textAlign: "center", visibility: h % 3 === 0 ? "visible" : "hidden" }}>
                  {String(h).padStart(2, "0")}
                </span>
              ))}
            </div>
            <div className="row g6 t3" style={{ fontSize: 11, marginTop: 6 }}>
              Fewer
              {[20, 47, 73, 100].map((p) => (
                <span key={p} style={{ width: 14, height: 10, borderRadius: 2, background: `color-mix(in oklab, var(--blue) ${p}%, var(--ink-2))` }} />
              ))}
              More · busiest cell {heatMax}
            </div>
          </div>
        </div>
      </Panel>
      <div className="col g16">
        <Panel title="Top zones">
          <HBars rows={zones} />
        </Panel>
        <Panel title="Response times" meta={response.length ? `${response.length} incidents measured` : undefined}>
          {response.length ? <HBars rows={buckets} /> : <Empty>No status changes logged for incidents in this period yet.</Empty>}
        </Panel>
      </div>
    </div>
  );
}

function PatrolsView({ patrols, checkins }: { patrols: PatrolRow[]; checkins: CheckInRow[] }) {
  const active = patrols.filter((p) => !p.archived_at);
  const rows = active
    .map((p) => {
      const mine = checkins.filter((c) => c.patrol_id === p.id);
      return {
        ...p,
        completion: Math.round((Number(p.checked_in ?? 0) / Math.max(Number(p.waypoints ?? 1), 1)) * 100),
        total: mine.length,
        exceptions: mine.filter((c) => !!c.status && c.status !== "on_time").length,
      };
    })
    .sort((a, b) => b.completion - a.completion);
  const totalCi = rows.reduce((a, r) => a + r.total, 0);
  const totalEx = rows.reduce((a, r) => a + r.exceptions, 0);

  if (!rows.length) {
    return (
      <Panel>
        <Empty>No patrol routes yet.</Empty>
      </Panel>
    );
  }

  return (
    <Panel title="Routes" meta={`${totalCi} check-ins in range · ${totalEx} late or out of zone`} bodyClassName="">
      <div className="scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>Route</th>
              <th>Officer</th>
              <th>Current round</th>
              <th>Status</th>
              <th>Check-ins in range</th>
              <th>On time</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <div className="col">
                    <b>{r.name}</b>
                    <span className="mono t3" style={{ fontSize: 11 }}>
                      {r.code}
                    </span>
                  </div>
                </td>
                <td>{r.officer ?? "—"}</td>
                <td style={{ minWidth: 140 }}>
                  <div className="row g8">
                    <div className="prog f1">
                      <i style={{ width: `${r.completion}%` }} />
                    </div>
                    <span className="mono t3" style={{ fontSize: 11 }}>
                      {r.checked_in}/{r.waypoints}
                    </span>
                  </div>
                </td>
                <td>
                  <Status tone={PATROL_TONE[r.status] ?? "neutral"}>{r.status.replace(/_/g, " ")}</Status>
                </td>
                <td className="mono">{r.total}</td>
                <td>{r.total ? <Tag tone={r.exceptions / r.total > 0.2 ? "warn" : "ok"}>{Math.round(((r.total - r.exceptions) / r.total) * 100)}%</Tag> : <span className="t3">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
