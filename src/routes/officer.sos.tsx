import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, Loader2 } from "lucide-react";
import { getActiveOrg } from "@/lib/orgs.functions";
import { sosAlert } from "@/lib/patrols.functions";
import { reportOwnLocation } from "@/lib/officerDuty.functions";
import { recordIncidentAction } from "@/lib/incidentDetail.functions";
import { orgRoom, publishRealtimeEvent } from "@/lib/realtime.events";
import { Notice } from "@/components/nw";
import { fmtTime, getPosition, NetPill, readLocalQueue, SOS_QUEUE_KEY, useMyShifts, useOnline, writeLocalQueue } from "@/components/officer/kit";

type Payload = { shift_id?: string; coord_x?: number; coord_y?: number; note?: string };
type Queued = { id: string; queuedAt: number; payload: Payload };
type Phase = "idle" | "sending" | "queued" | "active" | "cancelled";

const HOLD_MS = 3000;
const LOCATION_EVERY_MS = 10_000;

export const Route = createFileRoute("/officer/sos")({
  component: OfficerSOS,
});

function OfficerSOS() {
  const qc = useQueryClient();
  const online = useOnline();
  const sendSos = useServerFn(sosAlert);
  const sendLocation = useServerFn(reportOwnLocation);
  const logAction = useServerFn(recordIncidentAction);
  const loadOrg = useServerFn(getActiveOrg);
  const { current: shift } = useMyShifts();

  const [phase, setPhase] = useState<Phase>("idle");
  const [note, setNote] = useState("");
  const [hold, setHold] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [incident, setIncident] = useState<{ id: string; code?: string } | null>(null);
  const [recipients, setRecipients] = useState<number | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [lastLocation, setLastLocation] = useState<{ at: number; accuracy: number; sent: boolean } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);
  const holdTimer = useRef<number | null>(null);
  const holdStart = useRef<number>(0);

  useEffect(() => {
    loadOrg()
      .then((o) => setOrgId(o?.id ?? null))
      .catch(() => setOrgId(null));
  }, [loadOrg]);

  const send = useCallback(async () => {
    setPhase("sending");
    setError(null);
    let payload: Payload = { ...(shift?.id ? { shift_id: shift.id } : {}), ...(note.trim() ? { note: note.trim() } : {}) };
    try {
      const p = await getPosition(8_000);
      payload = { ...payload, coord_x: p.coords.longitude, coord_y: p.coords.latitude };
    } catch {
      /* send without a position rather than wait */
    }
    const queueIt = () => {
      writeLocalQueue(SOS_QUEUE_KEY, [...readLocalQueue<Queued>(SOS_QUEUE_KEY), { id: crypto.randomUUID(), queuedAt: Date.now(), payload }]);
      setPhase("queued");
    };
    if (!navigator.onLine) return queueIt();
    try {
      const result = (await sendSos({ data: payload })) as any;
      setIncident(result?.incident ? { id: result.incident.id, code: result.incident.code } : null);
      setRecipients(typeof result?.recipients === "number" ? result.recipients : null);
      setSentAt(Date.now());
      setPhase("active");
      navigator.vibrate?.([250, 120, 250]);
      if (orgId && result?.incident?.id) publishRealtimeEvent(orgRoom(orgId), "incident:created", { incident_id: result.incident.id, severity: 5, source: "officer-sos" });
      qc.invalidateQueries({ queryKey: ["officer-notifications"] });
    } catch (e) {
      setError((e as Error)?.message || "The SOS didn't go through.");
      queueIt();
    }
  }, [note, orgId, qc, sendSos, shift?.id]);

  // Retry queued SOS as soon as the phone is back online.
  useEffect(() => {
    if (!online || phase !== "queued") return;
    (async () => {
      let items = readLocalQueue<Queued>(SOS_QUEUE_KEY);
      for (const item of items) {
        try {
          const result = (await sendSos({ data: item.payload })) as any;
          items = items.filter((i) => i.id !== item.id);
          writeLocalQueue(SOS_QUEUE_KEY, items);
          setIncident(result?.incident ? { id: result.incident.id, code: result.incident.code } : null);
          setRecipients(typeof result?.recipients === "number" ? result.recipients : null);
          setSentAt(Date.now());
          setPhase("active");
        } catch {
          break;
        }
      }
    })();
  }, [online, phase, sendSos]);

  // While the SOS is active, keep sending this officer's position to the server so command's map follows them.
  useEffect(() => {
    if (phase !== "active") return;
    let stop = false;
    const tick = async () => {
      try {
        const p = await getPosition(8_000);
        let sent = false;
        try {
          await sendLocation({ data: { lat: p.coords.latitude, lng: p.coords.longitude } });
          sent = true;
        } catch {
          /* shown as not sent below */
        }
        if (!stop) setLastLocation({ at: Date.now(), accuracy: p.coords.accuracy, sent });
      } catch {
        /* no fix this round */
      }
    };
    void tick();
    const t = window.setInterval(() => void tick(), LOCATION_EVERY_MS);
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, [phase, sendLocation]);

  const startHold = () => {
    if (phase !== "idle") return;
    holdStart.current = Date.now();
    holdTimer.current = window.setInterval(() => {
      const elapsed = Date.now() - holdStart.current;
      setHold(Math.min(1, elapsed / HOLD_MS));
      if (elapsed >= HOLD_MS) {
        stopHold();
        void send();
      }
    }, 50);
  };
  const stopHold = () => {
    if (holdTimer.current) window.clearInterval(holdTimer.current);
    holdTimer.current = null;
    setHold(0);
  };
  useEffect(() => () => stopHold(), []);

  const cancel = async () => {
    setCancelling(true);
    try {
      if (incident?.id) await logAction({ data: { incident_id: incident.id, kind: "sos_cancelled", message: "Officer cancelled the SOS (false alarm).", meta: { note: note.trim() || null } } });
      setPhase("cancelled");
    } catch (e) {
      setError(`${(e as Error)?.message || "Cancelling didn't go through."} Tell command on the radio that it was a false alarm.`);
    } finally {
      setCancelling(false);
    }
  };

  if (phase === "active" || phase === "queued") {
    const sent = phase === "active";
    return (
      <>
        <div className="col g4" style={{ padding: "22px 18px 10px", background: sent ? "color-mix(in oklab, var(--s5) 22%, var(--ink-0))" : "color-mix(in oklab, var(--warn) 18%, var(--ink-0))" }}>
          <span className="row g8 mono" style={{ fontSize: 12, fontWeight: 700 }}>
            <span className="dot d-fail pulse-dot" /> {sent ? `SOS ACTIVE${incident?.code ? ` · ${incident.code}` : ""}` : "SOS NOT SENT YET"}
          </span>
          <b style={{ fontSize: 24 }}>{sent ? "Command has your SOS" : "Waiting for signal"}</b>
          <span className="t2">
            {sent
              ? `Sent ${sentAt ? fmtTime(sentAt) : ""}${recipients != null ? ` to ${recipients} supervisor${recipients === 1 ? "" : "s"} and manager${recipients === 1 ? "" : "s"}` : ""}`
              : "It's saved on this phone and sends the moment you're back online. Use your radio now."}
          </span>
        </div>
        <div className="o-b">
          {error && <Notice tone="fail">{error}</Notice>}
          {sent && (
            <div className="o-card col g8">
              <div className="row g10">
                <b className="f1">Sharing your location</b>
                <span className="mono t3">every 10 s</span>
              </div>
              <span className="t3">
                {lastLocation
                  ? `${lastLocation.sent ? "Last sent" : "Last fix (not sent)"} ${fmtTime(lastLocation.at)} · ±${Math.round(lastLocation.accuracy)} m`
                  : "Getting a GPS fix…"}
              </span>
            </div>
          )}
          <div className="o-card t2" style={{ fontSize: 13.5 }}>
            Keep the radio on. If you can, tell command what's happening on channel.
          </div>
          {sent && (
            <button type="button" className="bigbtn" style={{ background: "var(--ink-2)", color: "var(--tx-1)", borderColor: "var(--line-2)" }} onClick={() => void cancel()} disabled={cancelling}>
              {cancelling && <Loader2 size={18} className="animate-spin" />} Cancel SOS, it was a false alarm
            </button>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="o-h">
        <Link to="/officer/home" className="ibtn" aria-label="Back">
          <ChevronLeft size={18} />
        </Link>
        <span className="flex-auto" />
        <NetPill />
      </div>
      <div className="o-b">
        {phase === "cancelled" && <Notice tone="ok">SOS cancelled and marked as a false alarm on the incident.</Notice>}
        <div className="col g6" style={{ alignItems: "center", textAlign: "center" }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Send SOS?</h1>
          <p className="t2" style={{ margin: 0 }}>
            Hold the button for 3 seconds.
          </p>
        </div>
        <button
          type="button"
          aria-label="Hold for 3 seconds to send SOS"
          onPointerDown={startHold}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          onPointerCancel={stopHold}
          onKeyDown={(e) => (e.key === " " || e.key === "Enter") && !e.repeat && startHold()}
          onKeyUp={stopHold}
          disabled={phase === "sending"}
          style={{
            alignSelf: "center",
            width: 200,
            height: 200,
            borderRadius: 100,
            border: 0,
            color: "#fff",
            background: `conic-gradient(#fff ${hold * 360}deg, transparent 0) border-box, var(--s5)`,
            padding: 8,
            touchAction: "none",
            userSelect: "none",
          }}
        >
          <span className="col" style={{ width: "100%", height: "100%", borderRadius: "50%", background: "var(--s5)", alignItems: "center", justifyContent: "center", gap: 4 }}>
            {phase === "sending" ? <Loader2 size={36} className="animate-spin" /> : <b style={{ fontSize: 38, letterSpacing: ".04em" }}>SOS</b>}
            <span className="mono" style={{ fontSize: 13, opacity: 0.85 }}>
              {phase === "sending" ? "sending…" : hold > 0 ? `${((1 - hold) * 3).toFixed(1)} s` : "hold"}
            </span>
          </span>
        </button>

        <label className="fl">
          <span className="o-lbl">NOTE FOR COMMAND (OPTIONAL)</span>
          <input className="in" value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} placeholder="e.g. two men with machete at Gate C" />
        </label>

        <div className="o-card col g8">
          <span className="o-lbl">WHAT HAPPENS</span>
          <span>• A severity 5 incident is created with your location</span>
          <span>• Supervisors and managers get an SOS alert in the app</span>
          <span>• Your position keeps updating every 10 s until you cancel</span>
          <span className="t3" style={{ fontSize: 12.5 }}>
            {online ? "If the signal drops, the SOS is saved and sent when it returns." : "You're offline. The SOS will be saved and sent when signal returns. Use your radio too."}
          </span>
        </div>
      </div>
    </>
  );
}
