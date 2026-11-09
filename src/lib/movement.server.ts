// Protected Movement: what happens when a tracked person, vehicle or vessel reports a position.
// Server-only. Every write uses the service role, because positions arrive from phones and
// trackers that have no Supabase login; each request is authorised by the subject's tracker
// secret (or, for a Traccar server forwarding hardware trackers, by MOVEMENT_FORWARD_KEY).

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type SubjectRow = {
  id: string;
  organisation_id: string;
  kind: "person" | "vehicle" | "vessel";
  name: string;
  consent_status: string;
  tracking_enabled: boolean;
  last_lat: number | null;
  last_lng: number | null;
  last_seen_at: string | null;
  inside_geofence_ids: string[] | null;
  state: string;
  silent_after_minutes: number;
  checkin_every_minutes: number | null;
  last_checkin_at: string | null;
  checkin_overdue: boolean;
  tracking_started_at: string | null;
  stop_alert_minutes: number | null;
  stopped_since: string | null;
  stop_alerted: boolean;
};

export type Fix = {
  lat: number;
  lng: number;
  accuracy_m?: number | null;
  speed_mps?: number | null;
  heading?: number | null;
  battery?: number | null;
  recorded_at?: string | null;
};

export type TrackerEvent = "position" | "sos" | "man_overboard" | "checkin";

type Geofence = { id: string; name: string; kind: "safe" | "restricted" | "exclusion"; center_lat: number; center_lng: number; radius_m: number; alert_on: "enter" | "exit" | "both"; subject_ids: string[] | null };
type VoyageRow = { id: string; name: string; route: [number, number][]; corridor_m: number; planned_arrival: string | null; off_route: boolean; overdue_alerted: boolean };

const SUBJECT_COLS =
  "id, organisation_id, kind, name, consent_status, tracking_enabled, last_lat, last_lng, last_seen_at, inside_geofence_ids, state, silent_after_minutes, checkin_every_minutes, last_checkin_at, checkin_overdue, tracking_started_at, stop_alert_minutes, stopped_since, stop_alerted";
const db = () => supabaseAdmin as any;

/** How late a voyage may be past its planned arrival before an "overdue" alert. */
const OVERDUE_GRACE_MS = 15 * 60_000;

