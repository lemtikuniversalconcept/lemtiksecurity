import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { toast } from "sonner";
import { Anchor, BellRing, Car, Check, Copy, Loader2, Plus, RefreshCw, Save, Ship, ShieldCheck, Trash2, User, X } from "lucide-react";
import { requireSectionAccess } from "@/lib/rbac";
import { useRealtimeInvalidate } from "@/lib/useRealtime";
import { basemapOptions, BasemapSwitch, useBasemap } from "@/lib/basemap";
import { LocationPicker, useMapboxToken } from "@/components/LocationPicker";
import { Empty, Kpi, Notice, PageHeader, Panel, Status, Switch, Tabs, timeAgo, useNow, type Tone } from "@/components/nw";
import {
  acknowledgeMovementAlert,
  deleteMovementGeofence,
  deleteMovementSubject,
  getMovementTrail,
  listMovementAlerts,
  listMovementGeofences,
  listMovementSubjects,
  newTrackerLink,
  saveMovementGeofence,
  saveMovementSubject,
  setMovementConsent,
  setMovementTracking,
  type MovementAlert,
  type MovementGeofence,
  type MovementSubject,
} from "@/lib/movement.functions";
import { getNearbyShips, listVoyages, type NearbyShip, type Voyage } from "@/lib/voyages.functions";
import { VoyagesView } from "@/components/movement/Voyages";
import { CorridorsView, HandoffPanel, RespondersView } from "@/components/movement/Corridors";
import { reviewPossibleHijack } from "@/lib/hijack.functions";
import { DeliveryLog } from "@/components/alerts/Escalation";
import { listCorridors, listResponders } from "@/lib/corridor.functions";
import { createSarCase, listSarCases, type SarCase } from "@/lib/sar.functions";
import { MovementPermsContext, movementPerms, useMovementPerms } from "@/components/movement/perms";

export const Route = createFileRoute("/app/movement")({
  head: () => ({ meta: [{ title: "Protected movement · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    requireSectionAccess(context.appAccess, ["security_manager", "operator", "client_admin"]);
    return { appAccess: context.appAccess };
  },
  component: Movement,
});

type Tab = "live" | "subjects" | "voyages" | "corridors" | "responders" | "sar" | "zones" | "alerts";
type LngLat = [number, number];
const LAGOS: LngLat = [3.4219, 6.4281];

type ShownState = MovementSubject["state"] | "waiting";
const STATE: Record<ShownState, { tone: Tone; label: string; color: string }> = {
  sos: { tone: "fail", label: "SOS", color: "#F2384B" },
  silent: { tone: "warn", label: "Silent", color: "#F5A524" },
  moving: { tone: "ok", label: "Moving", color: "#2BD576" },
  stopped: { tone: "blue", label: "Stopped", color: "#7A9BFF" },
  waiting: { tone: "neutral", label: "Waiting for position", color: "#8A93A6" },
  idle: { tone: "neutral", label: "Not tracking", color: "#8A93A6" },
};
const ZONE_COLOR: Record<MovementGeofence["kind"], string> = { safe: "#2BD576", restricted: "#F5A524", exclusion: "#F2384B" };
const CATEGORY_LABEL: Record<string, string> = {
  student: "Student",
  principal: "Principal",
  staff: "Staff",
  vehicle: "Vehicle",
  patrol_boat: "Patrol boat",
  crew_boat: "Crew boat",
  escort_vessel: "Escort vessel",
  supply_vessel: "Supply vessel",
  other: "Other",
};
const CATEGORIES_FOR: Record<MovementSubject["kind"], string[]> = {
  person: ["student", "principal", "staff", "other"],
  vehicle: ["vehicle", "other"],
  vessel: ["patrol_boat", "crew_boat", "escort_vessel", "supply_vessel", "other"],
};

function KindIcon({ kind, size = 14 }: { kind: MovementSubject["kind"]; size?: number }) {
  if (kind === "vessel") return <Anchor size={size} strokeWidth={1.75} />;
  if (kind === "vehicle") return <Car size={size} strokeWidth={1.75} />;
  return <User size={size} strokeWidth={1.75} />;
}

function stateOf(s: MovementSubject): ShownState {
  if (!s.tracking_enabled) return "idle";
  return s.state === "idle" ? "waiting" : s.state;
}

function circle(lat: number, lng: number, radius: number, steps = 64): LngLat[] {
  const out: LngLat[] = [];
  const dLat = radius / 110_540;
  const dLng = radius / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    out.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return out;
}

function Movement() {
  const { appAccess } = Route.useRouteContext();
  const perms = movementPerms(appAccess?.specRole);
  const [tab, setTab] = useState<Tab>("live");
  const listSubjects = useServerFn(listMovementSubjects);
  const listZones = useServerFn(listMovementGeofences);
  const listAlerts = useServerFn(listMovementAlerts);
  const listVoyagesFn = useServerFn(listVoyages);

  const subjectsQ = useQuery({ queryKey: ["movement-subjects"], queryFn: () => listSubjects(), refetchInterval: 60_000 });
  const zonesQ = useQuery({ queryKey: ["movement-zones"], queryFn: () => listZones() });
  const alertsQ = useQuery({ queryKey: ["movement-alerts"], queryFn: () => listAlerts(), refetchInterval: 60_000 });
  useRealtimeInvalidate("movement_subjects", [["movement-subjects"]]);
  useRealtimeInvalidate("movement_alerts", [["movement-alerts"]]);
  const voyagesQ = useQuery({ queryKey: ["movement-voyages"], queryFn: () => listVoyagesFn(), refetchInterval: 60_000 });
  useRealtimeInvalidate("movement_voyages", [["movement-voyages"]]);
  const voyages = voyagesQ.data ?? [];
  const listCorridorsFn = useServerFn(listCorridors);
  const listRespondersFn = useServerFn(listResponders);
  const corridorsQ = useQuery({ queryKey: ["movement-corridors"], queryFn: () => listCorridorsFn() });
  const respondersQ = useQuery({ queryKey: ["movement-responders"], queryFn: () => listRespondersFn() });
  const corridors = corridorsQ.data ?? [];
  const responders = respondersQ.data ?? [];
  const listSarFn = useServerFn(listSarCases);
  const sarQ = useQuery({ queryKey: ["sar-cases"], queryFn: () => listSarFn() });
  const sarCases = sarQ.data ?? [];
  const activeSar = sarCases.filter((c) => c.status === "active").length;
  const underway = voyages.filter((v) => v.status === "underway");

  const subjects = subjectsQ.data ?? [];
  const zones = zonesQ.data ?? [];
  const alerts = alertsQ.data ?? [];
  const openAlerts = alerts.filter((a) => !a.acknowledged_at);
  const tracked = subjects.filter((s) => s.tracking_enabled);

  if (subjectsQ.error) return <Notice tone="fail">{(subjectsQ.error as Error).message || "Couldn't load protected movement."}</Notice>;

  return (
    <MovementPermsContext.Provider value={perms}>
    <div className="col g16">
      <PageHeader title="Protected movement" sub="Students, principals, vehicles and boats on the move — tracked only with recorded consent." />
      {!perms.canOperate && <Notice tone="blue">You can view everything here. Changes are made by your security manager and operators.</Notice>}
      <div className="kpis">
        <Kpi label="Tracking now" value={subjectsQ.isLoading ? "—" : tracked.length} unit={`of ${subjects.length}`} />
        <Kpi label="SOS" value={subjects.filter((s) => stateOf(s) === "sos").length} deltaClass="fail" />
        <Kpi label="Silent trackers" value={subjects.filter((s) => stateOf(s) === "silent").length} title="Tracking is on but nothing has been received within the subject's silent window" />
        <Kpi label="Voyages underway" value={underway.length} />
        <Kpi label="Open alerts" value={openAlerts.length} />
        <Kpi label="Zones" value={zones.filter((z) => z.active).length} />
      </div>
      <Tabs
        label="Protected movement views"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "live", label: "Live" },
          { value: "subjects", label: "People & assets", count: subjects.length },
          { value: "voyages", label: "Voyages", count: underway.length || undefined },
          { value: "corridors", label: "Corridors", count: corridors.length || undefined },
          { value: "responders", label: "Responders", count: responders.length || undefined },
          { value: "sar", label: "Search & rescue", count: activeSar || undefined },
          { value: "zones", label: "Zones", count: zones.length },
          { value: "alerts", label: "Alerts", count: openAlerts.length || undefined },
        ]}
      />
      {tab === "live" && <LiveView subjects={subjects} zones={zones} alerts={openAlerts} voyages={underway} />}
      {tab === "voyages" && <VoyagesView voyages={voyages} subjects={subjects} corridors={corridors} />}
      {tab === "corridors" && <CorridorsView corridors={corridors} />}
      {tab === "responders" && <RespondersView responders={responders} />}
      {tab === "sar" && <SarList cases={sarCases} />}
      {tab === "subjects" && <SubjectsView subjects={subjects} loading={subjectsQ.isLoading} />}
      {tab === "zones" && <ZonesView zones={zones} subjects={subjects} />}
      {tab === "alerts" && <AlertsView alerts={alerts} subjects={subjects} />}
    </div>
    </MovementPermsContext.Provider>
  );
}

