import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { listIncidents, assignIncidentToMe, updateIncidentStatus } from "@/lib/incidents.functions";
import { listPatrols } from "@/lib/patrols.functions";
import { listLocations, listMembers } from "@/lib/orgs.functions";
import { getMapboxToken } from "@/lib/config.functions";
import { supabase } from "@/integrations/supabase/client";
import { severityMeta, typeMeta, statusMeta, type Severity, type IncidentType, type IncidentStatus, zoneRisk } from "@/lib/mockData";
import { SeverityBadge } from "@/components/SeverityBadge";
import { resolveAppAccess, requireSectionAccess } from "@/lib/rbac";
import {
  MapPin, Loader2, Layers, Flame, Pin, Radar, ChevronRight, Wifi, WifiOff,
  UserPlus, ExternalLink, ChevronsUpDown, Search, LocateFixed, Maximize2, MapPinned,
  Diamond, Users, Route as RouteIcon, Gauge, Shield, Radio,
} from "lucide-react";

export const Route = createFileRoute("/app/map")({
  head: () => ({ meta: [{ title: "Live Map · Lemtik SOD" }] }),
  beforeLoad: async () => {
    const appAccess = await resolveAppAccess(supabase);
    requireSectionAccess(appAccess, [
      "security_manager",
      "operator",
      "client_admin",
    ]);
    return { appAccess };
  },
  component: LiveMap,
});

const LAGOS: [number, number] = [3.4219, 6.4281];

type Mode = "pins" | "heatmap";
type Window = "24h" | "7d" | "30d" | "90d";
const WINDOWS: { value: Window; label: string; ms: number }[] = [
  { value: "24h", label: "24h", ms: 86_400_000 },
  { value: "7d", label: "7d", ms: 7 * 86_400_000 },
  { value: "30d", label: "30d", ms: 30 * 86_400_000 },
  { value: "90d", label: "90d", ms: 90 * 86_400_000 },
];
const TYPE_OPTS: (IncidentType | "all")[] = ["all", "intrusion", "theft", "medical", "fire", "suspicious", "civil_unrest", "other"];
const SMART_DEVICE_TYPES = ["Camera", "Door Sensor", "Barrier", "Radar"] as const;
const MAP_COLORS = {
  red: "#f43f5e",
  orange: "#fb923c",
  amber: "#fbbf24",
  yellow: "#fde047",
  slate: "#64748b",
  blue: "#3b82f6",
  green: "#22c55e",
  ink: "#111827",
  white: "#ffffff",
};

type MapMenuState = {
  x: number;
  y: number;
  lng: number;
  lat: number;
};

type IncidentDraft = {
  location: string;
  zone: string;
  coord_x: number;
  coord_y: number;
  title?: string;
  description?: string;
  type?: IncidentType;
  severity?: number;
};

