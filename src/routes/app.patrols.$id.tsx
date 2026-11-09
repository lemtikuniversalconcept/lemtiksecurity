import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { toast } from "sonner";
import {
  getPatrol, saveWaypoints, updatePatrolDetails, archivePatrol, duplicatePatrol,
  listShifts, scheduleShift, updateShift, listCheckIns,
} from "@/lib/patrols.functions";
import { getMapboxToken } from "@/lib/config.functions";
import { encodeCheckpoint } from "@/lib/checkpointQr";
import { add3DBuildings, BASEMAP_STYLE, BasemapSwitch, saveView, useBasemap, type SavedView } from "@/lib/basemap";
import { useRealtimeInvalidate } from "@/lib/useRealtime";
import { requireSectionAccess } from "@/lib/rbac";
import {
  ChevronLeft, Plus, Trash2, Save, Copy, Archive, ArchiveRestore, Loader2,
  CalendarPlus, PlayCircle, StopCircle, ArrowUp, ArrowDown, X,
  QrCode,
} from "lucide-react";
import { Avatar, Empty, Kpi, Notice, Panel, Status, Tag, type Tone } from "@/components/nw";

export const Route = createFileRoute("/app/patrols/$id")({
  head: () => ({ meta: [{ title: "Patrol route · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    const appAccess = context.appAccess;
    requireSectionAccess(appAccess, ["security_manager", "operator", "client_admin"]);
    return { appAccess };
  },
  component: PatrolDetail,
});

const DEFAULT_CENTER: [number, number] = [3.4219, 6.4281];
const STATUS_TONE: Record<string, Tone> = { on_route: "ok", delayed: "warn", missed: "fail", complete: "off" };
const SHIFT_TONE: Record<string, Tone> = { active: "ok", scheduled: "blue", completed: "off", cancelled: "fail" };
const CHECKIN_TONE: Record<string, "ok" | "warn" | "fail"> = { on_time: "ok", late: "warn", out_of_zone: "fail" };
const METHODS = [
  { value: "gps", label: "GPS · 50 m" },
  { value: "qr", label: "QR code" },
  { value: "nfc", label: "NFC" },
] as const;
const words = (s: unknown) => String(s ?? "").replace(/_/g, " ");

type Waypoint = {
  id?: string;
  ord: number;
  name: string;
  coord_x: number | null;
  coord_y: number | null;
  expected_minutes: number;
};
type Details = {
  name: string;
  officer: string;
  shift: string;
  total_duration_minutes: number;
  grace_period_minutes: number;
  checkin_method: "gps" | "qr" | "nfc";
};

/** Straight-line length of the route in metres (haversine between consecutive stops). */
function routeLength(points: Waypoint[]) {
  const placed = points.filter((w) => w.coord_x != null && w.coord_y != null);
  let total = 0;
  for (let i = 1; i < placed.length; i++) {
    const [a, b] = [placed[i - 1], placed[i]];
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(b.coord_y! - a.coord_y!);
    const dLng = toRad(b.coord_x! - a.coord_x!);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.coord_y!)) * Math.cos(toRad(b.coord_y!)) * Math.sin(dLng / 2) ** 2;
    total += 2 * 6371000 * Math.asin(Math.sqrt(h));
  }
  return total;
}

function PatrolDetail() {
  const { id } = Route.useParams();
  const { appAccess } = Route.useRouteContext();
  const canManage = appAccess.specRole === "security_manager";
  const qc = useQueryClient();
  const navigate = useNavigate();
  const getP = useServerFn(getPatrol);
  const saveWp = useServerFn(saveWaypoints);
  const updP = useServerFn(updatePatrolDetails);
  const archP = useServerFn(archivePatrol);
  const dupP = useServerFn(duplicatePatrol);
  const listSh = useServerFn(listShifts);
  const schedSh = useServerFn(scheduleShift);
  const updSh = useServerFn(updateShift);
  const listCi = useServerFn(listCheckIns);
  const tokenFn = useServerFn(getMapboxToken);

  const { data, isLoading, error } = useQuery({ queryKey: ["patrol", id], queryFn: () => getP({ data: { id } }) });
  const { data: shifts = [] } = useQuery({ queryKey: ["shifts", id], queryFn: () => listSh({ data: { patrol_id: id } }) });
  const { data: checkins = [] } = useQuery({ queryKey: ["checkins", id], queryFn: () => listCi({ data: { patrol_id: id } }) });
  const { data: token } = useQuery({ queryKey: ["mapbox-token"], queryFn: () => tokenFn(), staleTime: Infinity });

  useRealtimeInvalidate("patrol_shifts", [["shifts", id]]);
  useRealtimeInvalidate("patrol_check_ins", [["checkins", id]]);
  useRealtimeInvalidate("patrol_waypoints", [["patrol", id]]);

  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [details, setDetails] = useState<Details>({ name: "", officer: "", shift: "", total_duration_minutes: 60, grace_period_minutes: 10, checkin_method: "gps" });
  const [activeWp, setActiveWp] = useState<number | null>(null);
  const [wpDirty, setWpDirty] = useState(false);
  const [detailsDirty, setDetailsDirty] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const qrStops = useMemo(
    () => ((data?.waypoints ?? []) as any[]).filter((w) => w.id && w.qr_token).sort((a, b) => a.ord - b.ord) as { id: string; name: string; ord: number; qr_token: string }[],
    [data?.waypoints],
  );

  useEffect(() => {
    if (!data) return;
    const p = data.patrol as any;
    if (!detailsDirty) {
      setDetails({
        name: p.name ?? "",
        officer: p.officer ?? "",
        shift: p.shift ?? "",
        total_duration_minutes: p.total_duration_minutes ?? 60,
        grace_period_minutes: p.grace_period_minutes ?? 10,
        checkin_method: (p.checkin_method ?? "gps") as Details["checkin_method"],
      });
    }
    if (!wpDirty) {
      setWaypoints(
        (data.waypoints ?? []).map((w: any) => ({
          id: w.id,
          ord: w.ord,
          name: w.name,
          coord_x: w.coord_x == null ? null : Number(w.coord_x),
          coord_y: w.coord_y == null ? null : Number(w.coord_y),
          expected_minutes: w.expected_minutes ?? 5,
        })),
      );
    }
    // only re-seed from the server when it sends new data; local edits are kept until saved
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const editWaypoints = (fn: (prev: Waypoint[]) => Waypoint[]) => {
    setWpDirty(true);
    setWaypoints((prev) => fn(prev).map((w, idx) => ({ ...w, ord: idx })));
  };
  const editDetails = (patch: Partial<Details>) => {
    setDetailsDirty(true);
    setDetails((d) => ({ ...d, ...patch }));
  };

  // ---------- map ----------
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const canManageRef = useRef(canManage);
  canManageRef.current = canManage;
  const [basemap, setBasemap] = useBasemap();
  const viewRef = useRef<SavedView | null>(null);

  useEffect(() => {
    if (!token?.token || !mapEl.current || mapRef.current || !data) return;
    mapboxgl.accessToken = token.token;
    const first = (data.waypoints ?? []).find((w: any) => w.coord_x != null && w.coord_y != null) as any;
    const v = viewRef.current;
    const m = new mapboxgl.Map({
      container: mapEl.current,
      style: BASEMAP_STYLE[basemap],
      center: v?.center ?? (first ? [Number(first.coord_x), Number(first.coord_y)] : DEFAULT_CENTER),
      zoom: v?.zoom ?? (first ? 15 : 11),
      pitch: v?.pitch ?? 0,
      attributionControl: false,
    });
    m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    if (canManageRef.current) m.getCanvas().style.cursor = "crosshair";
    m.on("load", () => {
      add3DBuildings(m, basemap);
      requestAnimationFrame(() => m.resize());
      setMapReady(true);
    });
    m.on("click", (e) => {
      if (!canManageRef.current) return;
      editWaypoints((prev) => {
        setActiveWp(prev.length);
        return [...prev, { ord: prev.length, name: `Stop ${prev.length + 1}`, coord_x: Number(e.lngLat.lng.toFixed(6)), coord_y: Number(e.lngLat.lat.toFixed(6)), expected_minutes: 2 }];
      });
    });
    mapRef.current = m;
    const ro = new ResizeObserver(() => {
      try {
        m.resize();
      } catch {
        /* map already removed */
      }
    });
    ro.observe(mapEl.current);
    return () => {
      ro.disconnect();
      viewRef.current = saveView(m);
      m.remove();
      mapRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token?.token, !!data, basemap]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m || !mapReady) return;
    markersRef.current.forEach((mk) => mk.remove());
    markersRef.current = [];
    waypoints.forEach((w, i) => {
      if (w.coord_x == null || w.coord_y == null) return;
      const el = document.createElement("button");
      el.type = "button";
      el.setAttribute("aria-label", `Stop ${i + 1}: ${w.name}`);
      const on = activeWp === i;
      el.style.cssText = `width:24px;height:24px;border-radius:12px;background:${on ? "#7A9BFF" : "#3462F0"};color:#fff;display:grid;place-items:center;font:700 11px 'JetBrains Mono',ui-monospace,monospace;border:2px solid #0A0C10;box-shadow:0 0 0 ${on ? 4 : 0}px rgba(122,155,255,.35);cursor:${canManage ? "grab" : "pointer"};padding:0`;
      el.textContent = String(i + 1);
      el.onclick = (e) => {
        e.stopPropagation();
        setActiveWp(i);
      };
      const mk = new mapboxgl.Marker({ element: el, draggable: canManage }).setLngLat([w.coord_x, w.coord_y]).addTo(m);
      mk.on("dragend", () => {
        const ll = mk.getLngLat();
        editWaypoints((prev) => prev.map((p, idx) => (idx === i ? { ...p, coord_x: Number(ll.lng.toFixed(6)), coord_y: Number(ll.lat.toFixed(6)) } : p)));
        setActiveWp(i);
      });
      markersRef.current.push(mk);
    });
    const coords = waypoints.filter((w) => w.coord_x != null && w.coord_y != null).map((w) => [w.coord_x!, w.coord_y!]);
    const geo = { type: "FeatureCollection", features: coords.length >= 2 ? [{ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: {} }] : [] };
    const src = m.getSource("wp-line") as mapboxgl.GeoJSONSource | undefined;
    if (src) src.setData(geo as any);
    else {
      m.addSource("wp-line", { type: "geojson", data: geo as any });
      m.addLayer({ id: "wp-line", type: "line", source: "wp-line", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#7A9BFF", "line-width": 3, "line-dasharray": [2, 1.5] } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waypoints, mapReady, activeWp, canManage]);

  // ---------- mutations ----------
  const saveWpMut = useMutation({
    mutationFn: () => saveWp({ data: { patrol_id: id, waypoints } }),
    onSuccess: () => {
      setWpDirty(false);
      qc.invalidateQueries({ queryKey: ["patrol", id] });
      qc.invalidateQueries({ queryKey: ["patrol-waypoints"] });
      toast.success("Route saved");
    },
    onError: (e: Error) => toast.error(e.message || "Couldn't save the route"),
  });
  const updMut = useMutation({
    mutationFn: () => updP({ data: { id, ...details } }),
    onSuccess: () => {
      setDetailsDirty(false);
      qc.invalidateQueries({ queryKey: ["patrol", id] });
      qc.invalidateQueries({ queryKey: ["patrols"] });
      toast.success("Route details saved");
    },
    onError: (e: Error) => toast.error(e.message || "Couldn't save the details"),
  });
  const archMut = useMutation({
    mutationFn: (archived: boolean) => archP({ data: { id, archived } }),
    onSuccess: (_r, archived) => {
      qc.invalidateQueries({ queryKey: ["patrol", id] });
      qc.invalidateQueries({ queryKey: ["patrols"] });
      toast.success(archived ? "Route archived" : "Route restored");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const dupMut = useMutation({
    mutationFn: () => dupP({ data: { id } }),
    onSuccess: (row: any) => {
      qc.invalidateQueries({ queryKey: ["patrols"] });
      toast.success("Route duplicated");
      if (row?.id) navigate({ to: "/app/patrols/$id", params: { id: row.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const schedMut = useMutation({
    mutationFn: (v: any) => schedSh({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shifts"] });
      setShowSchedule(false);
      toast.success("Shift scheduled");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const shiftMut = useMutation({
    mutationFn: (v: any) => updSh({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shifts"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const stats = useMemo(() => {
    const p = data?.patrol as any;
    const total = Math.max(Number(p?.waypoints ?? 0), waypoints.length);
    const checked = Number(p?.checked_in ?? 0);
    const exceptions = (checkins as any[]).filter((c) => c.status === "late" || c.status === "out_of_zone").length;
    const lateRows = (checkins as any[]).filter((c) => Number(c.minutes_late ?? 0) > 0);
    const avgLate = lateRows.length ? Math.round(lateRows.reduce((a, c) => a + Number(c.minutes_late), 0) / lateRows.length) : null;
    const plannedMinutes = waypoints.reduce((a, w) => a + Number(w.expected_minutes || 0), 0);
    return { total, checked, completion: total ? Math.round((checked / total) * 100) : 0, exceptions, avgLate, plannedMinutes, length: routeLength(waypoints) };
  }, [data?.patrol, waypoints, checkins]);

  if (error) {
    return (
      <Panel>
        <Empty>
          This route couldn't be loaded. {(error as Error).message}{" "}
          <Link to="/app/patrols" className="lnk">
            Back to patrols
          </Link>
        </Empty>
      </Panel>
    );
  }
  if (isLoading || !data) {
    return (
      <Panel>
        <Empty>
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading route…
        </Empty>
      </Panel>
    );
  }
  const p = data.patrol as any;
  const archived = !!p.archived_at;
  const active = activeWp != null ? waypoints[activeWp] : null;
  const unplaced = waypoints.filter((w) => w.coord_x == null || w.coord_y == null).length;

  return (
    <div className="col g16">
      <div className="row g8 wrap">
        <Link to="/app/patrols" className="row g4 t3 lnk">
          <ChevronLeft className="h-3.5 w-3.5" /> Patrols
        </Link>
        <span className="t3">/</span>
        <span className="mono t3">{p.code}</span>
      </div>

      <div className="row g12 wrap">
        <h1 className="ph1">{canManage ? "Edit route" : "Route"} · {details.name || p.name}</h1>
        {archived ? <Tag>Archived</Tag> : <Tag tone={(STATUS_TONE[p.status] ?? "blue") as any}>{words(p.status) || "unknown"}</Tag>}
        <span className="flex-auto" />
        {canManage && (
          <>
            <button type="button" className="b b-gh" onClick={() => dupMut.mutate()} disabled={dupMut.isPending}>
              <Copy className="h-4 w-4" /> Duplicate
            </button>
            <button type="button" className="b b-sec" onClick={() => archMut.mutate(!archived)} disabled={archMut.isPending}>
              {archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
              {archived ? "Restore" : "Archive"}
            </button>
          </>
        )}
      </div>

      <div className="kpis">
        <Kpi label="Progress" value={`${stats.checked}/${stats.total}`} unit={`· ${stats.completion}%`} title="Waypoints checked in on the current round" />
        <Kpi label="Stops" value={waypoints.length} unit={stats.length ? `· ${(stats.length / 1000).toFixed(2)} km` : undefined} title="Straight-line distance between consecutive stops" />
        <Kpi label="Planned walk" value={stats.plannedMinutes || "—"} unit={stats.plannedMinutes ? "min" : undefined} title="Sum of expected minutes at each stop" />
        <Kpi label="Check-ins" value={(checkins as any[]).length} />
        <Kpi label="Exceptions" value={stats.exceptions} title="Late or out-of-zone check-ins" />
        <Kpi label="Avg lateness" value={stats.avgLate ?? "—"} unit={stats.avgLate != null ? "min" : undefined} title="Average minutes late across late check-ins" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="col g12" style={{ minWidth: 0 }}>
          {token?.token ? (
            <div className="map" style={{ minHeight: 520 }}>
              <div ref={mapEl} style={{ position: "absolute", inset: 0 }} />
              <BasemapSwitch value={basemap} onChange={setBasemap} style={{ right: 10, bottom: 10 }} />
              {canManage && (
                <div className="glass row g8" style={{ position: "absolute", left: 10, top: 10, padding: "6px 10px", fontSize: 12, maxWidth: "calc(100% - 70px)" }}>
                  Click the map to add a stop. Drag a stop to move it.
                </div>
              )}
              {unplaced > 0 && (
                <div className="glass" style={{ position: "absolute", left: 10, bottom: 10, padding: "6px 10px", fontSize: 12 }}>
                  {unplaced} stop{unplaced === 1 ? " has" : "s have"} no position yet
                </div>
              )}
            </div>
          ) : (
            <div className="map" style={{ minHeight: 240 }}>
              <Empty>The map needs a Mapbox token. You can still enter stop coordinates by hand on the right.</Empty>
            </div>
          )}

          <Panel
            title="Shift schedule"
            meta={`${(shifts as any[]).length}`}
            actions={
              canManage ? (
                <button type="button" className="b b-sm b-sec" onClick={() => setShowSchedule((o) => !o)}>
                  <CalendarPlus className="h-3.5 w-3.5" /> Schedule
                </button>
              ) : undefined
            }
            bodyClassName=""
          >
            {showSchedule && canManage && (
              <div className="pn-b">
                <ScheduleShiftForm
                  patrolId={id}
                  defaultOfficer={details.officer}
                  loading={schedMut.isPending}
                  onCancel={() => setShowSchedule(false)}
                  onSchedule={(v) => schedMut.mutate(v)}
                />
              </div>
            )}
            {(shifts as any[]).length === 0 ? (
              <Empty>No shifts scheduled for this route.</Empty>
            ) : (
              <div className="scroll">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Officer</th>
                      <th>Start</th>
                      <th>End</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {(shifts as any[]).map((s) => (
                      <ShiftRow key={s.id} shift={s} canManage={canManage} loading={shiftMut.isPending} onAction={(v) => shiftMut.mutate({ id: s.id, ...v })} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Check-in log" meta={`${(checkins as any[]).length}`} bodyClassName="">
            {(checkins as any[]).length === 0 ? (
              <Empty>No check-ins yet. Officers check in from the officer app.</Empty>
            ) : (
              <div className="list scroll" style={{ maxHeight: 360 }}>
                {(checkins as any[]).map((c) => (
                  <div key={c.id} className="row g10" style={{ padding: "10px 14px" }}>
                    <Avatar name={c.officer_name} />
                    <span className="f1 col" style={{ minWidth: 0 }}>
                      <b className="trunc">{c.officer_name ?? "Officer"}</b>
                      <span className="t3">
                        {String(c.method ?? "").toUpperCase()}
                        {c.distance_m != null ? ` · ${Math.round(c.distance_m)} m from stop` : ""}
                        {Number(c.minutes_late) > 0 ? ` · ${c.minutes_late} min late` : ""}
                      </span>
                    </span>
                    <span className="mono t3" style={{ fontSize: 11 }}>
                      {new Date(c.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    {c.status && <Tag tone={CHECKIN_TONE[c.status]}>{words(c.status)}</Tag>}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <aside className="col g12">
          <Panel
            title="Route details"
            actions={
              canManage ? (
                <button type="button" className="b b-sm b-pri" onClick={() => updMut.mutate()} disabled={!detailsDirty || updMut.isPending}>
                  {updMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
                </button>
              ) : undefined
            }
          >
            <fieldset disabled={!canManage} className="col g12" style={{ border: 0, padding: 0, margin: 0 }}>
              <label className="fl">
                <span className="lbl">Route name</span>
                <input className="in" value={details.name} onChange={(e) => editDetails({ name: e.target.value })} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="fl">
                  <span className="lbl">Code</span>
                  <input className="in mono" value={p.code ?? ""} readOnly aria-readonly="true" />
                </label>
                <label className="fl">
                  <span className="lbl">Shift window</span>
                  <input className="in mono" value={details.shift} onChange={(e) => editDetails({ shift: e.target.value })} placeholder="18:00 – 06:00" />
                </label>
                <label className="fl">
                  <span className="lbl">Round length (min)</span>
                  <input className="in" type="number" min={5} max={720} value={details.total_duration_minutes} onChange={(e) => editDetails({ total_duration_minutes: Number(e.target.value) })} />
                </label>
                <label className="fl">
                  <span className="lbl">Grace period (min)</span>
                  <input className="in" type="number" min={1} max={60} value={details.grace_period_minutes} onChange={(e) => editDetails({ grace_period_minutes: Number(e.target.value) })} />
                </label>
              </div>
              <label className="fl">
                <span className="lbl">Default officer</span>
                <input className="in" value={details.officer} onChange={(e) => editDetails({ officer: e.target.value })} />
              </label>
              <div className="fl">
                <span className="lbl">Check-in method</span>
                <div className="seg" role="group" aria-label="Check-in method" style={{ display: "flex" }}>
                  {METHODS.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      className={`f1${details.checkin_method === m.value ? " on" : ""}`}
                      aria-pressed={details.checkin_method === m.value}
                      onClick={() => editDetails({ checkin_method: m.value })}
                      style={{ justifyContent: "center" }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            </fieldset>
          </Panel>

          <Panel
            title="Stops"
            meta={`${waypoints.length}${stats.length ? ` · ${(stats.length / 1000).toFixed(2)} km` : ""}`}
            actions={
              canManage ? (
                <>
                  <button
                    type="button"
                    className="b b-sm b-gh"
                    onClick={() => setShowQr(true)}
                    disabled={wpDirty || !qrStops.length}
                    title={wpDirty ? "Save the route first" : !qrStops.length ? "Add and save stops first" : "Print a QR code for each stop"}
                  >
                    <QrCode className="h-3.5 w-3.5" /> QR codes
                  </button>
                  <button type="button" className="b b-sm b-pri" onClick={() => saveWpMut.mutate()} disabled={!wpDirty || saveWpMut.isPending}>
                    {saveWpMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save route
                  </button>
                </>
              ) : undefined
            }
            bodyClassName=""
          >
            {wpDirty && (
              <div className="pn-b" style={{ paddingBottom: 0 }}>
                <Notice tone="warn">You have unsaved changes to the stops.</Notice>
              </div>
            )}
            {waypoints.length === 0 ? (
              <Empty>{canManage ? "No stops yet. Click the map or add one below." : "This route has no stops yet."}</Empty>
            ) : (
              <ol className="list scroll" style={{ maxHeight: 360, margin: 0, padding: 0, listStyle: "none" }}>
                {waypoints.map((w, i) => (
                  <li key={w.id ?? `new-${i}`} className="row g10" style={{ padding: "8px 14px", background: activeWp === i ? "var(--ink-2)" : undefined }}>
                    <button
                      type="button"
                      onClick={() => setActiveWp(activeWp === i ? null : i)}
                      aria-pressed={activeWp === i}
                      aria-label={`Select stop ${i + 1}`}
                      className="mono"
                      style={{ width: 22, height: 22, borderRadius: 11, background: "var(--blue)", color: "#fff", fontSize: 11, fontWeight: 700, display: "grid", placeItems: "center", flex: "none", border: 0 }}
                    >
                      {i + 1}
                    </button>
                    <button type="button" className="f1 trunc text-left" onClick={() => setActiveWp(activeWp === i ? null : i)} style={{ background: "none", border: 0, color: "inherit", padding: 0 }}>
                      {w.name || `Stop ${i + 1}`}
                    </button>
                    <span className="mono t2" style={{ fontSize: 12 }}>
                      {w.expected_minutes} min
                    </span>
                    {(w.coord_x == null || w.coord_y == null) && <Tag tone="warn">No position</Tag>}
                  </li>
                ))}
              </ol>
            )}
            {active && activeWp != null && (
              <div className="pn-b col g10" style={{ borderTop: "1px solid var(--line-1)" }}>
                <div className="row g8">
                  <b className="f1">Stop {activeWp + 1}</b>
                  {canManage && (
                    <>
                      <button type="button" className="ibtn" style={{ width: 28, height: 28 }} aria-label="Move stop up" disabled={activeWp === 0} onClick={() => move(activeWp, -1)}>
                        <ArrowUp size={14} />
                      </button>
                      <button type="button" className="ibtn" style={{ width: 28, height: 28 }} aria-label="Move stop down" disabled={activeWp === waypoints.length - 1} onClick={() => move(activeWp, 1)}>
                        <ArrowDown size={14} />
                      </button>
                      <button type="button" className="ibtn" style={{ width: 28, height: 28 }} aria-label="Remove stop" onClick={() => removeWp(activeWp)}>
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                  <button type="button" className="ibtn" style={{ width: 28, height: 28 }} aria-label="Close stop editor" onClick={() => setActiveWp(null)}>
                    <X size={14} />
                  </button>
                </div>
                {canManage && active.id && (
                  <span className="t3" style={{ fontSize: 12 }}>
                    Removing a saved stop also removes its check-in history and makes its printed QR code stop working.
                  </span>
                )}
                <fieldset disabled={!canManage} className="col g10" style={{ border: 0, padding: 0, margin: 0 }}>
                  <label className="fl">
                    <span className="lbl">Name</span>
                    <input className="in" value={active.name} onChange={(e) => updateWp(activeWp, { name: e.target.value })} />
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <label className="fl">
                      <span className="lbl">Longitude</span>
                      <input className="in mono" type="number" step="0.000001" value={active.coord_x ?? ""} onChange={(e) => updateWp(activeWp, { coord_x: e.target.value === "" ? null : Number(e.target.value) })} />
                    </label>
                    <label className="fl">
                      <span className="lbl">Latitude</span>
                      <input className="in mono" type="number" step="0.000001" value={active.coord_y ?? ""} onChange={(e) => updateWp(activeWp, { coord_y: e.target.value === "" ? null : Number(e.target.value) })} />
                    </label>
                    <label className="fl">
                      <span className="lbl">Minutes</span>
                      <input className="in" type="number" min={1} max={120} value={active.expected_minutes} onChange={(e) => updateWp(activeWp, { expected_minutes: Number(e.target.value) })} />
                    </label>
                  </div>
                </fieldset>
              </div>
            )}
            {canManage && (
              <div className="pn-b">
                <button type="button" className="b b-gh w-full" style={{ justifyContent: "center", borderStyle: "dashed" }} onClick={addWp}>
                  <Plus className="h-4 w-4" /> Add stop without a position
                </button>
              </div>
            )}
          </Panel>
        </aside>
      </div>
      {showQr && <QrSheet code={p.code} name={details.name || p.name} stops={qrStops} onClose={() => setShowQr(false)} />}
    </div>
  );

  function addWp() {
    editWaypoints((prev) => {
      setActiveWp(prev.length);
      return [...prev, { ord: prev.length, name: `Stop ${prev.length + 1}`, coord_x: null, coord_y: null, expected_minutes: 2 }];
    });
  }
  function removeWp(i: number) {
    editWaypoints((prev) => prev.filter((_, idx) => idx !== i));
    setActiveWp(null);
  }
  function updateWp(i: number, patch: Partial<Waypoint>) {
    editWaypoints((prev) => prev.map((w, idx) => (idx === i ? { ...w, ...patch } : w)));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    editWaypoints((prev) => {
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setActiveWp(j);
  }
}

function ShiftRow({ shift, onAction, loading, canManage }: { shift: any; onAction: (v: any) => void; loading: boolean; canManage: boolean }) {
  const [notes, setNotes] = useState(shift.handover_notes ?? "");
  const [open, setOpen] = useState(false);
  const status = shift.status as string;
  const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <>
      <tr>
        <td>
          <span className="row g8">
            <Avatar name={shift.officer_name} />
            <b>{shift.officer_name}</b>
          </span>
        </td>
        <td className="mono t2">{fmt(shift.scheduled_start)}</td>
        <td className="mono t2">{fmt(shift.scheduled_end)}</td>
        <td>
          <Status tone={SHIFT_TONE[status] ?? "neutral"}>{words(status)}</Status>
        </td>
        <td>
          <span className="row g6" style={{ justifyContent: "flex-end" }}>
            {canManage && status === "scheduled" && (
              <button type="button" className="b b-sm b-sec" onClick={() => onAction({ start: true })} disabled={loading}>
                <PlayCircle className="h-3.5 w-3.5" /> Start
              </button>
            )}
            {canManage && status === "active" && (
              <button type="button" className="b b-sm b-sec" onClick={() => onAction({ end: true })} disabled={loading}>
                <StopCircle className="h-3.5 w-3.5" /> End
              </button>
            )}
            {(canManage || shift.handover_notes) && (
              <button type="button" className="b b-sm b-gh" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
                Handover
              </button>
            )}
          </span>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5}>
            <div className="col g8">
              <textarea className="in" rows={3} value={notes} readOnly={!canManage} onChange={(e) => setNotes(e.target.value)} placeholder="Handover notes for the next officer…" style={{ height: "auto", paddingTop: 8 }} />
              {canManage && (
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <button type="button" className="b b-sm b-pri" onClick={() => onAction({ handover_notes: notes })} disabled={loading}>
                    <Save className="h-3.5 w-3.5" /> Save notes
                  </button>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function ScheduleShiftForm({
  onSchedule,
  onCancel,
  loading,
  patrolId,
  defaultOfficer,
}: {
  onSchedule: (v: any) => void;
  onCancel: () => void;
  loading: boolean;
  patrolId: string;
  defaultOfficer: string;
}) {
  const [form, setForm] = useState({
    officer_name: defaultOfficer || "",
    scheduled_start: toLocalInput(new Date(Date.now() + 3600_000)),
    scheduled_end: toLocalInput(new Date(Date.now() + 3600_000 * 9)),
    repeat_days: 1,
  });
  const endBeforeStart = new Date(form.scheduled_end).getTime() <= new Date(form.scheduled_start).getTime();
  return (
    <div className="col g10">
      <div className="grid gap-3 md:grid-cols-4">
        <label className="fl">
          <span className="lbl">Officer</span>
          <input className="in" value={form.officer_name} onChange={(e) => setForm({ ...form, officer_name: e.target.value })} />
        </label>
        <label className="fl">
          <span className="lbl">Start</span>
          <input className="in" type="datetime-local" value={form.scheduled_start} onChange={(e) => setForm({ ...form, scheduled_start: e.target.value })} />
        </label>
        <label className="fl">
          <span className="lbl">End</span>
          <input className="in" type="datetime-local" value={form.scheduled_end} onChange={(e) => setForm({ ...form, scheduled_end: e.target.value })} />
        </label>
        <label className="fl">
          <span className="lbl">Repeat for (days)</span>
          <input className="in" type="number" min={1} max={30} value={form.repeat_days} onChange={(e) => setForm({ ...form, repeat_days: Number(e.target.value) })} />
        </label>
      </div>
      {endBeforeStart && <Notice tone="warn">The shift has to end after it starts.</Notice>}
      <div className="row g8" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="b b-sm b-gh" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="b b-sm b-pri"
          disabled={loading || !form.officer_name || endBeforeStart}
          onClick={() =>
            onSchedule({
              patrol_id: patrolId,
              officer_name: form.officer_name,
              scheduled_start: new Date(form.scheduled_start).toISOString(),
              scheduled_end: new Date(form.scheduled_end).toISOString(),
              repeat_days: form.repeat_days,
            })
          }
        >
          {loading ? "Scheduling…" : "Schedule shift"}
        </button>
      </div>
    </div>
  );
}

function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** A printable sheet with one QR code per saved stop. Only the sheet prints. */
function QrSheet({ code, name, stops, onClose }: { code: string; name: string; stops: { id: string; name: string; ord: number; qr_token: string }[]; onClose: () => void }) {
  const [images, setImages] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const QR = (await import("qrcode")).default;
        const out: Record<string, string> = {};
        for (const s of stops) out[s.id] = await QR.toDataURL(encodeCheckpoint(s.id, s.qr_token), { width: 360, margin: 1, errorCorrectionLevel: "M" });
        if (!cancelled) setImages(out);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stops]);
  const ready = Object.keys(images).length === stops.length;

  return (
    <div className="fixed inset-0 z-50 overflow-auto" style={{ background: "rgba(5,7,10,.8)" }} role="dialog" aria-modal="true" aria-label="Checkpoint QR codes">
      <style>{`@media print { body * { visibility: hidden !important; } #qr-sheet, #qr-sheet * { visibility: visible !important; } #qr-sheet { position: absolute; inset: 0 auto auto 0; width: 100%; padding: 0 !important; } .qr-card { break-inside: avoid; } }`}</style>
      <div className="row g8" style={{ position: "sticky", top: 0, padding: 12, justifyContent: "flex-end", background: "var(--ink-1)", borderBottom: "1px solid var(--line-1)" }}>
        <span className="t2 f1" style={{ fontSize: 13 }}>
          Print, laminate and fix each code at its stop. Officers scan it with the officer app to check in.
        </span>
        <button type="button" className="b b-pri" onClick={() => window.print()} disabled={!ready}>
          {!ready && !failed && <Loader2 className="h-4 w-4 animate-spin" />} Print
        </button>
        <button type="button" className="b b-gh" onClick={onClose}>
          Close
        </button>
      </div>
      <div id="qr-sheet" className="paper" style={{ maxWidth: 820, margin: "20px auto", padding: 24, borderRadius: 10 }}>
        {failed && <p>Couldn't generate the codes. Close this and try again.</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          {stops.map((s, i) => (
            <div key={s.id} className="qr-card col" style={{ border: "1px solid var(--paper-2)", borderRadius: 10, padding: 16, alignItems: "center", textAlign: "center", gap: 6 }}>
              <span style={{ fontSize: 11, letterSpacing: ".08em", fontWeight: 700 }}>LEMTIK CHECKPOINT</span>
              {images[s.id] ? <img src={images[s.id]} alt={`QR code for ${s.name}`} style={{ width: 200, height: 200 }} /> : <div style={{ width: 200, height: 200 }} />}
              <b style={{ fontSize: 17 }}>
                {i + 1}. {s.name}
              </b>
              <span className="t2" style={{ fontSize: 12 }}>
                {code} · {name}
              </span>
              <span className="t3" style={{ fontSize: 11 }}>
                Scan with the Lemtik officer app. Do not move this code.
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
