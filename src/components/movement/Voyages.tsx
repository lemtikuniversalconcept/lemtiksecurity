import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { toast } from "sonner";
import { FileText, LifeBuoy, Loader2, Plus, Save, Square, Undo2, Users, X } from "lucide-react";
import { basemapOptions, useBasemap } from "@/lib/basemap";
import { useMapboxToken } from "@/components/LocationPicker";
import { Empty, Notice, Panel, Status, type Tone } from "@/components/nw";
import type { MovementSubject } from "@/lib/movement.functions";
import { useMovementPerms } from "./perms";
import { cancelVoyage, finishVoyage, saveVoyage, type CrewMember, type Voyage } from "@/lib/voyages.functions";
import type { Corridor } from "@/lib/corridor.functions";
import { BoardingPanel, HandoffPanel } from "./Corridors";

type LngLat = [number, number];
const LAGOS: LngLat = [3.4219, 6.4281];

export const VOYAGE_STATUS: Record<Voyage["status"], { tone: Tone; label: string }> = {
  planned: { tone: "blue", label: "Planned" },
  underway: { tone: "ok", label: "Underway" },
  completed: { tone: "neutral", label: "Completed" },
  cancelled: { tone: "off", label: "Cancelled" },
};

const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const crewToText = (c: CrewMember[]) => c.map((m) => (m.role ? `${m.name}, ${m.role}` : m.name)).join("\n");
const textToCrew = (t: string): CrewMember[] =>
  t
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.lastIndexOf(",");
      return i > 0 ? { name: l.slice(0, i).trim().slice(0, 120), role: l.slice(i + 1).trim().slice(0, 60) } : { name: l.slice(0, 120), role: "" };
    });

export function routeLengthM(route: LngLat[]) {
  let d = 0;
  for (let i = 1; i < route.length; i++) {
    const [aLng, aLat] = route[i - 1];
    const [bLng, bLat] = route[i];
    const r = (v: number) => (v * Math.PI) / 180;
    const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
    d += 2 * 6_371_000 * Math.asin(Math.sqrt(h));
  }
  return d;
}
const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const nm = (m: number) => `${(m / 1852).toFixed(1)} nm`;

type Form = {
  id?: string;
  subject_id: string;
  name: string;
  route: LngLat[];
  corridor_m: number;
  planned_departure: string;
  planned_arrival: string;
  crewText: string;
  notes: string;
  corridor_id: string;
};

