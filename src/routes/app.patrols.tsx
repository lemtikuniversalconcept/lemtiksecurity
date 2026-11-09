import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { createPatrol, listCheckIns, listPatrols, listPatrolWaypoints, listShifts, scheduleShift } from "@/lib/patrols.functions";
import { getMapboxToken } from "@/lib/config.functions";
import { listLocations } from "@/lib/orgs.functions";
import { add3DBuildings, BASEMAP_STYLE, BasemapSwitch, saveView, useBasemap, type SavedView } from "@/lib/basemap";
import { useRealtimeInvalidate } from "@/lib/useRealtime";
import { requireSectionAccess } from "@/lib/rbac";
import { Archive, CalendarDays, Download, Lock, Map as MapIcon, Pencil, Plus, Loader2, X } from "lucide-react";
import { Avatar, Empty, Kpi, Notice, PageHeader, Panel, Status, Tabs, Tag, type Tone } from "@/components/nw";

export const Route = createFileRoute("/app/patrols")({
  head: () => ({ meta: [{ title: "Patrols · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    const appAccess = context.appAccess;
    requireSectionAccess(appAccess, ["security_manager", "operator", "client_admin"]);
    return { appAccess };
  },
  component: Patrols,
});

const STATUS_TONE: Record<string, Tone> = { on_route: "ok", delayed: "warn", missed: "fail", complete: "off" };
const STATUS_COLOR: Record<string, string> = { on_route: "#2FBF71", delayed: "#F5A524", missed: "#F2384B", complete: "#5B6577" };
const statusLabel = (s: unknown) => String(s ?? "unknown").replace(/_/g, " ");
const completionOf = (p: any) => Math.round((Number(p.checked_in ?? 0) / Math.max(Number(p.waypoints ?? 1), 1)) * 100);
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
// next_check_in is stored either as a timestamp or as a free-text time ("23:40").
const fmtNext = (v: unknown) => {
  if (v == null || v === "") return "—";
  const t = Date.parse(String(v));
  return Number.isNaN(t) || !/\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v) : hhmm(String(v));
};

type PatrolView = "live" | "schedule" | "routes" | "history";
type ScheduleDraft = {
  patrol_id: string;
  officer_name: string;
  scheduled_start: string;
  scheduled_end: string;
  repeat_days: number;
};
type WaypointRow = { patrol_id: string; ord: number; name: string | null; coord_x: number | null; coord_y: number | null };

function Patrols() {
  const { appAccess } = Route.useRouteContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isDetailRoute = pathname.startsWith("/app/patrols/") && pathname !== "/app/patrols";

  if (isDetailRoute) {
    return <Outlet />;
  }

  return <PatrolsList appAccess={appAccess} />;
}

// app.patrols.$id is a nested child route of this one — see the identical
// comment in app.users.tsx for why this split (rather than an early return
// among this component's own hooks) is required.
function PatrolsList({ appAccess }: { appAccess: ReturnType<typeof Route.useRouteContext>["appAccess"] }) {
  const canManage = appAccess.specRole === "security_manager";
  const navigate = useNavigate();
  const qc = useQueryClient();

  const listPat = useServerFn(listPatrols);
  const createPat = useServerFn(createPatrol);
  const listShiftsFn = useServerFn(listShifts);
  const scheduleFn = useServerFn(scheduleShift);
  const listCheckInsFn = useServerFn(listCheckIns);
  const listLocationsFn = useServerFn(listLocations);
  const listWaypointsFn = useServerFn(listPatrolWaypoints);
  const mapboxTokenFn = useServerFn(getMapboxToken);

  const [view, setView] = useState<PatrolView>("live");
  const [showRouteDialog, setShowRouteDialog] = useState(false);
  const [showShiftDialog, setShowShiftDialog] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useRealtimeInvalidate("patrols", [["patrols"]]);
  useRealtimeInvalidate("patrol_shifts", [["shifts"]]);
  useRealtimeInvalidate("patrol_check_ins", [["checkins"]]);
  useRealtimeInvalidate("organisation_locations", [["locations"]]);
  useRealtimeInvalidate("patrol_waypoints", [["patrol-waypoints"]]);

  const { data: patrolRows = [], isLoading, error: patrolsError } = useQuery({ queryKey: ["patrols"], queryFn: () => listPat() });
  const { data: shifts = [] } = useQuery({ queryKey: ["shifts"], queryFn: () => listShiftsFn({ data: {} }) });
  const { data: checkins = [] } = useQuery({ queryKey: ["checkins"], queryFn: () => listCheckInsFn({ data: {} }) });
  const { data: locations = [] } = useQuery({ queryKey: ["locations"], queryFn: () => listLocationsFn() });
  const { data: waypoints = [] } = useQuery({ queryKey: ["patrol-waypoints"], queryFn: () => listWaypointsFn() });
  const { data: tokenData } = useQuery({ queryKey: ["mapbox-token"], queryFn: () => mapboxTokenFn(), staleTime: Infinity });

  const patrols = useMemo(
    () => (patrolRows as any[]).filter((patrol) => (showArchived ? !!patrol.archived_at : !patrol.archived_at)),
    [patrolRows, showArchived],
  );
  const locationById = useMemo(() => new globalThis.Map((locations as any[]).map((loc) => [loc.id, loc])), [locations]);
  const latestCheckInByPatrol = useMemo(() => {
    const map = new globalThis.Map<string, any>();
    for (const checkIn of checkins as any[]) {
      const patrolId = checkIn.patrol_id || checkIn.patrolId;
      if (!patrolId) continue;
      const prev = map.get(patrolId);
      if (!prev || new Date(checkIn.created_at).getTime() > new Date(prev.created_at).getTime()) map.set(patrolId, checkIn);
    }
    return map;
  }, [checkins]);
  const activePatrols = useMemo(() => patrols.filter((p) => p.status !== "complete"), [patrols]);
  const missedCount = patrols.filter((p) => p.status === "missed").length;
  const delayedCount = patrols.filter((p) => p.status === "delayed").length;
  const completeCount = patrols.filter((p) => p.status === "complete").length;
  const avgCompletion = patrols.length ? Math.round(patrols.reduce((acc, p) => acc + completionOf(p), 0) / patrols.length) : null;
  const exceptions = useMemo(
    () => (checkins as any[]).filter((c) => c.status === "late" || c.status === "out_of_zone"),
    [checkins],
  );

  const historyRows = useMemo(
    () =>
      [...patrols]
        .map((patrol) => ({
          ...patrol,
          completion: completionOf(patrol),
          missed: exceptions.filter((c) => c.patrol_id === patrol.id).length,
        }))
        .sort((a, b) => b.completion - a.completion),
    [exceptions, patrols],
  );
  const upcomingShifts = useMemo(() => {
    const now = Date.now();
    const week = now + 7 * 24 * 3600_000;
    return (shifts as any[])
      .filter((shift) => {
        const start = new Date(shift.scheduled_start).getTime();
        return start >= now && start <= week;
      })
      .sort((a, b) => new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime());
  }, [shifts]);
  const laterShifts = useMemo(() => {
    const cutoff = Date.now() + 7 * 24 * 3600_000;
    return (shifts as any[]).filter((shift) => new Date(shift.scheduled_start).getTime() > cutoff);
  }, [shifts]);

  const selected = activePatrols.find((p) => p.id === selectedId) ?? null;

  const createRouteMut = useMutation({
    mutationFn: (data: { code: string; name: string; officer: string; shift: string; waypoints: number }) => createPat({ data }),
    onSuccess: (row: any) => {
      qc.invalidateQueries({ queryKey: ["patrols"] });
      setShowRouteDialog(false);
      if (row?.id) navigate({ to: "/app/patrols/$id", params: { id: row.id } });
    },
  });
  const createShiftMut = useMutation({
    mutationFn: (data: ScheduleDraft) => scheduleFn({ data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shifts"] });
      setShowShiftDialog(false);
    },
  });

  const sub = isLoading
    ? "Loading patrols…"
    : `${activePatrols.length} route${activePatrols.length === 1 ? "" : "s"} active · ${upcomingShifts.length} shift${upcomingShifts.length === 1 ? "" : "s"} in the next 7 days${
        avgCompletion !== null ? ` · average completion ${avgCompletion}%` : ""
      }`;

  return (
    <div className="col g16">
      <PageHeader title="Patrols" sub={sub}>
        <button type="button" className={`b ${showArchived ? "b-sec" : "b-gh"}`} aria-pressed={showArchived} onClick={() => setShowArchived((v) => !v)}>
          <Archive className="h-4 w-4" /> {showArchived ? "Showing archived" : "Show archived"}
        </button>
        {canManage ? (
          <>
            <button type="button" className="b b-sec" onClick={() => setShowShiftDialog(true)} disabled={patrols.length === 0} title={patrols.length === 0 ? "Create a route first" : undefined}>
              <CalendarDays className="h-4 w-4" /> Create shift
            </button>
            <button type="button" className="b b-pri" onClick={() => setShowRouteDialog(true)}>
              <Plus className="h-4 w-4" /> New route
            </button>
          </>
        ) : (
          <span className="tg">
            <Lock className="h-3.5 w-3.5" /> View only
          </span>
        )}
      </PageHeader>

      <Tabs
        label="Patrol views"
        value={view}
        onChange={setView}
        tabs={[
          { value: "live", label: "Live", count: activePatrols.length },
          { value: "schedule", label: "Schedule", count: upcomingShifts.length },
          { value: "routes", label: "Routes", count: patrols.length },
          { value: "history", label: "History" },
        ]}
      />

      <div className="kpis">
        <Kpi label="Routes active" value={isLoading ? "—" : activePatrols.length} />
        <Kpi label="Avg completion" value={avgCompletion ?? "—"} unit={avgCompletion !== null ? "%" : undefined} title="Checked-in waypoints ÷ total waypoints, averaged across visible routes" />
        <Kpi label="Delayed" value={isLoading ? "—" : delayedCount} />
        <Kpi label="Missed" value={isLoading ? "—" : missedCount} />
        <Kpi label="Check-in exceptions" value={isLoading ? "—" : exceptions.length} title="Check-ins logged late or out of zone" />
        <Kpi label="Complete" value={isLoading ? "—" : completeCount} />
      </div>

      {patrolsError ? (
        <Panel>
          <Empty>Patrols couldn't be loaded. {(patrolsError as Error).message}</Empty>
        </Panel>
      ) : isLoading ? (
        <Panel>
          <Empty>
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading patrols…
          </Empty>
        </Panel>
      ) : patrols.length === 0 ? (
        <Panel>
          <Empty>
            {showArchived ? "No archived routes." : "No patrol routes yet. Create the first route to start tracking check-ins."}
          </Empty>
        </Panel>
      ) : null}

      {!isLoading && patrols.length > 0 && view === "live" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
          <LivePatrolMap
            patrols={activePatrols}
            waypoints={waypoints as WaypointRow[]}
            locationById={locationById}
            token={tokenData?.token ?? ""}
            selectedId={selectedId}
          />
          <Panel title="Active routes" meta={`${activePatrols.length}`} bodyClassName="">
            {activePatrols.length === 0 ? (
              <Empty>No routes are active right now.</Empty>
            ) : (
              <div className="list">
                {activePatrols.map((patrol) => {
                  const last = latestCheckInByPatrol.get(patrol.id);
                  const location = patrol.location_id ? locationById.get(patrol.location_id) : null;
                  return (
                    <button
                      key={patrol.id}
                      type="button"
                      className="row g10 w-full text-left"
                      style={{ padding: "10px 14px", background: selectedId === patrol.id ? "var(--ink-2)" : undefined }}
                      aria-pressed={selectedId === patrol.id}
                      onClick={() => setSelectedId((cur) => (cur === patrol.id ? null : patrol.id))}
                    >
                      <Avatar name={patrol.officer} />
                      <span className="f1 col" style={{ minWidth: 0 }}>
                        <span className="row g8">
                          <b className="trunc">{patrol.officer || "Unassigned"}</b>
                          <span className="mono t3">{patrol.code}</span>
                        </span>
                        <span className="t3 trunc">
                          {patrol.name} · {patrol.checked_in ?? 0} of {patrol.waypoints ?? 0}
                          {location ? ` · ${location.name}` : ""}
                          {last?.created_at ? ` · last check-in ${hhmm(last.created_at)}` : ""}
                        </span>
                      </span>
                      <Tag tone={(STATUS_TONE[patrol.status] ?? "blue") as any}>{statusLabel(patrol.status)}</Tag>
                    </button>
                  );
                })}
              </div>
            )}
            {selected && (
              <>
                <div className="hr" />
                <div className="col g10 pn-b">
                  <div className="row g10">
                    <Avatar name={selected.officer} size="lg" own />
                    <div className="f1" style={{ minWidth: 0 }}>
                      <b>
                        {selected.officer || "Unassigned"} · {selected.code}
                      </b>
                      <div className="t3 trunc">
                        {selected.name} · {selected.shift}
                      </div>
                    </div>
                    <Link to="/app/patrols/$id" params={{ id: selected.id }} className="b b-sm b-sec">
                      Open route
                    </Link>
                  </div>
                  <ProgressBar patrol={selected} />
                  <div className="row g16 wrap t2">
                    <span>
                      Waypoints <b className="mono">{selected.checked_in ?? 0}/{selected.waypoints ?? 0}</b>
                    </span>
                    <span>
                      Next check-in <b className="mono">{fmtNext(selected.next_check_in)}</b>
                    </span>
                    <span>
                      Last check-in{" "}
                      <b className="mono">{latestCheckInByPatrol.get(selected.id)?.created_at ? hhmm(latestCheckInByPatrol.get(selected.id).created_at) : "—"}</b>
                    </span>
                  </div>
                </div>
              </>
            )}
          </Panel>
        </div>
      )}

      {!isLoading && patrols.length > 0 && view === "schedule" && (
        <Panel
          title="Shift schedule"
          meta="Next 7 days"
          actions={
            canManage ? (
              <button type="button" className="b b-sm b-sec" onClick={() => setShowShiftDialog(true)}>
                <CalendarDays className="h-3.5 w-3.5" /> Create shift
              </button>
            ) : undefined
          }
          bodyClassName=""
        >
          {upcomingShifts.length === 0 ? (
            <Empty>No shifts scheduled in the next 7 days.</Empty>
          ) : (
            <div className="scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Officer</th>
                    <th>Route</th>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Repeats</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {upcomingShifts.map((shift: any) => (
                    <tr key={shift.id}>
                      <td>
                        <span className="row g8">
                          <Avatar name={shift.officer_name} />
                          <b>{shift.officer_name}</b>
                        </span>
                      </td>
                      <td className="mono">{shift.patrol_code ?? "—"}</td>
                      <td>{new Date(shift.scheduled_start).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })}</td>
                      <td className="mono">
                        {hhmm(shift.scheduled_start)}–{hhmm(shift.scheduled_end)}
                      </td>
                      <td className="t2">{shift.repeat_days ? `${shift.repeat_days} day${shift.repeat_days === 1 ? "" : "s"}` : "One-off"}</td>
                      <td>
                        <Status tone="blue">{statusLabel(shift.status)}</Status>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {laterShifts.length > 0 && <div className="pn-b t3">{laterShifts.length} later shift{laterShifts.length === 1 ? "" : "s"} queued beyond 7 days.</div>}
        </Panel>
      )}

      {!isLoading && patrols.length > 0 && view === "routes" && (
        <Panel title="Patrol routes" meta={`${patrols.length}`} bodyClassName="">
          <div className="scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Route</th>
                  <th>Officer</th>
                  <th>Shift</th>
                  <th>Base location</th>
                  <th>Progress</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {patrols.map((patrol: any) => {
                  const location = patrol.location_id ? locationById.get(patrol.location_id) : null;
                  return (
                    <tr key={patrol.id}>
                      <td>
                        <div className="col">
                          <b>{patrol.name}</b>
                          <span className="mono t3">{patrol.code}</span>
                        </div>
                      </td>
                      <td>{patrol.officer || "—"}</td>
                      <td className="mono t2">{patrol.shift || "—"}</td>
                      <td className="t2">{location?.name ?? "—"}</td>
                      <td style={{ minWidth: 140 }}>
                        <ProgressBar patrol={patrol} />
                      </td>
                      <td>
                        <Status tone={STATUS_TONE[patrol.status] ?? "blue"}>{statusLabel(patrol.status)}</Status>
                      </td>
                      <td>
                        <span className="row g6">
                          <Link to="/app/patrols/$id" params={{ id: patrol.id }} className="b b-sm b-gh">
                            <MapIcon className="h-3.5 w-3.5" /> View
                          </Link>
                          {canManage && (
                            <Link to="/app/patrols/$id" params={{ id: patrol.id }} className="b b-sm b-gh">
                              <Pencil className="h-3.5 w-3.5" /> Edit
                            </Link>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {!isLoading && patrols.length > 0 && view === "history" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,1fr)]">
          <Panel
            title="Route completion"
            meta="Ranked by completion"
            actions={
              <button type="button" className="b b-sm b-gh" onClick={() => window.print()}>
                <Download className="h-3.5 w-3.5" /> Export PDF
              </button>
            }
            bodyClassName=""
          >
            <div className="scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Route</th>
                    <th>Officer</th>
                    <th>Completion</th>
                    <th>Exceptions</th>
                  </tr>
                </thead>
                <tbody>
                  {historyRows.map((row: any) => (
                    <tr key={row.id}>
                      <td>
                        <div className="col">
                          <b>{row.name}</b>
                          <span className="mono t3">{row.code}</span>
                        </div>
                      </td>
                      <td>{row.officer || "—"}</td>
                      <td>
                        <Tag tone={row.completion >= 90 ? "ok" : row.completion >= 70 ? "warn" : "fail"}>{row.completion}%</Tag>
                      </td>
                      <td className="mono">{row.missed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel title="Check-in exceptions" meta={`${exceptions.length}`} bodyClassName="">
            {exceptions.length === 0 ? (
              <Empty>No late or out-of-zone check-ins recorded.</Empty>
            ) : (
              <div className="list">
                {exceptions.slice(0, 20).map((c: any) => (
                  <div key={c.id} className="row g10" style={{ padding: "10px 14px" }}>
                    <Avatar name={c.officer_name} />
                    <span className="f1 col" style={{ minWidth: 0 }}>
                      <b className="trunc">{c.officer_name ?? "Officer"}</b>
                      <span className="t3">
                        {c.minutes_late ? `${c.minutes_late} min late` : "Exception logged"}
                        {c.created_at ? ` · ${new Date(c.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}
                      </span>
                    </span>
                    <Tag tone={c.status === "late" ? "warn" : "fail"}>{statusLabel(c.status)}</Tag>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      )}

      {showRouteDialog && canManage && (
        <NewPatrolDialog
          onClose={() => setShowRouteDialog(false)}
          onSubmit={(data) => createRouteMut.mutate(data)}
          loading={createRouteMut.isPending}
          error={createRouteMut.error?.message ?? null}
        />
      )}

      {showShiftDialog && canManage && (
        <QuickScheduleDialog
          patrols={patrols as any[]}
          onClose={() => setShowShiftDialog(false)}
          onSubmit={(data) => createShiftMut.mutate(data)}
          loading={createShiftMut.isPending}
          error={createShiftMut.error?.message ?? null}
        />
      )}
    </div>
  );
}

function ProgressBar({ patrol }: { patrol: any }) {
  const pct = completionOf(patrol);
  return (
    <div className="row g8" title={`${patrol.checked_in ?? 0} of ${patrol.waypoints ?? 0} waypoints checked in`}>
      <div className="prog f1">
        <i style={{ width: `${pct}%`, background: STATUS_COLOR[patrol.status] ?? undefined }} />
      </div>
      <span className="mono t3" style={{ fontSize: 11 }}>
        {pct}%
      </span>
    </div>
  );
}

/**
 * Draws each active route from its saved waypoints. These are the planned routes, not live GPS —
 * officer positions live on the main Live map.
 */
function LivePatrolMap({
  patrols,
  waypoints,
  locationById,
  token,
  selectedId,
}: {
  patrols: any[];
  waypoints: WaypointRow[];
  locationById: Map<string, any>;
  token: string;
  selectedId: string | null;
}) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [basemap, setBasemap] = useBasemap();
  const viewRef = useRef<SavedView | null>(null);

  const routes = useMemo(() => {
    const byPatrol = new globalThis.Map<string, WaypointRow[]>();
    for (const w of waypoints) {
      if (w.coord_x == null || w.coord_y == null) continue;
      const list = byPatrol.get(w.patrol_id) ?? [];
      list.push(w);
      byPatrol.set(w.patrol_id, list);
    }
    return patrols
      .map((p) => ({ patrol: p, points: (byPatrol.get(p.id) ?? []).sort((a, b) => a.ord - b.ord) }))
      .filter((r) => r.points.length > 0);
  }, [patrols, waypoints]);

  const fallbackCenter = useMemo((): [number, number] | null => {
    for (const p of patrols) {
      const loc = p.location_id ? locationById.get(p.location_id) : null;
      if (loc?.coord_x != null && loc?.coord_y != null) return [Number(loc.coord_x), Number(loc.coord_y)];
    }
    return null;
  }, [patrols, locationById]);

  useEffect(() => {
    if (!token || !mapEl.current || mapRef.current) return;
    mapboxgl.accessToken = token;
    const first = routes[0]?.points[0];
    const center: [number, number] = first ? [Number(first.coord_x), Number(first.coord_y)] : fallbackCenter ?? [3.4219, 6.4281];
    const v = viewRef.current;
    const map = new mapboxgl.Map({ container: mapEl.current, style: BASEMAP_STYLE[basemap], center: v?.center ?? center, zoom: v?.zoom ?? (first || fallbackCenter ? 14 : 10), pitch: v?.pitch ?? 0, attributionControl: false });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      add3DBuildings(map, basemap);
      requestAnimationFrame(() => map.resize());
      setReady(true);
    });
    mapRef.current = map;
    return () => {
      viewRef.current = saveView(map);
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // the map is created once per token and style; data is applied below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const lines = {
      type: "FeatureCollection",
      features: routes.map((r) => ({
        type: "Feature",
        geometry: { type: "LineString", coordinates: r.points.map((w) => [Number(w.coord_x), Number(w.coord_y)]) },
        properties: { color: STATUS_COLOR[r.patrol.status] ?? "#7A9BFF", selected: r.patrol.id === selectedId ? 1 : 0 },
      })),
    };
    const points = {
      type: "FeatureCollection",
      features: routes.flatMap((r) =>
        r.points.map((w) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [Number(w.coord_x), Number(w.coord_y)] },
          properties: { color: STATUS_COLOR[r.patrol.status] ?? "#7A9BFF", selected: r.patrol.id === selectedId ? 1 : 0 },
        })),
      ),
    };
    const lineSrc = map.getSource("patrol-routes") as mapboxgl.GeoJSONSource | undefined;
    const ptSrc = map.getSource("patrol-waypoints") as mapboxgl.GeoJSONSource | undefined;
    if (lineSrc && ptSrc) {
      lineSrc.setData(lines as any);
      ptSrc.setData(points as any);
    } else {
      map.addSource("patrol-routes", { type: "geojson", data: lines as any });
      map.addSource("patrol-waypoints", { type: "geojson", data: points as any });
      map.addLayer({
        id: "patrol-routes-line",
        type: "line",
        source: "patrol-routes",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": ["case", ["==", ["get", "selected"], 1], 5, 3], "line-opacity": 0.85 },
      });
      map.addLayer({
        id: "patrol-waypoints-dot",
        type: "circle",
        source: "patrol-waypoints",
        paint: { "circle-radius": ["case", ["==", ["get", "selected"], 1], 6, 4], "circle-color": ["get", "color"], "circle-stroke-width": 2, "circle-stroke-color": "#0A0C10" },
      });
    }
    const focus = routes.find((r) => r.patrol.id === selectedId) ?? (selectedId ? null : undefined);
    const fitTo = focus ? [focus] : focus === null ? [] : routes;
    if (fitTo.length) {
      const bounds = new mapboxgl.LngLatBounds();
      for (const r of fitTo) for (const w of r.points) bounds.extend([Number(w.coord_x), Number(w.coord_y)]);
      map.fitBounds(bounds, { padding: 60, maxZoom: 17, duration: 400 });
    }
  }, [routes, ready, selectedId]);

  if (!token) {
    return (
      <div className="map" style={{ minHeight: 420 }}>
        <Empty>The map needs a Mapbox token. Routes are still listed on the right.</Empty>
      </div>
    );
  }

  return (
    <div className="map" style={{ minHeight: 420 }}>
      <div ref={mapEl} style={{ position: "absolute", inset: 0 }} />
      <BasemapSwitch value={basemap} onChange={setBasemap} style={{ right: 10, bottom: 10 }} />
      <div className="glass row g12 wrap" style={{ position: "absolute", left: 10, bottom: 10, padding: "6px 10px", fontSize: 12 }}>
        {(["on_route", "delayed", "missed"] as const).map((s) => (
          <span key={s} className="row g6">
            <span style={{ width: 8, height: 8, borderRadius: 4, background: STATUS_COLOR[s] }} />
            {statusLabel(s)}
          </span>
        ))}
        <span className="t3">Planned routes from saved waypoints</span>
      </div>
      {routes.length === 0 && (
        <div className="glass" style={{ position: "absolute", left: 10, top: 10, padding: "6px 10px", fontSize: 12 }}>
          No active route has mapped waypoints yet.
        </div>
      )}
    </div>
  );
}

function Modal({ title, eyebrow, onClose, children, width = 460 }: { title: string; eyebrow: string; onClose: () => void; children: React.ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center px-4" style={{ background: "rgba(5,7,10,.72)" }} role="dialog" aria-modal="true" aria-label={title}>
      <div className="pn w-full" style={{ maxWidth: width, borderColor: "var(--line-2)" }}>
        <div className="pn-h">
          <div className="col">
            <span className="eyebrow">{eyebrow}</span>
            <h3 style={{ fontSize: 15 }}>{title}</h3>
          </div>
          <button type="button" onClick={onClose} className="ibtn ml-auto" style={{ width: 28, height: 28 }} aria-label="Close">
            <X size={14} strokeWidth={1.75} />
          </button>
        </div>
        <div className="pn-b">{children}</div>
      </div>
    </div>
  );
}

function NewPatrolDialog({
  onClose,
  onSubmit,
  loading,
  error,
}: {
  onClose: () => void;
  onSubmit: (d: { code: string; name: string; officer: string; shift: string; waypoints: number }) => void;
  loading: boolean;
  error: string | null;
}) {
  const [form, setForm] = useState({ code: "", name: "", officer: "", shift: "18:00 – 06:00", waypoints: 6 });
  return (
    <Modal eyebrow="Patrol routes" title="New patrol route" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(form);
        }}
        className="grid grid-cols-2 gap-3"
      >
        <Field label="Code">
          <input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="in mono" placeholder="PR-05" />
        </Field>
        <Field label="Waypoints">
          <input type="number" required min={1} max={50} value={form.waypoints} onChange={(e) => setForm({ ...form, waypoints: Number(e.target.value) })} className="in" />
        </Field>
        <div className="col-span-2">
          <Field label="Name">
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="in" placeholder="Perimeter north loop" />
          </Field>
        </div>
        <Field label="Officer">
          <input required value={form.officer} onChange={(e) => setForm({ ...form, officer: e.target.value })} className="in" />
        </Field>
        <Field label="Shift">
          <input required value={form.shift} onChange={(e) => setForm({ ...form, shift: e.target.value })} className="in" />
        </Field>
        <p className="col-span-2 t3" style={{ fontSize: 12 }}>You place the waypoints on the map after the route is created.</p>
        {error && (
          <div className="col-span-2">
            <Notice tone="fail">{error}</Notice>
          </div>
        )}
        <div className="col-span-2 row g8" style={{ justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} className="b b-gh">
            Cancel
          </button>
          <button disabled={loading} className="b b-pri">
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Create route
          </button>
        </div>
      </form>
    </Modal>
  );
}

function QuickScheduleDialog({
  patrols,
  onClose,
  onSubmit,
  loading,
  error,
}: {
  patrols: any[];
  onClose: () => void;
  onSubmit: (d: ScheduleDraft) => void;
  loading: boolean;
  error: string | null;
}) {
  const [form, setForm] = useState<ScheduleDraft>({
    patrol_id: patrols[0]?.id ?? "",
    officer_name: patrols[0]?.officer ?? "",
    scheduled_start: toLocalInput(new Date(Date.now() + 3600_000)),
    scheduled_end: toLocalInput(new Date(Date.now() + 3600_000 * 9)),
    repeat_days: 1,
  });

  useEffect(() => {
    if (!form.patrol_id && patrols[0]) {
      setForm((f) => ({ ...f, patrol_id: patrols[0].id, officer_name: patrols[0].officer ?? f.officer_name }));
    }
  }, [form.patrol_id, patrols]);

  const endBeforeStart = new Date(form.scheduled_end).getTime() <= new Date(form.scheduled_start).getTime();

  return (
    <Modal eyebrow="Shift schedule" title="Create patrol shift" onClose={onClose} width={560}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Patrol route">
          <select
            className="in"
            value={form.patrol_id}
            onChange={(e) => {
              const patrol = patrols.find((p) => p.id === e.target.value);
              setForm((f) => ({ ...f, patrol_id: e.target.value, officer_name: patrol?.officer ?? f.officer_name }));
            }}
          >
            {patrols.map((patrol) => (
              <option key={patrol.id} value={patrol.id}>
                {patrol.code} · {patrol.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Officer name">
          <input className="in" value={form.officer_name} onChange={(e) => setForm((f) => ({ ...f, officer_name: e.target.value }))} />
        </Field>
        <Field label="Start">
          <input className="in" type="datetime-local" value={form.scheduled_start} onChange={(e) => setForm((f) => ({ ...f, scheduled_start: e.target.value }))} />
        </Field>
        <Field label="End">
          <input className="in" type="datetime-local" value={form.scheduled_end} onChange={(e) => setForm((f) => ({ ...f, scheduled_end: e.target.value }))} />
        </Field>
        <Field label="Repeat for (days)">
          <input className="in" type="number" min={1} max={30} value={form.repeat_days} onChange={(e) => setForm((f) => ({ ...f, repeat_days: Number(e.target.value) }))} />
        </Field>
      </div>
      <div className="col g8" style={{ marginTop: 12 }}>
        {endBeforeStart && <Notice tone="warn">The shift has to end after it starts.</Notice>}
        {error && <Notice tone="fail">{error}</Notice>}
      </div>
      <div className="row g8" style={{ justifyContent: "flex-end", marginTop: 12 }}>
        <button type="button" onClick={onClose} className="b b-gh">
          Cancel
        </button>
        <button
          type="button"
          onClick={() =>
            onSubmit({
              ...form,
              scheduled_start: new Date(form.scheduled_start).toISOString(),
              scheduled_end: new Date(form.scheduled_end).toISOString(),
            })
          }
          disabled={loading || !form.patrol_id || !form.officer_name || endBeforeStart}
          className="b b-pri"
        >
          {loading ? "Saving…" : "Schedule shift"}
        </button>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="fl">
      <span className="lbl">{label}</span>
      {children}
    </label>
  );
}

function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
