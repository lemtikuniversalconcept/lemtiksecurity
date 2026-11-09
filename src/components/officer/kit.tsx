import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { listMyNotifications, markNotificationRead } from "@/lib/alerts.functions";
import { listIncidents } from "@/lib/incidents.functions";
import { listShifts } from "@/lib/patrols.functions";
import { recordIncidentAction } from "@/lib/incidentDetail.functions";
import * as incidentQueue from "@/lib/offlineQueue";

/* ------------------------------------------------------------------ */
/* Shared state for the officer app. Everything here comes from the    */
/* officer's own records; nothing falls back to someone else's data.  */
/* ------------------------------------------------------------------ */

export function useOnline() {
  // Start online so server and browser render the same HTML; the effect reads the real state.
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    setOnline(navigator.onLine !== false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function useMe() {
  return useQuery({
    queryKey: ["officer-me"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return null;
      let displayName: string | null = null;
      try {
        const { data: profile } = await supabase.from("profiles").select("display_name").eq("user_id", data.user.id).maybeSingle();
        displayName = profile?.display_name ?? null;
      } catch {
        /* the id is what matters for matching shifts; the name is cosmetic */
      }
      return { id: data.user.id, name: displayName || data.user.email || "Officer" };
    },
  });
}

export type Shift = {
  id: string;
  patrol_id: string;
  patrol_code?: string | null;
  officer_id: string | null;
  officer_name: string | null;
  scheduled_start: string;
  scheduled_end: string;
  status: string;
  started_at?: string | null;
  handover_notes?: string | null;
};

/** Shifts that belong to this officer: assigned by user id, or by exact name when no id was set. */
export function useMyShifts() {
  const me = useMe();
  const listSh = useServerFn(listShifts);
  const q = useQuery({ queryKey: ["officer-shifts"], queryFn: () => listSh({ data: {} }) as unknown as Promise<Shift[]>, refetchInterval: 60_000 });
  const mine = useMemo(() => {
    const user = me.data;
    if (!user) return [] as Shift[];
    const name = user.name.trim().toLowerCase();
    return ((q.data ?? []) as Shift[])
      .filter((s) => (s.officer_id ? s.officer_id === user.id : (s.officer_name ?? "").trim().toLowerCase() === name))
      .sort((a, b) => Date.parse(a.scheduled_start) - Date.parse(b.scheduled_start));
  }, [q.data, me.data]);
  const now = Date.now();
  const current =
    mine.find((s) => s.status === "active") ??
    mine.find((s) => s.status === "scheduled" && Date.parse(s.scheduled_start) <= now && Date.parse(s.scheduled_end) >= now) ??
    null;
  const upcoming = mine.filter((s) => s.status === "scheduled" && Date.parse(s.scheduled_start) > now);
  return { shifts: mine, current, upcoming, isLoading: q.isLoading || me.isLoading };
}

export type Notification = {
  id: string;
  title: string;
  body?: string | null;
  severity?: number | null;
  alert_type?: string | null;
  sent_at: string;
  incident_id?: string | null;
  recipient_user_ids?: string[] | null;
  read?: boolean;
};

export function useMyNotifications() {
  const listN = useServerFn(listMyNotifications);
  return useQuery({ queryKey: ["officer-notifications"], queryFn: () => listN() as Promise<Notification[]>, refetchInterval: 20_000 });
}

const CLOSED = new Set(["resolved", "closed"]);

/**
 * The officer's current dispatch: the newest alert addressed to them personally that points at an
 * incident which is still open. Broadcast alerts and other people's incidents never count.
 */
export function useMyDispatch() {
  const notes = useMyNotifications();
  const listInc = useServerFn(listIncidents);
  const incidents = useQuery({ queryKey: ["officer-incidents"], queryFn: () => listInc() as Promise<any[]>, refetchInterval: 30_000 });
  const qc = useQueryClient();
  const markRead = useServerFn(markNotificationRead);
  const logAction = useServerFn(recordIncidentAction);

  const dispatch = useMemo(() => {
    const byId = new Map((incidents.data ?? []).map((i: any) => [i.id, i]));
    for (const n of notes.data ?? []) {
      if (!n.incident_id || !n.recipient_user_ids?.length || n.alert_type === "sos") continue;
      const incident = byId.get(n.incident_id);
      if (incident && !CLOSED.has(incident.status)) return { alert: n, incident };
    }
    return null;
  }, [notes.data, incidents.data]);

  const acknowledge = async () => {
    if (!dispatch) return;
    await markRead({ data: { alert_id: dispatch.alert.id } });
    await logAction({ data: { incident_id: dispatch.incident.id, kind: "dispatch_acknowledged", message: "Officer acknowledged the dispatch.", meta: { alert_id: dispatch.alert.id } } });
    await qc.invalidateQueries({ queryKey: ["officer-notifications"] });
  };

  const arrived = async (coords: { lat: number; lng: number } | null) => {
    if (!dispatch) return;
    await logAction({ data: { incident_id: dispatch.incident.id, kind: "officer_on_scene", message: "Officer reported arriving on scene.", meta: coords ? { lat: coords.lat, lng: coords.lng } : {} } });
  };

  return { dispatch, isLoading: notes.isLoading || incidents.isLoading, acknowledge, arrived };
}

/* ------------------------- offline queues ------------------------- */

export const PATROL_QUEUE_KEY = "lemtik.officer.patrol-queue.v1";
export const SOS_QUEUE_KEY = "lemtik.officer.sos-queue.v1";

export function readLocalQueue<T = unknown>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(key) || "[]");
  } catch {
    return [];
  }
}

