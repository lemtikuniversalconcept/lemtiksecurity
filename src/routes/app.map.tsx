import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  Cpu,
  Flame,
  Hexagon,
  ListFilter,
  Loader2,
  LocateFixed,
  Maximize2,
  Minimize2,
  Minus,
  PanelRightOpen,
  Pin,
  Plus,
  Route as RouteIcon,
  ScanEye,
  Search,
  Siren,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import { listIncidents, assignIncidentToMe, updateIncidentStatus } from "@/lib/incidents.functions";
import { listPatrols, listPatrolWaypoints } from "@/lib/patrols.functions";
import { listLocations } from "@/lib/orgs.functions";
import { listOfficers } from "@/lib/inventory.functions";
import { listDevices, type DeviceRecord } from "@/lib/devices.functions";
import { listCameras, type CameraRecord } from "@/lib/cameras.functions";
import { getMapboxToken } from "@/lib/config.functions";
import { supabase } from "@/integrations/supabase/client";
import { statusMeta, typeMeta, type IncidentStatus, type IncidentType } from "@/lib/mockData";
import { requireSectionAccess } from "@/lib/rbac";
import { useRealtimeInvalidate } from "@/lib/useRealtime";
import { Avatar, Lifecycle, Sev, elapsed, initialsOf, timeAgo, toSev, useNow } from "@/components/nw";
import { IncidentProposals } from "@/components/AiProposals";

