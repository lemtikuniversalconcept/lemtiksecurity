import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { CheckCircle2, Loader2, MapPin, Phone, Ship } from "lucide-react";
import { LemtikMark, Notice } from "@/components/nw";
import { basemapOptions } from "@/lib/basemap";
import { useMapboxToken } from "@/components/LocationPicker";
import { getResponderView, postResponderUpdate, RESPONDER_STATUS, RESPONDER_STATUS_LABEL, type ResponderView } from "@/lib/respond.functions";

/** Responder page: opened from the hand-off message. No account needed; the link expires and can be withdrawn. */
export const Route = createFileRoute("/respond/$token")({
  head: () => ({ meta: [{ title: "Emergency hand-off · Lemtik" }, { name: "robots", content: "noindex" }, { name: "theme-color", content: "#0A0C10" }] }),
  component: RespondPage,
});

const NAME_KEY = "lemtik.respond.name";
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
};
const BUTTON: Record<string, string> = { acknowledged: "We've received this", dispatched: "Unit dispatched", on_scene: "We're on scene", resolved: "Resolved" };

function RespondPage() {
  const { token } = Route.useParams();
  const viewFn = useServerFn(getResponderView);
  const postFn = useServerFn(postResponderUpdate);
  const q = useQuery({ queryKey: ["respond", token], queryFn: () => viewFn({ data: { token } }), refetchInterval: 20_000, retry: false });
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    try { setName(localStorage.getItem(NAME_KEY) ?? ""); } catch { /* storage unavailable */ }
  }, []);
  const saveName = (v: string) => {
    setName(v);
    try { localStorage.setItem(NAME_KEY, v); } catch { /* storage unavailable */ }
  };
  const post = useMutation({
    mutationFn: (status: (typeof RESPONDER_STATUS)[number] | "note") => postFn({ data: { token, status, by_name: name.trim(), note: status === "note" ? note.trim() : undefined } }),
    onSuccess: (_r, status) => {
      setErr(null);
      if (status === "note") setNote("");
      q.refetch();
    },
    onError: (e) => setErr((e as Error).message),
  });

  const v = q.data;
  return (
    <main style={{ minHeight: "100vh", background: "var(--bg, #0A0C10)", padding: "20px 16px" }}>
      <div className="col g16" style={{ maxWidth: 720, margin: "0 auto" }}>
        <div className="row g8" style={{ alignItems: "center" }}><LemtikMark /><span className="t3" style={{ fontSize: 12 }}>Emergency hand-off</span></div>
        {q.isLoading ? (
          <span className="row g8 t3"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</span>
        ) : !v || !v.found ? (
          <Notice tone="fail">
            {v?.reason === "withdrawn" ? `${v.operator || "The operator"} has withdrawn this link.` : v?.reason === "expired" ? `This link has expired. Contact ${v.operator || "the operator"} for an update.` : "This link isn't valid."}
          </Notice>
        ) : (
          <Body v={v} name={name} setName={saveName} note={note} setNote={setNote} post={(s) => { if (name.trim().length < 2) { setErr("Enter your name and unit first."); return; } post.mutate(s); }} busy={post.isPending} err={err} />
        )}
      </div>
    </main>
  );
}