export function writeLocalQueue(key: string, items: unknown[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(items));
  } catch {
    /* storage full or blocked: the caller still shows the item as not sent */
  }
}

/** Everything waiting to upload from this device. */
export function usePendingUploads() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const read = () => setCount(incidentQueue.list().length + readLocalQueue(PATROL_QUEUE_KEY).length + readLocalQueue(SOS_QUEUE_KEY).length);
    read();
    const unsub = incidentQueue.subscribe(read);
    window.addEventListener("storage", read);
    const t = window.setInterval(read, 5_000);
    return () => {
      unsub();
      window.removeEventListener("storage", read);
      window.clearInterval(t);
    };
  }, []);
  return count;
}

/* ------------------------------ ui ------------------------------ */

export function NetPill() {
  const online = useOnline();
  const pending = usePendingUploads();
  return (
    <span className="net" role="status">
      <span className={`dot ${online ? "d-ok" : "d-warn"}`} />
      {online ? (pending ? `Online · ${pending} to upload` : "Online") : pending ? `Offline · ${pending} waiting` : "Offline"}
    </span>
  );
}

export function OHeader({ eyebrow, title, right }: { eyebrow?: ReactNode; title: ReactNode; right?: ReactNode }) {
  return (
    <div className="o-h">
      <div className="col f1" style={{ minWidth: 0 }}>
        {eyebrow ? <span className="t3">{eyebrow}</span> : null}
        <h1 className="trunc">{title}</h1>
      </div>
      {right ?? <NetPill />}
    </div>
  );
}

export function playAlertTone() {
  try {
    navigator.vibrate?.([200, 120, 200, 120, 350]);
  } catch {
    /* no vibration support */
  }
  try {
    const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 920;
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    osc.stop(ctx.currentTime + 0.24);
    setTimeout(() => void ctx.close(), 300);
  } catch {
    /* best effort */
  }
}

export function getPosition(timeout = 15_000) {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Location isn't available on this device."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout, maximumAge: 10_000 });
  });
}

export function metersBetween(a: [number, number], b: [number, number]) {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function fmtDistance(m: number | null | undefined) {
  if (m == null) return "—";
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

export function fmtTime(iso: string | number) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
