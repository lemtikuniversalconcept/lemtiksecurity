// What a responder sees for a hand-off, and how their progress is recorded. Used by the public
// responder link and by the responder board inside the app, so both show and record the same.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ResponderView } from "./respond.functions";

const db = () => supabaseAdmin as any;
const ORDER: Record<string, number> = { sent: 0, acknowledged: 1, dispatched: 2, on_scene: 3, resolved: 4 };
const TRACK_BEFORE_MS = 30 * 60_000;
export const STATUS_WORDS: Record<string, string> = { acknowledged: "Received", dispatched: "Unit dispatched", on_scene: "On scene", resolved: "Resolved" };

export type Handoff = {
  id: string; organisation_id: string; voyage_id: string | null; subject_id: string | null; responder_name: string; summary: string;
  approved_by_name: string | null; operator_phone: string | null; created_at: string; share_expires_at: string | null; status: string;
  status_at: string | null; first_viewed_at: string | null; withdrawn_at: string | null; responder_org_id: string | null;
};
const COLS = "id, organisation_id, voyage_id, subject_id, responder_name, summary, approved_by_name, operator_phone, created_at, share_expires_at, status, status_at, first_viewed_at, withdrawn_at, responder_org_id";

export async function handoffBy(col: "share_token" | "id", value: string): Promise<Handoff | null> {
  const { data } = await db().from("movement_handoffs").select(COLS).eq(col, value).maybeSingle();
  return (data as Handoff) ?? null;
}

export const handoffLive = (h: Handoff) => !h.withdrawn_at && !(h.share_expires_at && Date.parse(h.share_expires_at) < Date.now());

/** Builds the responder's view. The first opening is recorded and tells the operator. */
export async function buildResponderView(h: Handoff, opts: { markViewedAs: string }): Promise<ResponderView> {
  const { data: org } = await db().from("organisations").select("name").eq("id", h.organisation_id).maybeSingle();
  const operator = (org?.name as string) ?? "";
  if (h.withdrawn_at) return { found: false, reason: "withdrawn", operator };
  if (h.share_expires_at && Date.parse(h.share_expires_at) < Date.now()) return { found: false, reason: "expired", operator };

  if (!h.first_viewed_at) {
    const { data: flipped } = await db().from("movement_handoffs").update({ first_viewed_at: new Date().toISOString() }).eq("id", h.id).is("first_viewed_at", null).select("id");
    if (flipped?.length) {
      await db().from("movement_handoff_updates").insert({ handoff_id: h.id, organisation_id: h.organisation_id, status: "viewed", by_name: opts.markViewedAs.slice(0, 120) });
      if (h.subject_id) {
        const { raiseAlert } = await import("./movement.server");
        await raiseAlert({ id: h.subject_id, organisation_id: h.organisation_id }, "responder_update", 2, `${opts.markViewedAs} opened the hand-off`, null, h.voyage_id);
      }
    }
  }

  const since = new Date(Date.parse(h.created_at) - TRACK_BEFORE_MS).toISOString();
  const [{ data: s }, { data: v }, { data: pos }, { data: al }, { data: up }] = await Promise.all([
    h.subject_id ? db().from("movement_subjects").select("name, kind, reference, mmsi, last_lat, last_lng, last_seen_at, last_speed_mps, state").eq("id", h.subject_id).maybeSingle() : Promise.resolve({ data: null }),
    h.voyage_id ? db().from("movement_voyages").select("name, departed_at, planned_arrival, departure_count, route, corridor_m").eq("id", h.voyage_id).maybeSingle() : Promise.resolve({ data: null }),
    h.subject_id ? db().from("movement_positions").select("lat, lng, recorded_at").eq("subject_id", h.subject_id).gte("recorded_at", since).order("recorded_at", { ascending: true }).limit(1500) : Promise.resolve({ data: [] }),
    h.subject_id ? db().from("movement_alerts").select("kind, message, created_at").eq("subject_id", h.subject_id).gte("created_at", since).gte("severity", 3).order("created_at", { ascending: false }).limit(10) : Promise.resolve({ data: [] }),
    db().from("movement_handoff_updates").select("status, by_name, by_org_name, by_responder, note, created_at").eq("handoff_id", h.id).order("created_at", { ascending: true }).limit(100),
  ]);
  return {
    found: true,
    operator,
    operator_contact: { name: h.approved_by_name ?? "Operator", phone: h.operator_phone },
    responder_name: h.responder_name,
    sent_at: h.created_at,
    expires_at: h.share_expires_at,
    status: h.status,
    boat: s
      ? { name: s.name, kind: s.kind, reference: s.reference ?? null, mmsi: s.mmsi ?? null, lat: s.last_lat ?? null, lng: s.last_lng ?? null, last_seen_at: s.last_seen_at ?? null, speed_kn: s.last_speed_mps != null ? Math.round(s.last_speed_mps * 1.943844 * 10) / 10 : null, state: s.state ?? null }
      : null,
    voyage: v ? { name: v.name, departed_at: v.departed_at ?? null, planned_arrival: v.planned_arrival ?? null, aboard: v.departure_count ?? null, route: (v.route ?? []) as [number, number][], corridor_m: v.corridor_m ?? null } : null,
    track: ((pos ?? []) as any[]).map((p) => ({ lat: p.lat as number, lng: p.lng as number, at: p.recorded_at as string })),
    alerts: ((al ?? []) as any[]).map((a) => ({ kind: a.kind as string, message: a.message as string, at: a.created_at as string })),
    updates: ((up ?? []) as any[]).map((u) => ({ status: u.status as string, by_name: u.by_org_name ? `${u.by_name} (${u.by_org_name})` : (u.by_name as string), by_responder: !!u.by_responder, note: (u.note as string | null) ?? null, at: u.created_at as string })),
    message: h.summary,
  };
}

