import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronLeft, Loader2, MapPinned, Navigation2 } from "lucide-react";
import { Notice, Sev } from "@/components/nw";
import { typeMeta, type IncidentType } from "@/lib/mockData";
import { fmtDistance, fmtTime, getPosition, metersBetween, NetPill, playAlertTone, useMyDispatch } from "@/components/officer/kit";

export const Route = createFileRoute("/officer/dispatch")({
  component: OfficerDispatch,
});

function OfficerDispatch() {
  const { dispatch, isLoading, acknowledge, arrived } = useMyDispatch();
  const [busy, setBusy] = useState<"ack" | "arrive" | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "fail"; text: string } | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const toned = useRef<string | null>(null);

  useEffect(() => {
    if (!dispatch || dispatch.alert.read || toned.current === dispatch.alert.id) return;
    toned.current = dispatch.alert.id;
    playAlertTone();
  }, [dispatch]);

  // Straight-line distance from here to the incident, when both positions are known.
  useEffect(() => {
    const inc = dispatch?.incident;
    if (!inc || inc.coord_x == null || inc.coord_y == null) return;
    getPosition(10_000)
      .then((p) => setDistance(metersBetween([p.coords.longitude, p.coords.latitude], [Number(inc.coord_x), Number(inc.coord_y)])))
      .catch(() => setDistance(null));
  }, [dispatch?.incident?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (kind: "ack" | "arrive") => {
    setBusy(kind);
    setMessage(null);
    try {
      if (kind === "ack") {
        await acknowledge();
        setMessage({ tone: "ok", text: "Acknowledged. Command can see it on the incident timeline." });
      } else {
        let coords: { lat: number; lng: number } | null = null;
        try {
          const p = await getPosition(8_000);
          coords = { lat: p.coords.latitude, lng: p.coords.longitude };
        } catch {
          /* arrival is still worth logging without a GPS fix */
        }
        await arrived(coords);
        setMessage({ tone: "ok", text: "Arrival logged on the incident timeline." });
      }
    } catch (e) {
      setMessage({ tone: "fail", text: `${(e as Error)?.message || "That didn't go through."} Tell command on the radio.` });
    } finally {
      setBusy(null);
    }
  };

  if (isLoading) {
    return (
      <div className="o-b">
        <span className="t3">
          <Loader2 size={14} className="mr-2 inline animate-spin" /> Checking for dispatches…
        </span>
      </div>
    );
  }

  if (!dispatch) {
    return (
      <>
        <div className="o-h">
          <Link to="/officer/home" className="ibtn" aria-label="Back">
            <ChevronLeft size={18} />
          </Link>
          <h1 className="f1">Dispatch</h1>
          <NetPill />
        </div>
        <div className="o-b">
          <div className="o-card t2">You have no active dispatch. When command sends you to an incident, it appears here with a sound.</div>
        </div>
      </>
    );
  }

  const { alert, incident } = dispatch;
  return (
    <>
      <div className="o-h">
        <Link to="/officer/home" className="ibtn" aria-label="Back">
          <ChevronLeft size={18} />
        </Link>
        <span className="tg tg-fail">DISPATCH</span>
        <span className="mono t2">{incident.code}</span>
        <span className="flex-auto" />
        <NetPill />
      </div>
      <div className="o-b">
        <div className="col g6">
          <Sev level={incident.severity} label />
          <h1 style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.25, margin: 0 }}>{alert.title}</h1>
          <span className="t2">
            {typeMeta[incident.type as IncidentType] ?? incident.type} · {incident.location}
            {incident.zone ? ` · ${incident.zone}` : ""}
          </span>
        </div>

        <div className="row g10">
          <div className="o-card f1 col">
            <span className="o-lbl">Distance</span>
            <b className="mono" style={{ fontSize: 18 }}>
              {fmtDistance(distance)}
            </b>
            <span className="t3" style={{ fontSize: 11.5 }}>
              {distance != null ? "straight line" : incident.coord_x == null ? "no pin on the incident" : "waiting for GPS"}
            </span>
          </div>
          <div className="o-card f1 col">
            <span className="o-lbl">Sent</span>
            <b className="mono" style={{ fontSize: 18 }}>
              {fmtTime(alert.sent_at)}
            </b>
            <span className="t3" style={{ fontSize: 11.5 }}>
              {alert.read ? "acknowledged" : "not acknowledged yet"}
            </span>
          </div>
        </div>

        {alert.body && (
          <div className="o-card col g8">
            <span className="o-lbl">FROM COMMAND</span>
            <p style={{ margin: 0, lineHeight: 1.55, fontSize: 15 }}>{alert.body}</p>
          </div>
        )}
        {incident.description && (
          <div className="o-card col g8">
            <span className="o-lbl">WHAT WAS REPORTED</span>
            <p className="t2" style={{ margin: 0, lineHeight: 1.55 }}>
              {incident.description}
            </p>
          </div>
        )}

        {message && <Notice tone={message.tone}>{message.text}</Notice>}

        <div className="col g10">
          {!alert.read && (
            <button type="button" className="bigbtn" style={{ background: "var(--s5)", color: "#0A0C10" }} onClick={() => void run("ack")} disabled={!!busy}>
              {busy === "ack" ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={20} />} Acknowledge
            </button>
          )}
          <div className="row g10">
            <Link to="/officer/navigation" className="bigbtn" style={{ background: "var(--blue)", color: "#fff" }}>
              <Navigation2 size={18} /> Route
            </Link>
            <button type="button" className="bigbtn" style={{ background: "var(--ink-2)", color: "var(--tx-1)", borderColor: "var(--line-2)" }} onClick={() => void run("arrive")} disabled={!!busy}>
              {busy === "arrive" ? <Loader2 size={18} className="animate-spin" /> : <MapPinned size={18} />} I'm on scene
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
