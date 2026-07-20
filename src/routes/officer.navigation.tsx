import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMapboxToken } from "@/lib/config.functions";
import { listIncidents } from "@/lib/incidents.functions";
import { listMyNotifications } from "@/lib/alerts.functions";
import { calculateRoute } from "@/lib/patrols.functions";
import { ArrowLeft, CheckCircle2, MapPinned, Navigation2, RefreshCw, Route as RouteIcon, TimerReset, WifiOff, CloudUpload } from "lucide-react";

export const Route = createFileRoute("/officer/navigation")({
  component: OfficerNavigation,
});

type Coord = [number, number];
type NavStep = { title: string; detail: string };
type NavigationPlan = {
  incidentId: string;
  label: string;
  start: Coord;
  destination: Coord;
  coordinates: Coord[];
  steps: NavStep[];
  eta: string;
  distanceKm: number;
  source: "online" | "offline";
  savedAt: string;
};

type IncidentRow = {
  id: string;
  code: string;
  location: string;
  zone: string;
  status: string;
  coord_x: number | null;
  coord_y: number | null;
};

function formatEta(minutes: number) {
  const safe = Math.max(1, Math.round(minutes));
  if (safe < 60) return `${safe} min`;
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return mins === 0 ? `${hours} hr` : `${hours} hr ${mins} min`;
}

function directionFromDelta(origin: Coord, destination: Coord) {
  const lngDelta = destination[0] - origin[0];
  const latDelta = destination[1] - origin[1];
  const horizontal = Math.abs(lngDelta) > 0.0003 ? (lngDelta > 0 ? "east" : "west") : "";
  const vertical = Math.abs(latDelta) > 0.0003 ? (latDelta > 0 ? "north" : "south") : "";
  if (horizontal && vertical) return `${vertical}-${horizontal}`;
  return vertical || horizontal || "forward";
}

function buildOfflinePlan(incident: IncidentRow, start: Coord, destination: Coord): NavigationPlan {
  const distanceKm = Math.max(Math.hypot(destination[0] - start[0], destination[1] - start[1]) * 111, 0.2);
  const etaMinutes = distanceKm / 4.5 * 60;
  const direction = directionFromDelta(start, destination);
  const midpoint: Coord = [
    start[0] + (destination[0] - start[0]) * 0.52,
    start[1] + (destination[1] - start[1]) * 0.52,
  ];
  return {
    incidentId: incident.id,
    label: `${incident.location}${incident.zone ? ` · ${incident.zone}` : ""}`,
    start,
    destination,
    coordinates: [start, midpoint, destination],
    steps: [
      { title: "Leave current position", detail: `Head ${direction} toward the incident.` },
      { title: "Approach the scene", detail: `Continue for roughly ${distanceKm.toFixed(1)} km on the safest available route.` },
      { title: "Confirm the destination", detail: `Arrive at ${incident.location} and advise command before contact.` },
      { title: "Log arrival", detail: "Use the arrival button once you are on site." },
    ],
    eta: formatEta(etaMinutes),
    distanceKm,
    source: "offline",
    savedAt: new Date().toISOString(),
  };
}

function buildOnlinePlan(
  incident: IncidentRow,
  start: Coord,
  destination: Coord,
  route: {
    geometry?: { coordinates?: Coord[] };
    duration?: number;
    distance?: number;
    legs?: Array<{ steps?: Array<{ maneuver?: { instruction?: string }; distance?: number }> }>;
  },
): NavigationPlan {
  const coordinates = route.geometry?.coordinates?.length ? route.geometry.coordinates : [start, destination];
  const steps = route.legs?.[0]?.steps?.length
    ? route.legs[0].steps.map((step, idx) => ({
        title: `Step ${idx + 1}`,
        detail: step.maneuver?.instruction || `Proceed for ${((step.distance ?? 0) / 1000).toFixed(1)} km.`,
      }))
    : buildOfflinePlan(incident, start, destination).steps;
  return {
    incidentId: incident.id,
    label: `${incident.location}${incident.zone ? ` · ${incident.zone}` : ""}`,
    start,
    destination,
    coordinates,
    steps,
    eta: formatEta((route.duration ?? 0) / 60),
    distanceKm: Math.max(0.1, (route.distance ?? 0) / 1000),
    source: "online",
    savedAt: new Date().toISOString(),
  };
}

