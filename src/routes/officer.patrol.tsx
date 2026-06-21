import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { getMapboxToken } from "@/lib/config.functions";
import { checkInWaypoint, getPatrol, listCheckIns, listPatrols, listShifts, recordCheckIn, updateShift } from "@/lib/patrols.functions";
import { listIncidents } from "@/lib/incidents.functions";
import {
  ArrowRight,
  CheckCircle2,
  MapPinned,
  Mic,
  ShieldAlert,
  TimerReset,
  Volume2,
  WifiOff,
  CloudUpload,
  AlertTriangle,
} from "lucide-react";

type Coord = [number, number];
type PatrolWaypoint = {
  id?: string;
  ord: number;
  name: string;
  coord_x: number | null;
  coord_y: number | null;
  expected_minutes: number;
};

type QueuedPatrolAction =
  | { kind: "checkin"; payload: { shift_id: string; waypoint_id: string; method: "gps"; coord_x?: number; coord_y?: number } }
  | { kind: "handover"; payload: { id: string; handover_notes: string; end: boolean } };

const QUEUE_KEY = "lemtik.officer.patrol-queue.v1";
const DEFAULT_CENTER: Coord = [3.3792, 6.5244];

function readQueue(): Array<{ id: string; queuedAt: number; action: QueuedPatrolAction }> {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeQueue(items: Array<{ id: string; queuedAt: number; action: QueuedPatrolAction }>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

function enqueue(action: QueuedPatrolAction) {
  const item = { id: crypto.randomUUID(), queuedAt: Date.now(), action };
  const items = readQueue();
  items.push(item);
  writeQueue(items);
  return item;
}

function removeQueued(id: string) {
  writeQueue(readQueue().filter((item) => item.id !== id));
}

function metersBetween(a: Coord, b: Coord) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const R = 6_371_000;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function estimateEta(distanceMeters: number) {
  const minutes = Math.max(1, Math.round(distanceMeters / 60));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

function ensureWaypointCoords(waypoints: PatrolWaypoint[], anchor: Coord): Array<PatrolWaypoint & { coord: Coord }> {
  const base = waypoints.find((wp) => wp.coord_x != null && wp.coord_y != null)?.coord_x != null
    ? [Number(waypoints.find((wp) => wp.coord_x != null && wp.coord_y != null)?.coord_x), Number(waypoints.find((wp) => wp.coord_x != null && wp.coord_y != null)?.coord_y)] as Coord
    : anchor;
  return waypoints.map((wp, idx) => {
    if (wp.coord_x != null && wp.coord_y != null) return { ...wp, coord: [Number(wp.coord_x), Number(wp.coord_y)] };
    const offset = 0.0018 + idx * 0.00035;
    return {
      ...wp,
      coord: [base[0] + Math.cos(idx * 1.1) * offset, base[1] + Math.sin(idx * 1.1) * offset],
    };
  });
}

export const Route = createFileRoute("/officer/patrol")({
  component: OfficerPatrol,
});

function OfficerPatrol() {
  const qc = useQueryClient();
  const patrolListFn = useServerFn(listPatrols);
  const patrolDetailFn = useServerFn(getPatrol);
  const shiftsFn = useServerFn(listShifts);
  const checkInsFn = useServerFn(listCheckIns);
  const incidentsFn = useServerFn(listIncidents);
  const mapboxTokenFn = useServerFn(getMapboxToken);
  const recordCheckInFn = useServerFn(recordCheckIn);
  const checkInWaypointFn = useServerFn(checkInWaypoint);
  const updateShiftFn = useServerFn(updateShift);

  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const waypointMarkers = useRef<mapboxgl.Marker[]>([]);
  const incidentMarkers = useRef<mapboxgl.Marker[]>([]);
  const currentMarker = useRef<mapboxgl.Marker | null>(null);

  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [currentPosition, setCurrentPosition] = useState<Coord | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [handoverNotes, setHandoverNotes] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [confirmOverride, setConfirmOverride] = useState<{ shiftId: string; waypointId: string; coords: Coord } | null>(null);
  const [queuedCount, setQueuedCount] = useState(readQueue().length);

  const { data: patrolRows = [] } = useQuery({ queryKey: ["officer-patrols"], queryFn: () => patrolListFn() });
  const activePatrol = useMemo(
    () => (patrolRows as any[]).find((patrol) => patrol.status === "on_route" || patrol.status === "delayed") ?? (patrolRows as any[])[0] ?? null,
    [patrolRows],
  );

  const { data: patrolDetail } = useQuery({
    queryKey: ["officer-patrol-detail", activePatrol?.id],
    queryFn: () => patrolDetailFn({ data: { id: activePatrol.id } }) as Promise<any>,
    enabled: !!activePatrol?.id,
  });

  const { data: shifts = [] } = useQuery({
    queryKey: ["officer-patrol-shifts", activePatrol?.id],
    queryFn: () => shiftsFn({ data: { patrol_id: activePatrol.id } }),
    enabled: !!activePatrol?.id,
  });

  const { data: checkIns = [] } = useQuery({
    queryKey: ["officer-patrol-checkins", activePatrol?.id],
    queryFn: () => checkInsFn({ data: { patrol_id: activePatrol.id } }),
    enabled: !!activePatrol?.id,
  });

  const { data: incidents = [] } = useQuery({
    queryKey: ["officer-patrol-incidents"],
    queryFn: () => incidentsFn(),
  });

  const { data: tokenData } = useQuery({
    queryKey: ["officer-mapbox-token"],
    queryFn: () => mapboxTokenFn(),
    staleTime: Infinity,
  });

  const activeShift = (shifts as any[]).find((shift) => shift.status === "active") ?? (shifts as any[])[0] ?? null;
  const rawWaypoints: PatrolWaypoint[] = (patrolDetail?.waypoints ?? []).map((wp: any, index: number) => ({
    id: wp.id,
    ord: wp.ord ?? index,
    name: wp.name ?? `Waypoint ${index + 1}`,
    coord_x: wp.coord_x ?? null,
    coord_y: wp.coord_y ?? null,
    expected_minutes: wp.expected_minutes ?? 10,
  }));
  const waypoints = useMemo(
    () => ensureWaypointCoords(rawWaypoints.length ? rawWaypoints : Array.from({ length: Number(activePatrol?.waypoints ?? 0) || 4 }).map((_, index) => ({
      ord: index,
      name: `Waypoint ${index + 1}`,
      coord_x: null,
      coord_y: null,
      expected_minutes: 10,
    })), currentPosition ?? DEFAULT_CENTER),
    [rawWaypoints, activePatrol?.waypoints, currentPosition],
  );

  const completedCount = Math.max(
    Number(activePatrol?.checked_in ?? 0),
    (checkIns as any[]).length,
  );
  const currentIndex = Math.min(Math.max(completedCount, 0), Math.max(waypoints.length - 1, 0));
  const currentWaypoint = waypoints[currentIndex] ?? null;
  const distanceToWaypoint = currentWaypoint && currentPosition ? metersBetween(currentPosition, currentWaypoint.coord) : null;
  const nearbyIncidents = useMemo(() => {
    if (!currentPosition) return [];
    return (incidents as any[])
      .filter((incident) => incident.coord_x != null && incident.coord_y != null)
      .map((incident) => ({
        ...incident,
        distance: metersBetween(currentPosition, [Number(incident.coord_x), Number(incident.coord_y)]),
      }))
      .filter((incident) => incident.distance <= 500)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 4);
  }, [currentPosition, incidents]);

  const refreshQueue = () => setQueuedCount(readQueue().length);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) => setCurrentPosition([position.coords.longitude, position.coords.latitude]),
      () => undefined,
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }, []);

  useEffect(() => {
    const goOnline = async () => {
      setOnline(true);
      await flushQueue();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    window.addEventListener("storage", refreshQueue);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("storage", refreshQueue);
    };
  }, [activeShift, currentWaypoint]);

  useEffect(() => {
    if (!tokenData?.token || !mapEl.current) return;
    mapboxgl.accessToken = tokenData.token;
    const map = new mapboxgl.Map({
      container: mapEl.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: currentPosition ?? waypoints[0]?.coord ?? DEFAULT_CENTER,
      zoom: 15,
      pitch: 18,
      bearing: -14,
    });
    mapRef.current = map;
    map.on("load", () => setMapReady(true));
    return () => {
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [currentPosition, tokenData?.token, waypoints]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const renderRouteLayer = () => {
      if (!mapRef.current || mapRef.current !== map) return;
      if (!map.isStyleLoaded()) {
        map.once("style.load", renderRouteLayer);
        return;
      }

      waypointMarkers.current.forEach((marker) => marker.remove());
      waypointMarkers.current = [];
      incidentMarkers.current.forEach((marker) => marker.remove());
      incidentMarkers.current = [];
      currentMarker.current?.remove();
      currentMarker.current = null;

      const routeCoords = waypoints.map((wp) => wp.coord);
      const sourceData = {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: routeCoords,
        },
        properties: {},
      } as any;
      const existingRoute = map.getSource("patrol-route") as mapboxgl.GeoJSONSource | undefined;
      if (existingRoute) {
        existingRoute.setData(sourceData);
      } else {
        map.addSource("patrol-route", { type: "geojson", data: sourceData });
        map.addLayer({
          id: "patrol-route-line",
          type: "line",
          source: "patrol-route",
          paint: { "line-color": "#38bdf8", "line-width": 4, "line-opacity": 0.9 },
        });
      }

      waypoints.forEach((wp, index) => {
        const el = document.createElement("div");
        const completed = index < completedCount;
        const isCurrent = index === currentIndex;
        el.className = `h-4 w-4 rounded-full border-2 ${completed ? "border-emerald-200 bg-emerald-400" : isCurrent ? "border-white bg-white animate-pulse" : "border-slate-200 bg-slate-900"}`;
        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat(wp.coord)
          .setPopup(new mapboxgl.Popup({ offset: 18 }).setHTML(`<strong>${wp.name}</strong><br/>${completed ? "Completed" : isCurrent ? "Current waypoint" : "Upcoming"}`))
          .addTo(map);
        waypointMarkers.current.push(marker);
      });

      if (currentPosition) {
        const el = document.createElement("div");
        el.className = "h-5 w-5 rounded-full border-2 border-cyan-100 bg-cyan-400 shadow-[0_0_0_12px_rgba(34,211,238,0.14)]";
        currentMarker.current = new mapboxgl.Marker({ element: el }).setLngLat(currentPosition).addTo(map);
      }

      nearbyIncidents.forEach((incident) => {
        const el = document.createElement("div");
        el.className = "h-4 w-4 rotate-45 border border-red-100 bg-red-500 shadow-[0_0_0_8px_rgba(239,68,68,0.12)]";
        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([Number(incident.coord_x), Number(incident.coord_y)])
          .setPopup(new mapboxgl.Popup({ offset: 18 }).setHTML(`<strong>${incident.code}</strong><br/>${incident.location}`))
          .addTo(map);
        incidentMarkers.current.push(marker);
      });

      const bounds = new mapboxgl.LngLatBounds();
      routeCoords.forEach((coord) => bounds.extend(coord));
      if (currentPosition) bounds.extend(currentPosition);
      nearbyIncidents.forEach((incident) => bounds.extend([Number(incident.coord_x), Number(incident.coord_y)]));
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 70, duration: 500, maxZoom: 17 });
    };

    renderRouteLayer();
    return () => {
      map.off("style.load", renderRouteLayer);
    };
  }, [mapReady, waypoints, currentPosition, nearbyIncidents, completedCount, currentIndex]);

  const submitCheckIn = async (override = false) => {
    if (!activeShift || !currentWaypoint) return;
    const coords = currentPosition ?? currentWaypoint.coord;
    const distance = currentPosition ? metersBetween(currentPosition, currentWaypoint.coord) : null;
    if (!override && distance != null && distance > 50) {
      setConfirmOverride({ shiftId: activeShift.id, waypointId: currentWaypoint.id ?? "", coords });
      setStatusMessage(
        `You appear to be ${Math.round(distance)}m from ${currentWaypoint.name}. Confirm manual override if you are at the waypoint.`,
      );
      return;
    }

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      enqueue({
        kind: "checkin",
        payload: {
          shift_id: activeShift.id,
          waypoint_id: currentWaypoint.id ?? "",
          method: "gps",
          coord_x: coords[0],
          coord_y: coords[1],
        },
      });
      setStatusMessage(`Check-in queued offline for ${currentWaypoint.name}.`);
      refreshQueue();
      return;
    }

    if (currentWaypoint.id) {
      await recordCheckInFn({
        data: {
          shift_id: activeShift.id,
          waypoint_id: currentWaypoint.id,
          method: "gps",
          coord_x: coords[0],
          coord_y: coords[1],
        },
      });
    } else {
      await checkInWaypointFn({ data: { id: activePatrol.id } });
    }
    setStatusMessage(`✓ Check-in logged at ${currentWaypoint.name}`);
    await qc.invalidateQueries({ queryKey: ["officer-patrols"] });
    await qc.invalidateQueries({ queryKey: ["officer-patrol-detail", activePatrol?.id] });
    await qc.invalidateQueries({ queryKey: ["officer-patrol-checkins", activePatrol?.id] });
  };

  const submitHandover = async () => {
    if (!activeShift) return;
    const payload = { id: activeShift.id, handover_notes: handoverNotes.trim(), end: true };
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      enqueue({ kind: "handover", payload });
      setStatusMessage("Handover queued offline and will sync when connection returns.");
      refreshQueue();
      return;
    }
    await updateShiftFn({ data: payload });
    setStatusMessage("Shift handover submitted.");
    await qc.invalidateQueries({ queryKey: ["officer-patrol-shifts", activePatrol?.id] });
  };

  const flushQueue = async () => {
    const items = readQueue();
    if (!items.length) return;
    for (const item of items) {
      try {
        if (item.action.kind === "checkin") {
          if (item.action.payload.waypoint_id) {
            await recordCheckInFn({ data: item.action.payload });
          } else if (activePatrol?.id) {
            await checkInWaypointFn({ data: { id: activePatrol.id } });
          }
        } else {
          await updateShiftFn({ data: item.action.payload });
        }
        removeQueued(item.id);
      } catch {
        break;
      }
    }
    refreshQueue();
    await qc.invalidateQueries();
  };

  useEffect(() => {
    if (online) {
      void flushQueue();
    }
  }, [online]);

  const submitVoiceNote = () => {
    if (!currentWaypoint || !activeShift) return;
    const note = window.prompt(`Voice note for ${currentWaypoint.name}`, "");
    if (!note?.trim()) return;
    const key = `lemtik.officer.voice-notes.${activeShift.id}`;
    const existing = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
    const notes = existing ? JSON.parse(existing) as Array<{ waypoint: string; note: string; createdAt: string }> : [];
    notes.unshift({
      waypoint: currentWaypoint.name,
      note: note.trim(),
      createdAt: new Date().toISOString(),
    });
    if (typeof window !== "undefined") window.localStorage.setItem(key, JSON.stringify(notes.slice(0, 12)));
    setStatusMessage(`Voice note saved locally for ${currentWaypoint.name}.`);
  };

  const connectionTone = online ? "bg-emerald-400" : "bg-amber-400";

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-white/10 bg-white/5 p-5">
        <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Patrol</div>
        <h2 className="mt-2 text-2xl font-semibold">Active patrol view</h2>
        <p className="mt-2 text-sm text-slate-300">
          Full-screen route map, GPS check-ins, offline queueing, and shift handover notes.
        </p>
      </section>

      <div className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm ${online ? "border-cyan-300/20 bg-cyan-300/10 text-cyan-100" : "border-amber-300/20 bg-amber-300/10 text-amber-100"}`}>
        <div className="flex items-center gap-2">
          {online ? <CloudUpload className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
          <span>{online ? `${queuedCount} patrol action${queuedCount === 1 ? "" : "s"} pending sync.` : "Offline. Patrol actions will queue locally."}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${connectionTone}`} />
          {online ? "Connected" : "Offline"}
        </div>
      </div>

      {activePatrol ? (
        <div className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
          <section className="space-y-4">
            <div className="relative min-h-[70vh] overflow-hidden rounded-3xl border border-white/10 bg-slate-950">
              <div ref={mapEl} className="absolute inset-0" />
              {!tokenData?.token && (
                <div className="absolute inset-0 grid place-items-center bg-slate-950/90 p-6 text-center">
                  <div className="max-w-md">
                    <MapPinned className="mx-auto h-10 w-10 text-cyan-300" />
                    <h3 className="mt-4 text-xl font-semibold text-white">Mapbox token not configured</h3>
                    <p className="mt-2 text-sm text-slate-300">
                      The patrol screen still works, but the live map needs a public Mapbox token to render tiles.
                    </p>
                  </div>
                </div>
              )}

              <div className="absolute left-4 right-4 bottom-4 rounded-3xl border border-white/10 bg-slate-950/90 p-4 shadow-[0_16px_60px_rgba(2,6,23,0.55)] backdrop-blur">
                <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Current waypoint</div>
                    <div className="mt-2 text-lg font-semibold text-white">{currentWaypoint?.name ?? "Waypoint unavailable"}</div>
                    <div className="mt-1 text-sm text-slate-300">
                      {distanceToWaypoint != null ? `${Math.round(distanceToWaypoint)}m away` : "GPS distance pending"} · {currentWaypoint ? estimateEta(distanceToWaypoint ?? 0) : "ETA unavailable"}
                    </div>
                    {statusMessage && <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200">{statusMessage}</div>}
                  </div>

                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => void submitCheckIn(false)}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {currentWaypoint ? `Check in at ${currentWaypoint.name}` : "Check in"}
                    </button>
                    <div className="grid grid-cols-2 gap-2">
                      <Link to="/officer/incident/new" className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-medium text-white">
                        <ShieldAlert className="h-4 w-4" />
                        Report
                      </Link>
                      <button
                        type="button"
                        onClick={submitVoiceNote}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-medium text-white"
                      >
                        <Mic className="h-4 w-4" />
                        Voice note
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {confirmOverride && (
              <div className="rounded-3xl border border-amber-300/20 bg-amber-300/10 p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-100">
                  <AlertTriangle className="h-4 w-4" />
                  GPS mismatch
                </div>
                <p className="mt-2 text-sm text-amber-50/90">
                  You appear to be away from the waypoint. Confirm manual override only if you are physically at the checkpoint.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmOverride(null);
                      void submitCheckIn(true);
                    }}
                    className="rounded-2xl bg-amber-300 px-4 py-2.5 text-sm font-semibold text-slate-950"
                  >
                    Yes, I&apos;m here
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmOverride(null)}
                    className="rounded-2xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-white"
                  >
                    No, not yet
                  </button>
                </div>
              </div>
            )}
          </section>

          <aside className="space-y-4">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Shift</div>
                  <h3 className="mt-2 text-xl font-semibold text-white">{activePatrol.name}</h3>
                </div>
                <TimerReset className="h-5 w-5 text-cyan-300" />
              </div>
              <div className="mt-3 text-sm text-slate-300">{activePatrol.officer} · {activePatrol.shift}</div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                <MiniStat label="Check-ins" value={`${completedCount}/${waypoints.length}`} />
                <MiniStat label="Next waypoint" value={currentWaypoint?.name ?? "—"} />
                <MiniStat label="Active shift" value={activeShift?.status ?? activePatrol.status} />
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Waypoint list</div>
              <div className="mt-3 space-y-2">
                {waypoints.map((waypoint, index) => {
                  const done = index < completedCount;
                  const active = index === currentIndex;
                  return (
                    <div
                      key={`${waypoint.id ?? waypoint.name}-${index}`}
                      className={`rounded-2xl border px-3 py-2 text-sm ${done ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-50" : active ? "border-white/20 bg-white/10 text-white" : "border-white/10 bg-slate-950/40 text-slate-300"}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span>{waypoint.name}</span>
                        <span className="text-[11px] uppercase tracking-[0.18em]">
                          {done ? "Checked in" : active ? "Current" : "Pending"}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-400">
                        {waypoint.expected_minutes} min expected dwell
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Nearby incidents</div>
              <div className="mt-3 space-y-2">
                {nearbyIncidents.length > 0 ? nearbyIncidents.map((incident: any) => (
                  <div key={incident.id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
                    <div className="text-sm font-medium text-white">{incident.code}</div>
                    <div className="mt-1 text-xs text-slate-300">{incident.location} · {Math.round(incident.distance)}m away</div>
                  </div>
                )) : (
                  <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3 text-sm text-slate-300">
                    No incident pins within 500m.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Shift handover</div>
              <textarea
                value={handoverNotes}
                onChange={(e) => setHandoverNotes(e.target.value)}
                placeholder="Handover notes for the next officer..."
                className="mt-3 min-h-28 w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void submitHandover()}
                  className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-950"
                >
                  <ArrowRight className="h-4 w-4" />
                  End shift + submit
                </button>
                <div className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-slate-300">
                  <Volume2 className="h-4 w-4" />
                  Voice note saved locally
                </div>
              </div>
            </div>
          </aside>
        </div>
      ) : (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5 text-sm text-slate-300">
          No active patrol was found.
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-1 text-sm font-medium text-white">{value}</div>
    </div>
  );
}
