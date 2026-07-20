import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { createPatrol, listCheckIns, listPatrols, listShifts, scheduleShift } from "@/lib/patrols.functions";
import { getMapboxToken } from "@/lib/config.functions";
import { listLocations } from "@/lib/orgs.functions";
import { useRealtimeInvalidate } from "@/lib/useRealtime";
import { supabase } from "@/integrations/supabase/client";
import { resolveAppAccess, requireSectionAccess } from "@/lib/rbac";
import { loadStoredCommandIntent } from "@/lib/command-memory";
import type { AiQueryResult } from "@/lib/ai-commands.functions";
import {
  Activity,
  Archive,
  CalendarDays,
  Clock3,
  Download,
  FileText,
  List,
  Lock,
  MapPinned,
  Pencil,
  Plus,
  Radar,
  Route as RouteIcon,
  ShieldAlert,
  Loader2,
  X,
  CheckCircle2,
  AlertTriangle,
  Map as MapIcon,
} from "lucide-react";

export const Route = createFileRoute("/app/patrols")({
  head: () => ({ meta: [{ title: "Patrols · Lemtik SOD" }] }),
  beforeLoad: async () => {
    const appAccess = await resolveAppAccess(supabase);
    requireSectionAccess(appAccess, ["security_manager", "operator", "client_admin"]);
    return { appAccess };
  },
  component: Patrols,
});

const statusTone: Record<string, string> = {
  on_route: "text-resolved bg-resolved/10 border-resolved/30",
  delayed: "text-high bg-high/10 border-high/30",
  missed: "text-critical bg-critical/10 border-critical/30",
  complete: "text-muted-foreground bg-muted border-border",
};

type PatrolView = "live" | "schedule" | "routes" | "history";
type ScheduleDraft = {
  patrol_id: string;
  officer_name: string;
  scheduled_start: string;
  scheduled_end: string;
  repeat_days: number;
};