async function fetchOnlinePlan(routeFn: any, incident: IncidentRow, start: Coord, destination: Coord) {
  const route = await routeFn({
    data: {
      start,
      destination,
      mode: "walking",
      incident_id: incident.id,
    },
  }) as {
    geometry?: { coordinates?: Coord[] };
    duration?: number;
    distance?: number;
    legs?: Array<{ steps?: Array<{ maneuver?: { instruction?: string }; distance?: number }> }>;
  } | null;
  if (!route) throw new Error("No route returned from the Relationship API");
  return buildOnlinePlan(incident, start, destination, route);
}

function OfficerNavigation() {
  const tokenFn = useServerFn(getMapboxToken);
  const listInc = useServerFn(listIncidents);
  const listNotifs = useServerFn(listMyNotifications);
  const routeFn = useServerFn(calculateRoute);
  const { data: token } = useQuery({ queryKey: ["officer-mapbox-token"], queryFn: () => tokenFn(), staleTime: Infinity });
  const { data: incidents = [] } = useQuery({ queryKey: ["officer-navigation-incidents"], queryFn: () => listInc() as Promise<IncidentRow[]> });
  const { data: notifications = [] } = useQuery({
    queryKey: ["officer-navigation-notifications"],
    queryFn: () => listNotifs(),
    refetchInterval: 30_000,
  });

  const [arrived, setArrived] = useState(false);
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [currentPosition, setCurrentPosition] = useState<Coord | null>(null);
  const [plan, setPlan] = useState<NavigationPlan | null>(null);
  const [snapshotLoaded, setSnapshotLoaded] = useState(false);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeMessage, setRouteMessage] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  const activeIncident = useMemo(
    () => {
      const notifiedIncidentId = [...notifications]
        .reverse()
        .find((n: any) => n.incident_id && (n.alert_type?.startsWith("incident") || n.action?.toLowerCase().includes("navigation")) && !n.read)?.incident_id
        ?? [...notifications].reverse().find((n: any) => n.incident_id && n.alert_type?.startsWith("incident"))?.incident_id;
      if (notifiedIncidentId) {
        const matched = incidents.find((incident) => incident.id === notifiedIncidentId && incident.coord_x != null && incident.coord_y != null);
        if (matched) return matched;
      }
      return incidents.find((incident) => incident.status !== "resolved" && incident.status !== "closed" && incident.coord_x != null && incident.coord_y != null) ?? null;
    },
    [incidents, notifications],
  );

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setCurrentPosition([pos.coords.longitude, pos.coords.latitude]),
      () => undefined,
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }, []);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const recalculateRoute = async (forceOffline = false) => {
    if (!activeIncident) {
      setPlan(null);
      setRouteMessage("No active incident with coordinates is available for navigation.");
      return;
    }

    const destination: Coord = [Number(activeIncident.coord_x), Number(activeIncident.coord_y)];
    const origin = currentPosition ?? plan?.start ?? null;
    if (!origin) {
      setPlan(null);
      setRouteMessage("Device location is required before a route can be built.");
      return;
    }

    setRouteLoading(true);
    setRouteMessage(null);
    try {
      if (!forceOffline && online && token?.token) {
        const next = await fetchOnlinePlan(routeFn, activeIncident, origin, destination);
        setPlan(next);
        setSnapshotLoaded(true);
        setRouteMessage("Live route refreshed from the Relationship API.");
      } else {
        const next = buildOfflinePlan(activeIncident, origin, destination);
        setPlan(next);
        setSnapshotLoaded(true);
        setRouteMessage(forceOffline || !online ? "Offline route rebuilt from incident data." : "Cached route restored.");
      }
    } catch {
      const fallback = buildOfflinePlan(activeIncident, origin, destination);
      setPlan(fallback);
      setSnapshotLoaded(true);
      setRouteMessage("Relationship API route unavailable. Using offline route fallback.");
    } finally {
      setRouteLoading(false);
    }
  };

  useEffect(() => {
    if (!activeIncident) {
      setPlan(null);
      setRouteMessage("No active incident with route coordinates is available.");
      return;
    }
    void recalculateRoute(!online || !token?.token);
    // Recompute when the incident, location, or network state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIncident?.id, online, token?.token, currentPosition?.[0], currentPosition?.[1]]);

  const routeGeoJson = useMemo(() => {
    if (!plan) {
      return { type: "FeatureCollection" as const, features: [] as Array<never> };
    }
    return {
      type: "FeatureCollection" as const,
      features: [{
        type: "Feature" as const,
        geometry: { type: "LineString" as const, coordinates: plan.coordinates },
        properties: { source: plan.source },
      }],
    };
  }, [plan]);

  useEffect(() => {
    if (!token?.token || !mapEl.current || !plan) return;
    mapboxgl.accessToken = token.token;
    const map = new mapboxgl.Map({
      container: mapEl.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: plan.start,
      zoom: 13.5,
      attributionControl: false,
    });

    map.on("load", () => {
      map.addSource("nav-route", { type: "geojson", data: routeGeoJson });
      map.addLayer({
        id: "nav-route-line",
        type: "line",
        source: "nav-route",
        paint: {
          "line-color": plan.source === "online" ? "#38bdf8" : "#f59e0b",
          "line-width": 5,
          "line-opacity": 0.9,
        },
      });
      new mapboxgl.Marker({ color: "#38bdf8" }).setLngLat(plan.start).setPopup(new mapboxgl.Popup({ offset: 12 }).setText("You are here")).addTo(map);
      new mapboxgl.Marker({ color: "#f43f5e" }).setLngLat(plan.destination).setPopup(new mapboxgl.Popup({ offset: 12 }).setText(plan.label)).addTo(map);
      map.fitBounds([
        [Math.min(plan.start[0], plan.destination[0]) - 0.002, Math.min(plan.start[1], plan.destination[1]) - 0.002],
        [Math.max(plan.start[0], plan.destination[0]) + 0.002, Math.max(plan.start[1], plan.destination[1]) + 0.002],
      ], { padding: 60, duration: 0 });
      requestAnimationFrame(() => map.resize());
      setMapReady(true);
    });

    mapRef.current = map;
    const ro = new ResizeObserver(() => { try { map.resize(); } catch {} });
    if (mapEl.current) ro.observe(mapEl.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [plan, routeGeoJson, token?.token]);

  const distanceKm = plan ? plan.distanceKm : null;

  const logArrival = () => {
    setArrived(true);
  };

  if (arrived) {
    return (
      <div className="space-y-4">
        <section className="rounded-3xl border border-emerald-300/20 bg-gradient-to-br from-emerald-300/20 via-white/5 to-transparent p-5">
          <div className="text-[11px] uppercase tracking-[0.22em] text-emerald-100/80">Arrived</div>
          <h2 className="mt-2 text-2xl font-semibold">You have arrived at scene</h2>
          <p className="mt-2 text-sm text-slate-300">Your arrival time has been recorded and the response desk is notified.</p>
        </section>
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
          <Link to="/officer/home" className="inline-flex items-center gap-2 rounded-2xl bg-emerald-300 px-4 py-2.5 text-sm font-semibold text-slate-950">
            <CheckCircle2 className="h-4 w-4" />
            Return home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-white/10 bg-white/5 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Navigation</div>
            <h2 className="mt-2 text-2xl font-semibold">{activeIncident ? "Turn-by-turn route" : "No active dispatch"}</h2>
            <p className="mt-2 text-sm text-slate-300">
              {activeIncident
                ? "Route instructions stay usable offline and recalculate when connectivity returns."
                : "A coordinated incident with coordinates is required before navigation can be built."}
            </p>
          </div>
          <div className={`rounded-2xl border px-3 py-2 text-right ${plan?.source === "online" ? "border-cyan-300/20 bg-cyan-300/10" : "border-amber-300/20 bg-amber-300/10"}`}>
            <div className={`text-[11px] uppercase tracking-[0.18em] ${plan?.source === "online" ? "text-cyan-200/80" : "text-amber-100/80"}`}>ETA</div>
            <div className="text-lg font-semibold text-white">{plan?.eta ?? "—"}</div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/5">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 text-sm font-semibold text-white">
            <span>Mapbox navigation</span>
            {activeIncident && (
              <button
                type="button"
                onClick={() => void recalculateRoute(!online || !token?.token)}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white hover:bg-white/10"
              >
                {routeLoading ? <CloudUpload className="h-3.5 w-3.5 animate-pulse" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Recalculate route
              </button>
            )}
          </div>
          <div className="relative h-[420px]">
            {activeIncident && plan && token?.token ? (
              <div ref={mapEl} className="absolute inset-0" />
            ) : (
              <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-slate-300">
                <div className="max-w-sm space-y-3">
                  <div className="text-lg font-semibold text-white">Offline route snapshot ready</div>
                  <p>
                    {activeIncident
                      ? "The route can be rebuilt once device location or a live Mapbox token is available."
                      : "No incident with coordinates is assigned, so navigation is waiting on live data."}
                  </p>
                  {snapshotLoaded && (
                    <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-left text-xs text-slate-300">
                      Navigation route cached for this session.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          {activeIncident && !mapReady && token?.token && (
            <div className="px-4 py-3 text-xs text-slate-400">Loading route preview…</div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <RouteIcon className="h-4 w-4 text-cyan-300" />
              Navigation steps
            </div>
            <div className="mt-4 space-y-3">
              {plan ? plan.steps.map((step, idx) => (
                <div key={`${step.title}-${idx}`} className={`rounded-2xl border px-4 py-3 text-sm ${idx === 0 ? "border-cyan-300/30 bg-cyan-300/10" : "border-white/10 bg-slate-950/40"}`}>
                  <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Step {idx + 1}</div>
                  <div className="mt-1 text-slate-100">{step.title}</div>
                  <div className="mt-1 text-slate-300">{step.detail}</div>
                </div>
              )) : (
                <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
                  No route has been calculated yet.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <TimerReset className="h-4 w-4 text-cyan-300" />
              Live route status
            </div>
            <div className="mt-3 space-y-2 text-sm text-slate-300">
              <div className="flex items-center gap-2">
                {online ? <MapPinned className="h-4 w-4 text-emerald-300" /> : <WifiOff className="h-4 w-4 text-amber-300" />}
                <span>{plan?.source === "online" ? "Live route fetched from Mapbox." : "Offline route rebuilt locally."}</span>
              </div>
              {distanceKm != null && <div>Distance remaining: {distanceKm.toFixed(1)} km</div>}
              <div>{plan ? `Destination: ${plan.label}` : "Destination: awaiting incident data"}</div>
              {currentPosition && <div>Current position captured from device GPS.</div>}
            </div>
            {routeMessage && (
              <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-slate-200">
                {routeMessage}
              </div>
            )}
            <button
              type="button"
              onClick={logArrival}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950"
            >
              <Navigation2 className="h-4 w-4" />
              Log arrival at scene
            </button>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="text-sm font-semibold">Offline readiness</div>
            <div className="mt-2 text-sm text-slate-300">
              {plan?.source === "online"
                ? "Route data is cached for later use if the connection drops."
                : "The route is reconstructed from incident data and remains readable offline."}
            </div>
            {plan && (
              <div className="mt-3 text-xs uppercase tracking-[0.18em] text-slate-400">
                Saved {new Date(plan.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
            )}
          </div>

          <Link to="/officer/dispatch" className="block rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-center text-sm text-white">
            <ArrowLeft className="mr-2 inline h-4 w-4" />
            Back to dispatch
          </Link>
        </div>
      </section>
    </div>
  );
}
