import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { toast } from "sonner";
import { Anchor, BellRing, CloudLightning, Clock, Loader2, RefreshCw, Ship, Wind } from "lucide-react";
import { requireFeature, requireSectionAccess } from "@/lib/rbac";
import { useRealtimeInvalidate } from "@/lib/useRealtime";
import { basemapOptions, BasemapSwitch, useBasemap } from "@/lib/basemap";
import { useMapboxToken } from "@/components/LocationPicker";
import { Empty, Kpi, Notice, PageHeader, Panel, Status, timeAgo, useNow, type Tone } from "@/components/nw";
import { getFleetOverview, type FleetCheckin, type FleetOverview, type FleetVoyage } from "@/lib/fleet.functions";
import { getNearbyShips, type NearbyShip } from "@/lib/voyages.functions";
import type { MovementSubject } from "@/lib/movement.functions";

export const Route = createFileRoute("/app/fleet")({
  head: () => ({ meta: [{ title: "Fleet overview · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    requireSectionAccess(context.appAccess, ["security_manager", "operator", "client_admin"]);
    requireFeature(context.appAccess, "movement");
    return { appAccess: context.appAccess };
  },
  component: Fleet,
});

type LngLat = [number, number];
const LAGOS: LngLat = [3.4219, 6.4281];

type Shown = MovementSubject["state"] | "waiting" | "off";
const STATE: Record<Shown, { tone: Tone; label: string; color: string }> = {
  sos: { tone: "fail", label: "SOS", color: "#F2384B" },
  silent: { tone: "warn", label: "Silent", color: "#F5A524" },
  moving: { tone: "ok", label: "Moving", color: "#2BD576" },
  stopped: { tone: "blue", label: "Stopped", color: "#7A9BFF" },
  waiting: { tone: "neutral", label: "Waiting for position", color: "#8A93A6" },
  idle: { tone: "neutral", label: "Waiting for position", color: "#8A93A6" },
  off: { tone: "neutral", label: "Not tracking", color: "#5B6475" },
};
const ORDER: Shown[] = ["sos", "silent", "moving", "stopped", "waiting", "idle", "off"];
const stateOf = (s: MovementSubject): Shown => (!s.tracking_enabled ? "off" : s.state === "idle" ? "waiting" : s.state);

const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" }) : "—");
const km = (m: number | null) => (m == null ? "—" : m < 1000 ? `${m} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`);
const ETA_BASIS: Record<NonNullable<FleetVoyage["eta_basis"]>, string> = {
  current_speed: "at current speed",
  average_speed: "at average speed so far",
  planned: "planned",
};

function Fleet() {
  const load = useServerFn(getFleetOverview);
  const q = useQuery({ queryKey: ["fleet-overview"], queryFn: () => load(), refetchInterval: 30_000 });
  useRealtimeInvalidate("movement_subjects", [["fleet-overview"]]);
  useRealtimeInvalidate("movement_alerts", [["fleet-overview"]]);
  useRealtimeInvalidate("movement_voyages", [["fleet-overview"]]);
  const now = useNow(30_000);
  const d = q.data;

  const boats = d?.subjects ?? [];
  const count = (st: Shown) => boats.filter((s) => stateOf(s) === st).length;
  const missed = d?.checkins.filter((c) => c.state === "missed").length ?? 0;

  return (
    <div className="col g16">
      <PageHeader title="Fleet overview" sub={d ? `Updated ${clock(d.generated_at)} · refreshes every 30 seconds` : "Loading…"}>
        <button type="button" className="b b-sec b-sm" onClick={() => q.refetch()} disabled={q.isFetching}>
          {q.isFetching ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
        </button>
        <Link to="/app/movement" className="b b-pri b-sm">
          Plan or start a voyage
        </Link>
      </PageHeader>

      {q.error && <Notice tone="fail">{(q.error as Error).message}</Notice>}

      <div className="kpis">
        <Kpi label="Voyages under way" value={d?.voyages.length ?? "—"} delta={d ? `${d.completed_today} completed today` : undefined} />
        <Kpi label="Moving" value={d ? count("moving") : "—"} delta={d ? `${count("stopped")} stopped` : undefined} />
        <Kpi label="SOS or silent" value={d ? count("sos") + count("silent") : "—"} deltaClass={d && count("sos") + count("silent") ? "dn-bad" : ""} delta={d ? (count("sos") ? `${count("sos")} SOS` : "None in SOS") : undefined} />
        <Kpi label="Check-ins missed" value={d ? missed : "—"} delta={d ? `${d.checkins.filter((c) => c.state === "due_soon").length} due in 15 min` : undefined} deltaClass={missed ? "dn-bad" : ""} />
        <Kpi label="Open alerts" value={d?.alerts.length ?? "—"} deltaClass={d?.alerts.some((a) => a.severity >= 4) ? "dn-bad" : ""} delta={d ? `${d.alerts.filter((a) => a.severity >= 4).length} high or critical` : undefined} />
      </div>

      <div className="grid g16 fleet-top">
        <FleetMap data={d} />
        <div className="col g12">
          <Panel title="Needs attention" icon={<BellRing size={15} className="ic" />} meta={d?.alerts.length || undefined} actions={<Link to="/app/movement" className="b b-gh b-sm">All alerts</Link>}>
            {!d ? (
              <Empty>Loading…</Empty>
            ) : d.alerts.length === 0 ? (
              <Empty>No open alerts.</Empty>
            ) : (
              <div className="col g6">
                {d.alerts.slice(0, 6).map((a) => (
                  <div key={a.id} className="row g8" style={{ alignItems: "flex-start" }}>
                    <Status tone={a.severity >= 5 ? "fail" : a.severity >= 4 ? "warn" : "neutral"}>{a.severity >= 5 ? "Critical" : a.severity >= 4 ? "High" : "Notice"}</Status>
                    <span className="col f1" style={{ minWidth: 0, fontSize: 12.5 }}>
                      <b className="trunc">{boats.find((s) => s.id === a.subject_id)?.name ?? "Unknown"}</b>
                      <span className="t3">{a.message} · {timeAgo(a.created_at, now)}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          <CheckinsPanel list={d?.checkins} now={now} />
        </div>
      </div>

      <VoyagesPanel list={d?.voyages} now={now} />
      {d && d.corridors.length > 0 && <CorridorsPanel corridors={d.corridors} />}
      <style>{`.fleet-top{grid-template-columns:minmax(0,1fr) 340px}@media (max-width:1100px){.fleet-top{grid-template-columns:minmax(0,1fr)}}`}</style>
    </div>
  );
}

function CheckinsPanel({ list, now }: { list?: FleetCheckin[]; now: number }) {
  const tone: Record<FleetCheckin["state"], Tone> = { missed: "fail", due_soon: "warn", ok: "ok" };
  const label: Record<FleetCheckin["state"], string> = { missed: "Missed", due_soon: "Due soon", ok: "On time" };
  return (
    <Panel title="Check-ins" icon={<Clock size={15} className="ic" />} meta={list?.length || undefined}>
      {!list ? (
        <Empty>Loading…</Empty>
      ) : list.length === 0 ? (
        <Empty>No boats have a check-in interval set. Set one under People & assets to get a missed check-in alert.</Empty>
      ) : (
        <div className="col g6">
          {list.slice(0, 8).map((c) => (
            <div key={c.subject_id} className="row g8">
              <span className="col f1" style={{ minWidth: 0, fontSize: 12.5 }}>
                <b className="trunc">{c.name}</b>
                <span className="t3">
                  Every {c.every_min} min · last {c.last_at ? timeAgo(c.last_at, now) : "never"} · {c.state === "missed" ? "was due" : "due"} {clock(c.due_at)}
                </span>
              </span>
              <Status tone={tone[c.state]}>{label[c.state]}</Status>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function VoyagesPanel({ list, now }: { list?: FleetVoyage[]; now: number }) {
  return (
    <Panel title="Voyages under way" icon={<Anchor size={15} className="ic" />} meta={list?.length || undefined} bodyClassName="">
      {!list ? (
        <div className="pn-b"><Empty>Loading…</Empty></div>
      ) : list.length === 0 ? (
        <div className="pn-b"><Empty>No boats are out right now.</Empty></div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="tbl w-full" style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
            <thead>
              <tr>
                <th className="text-left">Boat · voyage</th>
                <th className="text-left">Left</th>
                <th className="text-left" style={{ minWidth: 140 }}>Progress</th>
                <th className="text-right">To go</th>
                <th className="text-left">ETA</th>
                <th className="text-right">Aboard</th>
                <th className="text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((v) => (
                <tr key={v.id}>
                  <td>
                    <Link to="/app/movement/voyages/$id" params={{ id: v.id }} className="col hover:underline">
                      <b>{v.boat_name}</b>
                      <span className="t3">{v.name}</span>
                    </Link>
                  </td>
                  <td>{clock(v.departed_at)}<div className="t3">{v.departed_at ? timeAgo(v.departed_at, now) : ""}</div></td>
                  <td>
                    {v.progress_pct == null ? (
                      <span className="t3">No position yet</span>
                    ) : (
                      <div className="row g6">
                        <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--ink-3, rgba(127,127,127,.2))", overflow: "hidden" }} aria-hidden>
                          <div style={{ width: `${v.progress_pct}%`, height: "100%", background: v.off_route ? "#F5A524" : "#4F8BFF" }} />
                        </div>
                        <span>{v.progress_pct}%</span>
                      </div>
                    )}
                  </td>
                  <td className="text-right">{km(v.remaining_m)}</td>
                  <td>
                    {clock(v.eta)}
                    <div className="t3">{v.eta_basis ? ETA_BASIS[v.eta_basis] : "Not enough data"}</div>
                  </td>
                  <td className="text-right">{v.departure_count ?? "—"}</td>
                  <td>
                    <div className="row g4" style={{ flexWrap: "wrap" }}>
                      {v.off_route && <Status tone="warn">Off route</Status>}
                      {v.late_by_min != null && <Status tone="warn">{v.late_by_min} min late</Status>}
                      {v.overdue_alerted && <Status tone="fail">Overdue</Status>}
                      {!v.off_route && v.late_by_min == null && !v.overdue_alerted && <Status tone="ok">On track</Status>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function CorridorsPanel({ corridors }: { corridors: FleetOverview["corridors"] }) {
  return (
    <Panel title="Corridor weather, next 3 hours" icon={<Wind size={15} className="ic" />} meta="MET Norway">
      <div className="grid g8" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
        {corridors.map((c) => (
          <div key={c.id} className="col g4" style={{ border: "1px solid var(--line-2)", borderRadius: 9, padding: "10px 12px" }}>
            <div className="row g6">
              <b className="f1 trunc" style={{ fontSize: 13 }}>{c.name}</b>
              {c.in_curfew ? <Status tone="fail">Curfew</Status> : c.over_limit ? <Status tone="warn">Over limit</Status> : c.weather ? <Status tone="ok">Within limit</Status> : <Status tone="neutral">No forecast</Status>}
            </div>
            {c.weather ? (
              <span className="t3" style={{ fontSize: 12 }}>
                {c.weather.thunder && <CloudLightning size={12} style={{ display: "inline", marginRight: 4 }} />}
                Wind {c.weather.wind_kn ?? "—"} kn{c.weather.gust_kn != null ? `, gusts ${c.weather.gust_kn} kn` : ""} · limit {c.max_wind_kn ?? 25} kn
                {c.weather.rain_mm ? ` · rain ${c.weather.rain_mm} mm` : ""}
              </span>
            ) : (
              <span className="t3" style={{ fontSize: 12 }}>The forecast service didn't answer. Try Refresh.</span>
            )}
            {c.curfew_start && <span className="t3" style={{ fontSize: 12 }}>Curfew {c.curfew_start.slice(0, 5)}–{c.curfew_end?.slice(0, 5)}</span>}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function FleetMap({ data }: { data?: FleetOverview }) {
  const { data: tokenData } = useMapboxToken();
  const token = tokenData?.token ?? "";
  const [basemap, setBasemap] = useBasemap();
  const el = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const fitted = useRef(false);
  const shipsFn = useServerFn(getNearbyShips);
  const [shipsOn, setShipsOn] = useState(false);
  const [ships, setShips] = useState<{ list: NearbyShip[]; at: number; note?: string; configured: boolean } | null>(null);
  const shipsM = useMutation({
    mutationFn: () => {
      const b = mapRef.current!.getBounds()!;
      return shipsFn({ data: { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() } });
    },
    onSuccess: (r) => setShips({ list: r.ships, at: Date.now(), note: r.note, configured: r.configured }),
    onError: (e) => toast.error((e as Error).message),
  });

  const subjects = data?.subjects ?? [];
  const placed = subjects.filter((s) => s.last_lat != null && s.last_lng != null);
  const etaBySubject = new Map((data?.voyages ?? []).map((v) => [v.subject_id, v]));

  useEffect(() => {
    if (!token || !el.current || mapRef.current) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({ container: el.current, ...basemapOptions(basemap), center: LAGOS, zoom: 10.5, attributionControl: true });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      map.addSource("fl-routes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "fl-routes-line", type: "line", source: "fl-routes", paint: { "line-color": ["get", "color"], "line-width": 2.5, "line-dasharray": [3, 2], "line-opacity": 0.9 } });
      map.addSource("fl-ships", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "fl-ships-dot", type: "circle", source: "fl-ships", paint: { "circle-radius": 4, "circle-color": "#C7D2E5", "circle-stroke-color": "#0A0C10", "circle-stroke-width": 1, "circle-opacity": 0.85 } });
      map.addLayer({ id: "fl-ships-label", type: "symbol", source: "fl-ships", minzoom: 10, layout: { "text-field": ["get", "label"], "text-size": 10, "text-offset": [0, 1.1], "text-anchor": "top", "text-font": ["DIN Pro Regular", "Arial Unicode MS Regular"] }, paint: { "text-color": "#C7D2E5", "text-halo-color": "#0A0C10", "text-halo-width": 1.2 } });
      map.addSource("fl-boats", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "fl-boats-halo", type: "circle", source: "fl-boats", paint: { "circle-radius": 13, "circle-color": ["get", "color"], "circle-opacity": 0.25 } });
      map.addLayer({ id: "fl-boats-dot", type: "circle", source: "fl-boats", paint: { "circle-radius": 7, "circle-color": ["get", "color"], "circle-stroke-color": "#0A0C10", "circle-stroke-width": 2 } });
      map.addLayer({ id: "fl-boats-label", type: "symbol", source: "fl-boats", layout: { "text-field": ["get", "label"], "text-size": 11, "text-offset": [0, 1.4], "text-anchor": "top", "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"] }, paint: { "text-color": "#fff", "text-halo-color": "#0A0C10", "text-halo-width": 1.4 } });
      setReady(true);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      fitted.current = false;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !data) return;
    (map.getSource("fl-boats") as mapboxgl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: placed.map((s) => {
        const v = etaBySubject.get(s.id);
        return { type: "Feature", properties: { color: STATE[stateOf(s)].color, label: v?.eta ? `${s.name} · ETA ${clock(v.eta)}` : s.name }, geometry: { type: "Point", coordinates: [s.last_lng!, s.last_lat!] } };
      }),
    } as any);
    (map.getSource("fl-routes") as mapboxgl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: data.voyages.filter((v) => v.route.length > 1).map((v) => ({ type: "Feature", properties: { color: v.off_route ? "#F5A524" : "#4F8BFF" }, geometry: { type: "LineString", coordinates: v.route } })),
    } as any);
    if (!fitted.current && placed.length) {
      fitted.current = true;
      const b = new mapboxgl.LngLatBounds();
      placed.forEach((s) => b.extend([s.last_lng!, s.last_lat!]));
      data.voyages.forEach((v) => v.route.forEach((p) => b.extend(p)));
      map.fitBounds(b, { padding: 60, maxZoom: 14, duration: 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, data]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const own = new Set(subjects.map((s) => s.mmsi).filter(Boolean) as string[]);
    const list = shipsOn ? (ships?.list ?? []).filter((sh) => !own.has(sh.mmsi)) : [];
    (map.getSource("fl-ships") as mapboxgl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: list.map((sh) => ({ type: "Feature", properties: { label: `${sh.name ?? sh.mmsi}${sh.speed_kn != null ? ` · ${sh.speed_kn.toFixed(1)} kn` : ""}` }, geometry: { type: "Point", coordinates: [sh.lng, sh.lat] } })),
    } as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, ships, shipsOn]);

  const legend = ORDER.filter((st) => st !== "idle" && subjects.some((s) => stateOf(s) === st));

  return (
    <div className="map" style={{ height: 520 }}>
      <div ref={el} style={{ position: "absolute", inset: 0 }} />
      {!token && <div className="absolute inset-0 grid place-items-center t3">{tokenData ? "No Mapbox token configured." : <Loader2 className="h-5 w-5 animate-spin" />}</div>}
      {token && <BasemapSwitch value={basemap} onChange={setBasemap} style={{ left: 10, bottom: 10 }} />}
      {token && legend.length > 0 && (
        <div className="glass row g8" style={{ position: "absolute", left: 10, top: 10, padding: "6px 10px", fontSize: 11.5, zIndex: 2, flexWrap: "wrap", maxWidth: "70%" }}>
          {legend.map((st) => (
            <span key={st} className="row g4">
              <span style={{ width: 9, height: 9, borderRadius: 9, background: STATE[st].color, display: "inline-block" }} />
              {STATE[st].label} {subjects.filter((s) => stateOf(s) === st).length}
            </span>
          ))}
        </div>
      )}
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
              <Ship size={13} /> Other ships (AIS)
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
                        ? "No ships reported here right now. Public AIS coverage is thin in many Nigerian waters, and small boats often don't transmit."
                        : `${ships.list.length} ship${ships.list.length === 1 ? "" : "s"} heard · ${new Date(ships.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`}
            </span>
          )}
        </div>
      )}
      {data && placed.length === 0 && (
        <div className="glass" style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", padding: "10px 14px", fontSize: 12.5, zIndex: 2, maxWidth: 320, textAlign: "center" }}>
          {subjects.length === 0 ? "No boats set up yet. Add them under Fleet and voyages → People & assets." : "No boat has sent a position yet."}
        </div>
      )}
    </div>
  );
}
