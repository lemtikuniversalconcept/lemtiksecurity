import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import { requireSectionAccess } from "@/lib/rbac";
import { basemapOptions } from "@/lib/basemap";
import { useMapboxToken } from "@/components/LocationPicker";
import { Empty, Notice, PageHeader, Panel, Status } from "@/components/nw";
import { getVoyageReport, type VoyageReport } from "@/lib/voyages.functions";
import { routeLengthM, VOYAGE_STATUS } from "@/components/movement/Voyages";
import { CaseFileButton } from "@/components/CaseFileButton";

export const Route = createFileRoute("/app/movement_/voyages/$id")({
  head: () => ({ meta: [{ title: "Voyage report · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    requireSectionAccess(context.appAccess, ["security_manager", "operator", "client_admin"]);
  },
  component: VoyageReportPage,
});

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const dur = (s: number | null) => {
  if (s == null) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
};
const dist = (m: number) => `${(m / 1000).toFixed(1)} km · ${(m / 1852).toFixed(1)} nm`;
const delta = (planned: string | null, actual: string | null) => {
  if (!planned || !actual) return "";
  const min = Math.round((Date.parse(actual) - Date.parse(planned)) / 60_000);
  if (Math.abs(min) < 2) return " (on time)";
  return min > 0 ? ` (${min} min late)` : ` (${-min} min early)`;
};
const ALERT_LABEL: Record<string, string> = {
  sos: "SOS",
  man_overboard: "Man overboard",
  zone_enter: "Zone entered",
  zone_exit: "Zone left",
  silent: "Tracker silent",
  tracking_resumed: "Tracker back",
  unexpected_stop: "Unexpected stop",
  checkin: "Check-in",
  checkin_missed: "Missed check-in",
  off_route: "Off route",
  back_on_route: "Back on route",
  overdue: "Overdue",
  voyage_started: "Departed",
  voyage_completed: "Arrived",
  headcount_mismatch: "Head count mismatch",
  curfew: "Curfew",
  boarding_override: "Boarding override",
  handoff: "Handed off",
};

function VoyageReportPage() {
  const { id } = Route.useParams();
  const fn = useServerFn(getVoyageReport);
  const q = useQuery({ queryKey: ["voyage-report", id], queryFn: () => fn({ data: { id } }) });

  if (q.isLoading) return <span className="row g8 t3"><Loader2 className="h-4 w-4 animate-spin" /> Building the report…</span>;
  if (q.error || !q.data) return <Notice tone="fail">{(q.error as Error)?.message || "Couldn't load this voyage."}</Notice>;
  const r = q.data;
  const v = r.voyage;
  const planned = routeLengthM(v.route);
  const mismatch = v.departure_count != null && v.arrival_count != null && v.departure_count !== v.arrival_count;
  const serious = r.alerts.filter((a) => a.severity >= 4);

  return (
    <div className="col g16 voyage-report">
      <style>{`@media print {
        aside, nav, header:not(.vr-keep), .no-print { display: none !important; }
        body, .voyage-report { background: #fff !important; color: #000 !important; }
        .voyage-report * { color: #000 !important; border-color: #ccc !important; }
        .voyage-report .map { break-inside: avoid; }
      }`}</style>
      <div className="row g8 no-print">
        <Link to="/app/movement" className="b b-sm b-gh"><ArrowLeft size={14} /> Protected movement</Link>
        <span className="f1" />
        <CaseFileButton kind="voyage" id={id} />
        <button type="button" className="b b-sm b-pri" onClick={() => window.print()}><Printer size={14} /> Print or save as PDF</button>
      </div>
      <PageHeader title={v.name} sub={`Voyage report${r.organisation ? ` · ${r.organisation}` : ""} · generated ${when(r.generated_at)}`} />

      <div className="row g8 wrap">
        <Status tone={VOYAGE_STATUS[v.status].tone}>{VOYAGE_STATUS[v.status].label}</Status>
        {mismatch && <Status tone="fail">Head count mismatch</Status>}
        {serious.length > 0 && <Status tone="warn">{serious.length} serious alert{serious.length > 1 ? "s" : ""}</Status>}
      </div>

      <div className="kpis">
        <Stat label="Distance travelled" value={r.stats.positions > 1 ? dist(r.stats.distance_m) : "—"} />
        <Stat label="Time underway" value={dur(r.stats.duration_s)} />
        <Stat label="Average speed" value={r.stats.avg_speed_kn != null ? `${r.stats.avg_speed_kn} kn` : "—"} />
        <Stat label="Top speed" value={r.stats.max_speed_kn != null ? `${r.stats.max_speed_kn} kn` : "—"} />
        <Stat label="Positions recorded" value={String(r.stats.positions)} />
      </div>

      <div className="grid g16" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)" }}>
        <Panel title="Plan and actual">
          <div className="col g6" style={{ fontSize: 13 }}>
            <Row k="Boat or vehicle" val={r.subject ? `${r.subject.name}${r.subject.reference ? ` · ${r.subject.reference}` : ""}${r.subject.mmsi ? ` · MMSI ${r.subject.mmsi}` : ""}` : "Removed"} />
            <Row k="Planned route" val={v.route.length >= 2 ? `${v.route.length} waypoints · ${dist(planned)} · alert corridor ${(v.corridor_m / 1000).toFixed(1)} km` : "None set"} />
            <Row k="Planned departure" val={when(v.planned_departure)} />
            <Row k="Actual departure" val={`${when(v.departed_at)}${delta(v.planned_departure, v.departed_at)}`} />
            <Row k="Planned arrival" val={when(v.planned_arrival)} />
            <Row k="Actual arrival" val={v.arrived_at ? `${when(v.arrived_at)}${delta(v.planned_arrival, v.arrived_at)}` : v.status === "underway" ? "Still underway" : "—"} />
            <Row k="Head count" val={v.departure_count == null ? "Not recorded" : `${v.departure_count} departed${v.arrival_count != null ? ` · ${v.arrival_count} arrived` : ""}${mismatch ? " — MISMATCH" : ""}`} />
            {v.notes && <Row k="Notes" val={v.notes} />}
          </div>
        </Panel>
        <Panel title={`Crew and passengers (${v.crew.length})`}>
          {v.crew.length ? (
            <div className="col" style={{ fontSize: 13 }}>
              {v.crew.map((c, i) => <span key={i}>{i + 1}. {c.name}{c.role ? <span className="t3"> · {c.role}</span> : null}</span>)}
            </div>
          ) : (
            <Empty>No crew list was recorded.</Empty>
          )}
        </Panel>
      </div>

      <Panel title="Route" meta="Dashed: planned · Solid: actual track">
        <ReportMap report={r} />
      </Panel>

      <Panel title="Events" meta={r.alerts.length}>
        {r.alerts.length ? (
          <div className="col g4">
            {r.alerts.map((a, i) => (
              <div key={i} className="row g10" style={{ fontSize: 13, alignItems: "baseline" }}>
                <span className="t3 mono" style={{ width: 130, flex: "none" }}>{when(a.created_at)}</span>
                <span style={{ width: 150, flex: "none", fontWeight: a.severity >= 4 ? 700 : 500, color: a.severity >= 5 ? "var(--s5)" : a.severity >= 4 ? "var(--s4)" : undefined }}>{ALERT_LABEL[a.kind] ?? a.kind}</span>
                <span className="f1">{a.message}</span>
                <span className="t3" style={{ fontSize: 12 }}>{a.acknowledged_at ? `seen ${new Date(a.acknowledged_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : a.severity >= 3 ? "not acknowledged" : ""}</span>
              </div>
            ))}
          </div>
        ) : (
          <Empty>No events were recorded on this voyage.</Empty>
        )}
      </Panel>
      <span className="t3" style={{ fontSize: 12 }}>Positions come from the tracker on board; readings worse than ±100 m are left out of distance and the track. Speeds are from the tracker where it reports them.</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi">
      <span className="o-lbl">{label}</span>
      <b style={{ fontSize: 20 }}>{value}</b>
    </div>
  );
}

function Row({ k, val }: { k: string; val: string }) {
  return (
    <div className="row g10" style={{ alignItems: "baseline" }}>
      <span className="t3" style={{ width: 140, flex: "none" }}>{k}</span>
      <span className="f1">{val}</span>
    </div>
  );
}

function ReportMap({ report }: { report: VoyageReport }) {
  const { data: tokenData } = useMapboxToken();
  const token = tokenData?.token ?? "";
  const el = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!token || !el.current) return;
    const pts = [...report.voyage.route, ...report.track];
    if (!pts.length) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({ container: el.current, ...basemapOptions("day"), center: pts[0], zoom: 10, attributionControl: true, preserveDrawingBuffer: true } as any);
    map.on("load", () => {
      map.addSource("plan", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: report.voyage.route.length > 1 ? report.voyage.route : [] } } as any });
      map.addLayer({ id: "plan", type: "line", source: "plan", paint: { "line-color": "#4F8BFF", "line-width": 3, "line-dasharray": [2, 1.5] } });
      map.addSource("track", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: report.track.length > 1 ? report.track : [] } } as any });
      map.addLayer({ id: "track", type: "line", source: "track", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#E8590C", "line-width": 3.5 } });
      const b = new mapboxgl.LngLatBounds(pts[0], pts[0]);
      pts.forEach((p) => b.extend(p));
      map.fitBounds(b, { padding: 40, maxZoom: 14, duration: 0 });
    });
    return () => map.remove();
  }, [token, report]);

  if (!report.voyage.route.length && !report.track.length) return <Empty>No route was planned and no positions were recorded.</Empty>;
  return (
    <div className="map" style={{ height: 380, position: "relative" }}>
      <div ref={el} style={{ position: "absolute", inset: 0 }} />
      {!token && <div className="absolute inset-0 grid place-items-center t3"><Loader2 className="h-5 w-5 animate-spin" /></div>}
    </div>
  );
}
