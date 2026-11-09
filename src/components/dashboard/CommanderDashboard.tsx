import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import "mapbox-gl/dist/mapbox-gl.css";
import { toast } from "sonner";
import {
  ArrowRight,
  Car,
  FileText,
  Fuel,
  Layers,
  Loader2,
  LocateFixed,
  Maximize2,
  Minus,
  OctagonAlert,
  Plus,
  Radar,
  Route as RouteIcon,
  Siren,
  Sparkles,
  Timer,
  UserCheck,
  X,
} from "lucide-react";
import { listIncidents } from "@/lib/incidents.functions";
import { listPatrols, listCheckIns } from "@/lib/patrols.functions";
import { listMembers, listLocations } from "@/lib/orgs.functions";
import { listVehicles } from "@/lib/inventory.functions";
import { getMapboxToken } from "@/lib/config.functions";
import { submitAiQuery, type AiQueryResult } from "@/lib/ai-commands.functions";
import { ProposalCard, useIncidentProposals, useProposalDecisions } from "@/components/AiProposals";
import { useRealtimeInvalidate } from "@/lib/useRealtime";
import { typeMeta, type IncidentType } from "@/lib/mockData";
import type { AppAccess } from "@/lib/rbac";
import { Avatar, Kpi, Lifecycle, PageHeader, Seg, Sev, Tabs, elapsed, timeAgo, toSev, useNow } from "@/components/nw";

type MapboxModule = typeof import("mapbox-gl");
type MapboxMap = import("mapbox-gl").Map;
type MapboxMarker = import("mapbox-gl").Marker;
type MapboxGeoJSONSource = import("mapbox-gl").GeoJSONSource;

type IncidentRow = {
  id: string;
  code: string;
  type: string;
  severity: number;
  status: string;
  location: string;
  zone: string;
  officer: string | null;
  reported_at: string;
  coord_x?: number | null;
  coord_y?: number | null;
  description?: string | null;
  title?: string | null;
  dispatch_plan?: { recommended_actions?: unknown } | null;
  agent_output?: { recommended_actions?: unknown } | null;
};

type PatrolRow = {
  id: string;
  code: string;
  name: string;
  officer: string;
  shift: string;
  waypoints: number;
  checked_in: number;
  status: string;
  location_id?: string | null;
  next_check_in?: string | null;
};

type MemberRow = { id: string; user_id: string; role: string; profile?: { display_name?: string | null; status?: string | null } | null };
type LocationRow = { id: string; name: string; coord_x?: number | null; coord_y?: number | null; geofence?: unknown };
type CheckInRow = { id: string; patrol_id?: string | null; created_at: string };
type VehicleRow = { id: string; vehicle_id: string; status: string; fuel_percentage: number | null };

type Window = "live" | "24h" | "7d";
const WINDOW_MS: Record<Exclude<Window, "live">, number> = { "24h": 86_400_000, "7d": 7 * 86_400_000 };
const LAGOS: [number, number] = [3.4219, 6.4281];
const isOpen = (i: IncidentRow) => i.status !== "resolved" && i.status !== "closed";
const incidentTitle = (i: IncidentRow) => i.title || typeMeta[i.type as IncidentType] || "Incident";

