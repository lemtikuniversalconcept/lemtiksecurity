import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  getPatrol, saveWaypoints, updatePatrolDetails, archivePatrol, duplicatePatrol,
  listShifts, scheduleShift, updateShift, listCheckIns, recordCheckIn, sosAlert,
} from "@/lib/patrols.functions";
import { getMapboxToken } from "@/lib/config.functions";
import { useRealtimeInvalidate } from "@/lib/useRealtime";
import {
  ArrowLeft, Plus, Trash2, Save, Copy, Archive, ArchiveRestore, Loader2,
  Crosshair, CalendarPlus, CheckCircle2, AlertTriangle, Siren, PlayCircle, StopCircle, MapPin,
} from "lucide-react";

export const Route = createFileRoute("/app/patrols/$id")({
  head: () => ({ meta: [{ title: "Patrol · Lemtik SOD" }] }),
  component: PatrolDetail,
});

const LAGOS: [number, number] = [3.4219, 6.4281];

type Waypoint = {
  id?: string;
  ord: number;
  name: string;
  coord_x: number | null;
  coord_y: number | null;
  expected_minutes: number;
};

function PatrolDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const getP = useServerFn(getPatrol);
  const saveWp = useServerFn(saveWaypoints);
  const updP = useServerFn(updatePatrolDetails);
  const archP = useServerFn(archivePatrol);
  const dupP = useServerFn(duplicatePatrol);
  const listSh = useServerFn(listShifts);
  const schedSh = useServerFn(scheduleShift);
  const updSh = useServerFn(updateShift);
  const listCi = useServerFn(listCheckIns);
  const ciFn = useServerFn(recordCheckIn);
  const sosFn = useServerFn(sosAlert);
  const tokenFn = useServerFn(getMapboxToken);

  const { data, isLoading } = useQuery({ queryKey: ["patrol", id], queryFn: () => getP({ data: { id } }) });
  const { data: shifts = [] } = useQuery({ queryKey: ["shifts", id], queryFn: () => listSh({ data: { patrol_id: id } }) });
  const { data: checkins = [] } = useQuery({ queryKey: ["checkins", id], queryFn: () => listCi({ data: { patrol_id: id } }) });
  const { data: token } = useQuery({ queryKey: ["mapbox_token"], queryFn: () => tokenFn(), staleTime: Infinity });

  useRealtimeInvalidate("patrol_shifts", [["shifts", id]]);
  useRealtimeInvalidate("patrol_check_ins", [["checkins", id]]);
  useRealtimeInvalidate("patrol_waypoints", [["patrol", id]]);

  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [details, setDetails] = useState({ name: "", officer: "", shift: "", total_duration_minutes: 60, grace_period_minutes: 10, checkin_method: "gps" as "gps"|"qr"|"nfc" });
  const [activeWp, setActiveWp] = useState<number>(0);

  useEffect(() => {
    if (!data) return;
    const p = data.patrol as any;
    setDetails({
      name: p.name ?? "", officer: p.officer ?? "", shift: p.shift ?? "",
      total_duration_minutes: p.total_duration_minutes ?? 60,
      grace_period_minutes: p.grace_period_minutes ?? 10,
      checkin_method: (p.checkin_method ?? "gps") as any,
    });
    setWaypoints((data.waypoints ?? []).map((w: any) => ({
      id: w.id, ord: w.ord, name: w.name,
      coord_x: w.coord_x == null ? null : Number(w.coord_x),
      coord_y: w.coord_y == null ? null : Number(w.coord_y),
      expected_minutes: w.expected_minutes,
    })));
  }, [data]);

  // Map for waypoint builder
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);

  useEffect(() => {
    if (!token?.token || !mapEl.current || mapRef.current) return;
    mapboxgl.accessToken = token.token;
    const center = waypoints.find((w) => w.coord_x != null && w.coord_y != null);
    const m = new mapboxgl.Map({
      container: mapEl.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: center ? [center.coord_x!, center.coord_y!] : LAGOS,
      zoom: 12, attributionControl: false,
    });
    m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => requestAnimationFrame(() => m.resize()));
    m.on("click", (e) => {
      setWaypoints((prev) => {
        const next: Waypoint = {
          ord: prev.length, name: `Waypoint ${prev.length + 1}`,
          coord_x: e.lngLat.lng, coord_y: e.lngLat.lat, expected_minutes: 5,
        };
        setActiveWp(prev.length);
        return [...prev, next];
      });
    });
    mapRef.current = m;
    const ro = new ResizeObserver(() => { try { m.resize(); } catch {} });
    if (mapEl.current) ro.observe(mapEl.current);
    return () => { ro.disconnect(); m.remove(); mapRef.current = null; };
  }, [token?.token]);

  // Redraw markers + line on waypoint changes
  useEffect(() => {
    const m = mapRef.current; if (!m) return;
    markersRef.current.forEach((mk) => mk.remove());
    markersRef.current = [];
    waypoints.forEach((w, i) => {
      if (w.coord_x == null || w.coord_y == null) return;
      const el = document.createElement("div");
      el.style.cssText = `width:22px;height:22px;border-radius:11px;background:hsl(217 91% 60%);color:#fff;display:grid;place-items:center;font:600 11px ui-sans-serif,system-ui;border:2px solid hsl(220 13% 9%);cursor:pointer`;
      el.textContent = String(i + 1);
      el.onclick = (e) => { e.stopPropagation(); setActiveWp(i); };
      const mk = new mapboxgl.Marker(el).setLngLat([w.coord_x, w.coord_y]).addTo(m);
      markersRef.current.push(mk);
    });
    // Line layer
    const lineSrcId = "wp-line";
    const coords = waypoints.filter((w) => w.coord_x != null && w.coord_y != null).map((w) => [w.coord_x!, w.coord_y!]);
    const geo = { type: "FeatureCollection" as const, features: coords.length >= 2 ? [{ type: "Feature" as const, geometry: { type: "LineString" as const, coordinates: coords }, properties: {} }] : [] };
    if (!m.isStyleLoaded()) { m.once("style.load", () => upsertLine()); } else { upsertLine(); }
    function upsertLine() {
      const src = m!.getSource(lineSrcId) as mapboxgl.GeoJSONSource | undefined;
      if (src) { src.setData(geo as any); return; }
      m!.addSource(lineSrcId, { type: "geojson", data: geo as any });
      m!.addLayer({ id: lineSrcId, type: "line", source: lineSrcId, paint: { "line-color": "hsl(217 91% 60%)", "line-width": 2, "line-dasharray": [2, 2] } });
    }
  }, [waypoints]);

  // Mutations
  const saveWpMut = useMutation({
    mutationFn: () => saveWp({ data: { patrol_id: id, waypoints } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["patrol", id] }),
  });
  const updMut = useMutation({
    mutationFn: () => updP({ data: { id, ...details } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["patrol", id] }),
  });
  const archMut = useMutation({
    mutationFn: (archived: boolean) => archP({ data: { id, archived } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["patrol", id] }),
  });
  const dupMut = useMutation({ mutationFn: () => dupP({ data: { id } }) });
  const schedMut = useMutation({
    mutationFn: (v: any) => schedSh({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shifts", id] }),
  });
  const shiftMut = useMutation({
    mutationFn: (v: any) => updSh({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shifts", id] }),
  });

  if (isLoading || !data) {
    return <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading patrol…</div>;
  }
  const p = data.patrol as any;
  const archived = !!p.archived_at;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/app/patrols" className="rounded-md border border-border bg-surface p-1.5 hover:bg-surface-2"><ArrowLeft className="h-4 w-4" /></Link>
          <div>
            <div className="text-[10px] font-mono text-muted-foreground">{p.code}{archived && " · ARCHIVED"}</div>
            <h1 className="text-xl font-semibold">{details.name || p.name}</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => dupMut.mutate()} disabled={dupMut.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs hover:bg-surface-2 disabled:opacity-60">
            <Copy className="h-3.5 w-3.5" /> Duplicate
          </button>
          <button onClick={() => archMut.mutate(!archived)} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs hover:bg-surface-2">
            {archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
            {archived ? "Restore" : "Archive"}
          </button>
        </div>
      </div>

      {/* Details */}
      <section className="rounded-lg border border-border bg-card p-5 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <F label="Route name"><input className="inp" value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} /></F>
          <F label="Default officer"><input className="inp" value={details.officer} onChange={(e) => setDetails({ ...details, officer: e.target.value })} /></F>
          <F label="Shift window"><input className="inp" value={details.shift} onChange={(e) => setDetails({ ...details, shift: e.target.value })} placeholder="18:00 – 06:00" /></F>
          <F label="Total duration (min)"><input type="number" min={5} max={720} className="inp" value={details.total_duration_minutes} onChange={(e) => setDetails({ ...details, total_duration_minutes: Number(e.target.value) })} /></F>
          <F label="Grace period (min)"><input type="number" min={1} max={60} className="inp" value={details.grace_period_minutes} onChange={(e) => setDetails({ ...details, grace_period_minutes: Number(e.target.value) })} /></F>
          <F label="Check-in method">
            <select className="inp" value={details.checkin_method} onChange={(e) => setDetails({ ...details, checkin_method: e.target.value as any })}>
              <option value="gps">GPS (50m radius)</option>
              <option value="qr">QR code at waypoint</option>
              <option value="nfc">NFC tag (enterprise)</option>
            </select>
          </F>
        </div>
        <div className="flex justify-end">
          <button onClick={() => updMut.mutate()} disabled={updMut.isPending} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            {updMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save details
          </button>
        </div>
      </section>

      {/* Route builder */}
      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold">Route waypoints</h2>
            <p className="text-xs text-muted-foreground">Click the map to add a waypoint. Drag-free list below — edit name & expected time.</p>
          </div>
          <button onClick={() => saveWpMut.mutate()} disabled={saveWpMut.isPending} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            {saveWpMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save route
          </button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3">
          <div className="relative overflow-hidden rounded-md border border-border bg-surface h-[420px]">
            {token?.token ? <div ref={mapEl} className="absolute inset-0" /> : (
              <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground p-6 text-center">
                Add MAPBOX_PUBLIC_TOKEN to enable map editing. You can still enter waypoint coordinates manually below.
              </div>
            )}
          </div>
          <div className="space-y-1.5 max-h-[420px] overflow-auto pr-1">
            {waypoints.length === 0 && (
              <div className="rounded-md border border-dashed border-border bg-surface p-4 text-xs text-muted-foreground text-center">
                No waypoints yet. Click the map or add manually.
              </div>
            )}
            {waypoints.map((w, i) => (
              <div key={i} className={`rounded-md border p-2 ${activeWp === i ? "border-primary/50 bg-primary/5" : "border-border bg-surface"}`}>
                <div className="flex items-center gap-2">
                  <span className="inline-grid h-5 w-5 place-items-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">{i + 1}</span>
                  <input className="inp h-7 flex-1" value={w.name} onChange={(e) => updateWp(i, { name: e.target.value })} />
                  <button onClick={() => removeWp(i)} className="text-muted-foreground hover:text-critical"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
                <div className="mt-1.5 grid grid-cols-3 gap-1">
                  <input className="inp h-7 text-[11px]" placeholder="lng" type="number" step="0.000001" value={w.coord_x ?? ""} onChange={(e) => updateWp(i, { coord_x: e.target.value === "" ? null : Number(e.target.value) })} />
                  <input className="inp h-7 text-[11px]" placeholder="lat" type="number" step="0.000001" value={w.coord_y ?? ""} onChange={(e) => updateWp(i, { coord_y: e.target.value === "" ? null : Number(e.target.value) })} />
                  <div className="flex items-center gap-1">
                    <input className="inp h-7 text-[11px]" type="number" min={1} max={120} value={w.expected_minutes} onChange={(e) => updateWp(i, { expected_minutes: Number(e.target.value) })} />
                    <span className="text-[10px] text-muted-foreground">min</span>
                  </div>
                </div>
              </div>
            ))}
            <button onClick={addWp} className="w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-surface px-3 py-2 text-xs hover:bg-surface-2">
              <Plus className="h-3.5 w-3.5" /> Add waypoint
            </button>
          </div>
        </div>
      </section>

      {/* Shifts */}
      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Shift schedule</h2>
          <ScheduleShiftForm onSchedule={(v) => schedMut.mutate(v)} loading={schedMut.isPending} patrolId={id} defaultOfficer={details.officer} />
        </div>
        {shifts.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-surface p-4 text-xs text-muted-foreground text-center">No shifts scheduled.</div>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-xs">
              <thead className="bg-surface text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr><th className="px-3 py-2 text-left">Officer</th><th className="px-3 py-2 text-left">Start</th><th className="px-3 py-2 text-left">End</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-right">Actions</th></tr>
              </thead>
              <tbody>
                {(shifts as any[]).map((s) => (
                  <ShiftRow key={s.id} shift={s} onAction={(v) => shiftMut.mutate({ id: s.id, ...v })} loading={shiftMut.isPending} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Check-in log */}
      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Patrol log</h2>
          <QuickCheckInTester shifts={shifts as any[]} waypoints={waypoints} onCheck={(v) => ciMut.mutate(v)} onSos={(v) => sosMut.mutate(v)} loading={ciMut.isPending || sosMut.isPending} />
        </div>
        {checkins.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-surface p-4 text-xs text-muted-foreground text-center">No check-ins yet.</div>
        ) : (
          <div className="space-y-1.5 max-h-80 overflow-auto">
            {(checkins as any[]).map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  {c.status === "on_time" && <CheckCircle2 className="h-3.5 w-3.5 text-resolved" />}
                  {c.status === "late" && <AlertTriangle className="h-3.5 w-3.5 text-high" />}
                  {c.status === "out_of_zone" && <MapPin className="h-3.5 w-3.5 text-critical" />}
                  <span className="font-medium">{c.officer_name ?? "Officer"}</span>
                  <span className="text-muted-foreground">· {c.method}</span>
                  {c.minutes_late > 0 && <span className="text-high">+{c.minutes_late}m late</span>}
                  {c.distance_m != null && <span className="text-muted-foreground">{Math.round(c.distance_m)}m</span>}
                </div>
                <span className="font-mono text-muted-foreground">{new Date(c.created_at).toLocaleString("en-GB")}</span>
              </div>
            ))}
          </div>
        )}
      </section>
      <CiMutContext fn={ciFn} sos={sosFn} qc={qc} id={id} setMuts={(c: any, s: any) => { ciMut = c; sosMut = s; }} />
      <style>{`.inp{width:100%;border-radius:.375rem;border:1px solid var(--border);background:var(--surface);padding:.4rem .55rem;font-size:.8125rem;color:var(--foreground)}.inp:focus{outline:none;box-shadow:0 0 0 1px var(--ring)}`}</style>
    </div>
  );

  function addWp() {
    setWaypoints((prev) => [...prev, { ord: prev.length, name: `Waypoint ${prev.length + 1}`, coord_x: null, coord_y: null, expected_minutes: 5 }]);
  }
  function removeWp(i: number) { setWaypoints((prev) => prev.filter((_, idx) => idx !== i).map((w, idx) => ({ ...w, ord: idx }))); }
  function updateWp(i: number, patch: Partial<Waypoint>) { setWaypoints((prev) => prev.map((w, idx) => idx === i ? { ...w, ...patch } : w)); }
}

// Mutations need to be inside the component scope, but the layout below uses them — so
// we declare placeholders via let in the closure. Simpler: hoist with useRef.
let ciMut: any = { mutate: () => {}, isPending: false };
let sosMut: any = { mutate: () => {}, isPending: false };

function CiMutContext({ fn, sos, qc, id, setMuts }: any) {
  const a = useMutation({ mutationFn: (v: any) => fn({ data: v }), onSuccess: () => qc.invalidateQueries({ queryKey: ["checkins", id] }) });
  const b = useMutation({ mutationFn: (v: any) => sos({ data: v }) });
  useEffect(() => { setMuts(a, b); }, [a, b]);
  return null;
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>{children}</label>;
}

function ShiftRow({ shift, onAction, loading }: { shift: any; onAction: (v: any) => void; loading: boolean }) {
  const [notes, setNotes] = useState(shift.handover_notes ?? "");
  const [open, setOpen] = useState(false);
  const status = shift.status as string;
  return (
    <>
      <tr className="border-t border-border">
        <td className="px-3 py-2">{shift.officer_name}</td>
        <td className="px-3 py-2 font-mono">{new Date(shift.scheduled_start).toLocaleString("en-GB")}</td>
        <td className="px-3 py-2 font-mono">{new Date(shift.scheduled_end).toLocaleString("en-GB")}</td>
        <td className="px-3 py-2"><span className={`rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${status === "active" ? "border-resolved/40 text-resolved bg-resolved/10" : status === "completed" ? "border-border text-muted-foreground" : status === "cancelled" ? "border-critical/40 text-critical bg-critical/10" : "border-border bg-surface"}`}>{status}</span></td>
        <td className="px-3 py-2 text-right">
          <div className="inline-flex items-center gap-1">
            {status === "scheduled" && <button onClick={() => onAction({ start: true })} disabled={loading} className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-[11px] hover:bg-surface-2"><PlayCircle className="h-3 w-3" /> Start</button>}
            {status === "active" && <button onClick={() => onAction({ end: true })} disabled={loading} className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-[11px] hover:bg-surface-2"><StopCircle className="h-3 w-3" /> End</button>}
            <button onClick={() => setOpen((o) => !o)} className="rounded border border-border bg-surface px-2 py-1 text-[11px] hover:bg-surface-2">Handover</button>
          </div>
        </td>
      </tr>
      {open && (
        <tr className="bg-surface/50">
          <td colSpan={5} className="px-3 py-2">
            <textarea className="inp" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Handover notes for the next officer…" />
            <div className="mt-1.5 flex justify-end">
              <button onClick={() => onAction({ handover_notes: notes })} disabled={loading} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
                <Save className="h-3 w-3" /> Save notes
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function ScheduleShiftForm({ onSchedule, loading, patrolId, defaultOfficer }: { onSchedule: (v: any) => void; loading: boolean; patrolId: string; defaultOfficer: string }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    officer_name: defaultOfficer || "",
    scheduled_start: toLocalInput(new Date(Date.now() + 3600_000)),
    scheduled_end: toLocalInput(new Date(Date.now() + 3600_000 * 9)),
    repeat_days: 1,
  });
  useEffect(() => { if (defaultOfficer) setForm((f) => ({ ...f, officer_name: defaultOfficer })); }, [defaultOfficer]);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"><CalendarPlus className="h-3.5 w-3.5" /> Schedule</button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 w-80 rounded-lg border border-border bg-card p-3 shadow-elegant space-y-2">
          <F label="Officer name"><input className="inp" value={form.officer_name} onChange={(e) => setForm({ ...form, officer_name: e.target.value })} /></F>
          <F label="Start"><input className="inp" type="datetime-local" value={form.scheduled_start} onChange={(e) => setForm({ ...form, scheduled_start: e.target.value })} /></F>
          <F label="End"><input className="inp" type="datetime-local" value={form.scheduled_end} onChange={(e) => setForm({ ...form, scheduled_end: e.target.value })} /></F>
          <F label="Repeat (days)"><input className="inp" type="number" min={1} max={30} value={form.repeat_days} onChange={(e) => setForm({ ...form, repeat_days: Number(e.target.value) })} /></F>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setOpen(false)} className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs">Cancel</button>
            <button onClick={() => { onSchedule({ patrol_id: patrolId, officer_name: form.officer_name, scheduled_start: new Date(form.scheduled_start).toISOString(), scheduled_end: new Date(form.scheduled_end).toISOString(), repeat_days: form.repeat_days }); setOpen(false); }} disabled={loading || !form.officer_name} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60">Schedule</button>
          </div>
        </div>
      )}
    </div>
  );
}

function QuickCheckInTester({ shifts, waypoints, onCheck, onSos, loading }: { shifts: any[]; waypoints: Waypoint[]; onCheck: (v: any) => void; onSos: (v: any) => void; loading: boolean }) {
  const active = shifts.find((s) => s.status === "active") ?? shifts[0];
  const [wpId, setWpId] = useState<string>("");
  useEffect(() => { const w = waypoints.find((w) => w.id); if (w?.id) setWpId(w.id); }, [waypoints]);
  if (!active || !waypoints.length) return null;
  return (
    <div className="flex items-center gap-2">
      <select className="rounded border border-border bg-surface px-2 py-1 text-[11px]" value={wpId} onChange={(e) => setWpId(e.target.value)}>
        {waypoints.filter((w) => w.id).map((w, i) => <option key={w.id} value={w.id!}>{i + 1}. {w.name}</option>)}
      </select>
      <button
        disabled={loading || !wpId}
        onClick={() => {
          if (!navigator.geolocation) { onCheck({ shift_id: active.id, waypoint_id: wpId, method: "gps" }); return; }
          navigator.geolocation.getCurrentPosition(
            (pos) => onCheck({ shift_id: active.id, waypoint_id: wpId, method: "gps", coord_x: pos.coords.longitude, coord_y: pos.coords.latitude }),
            () => onCheck({ shift_id: active.id, waypoint_id: wpId, method: "gps" }),
            { enableHighAccuracy: true, timeout: 8000 },
          );
        }}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        <Crosshair className="h-3.5 w-3.5" /> Check in
      </button>
      <button
        disabled={loading}
        onClick={() => {
          if (!navigator.geolocation) { onSos({ shift_id: active.id }); return; }
          navigator.geolocation.getCurrentPosition(
            (pos) => onSos({ shift_id: active.id, coord_x: pos.coords.longitude, coord_y: pos.coords.latitude }),
            () => onSos({ shift_id: active.id }),
          );
        }}
        className="inline-flex items-center gap-1.5 rounded-md border border-critical/40 bg-critical/10 px-3 py-1.5 text-xs font-medium text-critical hover:bg-critical/20"
      >
        <Siren className="h-3.5 w-3.5" /> SOS
      </button>
    </div>
  );
}

function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
