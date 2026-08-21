import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPatrols } from "@/lib/patrols.functions";
import { listShifts } from "@/lib/patrols.functions";
import { listIncidents } from "@/lib/incidents.functions";
import { listMyNotifications } from "@/lib/alerts.functions";
import { getOwnDutyStatus, setDutyStatus, reportOwnLocation } from "@/lib/officerDuty.functions";
import { officerRoom, useRealtimeEventFeed } from "@/lib/realtime.events";
import * as offlineQueue from "@/lib/offlineQueue";
import { supabase } from "@/integrations/supabase/client";
import {
  MapPinned,
  ShieldAlert,
  CheckCircle2,
  ArrowRight,
  AlertTriangle,
  Camera,
  Mic,
  Bell,
  MapPin,
  ShieldCheck,
  Loader2,
  Route as RouteIcon,
} from "lucide-react";
import { useOfficerPermissions } from "@/hooks/use-officer-permissions";

// How often to refresh location while on duty. Proximity treats a location
// older than 300s (MAX_LOCATION_STALENESS_SECONDS) as stale and excludes the
// officer from dispatch matching, so this needs comfortable headroom under that.
const LOCATION_REPORT_INTERVAL_MS = 60_000;

export const Route = createFileRoute("/officer/home")({
  component: OfficerHome,
});