export function CommanderDashboard({ access, ask }: { access: AppAccess; ask?: string }) {
  const readOnly = access.specRole === "client_admin";
  const navigate = useNavigate();
  const loadIncidents = useServerFn(listIncidents);
  const loadPatrols = useServerFn(listPatrols);
  const loadMembers = useServerFn(listMembers);
  const loadLocations = useServerFn(listLocations);
  const loadCheckIns = useServerFn(listCheckIns);
  const loadToken = useServerFn(getMapboxToken);
  const loadVehicles = useServerFn(listVehicles);
  const runQuery = useServerFn(submitAiQuery);

  useRealtimeInvalidate("incidents", [["command-incidents"]]);
  useRealtimeInvalidate("patrols", [["command-patrols"]]);
  useRealtimeInvalidate("patrol_check_ins", [["command-checkins"]]);

  const { data: incidents = [], isLoading: incidentsLoading } = useQuery({ queryKey: ["command-incidents"], queryFn: () => loadIncidents() as Promise<IncidentRow[]> });
  const { data: patrols = [] } = useQuery({ queryKey: ["command-patrols"], queryFn: () => loadPatrols() as Promise<PatrolRow[]> });
  const { data: members = [] } = useQuery({ queryKey: ["command-members"], queryFn: () => loadMembers() as Promise<MemberRow[]> });
  const { data: locations = [] } = useQuery({ queryKey: ["command-locations"], queryFn: () => loadLocations() as Promise<LocationRow[]> });
  const { data: checkIns = [] } = useQuery({ queryKey: ["command-checkins"], queryFn: () => loadCheckIns() as Promise<CheckInRow[]> });
  const { data: vehicles = [] } = useQuery({ queryKey: ["command-vehicles"], queryFn: () => loadVehicles() as Promise<VehicleRow[]> });
  const { data: tokenData } = useQuery({ queryKey: ["command-mapbox-token"], queryFn: () => loadToken(), staleTime: Infinity });

  const [win, setWin] = useState<Window>("live");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [intent, setIntent] = useState<AiQueryResult | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!ask) {
      setIntent(null);
      return;
    }
    let cancelled = false;
    setAsking(true);
    runQuery({ data: { text: ask, context: { scope: "incidents", org_id: access.orgId } } })
      .then((result) => !cancelled && setIntent(result as AiQueryResult))
      .catch((err) => !cancelled && toast.error("Couldn't run that question", { description: err instanceof Error ? err.message : undefined }))
      .finally(() => !cancelled && setAsking(false));
    return () => {
      cancelled = true;
    };
  }, [ask, access.orgId, runQuery]);

  const safeIncidents = Array.isArray(incidents) ? incidents : [];
  const safePatrols = Array.isArray(patrols) ? patrols : [];
  const safeVehicles = Array.isArray(vehicles) ? vehicles : [];
  const safeMembers = Array.isArray(members) ? members : [];

  const windowed = useMemo(() => {
    const base = win === "live" ? safeIncidents.filter(isOpen) : safeIncidents.filter((i) => Date.now() - new Date(i.reported_at).getTime() <= WINDOW_MS[win]);
    return [...base].sort((a, b) => Number(b.severity) - Number(a.severity) || new Date(a.reported_at).getTime() - new Date(b.reported_at).getTime());
  }, [safeIncidents, win]);

  const queue = useMemo(() => (intent ? windowed.filter((i) => matchesIntent(i, intent)) : windowed), [intent, windowed]);
  const selected = queue.find((i) => i.id === selectedId) ?? queue[0] ?? null;

  const openNow = safeIncidents.filter(isOpen);
  const critical = windowed.filter((i) => Number(i.severity) >= 4);
  const s5 = critical.filter((i) => Number(i.severity) >= 5).length;
  const lastHour = safeIncidents.filter((i) => Date.now() - new Date(i.reported_at).getTime() <= 3_600_000).length;

  const officers = safeMembers.filter((m) => m.role === "officer");
  const roster = officers.length ? officers : safeMembers;
  const statusOf = (m: MemberRow) => (m.profile?.status ?? "").toLowerCase();
  const onDuty = roster.filter((m) => statusOf(m) === "on-duty").length;
  const onBreak = roster.filter((m) => statusOf(m) === "break").length;

  const activePatrols = useMemo(() => safePatrols.filter((p) => p.status !== "complete"), [safePatrols]);
  const latePatrols = safePatrols.filter((p) => p.status === "delayed");
  const missedPatrols = safePatrols.filter((p) => p.status === "missed");
  const compliance = safePatrols.length
    ? Math.round((safePatrols.reduce((acc, p) => acc + p.checked_in / Math.max(p.waypoints || 1, 1), 0) / safePatrols.length) * 100)
    : null;

  const avgOpenMinutes = openNow.length
    ? Math.round(openNow.reduce((acc, i) => acc + (Date.now() - new Date(i.reported_at).getTime()) / 60000, 0) / openNow.length)
    : null;

  const available = safeVehicles.filter((v) => v.status === "available").length;
  const deployed = safeVehicles.filter((v) => v.status === "deployed" || v.status === "responding").length;
  const lowFuel = safeVehicles.filter((v) => v.status === "low_fuel" || (v.fuel_percentage != null && v.fuel_percentage < 25));

  const openCritical = openNow.filter((i) => Number(i.severity) >= 4).length;
  const riskIndex = Math.min(100, openCritical * 25 + openNow.length * 10 + (latePatrols.length + missedPatrols.length) * 15);
  const busiestZone = useMemo(() => {
    const counts = new Map<string, number>();
    openNow.forEach((i) => i.zone && counts.set(i.zone, (counts.get(i.zone) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }, [openNow]);

  const winLabel = win === "live" ? "Open incidents" : win === "24h" ? "Incidents · 24 h" : "Incidents · 7 days";
  const clearAsk = () => navigate({ to: "/app", search: {} });

  return (
    <div className="col g12 min-[1100px]:h-[calc(100dvh-var(--shell-top,52px)-32px)] min-[1100px]:min-h-[700px]">
      <PageHeader
        title="Command overview"
        sub={`${access.orgName} · ${access.roleLabel}${readOnly ? " · view only" : ""}`}
      >
        <Seg
          label="Time window"
          value={win}
          onChange={setWin}
          options={[
            { value: "live", label: "Live" },
            { value: "24h", label: "Last 24 h" },
            { value: "7d", label: "7 days" },
          ]}
        />
        <Link to="/app/report-centre" className="b b-sec">
          <FileText size={15} strokeWidth={1.75} className="ic" />
          Shift report
        </Link>
        {!readOnly && (
          <Link to="/app/incidents" search={{ new: true }} className="b b-pri">
            <Plus size={15} strokeWidth={1.75} className="ic" />
            Log incident
          </Link>
        )}
      </PageHeader>

      {(ask || intent) && <IntentBar ask={ask} intent={intent} asking={asking} matches={queue.length} onClear={clearAsk} />}

      <div className="kpis">
        <Kpi
          icon={<Siren size={13} strokeWidth={1.75} className="ic" />}
          label={winLabel}
          value={windowed.length}
          delta={win === "live" ? `${lastHour} in the last hour` : `${windowed.filter(isOpen).length} still open`}
        />
        <Kpi
          icon={<OctagonAlert size={13} strokeWidth={1.75} className="ic" />}
          label="Critical · S4+"
          value={critical.length}
          delta={critical.length ? `S5 ×${s5} · S4 ×${critical.length - s5}` : "None"}
          deltaClass={critical.length ? "up-bad" : ""}
        />
        <Kpi
          icon={<UserCheck size={13} strokeWidth={1.75} className="ic" />}
          label="Officers on duty"
          value={roster.length ? onDuty : "—"}
          unit={roster.length ? `/ ${roster.length}` : undefined}
          delta={roster.length ? `${onBreak} on break · ${Math.max(0, roster.length - onDuty - onBreak)} off` : "No officers yet"}
        />
        <Kpi
          icon={<RouteIcon size={13} strokeWidth={1.75} className="ic" />}
          label="Patrol compliance"
          value={compliance == null ? "—" : `${compliance}%`}
          delta={safePatrols.length ? `${activePatrols.length} active · ${latePatrols.length + missedPatrols.length} late or missed` : "No patrols set up"}
          deltaClass={latePatrols.length + missedPatrols.length ? "dn-bad" : ""}
        />
        <Kpi
          icon={<Timer size={13} strokeWidth={1.75} className="ic" />}
          label="Avg open time"
          value={avgOpenMinutes == null ? "—" : formatMinutes(avgOpenMinutes)}
          delta={openNow.length ? `across ${openNow.length} open` : "Nothing open"}
        />
        <Kpi
          icon={<Car size={13} strokeWidth={1.75} className="ic" />}
          label="Vehicles ready"
          value={safeVehicles.length ? available : "—"}
          unit={safeVehicles.length ? `/ ${safeVehicles.length}` : undefined}
          delta={safeVehicles.length ? `${deployed} deployed` : "No vehicles registered"}
        />
        <Kpi
          icon={<Fuel size={13} strokeWidth={1.75} className="ic" />}
          label="Fuel"
          value={safeVehicles.length ? `${lowFuel.length} low` : "—"}
          delta={safeVehicles.length ? (lowFuel.length ? `${lowFuel.slice(0, 3).map((v) => v.vehicle_id).join(", ")} under 25%` : "All above 25%") : "—"}
          deltaClass={lowFuel.length ? "warnc" : ""}
        />
        <Kpi
          title="Index from open incidents (×10), open S4+ incidents (×25) and late or missed patrols (×15), capped at 100."
          icon={<Radar size={13} strokeWidth={1.75} className="ic" />}
          label="Risk index"
          value={riskIndex}
          unit="/ 100"
          delta={riskIndex >= 70 ? `Elevated${busiestZone ? ` · ${busiestZone}` : ""}` : riskIndex >= 40 ? "Watch" : "Managed"}
          deltaClass={riskIndex >= 70 ? "warnc" : ""}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-wrap gap-3">
        <div className="col g12 min-h-0" style={{ flex: "999 1 560px", minWidth: 0 }}>
          <OverviewMap
            incidents={queue}
            patrols={activePatrols}
            locations={locations}
            orgName={access.orgName}
            token={tokenData?.token ?? ""}
            selected={selected}
            onSelect={setSelectedId}
          />
          <PatrolPulse patrols={activePatrols} checkIns={checkIns} late={latePatrols.length} missed={missedPatrols.length} />
        </div>
        <div className="col g12 min-h-0" style={{ flex: "1 1 380px", minWidth: 0, maxWidth: "100%" }}>
          <DecisionPanel incident={selected} orgId={access.orgId} readOnly={readOnly} actor={access.displayName || access.email || "You"} />
          <IncidentQueue
            incidents={queue}
            loading={incidentsLoading}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
            me={access.displayName}
            win={win}
          />
        </div>
      </div>
    </div>
  );
}

function matchesIntent(incident: IncidentRow, intent: AiQueryResult) {
  const { query, severityMin, status, location, zone, target } = intent.filters;
  const haystack = [incident.code, incident.location, incident.zone, incident.officer, incident.title, incident.description, incident.type]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (query && !haystack.includes(query)) {
    const tokens = query.split(/\s+/).filter(Boolean);
    if (tokens.length && !tokens.every((t) => haystack.includes(t))) return false;
  }
  if (severityMin != null && Number(incident.severity) < severityMin) return false;
  if (status && status !== "open" && status !== "active" && String(incident.status).toLowerCase() !== status.toLowerCase()) return false;
  if (location && !`${incident.location} ${incident.zone}`.toLowerCase().includes(location.toLowerCase())) return false;
  if (zone && !incident.zone.toLowerCase().includes(zone.toLowerCase())) return false;
  if (target && !`${incident.code} ${incident.description ?? ""}`.toLowerCase().includes(target.toLowerCase())) return false;
  return true;
}

function IntentBar({ ask, intent, asking, matches, onClear }: { ask?: string; intent: AiQueryResult | null; asking: boolean; matches: number; onClear: () => void }) {
  const fromModel = intent && !String(intent.request_id ?? "").startsWith("local-");
  return (
    <div className={`${fromModel ? "ai" : "card"} row g10 wrap`} style={{ padding: "8px 12px" }} role="status">
      {fromModel ? <Sparkles size={15} strokeWidth={1.75} className="ic" style={{ color: "var(--ai)" }} /> : <Layers size={15} strokeWidth={1.75} className="ic t3" />}
      <span className="f1 trunc" style={{ fontSize: 12.5 }}>
        {asking ? (
          <span className="t2">Working on “{ask}”…</span>
        ) : intent ? (
          <>
            <b>{fromModel ? "Lemtik filtered for" : "Keyword filter"}</b> <span className="t2">“{intent.text}”</span>
            <span className="t3"> · {matches} matching incident{matches === 1 ? "" : "s"}</span>
          </>
        ) : null}
      </span>
      <button type="button" className="b b-sm b-gh" onClick={onClear}>
        <X size={13} strokeWidth={1.75} />
        Clear
      </button>
    </div>
  );
}

function formatMinutes(minutes: number) {
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/* ---------------- map ---------------- */

function toFeature(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, any>;
  if (item.type === "Feature" && item.geometry) return item;
  if (["Polygon", "MultiPolygon", "LineString", "Point"].includes(item.type) && item.coordinates) {
    return { type: "Feature" as const, geometry: { type: item.type, coordinates: item.coordinates }, properties: {} };
  }
  if (item.geometry?.type && item.geometry?.coordinates) {
    return { type: "Feature" as const, geometry: { type: item.geometry.type, coordinates: item.geometry.coordinates }, properties: {} };
  }
  return null;
}

const coordOf = (x: unknown, y: unknown): [number, number] | null =>
  x != null && y != null && Number.isFinite(Number(x)) && Number.isFinite(Number(y)) ? [Number(x), Number(y)] : null;

function OverviewMap({
  incidents,
  patrols,
  locations,
  orgName,
  token,
  selected,
  onSelect,
}: {
  incidents: IncidentRow[];
  patrols: PatrolRow[];
  locations: LocationRow[];
  orgName: string;
  token: string;
  selected: IncidentRow | null;
  onSelect: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const mapboxRef = useRef<MapboxModule | null>(null);
  const markersRef = useRef<MapboxMarker[]>([]);
  const [ready, setReady] = useState(false);
  const [layers, setLayers] = useState({ incidents: true, patrols: true, zones: true });
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const placedIncidents = useMemo(
    () =>
      incidents.flatMap((i) => {
        const c = coordOf(i.coord_x, i.coord_y);
        return c ? [{ incident: i, coord: c }] : [];
      }),
    [incidents],
  );
  const placedPatrols = useMemo(
    () =>
      patrols.flatMap((p) => {
        const loc = locations.find((l) => l.id === p.location_id);
        const c = coordOf(loc?.coord_x, loc?.coord_y);
        return c ? [{ patrol: p, coord: c }] : [];
      }),
    [patrols, locations],
  );
  const unplaced = incidents.length - placedIncidents.length;
  const zones = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: locations.flatMap((l) => {
        const f = toFeature(l.geofence);
        return f ? [{ ...f, properties: { name: l.name } }] : [];
      }),
    }),
    [locations],
  );

  useEffect(() => {
    let cancelled = false;
    let map: MapboxMap | null = null;
    let ro: ResizeObserver | null = null;
    (async () => {
      if (!token || !container.current || mapRef.current) return;
      const mapboxgl = mapboxRef.current ?? (await import("mapbox-gl"));
      mapboxRef.current = mapboxgl;
      if (cancelled || !container.current) return;
      mapboxgl.default.accessToken = token;
      map = new mapboxgl.default.Map({ container: container.current, style: "mapbox://styles/mapbox/dark-v11", center: LAGOS, zoom: 10.7, attributionControl: false });
      map.on("load", () => {
        map!.addSource("zones", { type: "geojson", data: zones as any });
        map!.addLayer({ id: "zones-fill", type: "fill", source: "zones", paint: { "fill-color": "#7A9BFF", "fill-opacity": 0.06 } });
        map!.addLayer({ id: "zones-line", type: "line", source: "zones", paint: { "line-color": "#7A9BFF", "line-width": 1.2, "line-opacity": 0.6, "line-dasharray": [2, 2] } });
        setReady(true);
        requestAnimationFrame(() => map!.resize());
      });
      mapRef.current = map;
      ro = new ResizeObserver(() => {
        try {
          map!.resize();
        } catch {
          // map may be mid-teardown
        }
      });
      ro.observe(container.current);
    })();
    return () => {
      cancelled = true;
      ro?.disconnect();
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map?.remove();
      mapRef.current = null;
      setReady(false);
    };
    // zones are pushed by the effect below once the style has loaded
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("zones") as MapboxGeoJSONSource | undefined)?.setData(zones as any);
    const vis = layers.zones ? "visible" : "none";
    ["zones-fill", "zones-line"].forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", vis));
  }, [zones, layers.zones, ready]);

  useEffect(() => {
    const map = mapRef.current;
    const mapboxgl = mapboxRef.current;
    if (!map || !mapboxgl || !ready) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    if (layers.patrols) {
      for (const { patrol, coord } of placedPatrols) {
        const el = document.createElement("span");
        el.className = "av av-b";
        el.textContent = patrol.officer
          .split(/\s+/)
          .filter(Boolean)
          .map((s) => s[0])
          .join("")
          .slice(0, 2)
          .toUpperCase();
        const ring = patrol.status === "missed" ? "var(--s5)" : patrol.status === "delayed" ? "var(--warn)" : "#0A0C10";
        el.style.cssText = `width:22px;height:22px;box-shadow:0 0 0 2px ${ring};cursor:default`;
        el.title = `${patrol.officer} · ${patrol.code}`;
        markersRef.current.push(new mapboxgl.default.Marker({ element: el }).setLngLat(coord).addTo(map));
      }
    }
    if (layers.incidents) {
      for (const { incident, coord } of placedIncidents) {
        const sev = toSev(incident.severity);
        const el = document.createElement("button");
        el.type = "button";
        el.className = `sv sv${sev} svq${sev === 5 ? " pulse-dot" : ""}`;
        el.textContent = String(sev);
        el.setAttribute("aria-label", `${incident.code}, severity ${sev}`);
        el.title = `${incident.code} · ${incidentTitle(incident)}`;
        el.style.cssText = `box-shadow:${selected?.id === incident.id ? "0 0 0 2px #fff" : "0 0 0 2px #0A0C10"}`;
        el.addEventListener("click", () => onSelectRef.current(incident.id));
        markersRef.current.push(new mapboxgl.default.Marker({ element: el }).setLngLat(coord).addTo(map));
      }
    }
  }, [placedIncidents, placedPatrols, layers.incidents, layers.patrols, ready, selected?.id]);

  const fitAll = () => {
    const map = mapRef.current;
    const mapboxgl = mapboxRef.current;
    if (!map || !mapboxgl) return;
    const points = [...placedIncidents.map((p) => p.coord), ...placedPatrols.map((p) => p.coord)];
    if (!points.length) return map.easeTo({ center: LAGOS, zoom: 10.7 });
    const bounds = new mapboxgl.default.LngLatBounds(points[0], points[0]);
    points.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds, { padding: 80, maxZoom: 16, duration: 500 });
  };

  useEffect(() => {
    if (ready) fitAll();
    // fit once when the map first becomes ready
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    const map = mapRef.current;
    const c = selected ? coordOf(selected.coord_x, selected.coord_y) : null;
    if (map && ready && c) map.easeTo({ center: c, zoom: Math.max(map.getZoom(), 14), duration: 500 });
  }, [selected?.id, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const chip = (key: keyof typeof layers, label: string, Icon: typeof Siren) => (
    <button
      type="button"
      className={`chip${layers[key] ? " on" : ""}`}
      aria-pressed={layers[key]}
      onClick={() => setLayers((l) => ({ ...l, [key]: !l[key] }))}
      style={{ height: 26, fontSize: 12, padding: "0 8px", border: 0 }}
    >
      <Icon size={13} strokeWidth={1.75} className="ic" />
      {label}
    </button>
  );

  return (
    <div className="map flex-1" style={{ minHeight: 300 }}>
      <div ref={container} style={{ position: "absolute", inset: 0 }} />
      {!token && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center">
          <div className="col g6" style={{ maxWidth: 320 }}>
            <b>Map unavailable</b>
            <span className="t3" style={{ fontSize: 12.5 }}>No Mapbox token is configured for this deployment, so the live map can’t be drawn. Incidents and patrols are still listed alongside.</span>
          </div>
        </div>
      )}
      <div className="row g8 wrap" style={{ position: "absolute", left: 12, right: 12, top: 12 }}>
        <div className="glass row g8" style={{ padding: "6px 10px", height: 34 }}>
          <span className="pulse" />
          <span style={{ fontWeight: 600, fontSize: 12.5 }}>Live map</span>
          <span className="t3 trunc" style={{ fontSize: 12, maxWidth: 220 }}>{orgName}</span>
        </div>
        <span className="flex-auto" />
        <div className="glass row g4 wrap" style={{ padding: 4 }} role="group" aria-label="Map layers">
          {chip("incidents", "Incidents", Siren)}
          {chip("patrols", "Patrols", RouteIcon)}
          {chip("zones", "Zones", Layers)}
        </div>
      </div>
      <div className="mapctl" style={{ right: 12, bottom: 12 }}>
        <button type="button" className="ibtn" aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()} disabled={!ready}>
          <Plus size={15} strokeWidth={1.75} />
        </button>
        <button type="button" className="ibtn" aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()} disabled={!ready}>
          <Minus size={15} strokeWidth={1.75} />
        </button>
        <button type="button" className="ibtn" aria-label="Show everything on the map" onClick={fitAll} disabled={!ready}>
          <LocateFixed size={15} strokeWidth={1.75} />
        </button>
        <Link to="/app/map" className="ibtn" aria-label="Open full map">
          <Maximize2 size={15} strokeWidth={1.75} />
        </Link>
      </div>
      <div className="glass row g12 wrap" style={{ position: "absolute", left: 12, bottom: 12, padding: "8px 10px", fontSize: 11.5, color: "var(--tx-2)", maxWidth: "calc(100% - 80px)" }}>
        <span className="row g6">
          <span className="sv sv5 svq" style={{ height: 14, width: 14, minWidth: 14, fontSize: 9 }}>5</span>
          Incident
        </span>
        <span className="row g6">
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#3462F0", display: "block" }} />
          Patrol
        </span>
        <span className="row g6">
          <span style={{ width: 16, height: 0, borderTop: "1.5px dashed #7A9BFF", display: "block" }} />
          Zone
        </span>
        {unplaced > 0 && <span className="t3">{unplaced} incident{unplaced === 1 ? "" : "s"} without a map position</span>}
      </div>
    </div>
  );
}