export const Route = createFileRoute("/app/map")({
  head: () => ({ meta: [{ title: "Live Map · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    const appAccess = context.appAccess;
    requireSectionAccess(appAccess, ["security_manager", "operator", "client_admin"]);
    return { appAccess };
  },
  component: LiveMap,
});

const LAGOS: [number, number] = [3.4219, 6.4281];
const OFFICER_FRESH_MS = 15 * 60_000;

type Mode = "pins" | "heatmap";
type Window = "24h" | "7d" | "30d" | "90d";
const WINDOWS: { value: Window; label: string; ms: number }[] = [
  { value: "24h", label: "24 h", ms: 86_400_000 },
  { value: "7d", label: "7 d", ms: 7 * 86_400_000 },
  { value: "30d", label: "30 d", ms: 30 * 86_400_000 },
  { value: "90d", label: "90 d", ms: 90 * 86_400_000 },
];
const TYPE_OPTS: (IncidentType | "all")[] = ["all", "intrusion", "theft", "robbery", "armed_attack", "medical", "fire", "suspicious", "civil_unrest", "vandalism", "other"];

type IncidentRow = {
  id: string;
  code: string;
  type: string;
  title: string | null;
  severity: number;
  status: string;
  location: string;
  zone: string;
  officer: string | null;
  description: string | null;
  reported_at: string;
  quick_report?: boolean | null;
  coord_x: number | null;
  coord_y: number | null;
  dispatch_plan?: { recommended_actions?: unknown } | null;
  agent_output?: { recommended_actions?: unknown } | null;
};
type PatrolRow = { id: string; code: string; name: string; officer: string; status: string; checked_in: number; waypoints: number };
type WaypointRow = { patrol_id: string; ord: number; name: string | null; coord_x: number | null; coord_y: number | null };
type LocationRow = { id: string; name: string; address?: string | null; coord_x?: number | null; coord_y?: number | null; geofence?: unknown };
type OfficerRow = { id: string; name: string; status: string | null; current_lat?: number | null; current_lng?: number | null; location_updated_at?: string | null };
type TelemetryRow = { id: string; target_id: string; camera_name?: string | null; coord_x?: number | null; coord_y?: number | null; confidence?: number | null; captured_at?: string | null };
type MenuState = { x: number; y: number; lng: number; lat: number };
type InfoCard = { title: string; lines: string[]; lng: number; lat: number };

const coordOf = (x: unknown, y: unknown): [number, number] | null =>
  x != null && y != null && Number.isFinite(Number(x)) && Number.isFinite(Number(y)) ? [Number(x), Number(y)] : null;
const incidentTitle = (i: IncidentRow) => i.title || typeMeta[i.type as IncidentType] || "Incident";
const isOpen = (i: IncidentRow) => i.status !== "resolved" && i.status !== "closed";
const fc = (features: any[]) => ({ type: "FeatureCollection" as const, features });

function toFeature(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, any>;
  if (item.type === "Feature" && item.geometry) return item;
  if (["Polygon", "MultiPolygon", "LineString", "Point"].includes(item.type) && item.coordinates) return { type: "Feature", geometry: { type: item.type, coordinates: item.coordinates }, properties: {} };
  if (item.geometry?.type && item.geometry?.coordinates) return { type: "Feature", geometry: { type: item.geometry.type, coordinates: item.geometry.coordinates }, properties: {} };
  return null;
}

function distanceKm(a: [number, number], b: [number, number]) {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/** Severity squares drawn once as map images, so pins scale to hundreds of incidents. */
function addSeverityIcons(map: mapboxgl.Map) {
  const fill: Record<number, string> = { 5: "#F2384B", 4: "#FF8F2E", 3: "#F7D046", 2: "#0C0F14", 1: "#0C0F14" };
  const edge: Record<number, string> = { 5: "#0A0C10", 4: "#0A0C10", 3: "#0A0C10", 2: "#5E708A", 1: "#3F4759" };
  for (const s of [1, 2, 3, 4, 5]) {
    if (map.hasImage(`sev-${s}`)) continue;
    const size = 44;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.beginPath();
    ctx.roundRect(3, 3, size - 6, size - 6, 8);
    ctx.fillStyle = fill[s];
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = edge[s];
    ctx.stroke();
    map.addImage(`sev-${s}`, ctx.getImageData(0, 0, size, size), { pixelRatio: 2 });
  }
}

function LiveMap() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { appAccess } = Route.useRouteContext();
  const readOnly = appAccess.specRole === "client_admin";
  const canSeeDevices = appAccess.specRole === "security_manager";

  const listInc = useServerFn(listIncidents);
  const listPat = useServerFn(listPatrols);
  const listWp = useServerFn(listPatrolWaypoints);
  const listLoc = useServerFn(listLocations);
  const listOff = useServerFn(listOfficers);
  const listDev = useServerFn(listDevices);
  const listCam = useServerFn(listCameras);
  const getToken = useServerFn(getMapboxToken);
  const assignFn = useServerFn(assignIncidentToMe);
  const statusFn = useServerFn(updateIncidentStatus);

  useRealtimeInvalidate("incidents", [["incidents"]]);
  useRealtimeInvalidate("patrols", [["patrols"]]);

  const { data: incidents = [], isLoading } = useQuery({ queryKey: ["incidents"], queryFn: () => listInc() as Promise<IncidentRow[]> });
  const { data: patrols = [] } = useQuery({ queryKey: ["patrols"], queryFn: () => listPat() as Promise<PatrolRow[]> });
  const { data: waypoints = [] } = useQuery({ queryKey: ["patrol-waypoints"], queryFn: () => listWp() as Promise<WaypointRow[]> });
  const { data: locations = [] } = useQuery({ queryKey: ["locations"], queryFn: () => listLoc() as Promise<LocationRow[]> });
  const { data: officers = [] } = useQuery({ queryKey: ["map-officers"], queryFn: () => listOff() as Promise<OfficerRow[]>, refetchInterval: 30_000 });
  const { data: devices = [] } = useQuery({ queryKey: ["devices"], queryFn: () => listDev() as Promise<DeviceRecord[]>, enabled: canSeeDevices });
  const { data: cameras = [] } = useQuery({ queryKey: ["cameras"], queryFn: () => listCam() as Promise<CameraRecord[]>, refetchInterval: 60_000 });
  const { data: tokenData } = useQuery({ queryKey: ["mapbox_token"], queryFn: () => getToken(), staleTime: Infinity });

  const [mode, setMode] = useState<Mode>("pins");
  const [win, setWin] = useState<Window>("7d");
  const [typeFilter, setTypeFilter] = useState<IncidentType | "all">("all");
  const [layers, setLayers] = useState({ incidents: true, officers: true, patrols: true, zones: true, devices: true, tracks: true });
  const [heatOpacity, setHeatOpacity] = useState(72);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [info, setInfo] = useState<InfoCard | null>(null);
  const [myPos, setMyPos] = useState<[number, number] | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [telemetry, setTelemetry] = useState<TelemetryRow[]>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    supabase
      .from("cctv_ai_telemetry" as any)
      .select("*")
      .order("captured_at", { ascending: true })
      .limit(200)
      .then(({ data, error }) => {
        if (active && !error) setTelemetry((data ?? []) as unknown as TelemetryRow[]);
      });
    const channel = supabase
      .channel("map-cctv-ai-telemetry")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "cctv_ai_telemetry" }, (payload) => {
        const next = payload.new as TelemetryRow;
        setTelemetry((current) => [...current.filter((r) => r.id !== next.id), next].slice(-200));
      })
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // ---- data shaped for the map (real coordinates only) ----
  const winMs = WINDOWS.find((w) => w.value === win)!.ms;
  const filtered = useMemo(
    () =>
      (incidents as IncidentRow[])
        .filter((i) => Date.now() - new Date(i.reported_at).getTime() <= winMs && (typeFilter === "all" || i.type === typeFilter))
        .sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || Number(b.severity) - Number(a.severity) || b.reported_at.localeCompare(a.reported_at)),
    [incidents, winMs, typeFilter],
  );
  const placed = useMemo(() => filtered.filter((i) => coordOf(i.coord_x, i.coord_y)), [filtered]);
  const selected = filtered.find((i) => i.id === selectedId) ?? null;

  const incidentGeo = useMemo(
    () =>
      fc(
        placed.map((i) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: coordOf(i.coord_x, i.coord_y) },
          properties: { id: i.id, sev: isOpen(i) ? toSev(i.severity) : 1, code: i.code },
        })),
      ),
    [placed],
  );

  const zoneGeo = useMemo(
    () => fc(locations.flatMap((l) => {
      const f = toFeature(l.geofence);
      return f ? [{ ...f, properties: { name: l.name } }] : [];
    })),
    [locations],
  );

  const routes = useMemo(() => {
    const byPatrol = new Map<string, WaypointRow[]>();
    for (const w of waypoints) {
      if (!coordOf(w.coord_x, w.coord_y)) continue;
      byPatrol.set(w.patrol_id, [...(byPatrol.get(w.patrol_id) ?? []), w]);
    }
    return patrols
      .filter((p) => p.status !== "complete" && byPatrol.has(p.id))
      .map((p) => ({ patrol: p, points: byPatrol.get(p.id)!.sort((a, b) => a.ord - b.ord) }));
  }, [patrols, waypoints]);
  const routeGeo = useMemo(
    () => fc(routes.filter((r) => r.points.length > 1).map((r) => ({
      type: "Feature",
      geometry: { type: "LineString", coordinates: r.points.map((w) => coordOf(w.coord_x, w.coord_y)) },
      properties: { id: r.patrol.id, code: r.patrol.code, officer: r.patrol.officer },
    }))),
    [routes],
  );
  const waypointGeo = useMemo(
    () => fc(routes.flatMap((r) => r.points.map((w, idx) => {
      const done = idx < Number(r.patrol.checked_in);
      const due = idx === Number(r.patrol.checked_in);
      const state = done ? "done" : due && r.patrol.status === "missed" ? "missed" : due && r.patrol.status === "delayed" ? "late" : "upcoming";
      return { type: "Feature", geometry: { type: "Point", coordinates: coordOf(w.coord_x, w.coord_y) }, properties: { state, name: w.name ?? `Waypoint ${idx + 1}`, code: r.patrol.code } };
    }))),
    [routes],
  );

  const placedOfficers = useMemo(
    () => (officers as OfficerRow[]).flatMap((o) => {
      const c = coordOf(o.current_lng, o.current_lat);
      if (!c) return [];
      const fresh = o.location_updated_at ? Date.now() - new Date(o.location_updated_at).getTime() < OFFICER_FRESH_MS : false;
      return [{ officer: o, coord: c, fresh }];
    }),
    [officers],
  );
  const officerGeo = useMemo(
    () => fc(placedOfficers.map(({ officer, coord, fresh }) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: coord },
      properties: { id: officer.id, initials: initialsOf(officer.name), name: officer.name, fresh: fresh ? 1 : 0, updated: officer.location_updated_at ?? "" },
    }))),
    [placedOfficers],
  );

  const placedDevices = useMemo(() => (canSeeDevices ? devices : []).filter((d) => coordOf(d.lng, d.lat)), [devices, canSeeDevices]);
  const deviceGeo = useMemo(
    () => fc(placedDevices.map((d) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: coordOf(d.lng, d.lat) },
      properties: { id: d.id, name: d.name, type: d.type, status: (d.status ?? "unknown").toLowerCase(), seen: d.last_seen ?? "" },
    }))),
    [placedDevices],
  );

  const tracks = useMemo(() => {
    const byTarget = new Map<string, TelemetryRow[]>();
    for (const row of telemetry) {
      if (!row.target_id || !coordOf(row.coord_x, row.coord_y)) continue;
      byTarget.set(row.target_id, [...(byTarget.get(row.target_id) ?? []), row]);
    }
    return [...byTarget.entries()].map(([id, rows]) => ({
      id,
      rows: rows.sort((a, b) => (a.captured_at ?? "").localeCompare(b.captured_at ?? "")),
    }));
  }, [telemetry]);
  const trackLineGeo = useMemo(
    () => fc(tracks.filter((t) => t.rows.length > 1).map((t) => ({
      type: "Feature",
      geometry: { type: "LineString", coordinates: t.rows.map((r) => coordOf(r.coord_x, r.coord_y)) },
      properties: { id: t.id },
    }))),
    [tracks],
  );
  const trackPointGeo = useMemo(
    () => fc(tracks.map((t) => {
      const last = t.rows[t.rows.length - 1];
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: coordOf(last.coord_x, last.coord_y) },
        properties: { id: t.id, camera: last.camera_name ?? "", seen: last.captured_at ?? "", confidence: last.confidence ?? "" },
      };
    })),
    [tracks],
  );

  // ---- map ----
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const pulseMarkers = useRef<mapboxgl.Marker[]>([]);
  const meMarker = useRef<mapboxgl.Marker | null>(null);
  const [ready, setReady] = useState(false);
  const selectRef = useRef(setSelectedId);
  selectRef.current = setSelectedId;

  useEffect(() => {
    const token = tokenData?.token;
    if (!token || !container.current || mapRef.current) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({ container: container.current, style: "mapbox://styles/mapbox/dark-v11", center: LAGOS, zoom: 11, attributionControl: false });
    mapRef.current = map;
    map.on("error", (e) => console.error("[mapbox]", e?.error?.message ?? e));
    map.on("load", () => {
      addSeverityIcons(map);
      map.addSource("zones", { type: "geojson", data: fc([]) });
      map.addLayer({ id: "zones-fill", type: "fill", source: "zones", paint: { "fill-color": "#7A9BFF", "fill-opacity": 0.06 } });
      map.addLayer({ id: "zones-line", type: "line", source: "zones", paint: { "line-color": "#7A9BFF", "line-width": 1.2, "line-opacity": 0.6, "line-dasharray": [2, 2] } });
      map.addLayer({ id: "zones-label", type: "symbol", source: "zones", layout: { "text-field": ["get", "name"], "text-size": 11, "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"] }, paint: { "text-color": "#8790A5", "text-halo-color": "#0A0C10", "text-halo-width": 1.2 } });

      map.addSource("routes", { type: "geojson", data: fc([]) });
      map.addLayer({ id: "routes-line", type: "line", source: "routes", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#7A9BFF", "line-width": 2.5, "line-opacity": 0.9 } });
      map.addSource("waypoints", { type: "geojson", data: fc([]) });
      map.addLayer({
        id: "waypoints-dot",
        type: "circle",
        source: "waypoints",
        paint: {
          "circle-radius": 4.5,
          "circle-color": ["match", ["get", "state"], "done", "#35C77B", "missed", "#F2384B", "late", "#F7D046", "#0C0F14"],
          "circle-stroke-color": ["match", ["get", "state"], "upcoming", "#8790A5", "#0A0C10"],
          "circle-stroke-width": 1.5,
        },
      });

      map.addSource("tracks", { type: "geojson", data: fc([]) });
      map.addLayer({ id: "tracks-line", type: "line", source: "tracks", paint: { "line-color": "#A88BFF", "line-width": 2, "line-opacity": 0.85 } });
      map.addSource("track-points", { type: "geojson", data: fc([]) });
      map.addLayer({ id: "tracks-dot", type: "circle", source: "track-points", paint: { "circle-radius": 5, "circle-color": "#A88BFF", "circle-stroke-color": "#0A0C10", "circle-stroke-width": 2 } });

      map.addSource("devices", { type: "geojson", data: fc([]) });
      map.addLayer({
        id: "devices-dot",
        type: "circle",
        source: "devices",
        paint: {
          "circle-radius": 5,
          "circle-color": ["match", ["get", "status"], "online", "#35C77B", "active", "#35C77B", "offline", "#FF6B7A", "error", "#FF6B7A", "unknown", "#4A5163", "#F7D046"],
          "circle-stroke-color": "#0A0C10",
          "circle-stroke-width": 2,
        },
      });

      map.addSource("officers", { type: "geojson", data: fc([]) });
      map.addLayer({
        id: "officers-dot",
        type: "circle",
        source: "officers",
        paint: {
          "circle-radius": 11,
          "circle-color": ["case", ["==", ["get", "fresh"], 1], "#3462F0", "#0C0F14"],
          "circle-stroke-color": ["case", ["==", ["get", "fresh"], 1], "#0A0C10", "#3462F0"],
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "officers-initials",
        type: "symbol",
        source: "officers",
        layout: { "text-field": ["get", "initials"], "text-size": 9, "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"], "text-allow-overlap": true },
        paint: { "text-color": ["case", ["==", ["get", "fresh"], 1], "#FFFFFF", "#7A9BFF"] },
      });

      map.addSource("incidents", { type: "geojson", data: fc([]), cluster: true, clusterRadius: 38, clusterMaxZoom: 14 });
      map.addLayer({
        id: "incidents-heat",
        type: "heatmap",
        source: "incidents",
        layout: { visibility: "none" },
        paint: {
          "heatmap-weight": ["interpolate", ["linear"], ["get", "sev"], 1, 0.2, 5, 1],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 9, 1, 15, 3],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 9, 18, 15, 40],
          "heatmap-opacity": 0.72,
          "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(0,0,0,0)", 0.25, "rgba(247,208,70,0.4)", 0.6, "rgba(255,143,46,0.6)", 1, "rgba(242,56,75,0.85)"],
        },
      });
      map.addLayer({
        id: "incidents-cluster",
        type: "circle",
        source: "incidents",
        filter: ["has", "point_count"],
        paint: { "circle-color": "#1C212C", "circle-stroke-color": "#3A4256", "circle-stroke-width": 1.5, "circle-radius": ["step", ["get", "point_count"], 15, 10, 19, 30, 24] },
      });
      map.addLayer({
        id: "incidents-cluster-count",
        type: "symbol",
        source: "incidents",
        filter: ["has", "point_count"],
        layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 11, "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"] },
        paint: { "text-color": "#E9EDF5" },
      });
      map.addLayer({
        id: "incidents-selected",
        type: "circle",
        source: "incidents",
        filter: ["==", ["get", "id"], ""],
        paint: { "circle-radius": 15, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 2 },
      });
      map.addLayer({
        id: "incidents-pin",
        type: "symbol",
        source: "incidents",
        filter: ["!", ["has", "point_count"]],
        layout: {
          "icon-image": ["concat", "sev-", ["to-string", ["get", "sev"]]],
          "icon-allow-overlap": true,
          "text-field": ["to-string", ["get", "sev"]],
          "text-size": 11,
          "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"],
          "text-allow-overlap": true,
        },
        paint: { "text-color": ["match", ["get", "sev"], 2, "#B9C6D8", 1, "#9AA3B5", "#0A0C10"] },
      });

      map.on("click", "incidents-pin", (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) selectRef.current(id);
      });
      map.on("click", "incidents-cluster", (e) => {
        const feature = e.features?.[0];
        const clusterId = feature?.properties?.cluster_id;
        const src = map.getSource("incidents") as mapboxgl.GeoJSONSource;
        if (clusterId == null) return;
        src.getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err || zoom == null) return;
          map.easeTo({ center: (feature!.geometry as any).coordinates, zoom });
        });
      });
      const bindInfo = (layer: string, build: (p: any) => { title: string; lines: string[] }) =>
        map.on("click", layer, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const [lng, lat] = (f.geometry as any).coordinates as [number, number];
          setInfo({ ...build(f.properties ?? {}), lng, lat });
        });
      bindInfo("officers-dot", (p) => ({ title: p.name, lines: [p.fresh ? "Position reported recently" : "Position not updated in 15 min", p.updated ? `Updated ${timeAgo(p.updated)}` : "No update time"] }));
      bindInfo("devices-dot", (p) => ({ title: p.name, lines: [`${p.type} · ${p.status}`, p.seen ? `Last seen ${timeAgo(p.seen)}` : "Never seen"] }));
      bindInfo("tracks-dot", (p) => ({ title: `Re-ID ${p.id}`, lines: [p.camera ? `Last at ${p.camera}` : "Camera unknown", p.seen ? timeAgo(p.seen) : "", p.confidence !== "" ? `Model confidence ${Math.round(Number(p.confidence) <= 1 ? Number(p.confidence) * 100 : Number(p.confidence))}%` : ""].filter(Boolean) }));
      bindInfo("waypoints-dot", (p) => ({ title: `${p.code} · ${p.name}`, lines: [p.state === "done" ? "Checked in" : p.state === "missed" ? "Missed" : p.state === "late" ? "Late" : "Upcoming"] }));
      for (const layer of ["incidents-pin", "incidents-cluster", "officers-dot", "devices-dot", "tracks-dot", "waypoints-dot"]) {
        map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
      }
      setReady(true);
      requestAnimationFrame(() => map.resize());
    });
    const ro = new ResizeObserver(() => {
      try {
        map.resize();
      } catch {
        // map may be mid-teardown
      }
    });
    ro.observe(container.current);
    return () => {
      ro.disconnect();
      pulseMarkers.current.forEach((m) => m.remove());
      meMarker.current?.remove();
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [tokenData?.token]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const set = (id: string, data: any) => (map.getSource(id) as mapboxgl.GeoJSONSource | undefined)?.setData(data);
    set("incidents", incidentGeo);
    set("zones", zoneGeo);
    set("routes", routeGeo);
    set("waypoints", waypointGeo);
    set("officers", officerGeo);
    set("devices", deviceGeo);
    set("tracks", trackLineGeo);
    set("track-points", trackPointGeo);
  }, [ready, incidentGeo, zoneGeo, routeGeo, waypointGeo, officerGeo, deviceGeo, trackLineGeo, trackPointGeo]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const vis = (id: string, on: boolean) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    const pins = layers.incidents && mode === "pins";
    ["incidents-pin", "incidents-cluster", "incidents-cluster-count", "incidents-selected"].forEach((id) => vis(id, pins));
    vis("incidents-heat", layers.incidents && mode === "heatmap");
    ["zones-fill", "zones-line", "zones-label"].forEach((id) => vis(id, layers.zones));
    ["routes-line", "waypoints-dot"].forEach((id) => vis(id, layers.patrols));
    ["officers-dot", "officers-initials"].forEach((id) => vis(id, layers.officers));
    vis("devices-dot", layers.devices);
    ["tracks-line", "tracks-dot"].forEach((id) => vis(id, layers.tracks));
    map.setPaintProperty("incidents-heat", "heatmap-opacity", heatOpacity / 100);
    map.setFilter("incidents-selected", ["==", ["get", "id"], selectedId ?? ""]);
  }, [ready, layers, mode, heatOpacity, selectedId]);

  // One pulse for live S5 items.
  useEffect(() => {
    const map = mapRef.current;
    pulseMarkers.current.forEach((m) => m.remove());
    pulseMarkers.current = [];
    if (!map || !ready || !layers.incidents || mode !== "pins") return;
    for (const i of placed) {
      if (!isOpen(i) || toSev(i.severity) < 5) continue;
      const el = document.createElement("span");
      el.className = "pulse-dot";
      el.style.cssText = "width:22px;height:22px;border-radius:5px;pointer-events:none";
      pulseMarkers.current.push(new mapboxgl.Marker({ element: el }).setLngLat(coordOf(i.coord_x, i.coord_y)!).addTo(map));
    }
  }, [placed, ready, layers.incidents, mode]);

  useEffect(() => {
    const map = mapRef.current;
    const c = selected ? coordOf(selected.coord_x, selected.coord_y) : null;
    if (map && ready && c) map.easeTo({ center: c, zoom: Math.max(map.getZoom(), 14), duration: 500 });
  }, [selected?.id, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const fitAll = () => {
    const map = mapRef.current;
    if (!map) return;
    const points = [...placed.map((i) => coordOf(i.coord_x, i.coord_y)!), ...placedOfficers.map((o) => o.coord)];
    if (!points.length) return map.easeTo({ center: LAGOS, zoom: 11 });
    const bounds = new mapboxgl.LngLatBounds(points[0], points[0]);
    points.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds, { padding: { top: 120, bottom: 80, left: 60, right: panelOpen ? 420 : 60 }, maxZoom: 16, duration: 500 });
  };
  const fittedRef = useRef(false);
  useEffect(() => {
    if (ready && !fittedRef.current && (placed.length || placedOfficers.length)) {
      fittedRef.current = true;
      fitAll();
    }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- actions ----
  const assignMut = useMutation({ mutationFn: (id: string) => assignFn({ data: { id } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["incidents"] }) });
  const statusMut = useMutation({
    mutationFn: (v: { id: string; status: IncidentStatus }) => statusFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["incidents"] }),
  });

  const searchResults = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return [];
    const out: { label: string; kind: string; coord: [number, number]; id?: string }[] = [];
    for (const i of incidents as IncidentRow[]) {
      const c = coordOf(i.coord_x, i.coord_y);
      if (c && [i.code, i.location, i.zone, i.officer, i.title].filter(Boolean).join(" ").toLowerCase().includes(q)) out.push({ label: `${i.code} · ${i.location}`, kind: "Incident", coord: c, id: i.id });
    }
    for (const l of locations) {
      const c = coordOf(l.coord_x, l.coord_y);
      if (c && [l.name, l.address].filter(Boolean).join(" ").toLowerCase().includes(q)) out.push({ label: l.name, kind: "Location", coord: c });
    }
    for (const o of placedOfficers) if (o.officer.name.toLowerCase().includes(q)) out.push({ label: o.officer.name, kind: "Officer", coord: o.coord });
    return out.slice(0, 6);
  }, [searchTerm, incidents, locations, placedOfficers]);

  const goTo = (r: { coord: [number, number]; id?: string }) => {
    mapRef.current?.easeTo({ center: r.coord, zoom: 15, duration: 600 });
    if (r.id) {
      setSelectedId(r.id);
      setPanelOpen(true);
    }
    setSearchTerm("");
  };

  const logIncidentHere = (lng: number, lat: number) => {
    const withCoords = locations.flatMap((l) => {
      const c = coordOf(l.coord_x, l.coord_y);
      return c ? [{ l, d: distanceKm([lng, lat], c) }] : [];
    });
    const nearest = withCoords.sort((a, b) => a.d - b.d)[0]?.l;
    sessionStorage.setItem(
      "lemtik_incident_draft",
      JSON.stringify({
        location: nearest?.name ?? "Mapped area",
        zone: nearest?.name ?? "Mapped area",
        coord_x: lng,
        coord_y: lat,
        title: "Map-originated incident",
        description: `Logged from the live map at ${lat.toFixed(5)}, ${lng.toFixed(5)}.`,
        type: "suspicious",
        severity: 3,
      }),
    );
    setMenu(null);
    navigate({ to: "/app/incidents" });
  };

  const drawZoneHere = (lng: number, lat: number) => {
    sessionStorage.setItem("lemtik_zone_draft", JSON.stringify({ name: "New zone", coord_x: lng, coord_y: lat, source: "map-context" }));
    setMenu(null);
    navigate({ to: "/app/locations" });
  };

  const locateMe = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      const c: [number, number] = [pos.coords.longitude, pos.coords.latitude];
      setMyPos(c);
      const map = mapRef.current;
      if (!map) return;
      meMarker.current?.remove();
      const el = document.createElement("span");
      el.style.cssText = "width:14px;height:14px;border-radius:50%;background:#7A9BFF;box-shadow:0 0 0 4px rgba(122,155,255,.3),0 0 0 2px #0A0C10";
      meMarker.current = new mapboxgl.Marker({ element: el }).setLngLat(c).addTo(map);
      map.flyTo({ center: c, zoom: 15, duration: 700 });
    });
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await rootRef.current?.requestFullscreen?.();
  };

  const counts = {
    incidents: filtered.length,
    officers: placedOfficers.length,
    patrols: routes.length,
    zones: zoneGeo.features.length,
    devices: placedDevices.length,
    tracks: tracks.length,
  };
  const unplaced = filtered.length - placed.length;
  const tokenMissing = tokenData && !tokenData.token;
  const asideWidth = 372;

  const chip = (key: keyof typeof layers, label: string, Icon: typeof Siren) => (
    <button key={key} type="button" className={`chip${layers[key] ? " on" : ""}`} aria-pressed={layers[key]} onClick={() => setLayers((l) => ({ ...l, [key]: !l[key] }))}>
      <Icon size={13} strokeWidth={1.75} className="ic" />
      {label}
      <span className="mono" style={{ fontSize: 11, opacity: 0.75 }}>{counts[key]}</span>
    </button>
  );

  return (
    <div
      ref={rootRef}
      className="relative -m-4 overflow-hidden"
      style={{ height: fullscreen ? "100vh" : "calc(100dvh - var(--shell-top, 52px))", minHeight: 620, background: "#0C0F14" }}
      onContextMenu={(e) => {
        const map = mapRef.current;
        if (!map || !container.current?.contains(e.target as Node)) return;
        e.preventDefault();
        const rect = container.current.getBoundingClientRect();
        const ll = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
        setMenu({ x: e.clientX, y: e.clientY, lng: ll.lng, lat: ll.lat });
      }}
      onClick={() => setMenu(null)}
    >
      <div className="map" style={{ position: "absolute", inset: 0, borderRadius: 0, border: 0 }}>
        <div ref={container} style={{ position: "absolute", inset: 0 }} />
        {(tokenMissing || !tokenData) && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            {tokenMissing ? (
              <div className="col g6" style={{ maxWidth: 340 }}>
                <b>Map unavailable</b>
                <span className="t3" style={{ fontSize: 12.5 }}>No Mapbox token is configured for this deployment (MAPBOX_PUBLIC_TOKEN), so the map can’t be drawn. Incidents are still listed in the panel.</span>
              </div>
            ) : (
              <Loader2 className="h-5 w-5 animate-spin t3" />
            )}
          </div>
        )}
      </div>

      <div className="col g8" style={{ position: "absolute", left: 12, right: panelOpen ? asideWidth + 24 : 12, top: 12 }}>
        <div className="row g8 wrap">
          <div className="relative" style={{ flex: "1 1 220px", maxWidth: 360 }}>
            <label className="glass row g8" style={{ height: 38, padding: "0 12px", color: "var(--tx-3)" }}>
              <Search size={15} strokeWidth={1.75} className="ic" />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && searchResults[0]) goTo(searchResults[0]);
                  if (e.key === "Escape") setSearchTerm("");
                }}
                placeholder="Search incident, location or officer"
                aria-label="Search the map"
                className="f1 bg-transparent outline-none t1"
                style={{ fontSize: 13 }}
              />
            </label>
            {searchTerm.trim() && (
              <div className="glass absolute left-0 right-0 z-20 mt-1 overflow-hidden" role="listbox">
                {searchResults.length === 0 ? (
                  <div className="empty" style={{ padding: "8px 12px" }}>Nothing with a map position matches.</div>
                ) : (
                  searchResults.map((r, i) => (
                    <button key={`${r.kind}-${i}`} type="button" role="option" aria-selected={false} onClick={() => goTo(r)} className="row g8 w-full text-left hover:bg-ink-3" style={{ padding: "8px 12px" }}>
                      <span className="tg">{r.kind}</span>
                      <span className="trunc">{r.label}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <div className="glass seg" style={{ height: 38, alignItems: "center" }} role="group" aria-label="Incident display">
            <button type="button" className={mode === "pins" ? "on" : undefined} aria-pressed={mode === "pins"} onClick={() => setMode("pins")}>
              <Pin size={13} strokeWidth={1.75} /> Pins
            </button>
            <button type="button" className={mode === "heatmap" ? "on" : undefined} aria-pressed={mode === "heatmap"} onClick={() => setMode("heatmap")}>
              <Flame size={13} strokeWidth={1.75} /> Heatmap
            </button>
          </div>
          <div className="glass row g8" style={{ height: 38, padding: "0 6px 0 12px" }}>
            <span style={{ fontSize: 12.5, fontWeight: 550 }}>Window</span>
            <div className="seg" style={{ border: 0, background: "transparent" }} role="group" aria-label="Time window">
              {WINDOWS.map((w) => (
                <button key={w.value} type="button" className={win === w.value ? "on" : undefined} aria-pressed={win === w.value} onClick={() => setWin(w.value)}>
                  {w.label}
                </button>
              ))}
            </div>
            {mode === "heatmap" && (
              <label className="t3 row g6" style={{ fontSize: 11.5, paddingRight: 6 }}>
                Opacity
                <input type="range" min={10} max={100} value={heatOpacity} onChange={(e) => setHeatOpacity(Number(e.target.value))} style={{ width: 64 }} aria-label="Heatmap opacity" />
              </label>
            )}
          </div>
        </div>
        <div className="row g8 wrap">
          <div className="glass row g4 wrap" style={{ padding: 4 }} role="group" aria-label="Map layers">
            {chip("incidents", "Incidents", Siren)}
            {chip("officers", "Officers", Users)}
            {chip("patrols", "Patrol routes", RouteIcon)}
            {chip("zones", "Zones", Hexagon)}
            {canSeeDevices && chip("devices", "Devices", Cpu)}
            {counts.tracks > 0 && chip("tracks", "Re-ID tracks", ScanEye)}
          </div>
          <label className="glass row g6" style={{ height: 36, padding: "0 4px 0 10px" }}>
            <ListFilter size={13} strokeWidth={1.75} className="ic t3" />
            <span className="sr-only">Incident type</span>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as IncidentType | "all")} className="in" style={{ height: 28, border: 0, background: "transparent", width: "auto", paddingLeft: 4 }}>
              {TYPE_OPTS.map((t) => (
                <option key={t} value={t}>{t === "all" ? "All types" : typeMeta[t as IncidentType]}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {info && (
        <div className="glass col g4" style={{ position: "absolute", left: 12, bottom: 64, padding: "10px 12px", maxWidth: 300 }}>
          <div className="row g8">
            <b className="f1 trunc">{info.title}</b>
            <button type="button" className="t3 hover:text-tx-1" aria-label="Close" onClick={() => setInfo(null)}>
              <X size={14} strokeWidth={1.75} />
            </button>
          </div>
          {info.lines.map((l) => (
            <span key={l} className="t2" style={{ fontSize: 12 }}>{l}</span>
          ))}
          <span className="mono t3" style={{ fontSize: 11 }}>{info.lat.toFixed(5)}, {info.lng.toFixed(5)}</span>
        </div>
      )}

      <div className="glass row g12 wrap" style={{ position: "absolute", left: 12, bottom: 12, padding: "8px 12px", fontSize: 11.5, color: "var(--tx-2)", maxWidth: `calc(100% - ${panelOpen ? asideWidth + 90 : 90}px)` }}>
        {mode === "heatmap" ? (
          <span className="row g6">
            <span style={{ width: 28, height: 8, borderRadius: 4, background: "linear-gradient(90deg,rgba(247,208,70,.4),rgba(255,143,46,.6),rgba(242,56,75,.8))", display: "block" }} />
            Incident density · {WINDOWS.find((w) => w.value === win)?.label}
          </span>
        ) : (
          <span className="row g6">
            <span className="sv sv5 svq" style={{ height: 14, width: 14, minWidth: 14, fontSize: 9 }}>5</span>
            Incident by severity
          </span>
        )}
        <span className="row g6">
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#3462F0", display: "block" }} />
          Officer
        </span>
        <span className="row g6">
          <span style={{ width: 16, height: 0, borderTop: "2.5px solid #7A9BFF", display: "block" }} />
          Patrol route
        </span>
        {counts.tracks > 0 && (
          <span className="row g6">
            <span style={{ width: 16, height: 0, borderTop: "2px solid #A88BFF", display: "block" }} />
            Re-ID track
          </span>
        )}
        {unplaced > 0 && <span className="t3">{unplaced} without a map position</span>}
      </div>

      <div className="mapctl" style={{ right: panelOpen ? asideWidth + 24 : 12, bottom: 12 }}>
        <button type="button" className="ibtn" aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()} disabled={!ready}>
          <Plus size={15} strokeWidth={1.75} />
        </button>
        <button type="button" className="ibtn" aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()} disabled={!ready}>
          <Minus size={15} strokeWidth={1.75} />
        </button>
        <button type="button" className="ibtn" aria-label={myPos ? "Back to my location" : "Show my location"} onClick={locateMe} disabled={!ready}>
          <LocateFixed size={15} strokeWidth={1.75} />
        </button>
        <button type="button" className="ibtn" aria-label="Show everything" onClick={fitAll} disabled={!ready}>
          <Hexagon size={15} strokeWidth={1.75} />
        </button>
        <button type="button" className="ibtn" aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={toggleFullscreen}>
          {fullscreen ? <Minimize2 size={15} strokeWidth={1.75} /> : <Maximize2 size={15} strokeWidth={1.75} />}
        </button>
      </div>

      {!panelOpen && (
        <button type="button" className="glass row g8 b" style={{ position: "absolute", right: 12, top: 12, height: 38 }} onClick={() => setPanelOpen(true)}>
          <PanelRightOpen size={15} strokeWidth={1.75} />
          Incidents · {filtered.length}
        </button>
      )}

      {panelOpen && (
        <aside className="glass col" style={{ position: "absolute", right: 12, top: 12, bottom: 12, width: asideWidth, maxWidth: "calc(100% - 24px)", overflow: "hidden" }} aria-label="Incident details">
          {selected ? (
            <IncidentDetail
              incident={selected}
              cameras={cameras}
              officers={officers as OfficerRow[]}
              orgId={appAccess.orgId}
              readOnly={readOnly}
              actor={appAccess.displayName || appAccess.email || "You"}
              onClose={() => setSelectedId(null)}
              onAssign={() => assignMut.mutate(selected.id)}
              assigning={assignMut.isPending}
              onStatus={(status) => statusMut.mutate({ id: selected.id, status })}
            />
          ) : (
            <IncidentList incidents={filtered} loading={isLoading} onPick={(id) => setSelectedId(id)} onHide={() => setPanelOpen(false)} windowLabel={WINDOWS.find((w) => w.value === win)!.label} />
          )}
        </aside>
      )}

      {menu && (
        <div className="glass col fixed z-50" style={{ left: menu.x, top: menu.y, width: 220, padding: 4 }} onClick={(e) => e.stopPropagation()} role="menu">
          {!readOnly && (
            <button type="button" role="menuitem" className="row g8 w-full text-left hover:bg-ink-3" style={{ padding: "8px 10px", borderRadius: 6 }} onClick={() => logIncidentHere(menu.lng, menu.lat)}>
              <Siren size={14} strokeWidth={1.75} className="ic" style={{ color: "var(--s5)" }} />
              Log incident here
            </button>
          )}
          <button type="button" role="menuitem" className="row g8 w-full text-left hover:bg-ink-3" style={{ padding: "8px 10px", borderRadius: 6 }} onClick={() => drawZoneHere(menu.lng, menu.lat)}>
            <Hexagon size={14} strokeWidth={1.75} className="ic lnk" />
            Draw a zone here
          </button>
          <span className="mono t3" style={{ fontSize: 11, padding: "4px 10px" }}>{menu.lat.toFixed(5)}, {menu.lng.toFixed(5)}</span>
        </div>
      )}
    </div>
  );
}

function IncidentList({ incidents, loading, onPick, onHide, windowLabel }: { incidents: IncidentRow[]; loading: boolean; onPick: (id: string) => void; onHide: () => void; windowLabel: string }) {
  const now = useNow(1000);
  return (
    <>
      <div className="row g8" style={{ padding: "12px 14px", borderBottom: "1px solid var(--line-1)" }}>
        <b>Incidents</b>
        <span className="t3" style={{ fontSize: 12 }}>last {windowLabel} · {incidents.length}</span>
        <span className="flex-auto" />
        <button type="button" className="ibtn" style={{ width: 28, height: 28 }} aria-label="Hide panel" onClick={onHide}>
          <X size={14} strokeWidth={1.75} />
        </button>
      </div>
      <div className="list scroll" style={{ flex: "1 1 auto" }}>
        {loading ? (
          <div className="empty row g8" style={{ padding: 14 }}><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading incidents…</div>
        ) : incidents.length === 0 ? (
          <div className="empty" style={{ padding: 14 }}>No incidents in this window. Widen the window or change the type filter.</div>
        ) : (
          incidents.map((i) => (
            <button key={i.id} type="button" onClick={() => onPick(i.id)} className="row g10 w-full text-left hover:bg-ink-3" style={{ padding: "9px 14px", alignItems: "flex-start" }}>
              <Sev level={isOpen(i) ? i.severity : 1} />
              <span className="f1 col g4 min-w-0">
                <span className="row g8">
                  <span className="mono t3" style={{ fontSize: 11.5 }}>{i.code}</span>
                  <span className="trunc f1" style={{ fontWeight: 600 }}>{incidentTitle(i)}</span>
                  <span className="mono t2" style={{ fontSize: 12 }}>{isOpen(i) ? elapsed(i.reported_at, now) : timeAgo(i.reported_at)}</span>
                </span>
                <span className="row g8">
                  <span className="trunc f1 t3" style={{ fontSize: 12 }}>{[i.zone, i.location].filter(Boolean).join(" · ")}</span>
                  <Lifecycle status={i.status} label={false} />
                  {!coordOf(i.coord_x, i.coord_y) && <span className="tg">No position</span>}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </>
  );
}

function IncidentDetail({
  incident,
  cameras,
  officers,
  orgId,
  readOnly,
  actor,
  onClose,
  onAssign,
  assigning,
  onStatus,
}: {
  incident: IncidentRow;
  cameras: CameraRecord[];
  officers: OfficerRow[];
  orgId: string;
  readOnly: boolean;
  actor: string;
  onClose: () => void;
  onAssign: () => void;
  assigning: boolean;
  onStatus: (status: IncidentStatus) => void;
}) {
  const now = useNow(1000);
  const open = isOpen(incident);
  const assignee = incident.officer ? officers.find((o) => o.name.toLowerCase() === incident.officer!.toLowerCase()) : null;
  const camera = cameras.find((c) => {
    const where = c.location?.toLowerCase() ?? "";
    return where && ((incident.zone && where.includes(incident.zone.toLowerCase())) || (incident.location && where.includes(incident.location.toLowerCase())));
  });

  return (
    <>
      <div className="row g8" style={{ padding: "12px 14px", borderBottom: "1px solid var(--line-1)" }}>
        <Sev level={incident.severity} label />
        <span className="mono t3" style={{ fontSize: 12 }}>{incident.code}</span>
        <span className="flex-auto" />
        <button type="button" className="ibtn" style={{ width: 28, height: 28 }} aria-label="Back to the incident list" onClick={onClose}>
          <X size={14} strokeWidth={1.75} />
        </button>
      </div>
      <div className="col g12 scroll" style={{ padding: 14, flex: "1 1 auto" }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 650 }}>{incidentTitle(incident)}</h2>
          <div className="t2" style={{ fontSize: 12.5, marginTop: 2 }}>{[incident.location, incident.zone].filter(Boolean).join(" · ")}</div>
        </div>
        <div className="row g8">
          <Lifecycle status={incident.status} />
          <span className="flex-auto" />
          <span className="mono" style={{ fontSize: 13 }}>{open ? elapsed(incident.reported_at, now) : timeAgo(incident.reported_at)}</span>
        </div>
        {incident.description && <p className="t2" style={{ fontSize: 13, lineHeight: 1.5 }}>{incident.description}</p>}
        <div className="card" style={{ padding: "10px 12px" }}>
          {incident.officer ? (
            <div className="row g10">
              <Avatar name={incident.officer} size="lg" own />
              <div className="f1 min-w-0">
                <b className="trunc block" style={{ fontSize: 13 }}>{incident.officer}</b>
                <div className="t3" style={{ fontSize: 12 }}>
                  {assignee?.location_updated_at ? `Position updated ${timeAgo(assignee.location_updated_at)}` : "Assigned"}
                </div>
              </div>
              <span className="tg tg-blue">Assigned</span>
            </div>
          ) : (
            <div className="row g10">
              <span className="av av-lg" aria-hidden="true">
                <UserCheck size={15} strokeWidth={1.75} />
              </span>
              <div className="f1">
                <b style={{ fontSize: 13 }}>Nobody assigned</b>
                <div className="t3" style={{ fontSize: 12 }}>Take it or dispatch from the incident page</div>
              </div>
              <span className="tg tg-warn">Unassigned</span>
            </div>
          )}
        </div>
        {open && (
          <div className="col g8">
            <span className="ai-h">AI proposals</span>
            <IncidentProposals incident={incident} orgId={orgId} readOnly={readOnly} actor={actor} limit={2} />
          </div>
        )}
        <dl className="kv" style={{ margin: 0 }}>
          <dt>Reported</dt>
          <dd className="mono">{new Date(incident.reported_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "medium" })}</dd>
          <dt>Source</dt>
          <dd>{incident.quick_report ? "Quick report" : "Logged incident"}</dd>
          <dt>Nearest camera</dt>
          <dd>{camera ? `${camera.name} · ${camera.status}` : "None registered for this area"}</dd>
          <dt>Position</dt>
          <dd className="mono">{coordOf(incident.coord_x, incident.coord_y) ? `${Number(incident.coord_y).toFixed(5)}, ${Number(incident.coord_x).toFixed(5)}` : "Not recorded"}</dd>
        </dl>
        {!readOnly && (
          <label className="fl">
            <span className="lbl">Status</span>
            <select className="in" value={incident.status} onChange={(e) => onStatus(e.target.value as IncidentStatus)}>
              {(Object.keys(statusMeta) as IncidentStatus[]).map((s) => (
                <option key={s} value={s}>{statusMeta[s]}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="row g8" style={{ padding: "12px 14px", borderTop: "1px solid var(--line-1)" }}>
        <Link to="/app/incidents/$id" params={{ id: incident.id }} className="b b-sec f1">
          Open incident
        </Link>
        {!readOnly && (
          <button type="button" className="b b-pri f1" onClick={onAssign} disabled={assigning}>
            {assigning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCheck size={14} strokeWidth={1.75} />}
            Assign to me
          </button>
        )}
      </div>
    </>
  );
}