function OfficerHome() {
  const [name, setName] = useState("Officer");
  const [userId, setUserId] = useState<string | null>(null);
  const { currentStep, completed, permissions, requestCurrent, skipCurrent } = useOfficerPermissions();
  const listPat = useServerFn(listPatrols);
  const listSh = useServerFn(listShifts);
  const listInc = useServerFn(listIncidents);
  const listNotifs = useServerFn(listMyNotifications);
  const getDuty = useServerFn(getOwnDutyStatus);
  const setDuty = useServerFn(setDutyStatus);
  const reportLocation = useServerFn(reportOwnLocation);
  const lastAlertedDispatch = useRef<string | null>(null);
  const qc = useQueryClient();
  const [dutyBusy, setDutyBusy] = useState(false);
  const [dutyError, setDutyError] = useState<string | null>(null);

  const { data: patrols = [] } = useQuery({ queryKey: ["officer-patrols"], queryFn: () => listPat() });
  const { data: shifts = [] } = useQuery({ queryKey: ["officer-shifts"], queryFn: () => listSh({ data: {} }) });
  const { data: incidents = [] } = useQuery({ queryKey: ["officer-incidents"], queryFn: () => listInc() });
  const { data: notifications = [] } = useQuery({
    queryKey: ["officer-notifications"],
    queryFn: () => listNotifs(),
    refetchInterval: 30_000,
  });
  const { data: dutyStatus } = useQuery({
    queryKey: ["officer-duty-status"],
    queryFn: () => getDuty(),
    refetchInterval: 30_000,
  });
  const isOnDuty = dutyStatus?.status === "available" || dutyStatus?.status === "on_duty";

  const getPosition = () =>
    new Promise<GeolocationPosition>((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Location is not available on this device."));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15_000 });
    });

  const toggleDuty = async () => {
    setDutyError(null);
    setDutyBusy(true);
    try {
      if (isOnDuty) {
        await setDuty({ data: { on_duty: false } });
      } else {
        const position = await getPosition();
        await setDuty({
          data: {
            on_duty: true,
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          },
        });
      }
      await qc.invalidateQueries({ queryKey: ["officer-duty-status"] });
    } catch (err) {
      setDutyError(err instanceof Error ? err.message : "Unable to update duty status.");
    } finally {
      setDutyBusy(false);
    }
  };

  // While on duty, keep the officer's location fresh so proximity matching
  // doesn't exclude them for a stale position (see LOCATION_REPORT_INTERVAL_MS).
  useEffect(() => {
    if (!isOnDuty) return;
    let cancelled = false;
    const ping = async () => {
      try {
        const position = await getPosition();
        if (cancelled) return;
        await reportLocation({ data: { lat: position.coords.latitude, lng: position.coords.longitude } });
      } catch {
        // best-effort — a missed ping just means the next one is due sooner
      }
    };
    void ping();
    const interval = setInterval(() => void ping(), LOCATION_REPORT_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnDuty]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      setUserId(data.user.id);
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("user_id", data.user.id)
        .maybeSingle();
      setName((profile?.display_name || data.user.email || "Officer").split(" ")[0]);
    })();
  }, []);

  const now = new Date();
  const greeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 18 ? "Good afternoon" : "Good evening";
  const onShift = patrols.find((p) => p.status === "on_route" || p.status === "delayed");
  const unresolved = incidents.filter((i) => i.status !== "resolved" && i.status !== "closed").slice(0, 5);
  const dispatchNotifs = notifications.filter((n: any) => n.incident_id).slice(0, 3);
  const primaryDispatch = dispatchNotifs[0];
  const primaryIncident = primaryDispatch
    ? incidents.find((incident) => incident.id === primaryDispatch.incident_id && incident.status !== "resolved" && incident.status !== "closed")
    : unresolved[0];
  const activeShift = patrols.find((p) => p.status === "on_route" || p.status === "delayed") ?? patrols[0];
  const upcomingShifts = (shifts as any[]).slice(0, 3);
  const recentNotifications = (notifications as any[]).slice(0, 5);
  const liveEvents = useRealtimeEventFeed(userId ? officerRoom(userId) : null, 3);
  const pendingReports = offlineQueue.list().length;
  const lagosTime = new Intl.DateTimeFormat("en-NG", {
    timeZone: "Africa/Lagos",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
  const connectionLabel = typeof navigator !== "undefined" && navigator.onLine ? "Online" : "Offline";
  const connectionTone = typeof navigator !== "undefined" && navigator.onLine ? "bg-emerald-400" : "bg-amber-400";

  const quickActions = useMemo(() => ([
    { label: "Report Incident", to: "/officer/incident/new", icon: ShieldAlert },
    { label: "Check In", to: "/officer/patrol", icon: CheckCircle2 },
    { label: "SOS", to: "/officer/sos", icon: AlertTriangle },
  ]), []);

  useEffect(() => {
    if (!primaryIncident) return;
    const dispatchId = primaryIncident.id;
    if (lastAlertedDispatch.current === dispatchId) return;
    lastAlertedDispatch.current = dispatchId;
    if (typeof window === "undefined") return;
    try {
      const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = 860;
      gain.gain.value = 0.0001;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
      osc.stop(ctx.currentTime + 0.2);
      setTimeout(() => {
        void ctx.close();
      }, 250);
    } catch {
      // best-effort alert tone only
    }
  }, [primaryIncident]);

  const permissionIcons: Record<string, ComponentType<{ className?: string }>> = {
    location: MapPin,
    notifications: Bell,
    camera: Camera,
    microphone: Mic,
  };

  const permissionBadge: Record<string, string> = {
    location: "required",
    notifications: "optional",
    camera: "optional",
    microphone: "optional",
  };

  const acknowledgeDispatch = () => {
    if (primaryIncident) {
      lastAlertedDispatch.current = primaryIncident.id;
    }
  };

  return (
    <div className="space-y-5">
      {!completed && currentStep && (
        <section className="rounded-3xl border border-amber-300/20 bg-amber-300/10 p-5">
          <div className="text-[11px] uppercase tracking-[0.22em] text-amber-100/80">Setup required</div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {(() => {
              const Icon = permissionIcons[currentStep.key];
              return Icon ? <Icon className="h-5 w-5 text-amber-100" /> : null;
            })()}
            <h2 className="text-xl font-semibold text-white">{currentStep.title} access needed</h2>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-200">
              {permissionBadge[currentStep.key]}
            </span>
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200">{currentStep.description}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={() => void requestCurrent()}
              className="inline-flex items-center gap-2 rounded-2xl bg-amber-300 px-4 py-2.5 text-sm font-semibold text-slate-950"
            >
              <ShieldCheck className="h-4 w-4" />
              {currentStep.required ? "Allow and continue" : "Allow"}
            </button>
            {!currentStep.required && (
              <button
                onClick={skipCurrent}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-white"
              >
                Skip for now
              </button>
            )}
          </div>
          {currentStep.required && (
            <p className="mt-3 text-xs text-amber-50/80">
              Location is required before you can continue. If you deny it, Lemtik cannot open patrol mode.
            </p>
          )}
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {permissions.map((permission) => (
              <div
                key={permission.key}
                className={`rounded-2xl border px-3 py-2 text-xs ${
                  permission.key === currentStep.key
                    ? "border-amber-200/30 bg-white/10 text-white"
                    : "border-white/10 bg-slate-950/30 text-slate-300"
                }`}
              >
                <div className="font-medium">{permission.title}</div>
                <div className="mt-1 uppercase tracking-[0.18em] text-[10px] text-slate-400">
                  {permissionBadge[permission.key]} · {permission.key === currentStep.key ? "active" : "queued"}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Home</div>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">
                {greeting}, {name}
              </h2>
              <p className="mt-2 text-sm text-slate-300">Lagos time · {lagosTime}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Connection</div>
              <div className="mt-2 flex items-center gap-2 text-sm font-medium text-white">
                <span className={`h-2.5 w-2.5 rounded-full ${connectionTone}`} />
                {connectionLabel}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Duty status</div>
              <div className="mt-1 flex items-center gap-2 text-sm font-medium text-white">
                <span className={`h-2.5 w-2.5 rounded-full ${isOnDuty ? "bg-emerald-400" : "bg-slate-500"}`} />
                {isOnDuty ? "On duty — visible for dispatch" : "Off duty"}
              </div>
              {dutyError && <div className="mt-1 text-xs text-red-300">{dutyError}</div>}
            </div>
            <button
              onClick={() => void toggleDuty()}
              disabled={dutyBusy}
              className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold disabled:opacity-60 ${
                isOnDuty ? "border border-white/10 bg-slate-900 text-slate-200" : "bg-emerald-400 text-slate-950"
              }`}
            >
              {dutyBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              {isOnDuty ? "End shift" : "Go on duty"}
            </button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.label}
                  to={action.to}
                  className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm font-medium text-white hover:border-cyan-300/30 hover:bg-slate-900"
                >
                  <Icon className="h-4 w-4 text-cyan-300" />
                  {action.label}
                </Link>
              );
            })}
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <div className="rounded-3xl border border-white/10 bg-slate-950/40 p-5">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Active shift</div>
              {activeShift ? (
                <>
                  <div className="mt-3 flex items-center gap-2 text-sm font-semibold text-emerald-100">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                    ON SHIFT
                  </div>
                  <div className="mt-2 text-lg font-semibold">{activeShift.name}</div>
                  <div className="mt-1 text-sm text-slate-300">
                    {activeShift.shift} · Next check-in {activeShift.next_check_in}
                  </div>
                  <Link to="/officer/patrol" className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-cyan-200">
                    View patrol <ArrowRight className="h-4 w-4" />
                  </Link>
                </>
              ) : (
                <div className="mt-2 text-sm text-slate-300">No active patrol assignment right now.</div>
              )}
            </div>

            <div
              className={`rounded-3xl border p-5 ${
                primaryIncident ? "border-red-300/30 bg-red-300/10 shadow-[0_0_0_1px_rgba(248,113,113,0.15)] animate-pulse" : "border-white/10 bg-slate-950/40"
              }`}
            >
              <div className="text-[11px] uppercase tracking-[0.2em] text-red-100/80">Active dispatch</div>
              {primaryIncident ? (
                <>
                  <div className="mt-3 flex items-center gap-2 text-sm font-semibold text-red-100">
                    <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                    YOU HAVE BEEN DISPATCHED
                  </div>
                  <div className="mt-2 text-lg font-semibold text-white">
                    {primaryIncident.code} · {primaryIncident.location}
                  </div>
                  <div className="mt-1 text-sm text-slate-300">
                    {primaryIncident.type ?? "Incident"} · {primaryIncident.zone ?? "Assigned area"}
                  </div>
                  <p className="mt-2 text-sm text-slate-300">
                    {primaryDispatch?.body ?? "Navigate to the assignment and acknowledge once you are on route."}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link to="/officer/navigation" className="inline-flex items-center gap-2 rounded-2xl border border-red-200/20 bg-red-200/10 px-4 py-2.5 text-sm font-medium text-red-50">
                      <RouteIcon className="h-4 w-4" />
                      View route
                    </Link>
                    <button
                      type="button"
                      onClick={acknowledgeDispatch}
                      className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-white"
                    >
                      <Bell className="h-4 w-4" />
                      Acknowledge
                    </button>
                  </div>
                </>
              ) : (
                <p className="mt-2 text-sm text-slate-300">No active dispatch assignment is currently available.</p>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-cyan-300/20 bg-gradient-to-br from-cyan-300/15 via-white/5 to-transparent p-5">
          <div className="text-[11px] uppercase tracking-[0.22em] text-cyan-200/80">Connection</div>
          <div className="mt-2 text-sm text-slate-300">
            Critical actions remain available when the network drops and will sync when the connection restores.
          </div>
          <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Live command feed</div>
            <div className="mt-3 space-y-2">
              {liveEvents.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 px-4 py-3 text-xs text-slate-400">
                  Waiting for dispatches and pings.
                </div>
              ) : (
                liveEvents.map((event) => (
                  <div key={`${event.event}-${event.at}`} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-white">{event.event}</div>
                        <div className="mt-1 text-xs text-slate-300">{JSON.stringify(event.payload)}</div>
                      </div>
                      <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                        {new Intl.DateTimeFormat("en-NG", { timeStyle: "short", hour12: false }).format(new Date(event.at))}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Upcoming shifts</div>
            <div className="mt-3 space-y-3">
              {upcomingShifts.length > 0 ? upcomingShifts.map((shift: any) => (
                <div key={shift.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{shift.name}</div>
                      <div className="mt-1 text-xs text-slate-300">{shift.shift} · {shift.officer}</div>
                    </div>
                    <div className="rounded-full border border-white/10 bg-slate-950/40 px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-200">
                      {shift.status.replace("_", " ")}
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-slate-400">
                    {shift.checked_in}/{shift.waypoints} check-ins · Next {shift.next_check_in}
                  </div>
                </div>
              )) : (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300">
                  No upcoming shifts loaded yet.
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-amber-100/80">Pending reports</div>
            <div className="mt-2 text-sm font-medium text-white">
              {pendingReports} incident{pendingReports === 1 ? "" : "s"} waiting to sync
            </div>
            <p className="mt-1 text-sm text-slate-300">
              If you submitted a report while offline, it will send automatically when the connection returns.
            </p>
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Recent notifications</div>
            <div className="mt-3 space-y-2">
              {recentNotifications.length > 0 ? recentNotifications.map((item: any) => (
                <div key={item.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="text-sm font-medium text-white">{item.title}</div>
                  <div className="mt-1 text-xs text-slate-300">{item.body ?? item.action ?? ""}</div>
                </div>
              )) : (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300">
                  No recent notifications.
                </div>
              )}
            </div>
            <Link to="/officer/notifications" className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-cyan-200">
              View all notifications <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <section className={`${completed ? "" : "opacity-60"}`}>
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Recent incidents</h3>
              <p className="mt-1 text-xs text-slate-400">Assigned or nearby incidents visible on your console.</p>
            </div>
            <Link to="/officer/incident/new" className="inline-flex items-center gap-2 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs font-medium text-cyan-100">
              <ShieldAlert className="h-3.5 w-3.5" />
              Log new
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {unresolved.length === 0 ? (
              <p className="text-sm text-slate-400">No active incidents assigned to you.</p>
            ) : unresolved.map((incident) => (
              <div key={incident.id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{incident.code}</div>
                    <div className="mt-1 text-sm text-slate-300">{incident.location} · {incident.zone}</div>
                  </div>
                  <MapPinned className="h-4 w-4 text-cyan-300" />
                </div>
                <div className="mt-3 text-xs text-slate-400">{incident.description}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