function normaliseLngLat(lng: number, lat: number): [number, number] {
  return [Number(lng.toFixed(6)), Number(lat.toFixed(6))];
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function deriveRisk(zoneName: string, incidents: any[], patrols: any[]) {
  const zoneIncidents = incidents.filter((incident) => incident.zone === zoneName);
  const zonePatrols = patrols.filter((patrol) => String(patrol.name ?? "").toLowerCase().includes(zoneName.toLowerCase()) || String(patrol.code ?? "").toLowerCase().includes(zoneName.toLowerCase()));
  const base = zoneRisk.find((zone) => zone.zone === zoneName)?.score ?? 45;
  const risk = base
    + zoneIncidents.filter((incident) => Number(incident.severity) >= 4).length * 8
    + zoneIncidents.filter((incident) => Number(incident.severity) >= 3).length * 4
    + zonePatrols.filter((patrol) => patrol.status === "delayed" || patrol.status === "missed").length * 6;
  return Math.max(0, Math.min(100, Math.round(risk)));
}

function riskColor(risk: number) {
  if (risk >= 80) return "hsl(0 84% 60%)";
  if (risk >= 65) return "hsl(24 95% 58%)";
  if (risk >= 45) return "hsl(38 92% 55%)";
  return "hsl(142 71% 45%)";
}

// Severity → CSS color (resolves design tokens to literal colors for mapbox paint)
function severityColor(s: number): string {
  const map: Record<number, string> = {
    5: MAP_COLORS.red,      // critical / red
    4: MAP_COLORS.orange,   // high / orange
    3: MAP_COLORS.amber,    // medium / amber
    2: MAP_COLORS.yellow,   // low / yellow
    1: MAP_COLORS.slate,    // info / grey
  };
  return map[s] ?? map[3];
}

function toGeoJsonFeature(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, any>;
  if (item.type === "Feature" && item.geometry && typeof item.geometry === "object") return item;
  if ((item.type === "Polygon" || item.type === "MultiPolygon" || item.type === "LineString" || item.type === "Point") && item.coordinates) {
    return { type: "Feature" as const, geometry: { type: item.type, coordinates: item.coordinates }, properties: {} };
  }
  if (item.geometry && typeof item.geometry === "object" && item.geometry.type && item.geometry.coordinates) {
    return { type: "Feature" as const, geometry: { type: item.geometry.type, coordinates: item.geometry.coordinates }, properties: {} };
  }
  return null;
}

function LiveMap() {
  const navigate = useNavigate();
  const { appAccess } = Route.useRouteContext();
  const qc = useQueryClient();
  const listInc = useServerFn(listIncidents);
  const listPat = useServerFn(listPatrols);
  const listLoc = useServerFn(listLocations);
  const listMem = useServerFn(listMembers);
  const getToken = useServerFn(getMapboxToken);
  const assignFn = useServerFn(assignIncidentToMe);
  const statusFn = useServerFn(updateIncidentStatus);

  const { data: incidents = [], isLoading } = useQuery({ queryKey: ["incidents"], queryFn: () => listInc() });
  const { data: patrols = [] } = useQuery({ queryKey: ["patrols"], queryFn: () => listPat() });
  const { data: locations = [] } = useQuery({ queryKey: ["locations"], queryFn: () => listLoc() });
  const { data: members = [] } = useQuery({ queryKey: ["members"], queryFn: () => listMem() });
  const { data: tokenData } = useQuery({ queryKey: ["mapbox_token"], queryFn: () => getToken(), staleTime: Infinity });

  // ---- UI state ----
  const [mode, setMode] = useState<Mode>("pins");
  const [win, setWin] = useState<Window>("7d");
  const [typeFilter, setTypeFilter] = useState<IncidentType | "all">("all");
  const [showOsint, setShowOsint] = useState(true);
  const [showOfficers, setShowOfficers] = useState(true);
  const [showPatrols, setShowPatrols] = useState(true);
  const [showZones, setShowZones] = useState(true);
  const [showSmartInfra, setShowSmartInfra] = useState(true);
  const [heatOpacity, setHeatOpacity] = useState(72);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentLocation, setCurrentLocation] = useState<[number, number] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [conn, setConn] = useState<"live" | "reconnecting">("live");
  const [contextMenu, setContextMenu] = useState<MapMenuState | null>(null);
  const [areaIntel, setAreaIntel] = useState<{ lng: number; lat: number; label: string } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // ---- Realtime + connection banner ----
  useEffect(() => {
    let retry = 0;
    const channel = supabase
      .channel("incidents-map")
      .on("postgres_changes", { event: "*", schema: "public", table: "incidents" }, () => {
        qc.invalidateQueries({ queryKey: ["incidents"] });
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") { setConn("live"); retry = 0; }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setConn("reconnecting");
          retry = Math.min(retry + 1, 6);
          setTimeout(() => channel.subscribe(), Math.min(1000 * 2 ** retry, 30_000));
        }
      });
    return () => { supabase.removeChannel(channel); };
  }, [qc]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  // ---- Filtered incidents ----
  const now = Date.now();
  const winMs = WINDOWS.find((w) => w.value === win)!.ms;
  const filtered = useMemo(() => {
    return incidents.filter((i) => {
      const age = now - new Date(i.reported_at).getTime();
      if (age > winMs) return false;
      if (typeFilter !== "all" && i.type !== typeFilter) return false;
      return true;
    });
  }, [incidents, now, winMs, typeFilter]);

  // ---- Build GeoJSON ----
  const geojson = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: filtered.map((i, idx) => {
      const lng = i.coord_x != null ? Number(i.coord_x) : LAGOS[0] + ((idx * 37) % 100 - 50) / 800;
      const lat = i.coord_y != null ? Number(i.coord_y) : LAGOS[1] + ((idx * 53) % 100 - 50) / 800;
      const sev = i.status === "resolved" ? 1 : i.severity;
      return {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [lng, lat] },
        properties: {
          id: i.id, sev, severity: i.severity, status: i.status,
          critical: i.severity >= 4 && i.status !== "resolved" ? 1 : 0,
        },
      };
    }),
  }), [filtered]);

  const sel = useMemo(
    () => filtered.find((i) => i.id === selected) ?? filtered[0] ?? null,
    [filtered, selected],
  );
  const searchResults = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return [] as Array<{ label: string; lng: number; lat: number; kind: string; id?: string }>;
    const results: Array<{ label: string; lng: number; lat: number; kind: string; id?: string }> = [];
    incidents.forEach((incident) => {
      const haystack = [incident.code, incident.location, incident.zone, incident.officer, incident.title, incident.description].filter(Boolean).join(" ").toLowerCase();
      if (haystack.includes(q) && incident.coord_x != null && incident.coord_y != null) {
        results.push({ label: `${incident.code} · ${incident.location}`, lng: Number(incident.coord_x), lat: Number(incident.coord_y), kind: "incident", id: incident.id });
      }
    });
    locations.forEach((location) => {
      const haystack = [location.name, (location as any).address].filter(Boolean).join(" ").toLowerCase();
      if (haystack.includes(q) && location.coord_x != null && location.coord_y != null) {
        results.push({ label: location.name, lng: Number(location.coord_x), lat: Number(location.coord_y), kind: "location", id: location.id });
      }
    });
    patrols.forEach((patrol, idx) => {
      const haystack = [patrol.code, patrol.name, patrol.officer, patrol.shift].join(" ").toLowerCase();
      if (haystack.includes(q)) {
        const location = locations.find((item) => item.id === patrol.location_id);
        const lng = location?.coord_x != null ? Number(location.coord_x) : LAGOS[0] + ((idx * 41) % 100 - 50) / 600;
        const lat = location?.coord_y != null ? Number(location.coord_y) : LAGOS[1] + ((idx * 67) % 100 - 50) / 600;
        results.push({ label: `${patrol.code} · ${patrol.name}`, lng, lat, kind: "patrol", id: patrol.id });
      }
    });
    return results.slice(0, 6);
  }, [incidents, locations, patrols, searchTerm]);
  const tacticalResponse = useMemo(() => {
    const target = sel ? `${sel.location}, ${sel.zone}` : "No active target";
    const priority = sel ? `Severity ${sel.severity} · ${statusMeta[sel.status as IncidentStatus]}` : "Awaiting live incident feed";
    const instruction = sel
      ? `Dispatch nearest patrol to ${target}. Lock perimeter, confirm camera sweep, and move the incident to responding within 90 seconds.`
      : "Watch the live feed and approve the next override when a critical signal is selected.";
    return { target, priority, instruction };
  }, [sel]);
  const incidentGeo = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: filtered.map((incident, idx) => {
        const lng = incident.coord_x != null ? Number(incident.coord_x) : LAGOS[0] + ((idx * 37) % 100 - 50) / 800;
        const lat = incident.coord_y != null ? Number(incident.coord_y) : LAGOS[1] + ((idx * 53) % 100 - 50) / 800;
        const sev = incident.status === "resolved" ? 1 : Number(incident.severity);
        return {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [lng, lat] },
          properties: {
            id: incident.id,
            sev,
            status: incident.status,
            title: incident.title ?? incident.code,
          },
        };
      }),
    }),
    [filtered],
  );
  const osintAlerts = useMemo(() => {
    const derived = incidents
      .filter((incident) => Number(incident.severity) >= 3 || incident.status === "escalated")
      .map((incident) => ({
        id: `osint-${incident.id}`,
        title: incident.title ?? incident.code,
        severity: Math.max(3, Number(incident.severity)),
        body: incident.description ?? `Intelligence signal from ${incident.location}`,
        lng: incident.coord_x != null ? Number(incident.coord_x) : null,
        lat: incident.coord_y != null ? Number(incident.coord_y) : null,
        source: "incident-linked",
      }));
    const fallback = derived.length ? derived : [
      { id: "osint-fallback-1", title: "Armed robbery reported nearby", severity: 4, body: "Unconfirmed intelligence signal in the Lagos metro zone.", lng: LAGOS[0] + 0.014, lat: LAGOS[1] + 0.008, source: "feed" },
      { id: "osint-fallback-2", title: "Suspicious movement pattern", severity: 3, body: "Pattern flagged by open-source intelligence scan.", lng: LAGOS[0] - 0.012, lat: LAGOS[1] + 0.011, source: "feed" },
    ];
    return fallback;
  }, [incidents]);
  const osintGeo = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: osintAlerts.map((alert, idx) => {
        const lng = alert.lng ?? LAGOS[0] + ((idx * 29) % 100 - 50) / 900;
        const lat = alert.lat ?? LAGOS[1] + ((idx * 47) % 100 - 50) / 900;
        return {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [lng, lat] },
          properties: {
            id: alert.id,
            title: alert.title,
            severity: alert.severity,
            source: alert.source,
            body: alert.body,
          },
        };
      }),
    }),
    [osintAlerts],
  );
  const officerRows = useMemo(() => {
    return members
      .filter((member: any) => ["officer", "supervisor", "manager"].includes(member.role))
      .map((member: any, idx) => {
        const label = member.profile?.display_name ?? `Officer ${idx + 1}`;
        const assignedLocationIds = member.profile?.assigned_location_ids ?? [];
        const assignedLocation = locations.find((location) => assignedLocationIds.includes(location.id));
        const fallbackCoord = [LAGOS[0] + ((idx * 19) % 100 - 50) / 700, LAGOS[1] + ((idx * 31) % 100 - 50) / 700] as [number, number];
        const lngLat = assignedLocation?.coord_x != null && assignedLocation?.coord_y != null
          ? normaliseLngLat(Number(assignedLocation.coord_x), Number(assignedLocation.coord_y))
          : fallbackCoord;
        return {
          id: member.user_id,
          name: label,
          initials: initials(label),
          status: member.profile?.status ?? "off-duty",
          lng: lngLat[0],
          lat: lngLat[1],
          lastSeen: member.profile?.updated_at ?? member.created_at,
          zone: member.profile?.zone ?? assignedLocation?.name ?? "All zones",
        };
      });
  }, [locations, members]);
  const officerGeo = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: officerRows.map((officer) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [officer.lng, officer.lat] },
        properties: {
          id: officer.id,
          initials: officer.initials,
          name: officer.name,
          status: officer.status,
          zone: officer.zone,
          lastSeen: officer.lastSeen,
        },
      })),
    }),
    [officerRows],
  );
  const patrolRouteRows = useMemo(() => {
    return patrols.map((patrol, idx) => {
      const baseLocation = locations.find((location) => location.id === patrol.location_id);
      const base = baseLocation?.coord_x != null && baseLocation?.coord_y != null
        ? [Number(baseLocation.coord_x), Number(baseLocation.coord_y)] as [number, number]
        : [LAGOS[0] + ((idx * 41) % 100 - 50) / 600, LAGOS[1] + ((idx * 67) % 100 - 50) / 600] as [number, number];
      const next = [base[0] + 0.012 * ((idx % 2 === 0) ? 1 : -1), base[1] + 0.006 * ((idx % 3 === 0) ? 1 : -1)] as [number, number];
      const steps = Math.max(3, Number(patrol.waypoints) || 3);
      const points = Array.from({ length: steps }).map((_, stepIdx) => {
        const ratio = stepIdx / Math.max(steps - 1, 1);
        const lng = base[0] + (next[0] - base[0]) * ratio;
        const lat = base[1] + (next[1] - base[1]) * ratio;
        const state = stepIdx < Number(patrol.checked_in)
          ? "complete"
          : stepIdx === Number(patrol.checked_in) && (patrol.status === "delayed" || patrol.status === "missed")
            ? "missed"
            : "pending";
        return { lng, lat, state };
      });
      return {
        id: patrol.id,
        name: patrol.name,
        officer: patrol.officer,
        status: patrol.status,
        line: {
          type: "Feature" as const,
          geometry: {
            type: "LineString" as const,
            coordinates: points.map((point) => [point.lng, point.lat]),
          },
          properties: { id: patrol.id, status: patrol.status, officer: patrol.officer },
        },
        points,
      };
    });
  }, [locations, patrols]);
  const patrolLineGeo = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: patrolRouteRows.map((row) => row.line),
    }),
    [patrolRouteRows],
  );
  const patrolWaypointGeo = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: patrolRouteRows.flatMap((row) =>
        row.points.map((point, idx) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [point.lng, point.lat] },
          properties: {
            id: `${row.id}-${idx}`,
            patrol_id: row.id,
            state: point.state,
            status: row.status,
            officer: row.officer,
          },
        })),
      ),
    }),
    [patrolRouteRows],
  );
  const zoneGeo = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: locations.flatMap((location) => {
        const feature = toGeoJsonFeature(location.geofence);
        if (!feature) return [];
        const risk = deriveRisk(location.name, incidents, patrols);
        return [{
          ...feature,
          properties: {
            ...(feature.properties ?? {}),
            id: location.id,
            name: location.name,
            risk,
          },
        }];
      }),
    }),
    [incidents, locations, patrols],
  );
  const canViewSmartInfra = appAccess.specRole === "security_manager";
  const smartGeo = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: (canViewSmartInfra ? locations : []).flatMap((location, idx) => {
        if (location.coord_x == null || location.coord_y == null) return [];
        return SMART_DEVICE_TYPES.map((kind, deviceIdx) => {
          const risk = deriveRisk(location.name, incidents, patrols);
          const status = risk >= 80 && deviceIdx % 2 === 0 ? "offline" : risk >= 60 && deviceIdx % 3 === 0 ? "override" : "online";
          const offsets = [
            [0.0022, 0.0018],
            [-0.0017, 0.0026],
            [0.0028, -0.0015],
            [-0.0024, -0.0021],
          ][deviceIdx];
          return {
            type: "Feature" as const,
            geometry: {
              type: "Point" as const,
              coordinates: [Number(location.coord_x) + offsets[0], Number(location.coord_y) + offsets[1]],
            },
            properties: {
              id: `${location.id}-${kind}-${idx}`,
              kind,
              status,
              name: `${kind} · ${location.name}`,
              risk,
            },
          };
        });
      }),
    }),
    [canViewSmartInfra, incidents, locations, patrols],
  );

  // ---- Map ----
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const loadedRef = useRef(false);
  const routePulseRef = useRef<number | null>(null);
  const listenersBoundRef = useRef(false);

  useEffect(() => {
    if (!tokenData?.token || !mapContainer.current || mapRef.current) return;
    mapboxgl.accessToken = tokenData.token;
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: LAGOS,
      zoom: 11,
      attributionControl: false,
    });
    map.on("error", (e) => {
      // Surface tile/style failures rather than silently showing a grey canvas
      // eslint-disable-next-line no-console
      console.error("[mapbox]", e?.error?.message ?? e);
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;


    map.on("load", () => {
      loadedRef.current = true;
      // Fix container sizing race in flex/grid layouts
      requestAnimationFrame(() => map.resize());
      // Incidents source (clustered)
      map.addSource("incidents", {
        type: "geojson", data: geojson, cluster: true,
        clusterMaxZoom: 14, clusterRadius: 50,
        clusterProperties: { maxSev: ["max", ["get", "sev"]] },
      });
      // Cluster bubbles
      map.addLayer({
        id: "clusters", type: "circle", source: "incidents", filter: ["has", "point_count"],
        paint: {
          "circle-color": [
            "step", ["get", "maxSev"],
            MAP_COLORS.slate, 2,
            MAP_COLORS.yellow, 3,
            MAP_COLORS.amber, 4,
            MAP_COLORS.orange, 5,
            MAP_COLORS.red,
          ],
          "circle-radius": ["step", ["get", "point_count"], 16, 5, 22, 20, 30],
          "circle-stroke-width": 2, "circle-stroke-color": MAP_COLORS.ink,
          "circle-opacity": 0.9,
        },
      });
      map.addLayer({
        id: "cluster-count", type: "symbol", source: "incidents", filter: ["has", "point_count"],
        layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12, "text-font": ["DIN Pro Medium", "Arial Unicode MS Bold"] },
        paint: { "text-color": "#fff" },
      });
      // Single points
      map.addLayer({
        id: "unclustered", type: "circle", source: "incidents", filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": [
            "match", ["get", "sev"],
            5, MAP_COLORS.red, 4, MAP_COLORS.orange, 3, MAP_COLORS.amber,
            2, MAP_COLORS.yellow, MAP_COLORS.slate,
          ],
          "circle-radius": ["case", ["==", ["get", "critical"], 1], 9, 7],
          "circle-stroke-width": 2, "circle-stroke-color": MAP_COLORS.ink,
        },
      });
      // Heatmap layer (toggled)
      map.addLayer({
        id: "incidents-heat", type: "heatmap", source: "incidents",
        layout: { visibility: "none" },
        paint: {
          "heatmap-weight": ["interpolate", ["linear"], ["get", "sev"], 1, 0.2, 5, 1],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 9, 1, 15, 3],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 9, 18, 15, 40],
          "heatmap-opacity": 0.75,
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(0,0,0,0)",
            0.2, "rgba(59,130,246,0.4)",
            0.4, "rgba(253,224,71,0.6)",
            0.7, "rgba(251,146,60,0.8)",
            1, "rgba(244,63,94,0.95)",
          ],
        },
      });

      // Zones (geofences) source
      map.addSource("zones", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "zones-fill", type: "fill", source: "zones",
        paint: { "fill-color": MAP_COLORS.blue, "fill-opacity": 0.12 },
      });
      map.addLayer({
        id: "zones-line", type: "line", source: "zones",
        paint: { "line-color": MAP_COLORS.blue, "line-width": 1.5, "line-dasharray": [2, 2] },
      });

      // Patrol source
      map.addSource("patrols", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "patrols-pts", type: "circle", source: "patrols",
        paint: {
          "circle-color": [
            "match", ["get", "status"],
            "complete", MAP_COLORS.green,
            "missed", MAP_COLORS.red,
            "delayed", MAP_COLORS.orange,
            MAP_COLORS.blue,
          ],
          "circle-radius": 6, "circle-stroke-width": 2, "circle-stroke-color": MAP_COLORS.ink,
        },
      });

      // Click handlers
      map.on("click", "unclustered", (e) => {
        const f = e.features?.[0]; if (!f) return;
        const id = (f.properties as any).id as string;
        const [lng, lat] = (f.geometry as any).coordinates as [number, number];
        setSelected(id);
        map.flyTo({ center: [lng, lat], zoom: 14, duration: 700 });
      });
      map.on("click", "clusters", (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
        const clusterId = features[0]?.properties?.cluster_id;
        const src = map.getSource("incidents") as mapboxgl.GeoJSONSource;
          src.getClusterExpansionZoom(clusterId, (err, zoom) => {
            if (err || zoom == null) return;
            const coords = (features[0].geometry as any).coordinates as [number, number];
            map.easeTo({ center: coords, zoom });
          });
      });
      map.on("mouseenter", "unclustered", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "unclustered", () => { map.getCanvas().style.cursor = ""; });
      map.on("mouseenter", "clusters", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "clusters", () => { map.getCanvas().style.cursor = ""; });
    });

    // Resize when container changes size (sidebar collapse, viewport change)
    const ro = new ResizeObserver(() => { try { map.resize(); } catch {} });
    if (mapContainer.current) ro.observe(mapContainer.current);

    return () => {
      ro.disconnect();
      loadedRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, [tokenData?.token]);

  // Update incidents data
  useEffect(() => {
    const map = mapRef.current; if (!map || !loadedRef.current) return;
    const src = map.getSource("incidents") as mapboxgl.GeoJSONSource | undefined;
    src?.setData(geojson);
  }, [geojson]);

  // Toggle pins vs heatmap
  useEffect(() => {
    const map = mapRef.current; if (!map || !loadedRef.current) return;
    const pinVis = mode === "pins" ? "visible" : "none";
    const heatVis = mode === "heatmap" ? "visible" : "none";
    ["clusters", "cluster-count", "unclustered"].forEach((id) => map.setLayoutProperty(id, "visibility", pinVis));
    map.setLayoutProperty("incidents-heat", "visibility", heatVis);
  }, [mode]);

  // Zones overlay
  useEffect(() => {
    const map = mapRef.current; if (!map || !loadedRef.current) return;
    const features = (showZones ? locations : [])
      .flatMap((l) => {
        const feature = toGeoJsonFeature(l.geofence);
        return feature ? [{ ...feature, properties: { name: l.name } }] : [];
      });
    const src = map.getSource("zones") as mapboxgl.GeoJSONSource | undefined;
    src?.setData({ type: "FeatureCollection", features });
  }, [locations, showZones]);

  // Patrol overlay
  useEffect(() => {
    const map = mapRef.current; if (!map || !loadedRef.current) return;
    const features = (showPatrols ? patrols : []).map((p, idx) => {
      // Place at associated location coord if any, else around lagos
      const loc = locations.find((l) => l.id === p.location_id);
      const lng = loc?.coord_x != null ? Number(loc.coord_x) : LAGOS[0] + ((idx * 41) % 100 - 50) / 600;
      const lat = loc?.coord_y != null ? Number(loc.coord_y) : LAGOS[1] + ((idx * 67) % 100 - 50) / 600;
      return {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [lng, lat] },
        properties: { code: p.code, status: p.status, officer: p.officer },
      };
    });
    const src = map.getSource("patrols") as mapboxgl.GeoJSONSource | undefined;
    src?.setData({ type: "FeatureCollection", features });
  }, [patrols, locations, showPatrols]);

  const flyToResult = (lng: number, lat: number, id?: string, kind?: string) => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ center: [lng, lat], zoom: kind === "patrol" ? 13 : 14, duration: 600 });
    if (id) {
      const match = incidents.find((incident) => incident.id === id) ?? null;
      if (match) setSelected(match.id);
    }
    setContextMenu(null);
    setAreaIntel({ lng, lat, label: kind ? `${kind} match` : "Area match" });
  };

  const logIncidentHere = (lng: number, lat: number) => {
    const nearestLocation = locations.find((location) => location.coord_x != null && location.coord_y != null);
    const draft: IncidentDraft = {
      location: nearestLocation?.name ?? "Mapped area",
      zone: nearestLocation?.name ?? "Mapped area",
      coord_x: lng,
      coord_y: lat,
      title: "Map-originated incident",
      description: `Logged from live map at ${lng.toFixed(5)}, ${lat.toFixed(5)}.`,
      type: "suspicious",
      severity: 3,
    };
    sessionStorage.setItem("lemtik_incident_draft", JSON.stringify(draft));
    setContextMenu(null);
    navigate({ to: "/app/incidents" });
  };

  const drawZoneHere = (lng: number, lat: number) => {
    const payload = {
      name: "New live zone",
      coord_x: lng,
      coord_y: lat,
      source: "map-context",
    };
    sessionStorage.setItem("lemtik_zone_draft", JSON.stringify(payload));
    setContextMenu(null);
    navigate({ to: "/app/locations" });
  };

  const toggleFullscreen = async () => {
    const wrapper = mapContainer.current?.parentElement?.parentElement;
    if (!wrapper) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      setIsFullscreen(false);
    } else if (wrapper.requestFullscreen) {
      await wrapper.requestFullscreen();
      setIsFullscreen(true);
    }
  };

  const focusCurrentLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((position) => {
      const coords: [number, number] = [position.coords.longitude, position.coords.latitude];
      setCurrentLocation(coords);
      const map = mapRef.current;
      map?.flyTo({ center: coords, zoom: 14, duration: 700 });
    });
  };

  const runSearch = () => {
    const result = searchResults[0];
    if (!result) return;
    flyToResult(result.lng, result.lat, result.id, result.kind);
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;

    const ensureSource = (id: string, data: any) => {
      const existing = map.getSource(id) as mapboxgl.GeoJSONSource | undefined;
      if (!existing) {
        map.addSource(id, { type: "geojson", data });
      } else {
        existing.setData(data);
      }
    };

    ensureSource("command-osint", osintGeo);
    ensureSource("command-officers", officerGeo);
    ensureSource("command-patrol-lines", patrolLineGeo);
    ensureSource("command-patrol-waypoints", patrolWaypointGeo);
    ensureSource("command-smart", smartGeo);

    if (!map.getLayer("command-osint-diamond")) {
      map.addLayer({
        id: "command-osint-diamond",
        type: "symbol",
        source: "command-osint",
        layout: {
          "text-field": "◆",
          "text-size": 16,
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": [
            "match",
            ["get", "severity"],
            5, MAP_COLORS.red,
            4, MAP_COLORS.orange,
            3, MAP_COLORS.amber,
            MAP_COLORS.yellow,
          ],
        },
      });
    }
    if (!map.getLayer("command-officers-dot")) {
      map.addLayer({
        id: "command-officers-dot",
        type: "circle",
        source: "command-officers",
        paint: {
          "circle-color": MAP_COLORS.blue,
          "circle-radius": 7,
          "circle-stroke-width": 2,
          "circle-stroke-color": MAP_COLORS.ink,
        },
      });
      map.addLayer({
        id: "command-officers-initials",
        type: "symbol",
        source: "command-officers",
        layout: {
          "text-field": ["get", "initials"],
          "text-size": 10,
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Bold"],
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#fff" },
      });
    }
    if (!map.getLayer("command-patrol-line")) {
      map.addLayer({
        id: "command-patrol-line",
        type: "line",
        source: "command-patrol-lines",
        paint: {
          "line-color": [
            "match",
            ["get", "status"],
            "complete", MAP_COLORS.green,
            "missed", MAP_COLORS.red,
            "delayed", MAP_COLORS.orange,
            MAP_COLORS.blue,
          ],
          "line-width": 3,
          "line-opacity": 0.82,
          "line-dasharray": [2, 1.2],
        },
      });
    }
    if (!map.getLayer("command-patrol-waypoints")) {
      map.addLayer({
        id: "command-patrol-waypoints",
        type: "circle",
        source: "command-patrol-waypoints",
        paint: {
          "circle-color": [
            "match",
            ["get", "state"],
            "complete", MAP_COLORS.green,
            "missed", MAP_COLORS.red,
            "pending", MAP_COLORS.slate,
            MAP_COLORS.blue,
          ],
          "circle-radius": 4,
          "circle-stroke-width": 1,
          "circle-stroke-color": MAP_COLORS.ink,
        },
      });
    }
    if (!map.getLayer("command-smart-symbol")) {
      map.addLayer({
        id: "command-smart-symbol",
        type: "symbol",
        source: "command-smart",
        layout: {
          "text-field": ["get", "kind"],
          "text-size": 11,
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": [
            "match",
            ["get", "status"],
            "offline", MAP_COLORS.red,
            "override", MAP_COLORS.orange,
            MAP_COLORS.green,
          ],
        },
      });
    }

    const heatOpacityValue = Math.max(0.05, Math.min(1, heatOpacity / 100));
    map.setLayoutProperty("incidents-heat", "visibility", mode === "heatmap" ? "visible" : "none");
    map.setLayoutProperty("clusters", "visibility", mode === "pins" ? "visible" : "none");
    map.setLayoutProperty("cluster-count", "visibility", mode === "pins" ? "visible" : "none");
    map.setLayoutProperty("unclustered", "visibility", mode === "pins" ? "visible" : "none");
    map.setPaintProperty("incidents-heat", "heatmap-opacity", heatOpacityValue);
    map.setLayoutProperty("command-osint-diamond", "visibility", showOsint ? "visible" : "none");
    map.setLayoutProperty("command-officers-dot", "visibility", showOfficers ? "visible" : "none");
    map.setLayoutProperty("command-officers-initials", "visibility", showOfficers ? "visible" : "none");
    map.setLayoutProperty("patrols-pts", "visibility", showPatrols ? "visible" : "none");
    map.setLayoutProperty("command-patrol-line", "visibility", showPatrols ? "visible" : "none");
    map.setLayoutProperty("command-patrol-waypoints", "visibility", showPatrols ? "visible" : "none");
    map.setLayoutProperty("zones-fill", "visibility", showZones ? "visible" : "none");
    map.setLayoutProperty("zones-line", "visibility", showZones ? "visible" : "none");
    map.setLayoutProperty("command-smart-symbol", "visibility", canViewSmartInfra && showSmartInfra ? "visible" : "none");
    map.setPaintProperty("zones-fill", "fill-color", [
      "step",
      ["get", "risk"],
      MAP_COLORS.green,
      45, MAP_COLORS.amber,
      65, MAP_COLORS.orange,
      80, MAP_COLORS.red,
    ]);
    map.setPaintProperty("zones-fill", "fill-opacity", 0.12);
    map.setPaintProperty("zones-line", "line-color", [
      "step",
      ["get", "risk"],
      MAP_COLORS.green,
      45, MAP_COLORS.amber,
      65, MAP_COLORS.orange,
      80, MAP_COLORS.red,
    ]);
    map.setPaintProperty("command-patrol-line", "line-dasharray", [2, 1.2]);

    if (routePulseRef.current) window.clearInterval(routePulseRef.current);
    routePulseRef.current = window.setInterval(() => {
      const phase = (Date.now() / 360) % 6;
      if (!mapRef.current || !loadedRef.current || !mapRef.current.getLayer("command-patrol-line")) return;
      mapRef.current.setPaintProperty("command-patrol-line", "line-dasharray", [2 + phase * 0.2, 1.2 + phase * 0.08]);
    }, 300);

    if (!listenersBoundRef.current) {
      const setHover = (label: string) => {
        map.getCanvas().style.cursor = label;
      };
      map.on("mouseenter", "command-osint-diamond", () => setHover("pointer"));
      map.on("mouseleave", "command-osint-diamond", () => setHover(""));
      map.on("mouseenter", "command-officers-dot", () => setHover("pointer"));
      map.on("mouseleave", "command-officers-dot", () => setHover(""));
      map.on("mouseenter", "command-patrol-line", () => setHover("pointer"));
      map.on("mouseleave", "command-patrol-line", () => setHover(""));
      map.on("mouseenter", "command-smart-symbol", () => setHover("pointer"));
      map.on("mouseleave", "command-smart-symbol", () => setHover(""));

      map.on("click", "command-osint-diamond", (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const [lng, lat] = (feature.geometry as any).coordinates as [number, number];
        const label = String(feature.properties?.title ?? "OSINT signal");
        setAreaIntel({ lng, lat, label });
        map.easeTo({ center: [lng, lat], zoom: 13, duration: 500 });
      });
      map.on("click", "command-officers-dot", (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const [lng, lat] = (feature.geometry as any).coordinates as [number, number];
        map.easeTo({ center: [lng, lat], zoom: 13, duration: 500 });
      });
      map.on("click", "command-smart-symbol", (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const [lng, lat] = (feature.geometry as any).coordinates as [number, number];
        setAreaIntel({ lng, lat, label: String(feature.properties?.name ?? "Smart device") });
        map.easeTo({ center: [lng, lat], zoom: 14, duration: 500 });
      });
      listenersBoundRef.current = true;
    }

    return () => {
      if (routePulseRef.current) {
        window.clearInterval(routePulseRef.current);
        routePulseRef.current = null;
      }
    };
  }, [
    canViewSmartInfra,
    heatOpacity,
    incidentGeo,
    mode,
    officerGeo,
    osintGeo,
    patrolLineGeo,
    patrolWaypointGeo,
    showOfficers,
    showOsint,
    showPatrols,
    showSmartInfra,
    showZones,
    smartGeo,
    zoneGeo,
  ]);

  // Mutations
  const assignMut = useMutation({
    mutationFn: (id: string) => assignFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["incidents"] }),
  });
  const statusMut = useMutation({
    mutationFn: (v: { id: string; status: IncidentStatus }) => statusFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["incidents"] }),
  });

  const tokenMissing = tokenData && !tokenData.token;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Live Incident Map</div>
          <h1 className="mt-1 text-2xl font-semibold">Lagos operations</h1>
          <p className="text-sm text-muted-foreground">
            {filtered.length} of {incidents.length} incident{incidents.length === 1 ? "" : "s"} · last {WINDOWS.find((w) => w.value === win)?.label}
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[11px]">
          {conn === "live" ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-low/30 bg-low/10 px-2 py-1 text-low">
              <Wifi className="h-3 w-3" /> Live
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-high/40 bg-high/10 px-2 py-1 text-high">
              <WifiOff className="h-3 w-3" /> Live updates paused — reconnecting…
            </span>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runSearch();
              }
            }}
            placeholder="Search address or area"
            className="w-full rounded border border-border bg-surface py-1.5 pl-7 pr-3 text-[11px] text-foreground"
          />
        </div>
        <button onClick={runSearch} className="inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground">
          <MapPinned className="h-3.5 w-3.5" /> Go
        </button>
        <div className="h-5 w-px bg-border mx-1" />
        <SegBtn active={mode === "pins"} onClick={() => setMode("pins")} icon={Pin}>Pins</SegBtn>
        <SegBtn active={mode === "heatmap"} onClick={() => setMode("heatmap")} icon={Flame}>Heatmap</SegBtn>
        <div className="h-5 w-px bg-border mx-1" />
        <div className="flex items-center gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w.value}
              onClick={() => setWin(w.value)}
              className={`rounded px-2 py-1 text-[11px] font-medium uppercase tracking-wider ${win === w.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {w.label}
            </button>
          ))}
        </div>
        <div className="h-5 w-px bg-border mx-1" />
        <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>Type</span>
          <div className="relative">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as IncidentType | "all")}
              className="appearance-none rounded border border-border bg-surface pr-6 pl-2 py-1 text-[11px] text-foreground"
            >
              {TYPE_OPTS.map((t) => (
                <option key={t} value={t}>{t === "all" ? "All types" : typeMeta[t as IncidentType]}</option>
              ))}
            </select>
            <ChevronsUpDown className="pointer-events-none absolute right-1 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          </div>
        </label>
        <div className="h-5 w-px bg-border mx-1" />
        <ToggleBtn active={showOsint} onClick={() => setShowOsint((v) => !v)} icon={Diamond}>OSINT</ToggleBtn>
        <ToggleBtn active={showOfficers} onClick={() => setShowOfficers((v) => !v)} icon={Users}>Officers</ToggleBtn>
        <ToggleBtn active={showPatrols} onClick={() => setShowPatrols((v) => !v)} icon={Radar}>Patrols</ToggleBtn>
        <ToggleBtn active={showZones} onClick={() => setShowZones((v) => !v)} icon={Layers}>Zones</ToggleBtn>
        {canViewSmartInfra && (
          <ToggleBtn active={showSmartInfra} onClick={() => setShowSmartInfra((v) => !v)} icon={Radio}>Smart infra</ToggleBtn>
        )}
        <button onClick={focusCurrentLocation} className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground">
          <LocateFixed className="h-3.5 w-3.5" /> My location
        </button>
        <button onClick={toggleFullscreen} className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground">
          <Maximize2 className="h-3.5 w-3.5" /> {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        </button>
        <label className="ml-auto inline-flex items-center gap-2 text-[11px] text-muted-foreground">
          Heat opacity
          <input
            type="range"
            min={5}
            max={100}
            value={heatOpacity}
            onChange={(e) => setHeatOpacity(Number(e.target.value))}
            className="w-28"
          />
        </label>
      </div>

      {/* Map + Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-3">
        <div
          className="relative overflow-hidden rounded-lg border border-border bg-surface h-[calc(100vh-260px)] min-h-[480px]"
          onContextMenu={(e) => {
            e.preventDefault();
            const map = mapRef.current;
            if (!map) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const point = [e.clientX - rect.left, e.clientY - rect.top] as [number, number];
            const lngLat = map.unproject(point);
            setContextMenu({ x: e.clientX, y: e.clientY, lng: lngLat.lng, lat: lngLat.lat });
          }}
          onClick={() => setContextMenu(null)}
        >
          {/* Always mount the container so the ref is present before the map init effect runs */}
          <div ref={mapContainer} className="absolute inset-0" style={{ width: "100%", height: "100%" }} />
          {tokenMissing && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center bg-surface z-10">
              <div>
                <div className="text-sm font-medium text-critical">Mapbox token missing</div>
                <p className="mt-2 text-xs text-muted-foreground">Add MAPBOX_PUBLIC_TOKEN in project secrets.</p>
              </div>
            </div>
          )}
          {!tokenData && (
            <div className="absolute inset-0 grid place-items-center bg-surface z-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {!tokenMissing && (
            <div className="absolute bottom-4 left-4 z-10 flex items-center gap-3 rounded-md border border-border bg-background/90 backdrop-blur px-3 py-2 text-[11px]">
              {([5, 4, 3, 2, 1] as const).map((s) => (
                <span key={s} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: severityColor(s) }} />
                  S{s}
                </span>
              ))}
            </div>
          )}
          <div className="absolute top-4 left-4 z-10 space-y-2">
            <div className="rounded-md border border-critical/30 bg-background/90 backdrop-blur px-3 py-2 text-[11px] shadow-lg">
              <div className="flex items-center gap-2 font-medium text-foreground">
                <span className="h-2 w-2 rounded-full bg-critical animate-pulse" />
                Target lock
              </div>
              <div className="mt-1 font-mono text-muted-foreground">{tacticalResponse.target}</div>
            </div>
            {currentLocation && (
              <div className="rounded-md border border-border bg-background/90 backdrop-blur px-3 py-2 text-[11px] shadow-lg">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <LocateFixed className="h-3.5 w-3.5 text-high" />
                  Current position
                </div>
                <div className="mt-1 font-mono text-muted-foreground">{currentLocation[1].toFixed(5)}, {currentLocation[0].toFixed(5)}</div>
              </div>
            )}
          </div>
          {areaIntel && (
            <div className="absolute right-4 top-4 z-10 max-w-sm rounded-lg border border-border bg-background/92 px-3 py-2 text-[11px] shadow-xl backdrop-blur">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium text-foreground">Area intelligence</div>
                <button onClick={(e) => { e.stopPropagation(); setAreaIntel(null); }} className="text-muted-foreground hover:text-foreground">×</button>
              </div>
              <div className="mt-1 font-semibold text-foreground">{areaIntel.label}</div>
              <div className="mt-1 text-muted-foreground">
                Coordinates {areaIntel.lat.toFixed(5)}, {areaIntel.lng.toFixed(5)}
              </div>
              <div className="mt-2 text-muted-foreground">
                Nearby incidents and OSINT signals can be reviewed from the incident panel after you pin or search the area.
              </div>
            </div>
          )}
          {contextMenu && (
            <div
              className="fixed z-50 w-52 rounded-lg border border-border bg-card p-2 shadow-2xl"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => logIncidentHere(contextMenu.lng, contextMenu.lat)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[11px] text-foreground hover:bg-surface"
              >
                <Shield className="h-3.5 w-3.5 text-critical" /> Log incident here
              </button>
              <button
                type="button"
                onClick={() => drawZoneHere(contextMenu.lng, contextMenu.lat)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[11px] text-foreground hover:bg-surface"
              >
                <RouteIcon className="h-3.5 w-3.5 text-high" /> Draw new zone
              </button>
              <button
                type="button"
                onClick={() => {
                  setAreaIntel({ lng: contextMenu.lng, lat: contextMenu.lat, label: "Area intelligence query" });
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[11px] text-foreground hover:bg-surface"
              >
                <Gauge className="h-3.5 w-3.5 text-resolved" /> View area intelligence
              </button>
            </div>
          )}
        </div>

        {/* Slide-in panel (always rendered on lg, slides in on mobile via translate) */}
        <aside
          className={`rounded-lg border border-border bg-card p-5 transition-all ${sel ? "" : "opacity-70"}`}
        >
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading incidents…
            </div>
          ) : sel ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-critical/30 bg-critical/10 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">AI Dynamic Tactical Response</div>
                    <div className="text-sm font-semibold text-foreground">{tacticalResponse.priority}</div>
                  </div>
                  <span className="rounded-md border border-critical/30 bg-background/80 px-2 py-1 text-[10px] uppercase tracking-wider text-critical">
                    Live
                  </span>
                </div>
                <div className="mt-3 rounded-md border border-border bg-card px-3 py-2 text-xs leading-relaxed text-foreground">
                  {tacticalResponse.instruction}
                </div>
                <button
                  onClick={() => {
                    assignMut.mutate(sel.id);
                    statusMut.mutate({ id: sel.id, status: "responding" });
                  }}
                  className="mt-3 inline-flex w-full items-center justify-center rounded-md bg-critical px-3 py-2 text-xs font-medium text-white hover:opacity-90"
                >
                  Approve & Execute Overrides
                </button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <SeverityBadge severity={sel.severity as Severity} />
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  {statusMeta[sel.status as IncidentStatus]}
                </span>
              </div>
              <div>
                <div className="text-xs font-mono text-muted-foreground">{sel.code}</div>
                <div className="mt-1 text-base font-semibold">{typeMeta[sel.type as IncidentType]}</div>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3" /> {sel.location} · {sel.zone}
                </div>
              </div>
              <p className="text-sm text-foreground/90 leading-relaxed line-clamp-4">
                {sel.description ?? "No description on file."}
              </p>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <Field label="Reported" value={new Date(sel.reported_at).toLocaleString("en-GB")} />
                <Field label="Since" value={timeAgo(sel.reported_at)} />
                <Field label="Assigned" value={sel.officer ?? "Unassigned"} />
                <Field label="Status" value={statusMeta[sel.status as IncidentStatus]} />
              </div>

              <div className="space-y-1.5 pt-1">
                <Link
                  to="/app/incidents"
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium hover:bg-surface-2"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> View full incident
                </Link>
                <button
                  onClick={() => assignMut.mutate(sel.id)}
                  disabled={assignMut.isPending}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                >
                  {assignMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                  Assign to me
                </button>
                <div className="relative">
                  <select
                    value={sel.status}
                    onChange={(e) => statusMut.mutate({ id: sel.id, status: e.target.value as IncidentStatus })}
                    className="w-full appearance-none rounded-md border border-border bg-surface px-3 py-2 pr-8 text-xs font-medium hover:bg-surface-2"
                  >
                    {(Object.keys(statusMeta) as IncidentStatus[]).map((s) => (
                      <option key={s} value={s}>Change status: {statusMeta[s]}</option>
                    ))}
                  </select>
                  <ChevronRight className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 rotate-90 text-muted-foreground" />
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              No incidents in this window. Adjust the time range or filters, or log a new incident.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function SegBtn({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: any; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-medium ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
      <Icon className="h-3.5 w-3.5" /> {children}
    </button>
  );
}
function ToggleBtn({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: any; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] font-medium ${active ? "border-primary/40 bg-primary/10 text-foreground" : "border-border bg-surface text-muted-foreground hover:text-foreground"}`}>
      <Icon className="h-3.5 w-3.5" /> {children}
    </button>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-foreground truncate">{value}</div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  const m = s / 60; if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60; if (h < 24) return `${Math.floor(h)}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