export function VoyagesView({ voyages, subjects, corridors = [] }: { voyages: Voyage[]; subjects: MovementSubject[]; corridors?: Corridor[] }) {
  const [form, setForm] = useState<Form | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = voyages.find((v) => v.id === openId) ?? null;
  const { canOperate } = useMovementPerms();
  const movers = subjects.filter((s) => s.kind !== "person");
  const name = (id: string) => subjects.find((s) => s.id === id)?.name ?? "Removed asset";
  const order = ["underway", "planned", "completed", "cancelled"];
  const sorted = [...voyages].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));

  const newForm = (): Form => ({ subject_id: movers[0]?.id ?? "", name: "", route: [], corridor_m: 2000, planned_departure: "", planned_arrival: "", crewText: "", notes: "", corridor_id: "" });

  return (
    <div className="grid g16" style={{ gridTemplateColumns: form || open ? "minmax(0,1fr) 480px" : "minmax(0,1fr)" }}>
      <Panel
        title="Voyages"
        meta={voyages.length}
        actions={
          canOperate ? (
            <button type="button" className="b b-sm b-pri" disabled={!movers.length} onClick={() => { setOpenId(null); setForm(newForm()); }}>
              <Plus size={14} /> Plan voyage
            </button>
          ) : undefined
        }
      >
        {!movers.length ? (
          <Empty>Add a boat or vehicle under “People & assets” first, then plan its voyage here.</Empty>
        ) : sorted.length === 0 ? (
          <Empty>No voyages yet. Plan one to get off-route, overdue and head-count alerts, and a voyage report.</Empty>
        ) : (
          <div className="col g4">
            {sorted.map((v) => (
              <button key={v.id} type="button" className={`row g10 w-full text-left hover:bg-ink-3${openId === v.id ? " bg-ink-3" : ""}`} style={{ padding: "9px 8px", borderRadius: 8 }} onClick={() => { setForm(null); setOpenId(v.id); }}>
                <span className="col f1" style={{ minWidth: 0 }}>
                  <b className="trunc">{v.name}</b>
                  <span className="t3 trunc" style={{ fontSize: 12 }}>
                    {name(v.subject_id)} · {v.status === "underway" ? `departed ${when(v.departed_at)}` : v.status === "completed" ? `arrived ${when(v.arrived_at)}` : `departs ${when(v.planned_departure)}`}
                    {v.planned_arrival && v.status !== "completed" ? ` · due ${when(v.planned_arrival)}` : ""}
                  </span>
                </span>
                {v.status === "underway" && v.off_route && <Status tone="warn">Off route</Status>}
                {v.status === "underway" && v.overdue_alerted && <Status tone="fail">Overdue</Status>}
                {v.status === "completed" && v.departure_count != null && v.arrival_count != null && v.departure_count !== v.arrival_count && <Status tone="fail">Head count</Status>}
                <Status tone={VOYAGE_STATUS[v.status].tone}>{VOYAGE_STATUS[v.status].label}</Status>
              </button>
            ))}
          </div>
        )}
      </Panel>
      {form && <VoyageEditor form={form} setForm={setForm} movers={movers} corridors={corridors.filter((c) => c.active || c.id === form.corridor_id)} onSaved={(id) => { setForm(null); setOpenId(id); }} />}
      {open && !form && (
        <VoyageDetail
          v={open}
          subjectName={name(open.subject_id)}
          corridorName={corridors.find((c) => c.id === open.corridor_id)?.name ?? null}
          onClose={() => setOpenId(null)}
          onEdit={() =>
            setForm({
              id: open.id,
              subject_id: open.subject_id,
              name: open.name,
              route: open.route,
              corridor_m: open.corridor_m,
              planned_departure: toLocalInput(open.planned_departure),
              planned_arrival: toLocalInput(open.planned_arrival),
              crewText: crewToText(open.crew),
              notes: open.notes ?? "",
              corridor_id: open.corridor_id ?? "",
            })
          }
        />
      )}
    </div>
  );
}

