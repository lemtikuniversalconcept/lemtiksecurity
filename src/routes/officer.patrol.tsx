import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { CheckCircle2, FileText, Loader2, MapPin, QrCode } from "lucide-react";
import { parseCheckpoint } from "@/lib/checkpointQr";
import { QrScanner } from "@/components/officer/QrScanner";
import { add3DBuildings, basemapOptions, BasemapSwitch, useBasemap } from "@/lib/basemap";
import { getMapboxToken } from "@/lib/config.functions";
import { getPatrol, listCheckIns, recordCheckIn, updateShift } from "@/lib/patrols.functions";
import { Notice } from "@/components/nw";
import { fmtDistance, fmtTime, getPosition, metersBetween, NetPill, PATROL_QUEUE_KEY, readLocalQueue, useMyShifts, useOnline, writeLocalQueue } from "@/components/officer/kit";

export const Route = createFileRoute("/officer/patrol")({
  component: OfficerPatrol,
});

type Coord = [number, number];
type Waypoint = { id: string; ord: number; name: string; coord_x: number | null; coord_y: number | null; expected_minutes: number };
type Queued =
  | { id: string; queuedAt: number; kind: "checkin"; payload: { shift_id: string; waypoint_id: string; method: "gps" | "qr"; qr_token?: string; coord_x?: number; coord_y?: number } }
  | { id: string; queuedAt: number; kind: "handover"; payload: { id: string; handover_notes: string; end: boolean } };

const CHECKIN_RADIUS_M = 50;

/** Reads the queue, upgrading items saved by the previous version of this screen ({ action: { kind, payload } }). */
function readQueue(): Queued[] {
  const out: Queued[] = [];
  for (const raw of readLocalQueue<any>(PATROL_QUEUE_KEY)) {
    const item = raw?.action ? { id: raw.id, queuedAt: raw.queuedAt, kind: raw.action.kind, payload: raw.action.payload } : raw;
    if (item?.kind === "checkin" && item.payload?.shift_id && item.payload?.waypoint_id) out.push(item);
    else if (item?.kind === "handover" && item.payload?.id) out.push(item);
    // anything else (e.g. check-ins against stops with no id) can't be uploaded and is dropped
  }
  return out;
}