function Patrols() {
  const { appAccess } = Route.useRouteContext();
  const canManage = appAccess.specRole === "security_manager";
  const navigate = useNavigate();
  const qc = useQueryClient();

  const listPat = useServerFn(listPatrols);
  const createPat = useServerFn(createPatrol);
  const listShiftsFn = useServerFn(listShifts);
  const scheduleFn = useServerFn(scheduleShift);
  const listCheckInsFn = useServerFn(listCheckIns);
  const listLocationsFn = useServerFn(listLocations);
  const mapboxTokenFn = useServerFn(getMapboxToken);

  const [view, setView] = useState<PatrolView>("live");
  const [showRouteDialog, setShowRouteDialog] = useState(false);
  const [showShiftDialog, setShowShiftDialog] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  useRealtimeInvalidate("patrols", [["patrols"]]);
  useRealtimeInvalidate("patrol_shifts", [["shifts"]]);
  useRealtimeInvalidate("patrol_check_ins", [["checkins"]]);
  useRealtimeInvalidate("organisation_locations", [["locations"]]);

  const { data: patrolRows = [], isLoading } = useQuery({
    queryKey: ["patrols"],
    queryFn: () => listPat(),
  });
  const { data: shifts = [] } = useQuery({
    queryKey: ["shifts"],
    queryFn: () => listShiftsFn({ data: {} }),
  });
  const { data: checkins = [] } = useQuery({
    queryKey: ["checkins"],
    queryFn: () => listCheckInsFn({ data: {} }),
  });
  const { data: locations = [] } = useQuery({
    queryKey: ["locations"],
    queryFn: () => listLocationsFn(),
  });
  const { data: tokenData } = useQuery({
    queryKey: ["mapbox-token"],
    queryFn: () => mapboxTokenFn(),
    staleTime: Infinity,
  });
  const [commandIntent, setCommandIntent] = useState<AiQueryResult | null>(() => loadStoredCommandIntent());
  const appliedIntentRef = useRef<string | null>(null);

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
      if (!prev || new Date(checkIn.created_at).getTime() > new Date(prev.created_at).getTime()) {
        map.set(patrolId, checkIn);
      }
    }
    return map;
  }, [checkins]);
  const activePatrols = useMemo(
    () => patrols.filter((p) => p.status !== "complete"),
    [patrols],
  );
  const commandFilteredPatrols = useMemo(() => {
    if (!commandIntent) return activePatrols;
    const { query, status, location, zone, target } = commandIntent.filters;
    return activePatrols.filter((patrol) => {
      const locationLabel = locationById.get(patrol.location_id ?? "")?.name ?? "";
      const haystack = [patrol.code, patrol.name, patrol.officer, patrol.shift, locationLabel].filter(Boolean).join(" ").toLowerCase();
      if (query && !haystack.includes(query)) {
        const queryTokens = query.split(/\s+/).filter(Boolean);
        if (queryTokens.length && !queryTokens.every((token) => haystack.includes(token))) return false;
      }
      if (status && patrol.status.toLowerCase() !== status.toLowerCase()) return false;
      if (location && !haystack.includes(location.toLowerCase())) return false;
      if (zone && !haystack.includes(zone.toLowerCase())) return false;
      if (target && !haystack.includes(target.toLowerCase())) return false;
      return true;
    });
  }, [activePatrols, commandIntent, locationById]);
  const missedCount = patrols.filter((p) => p.status === "missed").length;
  const delayedCount = patrols.filter((p) => p.status === "delayed").length;
  const completeCount = patrols.filter((p) => p.status === "complete").length;
  const avgCompletion = patrols.length
    ? Math.round(
        patrols.reduce((acc, patrol) => acc + Math.round((Number(patrol.checked_in ?? 0) / Math.max(Number(patrol.waypoints ?? 1), 1)) * 100), 0) / patrols.length,
      )
    : 0;
  const nextDue = patrols
    .map((p) => p.next_check_in ?? "—")
    .filter((x) => x !== "—")
    .slice(0, 3);

  const historyRows = useMemo(
    () =>
      [...patrols]
        .sort((a, b) => Number(b.checked_in ?? 0) / Math.max(Number(b.waypoints ?? 1), 1) - Number(a.checked_in ?? 0) / Math.max(Number(a.waypoints ?? 1), 1))
        .map((patrol) => ({
          ...patrol,
          completion: Math.round((Number(patrol.checked_in ?? 0) / Math.max(Number(patrol.waypoints ?? 1), 1)) * 100),
          missed: (checkins as any[]).filter((c) => c.patrol_id === patrol.id && (c.status === "late" || c.status === "out_of_zone")).length,
        })),
    [checkins, patrols],
  );
  const upcomingShifts = useMemo(() => {
    const now = Date.now();
    const week = now + 7 * 24 * 3600_000;
    return (shifts as any[]).filter((shift) => {
      const start = new Date(shift.scheduled_start).getTime();
      return start >= now && start <= week;
    });
  }, [shifts]);
  const laterShifts = useMemo(() => {
    const cutoff = Date.now() + 7 * 24 * 3600_000;
    return (shifts as any[]).filter((shift) => new Date(shift.scheduled_start).getTime() > cutoff);
  }, [shifts]);

  useEffect(() => {
    const stored = loadStoredCommandIntent();
    if (!stored) return;
    setCommandIntent(stored);
  }, []);

  useEffect(() => {
    if (!commandIntent || appliedIntentRef.current === commandIntent.request_id) return;
    appliedIntentRef.current = commandIntent.request_id;
  }, [commandIntent]);

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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Patrol Management</div>
          <h1 className="mt-1 text-2xl font-semibold">Patrol management</h1>
          <p className="text-sm text-muted-foreground">Live patrols, shift scheduling, route definitions, and route history.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowArchived((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs ${
              showArchived ? "border-primary/40 bg-primary/10" : "border-border bg-surface hover:bg-surface-2"
            }`}
          >
            <Archive className="h-3.5 w-3.5" /> {showArchived ? "Showing archived" : "Show archived"}
          </button>
          {canManage ? (
            <>
              <button
                onClick={() => setShowShiftDialog(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-xs hover:bg-surface-2"
              >
                <CalendarDays className="h-3.5 w-3.5" /> Create shift
              </button>
              <button
                onClick={() => setShowRouteDialog(true)}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="h-3.5 w-3.5" /> New route
              </button>
            </>
          ) : (
            <div className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5" /> View only
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-card p-2">
        {[
          { key: "live", label: "Active Patrols", icon: MapPinned },
          { key: "schedule", label: "Shift Schedule", icon: CalendarDays },
          { key: "routes", label: "Patrol Routes", icon: RouteIcon },
          { key: "history", label: "Patrol History", icon: FileText },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setView(tab.key as PatrolView)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                view === tab.key ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <Metric label="Routes visible" value={String(commandIntent ? commandFilteredPatrols.length : patrols.length)} icon={Radar} />
        <Metric label="Avg completion" value={`${avgCompletion}%`} icon={Activity} />
        <Metric label="Delayed / missed" value={`${delayedCount + missedCount}`} icon={ShieldAlert} tone="critical" />
        <Metric label="Complete routes" value={String(completeCount)} icon={Clock3} tone="resolved" />
      </div>

      {commandIntent && (
        <section className="rounded-lg border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-slate-100">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-300">Active AI command</div>
              <div className="mt-1 font-medium">{commandIntent.summary}</div>
              <div className="mt-1 text-xs text-slate-300">{commandIntent.routingNote}</div>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.16em]">
              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1">Matches {commandFilteredPatrols.length}</span>
              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1">Scope {commandIntent.scope}</span>
              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1">Confidence {commandIntent.confidence}%</span>
            </div>
          </div>
        </section>
      )}

      {view === "live" && (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Live patrols</div>
                <h2 className="text-sm font-semibold">Active route snapshot</h2>
              </div>
              <span className="rounded-md border border-border bg-surface px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">Live</span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-[1.1fr_0.9fr]">
              <LivePatrolMap activePatrols={(commandIntent ? commandFilteredPatrols : activePatrols) as any[]} locationById={locationById} token={tokenData?.token ?? ""} />
              <div className="space-y-2 max-h-[420px] overflow-auto pr-1">
                {(commandIntent ? commandFilteredPatrols : activePatrols).slice(0, 8).map((patrol) => {
                  const completion = Math.round((Number(patrol.checked_in ?? 0) / Math.max(Number(patrol.waypoints ?? 1), 1)) * 100);
                  const last = latestCheckInByPatrol.get(patrol.id);
                  const location = patrol.location_id ? locationById.get(patrol.location_id) : null;
                  return (
                    <Link key={patrol.id} to="/app/patrols/$id" params={{ id: patrol.id }} className="block rounded-md border border-border bg-surface px-3 py-2 hover:bg-surface-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-[10px] font-mono text-muted-foreground">{patrol.code}</div>
                          <div className="text-sm font-semibold">{patrol.name}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{patrol.officer} · {patrol.shift}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {location?.name ?? "No base location"} · Last check-in {last?.created_at ? new Date(last.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—"}
                          </div>
                        </div>
                        <span className={`rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wider ${statusTone[patrol.status] ?? statusTone.on_route}`}>
                          {String(patrol.status).replace("_", " ")}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-surface-2 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${completion}%`, background: patrol.status === "missed" ? "var(--critical)" : patrol.status === "delayed" ? "var(--high)" : "var(--resolved)" }} />
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-5 space-y-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Operational alerts</div>
              <h3 className="text-sm font-semibold">Patrol exceptions</h3>
            </div>
            {missedCount > 0 ? (
              <div className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical">
                {missedCount} patrol route{missedCount === 1 ? "" : "s"} are currently marked missed.
              </div>
            ) : (
              <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
                No missed patrols in the current view.
              </div>
            )}
            <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
              Next check-ins: {nextDue.length ? nextDue.join(" · ") : "No upcoming check-in data."}
            </div>
            <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
              {(commandIntent ? commandFilteredPatrols : activePatrols).length} active patrol{(commandIntent ? commandFilteredPatrols : activePatrols).length === 1 ? "" : "s"} currently on route.
            </div>
          </div>
        </section>
      )}

      {view === "schedule" && (
        <section className="rounded-lg border border-border bg-card p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Shift schedule</h2>
              <p className="text-xs text-muted-foreground">Upcoming patrol assignments and repeat shifts.</p>
            </div>
            {canManage ? (
              <button onClick={() => setShowShiftDialog(true)} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                <CalendarDays className="h-3.5 w-3.5" /> Create shift
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
                <Lock className="h-3.5 w-3.5" /> Manager only
              </span>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {upcomingShifts.slice(0, 6).map((shift: any) => (
              <div key={shift.id} className="rounded-md border border-border bg-surface p-3 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-foreground">{shift.officer_name}</div>
                    <div className="mt-1 text-muted-foreground">{shift.patrol_code ?? "Patrol route"} · {shift.status}</div>
                  </div>
                  <span className="rounded-md border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {new Date(shift.scheduled_start).toLocaleDateString("en-GB")}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    {new Date(shift.scheduled_start).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} →{" "}
                    {new Date(shift.scheduled_end).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span>{shift.repeat_days ? `Repeats ${shift.repeat_days} day${shift.repeat_days === 1 ? "" : "s"}` : "One-off"}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
            {laterShifts.length ? `${laterShifts.length} later shifts queued.` : "No later shifts queued."}
          </div>
        </section>
      )}

      {view === "routes" && (
        <section className="rounded-lg border border-border bg-card p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Patrol routes</h2>
              <p className="text-xs text-muted-foreground">Defined patrol routes, base locations, and handoff links to route detail.</p>
            </div>
            {canManage ? (
              <button onClick={() => setShowRouteDialog(true)} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                <Plus className="h-3.5 w-3.5" /> Create route
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
                <Lock className="h-3.5 w-3.5" /> Read only
              </span>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {patrols.map((patrol: any) => {
              const completion = Math.round((Number(patrol.checked_in ?? 0) / Math.max(Number(patrol.waypoints ?? 1), 1)) * 100);
              const location = patrol.location_id ? locationById.get(patrol.location_id) : null;
              return (
                <div key={patrol.id} className="rounded-md border border-border bg-surface p-3 text-xs space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-mono text-[10px] text-muted-foreground">{patrol.code}</div>
                      <div className="text-sm font-semibold text-foreground">{patrol.name}</div>
                      <div className="mt-1 text-muted-foreground">{patrol.officer} · {patrol.shift}</div>
                    </div>
                    <span className={`rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wider ${statusTone[patrol.status] ?? statusTone.on_route}`}>
                      {String(patrol.status).replace("_", " ")}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {location?.name ?? "No base location"} · {patrol.waypoints} waypoints · {completion}% complete
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${completion}%`, background: patrol.status === "missed" ? "var(--critical)" : patrol.status === "delayed" ? "var(--high)" : "var(--resolved)" }} />
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <Link to="/app/patrols/$id" params={{ id: patrol.id }} className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] hover:bg-surface-2">
                      <MapIcon className="h-3 w-3" /> View
                    </Link>
                    {canManage && (
                      <Link to="/app/patrols/$id" params={{ id: patrol.id }} className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] hover:bg-surface-2">
                        <Pencil className="h-3 w-3" /> Edit route
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {view === "history" && (
        <section className="rounded-lg border border-border bg-card p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Patrol history</h2>
              <p className="text-xs text-muted-foreground">Completion ranking, missed check-ins, and exportable review data.</p>
            </div>
            <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-xs hover:bg-surface-2">
              <Download className="h-3.5 w-3.5" /> Export PDF
            </button>
          </div>

          <div className="grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="bg-surface text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Route</th>
                    <th className="px-3 py-2 text-left">Officer</th>
                    <th className="px-3 py-2 text-left">Completion</th>
                    <th className="px-3 py-2 text-left">Missed</th>
                  </tr>
                </thead>
                <tbody>
                  {historyRows.slice(0, 8).map((row: any) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground">{row.name}</div>
                        <div className="text-[10px] text-muted-foreground">{row.code}</div>
                      </td>
                      <td className="px-3 py-2">{row.officer}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${row.completion >= 90 ? "border-resolved/40 text-resolved bg-resolved/10" : row.completion >= 70 ? "border-high/40 text-high bg-high/10" : "border-critical/40 text-critical bg-critical/10"}`}>
                          {row.completion}%
                        </span>
                      </td>
                      <td className="px-3 py-2">{row.missed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-3">
              <div className="rounded-md border border-border bg-surface p-3 text-xs text-muted-foreground">
                Officer compliance ranking is based on route completion and exception check-ins.
              </div>
              <div className="rounded-md border border-border bg-surface p-3">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Missed check-ins</div>
                <div className="mt-2 space-y-2 max-h-72 overflow-auto pr-1">
                  {(checkins as any[]).filter((c) => c.status === "late" || c.status === "out_of_zone").slice(0, 8).map((c) => (
                    <div key={c.id} className="rounded-md border border-border bg-card px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-foreground">{c.officer_name ?? "Officer"}</span>
                        <span className="rounded-md border border-critical/40 bg-critical/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-critical">{c.status}</span>
                      </div>
                      <div className="mt-1 text-muted-foreground">
                        {c.minutes_late ? `${c.minutes_late} minute${c.minutes_late === 1 ? "" : "s"} late` : "Exception logged"}
                      </div>
                    </div>
                  ))}
                  {!(checkins as any[]).some((c) => c.status === "late" || c.status === "out_of_zone") && (
                    <div className="rounded-md border border-dashed border-border bg-card px-3 py-2 text-center text-muted-foreground">
                      No missed check-ins in the current history view.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {isLoading ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading patrols…
        </div>
      ) : patrols.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center">
          <Radar className="h-6 w-6 text-muted-foreground mx-auto" />
          <div className="mt-3 text-sm font-medium">No patrol routes yet</div>
          <div className="mt-1 text-xs text-muted-foreground">Schedule the first patrol to start tracking check-ins.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {patrols.map((patrol: any) => {
            const pct = Math.round((Number(patrol.checked_in ?? 0) / Math.max(Number(patrol.waypoints ?? 1), 1)) * 100);
            return (
              <Link
                key={patrol.id}
                to="/app/patrols/$id"
                params={{ id: patrol.id }}
                className="block text-left rounded-lg border border-border bg-card p-5 space-y-4 hover:border-primary/50 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-[10px] font-mono text-muted-foreground">{patrol.code}</div>
                    <div className="text-base font-semibold mt-0.5">{patrol.name}</div>
                    <div className="text-xs text-muted-foreground mt-1">{patrol.officer} · {patrol.shift}</div>
                  </div>
                  <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wider ${statusTone[patrol.status] ?? statusTone.on_route}`}>
                    <Radar className="h-3 w-3" /> {String(patrol.status).replace("_", " ")}
                  </span>
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-muted-foreground">Waypoints</span>
                    <span className="font-mono">{patrol.checked_in}/{patrol.waypoints}</span>
                  </div>
                  <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: patrol.status === "missed" ? "var(--critical)" : patrol.status === "delayed" ? "var(--high)" : "var(--resolved)",
                      }}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Next check-in</span>
                  <span className="font-mono">{patrol.next_check_in ?? "—"}</span>
                </div>
              </Link>
            );
          })}
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
        />
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
  tone = "muted",
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "muted" | "critical" | "resolved";
}) {
  const toneClass =
    tone === "critical"
      ? "text-critical bg-critical/10 border-critical/30"
      : tone === "resolved"
        ? "text-resolved bg-resolved/10 border-resolved/30"
        : "text-muted-foreground bg-surface border-border";
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={`grid h-7 w-7 place-items-center rounded-md border ${toneClass}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function LivePatrolMap({
  activePatrols,
  locationById,
  token,
}: {
  activePatrols: any[];
  locationById: Map<string, any>;
  token: string;
}) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!token || !mapEl.current || mapRef.current) return;
    mapboxgl.accessToken = token;
    const first = activePatrols.find((patrol) => patrol.location_id && locationById.get(patrol.location_id));
    const center = first?.location_id && locationById.get(first.location_id)
      ? [Number(locationById.get(first.location_id)?.coord_x), Number(locationById.get(first.location_id)?.coord_y)]
      : [3.4219, 6.4281];
    const map = new mapboxgl.Map({
      container: mapEl.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: center as [number, number],
      zoom: 11,
      attributionControl: false,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => requestAnimationFrame(() => map.resize()));
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [activePatrols, locationById, token]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const sourceId = "patrol-live-points";
    const features = activePatrols
      .map((patrol) => {
        const loc = patrol.location_id ? locationById.get(patrol.location_id) : null;
        if (loc?.coord_x == null || loc?.coord_y == null) return null;
        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: [Number(loc.coord_x), Number(loc.coord_y)] },
          properties: { name: patrol.name, code: patrol.code, officer: patrol.officer, status: patrol.status },
        };
      })
      .filter(Boolean);
    const geo = { type: "FeatureCollection", features };
    const existing = map.getSource(sourceId) as mapboxgl.GeoJSONSource | undefined;
    if (existing) {
      existing.setData(geo as any);
      return;
    }
    map.addSource(sourceId, { type: "geojson", data: geo as any });
    map.addLayer({
      id: `${sourceId}-layer`,
      type: "circle",
      source: sourceId,
      paint: {
        "circle-radius": 6,
        "circle-color": "hsl(217 91% 60%)",
        "circle-stroke-width": 2,
        "circle-stroke-color": "hsl(220 13% 9%)",
      },
    });
  }, [activePatrols, locationById]);

  return (
    <div className="relative h-[420px] overflow-hidden rounded-md border border-border bg-surface">
      <div ref={mapEl} className="h-full w-full" />
      <div className="pointer-events-none absolute left-2 top-2 rounded-md border border-border bg-background/85 px-2 py-1 text-[10px] text-muted-foreground shadow-sm">
        Live map preview
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
  const [form, setForm] = useState({ code: "PT-06", name: "", officer: "", shift: "18:00 – 06:00", waypoints: 6 });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold">New patrol route</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-surface"><X className="h-4 w-4" /></button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(form);
          }}
          className="mt-4 grid grid-cols-2 gap-3"
        >
          <Field label="Code">
            <input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="inp" />
          </Field>
          <Field label="Waypoints">
            <input type="number" required min={1} max={50} value={form.waypoints} onChange={(e) => setForm({ ...form, waypoints: Number(e.target.value) })} className="inp" />
          </Field>
          <div className="col-span-2">
            <Field label="Name">
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="inp" placeholder="Phase 1 Perimeter Loop" />
            </Field>
          </div>
          <Field label="Officer">
            <input required value={form.officer} onChange={(e) => setForm({ ...form, officer: e.target.value })} className="inp" />
          </Field>
          <Field label="Shift">
            <input required value={form.shift} onChange={(e) => setForm({ ...form, shift: e.target.value })} className="inp" />
          </Field>
          {error && <div className="col-span-2 rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical">{error}</div>}
          <div className="col-span-2 flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md border border-border bg-surface px-3 py-2 text-xs">Cancel</button>
            <button disabled={loading} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-60">
              {loading && <Loader2 className="h-3 w-3 animate-spin" />} Create
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;border-radius:.375rem;border:1px solid var(--border);background:var(--surface);padding:.45rem .6rem;font-size:.8125rem;color:var(--foreground)}.inp:focus{outline:none;box-shadow:0 0 0 1px var(--ring)}`}</style>
      </div>
    </div>
  );
}

function QuickScheduleDialog({
  patrols,
  onClose,
  onSubmit,
  loading,
}: {
  patrols: any[];
  onClose: () => void;
  onSubmit: (d: ScheduleDraft) => void;
  loading: boolean;
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

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-xl rounded-lg border border-border bg-card p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Shift schedule</div>
            <h2 className="text-lg font-semibold">Create patrol shift</h2>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-surface"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Field label="Patrol route">
            <select
              className="inp"
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
            <input className="inp" value={form.officer_name} onChange={(e) => setForm((f) => ({ ...f, officer_name: e.target.value }))} />
          </Field>
          <Field label="Start">
            <input className="inp" type="datetime-local" value={form.scheduled_start} onChange={(e) => setForm((f) => ({ ...f, scheduled_start: e.target.value }))} />
          </Field>
          <Field label="End">
            <input className="inp" type="datetime-local" value={form.scheduled_end} onChange={(e) => setForm((f) => ({ ...f, scheduled_end: e.target.value }))} />
          </Field>
          <Field label="Repeat days">
            <input className="inp" type="number" min={1} max={30} value={form.repeat_days} onChange={(e) => setForm((f) => ({ ...f, repeat_days: Number(e.target.value) }))} />
          </Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border bg-surface px-3 py-2 text-xs hover:bg-surface-2">Cancel</button>
          <button
            onClick={() => onSubmit({
              ...form,
              scheduled_start: new Date(form.scheduled_start).toISOString(),
              scheduled_end: new Date(form.scheduled_end).toISOString(),
            })}
            disabled={loading || !form.patrol_id || !form.officer_name}
            className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-60"
          >
            {loading ? "Saving…" : "Schedule shift"}
          </button>
        </div>
      </div>
      <style>{`.inp{width:100%;border-radius:.375rem;border:1px solid var(--border);background:var(--surface);padding:.45rem .6rem;font-size:.8125rem;color:var(--foreground)}.inp:focus{outline:none;box-shadow:0 0 0 1px var(--ring)}`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}

function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