export function metres(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6_371_000;
  const r = (v: number) => (v * Math.PI) / 180;
  const dLat = r(bLat - aLat);
  const dLng = r(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Shortest distance in metres from a point to a route ([lng, lat] waypoints). */
export function metresFromRoute(lat: number, lng: number, route: [number, number][]): number {
  if (!route.length) return Infinity;
  if (route.length === 1) return metres(lat, lng, route[0][1], route[0][0]);
  // Local flat projection around the point; accurate to well under 1% at corridor scales.
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110_540;
  let best = Infinity;
  for (let i = 0; i < route.length - 1; i++) {
    const ax = (route[i][0] - lng) * kx, ay = (route[i][1] - lat) * ky;
    const bx = (route[i + 1][0] - lng) * kx, by = (route[i + 1][1] - lat) * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const px = ax + t * dx, py = ay + t * dy;
    best = Math.min(best, Math.hypot(px, py));
  }
  return best;
}

export async function subjectByToken(token: string): Promise<SubjectRow | null> {
  if (!/^[0-9a-f]{32}$/i.test(token)) return null;
  const { data } = await db().from("movement_subjects").select(SUBJECT_COLS).eq("tracker_token", token.toLowerCase()).maybeSingle();
  return (data as SubjectRow) ?? null;
}

export async function subjectByDeviceId(deviceId: string): Promise<SubjectRow | null> {
  const { data } = await db().from("movement_subjects").select(SUBJECT_COLS).eq("device_id", deviceId).maybeSingle();
  return (data as SubjectRow) ?? null;
}

async function alert(s: Pick<SubjectRow, "id" | "organisation_id">, kind: string, severity: number, message: string, fix: Pick<Fix, "lat" | "lng"> | null, extra: { geofenceId?: string | null; voyageId?: string | null } = {}) {
  await db().from("movement_alerts").insert({
    organisation_id: s.organisation_id,
    subject_id: s.id,
    geofence_id: extra.geofenceId ?? null,
    voyage_id: extra.voyageId ?? null,
    kind,
    severity,
    message,
    lat: fix?.lat ?? null,
    lng: fix?.lng ?? null,
  });
}

async function underwayVoyage(subjectId: string): Promise<VoyageRow | null> {
  const { data } = await db().from("movement_voyages").select("id, name, route, corridor_m, planned_arrival, off_route, overdue_alerted").eq("subject_id", subjectId).eq("status", "underway").maybeSingle();
  return (data as VoyageRow) ?? null;
}

async function checkOverdue(s: Pick<SubjectRow, "id" | "organisation_id" | "name">, v: VoyageRow, at: Pick<Fix, "lat" | "lng"> | null) {
  if (v.overdue_alerted || !v.planned_arrival) return;
  const late = Date.now() - Date.parse(v.planned_arrival);
  if (late < OVERDUE_GRACE_MS) return;
  const { data: flipped } = await db().from("movement_voyages").update({ overdue_alerted: true }).eq("id", v.id).eq("overdue_alerted", false).select("id");
  if (flipped?.length) await alert(s, "overdue", 4, `${s.name} is overdue on "${v.name}" — planned arrival was ${Math.round(late / 60_000)} min ago`, at, { voyageId: v.id });
}

const ZONE_WORD: Record<Geofence["kind"], string> = { safe: "safe zone", restricted: "restricted zone", exclusion: "exclusion zone" };

/**
 * Store a position and raise any alerts it causes. Returns false (and stores nothing) when
 * the subject has no recorded consent or tracking is switched off.
 */
export async function ingestFix(s: SubjectRow, fix: Fix, source: "phone" | "device" | "satellite" | "manual", event: TrackerEvent = "position"): Promise<{ ok: boolean; reason?: string }> {
  if (s.consent_status !== "granted" || !s.tracking_enabled) return { ok: false, reason: "Tracking is switched off for this person or asset." };
  if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng) || Math.abs(fix.lat) > 90 || Math.abs(fix.lng) > 180) return { ok: false, reason: "Invalid position." };

  const now = new Date().toISOString();
  const recordedAt = fix.recorded_at && Date.parse(fix.recorded_at) <= Date.now() + 60_000 ? fix.recorded_at : now;
  const { error: posErr } = await db().from("movement_positions").insert({
    organisation_id: s.organisation_id,
    subject_id: s.id,
    lat: fix.lat,
    lng: fix.lng,
    accuracy_m: fix.accuracy_m ?? null,
    speed_mps: fix.speed_mps ?? null,
    heading: fix.heading ?? null,
    battery: fix.battery ?? null,
    source,
    recorded_at: recordedAt,
  });
  if (posErr) return { ok: false, reason: "Couldn't save the position." };

  const trusted = fix.accuracy_m == null || fix.accuracy_m <= 250;
  const voyage = await underwayVoyage(s.id);

  // Zones: only trust fixes good to ~250 m, so a jumpy reading doesn't fire false alerts.
  const prev = new Set(s.inside_geofence_ids ?? []);
  let inside = [...prev];
  let insideSafe = false;
  if (trusted) {
    const { data: zones } = await db().from("movement_geofences").select("id, name, kind, center_lat, center_lng, radius_m, alert_on, subject_ids").eq("organisation_id", s.organisation_id).eq("active", true);
    const mine = ((zones ?? []) as Geofence[]).filter((g) => !g.subject_ids || g.subject_ids.includes(s.id));
    const nowIn = mine.filter((g) => metres(fix.lat, fix.lng, g.center_lat, g.center_lng) <= g.radius_m);
    inside = nowIn.map((g) => g.id);
    insideSafe = nowIn.some((g) => g.kind === "safe");
    const now_ = new Set(inside);
    for (const g of mine) {
      const entered = now_.has(g.id) && !prev.has(g.id);
      const exited = !now_.has(g.id) && prev.has(g.id);
      if (entered && g.alert_on !== "exit") {
        const sev = g.kind === "safe" ? 1 : 4;
        await alert(s, "zone_enter", sev, g.kind === "safe" ? `${s.name} arrived at ${g.name}` : `${s.name} entered ${g.name} (${ZONE_WORD[g.kind]})`, fix, { geofenceId: g.id, voyageId: voyage?.id });
      }
      if (exited && g.alert_on !== "enter") {
        const sev = g.kind === "safe" ? 3 : 2;
        await alert(s, "zone_exit", sev, g.kind === "safe" ? `${s.name} left ${g.name}` : `${s.name} left ${g.name} (${ZONE_WORD[g.kind]})`, fix, { geofenceId: g.id, voyageId: voyage?.id });
      }
    }
  }

  // Voyage: off the planned route, back on it, or overdue.
  if (voyage) {
    if (trusted && voyage.route?.length >= 2) {
      const off = metresFromRoute(fix.lat, fix.lng, voyage.route);
      if (off > voyage.corridor_m && !voyage.off_route) {
        await db().from("movement_voyages").update({ off_route: true }).eq("id", voyage.id);
        await alert(s, "off_route", 4, `${s.name} is ${off >= 1000 ? `${(off / 1000).toFixed(1)} km` : `${Math.round(off)} m`} off the planned route of "${voyage.name}"`, fix, { voyageId: voyage.id });
      } else if (off <= voyage.corridor_m * 0.8 && voyage.off_route) {
        await db().from("movement_voyages").update({ off_route: false }).eq("id", voyage.id);
        await alert(s, "back_on_route", 1, `${s.name} is back on the planned route of "${voyage.name}"`, fix, { voyageId: voyage.id });
      }
    }
    await checkOverdue(s, voyage, fix);
  }

  const patch: Record<string, unknown> = {
    last_lat: fix.lat,
    last_lng: fix.lng,
    last_speed_mps: fix.speed_mps ?? null,
    last_heading: fix.heading ?? null,
    last_battery: fix.battery ?? null,
    last_seen_at: recordedAt,
    inside_geofence_ids: inside,
  };

  if (event === "sos" || event === "man_overboard") {
    patch.state = "sos";
    if (event === "sos") await alert(s, "sos", 5, `SOS from ${s.name}`, fix, { voyageId: voyage?.id });
    else await alert(s, "man_overboard", 5, `MAN OVERBOARD reported from ${s.name}`, fix, { voyageId: voyage?.id });
  } else if (s.state !== "sos") {
    if (s.state === "silent") await alert(s, "tracking_resumed", 1, `${s.name}'s tracker is reporting again`, fix, { voyageId: voyage?.id });
    const moved = s.last_lat != null && s.last_lng != null ? metres(s.last_lat, s.last_lng, fix.lat, fix.lng) : 0;
    // ~1.4 knots: below this a boat is stopped or drifting.
    const moving = (fix.speed_mps ?? 0) > 0.7 || moved > 25;
    patch.state = moving ? "moving" : "stopped";

    // Unexpected stop: stopped (or drifting) for too long outside any safe zone.
    if (moving) {
      patch.stopped_since = null;
      patch.stop_alerted = false;
    } else {
      const since = s.stopped_since ?? recordedAt;
      patch.stopped_since = since;
      const stoppedMin = (Date.now() - Date.parse(since)) / 60_000;
      if (s.stop_alert_minutes && !s.stop_alerted && trusted && !insideSafe && stoppedMin >= s.stop_alert_minutes) {
        patch.stop_alerted = true;
        await alert(s, "unexpected_stop", 4, `${s.name} has been stopped for ${Math.round(stoppedMin)} min outside a safe zone${voyage ? ` during "${voyage.name}"` : ""}`, fix, { voyageId: voyage?.id });
      }
    }
  }

  if (event === "checkin") Object.assign(patch, await checkInPatch(s, fix, voyage?.id ?? null));

  await db().from("movement_subjects").update(patch).eq("id", s.id);
  return { ok: true };
}