function OfficerPatrol() {
  const qc = useQueryClient();
  const online = useOnline();
  const patrolFn = useServerFn(getPatrol);
  const checkInsFn = useServerFn(listCheckIns);
  const recordFn = useServerFn(recordCheckIn);
  const updateShiftFn = useServerFn(updateShift);
  const tokenFn = useServerFn(getMapboxToken);
  const { current: shift, isLoading: shiftsLoading } = useMyShifts();

  const { data: token } = useQuery({ queryKey: ["mapbox-token"], queryFn: () => tokenFn(), staleTime: Infinity });
  const { data: patrol, isLoading: patrolLoading } = useQuery({
    queryKey: ["officer-patrol", shift?.patrol_id],
    queryFn: () => patrolFn({ data: { id: shift!.patrol_id } }) as Promise<any>,
    enabled: !!shift?.patrol_id,
  });
  const { data: checkIns = [] } = useQuery({
    queryKey: ["officer-patrol-checkins", shift?.patrol_id],
    queryFn: () => checkInsFn({ data: { patrol_id: shift!.patrol_id } }) as unknown as Promise<any[]>,
    enabled: !!shift?.patrol_id,
  });

  const [here, setHere] = useState<Coord | null>(null);
  const [queue, setQueue] = useState<Queued[]>(() => readQueue());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "fail"; text: string } | null>(null);
  const [mismatch, setMismatch] = useState<number | null>(null);
  const [handover, setHandover] = useState("");
  const [scanning, setScanning] = useState(false);

  const waypoints: Waypoint[] = useMemo(() => ((patrol?.waypoints ?? []) as Waypoint[]).slice().sort((a, b) => a.ord - b.ord), [patrol]);
  const doneIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of checkIns as any[]) if (c.shift_id === shift?.id && c.waypoint_id) ids.add(c.waypoint_id);
    for (const q of queue) if (q.kind === "checkin" && q.payload.shift_id === shift?.id) ids.add(q.payload.waypoint_id);
    return ids;
  }, [checkIns, queue, shift?.id]);
  const next = waypoints.find((w) => !doneIds.has(w.id)) ?? null;
  const nextCoord: Coord | null = next && next.coord_x != null && next.coord_y != null ? [Number(next.coord_x), Number(next.coord_y)] : null;
  const distance = here && nextCoord ? metersBetween(here, nextCoord) : null;
  const timeOf = (wid: string) => (checkIns as any[]).find((c) => c.shift_id === shift?.id && c.waypoint_id === wid)?.created_at as string | undefined;

  const locate = useCallback(() => {
    getPosition(10_000)
      .then((p) => setHere([p.coords.longitude, p.coords.latitude]))
      .catch(() => setHere(null));
  }, []);
  useEffect(() => {
    locate();
    const t = setInterval(locate, 20_000);
    return () => clearInterval(t);
  }, [locate]);

  const saveQueue = (items: Queued[]) => {
    writeLocalQueue(PATROL_QUEUE_KEY, items);
    setQueue(items);
  };

  const flush = useCallback(async () => {
    let items = readQueue();
    if (!items.length) return;
    let sent = 0;
    for (const item of items) {
      try {
        if (item.kind === "checkin") await recordFn({ data: item.payload });
        else await updateShiftFn({ data: item.payload });
        items = items.filter((i) => i.id !== item.id);
        writeLocalQueue(PATROL_QUEUE_KEY, items);
        sent += 1;
      } catch {
        break;
      }
    }
    setQueue(items);
    if (sent) {
      setMessage({ tone: "ok", text: `${sent} saved check-in${sent === 1 ? "" : "s"} uploaded.` });
      qc.invalidateQueries({ queryKey: ["officer-patrol-checkins"] });
      qc.invalidateQueries({ queryKey: ["officer-shifts"] });
    }
  }, [qc, recordFn, updateShiftFn]);
  useEffect(() => {
    if (online) void flush();
  }, [online, flush]);

  // QR check-in: proves the officer stood at the stop, which GPS can't do indoors.
  const onScan = async (text: string) => {
    setScanning(false);
    setMessage(null);
    if (!shift) return;
    const parsed = parseCheckpoint(text);
    if (!parsed) return setMessage({ tone: "fail", text: "That isn't a Lemtik checkpoint code." });
    const stop = waypoints.find((w) => w.id === parsed.waypointId);
    if (!stop) return setMessage({ tone: "fail", text: "That checkpoint isn't on your route for this shift." });
    if (doneIds.has(stop.id)) return setMessage({ tone: "warn", text: `${stop.name} is already checked in for this shift.` });
    const payload = { shift_id: shift.id, waypoint_id: stop.id, method: "qr" as const, qr_token: parsed.token, ...(here ? { coord_x: here[0], coord_y: here[1] } : {}) };
    if (!online) {
      saveQueue([...queue, { id: crypto.randomUUID(), queuedAt: Date.now(), kind: "checkin", payload }]);
      setMessage({ tone: "warn", text: `${stop.name} scanned and saved on this phone. It uploads when you're back online, and command sees the upload time.` });
      return;
    }
    setBusy(true);
    try {
      const row = (await recordFn({ data: payload })) as any;
      const st = row?.status as string | undefined;
      const text =
        st === "out_of_zone"
          ? `${stop.name} scanned, but your phone is ${row?.distance_m != null ? `${Math.round(row.distance_m)} m` : "far"} from it. It's saved and flagged for command.`
          : st === "no_location"
            ? `${stop.name} scanned without your location, so it's flagged for command. Turn on location for check-ins.`
            : st === "too_fast"
              ? `${stop.name} scanned too soon after your last stop to have walked there. It's saved and flagged for command.`
              : `Checked in at ${stop.name} by QR${st === "late" ? ` (${row.minutes_late} min late)` : ""}.`;
      setMessage({ tone: st === "on_time" ? "ok" : st === "late" ? "warn" : "fail", text });
      qc.invalidateQueries({ queryKey: ["officer-patrol-checkins"] });
    } catch (e) {
      setMessage({ tone: "fail", text: (e as Error)?.message || "Check-in didn't save. Try again." });
    } finally {
      setBusy(false);
    }
  };

  const checkIn = async (override: boolean) => {
    if (!shift || !next) return;
    setMessage(null);
    if (!override && distance != null && distance > CHECKIN_RADIUS_M) {
      setMismatch(distance);
      return;
    }
    setMismatch(null);
    const payload = { shift_id: shift.id, waypoint_id: next.id, method: "gps" as const, ...(here ? { coord_x: here[0], coord_y: here[1] } : {}) };
    if (!online) {
      saveQueue([...queue, { id: crypto.randomUUID(), queuedAt: Date.now(), kind: "checkin", payload }]);
      setMessage({ tone: "warn", text: `Saved on this phone. It uploads when you're back online, and command sees the upload time.` });
      return;
    }
    setBusy(true);
    try {
      const row = (await recordFn({ data: payload })) as any;
      const late = row?.status === "late" ? ` (${row.minutes_late} min late)` : "";
      const out = row?.status === "out_of_zone" ? " Marked as outside the 50 m zone." : "";
      setMessage({ tone: row?.status === "on_time" ? "ok" : "warn", text: `Checked in at ${next.name}${late}.${out}` });
      qc.invalidateQueries({ queryKey: ["officer-patrol-checkins"] });
    } catch (e) {
      setMessage({ tone: "fail", text: `${(e as Error)?.message || "Check-in didn't save."} Try again, or tell command on the radio.` });
    } finally {
      setBusy(false);
    }
  };

  const submitHandover = async () => {
    if (!shift) return;
    const payload = { id: shift.id, handover_notes: handover.trim(), end: true };
    if (!online) {
      saveQueue([...queue, { id: crypto.randomUUID(), queuedAt: Date.now(), kind: "handover", payload }]);
      setMessage({ tone: "warn", text: "Handover saved on this phone. It uploads when you're back online." });
      return;
    }
    setBusy(true);
    try {
      await updateShiftFn({ data: payload });
      setHandover("");
      setMessage({ tone: "ok", text: "Shift ended and handover notes sent." });
      qc.invalidateQueries({ queryKey: ["officer-shifts"] });
    } catch (e) {
      setMessage({ tone: "fail", text: (e as Error)?.message || "Handover didn't save." });
    } finally {
      setBusy(false);
    }
  };

  const loading = shiftsLoading || (shift && patrolLoading);
  const p = patrol?.patrol;

  return (
    <>
      <div className="o-h">
        <div className="col f1" style={{ minWidth: 0 }}>
          <span className="t3">{p ? `${p.code} · ${doneIds.size} of ${waypoints.length} done` : "Patrol"}</span>
          <h1 className="trunc">{p?.name ?? "My patrol"}</h1>
        </div>
        <NetPill />
      </div>

      {loading ? (
        <div className="o-b t3">
          <span>
            <Loader2 size={14} className="mr-2 inline animate-spin" /> Loading your shift…
          </span>
        </div>
      ) : !shift ? (
        <div className="o-b">
          <div className="o-card t2">You don't have a patrol shift running now. Your supervisor assigns shifts; upcoming ones are under My shifts.</div>
          <Link to="/officer/schedule" className="b b-sec" style={{ alignSelf: "flex-start" }}>
            My shifts
          </Link>
        </div>
      ) : (
        <>
          {token?.token && waypoints.some((w) => w.coord_x != null) ? (
            <PatrolMap token={token.token} waypoints={waypoints} doneIds={doneIds} nextId={next?.id ?? null} here={here} />
          ) : null}

          <div className="o-b">
            {waypoints.length === 0 ? (
              <Notice tone="warn">This route has no stops yet. Ask your supervisor to add them.</Notice>
            ) : !next ? (
              <div className="o-card row g10">
                <CheckCircle2 size={20} style={{ color: "var(--ok)" }} />
                <b className="f1">All {waypoints.length} stops checked in for this shift.</b>
              </div>
            ) : (
              <div className="o-card col g12">
                <div className="row g12">
                  <span className="col f1" style={{ minWidth: 0 }}>
                    <span className="o-lbl">NEXT CHECK-IN</span>
                    <b className="trunc" style={{ fontSize: 17 }}>
                      {next.name}
                    </b>
                  </span>
                  <span className="col" style={{ alignItems: "flex-end" }}>
                    <b className="mono">{nextCoord ? fmtDistance(distance) : "—"}</b>
                    <span className="t3" style={{ fontSize: 12 }}>
                      {!nextCoord ? "stop has no pin" : here ? "from you" : "finding you…"}
                    </span>
                  </span>
                </div>
                {mismatch != null ? (
                  <div className="col g10">
                    <b>You seem to be {fmtDistance(mismatch)} from {next.name}.</b>
                    <span className="t2" style={{ fontSize: 13.5 }}>
                      Check-ins need you within {CHECKIN_RADIUS_M} m. GPS can drift between buildings. If you check in anyway, it's recorded as outside the zone and command can see that.
                    </span>
                    <button type="button" className="bigbtn" style={{ background: "var(--ink-2)", color: "var(--tx-1)", borderColor: "var(--line-2)" }} onClick={() => setMismatch(null)}>
                      Not there yet, keep walking
                    </button>
                    <button type="button" className="bigbtn" style={{ background: "var(--warn)", color: "#0A0C10" }} onClick={() => void checkIn(true)} disabled={busy}>
                      I'm here, check in anyway
                    </button>
                  </div>
                ) : (
                  <button type="button" className="bigbtn" style={{ background: "var(--blue)", color: "#fff" }} onClick={() => void checkIn(false)} disabled={busy}>
                    {busy ? <Loader2 size={18} className="animate-spin" /> : <MapPin size={18} />} Check in at {next.name}
                  </button>
                )}
                <button type="button" className={p?.checkin_method === "qr" ? "bigbtn" : "b b-sec"} style={p?.checkin_method === "qr" ? { background: "var(--ink-2)", color: "var(--tx-1)", borderColor: "var(--line-2)" } : { justifyContent: "center" }} onClick={() => setScanning(true)} disabled={busy}>
                  <QrCode size={18} /> Scan checkpoint QR code
                </button>
                <Link to="/officer/incident/new" className="b b-sec" style={{ justifyContent: "center" }}>
                  <FileText size={16} /> Report something
                </Link>
              </div>
            )}

            {message && <Notice tone={message.tone}>{message.text}</Notice>}

            {waypoints.length > 0 && (
              <ol className="o-card list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {waypoints.map((w, i) => {
                  const done = doneIds.has(w.id);
                  const t = timeOf(w.id);
                  const queued = done && !t;
                  return (
                    <li key={w.id} className="row g10" style={{ padding: "10px 4px" }}>
                      <span className="mono" style={{ width: 22, height: 22, borderRadius: 11, display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, background: done ? "var(--ok)" : w.id === next?.id ? "var(--blue)" : "var(--ink-3)", color: done ? "#0A0C10" : "#fff" }}>
                        {done ? "✓" : i + 1}
                      </span>
                      <span className="f1 trunc">{w.name}</span>
                      <span className="mono t3" style={{ fontSize: 12 }}>
                        {t ? fmtTime(t) : queued ? "saved, not sent" : w.id === next?.id ? "next" : ""}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}

            <div className="o-card col g10">
              <span className="o-lbl">END SHIFT</span>
              <textarea className="in" rows={3} value={handover} onChange={(e) => setHandover(e.target.value)} placeholder="Handover notes for the next officer" style={{ height: "auto", paddingTop: 8 }} />
              <button type="button" className="b b-sec" onClick={() => void submitHandover()} disabled={busy} style={{ alignSelf: "flex-start" }}>
                End shift and send handover
              </button>
            </div>
          </div>
        </>
      )}
      {scanning && <QrScanner onResult={(t) => void onScan(t)} onClose={() => setScanning(false)} />}
    </>
  );
}

function PatrolMap({ token, waypoints, doneIds, nextId, here }: { token: string; waypoints: Waypoint[]; doneIds: Set<string>; nextId: string | null; here: Coord | null }) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<mapboxgl.Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [basemap, setBasemap] = useBasemap();
  const placed = waypoints.filter((w) => w.coord_x != null && w.coord_y != null);

  useEffect(() => {
    if (!el.current || mapRef.current) return;
    const first = placed[0];
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({ container: el.current, ...basemapOptions(basemap), center: [Number(first.coord_x), Number(first.coord_y)], zoom: 16, attributionControl: true });
    map.on("load", () => {
      add3DBuildings(map, basemap);
      map.addSource("route", { type: "geojson", data: { type: "Feature", geometry: { type: "LineString", coordinates: placed.map((w) => [Number(w.coord_x), Number(w.coord_y)]) }, properties: {} } as any });
      map.addLayer({ id: "route", type: "line", source: "route", layout: { "line-cap": "round" }, paint: { "line-color": "#7A9BFF", "line-width": 3, "line-dasharray": [2, 1.5] } });
      const b = new mapboxgl.LngLatBounds();
      for (const w of placed) b.extend([Number(w.coord_x), Number(w.coord_y)]);
      map.fitBounds(b, { padding: 40, maxZoom: 17, duration: 0 });
      setReady(true);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    markers.current.forEach((m) => m.remove());
    markers.current = [];
    placed.forEach((w) => {
      const done = doneIds.has(w.id);
      const s = document.createElement("span");
      s.style.cssText = `width:${w.id === nextId ? 18 : 12}px;height:${w.id === nextId ? 18 : 12}px;border-radius:50%;background:${done ? "#35C77B" : w.id === nextId ? "#7A9BFF" : "#2A3140"};box-shadow:0 0 0 2px #0A0C10`;
      markers.current.push(new mapboxgl.Marker({ element: s }).setLngLat([Number(w.coord_x), Number(w.coord_y)]).addTo(map));
    });
    if (here) {
      const me = document.createElement("span");
      me.style.cssText = "width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 0 0 3px #3462F0,0 0 0 10px rgba(52,98,240,.25)";
      markers.current.push(new mapboxgl.Marker({ element: me }).setLngLat(here).addTo(map));
    }
  }, [ready, placed, doneIds, nextId, here]);

  return (
    <div className="map" style={{ height: 240, borderRadius: 0, borderLeft: 0, borderRight: 0 }}>
      <div ref={el} style={{ position: "absolute", inset: 0 }} />
      <BasemapSwitch value={basemap} onChange={setBasemap} style={{ right: 8, bottom: 8 }} />
    </div>
  );
}
