import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { toast } from "sonner";
import { ArrowLeft, Copy, Loader2 } from "lucide-react";
import { requireSectionAccess } from "@/lib/rbac";
import { basemapOptions } from "@/lib/basemap";
import { useMapboxToken } from "@/components/LocationPicker";
import { Empty, Notice, PageHeader, Panel, Status } from "@/components/nw";
import { getSharedView, importSharedCorridor, type SharedView } from "@/lib/links.functions";

export const Route = createFileRoute("/app/links_/$id")({
  head: () => ({ meta: [{ title: "Shared view · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    requireSectionAccess(context.appAccess, ["security_manager", "operator", "client_admin"]);
    return { appAccess: context.appAccess };
  },
  component: SharedPage,
});

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const ago = (iso: string | null) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const KIND: Record<string, string> = {
  sos: "SOS", man_overboard: "Man overboard", off_route: "Off route", overdue: "Overdue", silent: "Gone silent", unexpected_stop: "Unexpected stop",
  checkin_missed: "Missed check-in", geofence_enter: "Entered zone", geofence_exit: "Left zone", curfew: "Moving in curfew", boarding_override: "Departed despite check", handoff: "Handed to responder",
};

function SharedPage() {
  const { id } = Route.useParams();
  const { appAccess } = Route.useRouteContext();
  const isManager = appAccess?.specRole === "security_manager";
  const fn = useServerFn(getSharedView);
  const q = useQuery({ queryKey: ["shared-view", id], queryFn: () => fn({ data: { id } }), refetchInterval: 30_000, retry: false });
  const importFn = useServerFn(importSharedCorridor);
  const imp = useMutation({ mutationFn: (corridor_id: string) => importFn({ data: { id, corridor_id } }), onSuccess: () => toast.success("Corridor copied into your organisation. Find it under Protected movement → Corridors."), onError: (e: Error) => toast.error(e.message) });

  if (q.isLoading) return <span className="row g8 t3"><Loader2 className="h-4 w-4 animate-spin" /> Opening the shared view…</span>;
  if (q.error || !q.data)
    return (
      <div className="col g12">
        <Link to="/app/links" className="b b-sm b-gh" style={{ alignSelf: "flex-start" }}><ArrowLeft size={14} /> Shared access</Link>
        <Notice tone="fail">{(q.error as Error)?.message || "Couldn't open this shared view."}</Notice>
      </div>
    );
  const v = q.data;
  const has = (s: string) => v.link.scopes.includes(s as any);
  const name = new Map([...v.vessels, ...v.people].map((s) => [s.id, s.name]));
  const openAlerts = v.alerts.filter((a) => !a.acknowledged);

  return (
    <div className="col g16">
      <div className="row g8 wrap">
        <Link to="/app/links" className="b b-sm b-gh"><ArrowLeft size={14} /> Shared access</Link>
        <span className="f1" />
        {q.isFetching && <Loader2 size={14} className="animate-spin t3" />}
        <span className="t3" style={{ fontSize: 12 }}>Updated {when(v.generated_at)} · refreshes every 30 s</span>
      </div>
      <PageHeader title={`Shared by ${v.link.owner_name}`} sub={`“${v.link.purpose}” · access until ${when(v.link.expires_at)}`} />
      <Notice tone="blue">{v.link.owner_name} can see that you opened this, and when. It's read-only.</Notice>

      <Panel title="Map">
        <SharedMap view={v} />
        <div className="row g12 wrap t3" style={{ fontSize: 12, marginTop: 8 }}>
          {has("vessels") && <span><Dot c="#4F8BFF" /> boat</span>}
          {has("people") && <span><Dot c="#7C5CFF" /> person</span>}
          {has("alerts") && <span><Dot c="#F2384B" /> open alert</span>}
          {has("search_rescue") && <span><Dot c="#E8590C" /> search plan, last known position</span>}
          {has("voyages") && <span>— voyage route</span>}
          {has("corridors") && <span>┄ corridor</span>}
        </div>
      </Panel>

      {has("alerts") && (
        <Panel title="Alerts, last 48 hours" meta={openAlerts.length ? `${openAlerts.length} open` : undefined}>
          {v.alerts.length === 0 ? <Empty>No alerts in the last 48 hours.</Empty> : (
            <div className="col g6" style={{ fontSize: 13 }}>
              {v.alerts.map((a) => (
                <div key={a.id} className="row g8 wrap">
                  <Status tone={a.acknowledged ? "off" : a.severity >= 4 ? "fail" : "warn"}>{KIND[a.kind] ?? a.kind}</Status>
                  <span>{a.subject_id ? name.get(a.subject_id) ?? "" : ""}</span>
                  <span className="t2">{a.message}</span>
                  <span className="f1" />
                  <span className="t3 mono" style={{ fontSize: 12 }}>{when(a.created_at)}{a.acknowledged ? " · handled" : ""}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      {has("search_rescue") && (
        <Panel title="Search and rescue">
          {v.sar.length === 0 ? <Empty>No search plans.</Empty> : (
            <div className="col g6" style={{ fontSize: 13 }}>
              {v.sar.map((c) => (
                <div key={c.id} className="row g8 wrap">
                  <Status tone={c.status === "active" ? "fail" : c.status === "found" ? "ok" : "off"}>{c.status === "active" ? "Active" : c.status === "found" ? "Found" : "Stood down"}</Status>
                  <b>{c.title}</b>
                  <span className="t2">{c.persons != null ? `${c.persons} ${c.persons === 1 ? "person" : "people"} · ` : ""}last known {c.lat.toFixed(5)}, {c.lng.toFixed(5)} at {when(c.lkp_at)}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      {has("voyages") && (
        <Panel title="Voyages">
          {v.voyages.length === 0 ? <Empty>No planned or active voyages.</Empty> : (
            <div className="col g6" style={{ fontSize: 13 }}>
              {v.voyages.map((x) => (
                <div key={x.id} className="row g8 wrap">
                  <Status tone={x.status === "underway" ? (x.off_route || x.overdue ? "fail" : "ok") : x.status === "planned" ? "blue" : "off"}>{x.status === "underway" ? "Underway" : x.status === "planned" ? "Planned" : x.status === "completed" ? "Arrived" : "Cancelled"}</Status>
                  <b>{x.name}</b>
                  {x.subject_id && <span className="t2">{name.get(x.subject_id) ?? ""}</span>}
                  {x.off_route && <span className="tg tg-fail">Off route</span>}
                  {x.overdue && <span className="tg tg-fail">Overdue</span>}
                  <span className="f1" />
                  <span className="t3" style={{ fontSize: 12 }}>
                    {x.departed_at ? `left ${when(x.departed_at)}` : `due out ${when(x.planned_departure)}`}
                    {x.departure_count != null ? ` · ${x.departure_count} aboard` : ""}
                    {x.arrived_at ? ` · arrived ${when(x.arrived_at)}${x.arrival_count != null ? `, ${x.arrival_count} off` : ""}` : x.planned_arrival ? ` · due in ${when(x.planned_arrival)}` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      {(has("vessels") || has("people")) && (
        <Panel title={has("vessels") && has("people") ? "Boats and people" : has("vessels") ? "Boats" : "People"}>
          {v.vessels.length + v.people.length === 0 ? <Empty>Nothing is being tracked.</Empty> : (
            <div className="col g6" style={{ fontSize: 13 }}>
              {v.vessels.map((s) => (
                <div key={s.id} className="row g8 wrap">
                  <b>{s.name}</b>
                  {s.reference && <span className="t3">{s.reference}</span>}
                  {s.mmsi && <span className="t3 mono">MMSI {s.mmsi}</span>}
                  {s.capacity != null && <span className="t3">licensed for {s.capacity}</span>}
                  <span className="f1" />
                  <span className="t2" style={{ fontSize: 12 }}>{s.lat == null ? "not tracking" : `${s.speed_kn ?? 0} kn · seen ${ago(s.seen_at)}`}</span>
                </div>
              ))}
              {v.people.map((s) => (
                <div key={s.id} className="row g8 wrap">
                  <b>{s.name}</b>
                  <span className="f1" />
                  <span className="t2" style={{ fontSize: 12 }}>{s.lat == null ? "not tracking" : `seen ${ago(s.seen_at)}`}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      {has("corridors") && (
        <Panel title="Corridors">
          {v.corridors.length === 0 ? <Empty>No corridors.</Empty> : (
            <div className="col g6" style={{ fontSize: 13 }}>
              {v.corridors.map((c) => (
                <div key={c.id} className="row g8 wrap">
                  <b>{c.name}</b>
                  <span className="t2">{c.corridor_m} m wide{c.curfew_start && c.curfew_end ? ` · curfew ${c.curfew_start.slice(0, 5)}–${c.curfew_end.slice(0, 5)}` : ""}{c.max_wind_kn ? ` · wind limit ${c.max_wind_kn} kn` : ""}</span>
                  <span className="f1" />
                  {isManager && <button type="button" className="b b-sm b-gh" disabled={imp.isPending} onClick={() => imp.mutate(c.id)}><Copy size={13} /> Copy to my organisation</button>}
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

function Dot({ c }: { c: string }) {
  return <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 9, background: c, verticalAlign: "middle", marginRight: 2 }} />;
}

function geo(v: SharedView) {
  const line = (coords: [number, number][], props: Record<string, unknown>) => ({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: coords } });
  const pt = (lng: number, lat: number, props: Record<string, unknown>) => ({ type: "Feature", properties: props, geometry: { type: "Point", coordinates: [lng, lat] } });
  return {
    lines: {
      type: "FeatureCollection",
      features: [
        ...v.corridors.filter((c) => c.route.length > 1).map((c) => line(c.route, { k: "corridor" })),
        ...v.voyages.filter((x) => x.route.length > 1 && x.status !== "cancelled").map((x) => line(x.route, { k: "voyage" })),
      ],
    },
    points: {
      type: "FeatureCollection",
      features: [
        ...v.sar.filter((c) => c.status === "active").map((c) => pt(c.lng, c.lat, { k: "sar", label: c.title })),
        ...v.alerts.filter((a) => !a.acknowledged && a.lat != null && a.lng != null).map((a) => pt(a.lng!, a.lat!, { k: "alert", label: KIND[a.kind] ?? a.kind })),
        ...v.vessels.filter((s) => s.lat != null && s.lng != null).map((s) => pt(s.lng!, s.lat!, { k: "vessel", label: s.name })),
        ...v.people.filter((s) => s.lat != null && s.lng != null).map((s) => pt(s.lng!, s.lat!, { k: "person", label: s.name })),
      ],
    },
  };
}

function SharedMap({ view }: { view: SharedView }) {
  const { data: tokenData } = useMapboxToken();
  const token = tokenData?.token ?? "";
  const el = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const fitted = useRef(false);
  const latest = useRef(view);
  latest.current = view;

  const fit = (map: mapboxgl.Map) => {
    const d = geo(latest.current) as any;
    const b = new mapboxgl.LngLatBounds();
    for (const f of d.points.features) b.extend(f.geometry.coordinates);
    for (const f of d.lines.features) for (const c of f.geometry.coordinates) b.extend(c);
    if (!b.isEmpty()) {
      map.fitBounds(b, { padding: 50, maxZoom: 13, duration: 0 });
      fitted.current = true;
    }
  };

  useEffect(() => {
    if (!token || !el.current) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({ container: el.current, ...basemapOptions("day"), center: [3.4, 6.45], zoom: 10 } as any);
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      const d = geo(latest.current) as any;
      map.addSource("lines", { type: "geojson", data: d.lines });
      map.addSource("points", { type: "geojson", data: d.points });
      map.addLayer({ id: "lines", type: "line", source: "lines", paint: { "line-color": ["match", ["get", "k"], "corridor", "#8A93A6", "#4F8BFF"], "line-width": ["match", ["get", "k"], "corridor", 3, 2], "line-dasharray": ["match", ["get", "k"], "corridor", ["literal", [2, 1.5]], ["literal", [1, 0]]] } });
      map.addLayer({
        id: "points",
        type: "circle",
        source: "points",
        paint: {
          "circle-radius": ["match", ["get", "k"], "sar", 8, "alert", 7, 6],
          "circle-color": ["match", ["get", "k"], "sar", "#E8590C", "alert", "#F2384B", "person", "#7C5CFF", "#4F8BFF"],
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({ id: "labels", type: "symbol", source: "points", layout: { "text-field": ["get", "label"], "text-size": 11, "text-offset": [0, 1.3], "text-anchor": "top" }, paint: { "text-color": "#1b2230", "text-halo-color": "#fff", "text-halo-width": 1.2 } });
      fit(map);
    });
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const d = geo(view) as any;
    (map.getSource("lines") as mapboxgl.GeoJSONSource | undefined)?.setData(d.lines);
    (map.getSource("points") as mapboxgl.GeoJSONSource | undefined)?.setData(d.points);
    if (!fitted.current) fit(map);
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!token) return <div className="t3" style={{ height: 420, display: "grid", placeItems: "center" }}>Loading map…</div>;
  return <div ref={el} className="map" style={{ height: 420, borderRadius: 8, overflow: "hidden" }} />;
}