async function checkInPatch(s: SubjectRow, at: Pick<Fix, "lat" | "lng"> | null, voyageId: string | null) {
  if (s.checkin_overdue) await alert(s, "checkin", 1, `${s.name} checked in: all OK`, at, { voyageId });
  return { last_checkin_at: new Date().toISOString(), checkin_overdue: false };
}

/** "All OK" check-in when the phone has no GPS fix yet. */
export async function checkInWithoutFix(s: SubjectRow): Promise<{ ok: boolean; reason?: string }> {
  if (s.consent_status !== "granted" || !s.tracking_enabled) return { ok: false, reason: "Tracking is switched off for this person or asset." };
  const v = await underwayVoyage(s.id);
  await db().from("movement_subjects").update(await checkInPatch(s, null, v?.id ?? null)).eq("id", s.id);
  return { ok: true };
}

/**
 * Time-based alerts: a tracker gone silent, a missed check-in, a voyage past its arrival time.
 * There's no scheduled job; this runs whenever command loads or refreshes the movement screen
 * (every minute while it's open) and on every position received.
 */
export async function sweepOrg(orgId: string) {
  const { data } = await db().from("movement_subjects").select(SUBJECT_COLS).eq("organisation_id", orgId).eq("tracking_enabled", true);
  const now = Date.now();
  for (const s of (data ?? []) as SubjectRow[]) {
    const at = s.last_lat != null && s.last_lng != null ? { lat: s.last_lat, lng: s.last_lng } : null;

    if (s.last_seen_at && s.state !== "silent" && s.state !== "sos") {
      const quietMin = (now - Date.parse(s.last_seen_at)) / 60_000;
      if (quietMin >= s.silent_after_minutes) {
        const { data: flipped } = await db().from("movement_subjects").update({ state: "silent" }).eq("id", s.id).neq("state", "silent").select("id");
        if (flipped?.length) await alert(s, "silent", 3, `${s.name}'s tracker has been silent for ${Math.round(quietMin)} min`, at);
      }
    }

    if (s.checkin_every_minutes && !s.checkin_overdue) {
      const base = Math.max(s.last_checkin_at ? Date.parse(s.last_checkin_at) : 0, s.tracking_started_at ? Date.parse(s.tracking_started_at) : 0);
      if (base) {
        const lateMin = (now - base) / 60_000 - s.checkin_every_minutes;
        if (lateMin >= 0) {
          const { data: flipped } = await db().from("movement_subjects").update({ checkin_overdue: true }).eq("id", s.id).eq("checkin_overdue", false).select("id");
          if (flipped?.length) {
            const v = await underwayVoyage(s.id);
            await alert(s, "checkin_missed", 4, `${s.name} missed their check-in (due every ${s.checkin_every_minutes} min)`, at, { voyageId: v?.id });
          }
        }
      }
    }
  }

  const { data: voyages } = await db().from("movement_voyages").select("id, name, route, corridor_m, planned_arrival, off_route, overdue_alerted, subject_id").eq("organisation_id", orgId).eq("status", "underway").eq("overdue_alerted", false);
  for (const v of (voyages ?? []) as (VoyageRow & { subject_id: string })[]) {
    const s = ((data ?? []) as SubjectRow[]).find((x) => x.id === v.subject_id);
    const { data: subj } = s ? { data: s } : await db().from("movement_subjects").select("id, organisation_id, name, last_lat, last_lng").eq("id", v.subject_id).maybeSingle();
    if (!subj) continue;
    await checkOverdue(subj, v, subj.last_lat != null ? { lat: subj.last_lat, lng: subj.last_lng } : null);
  }
}

/** Kept for callers of the old name. */
export const markSilentSubjects = sweepOrg;

export async function raiseAlert(subject: Pick<SubjectRow, "id" | "organisation_id">, kind: string, severity: number, message: string, at: Pick<Fix, "lat" | "lng"> | null, voyageId: string | null) {
  await alert(subject, kind, severity, message, at, { voyageId });
}