// ---------------------------------------------------------------- Live

function LiveView({ subjects, zones, alerts, voyages }: { subjects: MovementSubject[]; zones: MovementGeofence[]; alerts: MovementAlert[]; voyages: Voyage[] }) {
  const shipsFn = useServerFn(getNearbyShips);
  const [ships, setShips] = useState<{ list: NearbyShip[]; at: number; note?: string; configured: boolean } | null>(null);
  const [shipsOn, setShipsOn] = useState(false);
  const shipsM = useMutation({
    mutationFn: () => {
      const b = mapRef.current!.getBounds()!;
      return shipsFn({ data: { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() } });
    },
    onSuccess: (r) => setShips({ list: r.ships, at: Date.now(), note: r.note, configured: r.configured }),
    onError: (e) => toast.error((e as Error).message),
  });
  const ownMmsi = new Set(subjects.map((s) => s.mmsi).filter(Boolean) as string[]);
  const { data: tokenData } = useMapboxToken();
  const token = tokenData?.token ?? "";
  const [basemap, setBasemap] = useBasemap();
  const el = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const trailFn = useServerFn(getMovementTrail);
  const now = useNow(30_000);

  const placed = subjects.filter((s) => s.last_lat != null && s.last_lng != null);
  const trail = useQuery({
    queryKey: ["movement-trail", selected],
    queryFn: () => trailFn({ data: { subject_id: selected!, hours: 6 } }),
    enabled: !!selected,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!token || !el.current || mapRef.current) return;
    mapboxgl.accessToken = token;
    const first = placed[0];
    const map = new mapboxgl.Map({ container: el.current, ...basemapOptions(basemap), center: first ? [first.last_lng!, first.last_lat!] : LAGOS, zoom: first ? 13 : 10.5, attributionControl: true });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      map.addSource("mv-zones", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "mv-zones-fill", type: "fill", source: "mv-zones", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.12 } });
      map.addLayer({ id: "mv-zones-line", type: "line", source: "mv-zones", paint: { "line-color": ["get", "color"], "line-width": 1.5, "line-dasharray": [2, 1.5] } });
      map.addSource("mv-voyages", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "mv-voyages-line", type: "line", source: "mv-voyages", paint: { "line-color": ["get", "color"], "line-width": 2.5, "line-dasharray": [3, 2], "line-opacity": 0.9 } });
      map.addSource("mv-ships", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "mv-ships-dot", type: "circle", source: "mv-ships", paint: { "circle-radius": ["case", ["get", "own"], 6, 4], "circle-color": ["case", ["get", "own"], "#2BD576", "#C7D2E5"], "circle-stroke-color": "#0A0C10", "circle-stroke-width": 1.2, "circle-opacity": 0.9 } });
      map.addLayer({ id: "mv-ships-label", type: "symbol", source: "mv-ships", minzoom: 9, layout: { "text-field": ["get", "label"], "text-size": 10, "text-offset": [0, 1.1], "text-anchor": "top", "text-font": ["DIN Pro Regular", "Arial Unicode MS Regular"] }, paint: { "text-color": "#C7D2E5", "text-halo-color": "#0A0C10", "text-halo-width": 1.2 } });
      map.addSource("mv-trail", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "mv-trail-line", type: "line", source: "mv-trail", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#4F8BFF", "line-width": 4, "line-opacity": 0.85 } });
      map.addSource("mv-subjects", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "mv-subjects-halo", type: "circle", source: "mv-subjects", paint: { "circle-radius": 13, "circle-color": ["get", "color"], "circle-opacity": 0.25 } });
      map.addLayer({ id: "mv-subjects-dot", type: "circle", source: "mv-subjects", paint: { "circle-radius": 7, "circle-color": ["get", "color"], "circle-stroke-color": "#0A0C10", "circle-stroke-width": 2 } });
      map.addLayer({ id: "mv-subjects-label", type: "symbol", source: "mv-subjects", layout: { "text-field": ["get", "name"], "text-size": 11, "text-offset": [0, 1.4], "text-anchor": "top", "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"] }, paint: { "text-color": "#fff", "text-halo-color": "#0A0C10", "text-halo-width": 1.4 } });
      map.on("click", "mv-subjects-dot", (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) setSelected(id);
      });
      map.on("mouseenter", "mv-subjects-dot", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "mv-subjects-dot", () => (map.getCanvas().style.cursor = ""));
      setReady(true);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("mv-zones") as mapboxgl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: zones.filter((z) => z.active).map((z) => ({ type: "Feature", properties: { color: ZONE_COLOR[z.kind] }, geometry: { type: "Polygon", coordinates: [circle(z.center_lat, z.center_lng, z.radius_m)] } })),
    } as any);
    (map.getSource("mv-subjects") as mapboxgl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: placed.map((s) => ({ type: "Feature", properties: { id: s.id, name: s.name, color: STATE[stateOf(s)].color }, geometry: { type: "Point", coordinates: [s.last_lng!, s.last_lat!] } })),
    } as any);
    (map.getSource("mv-voyages") as mapboxgl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: voyages.filter((v) => v.route.length > 1).map((v) => ({ type: "Feature", properties: { color: v.off_route ? "#F5A524" : "#4F8BFF" }, geometry: { type: "LineString", coordinates: v.route } })),
    } as any);
  }, [ready, zones, placed, voyages]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const list = shipsOn ? ships?.list ?? [] : [];
    (map.getSource("mv-ships") as mapboxgl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: list.map((sh) => ({
        type: "Feature",
        properties: { own: ownMmsi.has(sh.mmsi), label: `${sh.name ?? sh.mmsi}${sh.speed_kn != null ? ` · ${sh.speed_kn.toFixed(1)} kn` : ""}` },
        geometry: { type: "Point", coordinates: [sh.lng, sh.lat] },
      })),
    } as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, ships, shipsOn]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const line = trail.data?.snapped ?? trail.data?.raw ?? [];
    (map.getSource("mv-trail") as mapboxgl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: line.length > 1 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line } }] : [],
    } as any);
  }, [ready, trail.data]);

  const focus = (s: MovementSubject) => {
    setSelected(s.id);
    if (s.last_lat != null && s.last_lng != null) mapRef.current?.flyTo({ center: [s.last_lng, s.last_lat], zoom: Math.max(mapRef.current.getZoom(), 15), duration: 700 });
  };
  const sel = subjects.find((s) => s.id === selected) ?? null;
  const ordered = [...subjects].sort((a, b) => ["sos", "silent", "moving", "stopped", "waiting", "idle"].indexOf(stateOf(a)) - ["sos", "silent", "moving", "stopped", "waiting", "idle"].indexOf(stateOf(b)));

  return (
    <div className="grid g16" style={{ gridTemplateColumns: "minmax(0,1fr) 340px" }}>
      <div className="map" style={{ height: 560 }}>
        <div ref={el} style={{ position: "absolute", inset: 0 }} />
        {!token && <div className="absolute inset-0 grid place-items-center t3">{tokenData ? "No Mapbox token configured." : <Loader2 className="h-5 w-5 animate-spin" />}</div>}
        {token && <BasemapSwitch value={basemap} onChange={setBasemap} style={{ left: 10, bottom: 10 }} />}
        {token && (
          <div className="glass col g4" style={{ position: "absolute", right: 10, bottom: 34, padding: "6px 8px", fontSize: 12, zIndex: 2, maxWidth: 260 }}>
            <div className="row g6">
              <button
                type="button"
                className={`b b-sm ${shipsOn ? "b-pri" : "b-sec"}`}
                onClick={() => {
                  if (shipsOn) return setShipsOn(false);
                  setShipsOn(true);
                  if (!ships || Date.now() - ships.at > 60_000) shipsM.mutate();
                }}
                disabled={!ready}
              >
                <Ship size={13} /> Ships nearby
              </button>
              {shipsOn && (
                <button type="button" className="ibtn" style={{ width: 26, height: 26 }} aria-label="Refresh ships" onClick={() => shipsM.mutate()} disabled={shipsM.isPending}>
                  {shipsM.isPending ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                </button>
              )}
            </div>
            {shipsOn && (
              <span className="t3">
                {shipsM.isPending
                  ? "Listening to the public AIS feed (about 12 s)…"
                  : !ships
                    ? ""
                    : !ships.configured
                      ? "Not switched on yet: add a free AISStream key as AISSTREAM_API_KEY in Vercel."
                      : ships.note
                        ? ships.note
                        : ships.list.length === 0
                          ? "No ships reported here right now. The free public AIS feed has little or no receiver coverage in this area. A Lemtik AIS receiver at a jetty can cover 20–40 nm around it."
                          : `${ships.list.length} ship${ships.list.length === 1 ? "" : "s"} heard in this view · ${new Date(ships.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}. Public AIS: coverage can be patchy, and small boats often don't transmit.`}
              </span>
            )}
          </div>
        )}
        {sel && (
          <div className="glass col g4" style={{ position: "absolute", left: 10, top: 10, padding: "8px 12px", maxWidth: 320, fontSize: 12.5, zIndex: 2 }}>
            <div className="row g8">
              <KindIcon kind={sel.kind} />
              <b className="f1">{sel.name}</b>
              <button type="button" className="ibtn" style={{ width: 22, height: 22 }} aria-label="Clear selection" onClick={() => setSelected(null)}>
                <X size={12} />
              </button>
            </div>
            <span className="t3">
              {trail.isLoading
                ? "Loading the last 6 hours…"
                : trail.data?.points
                  ? `Last 6 hours · ${trail.data.points} positions · ${trail.data.snapped ? "snapped to roads" : sel.kind === "vessel" ? "sea track" : "raw GPS line"}`
                  : "No positions in the last 6 hours."}
            </span>
          </div>
        )}
      </div>

      <div className="col g12">
        {alerts.length > 0 && (
          <Panel title="Needs attention" icon={<BellRing size={15} className="ic" />} meta={alerts.length}>
            <div className="col g6">
              {alerts.slice(0, 5).map((a) => (
                <AlertRow key={a.id} a={a} subject={subjects.find((s) => s.id === a.subject_id)} onFocus={(s) => focus(s)} compact />
              ))}
            </div>
          </Panel>
        )}
        <Panel title="Tracked" meta={subjects.length}>
          {subjects.length === 0 ? (
            <Empty>Nobody is set up yet. Add people, vehicles or boats under “People & assets”.</Empty>
          ) : (
            <div className="col g4">
              {ordered.map((s) => {
                const st = STATE[stateOf(s)];
                return (
                  <button key={s.id} type="button" className={`row g10 w-full text-left hover:bg-ink-3${selected === s.id ? " bg-ink-3" : ""}`} style={{ padding: "8px 8px", borderRadius: 8 }} onClick={() => focus(s)}>
                    <KindIcon kind={s.kind} />
                    <span className="col f1" style={{ minWidth: 0 }}>
                      <b className="trunc" style={{ fontSize: 13 }}>{s.name}</b>
                      <span className="t3 trunc" style={{ fontSize: 11.5 }}>
                        {CATEGORY_LABEL[s.category] ?? s.category}
                        {s.last_seen_at ? ` · ${timeAgo(s.last_seen_at, now)}` : s.tracking_enabled ? " · no position yet" : ""}
                        {s.last_battery != null ? ` · ${s.last_battery}%` : ""}
                      </span>
                    </span>
                    <Status tone={st.tone}>{st.label}</Status>
                  </button>
                );
              })}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Alerts

function AlertRow({ a, subject, onFocus, compact }: { a: MovementAlert; subject?: MovementSubject; onFocus?: (s: MovementSubject) => void; compact?: boolean }) {
  const ack = useServerFn(acknowledgeMovementAlert);
  const sarFn = useServerFn(createSarCase);
  const navigate = useNavigate();
  const { canOperate } = useMovementPerms();
  const sar = useMutation({
    mutationFn: () => sarFn({ data: { alert_id: a.id } }),
    onSuccess: (r) => navigate({ to: "/app/movement/sar/$id", params: { id: r.id } }),
    onError: (e) => toast.error((e as Error).message),
  });
  const sarable = canOperate && a.lat != null && ["man_overboard", "sos", "unexpected_stop", "silent", "overdue", "checkin_missed", "off_route"].includes(a.kind) && Date.now() - Date.parse(a.created_at) < 48 * 3_600_000;
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => ack({ data: { id: a.id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["movement-alerts"] });
      qc.invalidateQueries({ queryKey: ["movement-subjects"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const reviewFn = useServerFn(reviewPossibleHijack);
  const [hj, setHj] = useState<null | "dismiss" | "handoff">(null);
  const [showLog, setShowLog] = useState(false);
  const [hjNote, setHjNote] = useState("");
  const review = useMutation({
    mutationFn: (decision: "confirmed" | "dismissed") => reviewFn({ data: { alert_id: a.id, decision, note: hjNote.trim() || undefined } }),
    onSuccess: (_r, decision) => {
      qc.invalidateQueries({ queryKey: ["movement-alerts"] });
      if (decision === "confirmed") {
        setHj("handoff");
        toast.success("Confirmed. Choose the responder to hand off to.");
      } else {
        setHj(null);
        toast.success("Dismissed as a false alarm. Your reason is on the record.");
      }
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const hijackOpen = a.kind === "possible_hijack" && !a.acknowledged_at && canOperate;
  const tone: Tone = a.severity >= 5 ? "fail" : a.severity >= 3 ? "warn" : "blue";
  return (
    <div className="col g8">
    <div className="card row g10" style={{ padding: compact ? "8px 10px" : "10px 12px", alignItems: "center" }}>
      <span className={`dot d-${tone === "blue" ? "ok" : tone}${a.kind === "sos" && !a.acknowledged_at ? " pulse-dot" : ""}`} />
      <button type="button" className="col f1 text-left" style={{ minWidth: 0 }} onClick={() => subject && onFocus?.(subject)} disabled={!onFocus}>
        <b className="trunc" style={{ fontSize: 13 }}>{a.message}</b>
        <span className="t3" style={{ fontSize: 11.5 }}>{new Date(a.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
      </button>
      {sarable && (
        <button type="button" className="b b-sm b-gh" style={{ color: "var(--s5)" }} onClick={() => sar.mutate()} disabled={sar.isPending} title="Estimate where they've drifted and plan the search">
          {sar.isPending ? <Loader2 size={13} className="animate-spin" /> : null} Search plan
        </button>
      )}
      {a.severity >= 3 && canOperate && (
        <button type="button" className="b b-sm b-gh" onClick={() => setShowLog((v) => !v)} aria-expanded={showLog} title="Who was told about this alert, how and when">Who was told</button>
      )}
      {hijackOpen ? (
        <span className="row g6">
          <button type="button" className="b b-sm b-pri" onClick={() => review.mutate("confirmed")} disabled={review.isPending}>
            {review.isPending ? <Loader2 size={13} className="animate-spin" /> : null} Confirm and hand off
          </button>
          <button type="button" className="b b-sm b-sec" onClick={() => setHj(hj === "dismiss" ? null : "dismiss")}>False alarm</button>
        </span>
      ) : a.acknowledged_at ? (
        <span className="tg tg-ok"><Check size={12} /> Seen</span>
      ) : !canOperate ? (
        <span className="tg tg-warn">Open</span>
      ) : (
        <button type="button" className="b b-sm b-sec" onClick={() => m.mutate()} disabled={m.isPending}>
          {m.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Acknowledge
        </button>
      )}
    </div>
    {hj === "dismiss" && hijackOpen && (
      <div className="card col g8" style={{ padding: "10px 12px" }}>
        <label className="fl"><span>Why is this a false alarm? (kept on the record)</span><input className="in" value={hjNote} onChange={(e) => setHjNote(e.target.value)} maxLength={1000} placeholder="e.g. Called the master: engine fault, stopped to repair, all passengers safe" /></label>
        <button type="button" className="b b-sm b-sec" style={{ alignSelf: "flex-start" }} disabled={hjNote.trim().length < 5 || review.isPending} onClick={() => review.mutate("dismissed")}>Dismiss as false alarm</button>
      </div>
    )}
    {showLog && <div className="card" style={{ padding: "8px 12px" }}><DeliveryLog alertId={a.id} /></div>}
    {hj === "handoff" && <div className="card" style={{ padding: "10px 12px" }}><HandoffPanel subjectId={a.subject_id} onClose={() => setHj(null)} /></div>}
    </div>
  );
}

function AlertsView({ alerts, subjects }: { alerts: MovementAlert[]; subjects: MovementSubject[] }) {
  if (!alerts.length) return <Empty>No movement alerts in the last 7 days.</Empty>;
  return (
    <div className="col g6">
      {alerts.map((a) => (
        <AlertRow key={a.id} a={a} subject={subjects.find((s) => s.id === a.subject_id)} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- People & assets

type SubjectForm = {
  id?: string;
  kind: MovementSubject["kind"];
  category: string;
  name: string;
  reference: string;
  mmsi: string;
  phone: string;
  emergency_contact: string;
  notes: string;
  device_kind: MovementSubject["device_kind"];
  device_id: string;
  silent_after_minutes: number;
  checkin_every_minutes: number | null;
  stop_alert_minutes: number | null;
  passenger_capacity: string;
  life_jackets: string;
};
const NEW_SUBJECT: SubjectForm = { kind: "person", category: "student", name: "", reference: "", mmsi: "", phone: "", emergency_contact: "", notes: "", device_kind: "phone", device_id: "", silent_after_minutes: 15, checkin_every_minutes: null, stop_alert_minutes: null, passenger_capacity: "", life_jackets: "" };
const mins = (m: number) => (m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? "s" : ""}`);

function SubjectsView({ subjects, loading }: { subjects: MovementSubject[]; loading: boolean }) {
  const [form, setForm] = useState<SubjectForm | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = subjects.find((s) => s.id === openId) ?? null;
  const { canManage } = useMovementPerms();

  return (
    <div className="grid g16" style={{ gridTemplateColumns: open || form ? "minmax(0,1fr) 420px" : "minmax(0,1fr)" }}>
      <Panel
        title="People & assets"
        meta={subjects.length}
        actions={
          canManage ? (
            <button type="button" className="b b-sm b-pri" onClick={() => { setOpenId(null); setForm({ ...NEW_SUBJECT }); }}>
              <Plus size={14} /> Add
            </button>
          ) : undefined
        }
      >
        {loading ? (
          <span className="row g8 t3"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</span>
        ) : subjects.length === 0 ? (
          <Empty>Add a student, a principal, a vehicle or a boat to start.</Empty>
        ) : (
          <div className="col g4">
            {subjects.map((s) => (
              <button key={s.id} type="button" className={`row g10 w-full text-left hover:bg-ink-3${openId === s.id ? " bg-ink-3" : ""}`} style={{ padding: "9px 8px", borderRadius: 8 }} onClick={() => { setForm(null); setOpenId(s.id); }}>
                <KindIcon kind={s.kind} />
                <span className="col f1" style={{ minWidth: 0 }}>
                  <b className="trunc">{s.name}</b>
                  <span className="t3 trunc" style={{ fontSize: 12 }}>
                    {CATEGORY_LABEL[s.category] ?? s.category}
                    {s.reference ? ` · ${s.reference}` : ""} · {s.device_kind === "phone" ? "phone" : s.device_kind === "gps_tracker" ? "GPS tracker" : "satellite tracker"}
                  </span>
                </span>
                {s.consent_status !== "granted" ? <Status tone="warn">{s.consent_status === "withdrawn" ? "Consent withdrawn" : "Needs consent"}</Status> : <Status tone={STATE[stateOf(s)].tone}>{STATE[stateOf(s)].label}</Status>}
              </button>
            ))}
          </div>
        )}
      </Panel>
      {form && <SubjectEditor form={form} setForm={setForm} onSaved={(id) => { setForm(null); setOpenId(id); }} />}
      {open && !form && <SubjectDetail s={open} onEdit={() => setForm({ id: open.id, kind: open.kind, category: open.category, name: open.name, reference: open.reference ?? "", mmsi: open.mmsi ?? "", phone: open.phone ?? "", emergency_contact: open.emergency_contact ?? "", notes: open.notes ?? "", device_kind: open.device_kind, device_id: open.device_id ?? "", silent_after_minutes: open.silent_after_minutes, checkin_every_minutes: open.checkin_every_minutes, stop_alert_minutes: open.stop_alert_minutes, passenger_capacity: open.passenger_capacity != null ? String(open.passenger_capacity) : "", life_jackets: open.life_jackets != null ? String(open.life_jackets) : "" })} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function SubjectEditor({ form, setForm, onSaved }: { form: SubjectForm; setForm: (f: SubjectForm | null) => void; onSaved: (id: string) => void }) {
  const save = useServerFn(saveMovementSubject);
  const qc = useQueryClient();
  const set = <K extends keyof SubjectForm>(k: K, v: SubjectForm[K]) => setForm({ ...form, [k]: v });
  const m = useMutation({
    mutationFn: () =>
      save({
        data: {
          id: form.id,
          kind: form.kind,
          category: form.category as any,
          name: form.name,
          reference: form.reference || null,
          mmsi: form.kind === "vessel" && form.mmsi ? form.mmsi : null,
          phone: form.phone || null,
          emergency_contact: form.emergency_contact || null,
          notes: form.notes || null,
          device_kind: form.device_kind,
          device_id: form.device_id || null,
          silent_after_minutes: form.silent_after_minutes,
          checkin_every_minutes: form.checkin_every_minutes,
          stop_alert_minutes: form.stop_alert_minutes,
          passenger_capacity: form.passenger_capacity ? Number(form.passenger_capacity) : null,
          life_jackets: form.life_jackets ? Number(form.life_jackets) : null,
        },
      }),
    onSuccess: (r) => {
      toast.success(form.id ? "Saved" : "Added. Record consent next, then switch tracking on.");
      qc.invalidateQueries({ queryKey: ["movement-subjects"] });
      onSaved(r.id);
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const mmsiBad = form.kind === "vessel" && form.mmsi !== "" && !/^\d{9}$/.test(form.mmsi);

  return (
    <Panel title={form.id ? "Edit" : "Add person or asset"} actions={<button type="button" className="ibtn" aria-label="Close" onClick={() => setForm(null)}><X size={14} /></button>}>
      <form className="col g10" onSubmit={(e) => { e.preventDefault(); if (form.name.trim() && !mmsiBad) m.mutate(); }}>
        <div className="seg" role="group" aria-label="Kind">
          {(["person", "vehicle", "vessel"] as const).map((k) => (
            <button key={k} type="button" className={form.kind === k ? "on" : undefined} onClick={() => setForm({ ...form, kind: k, category: CATEGORIES_FOR[k][0], device_kind: k === "person" ? "phone" : form.device_kind, ...(k === "vessel" && !form.id ? { stop_alert_minutes: form.stop_alert_minutes ?? 20, checkin_every_minutes: form.checkin_every_minutes ?? 60 } : {}) })}>
              <KindIcon kind={k} /> {k === "person" ? "Person" : k === "vehicle" ? "Vehicle" : "Boat"}
            </button>
          ))}
        </div>
        <label className="fl"><span>Name</span><input className="in" required value={form.name} onChange={(e) => set("name", e.target.value)} placeholder={form.kind === "person" ? "e.g. Ada Okafor" : form.kind === "vehicle" ? "e.g. Principal car — Lexus LX" : "e.g. MV Lekki Escort 2"} maxLength={120} /></label>
        <label className="fl">
          <span>Type</span>
          <select className="in" value={form.category} onChange={(e) => set("category", e.target.value)}>
            {CATEGORIES_FOR[form.kind].map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </label>
        <label className="fl"><span>{form.kind === "person" ? "Student / staff ID" : form.kind === "vehicle" ? "Plate number" : "Vessel name or IMO"} (optional)</span><input className="in" value={form.reference} onChange={(e) => set("reference", e.target.value)} maxLength={120} /></label>
        {form.kind === "vessel" && (
          <label className="fl"><span>MMSI (optional, 9 digits)</span><input className="in" inputMode="numeric" value={form.mmsi} onChange={(e) => set("mmsi", e.target.value.replace(/\D/g, "").slice(0, 9))} /></label>
        )}
        {mmsiBad && <Notice tone="warn">An MMSI is exactly 9 digits.</Notice>}
        {form.kind !== "person" && (
          <div className="grid g10" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <label className="fl"><span>Licensed to carry (people)</span><input className="in" inputMode="numeric" value={form.passenger_capacity} onChange={(e) => set("passenger_capacity", e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="e.g. 16" /></label>
            {form.kind === "vessel" && <label className="fl"><span>Life jackets on board</span><input className="in" inputMode="numeric" value={form.life_jackets} onChange={(e) => set("life_jackets", e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="e.g. 18" /></label>}
          </div>
        )}
        <div className="grid g10" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <label className="fl"><span>Phone</span><input className="in" value={form.phone} onChange={(e) => set("phone", e.target.value)} maxLength={40} /></label>
          <label className="fl"><span>Emergency contact</span><input className="in" value={form.emergency_contact} onChange={(e) => set("emergency_contact", e.target.value)} maxLength={200} placeholder="Parent, next of kin, ops desk" /></label>
        </div>
        <label className="fl">
          <span>Tracker</span>
          <select className="in" value={form.device_kind} onChange={(e) => set("device_kind", e.target.value as SubjectForm["device_kind"])}>
            <option value="phone">Their phone (tracker link)</option>
            <option value="gps_tracker">GPS tracker device</option>
            <option value="satellite_tracker">Satellite tracker (offshore)</option>
          </select>
        </label>
        {form.device_kind !== "phone" && (
          <label className="fl"><span>Device ID / IMEI (for a Traccar server forwarding this device)</span><input className="in" value={form.device_id} onChange={(e) => set("device_id", e.target.value.trim())} maxLength={64} /></label>
        )}
        <label className="fl">
          <span>Alert if no position for</span>
          <select className="in" value={form.silent_after_minutes} onChange={(e) => set("silent_after_minutes", Number(e.target.value))}>
            {[5, 10, 15, 30, 60, 120, 360].map((m) => <option key={m} value={m}>{mins(m)}</option>)}
          </select>
        </label>
        <div className="grid g10" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <label className="fl">
            <span>"All OK" check-in every</span>
            <select className="in" value={form.checkin_every_minutes ?? ""} onChange={(e) => set("checkin_every_minutes", e.target.value ? Number(e.target.value) : null)}>
              <option value="">Not required</option>
              {[15, 30, 60, 120, 240].map((m) => <option key={m} value={m}>{mins(m)}</option>)}
            </select>
          </label>
          <label className="fl">
            <span>Alert if stopped for</span>
            <select className="in" value={form.stop_alert_minutes ?? ""} onChange={(e) => set("stop_alert_minutes", e.target.value ? Number(e.target.value) : null)}>
              <option value="">Never</option>
              {[10, 20, 30, 60, 120].map((m) => <option key={m} value={m}>{mins(m)}</option>)}
            </select>
          </label>
        </div>
        <span className="t3" style={{ fontSize: 12 }}>
          A missed check-in alerts the control room. A stop alert fires when they're stopped or drifting outside a safe zone — for boats, a common sign of trouble at sea.
        </span>
        <label className="fl"><span>Notes</span><textarea className="in" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} maxLength={1000} /></label>
        <button type="submit" className="b b-pri" disabled={m.isPending || !form.name.trim() || mmsiBad}>
          {m.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {form.id ? "Save" : "Add"}
        </button>
      </form>
    </Panel>
  );
}

function SubjectDetail({ s, onEdit, onClose }: { s: MovementSubject; onEdit: () => void; onClose: () => void }) {
  const qc = useQueryClient();
  const consentFn = useServerFn(setMovementConsent);
  const trackingFn = useServerFn(setMovementTracking);
  const linkFn = useServerFn(newTrackerLink);
  const delFn = useServerFn(deleteMovementSubject);
  const [note, setNote] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [handoff, setHandoff] = useState(false);
  const { canManage, canOperate } = useMovementPerms();
  const refresh = () => qc.invalidateQueries({ queryKey: ["movement-subjects"] });
  const origin = typeof window === "undefined" ? "https://app.lemtik.com.ng" : window.location.origin;
  const link = `${origin}/track/${s.tracker_token}`;
  const deviceUrl = `${origin}/tracker/osmand`;

  useEffect(() => {
    let live = true;
    import("qrcode").then((Q) => Q.default.toDataURL(link, { width: 220, margin: 1 })).then((u) => live && setQr(u)).catch(() => setQr(null));
    return () => {
      live = false;
    };
  }, [link]);

  const consent = useMutation({
    mutationFn: (status: "granted" | "withdrawn") => consentFn({ data: { id: s.id, status, note } }),
    onSuccess: (_, status) => { toast.success(status === "granted" ? "Consent recorded" : "Consent withdrawn; tracking is off"); setNote(""); refresh(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const tracking = useMutation({
    mutationFn: (enabled: boolean) => trackingFn({ data: { id: s.id, enabled } }),
    onSuccess: refresh,
    onError: (e) => toast.error((e as Error).message),
  });
  const rotate = useMutation({
    mutationFn: () => linkFn({ data: { id: s.id } }),
    onSuccess: () => { toast.success("New link made. The old link and QR no longer work."); refresh(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const del = useMutation({
    mutationFn: () => delFn({ data: { id: s.id } }),
    onSuccess: () => { toast.success("Removed, with its location history"); onClose(); refresh(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => toast.success("Copied")).catch(() => toast.error("Couldn't copy"));

  return (
    <Panel title={s.name} icon={<KindIcon kind={s.kind} size={15} />} actions={<>{canManage && <button type="button" className="b b-sm b-gh" onClick={onEdit}>Edit</button>}<button type="button" className="ibtn" aria-label="Close" onClick={onClose}><X size={14} /></button></>}>
      <div className="col g14">
        <section className="col g8">
          <span className="o-lbl">CONSENT</span>
          {s.consent_status === "granted" ? (
            <Notice tone="ok">
              <ShieldCheck size={13} /> Recorded {s.consent_recorded_at ? new Date(s.consent_recorded_at).toLocaleDateString("en-GB") : ""}: {s.consent_note}
            </Notice>
          ) : (
            <Notice tone="warn">{s.consent_status === "withdrawn" ? "Consent was withdrawn. Tracking stays off until it's recorded again." : "Tracking can't start until consent is recorded. For a minor, record the parent's or guardian's consent."}</Notice>
          )}
          {canManage && <>
          <input className="in" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={s.consent_status === "granted" ? "Reason for withdrawal" : "How consent was given, e.g. signed form 12 Nov, parent: Mrs Okafor"} />
          <div className="row g8">
            {s.consent_status !== "granted" ? (
              <button type="button" className="b b-sm b-pri" disabled={note.trim().length < 3 || consent.isPending} onClick={() => consent.mutate("granted")}>Record consent</button>
            ) : (
              <button type="button" className="b b-sm b-sec" disabled={note.trim().length < 3 || consent.isPending} onClick={() => consent.mutate("withdrawn")}>Record withdrawal</button>
            )}
          </div>
          </>}
        </section>

        {canOperate && s.kind !== "person" && s.tracking_enabled && (handoff ? (
          <HandoffPanel subjectId={s.id} onClose={() => setHandoff(false)} />
        ) : (
          <button type="button" className="b b-sm b-sec" style={{ alignSelf: "flex-start", color: "var(--s5)" }} onClick={() => setHandoff(true)}>Emergency: hand off to a responder</button>
        ))}

        <section className="row g10">
          <span className="col f1">
            <b>Tracking</b>
            <span className="t3" style={{ fontSize: 12 }}>
              {s.tracking_enabled
                ? `On · alerts if silent for ${s.silent_after_minutes} min${s.checkin_every_minutes ? ` · check-in every ${s.checkin_every_minutes} min` : ""}${s.stop_alert_minutes ? ` · stop alert after ${s.stop_alert_minutes} min` : ""}`
                : "Off · nothing is received or stored"}
            </span>
            {s.tracking_enabled && s.checkin_every_minutes != null && (
              <span className="t3" style={{ fontSize: 12, color: s.checkin_overdue ? "var(--s4)" : undefined }}>
                {s.checkin_overdue ? "Check-in overdue" : s.last_checkin_at ? `Last check-in ${new Date(s.last_checkin_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "No check-in yet"}
              </span>
            )}
          </span>
          <Switch label="Tracking" on={s.tracking_enabled} disabled={!canManage || s.consent_status !== "granted" || tracking.isPending} onChange={(v) => tracking.mutate(v)} />
        </section>

        {canManage && <section className="col g8">
          <span className="o-lbl">{s.device_kind === "phone" ? "TRACKER LINK FOR THEIR PHONE" : "TRACKER SETUP"}</span>
          {s.device_kind === "phone" ? (
            <>
              <span className="t3" style={{ fontSize: 12.5 }}>Send this link to {s.name} (or scan the QR with their phone). They press Start sharing, and can tap All OK to check in or hold SOS{s.kind === "vessel" ? " or Man overboard" : ""}. No app install or login.</span>
              <div className="row g8">
                <input className="in mono f1" readOnly value={link} style={{ fontSize: 11.5 }} />
                <button type="button" className="ibtn" aria-label="Copy link" onClick={() => copy(link)}><Copy size={14} /></button>
              </div>
              {qr && <img src={qr} alt={`QR code for ${s.name}'s tracker link`} width={160} height={160} style={{ background: "#fff", borderRadius: 8, padding: 6 }} />}
            </>
          ) : (
            <span className="t3" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              <b>Traccar Client app</b> (free, on a phone fixed in the vehicle or boat): set Server URL to <span className="mono">{deviceUrl}</span> and Device identifier to the secret below.
              <br />
              <b>Hardware trackers</b>: point them at a Traccar server and forward positions to the URL above with <span className="mono">id={"{uniqueId}"}</span> and <span className="mono">key=</span> your forwarding key; set this asset's Device ID to the tracker's IMEI.
            </span>
          )}
          <div className="row g8">
            <span className="t3" style={{ fontSize: 12 }}>Secret</span>
            <input className="in mono f1" readOnly value={s.tracker_token} style={{ fontSize: 11.5 }} />
            <button type="button" className="ibtn" aria-label="Copy secret" onClick={() => copy(s.tracker_token)}><Copy size={14} /></button>
          </div>
          <button type="button" className="b b-sm b-gh" style={{ alignSelf: "flex-start" }} onClick={() => rotate.mutate()} disabled={rotate.isPending}>
            <RefreshCw size={13} /> Make a new link (old one stops working)
          </button>
        </section>}

        <section className="col g4 t3" style={{ fontSize: 12.5 }}>
          {s.reference && <span>Reference: {s.reference}</span>}
          {s.mmsi && <span>MMSI: {s.mmsi}</span>}
          {s.phone && <span>Phone: {s.phone}</span>}
          {s.emergency_contact && <span>Emergency contact: {s.emergency_contact}</span>}
          {s.last_seen_at && <span>Last position: {new Date(s.last_seen_at).toLocaleString("en-GB")}{s.last_battery != null ? ` · battery ${s.last_battery}%` : ""}</span>}
        </section>

        {!canManage ? null : confirmDelete ? (
          <div className="row g8">
            <span className="t2 f1" style={{ fontSize: 12.5 }}>Remove {s.name} and delete all their location history?</span>
            <button type="button" className="b b-sm b-sec" onClick={() => setConfirmDelete(false)}>Cancel</button>
            <button type="button" className="b b-sm" style={{ background: "var(--s5)", color: "#fff" }} onClick={() => del.mutate()} disabled={del.isPending}>Remove</button>
          </div>
        ) : (
          <button type="button" className="b b-sm b-gh" style={{ alignSelf: "flex-start", color: "var(--s5)" }} onClick={() => setConfirmDelete(true)}>
            <Trash2 size={13} /> Remove
          </button>
        )}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- Zones

type ZoneForm = { id?: string; name: string; kind: MovementGeofence["kind"]; center: LngLat | null; radius_m: number; alert_on: MovementGeofence["alert_on"]; subject_ids: string[] | null; active: boolean };
const NEW_ZONE: ZoneForm = { name: "", kind: "safe", center: null, radius_m: 300, alert_on: "both", subject_ids: null, active: true };
const ZONE_HELP: Record<MovementGeofence["kind"], string> = {
  safe: "A campus, home or office. Alerts when someone arrives or leaves.",
  restricted: "A no-go area. Alerts when someone goes in.",
  exclusion: "A security perimeter around a platform, jetty or anchorage. Alerts when a tracked boat or vehicle enters or leaves.",
};

function ZonesView({ zones, subjects }: { zones: MovementGeofence[]; subjects: MovementSubject[] }) {
  const [form, setForm] = useState<ZoneForm | null>(null);
  const { canManage } = useMovementPerms();
  const save = useServerFn(saveMovementGeofence);
  const del = useServerFn(deleteMovementGeofence);
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["movement-zones"] });

  const saveM = useMutation({
    mutationFn: (f: ZoneForm) => save({ data: { id: f.id, name: f.name, kind: f.kind, center_lat: f.center![1], center_lng: f.center![0], radius_m: f.radius_m, alert_on: f.alert_on, subject_ids: f.subject_ids, active: f.active } }),
    onSuccess: () => { toast.success("Zone saved"); setForm(null); refresh(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const delM = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => { toast.success("Zone deleted"); setForm(null); refresh(); },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="grid g16" style={{ gridTemplateColumns: form ? "minmax(0,1fr) 440px" : "minmax(0,1fr)" }}>
      <Panel title="Zones" meta={zones.length} actions={canManage ? <button type="button" className="b b-sm b-pri" onClick={() => setForm({ ...NEW_ZONE })}><Plus size={14} /> Add zone</button> : undefined}>
        {zones.length === 0 ? (
          <Empty>No zones yet. Add a campus or home as a safe zone, or a platform's perimeter as an exclusion zone.</Empty>
        ) : (
          <div className="col g4">
            {zones.map((z) => (
              <button key={z.id} type="button" className="row g10 w-full text-left hover:bg-ink-3" style={{ padding: "9px 8px", borderRadius: 8 }} disabled={!canManage} onClick={() => setForm({ id: z.id, name: z.name, kind: z.kind, center: [z.center_lng, z.center_lat], radius_m: z.radius_m, alert_on: z.alert_on, subject_ids: z.subject_ids, active: z.active })}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: ZONE_COLOR[z.kind] }} />
                <span className="col f1">
                  <b>{z.name}</b>
                  <span className="t3" style={{ fontSize: 12 }}>
                    {z.kind} · {z.radius_m >= 1000 ? `${(z.radius_m / 1000).toFixed(1)} km` : `${z.radius_m} m`} radius · alerts on {z.alert_on === "both" ? "enter and exit" : z.alert_on} · {z.subject_ids ? `${z.subject_ids.length} selected` : "everyone"}
                  </span>
                </span>
                {!z.active && <Status tone="off">Paused</Status>}
              </button>
            ))}
          </div>
        )}
      </Panel>

      {form && (
        <Panel title={form.id ? "Edit zone" : "New zone"} actions={<button type="button" className="ibtn" aria-label="Close" onClick={() => setForm(null)}><X size={14} /></button>}>
          <form className="col g10" onSubmit={(e) => { e.preventDefault(); if (form.name.trim() && form.center) saveM.mutate(form); }}>
            <label className="fl"><span>Name</span><input className="in" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} placeholder="e.g. UNILAG main campus, Platform Bravo perimeter" /></label>
            <div className="seg" role="group" aria-label="Zone type">
              {(["safe", "restricted", "exclusion"] as const).map((k) => (
                <button key={k} type="button" className={form.kind === k ? "on" : undefined} onClick={() => setForm({ ...form, kind: k, alert_on: k === "restricted" ? "enter" : "both" })}>
                  {k === "safe" ? "Safe" : k === "restricted" ? "Restricted" : "Exclusion"}
                </button>
              ))}
            </div>
            <span className="t3" style={{ fontSize: 12.5 }}>{ZONE_HELP[form.kind]}</span>
            <LocationPicker value={form.center} center={form.center} onChange={(c) => setForm({ ...form, center: c })} height={240} />
            {!form.center && <span className="t3" style={{ fontSize: 12 }}>Type an address or click the map to set the zone's centre.</span>}
            <label className="fl">
              <span>Radius: {form.radius_m >= 1000 ? `${(form.radius_m / 1000).toFixed(1)} km` : `${form.radius_m} m`}</span>
              <input type="range" min={50} max={form.kind === "exclusion" ? 20000 : 5000} step={50} value={form.radius_m} onChange={(e) => setForm({ ...form, radius_m: Number(e.target.value) })} />
            </label>
            <label className="fl">
              <span>Alert when</span>
              <select className="in" value={form.alert_on} onChange={(e) => setForm({ ...form, alert_on: e.target.value as ZoneForm["alert_on"] })}>
                <option value="both">They enter or leave</option>
                <option value="enter">They enter</option>
                <option value="exit">They leave</option>
              </select>
            </label>
            <div className="col g6">
              <span className="o-lbl">APPLIES TO</span>
              <label className="row g8"><input type="checkbox" checked={form.subject_ids === null} onChange={(e) => setForm({ ...form, subject_ids: e.target.checked ? null : [] })} /> Everyone tracked</label>
              {form.subject_ids !== null && (
                <div className="col g4" style={{ maxHeight: 160, overflow: "auto" }}>
                  {subjects.map((s) => (
                    <label key={s.id} className="row g8">
                      <input type="checkbox" checked={form.subject_ids!.includes(s.id)} onChange={(e) => setForm({ ...form, subject_ids: e.target.checked ? [...form.subject_ids!, s.id] : form.subject_ids!.filter((x) => x !== s.id) })} />
                      {s.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <label className="row g8"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active</label>
            <div className="row g8">
              <button type="submit" className="b b-pri" disabled={saveM.isPending || !form.name.trim() || !form.center || (form.subject_ids !== null && form.subject_ids.length === 0)}>
                {saveM.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save zone
              </button>
              {form.id && (
                <button type="button" className="b b-gh" style={{ color: "var(--s5)" }} onClick={() => delM.mutate(form.id!)} disabled={delM.isPending}>
                  <Trash2 size={14} /> Delete
                </button>
              )}
            </div>
          </form>
        </Panel>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Search and rescue

function SarList({ cases }: { cases: SarCase[] }) {
  return (
    <Panel title="Search and rescue plans" meta={cases.length}>
      {cases.length === 0 ? (
        <Empty>When someone goes overboard or a boat goes missing, press "Search plan" on its alert. Lemtik estimates where they have drifted from the wind and current, draws the search area as it grows, lays out a search pattern and prints a package for the rescue centre.</Empty>
      ) : (
        <div className="col g4">
          {cases.map((c) => (
            <Link key={c.id} to="/app/movement/sar/$id" params={{ id: c.id }} className="row g10 w-full hover:bg-ink-3" style={{ padding: "9px 8px", borderRadius: 8 }}>
              <span className="col f1" style={{ minWidth: 0 }}>
                <b className="trunc">{c.title}</b>
                <span className="t3 trunc" style={{ fontSize: 12 }}>Last known {new Date(c.lkp_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · started by {c.created_by_name ?? "—"}</span>
              </span>
              <Status tone={c.status === "active" ? "fail" : c.status === "found" ? "ok" : "off"}>{c.status === "active" ? "Active" : c.status === "found" ? "Found" : "Stood down"}</Status>
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}
