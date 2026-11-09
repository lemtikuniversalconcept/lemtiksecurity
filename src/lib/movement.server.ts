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

type Geofence = { id: string; name: string; kind: "safe" | "restricted" | "exclusion"; center_lat: number; center_lng: number; radius_m: number; alert_on: "enter" | "exit" | "both"; subject_ids: string[] | null };

const SUBJECT_COLS = "id, organisation_id, kind, name, consent_status, tracking_enabled, last_lat, last_lng, last_seen_at, inside_geofence_ids, state, silent_after_minutes";
const db = () => supabaseAdmin as any;

export function metres(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6_371_000;
  const r = (v: number) => (v * Math.PI) / 180;
  const dLat = r(bLat - aLat);
  const dLng = r(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
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

async function alert(s: SubjectRow, kind: string, severity: number, message: string, fix: Fix | null, geofenceId: string | null = null) {
  await db().from("movement_alerts").insert({
    organisation_id: s.organisation_id,
    subject_id: s.id,
    geofence_id: geofenceId,
    kind,
    severity,
    message,
    lat: fix?.lat ?? null,
    lng: fix?.lng ?? null,
  });
}

const ZONE_WORD: Record<Geofence["kind"], string> = { safe: "safe zone", restricted: "restricted zone", exclusion: "exclusion zone" };

/**
 * Store a position and raise any alerts it causes. Returns false (and stores nothing) when
 * the subject has no recorded consent or tracking is switched off.
 */
export async function ingestFix(s: SubjectRow, fix: Fix, source: "phone" | "device" | "satellite" | "manual", sos = false): Promise<{ ok: boolean; reason?: string }> {
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

  // Zones: only trust fixes good to ~250 m, so a jumpy reading doesn't fire false alerts.
  const prev = new Set(s.inside_geofence_ids ?? []);
  let inside = [...prev];
  if (fix.accuracy_m == null || fix.accuracy_m <= 250) {
    const { data: zones } = await db().from("movement_geofences").select("id, name, kind, center_lat, center_lng, radius_m, alert_on, subject_ids").eq("organisation_id", s.organisation_id).eq("active", true);
    const mine = ((zones ?? []) as Geofence[]).filter((g) => !g.subject_ids || g.subject_ids.includes(s.id));
    inside = mine.filter((g) => metres(fix.lat, fix.lng, g.center_lat, g.center_lng) <= g.radius_m).map((g) => g.id);
    const now_ = new Set(inside);
    for (const g of mine) {
      const entered = now_.has(g.id) && !prev.has(g.id);
      const exited = !now_.has(g.id) && prev.has(g.id);
      if (entered && g.alert_on !== "exit") {
        const sev = g.kind === "safe" ? 1 : g.kind === "restricted" ? 4 : 4;
        await alert(s, "zone_enter", sev, g.kind === "safe" ? `${s.name} arrived at ${g.name}` : `${s.name} entered ${g.name} (${ZONE_WORD[g.kind]})`, fix, g.id);
      }
      if (exited && g.alert_on !== "enter") {
        const sev = g.kind === "safe" ? 3 : 2;
        await alert(s, "zone_exit", sev, g.kind === "safe" ? `${s.name} left ${g.name}` : `${s.name} left ${g.name} (${ZONE_WORD[g.kind]})`, fix, g.id);
      }
    }
  }

  let state = s.state;
  if (sos) {
    state = "sos";
    await alert(s, "sos", 5, `SOS from ${s.name}`, fix);
  } else if (s.state !== "sos") {
    if (s.state === "silent") await alert(s, "tracking_resumed", 1, `${s.name}'s tracker is reporting again`, fix);
    const moved = s.last_lat != null && s.last_lng != null ? metres(s.last_lat, s.last_lng, fix.lat, fix.lng) : 0;
    state = (fix.speed_mps ?? 0) > 0.7 || moved > 25 ? "moving" : "stopped";
  }

  await db()
    .from("movement_subjects")
    .update({
      last_lat: fix.lat,
      last_lng: fix.lng,
      last_speed_mps: fix.speed_mps ?? null,
      last_heading: fix.heading ?? null,
      last_battery: fix.battery ?? null,
      last_seen_at: recordedAt,
      inside_geofence_ids: inside,
      state,
    })
    .eq("id", s.id);
  return { ok: true };
}

/**
 * Raise a "tracker silent" alert for anything tracked that hasn't reported within its window.
 * Called whenever command loads the movement screen, so no scheduled job is needed.
 */
export async function markSilentSubjects(orgId: string) {
  const { data } = await db()
    .from("movement_subjects")
    .select(SUBJECT_COLS)
    .eq("organisation_id", orgId)
    .eq("tracking_enabled", true)
    .not("last_seen_at", "is", null)
    .not("state", "in", "(silent,sos)");
  const now = Date.now();
  for (const s of (data ?? []) as SubjectRow[]) {
    const quietMin = (now - Date.parse(s.last_seen_at!)) / 60_000;
    if (quietMin < s.silent_after_minutes) continue;
    const { data: flipped } = await db().from("movement_subjects").update({ state: "silent" }).eq("id", s.id).neq("state", "silent").select("id");
    if (flipped?.length) {
      await alert(s, "silent", 3, `${s.name}'s tracker has been silent for ${Math.round(quietMin)} min`, s.last_lat != null && s.last_lng != null ? { lat: s.last_lat, lng: s.last_lng } : null);
    }
  }
}