function VoyageEditor({ form, setForm, movers, corridors, onSaved }: { form: Form; setForm: (f: Form | null) => void; movers: MovementSubject[]; corridors: Corridor[]; onSaved: (id: string) => void }) {
  const save = useServerFn(saveVoyage);
  const qc = useQueryClient();
  const crew = textToCrew(form.crewText);
  const m = useMutation({
    mutationFn: () =>
      save({
        data: {
          id: form.id,
          subject_id: form.subject_id,
          name: form.name,
          route: form.route,
          corridor_m: form.corridor_m,
          planned_departure: fromLocalInput(form.planned_departure),
          planned_arrival: fromLocalInput(form.planned_arrival),
          crew,
          notes: form.notes || null,
          corridor_id: form.corridor_id || null,
        },
      }),
    onSuccess: (r) => {
      toast.success("Voyage saved");
      qc.invalidateQueries({ queryKey: ["movement-voyages"] });
      onSaved(r.id);
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const timesBad = !!form.planned_departure && !!form.planned_arrival && new Date(form.planned_arrival) <= new Date(form.planned_departure);
  const len = routeLengthM(form.route);

  return (
    <Panel title={form.id ? "Edit voyage" : "Plan voyage"} actions={<button type="button" className="ibtn" aria-label="Close" onClick={() => setForm(null)}><X size={14} /></button>}>
      <form className="col g10" onSubmit={(e) => { e.preventDefault(); if (form.name.trim() && form.subject_id && !timesBad) m.mutate(); }}>
        <label className="fl"><span>Voyage name</span><input className="in" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={160} placeholder="e.g. Crew change — Lekki jetty to Platform Bravo" /></label>
        <label className="fl">
          <span>Boat or vehicle</span>
          <select className="in" value={form.subject_id} onChange={(e) => setForm({ ...form, subject_id: e.target.value })}>
            {movers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>

        {corridors.length > 0 && (
          <label className="fl">
            <span>Approved corridor</span>
            <select
              className="in"
              value={form.corridor_id}
              onChange={(e) => {
                const c = corridors.find((x) => x.id === e.target.value);
                setForm(c ? { ...form, corridor_id: c.id, route: c.route, corridor_m: c.corridor_m } : { ...form, corridor_id: "" });
              }}
            >
              <option value="">None (draw a route below)</option>
              {corridors.map((c) => <option key={c.id} value={c.id}>{c.name}{c.curfew_start ? ` · curfew ${c.curfew_start}–${c.curfew_end}` : ""}</option>)}
            </select>
          </label>
        )}
        <div className="col g6">
          <span className="o-lbl">PLANNED ROUTE</span>
          <span className="t3" style={{ fontSize: 12 }}>Click the map to add waypoints in order, from departure to destination.</span>
          <RouteDrawer route={form.route} corridor={form.corridor_m} onChange={(route) => setForm({ ...form, route })} />
          <div className="row g8 wrap" style={{ fontSize: 12.5 }}>
            <span className="t2 f1">{form.route.length ? `${form.route.length} waypoint${form.route.length > 1 ? "s" : ""} · ${km(len)} (${nm(len)})` : "No route yet. Without one, there's no off-route alert."}</span>
            <button type="button" className="b b-sm b-gh" disabled={!form.route.length} onClick={() => setForm({ ...form, route: form.route.slice(0, -1) })}><Undo2 size={13} /> Undo</button>
            <button type="button" className="b b-sm b-gh" disabled={!form.route.length} onClick={() => setForm({ ...form, route: [] })}>Clear</button>
          </div>
          <label className="fl">
            <span>Alert if more than {km(form.corridor_m)} off the route</span>
            <input type="range" min={200} max={20000} step={100} value={form.corridor_m} onChange={(e) => setForm({ ...form, corridor_m: Number(e.target.value) })} />
          </label>
        </div>

        <div className="grid g10" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <label className="fl"><span>Planned departure</span><input type="datetime-local" className="in" value={form.planned_departure} onChange={(e) => setForm({ ...form, planned_departure: e.target.value })} /></label>
          <label className="fl"><span>Planned arrival</span><input type="datetime-local" className="in" value={form.planned_arrival} onChange={(e) => setForm({ ...form, planned_arrival: e.target.value })} /></label>
        </div>
        {timesBad && <Notice tone="warn">Planned arrival must be after departure.</Notice>}
        <span className="t3" style={{ fontSize: 12 }}>If the voyage is still underway 15 minutes after the planned arrival, the control room gets an overdue alert.</span>

        <label className="fl">
          <span>Crew and passengers ({crew.length}) — one per line, “Name, role”</span>
          <textarea className="in" rows={4} value={form.crewText} onChange={(e) => setForm({ ...form, crewText: e.target.value })} placeholder={"Ade Bello, Captain\nIfeanyi Obi, Engineer\nChioma Eze, Passenger"} />
        </label>
        <label className="fl"><span>Notes</span><textarea className="in" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={2000} /></label>
        <button type="submit" className="b b-pri" disabled={m.isPending || !form.name.trim() || !form.subject_id || timesBad}>
          {m.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save voyage
        </button>
      </form>
    </Panel>
  );
}

function VoyageDetail({ v, subjectName, corridorName, onClose, onEdit }: { v: Voyage; subjectName: string; corridorName: string | null; onClose: () => void; onEdit: () => void }) {
  const qc = useQueryClient();
  const { canOperate } = useMovementPerms();
  const [handoff, setHandoff] = useState(false);
  const finishFn = useServerFn(finishVoyage);
  const cancelFn = useServerFn(cancelVoyage);
  const [count, setCount] = useState<string>(String(v.status === "underway" ? v.departure_count ?? "" : v.crew.length || ""));
  const [confirmCancel, setConfirmCancel] = useState(false);
  useEffect(() => setCount(String(v.status === "underway" ? v.departure_count ?? "" : v.crew.length || "")), [v.id, v.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["movement-voyages"] });
    qc.invalidateQueries({ queryKey: ["movement-alerts"] });
  };
  const n = count.trim() === "" ? NaN : Number(count);
  const countOk = Number.isInteger(n) && n >= 0 && n <= 5000;

  const finish = useMutation({
    mutationFn: () => finishFn({ data: { id: v.id, arrival_count: n } }),
    onSuccess: (r) => { r.mismatch ? toast.error("Head count doesn't match departure. The control room has been alerted.") : toast.success("Voyage completed"); refresh(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const cancel = useMutation({
    mutationFn: () => cancelFn({ data: { id: v.id } }),
    onSuccess: () => { toast.success("Voyage cancelled"); setConfirmCancel(false); refresh(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const len = routeLengthM(v.route);

  return (
    <Panel
      title={v.name}
      actions={
        <>
          {canOperate && (v.status === "planned" || v.status === "underway") && <button type="button" className="b b-sm b-gh" onClick={onEdit}>Edit</button>}
          <button type="button" className="ibtn" aria-label="Close" onClick={onClose}><X size={14} /></button>
        </>
      }
    >
      <div className="col g14">
        <div className="row g8 wrap">
          <Status tone={VOYAGE_STATUS[v.status].tone}>{VOYAGE_STATUS[v.status].label}</Status>
          {v.status === "underway" && v.off_route && <Status tone="warn">Off route</Status>}
          {v.status === "underway" && v.overdue_alerted && <Status tone="fail">Overdue</Status>}
        </div>
        <section className="col g4" style={{ fontSize: 13 }}>
          <span><span className="t3">Boat or vehicle:</span> {subjectName}</span>
          {corridorName && <span><span className="t3">Corridor:</span> {corridorName}</span>}
          <span><span className="t3">Route:</span> {v.route.length >= 2 ? `${v.route.length} waypoints · ${km(len)} (${nm(len)}) · corridor ${km(v.corridor_m)}` : "none set"}</span>
          <span><span className="t3">Planned:</span> {when(v.planned_departure)} → {when(v.planned_arrival)}</span>
          {v.departed_at && <span><span className="t3">Actual:</span> {when(v.departed_at)} → {v.arrived_at ? when(v.arrived_at) : "underway"}</span>}
          {v.departure_count != null && (
            <span>
              <span className="t3">Head count:</span> {v.departure_count} departed{v.arrival_count != null ? `, ${v.arrival_count} arrived` : ""}
              {v.arrival_count != null && v.arrival_count !== v.departure_count && <b style={{ color: "var(--s5)" }}> — mismatch</b>}
            </span>
          )}
        </section>

        {v.crew.length > 0 && (
          <section className="col g4">
            <span className="o-lbl"><Users size={12} style={{ display: "inline", verticalAlign: -2 }} /> CREW AND PASSENGERS ({v.crew.length})</span>
            <div className="col" style={{ fontSize: 12.5, maxHeight: 160, overflow: "auto" }}>
              {v.crew.map((c, i) => <span key={i}>{c.name}{c.role ? <span className="t3"> · {c.role}</span> : null}</span>)}
            </div>
          </section>
        )}

        {v.boarding && (
          <section className="col g4" style={{ fontSize: 12.5 }}>
            <span className="o-lbl">BOARDING CHECK</span>
            <span>Checked {when(v.boarding.checked_at)} by {v.boarding.checked_by}: {v.boarding.departure_count} aboard{v.boarding.capacity != null ? ` (licensed for ${v.boarding.capacity})` : ""}{v.boarding.life_jackets != null ? `, ${v.boarding.life_jackets} life jackets` : ""}{v.boarding.qr_passengers ? `, ${v.boarding.qr_passengers} on the passenger list` : ""}.</span>
            {v.boarding.weather && <span className="t3">{v.boarding.weather}</span>}
            {v.boarding.override_reason && <Notice tone="warn">Departed despite: {v.boarding.problems.map((p) => p.text).join("; ")}. Reason given: {v.boarding.override_reason}</Notice>}
          </section>
        )}

        {canOperate && v.status === "planned" && <BoardingPanel v={v} onStarted={refresh} />}

        {canOperate && v.status === "underway" && (
          <section className="col g8">
            <span className="o-lbl">ARRIVAL HEAD COUNT</span>
            <span className="t3" style={{ fontSize: 12.5 }}>Count everyone aboard on arrival. If it doesn't match the {v.departure_count} who departed, the control room gets a critical alert.</span>
            <div className="row g8">
              <input className="in" style={{ width: 110 }} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, "").slice(0, 4))} aria-label="Head count" placeholder="Count" />
              <button type="button" className="b b-pri" disabled={!countOk || finish.isPending} onClick={() => finish.mutate()}>
                {finish.isPending ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />} Finish voyage
              </button>
            </div>
          </section>
        )}

        {canOperate && v.status === "underway" && (handoff ? (
          <HandoffPanel subjectId={v.subject_id} onClose={() => setHandoff(false)} />
        ) : (
          <button type="button" className="b b-sm b-sec" style={{ alignSelf: "flex-start", color: "var(--s5)" }} onClick={() => setHandoff(true)}>
            <LifeBuoy size={13} /> Emergency: hand off to a responder
          </button>
        ))}

        <div className="row g8 wrap">
          <Link to="/app/movement/voyages/$id" params={{ id: v.id }} className="b b-sm b-sec">
            <FileText size={13} /> Voyage report
          </Link>
          {canOperate && (v.status === "planned" || v.status === "underway") &&
            (confirmCancel ? (
              <>
                <span className="t2" style={{ fontSize: 12.5 }}>Cancel this voyage?</span>
                <button type="button" className="b b-sm b-sec" onClick={() => setConfirmCancel(false)}>No</button>
                <button type="button" className="b b-sm" style={{ background: "var(--s5)", color: "#fff" }} onClick={() => cancel.mutate()} disabled={cancel.isPending}>Cancel voyage</button>
              </>
            ) : (
              <button type="button" className="b b-sm b-gh" style={{ color: "var(--s5)" }} onClick={() => setConfirmCancel(true)}>Cancel voyage</button>
            ))}
        </div>
      </div>
    </Panel>
  );
}

/** Click-to-add waypoints on a map. */
export function RouteDrawer({ route, corridor, onChange }: { route: LngLat[]; corridor: number; onChange: (r: LngLat[]) => void }) {
  const { data: tokenData } = useMapboxToken();
  const token = tokenData?.token ?? "";
  const [basemap] = useBasemap();
  const el = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const routeRef = useRef(route);
  routeRef.current = route;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!token || !el.current || mapRef.current) return;
    mapboxgl.accessToken = token;
    const first = routeRef.current[0];
    const map = new mapboxgl.Map({ container: el.current, ...basemapOptions(basemap === "night" ? "night" : "satellite"), center: first ?? LAGOS, zoom: first ? 10 : 9, attributionControl: true });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    map.getCanvas().style.cursor = "crosshair";
    map.on("load", () => {
      map.addSource("rd", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "rd-corridor", type: "line", source: "rd", filter: ["==", ["geometry-type"], "LineString"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#4F8BFF", "line-opacity": 0.15, "line-width": ["interpolate", ["exponential", 2], ["zoom"], 4, 2, 16, 600] } });
      map.addLayer({ id: "rd-line", type: "line", source: "rd", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#4F8BFF", "line-width": 3, "line-dasharray": [2, 1] } });
      map.addLayer({ id: "rd-pts", type: "circle", source: "rd", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 6, "circle-color": ["get", "color"], "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
      map.addLayer({ id: "rd-num", type: "symbol", source: "rd", filter: ["==", ["geometry-type"], "Point"], layout: { "text-field": ["get", "n"], "text-size": 10, "text-offset": [0, -1.4], "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"] }, paint: { "text-color": "#fff", "text-halo-color": "#0A0C10", "text-halo-width": 1.2 } });
      setReady(true);
    });
    map.on("click", (e) => onChangeRef.current([...routeRef.current, [Number(e.lngLat.lng.toFixed(6)), Number(e.lngLat.lat.toFixed(6))]]));
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    // The translucent corridor is drawn as a wide line; it's indicative, the alert uses the exact distance.
    const metresPerPx = (lat: number, z: number) => (156543.03 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
    const lat = route[0]?.[1] ?? LAGOS[1];
    const z = map.getZoom();
    map.setPaintProperty("rd-corridor", "line-width", Math.min(400, (corridor * 2) / metresPerPx(lat, z)));
    (map.getSource("rd") as mapboxgl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: [
        ...(route.length > 1 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: route } }] : []),
        ...route.map((c, i) => ({ type: "Feature", properties: { n: String(i + 1), color: i === 0 ? "#2BD576" : i === route.length - 1 ? "#F2384B" : "#4F8BFF" }, geometry: { type: "Point", coordinates: c } })),
      ],
    } as any);
    const onZoom = () => map.setPaintProperty("rd-corridor", "line-width", Math.min(400, (corridor * 2) / metresPerPx(lat, map.getZoom())));
    map.on("zoom", onZoom);
    return () => {
      map.off("zoom", onZoom);
    };
  }, [ready, route, corridor]);

  return (
    <div className="map" style={{ height: 280, position: "relative" }}>
      <div ref={el} style={{ position: "absolute", inset: 0 }} />
      {!token && <div className="absolute inset-0 grid place-items-center t3">{tokenData ? "No Mapbox token configured." : <Loader2 className="h-5 w-5 animate-spin" />}</div>}
    </div>
  );
}
