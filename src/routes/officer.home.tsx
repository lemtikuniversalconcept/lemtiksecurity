import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell, Camera, CheckCircle2, FileText, Loader2, MapPin, Mic, ShieldCheck } from "lucide-react";
import { getOwnDutyStatus, setDutyStatus, reportOwnLocation } from "@/lib/officerDuty.functions";
import { useOfficerPermissions } from "@/hooks/use-officer-permissions";
import { Notice, Sev, timeAgo } from "@/components/nw";
import { MyIspsAcks } from "@/components/isps/Broadcasts";
import { OpenChecklists } from "@/components/isps/Checklists";
import { fmtTime, getPosition, NetPill, playAlertTone, useMe, useMyDispatch, useMyNotifications, useMyShifts, usePendingUploads } from "@/components/officer/kit";

// Proximity treats a location older than 300 s as stale and drops the officer from dispatch
// matching, so refresh comfortably inside that while on duty.
const LOCATION_REPORT_INTERVAL_MS = 60_000;

export const Route = createFileRoute("/officer/home")({
  component: OfficerHome,
});

const PERMISSION_ICON = { location: MapPin, notifications: Bell, camera: Camera, microphone: Mic } as const;

function OfficerHome() {
  const qc = useQueryClient();
  const me = useMe();
  const { currentStep, completed, requestCurrent, skipCurrent } = useOfficerPermissions();
  const getDuty = useServerFn(getOwnDutyStatus);
  const setDuty = useServerFn(setDutyStatus);
  const reportLocation = useServerFn(reportOwnLocation);
  const { dispatch } = useMyDispatch();
  const { current: shift, upcoming } = useMyShifts();
  const { data: notifications = [] } = useMyNotifications();
  const pending = usePendingUploads();
  const [dutyBusy, setDutyBusy] = useState(false);
  const [dutyError, setDutyError] = useState<string | null>(null);
  const toned = useRef<string | null>(null);

  const { data: duty } = useQuery({ queryKey: ["officer-duty-status"], queryFn: () => getDuty(), refetchInterval: 30_000 });
  const onDuty = duty?.status === "available" || duty?.status === "on_duty";

  const toggleDuty = async () => {
    setDutyError(null);
    setDutyBusy(true);
    try {
      if (onDuty) await setDuty({ data: { on_duty: false } });
      else {
        const p = await getPosition();
        await setDuty({ data: { on_duty: true, lat: p.coords.latitude, lng: p.coords.longitude } });
      }
      await qc.invalidateQueries({ queryKey: ["officer-duty-status"] });
    } catch (err) {
      setDutyError(err instanceof Error ? err.message : "Couldn't change your duty status.");
    } finally {
      setDutyBusy(false);
    }
  };

  // While on duty, keep location fresh so dispatch matching can find this officer.
  useEffect(() => {
    if (!onDuty) return;
    let cancelled = false;
    const ping = async () => {
      try {
        const p = await getPosition();
        if (!cancelled) await reportLocation({ data: { lat: p.coords.latitude, lng: p.coords.longitude } });
      } catch {
        /* a missed ping is retried on the next interval */
      }
    };
    void ping();
    const t = setInterval(() => void ping(), LOCATION_REPORT_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDuty]);

  // A new, unread dispatch makes a sound once.
  useEffect(() => {
    if (!dispatch || dispatch.alert.read || toned.current === dispatch.alert.id) return;
    toned.current = dispatch.alert.id;
    playAlertTone();
  }, [dispatch]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const fromCommand = notifications.find((n) => !n.incident_id && n.alert_type !== "system_test");
  const nextShift = upcoming[0] ?? null;
  const onDutyFor = duty?.shift_start ? Math.max(0, Date.now() - Date.parse(duty.shift_start)) : null;

  return (
    <>
      <div className="o-h">
        <div className="col f1" style={{ minWidth: 0 }}>
          <span className="t3">{greeting}</span>
          <h1 className="trunc">{me.data?.name ?? "Officer"}</h1>
        </div>
        <NetPill />
      </div>

      <div className="o-b">
        <MyIspsAcks />
        <OpenChecklists />
        {!completed && currentStep && (
          <div className="o-card col g10" style={{ borderColor: "var(--warn)" }}>
            <span className="row g8">
              {(() => {
                const Icon = PERMISSION_ICON[currentStep.key as keyof typeof PERMISSION_ICON];
                return Icon ? <Icon size={18} /> : null;
              })()}
              <b>{currentStep.title} access</b>
              <span className="tg">{currentStep.required ? "Needed" : "Optional"}</span>
            </span>
            <span className="t2" style={{ fontSize: 13.5 }}>
              {currentStep.description}
            </span>
            <div className="row g8">
              <button type="button" className="b b-pri" onClick={() => void requestCurrent()}>
                <ShieldCheck size={16} /> Allow
              </button>
              {!currentStep.required && (
                <button type="button" className="b b-gh" onClick={skipCurrent}>
                  Not now
                </button>
              )}
            </div>
          </div>
        )}

        {dispatch && (
          <Link to="/officer/dispatch" className="o-card col g10" style={{ borderColor: "var(--s5)", background: "color-mix(in oklab, var(--s5) 10%, var(--ink-1))" }}>
            <div className="row g8">
              <span className="tg tg-fail">DISPATCH</span>
              <span className="mono t2">
                {dispatch.incident.code} · {fmtTime(dispatch.alert.sent_at)}
              </span>
              <span className="flex-auto" />
              <Sev level={dispatch.incident.severity} />
            </div>
            <div>
              <b style={{ fontSize: 17 }}>{dispatch.alert.title}</b>
              <div className="t2" style={{ fontSize: 13.5 }}>
                {dispatch.incident.location}
                {dispatch.incident.zone ? ` · ${dispatch.incident.zone}` : ""}
              </div>
            </div>
            <span className="b b-lg b-red" style={{ alignSelf: "flex-start" }}>
              {dispatch.alert.read ? "Open" : "Open and acknowledge"}
            </span>
          </Link>
        )}

        <div className="o-card row g12">
          <span className={`dot ${onDuty ? "d-ok" : ""}`} style={{ width: 10, height: 10 }} />
          <span className="col f1" style={{ minWidth: 0 }}>
            <b>{onDuty ? `On duty${onDutyFor != null ? ` · ${Math.floor(onDutyFor / 3_600_000)} h ${Math.floor((onDutyFor % 3_600_000) / 60_000)} m` : ""}` : "Off duty"}</b>
            <span className="t3 trunc">{shift ? `${shift.patrol_code ?? "Patrol"} · ${shift.status === "active" ? "shift running" : `starts ${fmtTime(shift.scheduled_start)}`}` : onDuty ? "Visible for dispatch" : "Go on duty to be dispatched"}</span>
          </span>
          <button type="button" className={`b ${onDuty ? "b-sec" : "b-pri"}`} onClick={() => void toggleDuty()} disabled={dutyBusy}>
            {dutyBusy && <Loader2 size={14} className="animate-spin" />}
            {onDuty ? "End duty" : "Go on duty"}
          </button>
        </div>
        {dutyError && <Notice tone="fail">{dutyError}</Notice>}

        <div className="grid grid-cols-3 gap-2">
          <Link to="/officer/incident/new" className="qa">
            <FileText size={22} /> Report
          </Link>
          <Link to="/officer/patrol" className="qa">
            <CheckCircle2 size={22} /> Check in
          </Link>
          <Link to="/officer/schedule" className="qa">
            <Bell size={22} /> My shifts
          </Link>
        </div>

        {fromCommand && (
          <Link to="/officer/notifications" className="o-card col g8">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="o-lbl">LATEST FROM COMMAND</span>
              <span className="mono t3" style={{ fontSize: 12 }}>
                {timeAgo(fromCommand.sent_at)}
              </span>
            </div>
            <b>{fromCommand.title}</b>
            {fromCommand.body && (
              <span className="t2" style={{ fontSize: 13.5 }}>
                {fromCommand.body}
              </span>
            )}
          </Link>
        )}

        {pending > 0 && (
          <div className="o-card row g12">
            <span className="f1">
              {pending} item{pending === 1 ? "" : "s"} waiting to upload
            </span>
            <span className="t3">sends when you're back online</span>
          </div>
        )}

        <div className="col g8">
          <span className="o-lbl">NEXT SHIFT</span>
          {nextShift ? (
            <Link to="/officer/schedule" className="o-card col">
              <b>
                {new Date(nextShift.scheduled_start).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · {fmtTime(nextShift.scheduled_start)} – {fmtTime(nextShift.scheduled_end)}
              </b>
              <span className="t3">{nextShift.patrol_code ?? "Patrol route"}</span>
            </Link>
          ) : (
            <div className="o-card t3">No upcoming shifts assigned to you.</div>
          )}
        </div>
      </div>
    </>
  );
}
