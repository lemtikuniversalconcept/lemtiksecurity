import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { toast } from "sonner";
import { ArrowLeft, Copy, Link2, Loader2, ShieldCheck, ShieldX } from "lucide-react";
import { requireSectionAccess } from "@/lib/rbac";
import { basemapOptions } from "@/lib/basemap";
import { useMapboxToken } from "@/components/LocationPicker";
import { Empty, Notice, PageHeader, Panel, Status, type Tone } from "@/components/nw";
import { CaseFileButton } from "@/components/CaseFileButton";
import { CustodyRecorder, CUSTODY_KIND } from "@/components/cargo/Recorder";
import { cancelConsignment, custodyUploadUrl, getConsignment, recordCustody, setDriverLink, type CustodyEvent } from "@/lib/cargo.functions";

export const Route = createFileRoute("/app/cargo_/$id")({
  head: () => ({ meta: [{ title: "Consignment · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    requireSectionAccess(context.appAccess, ["security_manager", "operator", "client_admin", "field_officer", "security_forensic_analyst"]);
    return { appAccess: context.appAccess };
  },
  component: ConsignmentPage,
});

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—");
const STATUS: Record<string, [string, Tone]> = { planned: ["Planned", "blue"], in_transit: ["In transit", "ok"], delivered: ["Delivered", "off"], cancelled: ["Cancelled", "off"] };
const size = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

function ConsignmentPage() {
  const { id } = Route.useParams();
  const { appAccess } = Route.useRouteContext();
  const qc = useQueryClient();
  const fn = useServerFn(getConsignment);
  const q = useQuery({ queryKey: ["cargo", id], queryFn: () => fn({ data: { id } }), refetchInterval: 60_000 });
  const upFn = useServerFn(custodyUploadUrl);
  const recFn = useServerFn(recordCustody);
  const linkFn = useServerFn(setDriverLink);
  const cancelFn = useServerFn(cancelConsignment);
  const [recording, setRecording] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["cargo", id] }); qc.invalidateQueries({ queryKey: ["cargo"] }); };
  const link = useMutation({ mutationFn: (enable: boolean) => linkFn({ data: { id, enable } }), onSuccess: (r) => { toast.success(r.url ? "Driver link ready." : "Driver link turned off."); refresh(); }, onError: (e: Error) => toast.error(e.message) });
  const cancel = useMutation({ mutationFn: () => cancelFn({ data: { id } }), onSuccess: () => { toast.success("Cancelled."); refresh(); }, onError: (e: Error) => toast.error(e.message) });

  if (q.isLoading) return <span className="row g8 t3"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</span>;
  if (q.error || !q.data) return <Notice tone="fail">{(q.error as Error)?.message || "Couldn't load this consignment."}</Notice>;
  const { consignment: c, events, chain, subject } = q.data;
  const open = c.status === "planned" || c.status === "in_transit";
  const quietH = c.status === "in_transit" ? (Date.now() - Date.parse(c.last_event_at ?? c.created_at)) / 3_600_000 : 0;
  const canCaseFile = appAccess?.specRole !== "field_officer";

  return (
    <div className="col g16">
      <div className="row g8 wrap">
        <Link to="/app/cargo" className="b b-sm b-gh"><ArrowLeft size={14} /> Cargo custody</Link>
        <span className="f1" />
        {canCaseFile && events.length > 0 && <CaseFileButton kind="consignment" id={c.id} />}
      </div>
      <PageHeader title={<span className="mono">{c.reference}</span>} sub={`${c.description}${c.quantity ? ` · ${c.quantity}` : ""} · ${c.origin} → ${c.destination}`} />
      <div className="row g8 wrap">
        <Status tone={STATUS[c.status][1]}>{STATUS[c.status][0]}</Status>
        {c.has_exception && <Status tone="fail">Exception recorded</Status>}
        {quietH > c.max_gap_hours && <Status tone="warn">No custody record for {Math.round(quietH)} h (limit {c.max_gap_hours} h)</Status>}
        {chain.intact ? <Status tone="ok"><ShieldCheck size={13} style={{ verticalAlign: "-2px" }} /> Chain intact · {chain.count} records</Status> : <Status tone="fail"><ShieldX size={13} style={{ verticalAlign: "-2px" }} /> Chain broken at record {chain.broken_at}: {chain.reason}</Status>}
      </div>

      <div className="grid g16" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
        <Panel title="Details">
          <div className="col g6" style={{ fontSize: 13 }}>
            <KV k="Seals on record" v={c.seal_numbers.length ? <span className="mono">{c.seal_numbers.join(", ")}</span> : "None entered"} />
            <KV k="Containers" v={c.container_numbers.length ? <span className="mono">{c.container_numbers.join(", ")}</span> : "—"} />
            <KV k="Consignee" v={c.consignee ?? "—"} />
            <KV k="Carrier" v={c.carrier ?? "—"} />
            <KV k="Tracked vehicle or boat" v={subject ? `${subject.name}${subject.last_seen_at ? ` · seen ${when(subject.last_seen_at)}` : ""}` : "—"} />
            <KV k="Checkpoints" v={c.checkpoints.length ? c.checkpoints.map((p, i) => `${i + 1}. ${p.name}`).join("  ") : "—"} />
            <KV k="Added" v={`${when(c.created_at)} by ${c.created_by_name ?? "—"}`} />
            {c.delivered_at && <KV k="Delivered" v={when(c.delivered_at)} />}
          </div>
        </Panel>
        <Panel title="Map">
          <CustodyMap events={events} checkpoints={c.checkpoints} vehicle={subject?.last_lat != null && subject?.last_lng != null ? [subject.last_lng, subject.last_lat] : null} />
        </Panel>
      </div>

      {open && q.data.can_manage && (
        <Panel title="Driver link" icon={<Link2 size={15} />}>
          <div className="col g8" style={{ fontSize: 13 }}>
            <span className="t2">A driver or boat captain without an account can record custody on this link from their phone. They see the cargo and checkpoints but not the seal numbers, so they have to type what they actually see.</span>
            {q.data.driver_url ? (
              <div className="row g6 wrap" style={{ alignItems: "center" }}>
                <code className="mono" style={{ wordBreak: "break-all" }}>{q.data.driver_url}</code>
                <button type="button" className="b b-sm b-gh" onClick={() => navigator.clipboard.writeText(q.data!.driver_url!).then(() => toast.success("Link copied."))}><Copy size={13} /> Copy</button>
                <a className="b b-sm b-gh" href={`https://wa.me/?text=${encodeURIComponent(`Cargo ${c.reference}: please record each handover, checkpoint and delivery here, with a photo or short video: ${q.data.driver_url}`)}`} target="_blank" rel="noreferrer">Share on WhatsApp</a>
                <button type="button" className="b b-sm b-gh" disabled={link.isPending} onClick={() => link.mutate(false)}>Turn off</button>
              </div>
            ) : <button type="button" className="b b-sm b-pri" style={{ alignSelf: "flex-start" }} disabled={link.isPending} onClick={() => link.mutate(true)}>Create driver link</button>}
          </div>
        </Panel>
      )}

      {open && q.data.can_record && (
        recording ? (
          <Panel title="New custody record" actions={<button type="button" className="b b-sm b-gh" onClick={() => setRecording(false)}>Close</button>}>
            <CustodyRecorder
              kinds={["loaded", "sealed", "departed", "checkpoint", "handover", "inspection", "delivered", "exception"].filter((k) => k !== "checkpoint" || c.checkpoints.length > 0)}
              checkpoints={c.checkpoints.map((p) => p.name)}
              sealCount={c.seal_numbers.length}
              getUploadUrl={(file) => upFn({ data: { consignment_id: c.id, ...file, type: file.type as any } })}
              onSubmit={async (input) => (await recFn({ data: { consignment_id: c.id, ...input, kind: input.kind as any } }))!}
              onDone={refresh}
            />
          </Panel>
        ) : <button type="button" className="b b-pri" style={{ alignSelf: "flex-start" }} onClick={() => setRecording(true)}>Record custody</button>
      )}

      <Panel title="Chain of custody" meta={`${events.length} record${events.length === 1 ? "" : "s"}`}>
        {events.length === 0 ? <Empty>Nothing recorded yet. Start with "Loaded" when the cargo is put on the truck or boat.</Empty> : (
          <ol className="col g12" style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {events.map((e) => <EventRow key={e.id} e={e} checkpoints={c.checkpoints.map((p) => p.name)} />)}
          </ol>
        )}
      </Panel>

      {open && q.data.can_cancel && (
        <div className="row g6 wrap">
          {!confirmCancel ? <button type="button" className="b b-sm b-gh" onClick={() => setConfirmCancel(true)}>Cancel consignment</button> : (
            <>
              <span className="t2" style={{ fontSize: 13 }}>Cancel? The records stay, but no more can be added and the driver link stops working.</span>
              <button type="button" className="b b-sm b-pri" disabled={cancel.isPending} onClick={() => cancel.mutate()}>Cancel consignment</button>
              <button type="button" className="b b-sm b-gh" onClick={() => setConfirmCancel(false)}>Keep</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="row g8" style={{ alignItems: "baseline" }}><span className="t3" style={{ width: 150, flex: "none", fontSize: 12 }}>{k}</span><span>{v}</span></div>;
}

function EventRow({ e, checkpoints }: { e: CustodyEvent; checkpoints: string[] }) {
  const bad = e.kind === "exception" || e.seals_ok === false;
  return (
    <li className="col g6" style={{ borderLeft: `3px solid ${bad ? "var(--fail, #F2384B)" : "var(--line, rgba(127,127,127,.3))"}`, paddingLeft: 12 }}>
      <div className="row g8 wrap" style={{ alignItems: "center", fontSize: 13 }}>
        <span className="t3 mono">#{e.seq}</span>
        <b>{CUSTODY_KIND[e.kind] ?? e.kind}{e.kind === "checkpoint" && e.checkpoint_index != null ? `: ${checkpoints[e.checkpoint_index] ?? ""}` : ""}</b>
        {e.seals_ok === true && <Status tone="ok">Seals match</Status>}
        {e.seals_ok === false && <Status tone="fail">Seal mismatch</Status>}
        {e.off_checkpoint_m != null && <Status tone="warn">{e.off_checkpoint_m} m from the checkpoint</Status>}
        {e.lat == null && <Status tone="warn">No location</Status>}
        <span className="f1" />
        <span className="t3" style={{ fontSize: 12 }}>{when(e.recorded_at)} · {e.recorded_by_name}</span>
      </div>
      <div className="col g4 t2" style={{ fontSize: 13 }}>
        {(e.from_party || e.to_party) && <span>From <b>{e.from_party ?? "?"}</b> to <b>{e.to_party ?? "?"}</b></span>}
        {e.seals_observed.length > 0 && <span>Seals seen: <span className="mono">{e.seals_observed.join(", ")}</span>{e.seal_issue ? ` (${e.seal_issue})` : ""}</span>}
        {e.note && <span>{e.note}</span>}
        {e.lat != null && e.lng != null && <span className="t3 mono" style={{ fontSize: 12 }}>{e.lat.toFixed(5)}, {e.lng.toFixed(5)}{e.accuracy_m != null ? ` ±${Math.round(e.accuracy_m)} m` : ""}</span>}
      </div>
      {e.media.length > 0 && (
        <div className="row g8 wrap">
          {e.media.map((m, i) => (
            <figure key={i} className="col g4" style={{ margin: 0, width: 220 }}>
              {m.url ? (m.type.startsWith("video/") ? <video src={m.url} controls playsInline preload="metadata" style={{ width: 220, maxHeight: 170, borderRadius: 6, background: "#000" }} /> : <a href={m.url} target="_blank" rel="noreferrer"><img src={m.url} alt={m.name} style={{ width: 220, maxHeight: 170, objectFit: "cover", borderRadius: 6 }} /></a>) : <span className="t3">File unavailable</span>}
              <figcaption className="t3" style={{ fontSize: 11, wordBreak: "break-all" }}>{m.name} · {size(m.size)}<br /><span className="mono">SHA-256 {m.sha256?.slice(0, 16)}…</span></figcaption>
            </figure>
          ))}
        </div>
      )}
      <span className="t3 mono" style={{ fontSize: 10.5, wordBreak: "break-all" }}>record hash {e.event_hash}</span>
    </li>
  );
}

function CustodyMap({ events, checkpoints, vehicle }: { events: CustodyEvent[]; checkpoints: { name: string; lat: number; lng: number; radius_m: number }[]; vehicle: [number, number] | null }) {
  const { data: tokenData } = useMapboxToken();
  const token = tokenData?.token ?? "";
  const el = useRef<HTMLDivElement | null>(null);
  const pts = events.filter((e) => e.lat != null && e.lng != null);
  useEffect(() => {
    if (!token || !el.current) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({ container: el.current, ...basemapOptions("day"), center: vehicle ?? (pts[0] ? [pts[0].lng!, pts[0].lat!] : [3.4, 6.45]), zoom: 10 } as any);
    map.on("load", () => {
      const fc = (features: any[]) => ({ type: "FeatureCollection", features });
      map.addSource("track", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: pts.map((e) => [e.lng, e.lat]) } } as any });
      map.addSource("cps", { type: "geojson", data: fc(checkpoints.map((c) => ({ type: "Feature", properties: { label: c.name }, geometry: { type: "Point", coordinates: [c.lng, c.lat] } }))) as any });
      map.addSource("ev", { type: "geojson", data: fc(pts.map((e) => ({ type: "Feature", properties: { label: `#${e.seq}`, bad: e.kind === "exception" || e.seals_ok === false ? 1 : 0 }, geometry: { type: "Point", coordinates: [e.lng, e.lat] } }))) as any });
      map.addSource("veh", { type: "geojson", data: fc(vehicle ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: vehicle } }] : []) as any });
      map.addLayer({ id: "track", type: "line", source: "track", paint: { "line-color": "#4F8BFF", "line-width": 2, "line-dasharray": [2, 1] } });
      map.addLayer({ id: "cps", type: "circle", source: "cps", paint: { "circle-radius": 7, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#8A93A6", "circle-stroke-width": 2 } });
      map.addLayer({ id: "ev", type: "circle", source: "ev", paint: { "circle-radius": 6, "circle-color": ["case", ["==", ["get", "bad"], 1], "#F2384B", "#4F8BFF"], "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
      map.addLayer({ id: "veh", type: "circle", source: "veh", paint: { "circle-radius": 7, "circle-color": "#16a34a", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
      map.addLayer({ id: "labels", type: "symbol", source: "ev", layout: { "text-field": ["get", "label"], "text-size": 11, "text-offset": [0, 1.2], "text-anchor": "top" }, paint: { "text-color": "#1b2230", "text-halo-color": "#fff", "text-halo-width": 1.2 } });
      map.addLayer({ id: "cplabels", type: "symbol", source: "cps", layout: { "text-field": ["get", "label"], "text-size": 11, "text-offset": [0, -1.4], "text-anchor": "bottom" }, paint: { "text-color": "#4b5263", "text-halo-color": "#fff", "text-halo-width": 1.2 } });
      const b = new mapboxgl.LngLatBounds();
      pts.forEach((e) => b.extend([e.lng!, e.lat!]));
      checkpoints.forEach((c) => b.extend([c.lng, c.lat]));
      if (vehicle) b.extend(vehicle);
      if (!b.isEmpty()) map.fitBounds(b, { padding: 40, maxZoom: 14, duration: 0 });
    });
    return () => map.remove();
  }, [token, events.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!pts.length && !checkpoints.length && !vehicle) return <Empty>Locations appear here as custody records are made.</Empty>;
  if (!token) return <div className="t3" style={{ height: 260, display: "grid", placeItems: "center" }}>Loading map…</div>;
  return (
    <div className="col g6">
      <div ref={el} style={{ height: 260, borderRadius: 8, overflow: "hidden" }} />
      <span className="t3" style={{ fontSize: 12 }}>● custody record (red = problem) · ○ checkpoint{vehicle ? " · green = tracked vehicle now" : ""}</span>
    </div>
  );
}