/** Records a responder's progress. Status only moves forward; a note can be added any time. */
export async function applyResponderUpdate(h: Handoff | null, input: { status: string; by_name: string; note?: string; by_org_name: string | null }) {
  if (!h || !handoffLive(h)) throw new Error("This hand-off isn't active any more.");
  if (input.status === "note" && !input.note) throw new Error("Write a note first.");
  const { count } = await db().from("movement_handoff_updates").select("id", { count: "exact", head: true }).eq("handoff_id", h.id).eq("by_responder", true);
  if ((count ?? 0) >= 40) throw new Error("Too many updates on this hand-off. Call the operator instead.");
  if (input.status !== "note") {
    if ((ORDER[input.status] ?? 0) <= (ORDER[h.status] ?? 0)) throw new Error(`Already marked "${STATUS_WORDS[h.status] ?? h.status}".`);
    const { data: moved } = await db().from("movement_handoffs").update({ status: input.status, status_at: new Date().toISOString() }).eq("id", h.id).eq("status", h.status).select("id");
    if (!moved?.length) throw new Error("Someone else just updated this. Reload the page.");
  }
  await db().from("movement_handoff_updates").insert({ handoff_id: h.id, organisation_id: h.organisation_id, status: input.status, by_name: input.by_name.slice(0, 120), by_org_name: input.by_org_name, note: input.note || null });
  if (h.subject_id) {
    const { raiseAlert } = await import("./movement.server");
    const what = input.status === "note" ? `added a note: ${input.note}` : `marked "${STATUS_WORDS[input.status] ?? input.status}"`;
    const who = input.by_org_name ? `${input.by_name}, ${input.by_org_name}` : `${h.responder_name} (${input.by_name})`;
    await raiseAlert({ id: h.subject_id, organisation_id: h.organisation_id }, "responder_update", input.status === "resolved" ? 2 : 3, `${who} ${what}`.slice(0, 500), null, h.voyage_id);
  }
}