function Body({ v, name, setName, note, setNote, post, busy, err }: {
  v: Extract<ResponderView, { found: true }>;
  name: string; setName: (s: string) => void; note: string; setNote: (s: string) => void;
  post: (s: (typeof RESPONDER_STATUS)[number] | "note") => void; busy: boolean; err: string | null;
}) {
  const b = v.boat;
  const order = ["sent", ...RESPONDER_STATUS] as string[];
  const next = RESPONDER_STATUS.filter((s) => order.indexOf(s) > order.indexOf(v.status));
  const done = v.status === "resolved";
  return (
    <>
      <div className="pn col g6" style={{ padding: 14, borderColor: "var(--fail, #F2384B)" }}>
        <span className="row g8" style={{ alignItems: "center" }}><Ship size={16} /><b>{b?.name ?? "Unknown"}</b>{b?.reference ? <span className="mono t3">{b.reference}</span> : null}{b?.mmsi ? <span className="mono t3">MMSI {b.mmsi}</span> : null}</span>
        <span className="t2" style={{ fontSize: 13 }}>Handed off by <b>{v.operator}</b> to <b>{v.responder_name}</b> at {when(v.sent_at)}</span>
        {b?.lat != null && b.lng != null ? (
          <span className="row g8 wrap" style={{ fontSize: 13 }}>
            <MapPin size={14} /> <span className="mono">{b.lat.toFixed(5)}, {b.lng.toFixed(5)}</span>
            {b.last_seen_at ? <span className="t3">last seen {ago(b.last_seen_at)}{b.speed_kn != null ? ` · ${b.speed_kn} kn` : ""}</span> : null}
            <a className="b b-sec" style={{ padding: "2px 8px", fontSize: 12 }} href={`https://maps.google.com/?q=${b.lat.toFixed(5)},${b.lng.toFixed(5)}`} target="_blank" rel="noopener noreferrer">Open in Google Maps</a>
          </span>
        ) : <span className="t3" style={{ fontSize: 13 }}>No position on record.</span>}
        {v.voyage ? (
          <span style={{ fontSize: 13 }}>
            Voyage "{v.voyage.name}"{v.voyage.departed_at ? `, departed ${when(v.voyage.departed_at)}` : ""}{v.voyage.planned_arrival ? `, due ${when(v.voyage.planned_arrival)}` : ""}
            {v.voyage.aboard != null ? <> · <b>{v.voyage.aboard} people aboard</b> at departure</> : null}
          </span>
        ) : null}
        <span className="row g8" style={{ fontSize: 13 }}>
          <Phone size={14} /> Operator contact: {v.operator_contact.name}
          {v.operator_contact.phone ? <a href={`tel:${v.operator_contact.phone.replace(/[^\d+]/g, "")}`}>{v.operator_contact.phone}</a> : <span className="t3">(no number on record; reply on the channel this link came by)</span>}
        </span>
      </div>

      <TrackMap v={v} />

      <div className="pn col g10" style={{ padding: 14 }}>
        <b>Status: {RESPONDER_STATUS_LABEL[v.status] ?? v.status}</b>
        {done ? (
          <Notice tone="ok">Marked resolved. Thank you. {v.operator} has been told.</Notice>
        ) : (
          <>
            <label className="fl"><span>Your name and unit</span><input className="in" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="e.g. Lt. Bello, Marine Police Ikoyi" autoComplete="name" /></label>
            <div className="row g8 wrap">
              {next.map((s, i) => (
                <button key={s} type="button" className={i === 0 ? "b b-pri" : "b b-sec"} disabled={busy} onClick={() => post(s)}>
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} {BUTTON[s]}
                </button>
              ))}
            </div>
            <label className="fl"><span>Note to the operator (optional)</span><textarea className="in" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Boat sighted 2 km south of the jetty, heading east" /></label>
            <button type="button" className="b b-sec" disabled={busy || note.trim().length < 2} onClick={() => post("note")}>Send note</button>
          </>
        )}
        {err ? <Notice tone="fail">{err}</Notice> : null}
      </div>

      {v.alerts.length > 0 && (
        <div className="col g4" style={{ fontSize: 13 }}>
          <b>What the operator's system has seen</b>
          {v.alerts.map((a, i) => <span key={i} className="t2">{when(a.at)} · {a.message}</span>)}
        </div>
      )}
      {v.updates.length > 0 && (
        <div className="col g4" style={{ fontSize: 13 }}>
          <b>Updates</b>
          {v.updates.map((u, i) => <span key={i} className="t2">{when(u.at)} · {RESPONDER_STATUS_LABEL[u.status] ?? u.status} · {u.by_name}{u.note ? `: ${u.note}` : ""}</span>)}
        </div>
      )}
      <details style={{ fontSize: 13 }}>
        <summary className="t3">Original message</summary>
        <pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{v.message}</pre>
      </details>
      <p className="t3" style={{ fontSize: 12 }}>
        This page refreshes every 20 seconds. {v.expires_at ? `The link works until ${when(v.expires_at)}` : "The link works until the operator withdraws it"}. Your name and the updates you send are shared with {v.operator} and kept in their record of the incident.
      </p>
    </>
  );
}

function TrackMap({ v }: { v: Extract<ResponderView, { found: true }> }) {
  const { data: tokenData } = useMapboxToken();
  const token = tokenData?.token ?? "";
  const el = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const latest = useRef(v);
  latest.current = v;
  const fitted = useRef(false);

  const geo = (x: typeof v) => ({
    route: { type: "FeatureCollection", features: x.voyage && x.voyage.route.length > 1 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: x.voyage.route } }] : [] },
    track: { type: "FeatureCollection", features: x.track.length > 1 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: x.track.map((p) => [p.lng, p.lat]) } }] : [] },
    boat: { type: "FeatureCollection", features: x.boat?.lat != null && x.boat.lng != null ? [{ type: "Feature", properties: { label: x.boat.name }, geometry: { type: "Point", coordinates: [x.boat.lng, x.boat.lat] } }] : [] },
  });
  const fit = (map: mapboxgl.Map) => {
    const x = latest.current;
    const b = new mapboxgl.LngLatBounds();
    for (const p of x.track) b.extend([p.lng, p.lat]);
    if (x.boat?.lat != null && x.boat.lng != null) b.extend([x.boat.lng, x.boat.lat]);
    if (!b.isEmpty()) {
      map.fitBounds(b, { padding: 50, maxZoom: 14, duration: 0 });
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
      map.addSource("route", { type: "geojson", data: d.route });
      map.addSource("track", { type: "geojson", data: d.track });
      map.addSource("boat", { type: "geojson", data: d.boat });
      map.addLayer({ id: "route", type: "line", source: "route", paint: { "line-color": "#8A93A6", "line-width": 3, "line-dasharray": [2, 1.5] } });
      map.addLayer({ id: "track", type: "line", source: "track", paint: { "line-color": "#4F8BFF", "line-width": 3 } });
      map.addLayer({ id: "boat", type: "circle", source: "boat", paint: { "circle-radius": 8, "circle-color": "#F2384B", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
      map.addLayer({ id: "boat-label", type: "symbol", source: "boat", layout: { "text-field": ["get", "label"], "text-size": 12, "text-offset": [0, 1.4], "text-anchor": "top" }, paint: { "text-color": "#1b2230", "text-halo-color": "#fff", "text-halo-width": 1.2 } });
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
    const d = geo(v) as any;
    (map.getSource("route") as mapboxgl.GeoJSONSource | undefined)?.setData(d.route);
    (map.getSource("track") as mapboxgl.GeoJSONSource | undefined)?.setData(d.track);
    (map.getSource("boat") as mapboxgl.GeoJSONSource | undefined)?.setData(d.boat);
    if (!fitted.current) fit(map);
  }, [v]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!token) return null;
  return (
    <div className="col g4">
      <div ref={el} style={{ height: 340, borderRadius: 8, overflow: "hidden" }} />
      <span className="t3" style={{ fontSize: 12 }}>Red: last position. Blue: track from 30 minutes before the hand-off. Grey dashes: planned route.</span>
    </div>
  );
}
