import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, LifeBuoy, Loader2, MapPin, ShieldCheck } from "lucide-react";
import { getTrackerInfo, reportTrackerFix, trackerCheckIn } from "@/lib/movement.functions";
import { LemtikMark, Notice } from "@/components/nw";

/**
 * The page a protected person (a student, a principal, a boat's crew) opens from their tracker
 * link. No login: the secret in the link identifies them. Location is only sent while they have
 * pressed "Start sharing" on this page, and only if their security team recorded consent.
 */
export const Route = createFileRoute("/track/$token")({
  head: () => ({ meta: [{ title: "Location sharing · Lemtik" }, { name: "robots", content: "noindex" }, { name: "theme-color", content: "#0A0C10" }] }),
  component: Tracker,
});

type Info = Awaited<ReturnType<typeof getTrackerInfo>>;
const SEND_EVERY_MS = 15_000;
const HOLD_MS = 2000;

function Tracker() {
  const { token } = Route.useParams();
  const loadInfo = useServerFn(getTrackerInfo);
  const send = useServerFn(reportTrackerFix);
  const checkInNoFix = useServerFn(trackerCheckIn);

  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [last, setLast] = useState<{ at: number; accuracy: number; ok: boolean } | null>(null);
  const [sosSent, setSosSent] = useState<null | "sos" | "man_overboard">(null);
  const [hold, setHold] = useState<{ kind: "sos" | "man_overboard"; p: number } | null>(null);
  const [lastCheckin, setLastCheckin] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const watchId = useRef<number | null>(null);
  const latest = useRef<GeolocationPosition | null>(null);
  const lastSent = useRef(0);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  const holdTimer = useRef<number | null>(null);

  useEffect(() => {
    loadInfo({ data: { token } })
      .then((r) => {
        setInfo(r);
        if (r.found && r.sos) setSosSent("sos");
        if (r.found && r.last_checkin_at) setLastCheckin(Date.parse(r.last_checkin_at));
      })
      .catch(() => setError("Couldn't reach Lemtik. Check your connection and reload."));
  }, [loadInfo, token]);

  const battery = async (): Promise<number | null> => {
    try {
      const b = await (navigator as any).getBattery?.();
      return b ? Math.round(b.level * 100) : null;
    } catch {
      return null;
    }
  };

  const push = useCallback(
    async (p: GeolocationPosition, event: "position" | "sos" | "man_overboard" | "checkin" = "position") => {
      lastSent.current = Date.now();
      try {
        const r = await send({
          data: {
            token,
            lat: p.coords.latitude,
            lng: p.coords.longitude,
            accuracy_m: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null,
            speed_mps: p.coords.speed != null && p.coords.speed >= 0 ? p.coords.speed : null,
            heading: p.coords.heading != null && Number.isFinite(p.coords.heading) ? p.coords.heading : null,
            battery: await battery(),
            event,
          },
        });
        setLast({ at: Date.now(), accuracy: p.coords.accuracy, ok: r.ok });
        if (!r.ok) {
          setError(r.reason ?? "Your security team isn't receiving your location.");
          if (event === "position") stop();
        } else setError(null);
        return r.ok;
      } catch {
        setLast({ at: Date.now(), accuracy: p.coords.accuracy, ok: false });
        return false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [send, token],
  );

  const start = () => {
    if (!navigator.geolocation) {
      setError("This browser can't share location. Open the link in Chrome or Safari.");
      return;
    }
    setError(null);
    setSharing(true);
    (navigator as any).wakeLock?.request?.("screen").then((l: any) => (wakeLock.current = l)).catch(() => undefined);
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        latest.current = p;
        if (Date.now() - lastSent.current >= SEND_EVERY_MS) void push(p);
      },
      (e) => setError(e.code === 1 ? "Location permission was refused. Allow location for this site in your phone settings, then press Start again." : "Waiting for a GPS signal…"),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
    );
  };

  function stop() {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    void wakeLock.current?.release().catch(() => undefined);
    wakeLock.current = null;
    setSharing(false);
  }

  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep sending on a timer even when standing still, so command knows the tracker is alive.
  useEffect(() => {
    if (!sharing) return;
    const t = window.setInterval(() => {
      if (latest.current && Date.now() - lastSent.current >= SEND_EVERY_MS) void push(latest.current);
    }, 5_000);
    return () => window.clearInterval(t);
  }, [sharing, push]);

  const currentFix = async () =>
    latest.current ?? (await new Promise<GeolocationPosition | null>((res) => navigator.geolocation.getCurrentPosition(res, () => res(null), { enableHighAccuracy: true, timeout: 10_000 })));

  const fireAlarm = async (kind: "sos" | "man_overboard") => {
    const p = await currentFix();
    if (!p) {
      setError(`No GPS fix yet, so the ${kind === "sos" ? "SOS" : "man overboard alert"} couldn't include your location. Call your security team now.`);
      return;
    }
    const ok = await push(p, kind);
    if (ok) {
      setSosSent(kind);
      navigator.vibrate?.([250, 120, 250]);
      if (!sharing) start();
    }
  };
  const startHold = (kind: "sos" | "man_overboard") => {
    const t0 = Date.now();
    holdTimer.current = window.setInterval(() => {
      const k = (Date.now() - t0) / HOLD_MS;
      setHold({ kind, p: Math.min(1, k) });
      if (k >= 1) {
        endHold();
        void fireAlarm(kind);
      }
    }, 40);
  };
  function endHold() {
    if (holdTimer.current) window.clearInterval(holdTimer.current);
    holdTimer.current = null;
    setHold(null);
  }

  const checkIn = async () => {
    setChecking(true);
    try {
      const p = latest.current;
      const ok = p ? await push(p, "checkin") : (await checkInNoFix({ data: { token } })).ok;
      if (ok) {
        setLastCheckin(Date.now());
        navigator.vibrate?.(80);
      } else setError("Check-in didn't go through. Try again, or call your security team.");
    } catch {
      setError("Check-in didn't go through. Check your connection and try again.");
    } finally {
      setChecking(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-dvh col" style={{ background: "var(--ink-0)", color: "var(--tx-1)", maxWidth: 480, margin: "0 auto", padding: "20px 18px 32px", gap: 16 }}>
      <div className="row g8">
        <LemtikMark size={24} />
        <b>Lemtik</b>
        <span className="t3" style={{ fontSize: 12 }}>Protected movement</span>
      </div>
      {children}
    </div>
  );

  if (!info) return shell(error ? <Notice tone="fail">{error}</Notice> : <span className="row g8 t2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</span>);
  if (!info.found) return shell(<Notice tone="fail">This tracker link isn't valid. It may have been replaced. Ask your security team for the current link.</Notice>);

  const ready = info.consent === "granted" && info.tracking;
  const every = info.checkin_every_minutes;
  const nextDue = every && lastCheckin ? lastCheckin + every * 60_000 : null;
  const fmt = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const holdBtn = (kind: "sos" | "man_overboard", size: number) => {
    const p = hold?.kind === kind ? hold.p : 0;
    const label = kind === "sos" ? "SOS" : "MAN OVERBOARD";
    return (
      <button
        type="button"
        aria-label={`Hold for 2 seconds to send ${kind === "sos" ? "SOS" : "a man overboard alert"}`}
        onPointerDown={() => startHold(kind)}
        onPointerUp={endHold}
        onPointerLeave={endHold}
        onPointerCancel={endHold}
        style={{
          alignSelf: "center",
          width: size,
          height: size,
          borderRadius: size / 2,
          border: 0,
          color: "#fff",
          background: `conic-gradient(#fff ${p * 360}deg, transparent 0) border-box, ${kind === "sos" ? "var(--s5)" : "#E8590C"}`,
          padding: 7,
          touchAction: "none",
          userSelect: "none",
        }}
      >
        <span className="col" style={{ width: "100%", height: "100%", borderRadius: "50%", background: kind === "sos" ? "var(--s5)" : "#E8590C", alignItems: "center", justifyContent: "center", gap: 2 }}>
          {kind === "man_overboard" && <LifeBuoy size={22} />}
          <b style={{ fontSize: kind === "sos" ? 32 : 13, textAlign: "center", lineHeight: 1.1 }}>{label}</b>
          <span style={{ fontSize: 11.5, opacity: 0.85 }}>{p > 0 ? "keep holding" : "hold 2 s"}</span>
        </span>
      </button>
    );
  };
  return shell(
    <>
      <div className="col g4">
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{info.name}</h1>
        <span className="t2">Shares your location with {info.organisation}.</span>
      </div>

      {!ready ? (
        <Notice tone="warn">
          {info.consent !== "granted"
            ? "Your security team hasn't recorded your consent yet, so location sharing is off. Ask them to record it, then reload this page."
            : "Your security team has switched tracking off for now. Nothing is being shared."}
        </Notice>
      ) : (
        <>
          {error && <Notice tone="fail">{error}</Notice>}
          {sosSent && (
            <Notice tone="fail">
              {sosSent === "sos" ? "SOS sent." : "Man overboard alert sent."} Your security team has your location. Keep this page open and call them if you can.
            </Notice>
          )}

          <div className="o-card col g8" style={{ padding: 14 }}>
            <div className="row g8">
              <span className={`dot ${sharing ? "d-ok pulse-dot" : "d-off"}`} />
              <b className="f1">{sharing ? "Sharing your location" : "Not sharing"}</b>
              <MapPin size={16} className="t3" />
            </div>
            <span className="t3" style={{ fontSize: 13 }}>
              {last ? `${last.ok ? "Last sent" : "Last attempt failed"} ${new Date(last.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · ±${Math.round(last.accuracy)} m` : sharing ? "Getting a GPS fix…" : "Press Start when you set off. Keep this page open; your screen will stay on."}
            </span>
            <button type="button" className={`b ${sharing ? "b-sec" : "b-pri"}`} style={{ height: 46, fontSize: 15 }} onClick={() => (sharing ? stop() : start())}>
              {sharing ? "Stop sharing" : "Start sharing"}
            </button>
          </div>

          <div className="o-card col g8" style={{ padding: 14 }}>
            <div className="row g8">
              <CheckCircle2 size={16} className="t3" />
              <b className="f1">Check in</b>
            </div>
            <span className="t3" style={{ fontSize: 13 }}>
              {every
                ? lastCheckin
                  ? `Last check-in ${fmt(lastCheckin)}. Next due by ${fmt(nextDue!)}${nextDue! < Date.now() ? " — overdue, check in now" : ""}.`
                  : `Your team expects an "All OK" every ${every} minutes.`
                : lastCheckin
                  ? `Last check-in ${fmt(lastCheckin)}.`
                  : "Let your security team know you're safe."}
            </span>
            <button type="button" className="b b-sec" style={{ height: 46, fontSize: 15 }} onClick={() => void checkIn()} disabled={checking}>
              {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 size={16} />} All OK
            </button>
          </div>

          <div className="row" style={{ justifyContent: "center", gap: 20, flexWrap: "wrap" }}>
            {holdBtn("sos", 156)}
            {info.kind === "vessel" && holdBtn("man_overboard", 156)}
          </div>
        </>
      )}

      <div className="row g8 t3" style={{ fontSize: 12, alignItems: "flex-start" }}>
        <ShieldCheck size={14} style={{ flex: "none", marginTop: 2 }} />
        <span>Your location is sent only while this page is sharing, and only your organisation's security leads can see it. Location history is deleted after 90 days.</span>
      </div>
    </>,
  );
}
