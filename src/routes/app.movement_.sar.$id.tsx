import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Printer, Save } from "lucide-react";
import { requireSectionAccess } from "@/lib/rbac";
import { basemapOptions } from "@/lib/basemap";
import { useMapboxToken } from "@/components/LocationPicker";
import { Notice, PageHeader, Panel, Status } from "@/components/nw";
import { closeSarCase, getSarPlan, updateSarCase, type SarCase, type SarPlan } from "@/lib/sar.functions";
import { movementPerms } from "@/components/movement/perms";

export const Route = createFileRoute("/app/movement_/sar/$id")({
  head: () => ({ meta: [{ title: "Search and rescue plan · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    requireSectionAccess(context.appAccess, ["security_manager", "operator", "client_admin"]);
    return { appAccess: context.appAccess };
  },
  component: SarPage,
});

const OBJECTS: Record<SarCase["object_type"], string> = {
  person_in_water: "Person in the water",
  person_with_lifejacket: "Person in a life jacket",
  life_raft: "Life raft",
  small_boat: "Small open boat",
  disabled_powerboat: "Disabled powerboat",
  canoe: "Canoe or dugout",
};
const NM = 1852;
const when = (ms: number | string) => new Date(ms).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
function dms(v: number, pos: string, neg: string) {
  const a = Math.abs(v);
  const d = Math.floor(a);
  const m = (a - d) * 60;
  return `${d}°${m.toFixed(3).padStart(6, "0")}′${v >= 0 ? pos : neg}`;
}
const pos = ([lng, lat]: [number, number]) => `${dms(lat, "N", "S")} ${dms(lng, "E", "W")}`;
const dec = ([lng, lat]: [number, number]) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
const toLocal = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function SarPage() {
  const { id } = Route.useParams();
  const { appAccess } = Route.useRouteContext();
  const { canOperate } = movementPerms(appAccess?.specRole);
  const fn = useServerFn(getSarPlan);
  const [focusHours, setFocusHours] = useState(0);
  const [spacing, setSpacing] = useState<number | null>(null);
  const [speed, setSpeed] = useState(15);
  const q = useQuery({
    queryKey: ["sar-plan", id, focusHours, spacing],
    queryFn: () => fn({ data: { id, focus_hours: focusHours, spacing_nm: spacing } }),
    placeholderData: keepPreviousData,
    refetchInterval: 5 * 60_000,
  });

  if (q.isLoading) return <span className="row g8 t3"><Loader2 className="h-4 w-4 animate-spin" /> Running the drift model…</span>;
  if (q.error || !q.data) return <Notice tone="fail">{(q.error as Error)?.message || "Couldn't load this plan."}</Notice>;
  const p = q.data;
  const c = p.case;
  const f = p.snapshots[p.focus];
  const lkp: [number, number] = [c.lkp_lng, c.lkp_lat];
  const hours = p.pattern.trackNm / Math.max(speed, 1);
  const end = c.closed_at ? Date.parse(c.closed_at) : Date.now();

  return (
    <div className="col g16 sar-plan">
      <style>{`@media print {
        aside, nav, header, .no-print { display: none !important; }
        body, .sar-plan { background: #fff !important; color: #000 !important; }
        .sar-plan * { color: #000 !important; border-color: #bbb !important; background: transparent !important; }
        .sar-plan .map { break-inside: avoid; }
      }`}</style>
      <div className="row g8 wrap no-print">
        <Link to="/app/movement" className="b b-sm b-gh"><ArrowLeft size={14} /> Protected movement</Link>
        <span className="f1" />
        <button type="button" className="b b-sm b-pri" onClick={() => window.print()}><Printer size={14} /> Rescue package (print or PDF)</button>
      </div>
      <PageHeader title={c.title} sub={`Search and rescue plan · ${p.organisation} · started ${when(c.created_at)} by ${c.created_by_name ?? "—"}`} />
      <div className="row g8 wrap">
        <Status tone={c.status === "active" ? "fail" : c.status === "found" ? "ok" : "off"}>{c.status === "active" ? "Search active" : c.status === "found" ? "Found" : "Stood down"}</Status>
        <span className="t2" style={{ fontSize: 13 }}>{OBJECTS[c.object_type]}{c.persons != null ? ` · ${c.persons} ${c.persons === 1 ? "person" : "people"}` : ""} · adrift {f.hoursAdrift < 1 ? `${Math.round(f.hoursAdrift * 60)} min` : `${f.hoursAdrift.toFixed(1)} h`} at the selected time</span>
      </div>

      <Notice tone="warn">
        A first estimate to start searching quickly, not a replacement for the rescue centre's own planning. Wind: MET Norway forecast at the last known position{p.wind.hours ? "" : " (unavailable — no wind applied)"}. Current: {c.current_kn != null ? `${c.current_kn} kn toward ${c.current_toward_deg}° as entered` : "unknown, so up to 0.5 kn in any direction is allowed for"}. Shorelines aren't modelled.
      </Notice>

      <div className="row g6 wrap no-print" role="group" aria-label="Time">
        {p.snapshots.map((s, i) => {
          const h = Math.round((s.at - end) / 3_600_000);
          const value = s.label === "Last known" ? null : s.label === "Now" || s.label === "Closed" ? 0 : h;
          return (
            <button key={i} type="button" className={`b b-sm ${i === p.focus ? "b-pri" : "b-gh"}`} disabled={value == null} onClick={() => value != null && setFocusHours(value)}>
              {s.label}{s.label !== "Last known" ? ` · ${when(s.at).split(", ")[1] ?? ""}` : ""}
            </button>
          );
        })}
        {q.isFetching && <Loader2 size={14} className="animate-spin t3" />}
      </div>

      <div className="grid g16" style={{ gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr)" }}>
        <Panel title={`Search area · ${f.label}`} meta={when(f.at)}>
          <SarMap plan={p} />
          <div className="row g12 wrap t3" style={{ fontSize: 12, marginTop: 8 }}>
            <span><Swatch c="#E8590C" /> 90% area</span>
            <span><Swatch c="#F2384B" /> 50% area</span>
            <span><Swatch c="#4F8BFF" /> Search pattern</span>
            <span>● last known position · ◆ datum (most likely position)</span>
          </div>
        </Panel>
        <div className="col g16">
          <Panel title="Where to search">
            <div className="col g6" style={{ fontSize: 13 }}>
              <KV k="Last known position" v={<>{pos(lkp)}<br /><span className="t3 mono">{dec(lkp)}</span> · {when(c.lkp_at)} · ±{c.lkp_error_m} m</>} />
              <KV k={`Datum (${f.label.toLowerCase()})`} v={<>{pos(f.datum)}<br /><span className="t3 mono">{dec(f.datum)}</span></>} />
              <KV k="Drift so far" v={`${(dist(lkp, f.datum) / 1000).toFixed(2)} km toward ${Math.round(bearing(lkp, f.datum))}°`} />
              <KV k="90% area" v={`${f.areaKm2_90.toFixed(1)} km² (${(f.areaKm2_90 / 3.43).toFixed(1)} nm²) · ${(f.axes90.majorM / NM).toFixed(1)} × ${(f.axes90.minorM / NM).toFixed(1)} nm, long axis ${Math.round(f.axes90.bearingDeg)}°`} />
              {p.wind.nowKn != null && <KV k="Wind now" v={`${p.wind.nowKn} kn from ${p.wind.nowFromDeg}°`} />}
            </div>
          </Panel>
          <Panel title="Search pattern">
            <div className="col g8" style={{ fontSize: 13 }}>
              <b>{p.pattern.kind === "expanding_square" ? "Expanding square" : "Parallel sweep"}</b>
              <span className="t2">{p.pattern.coverage}.</span>
              <div className="grid g10 no-print" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <label className="fl"><span>Track spacing (nm)</span>
                  <select className="in" value={spacing ?? p.pattern.spacingNm} onChange={(e) => setSpacing(Number(e.target.value))}>
                    {[0.1, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
                <label className="fl"><span>Search speed (kn)</span><input className="in" inputMode="numeric" value={speed} onChange={(e) => setSpeed(Number(e.target.value.replace(/\D/g, "").slice(0, 2)) || 0)} /></label>
              </div>
              <span>{p.pattern.waypoints.length} waypoints · {p.pattern.trackNm.toFixed(1)} nm of track · about {hours < 1 ? `${Math.round(hours * 60)} min` : `${hours.toFixed(1)} h`} at {speed} kn</span>
              <span className="t3" style={{ fontSize: 12 }}>Default spacing for a {p.object.label.toLowerCase()} is {p.object.sweepNm} nm in fair daylight. Reduce it at night, in rain or in rough water.</span>
            </div>
          </Panel>
        </div>
      </div>

      <Panel title="Waypoints" meta={p.pattern.waypoints.length}>
        <div className="col" style={{ fontSize: 12.5, columns: "2 280px" }}>
          {p.pattern.waypoints.map((w, i) => (
            <span key={i} className="mono" style={{ breakInside: "avoid" }}>{String(i + 1).padStart(2, "0")}  {pos(w)}  <span className="t3">({dec(w)})</span></span>
          ))}
        </div>
      </Panel>

      <Panel title="How the area grows">
        <div className="col g4" style={{ fontSize: 12.5 }}>
          {p.snapshots.map((s, i) => (
            <div key={i} className="row g10">
              <span style={{ width: 90 }}>{s.label}</span>
              <span className="mono t3" style={{ width: 110 }}>{when(s.at)}</span>
              <span className="f1">{s.areaKm2_90.toFixed(1)} km² · datum {dec(s.datum)}</span>
            </div>
          ))}
          <span className="t3" style={{ fontSize: 12 }}>Every hour of delay makes the area larger. Start searching at the datum and work outward.</span>
        </div>
      </Panel>

      {canOperate && c.status === "active" && <SarInputs c={c} />}
      {c.status !== "active" && c.outcome && <Panel title="Outcome"><span style={{ fontSize: 13 }}>{c.outcome} · closed {c.closed_at ? when(c.closed_at) : ""}</span></Panel>}
      <span className="t3" style={{ fontSize: 12 }}>Generated {when(p.generated_at)} Lagos time from the Lemtik record. Pass this to the Maritime Rescue Coordination Centre together with your own contact details and the persons-aboard list.</span>
    </div>
  );
}

function SarInputs({ c }: { c: SarCase }) {
  const qc = useQueryClient();
  const save = useServerFn(updateSarCase);
  const close = useServerFn(closeSarCase);
  const [f, setF] = useState({
    object_type: c.object_type,
    persons: c.persons != null ? String(c.persons) : "",
    lat: String(c.lkp_lat),
    lng: String(c.lkp_lng),
    at: toLocal(c.lkp_at),
    err: String(c.lkp_error_m),
    cur: c.current_kn != null ? String(c.current_kn) : "",
    dir: c.current_toward_deg != null ? String(c.current_toward_deg) : "",
    notes: c.notes ?? "",
  });
  const [outcome, setOutcome] = useState("");
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["sar-plan", c.id] });
    qc.invalidateQueries({ queryKey: ["sar-cases"] });
  };
  const m = useMutation({
    mutationFn: () =>
      save({
        data: {
          id: c.id,
          object_type: f.object_type,
          persons: f.persons ? Number(f.persons) : null,
          lkp_lat: Number(f.lat),
          lkp_lng: Number(f.lng),
          lkp_at: new Date(f.at).toISOString(),
          lkp_error_m: Number(f.err) || 100,
          current_kn: f.cur !== "" && f.dir !== "" ? Number(f.cur) : null,
          current_toward_deg: f.cur !== "" && f.dir !== "" ? Number(f.dir) : null,
          notes: f.notes || null,
        },
      }),
    onSuccess: () => { toast.success("Plan updated"); refresh(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const cl = useMutation({
    mutationFn: (status: "found" | "stood_down") => close({ data: { id: c.id, status, outcome } }),
    onSuccess: () => { toast.success("Plan closed"); refresh(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const bad = !Number.isFinite(Number(f.lat)) || !Number.isFinite(Number(f.lng)) || !f.at;

  return (
    <Panel title="Adjust the plan" className="no-print">
      <form className="col g10" onSubmit={(e) => { e.preventDefault(); if (!bad) m.mutate(); }}>
        <div className="grid g10" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
          <label className="fl"><span>What's adrift</span>
            <select className="in" value={f.object_type} onChange={(e) => setF({ ...f, object_type: e.target.value as SarCase["object_type"] })}>
              {Object.entries(OBJECTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="fl"><span>People</span><input className="in" inputMode="numeric" value={f.persons} onChange={(e) => setF({ ...f, persons: e.target.value.replace(/\D/g, "").slice(0, 4) })} /></label>
          <label className="fl"><span>Last known latitude</span><input className="in mono" value={f.lat} onChange={(e) => setF({ ...f, lat: e.target.value })} /></label>
          <label className="fl"><span>Last known longitude</span><input className="in mono" value={f.lng} onChange={(e) => setF({ ...f, lng: e.target.value })} /></label>
          <label className="fl"><span>Last known time</span><input type="datetime-local" className="in" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} /></label>
          <label className="fl"><span>Position accuracy (± m)</span><input className="in" inputMode="numeric" value={f.err} onChange={(e) => setF({ ...f, err: e.target.value.replace(/\D/g, "").slice(0, 5) })} /></label>
          <label className="fl"><span>Current (kn), if known</span><input className="in" inputMode="decimal" value={f.cur} onChange={(e) => setF({ ...f, cur: e.target.value.replace(/[^\d.]/g, "").slice(0, 4) })} placeholder="e.g. 0.8" /></label>
          <label className="fl"><span>Current flowing toward (°)</span><input className="in" inputMode="numeric" value={f.dir} onChange={(e) => setF({ ...f, dir: e.target.value.replace(/\D/g, "").slice(0, 3) })} placeholder="e.g. 250 on the ebb" /></label>
        </div>
        <span className="t3" style={{ fontSize: 12 }}>Local knowledge of the tide and river flow makes the biggest difference. Enter both current fields, or leave both empty.</span>
        <label className="fl"><span>Notes</span><textarea className="in" rows={2} maxLength={2000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Last seen wearing, colour of boat, assets searching" /></label>
        <button type="submit" className="b b-pri" style={{ alignSelf: "flex-start" }} disabled={m.isPending || bad}>{m.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Update and re-run</button>
        <div className="col g6" style={{ borderTop: "1px solid var(--line-1)", paddingTop: 10 }}>
          <label className="fl"><span>Close the search</span><input className="in" value={outcome} onChange={(e) => setOutcome(e.target.value)} maxLength={2000} placeholder="What happened, e.g. Recovered alive by Marine Police at 16:40" /></label>
          <div className="row g8">
            <button type="button" className="b b-sm b-sec" disabled={outcome.trim().length < 3 || cl.isPending} onClick={() => cl.mutate("found")}>Found</button>
            <button type="button" className="b b-sm b-gh" disabled={outcome.trim().length < 3 || cl.isPending} onClick={() => cl.mutate("stood_down")}>Stand down</button>
          </div>
        </div>
      </form>
    </Panel>
  );
}

function SarMap({ plan }: { plan: SarPlan }) {
  const { data: tokenData } = useMapboxToken();
  const token = tokenData?.token ?? "";
  const el = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const f = plan.snapshots[plan.focus];
  const lkp: [number, number] = [plan.case.lkp_lng, plan.case.lkp_lat];

  const data = () => ({
    e90: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [f.ellipse90] } },
    e50: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [f.ellipse50] } },
    pts: { type: "FeatureCollection", features: f.sample.map((c) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c } })) },
    path: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: plan.pattern.waypoints } },
    drift: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: plan.snapshots.map((s) => s.datum) } },
    marks: {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { k: "lkp" }, geometry: { type: "Point", coordinates: lkp } },
        { type: "Feature", properties: { k: "datum" }, geometry: { type: "Point", coordinates: f.datum } },
      ],
    },
  });

  useEffect(() => {
    if (!token || !el.current) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({ container: el.current, ...basemapOptions("day"), center: f.datum, zoom: 11, preserveDrawingBuffer: true } as any);
    mapRef.current = map;
    map.on("load", () => {
      const d = data() as any;
      for (const k of Object.keys(d)) map.addSource(k, { type: "geojson", data: d[k] });
      map.addLayer({ id: "e90", type: "fill", source: "e90", paint: { "fill-color": "#E8590C", "fill-opacity": 0.15 } });
      map.addLayer({ id: "e90l", type: "line", source: "e90", paint: { "line-color": "#E8590C", "line-width": 2 } });
      map.addLayer({ id: "e50l", type: "line", source: "e50", paint: { "line-color": "#F2384B", "line-width": 2, "line-dasharray": [2, 1] } });
      map.addLayer({ id: "pts", type: "circle", source: "pts", paint: { "circle-radius": 1.6, "circle-color": "#E8590C", "circle-opacity": 0.5 } });
      map.addLayer({ id: "drift", type: "line", source: "drift", paint: { "line-color": "#8A93A6", "line-width": 1.5, "line-dasharray": [1, 1.5] } });
      map.addLayer({ id: "path", type: "line", source: "path", paint: { "line-color": "#4F8BFF", "line-width": 2 } });
      map.addLayer({ id: "marks", type: "circle", source: "marks", paint: { "circle-radius": ["match", ["get", "k"], "lkp", 6, 5], "circle-color": ["match", ["get", "k"], "lkp", "#111", "#F2384B"], "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
      fit(map);
    });
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !map.getSource("e90")) return;
    const d = data() as any;
    for (const k of Object.keys(d)) (map.getSource(k) as mapboxgl.GeoJSONSource).setData(d[k]);
    fit(map);
  }, [plan]); // eslint-disable-line react-hooks/exhaustive-deps

  function fit(map: mapboxgl.Map) {
    const b = new mapboxgl.LngLatBounds(lkp, lkp);
    f.ellipse90.forEach((c) => b.extend(c));
    plan.pattern.waypoints.forEach((c) => b.extend(c));
    map.fitBounds(b, { padding: 40, maxZoom: 15, duration: 0 });
  }

  return (
    <div className="map" style={{ height: 440, position: "relative" }}>
      <div ref={el} style={{ position: "absolute", inset: 0 }} />
      {!token && <div className="absolute inset-0 grid place-items-center t3"><Loader2 className="h-5 w-5 animate-spin" /></div>}
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="row g10" style={{ alignItems: "baseline" }}>
      <span className="t3" style={{ width: 130, flex: "none" }}>{k}</span>
      <span className="f1" style={{ minWidth: 0 }}>{v}</span>
    </div>
  );
}
const Swatch = ({ c }: { c: string }) => <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: c, verticalAlign: -1 }} />;

function dist(a: [number, number], b: [number, number]) {
  const r = (v: number) => (v * Math.PI) / 180;
  const h = Math.sin(r(b[1] - a[1]) / 2) ** 2 + Math.cos(r(a[1])) * Math.cos(r(b[1])) * Math.sin(r(b[0] - a[0]) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}
function bearing(a: [number, number], b: [number, number]) {
  const r = (v: number) => (v * Math.PI) / 180;
  const y = Math.sin(r(b[0] - a[0])) * Math.cos(r(b[1]));
  const x = Math.cos(r(a[1])) * Math.sin(r(b[1])) - Math.sin(r(a[1])) * Math.cos(r(b[1])) * Math.cos(r(b[0] - a[0]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
