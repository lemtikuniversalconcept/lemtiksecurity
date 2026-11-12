import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { CheckCircle2, FileText, Loader2 } from "lucide-react";
import { Notice } from "@/components/nw";
import { basemapOptions } from "@/lib/basemap";
import { useMapboxToken } from "@/components/LocationPicker";
import type { SharedRecord } from "@/lib/shares.server";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const KIND: Record<string, string> = { incident: "Incident", voyage: "Voyage", movement_alert: "Alert" };

/** What a recipient sees for a shared record, on the link page and inside the app. */
export function SharedRecordView({ r, onAck, ackBusy, ackErr, needName }: { r: SharedRecord; onAck: (name: string, note: string) => void; ackBusy: boolean; ackErr: string | null; needName: boolean }) {
  const s = r.share;
  return (
    <div className="col g16">
      <div className="col g4">
        <span className="t3" style={{ fontSize: 12 }}>{KIND[s.record_kind]} shared by {s.owner}{s.shared_by ? ` (${s.shared_by})` : ""}</span>
        <h1 className="ph1" style={{ fontSize: 21 }}>{s.record_label}</h1>
        <span className="t3" style={{ fontSize: 12.5 }}>Why: {s.purpose} · available until {when(s.expires_at)}{s.owner_contact ? ` · contact ${s.owner_contact}` : ""}</span>
      </div>

      <Ack s={s} onAck={onAck} busy={ackBusy} err={ackErr} needName={needName} />

      <section className="card col g6" style={{ padding: 14 }}>
        <b style={{ fontSize: 13.5 }}>Details</b>
        <dl className="grid g8" style={{ gridTemplateColumns: "minmax(120px, max-content) 1fr", fontSize: 13, margin: 0 }}>
          {r.facts.map((f, i) => (
            <div key={i} style={{ display: "contents" }}>
              <dt className="t3">{f.label}</dt>
              <dd style={{ margin: 0, whiteSpace: "pre-wrap" }}>{f.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {(r.point || r.track.length > 1 || r.route.length > 1) && <SharedMap r={r} />}

      {r.timeline.length > 0 && (
        <section className="card col g6" style={{ padding: 14 }}>
          <b style={{ fontSize: 13.5 }}>Timeline</b>
          <ol className="col g4" style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 13 }}>
            {r.timeline.map((t, i) => (
              <li key={i} className="row g10"><span className="t3 mono" style={{ fontSize: 12, minWidth: 128 }}>{when(t.at)}</span><span>{t.text}</span></li>
            ))}
          </ol>
        </section>
      )}

      {r.people.length > 0 && (
        <section className="card col g6" style={{ padding: 14 }}>
          <b style={{ fontSize: 13.5 }}>People</b>
          <span className="t3" style={{ fontSize: 12 }}>Personal details. Use them only for the purpose above.</span>
          <dl className="grid g6" style={{ gridTemplateColumns: "minmax(120px, max-content) 1fr", fontSize: 13, margin: 0 }}>
            {r.people.map((p, i) => (
              <div key={i} style={{ display: "contents" }}><dt className="t3">{p.label}</dt><dd style={{ margin: 0 }}>{p.value}</dd></div>
            ))}
          </dl>
        </section>
      )}

      {s.scopes.includes("evidence") && (
        <section className="card col g6" style={{ padding: 14 }}>
          <b style={{ fontSize: 13.5 }}>Evidence</b>
          {r.evidence.length === 0 ? (
            <span className="t3" style={{ fontSize: 13 }}>No files attached.</span>
          ) : (
            <>
              <span className="t3" style={{ fontSize: 12 }}>File links work for 15 minutes. Reload the page for fresh ones.</span>
              {r.evidence.map((e, i) => (
                <div key={i} className="row g8" style={{ fontSize: 13 }}>
                  <FileText size={14} />
                  {e.url ? <a href={e.url} target="_blank" rel="noreferrer" className="hover:underline">{e.name}</a> : <span>{e.name} <span className="t3">(unavailable)</span></span>}
                  <span className="t3">{e.kind}</span>
                </div>
              ))}
            </>
          )}
        </section>
      )}

      <span className="t3" style={{ fontSize: 11.5 }}>Prepared {when(r.generated_at)}. {s.owner} can see when this was opened and can withdraw it at any time.</span>
    </div>
  );
}

const NAME_KEY = "lemtik.shared.name";

function Ack({ s, onAck, busy, err, needName }: { s: SharedRecord["share"]; onAck: (name: string, note: string) => void; busy: boolean; err: string | null; needName: boolean }) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!needName) return;
    try { setName(localStorage.getItem(NAME_KEY) ?? ""); } catch { /* storage unavailable */ }
  }, [needName]);
  if (s.acknowledged_at) {
    return (
      <Notice tone="ok">
        <span className="row g6" style={{ alignItems: "center" }}><CheckCircle2 size={15} /> Acknowledged by {s.acknowledged_by_name} on {when(s.acknowledged_at)}.{s.ack_note ? ` Note: “${s.ack_note}”` : ""}</span>
      </Notice>
    );
  }
  return (
    <form
      className="card col g8"
      style={{ padding: 14, borderColor: "var(--s4, #E8590C)" }}
      onSubmit={(e) => {
        e.preventDefault();
        if (needName) try { localStorage.setItem(NAME_KEY, name.trim()); } catch { /* storage unavailable */ }
        onAck(name.trim(), note.trim());
      }}
    >
      <b style={{ fontSize: 13.5 }}>Confirm you've received this</b>
      <span className="t3" style={{ fontSize: 12.5 }}>{s.owner} is told who acknowledged it and when.</span>
      {needName && <label className="fl"><span>Your name and unit</span><input className="in" value={name} required minLength={2} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. Insp. Bello, Marine Police Ikoyi" /></label>}
      <label className="fl"><span>Note (optional)</span><input className="in" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Case opened, ref MP/IK/2211" /></label>
      {err && <span style={{ color: "var(--s5, #F2384B)", fontSize: 12.5 }}>{err}</span>}
      <button type="submit" className="b b-sm b-pri" style={{ alignSelf: "flex-start" }} disabled={busy || (needName && name.trim().length < 2)}>
        {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Acknowledge
      </button>
    </form>
  );
}

function SharedMap({ r }: { r: SharedRecord }) {
  const { data: tokenData } = useMapboxToken();
  const token = tokenData?.token ?? "";
  const el = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!token || !el.current) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({ container: el.current, ...basemapOptions("day"), center: r.point ? [r.point.lng, r.point.lat] : [3.4, 6.45], zoom: 12 } as any);
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      const line = (c: [number, number][]) => ({ type: "FeatureCollection", features: c.length > 1 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: c } }] : [] }) as any;
      map.addSource("route", { type: "geojson", data: line(r.route) });
      map.addSource("track", { type: "geojson", data: line(r.track) });
      map.addSource("pt", { type: "geojson", data: { type: "FeatureCollection", features: r.point ? [{ type: "Feature", properties: { label: r.point.label }, geometry: { type: "Point", coordinates: [r.point.lng, r.point.lat] } }] : [] } as any });
      map.addLayer({ id: "route", type: "line", source: "route", paint: { "line-color": "#8A93A6", "line-width": 3, "line-dasharray": [2, 1.5] } });
      map.addLayer({ id: "track", type: "line", source: "track", paint: { "line-color": "#4F8BFF", "line-width": 3 } });
      map.addLayer({ id: "pt", type: "circle", source: "pt", paint: { "circle-radius": 8, "circle-color": "#F2384B", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
      map.addLayer({ id: "pt-label", type: "symbol", source: "pt", layout: { "text-field": ["get", "label"], "text-size": 12, "text-offset": [0, 1.4], "text-anchor": "top" }, paint: { "text-color": "#1b2230", "text-halo-color": "#fff", "text-halo-width": 1.2 } });
      const b = new mapboxgl.LngLatBounds();
      for (const c of [...r.route, ...r.track]) b.extend(c);
      if (r.point) b.extend([r.point.lng, r.point.lat]);
      if (!b.isEmpty()) map.fitBounds(b, { padding: 50, maxZoom: 15, duration: 0 });
    });
    return () => map.remove();
  }, [token, r]);
  if (!token) return null;
  return (
    <section className="col g4">
      <div ref={el} style={{ height: 340, borderRadius: 8, overflow: "hidden" }} />
      <span className="t3" style={{ fontSize: 12 }}>
        {r.point ? `Red: ${r.point.label.toLowerCase()}${r.point.at ? ` (${when(r.point.at)})` : ""}. ` : ""}
        {r.track.length > 1 ? "Blue: recorded track. " : ""}
        {r.route.length > 1 ? "Grey dashes: planned route." : ""}
      </span>
    </section>
  );
}