/* ---------------- patrol pulse ---------------- */

function PatrolPulse({ patrols, checkIns, late, missed }: { patrols: PatrolRow[]; checkIns: CheckInRow[]; late: number; missed: number }) {
  const lastCheckIn = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of checkIns) {
      if (!c.patrol_id) continue;
      const prev = map.get(c.patrol_id);
      if (!prev || c.created_at > prev) map.set(c.patrol_id, c.created_at);
    }
    return map;
  }, [checkIns]);

  return (
    <section className="pn" style={{ flex: "none" }}>
      <div className="pn-h" style={{ minHeight: 38, padding: "6px 12px" }}>
        <h3>Patrol pulse</h3>
        <span className="meta">
          {patrols.length} active · {late} late · {missed} missed
        </span>
        <span className="flex-auto" />
        <Link to="/app/patrols" className="b b-sm b-gh">
          All patrols
          <ArrowRight size={13} strokeWidth={1.75} />
        </Link>
      </div>
      {patrols.length === 0 ? (
        <div className="empty" style={{ padding: "12px" }}>No patrols are running right now.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(170px,100%),1fr))", gap: 8, padding: 8 }}>
          {patrols.slice(0, 4).map((p) => {
            const tag =
              p.status === "missed" ? <span className="tg tg-fail">Missed</span>
              : p.status === "delayed" ? <span className="tg tg-warn">Late</span>
              : p.status === "on_route" ? <span className="tg tg-ok">On time</span>
              : p.status === "paused" ? <span className="tg tg-blue">Paused</span>
              : <span className="tg capitalize">{p.status.replace(/_/g, " ")}</span>;
            const last = lastCheckIn.get(p.id);
            return (
              <div key={p.id} className="card col g6 min-w-0" style={{ padding: "8px 10px" }}>
                <div className="row g8">
                  <Avatar name={p.officer} />
                  <span className="f1 trunc" style={{ fontWeight: 600, fontSize: 12.5 }}>{p.officer}</span>
                  {tag}
                </div>
                <div className="row g8">
                  <span className="mono t3" style={{ fontSize: 11 }}>{p.code}</span>
                  <WaypointDots total={p.waypoints} done={p.checked_in} status={p.status} />
                </div>
                <div className="t3 trunc" style={{ fontSize: 11.5 }}>
                  {p.name} · {last ? `checked in ${timeAgo(last)}` : p.next_check_in ? `next ${formatClock(p.next_check_in)}` : `${p.checked_in}/${p.waypoints} waypoints`}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function formatClock(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function WaypointDots({ total, done, status }: { total: number; done: number; status: string }) {
  const n = Math.max(0, Math.min(total || 0, 12));
  const dot = (bg: string, border: string, ring = false) => ({
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: bg,
    border: `1.5px solid ${border}`,
    display: "block",
    boxShadow: ring ? "0 0 0 3px rgba(233,237,245,.18)" : undefined,
  });
  return (
    <span className="row g4 ml-auto" aria-label={`${done} of ${total} waypoints checked in`} role="img">
      {Array.from({ length: n }, (_, i) => {
        if (i < done) return <i key={i} style={dot("#35C77B", "#35C77B")} />;
        if (i === done && status === "missed") return <i key={i} style={dot("#F2384B", "#F2384B")} />;
        if (i === done && status === "delayed") return <i key={i} style={dot("#F7D046", "#F7D046")} />;
        if (i === done && status !== "complete") return <i key={i} style={dot("#E9EDF5", "#E9EDF5", true)} />;
        return <i key={i} style={dot("transparent", "#8790A5")} />;
      })}
    </span>
  );
}

/* ---------------- decision panel ---------------- */

function DecisionPanel({ incident, orgId, readOnly, actor }: { incident: IncidentRow | null; orgId: string; readOnly: boolean; actor: string }) {
  const { proposals, loading, emptyReason, rec, fromModel } = useIncidentProposals(incident, orgId);
  const { decided, run, busy } = useProposalDecisions(incident, orgId, actor, rec, fromModel);
  const pending = proposals.filter((p) => !decided(p.id)).length;

  return (
    <section className="pn" style={{ flex: "none" }}>
      <div className="pn-h">
        <Sparkles size={15} strokeWidth={1.75} className="ic" style={{ color: "var(--ai)" }} />
        <h3>Needs your decision</h3>
        {pending > 0 && <span className="tg tg-ai">{pending}</span>}
        <span className="flex-auto" />
        {incident && <span className="meta mono">{incident.code}</span>}
      </div>
      <div className="col g8" style={{ padding: 10 }}>
        {!incident ? (
          <div className="empty">No open incident selected. AI proposals for an incident appear here for a person to approve.</div>
        ) : loading ? (
          <div className="row g8 t2" style={{ fontSize: 12.5 }}>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Asking for recommendations on {incident.code}…
          </div>
        ) : proposals.length === 0 ? (
          <div className="empty">{emptyReason}</div>
        ) : (
          proposals.slice(0, 3).map((p) => (
            <ProposalCard key={p.id} proposal={p} decision={decided(p.id)} readOnly={readOnly} busy={busy} onDecide={(d) => run(p, d)} />
          ))
        )}
      </div>
    </section>
  );
}

/* ---------------- incident queue ---------------- */

function IncidentQueue({
  incidents,
  loading,
  selectedId,
  onSelect,
  me,
  win,
}: {
  incidents: IncidentRow[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  me: string | null;
  win: Window;
}) {
  const now = useNow(1000);
  const [tab, setTab] = useState<"all" | "mine" | "unassigned">("all");
  const mine = incidents.filter((i) => me && i.officer && i.officer.toLowerCase() === me.toLowerCase());
  const unassigned = incidents.filter((i) => !i.officer);
  const rows = tab === "mine" ? mine : tab === "unassigned" ? unassigned : incidents;

  return (
    <section className="pn min-h-0" style={{ flex: "1 1 auto" }}>
      <div className="row" style={{ padding: "0 8px", borderBottom: "1px solid var(--line-1)" }}>
        <Tabs
          label="Incident queue"
          value={tab}
          onChange={setTab}
          className="border-b-0"
          tabs={[
            { value: "all", label: win === "live" ? "Active" : "All", count: incidents.length },
            { value: "mine", label: "Mine", count: mine.length },
            { value: "unassigned", label: "Unassigned", count: unassigned.length },
          ]}
        />
        <span className="flex-auto" />
        <Link to="/app/incidents" className="b b-sm b-gh">View all</Link>
      </div>
      <div className="list scroll" style={{ flex: "1 1 auto" }}>
        {loading ? (
          <div className="empty row g8" style={{ padding: 12 }}><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading incidents…</div>
        ) : rows.length === 0 ? (
          <div className="empty" style={{ padding: 12 }}>
            {tab === "mine" ? "Nothing assigned to you." : tab === "unassigned" ? "Every incident has someone on it." : win === "live" ? "No open incidents." : "No incidents in this window."}
          </div>
        ) : (
          rows.map((i) => {
            const sel = i.id === selectedId;
            const age = now - new Date(i.reported_at).getTime();
            const overdue = !i.officer && i.status !== "resolved" && i.status !== "closed" && age > 10 * 60_000;
            return (
              <div
                key={i.id}
                className="row g10"
                style={{ padding: "9px 12px", alignItems: "flex-start", ...(sel ? { background: "rgba(52,98,240,.09)", boxShadow: "inset 2px 0 0 #7A9BFF" } : {}) }}
              >
                <Sev level={i.severity} />
                <button type="button" className="f1 col g4 text-left min-w-0" onClick={() => onSelect(i.id)} aria-pressed={sel}>
                  <span className="row g8">
                    <span className="mono t3" style={{ fontSize: 11.5 }}>{i.code}</span>
                    <span className="trunc f1" style={{ fontWeight: 600 }}>{incidentTitle(i)}</span>
                    <span className="mono" style={{ fontSize: 12, color: overdue ? "#FF8E90" : "var(--tx-2)" }}>
                      {i.status === "resolved" || i.status === "closed" ? timeAgo(i.reported_at) : elapsed(i.reported_at, now)}
                    </span>
                  </span>
                  <span className="row g8">
                    <span className="trunc f1 t3" style={{ fontSize: 12 }}>{[i.zone, i.location].filter(Boolean).join(" · ")}</span>
                    <Lifecycle status={i.status} label={false} />
                    {i.officer ? <Avatar name={i.officer} /> : <span className="tg tg-warn">Unassigned</span>}
                  </span>
                </button>
                {sel && (
                  <Link to="/app/incidents/$id" params={{ id: i.id }} className="b b-sm b-sec" aria-label={`Open ${i.code}`}>
                    Open
                    <ArrowRight size={13} strokeWidth={1.75} />
                  </Link>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
