import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getActiveOrgId } from "@/lib/orgs.server";
import { throwSafeError } from "@/lib/server-errors";
import { recordBlackboxAudit } from "@/lib/audit.server";

// Responder link: what a responder with no Lemtik account sees after an operator hands an
// emergency off to them, and how they confirm receipt and report progress. The link is
// time-limited and the operator can withdraw it. Only the boat, its track since shortly
// before the hand-off, the head count and the operator's contact are shown; never names.

export const RESPONDER_STATUS = ["acknowledged", "dispatched", "on_scene", "resolved"] as const;
export type ResponderStatus = (typeof RESPONDER_STATUS)[number];
export const RESPONDER_STATUS_LABEL: Record<string, string> = {
  sent: "Sent, not yet opened",
  viewed: "Opened by the responder",
  acknowledged: "Received",
  dispatched: "Unit dispatched",
  on_scene: "On scene",
  resolved: "Resolved",
  withdrawn: "Withdrawn by the operator",
  note: "Note",
};
const ORDER: Record<string, number> = { sent: 0, acknowledged: 1, dispatched: 2, on_scene: 3, resolved: 4 };
const TRACK_BEFORE_MS = 30 * 60_000;

const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;
const tokenSchema = z.string().min(20).max(64).regex(/^[A-Za-z0-9_-]+$/);

async function handoffByToken(token: string) {
  const db = await admin();
  const { data } = await db
    .from("movement_handoffs")
    .select("id, organisation_id, voyage_id, subject_id, responder_name, summary, approved_by_name, operator_phone, created_at, share_expires_at, status, status_at, first_viewed_at, withdrawn_at")
    .eq("share_token", token)
    .maybeSingle();
  return data as null | {
    id: string; organisation_id: string; voyage_id: string | null; subject_id: string | null; responder_name: string; summary: string;
    approved_by_name: string | null; operator_phone: string | null; created_at: string; share_expires_at: string | null; status: string;
    status_at: string | null; first_viewed_at: string | null; withdrawn_at: string | null;
  };
}

export type ResponderView =
  | { found: false; reason: "invalid" | "withdrawn" | "expired"; operator?: string }
  | {
      found: true;
      operator: string;
      operator_contact: { name: string; phone: string | null };
      responder_name: string;
      sent_at: string;
      expires_at: string | null;
      status: string;
      boat: { name: string; kind: string; reference: string | null; mmsi: string | null; lat: number | null; lng: number | null; last_seen_at: string | null; speed_kn: number | null; state: string | null } | null;
      voyage: { name: string; departed_at: string | null; planned_arrival: string | null; aboard: number | null; route: [number, number][]; corridor_m: number | null } | null;
      track: { lat: number; lng: number; at: string }[];
      alerts: { kind: string; message: string; at: string }[];
      updates: { status: string; by_name: string; by_responder: boolean; note: string | null; at: string }[];
      message: string;
    };

/** Public: what the responder sees. Opening it the first time is recorded and tells the operator. */
export const getResponderView = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: tokenSchema }).parse(d))
  .handler(async ({ data }): Promise<ResponderView> => {
    const h = await handoffByToken(data.token);
    if (!h) return { found: false, reason: "invalid" };
    const db = await admin();
    const { data: org } = await db.from("organisations").select("name").eq("id", h.organisation_id).maybeSingle();
    const operator = (org?.name as string) ?? "";
    if (h.withdrawn_at) return { found: false, reason: "withdrawn", operator };
    if (h.share_expires_at && Date.parse(h.share_expires_at) < Date.now()) return { found: false, reason: "expired", operator };

    if (!h.first_viewed_at) {
      const { data: flipped } = await db.from("movement_handoffs").update({ first_viewed_at: new Date().toISOString() }).eq("id", h.id).is("first_viewed_at", null).select("id");
      if (flipped?.length) {
        await db.from("movement_handoff_updates").insert({ handoff_id: h.id, organisation_id: h.organisation_id, status: "viewed", by_name: h.responder_name.slice(0, 120) });
        if (h.subject_id) {
          const { raiseAlert } = await import("./movement.server");
          await raiseAlert({ id: h.subject_id, organisation_id: h.organisation_id }, "responder_update", 2, `${h.responder_name} opened the hand-off link`, null, h.voyage_id);
        }
      }
    }

    const since = new Date(Date.parse(h.created_at) - TRACK_BEFORE_MS).toISOString();
    const [{ data: s }, { data: v }, { data: pos }, { data: al }, { data: up }] = await Promise.all([
      h.subject_id ? db.from("movement_subjects").select("name, kind, reference, mmsi, last_lat, last_lng, last_seen_at, last_speed_mps, state").eq("id", h.subject_id).maybeSingle() : Promise.resolve({ data: null }),
      h.voyage_id ? db.from("movement_voyages").select("name, departed_at, planned_arrival, departure_count, route, corridor_m").eq("id", h.voyage_id).maybeSingle() : Promise.resolve({ data: null }),
      h.subject_id ? db.from("movement_positions").select("lat, lng, recorded_at").eq("subject_id", h.subject_id).gte("recorded_at", since).order("recorded_at", { ascending: true }).limit(1500) : Promise.resolve({ data: [] }),
      h.subject_id ? db.from("movement_alerts").select("kind, message, created_at").eq("subject_id", h.subject_id).gte("created_at", since).gte("severity", 3).order("created_at", { ascending: false }).limit(10) : Promise.resolve({ data: [] }),
      db.from("movement_handoff_updates").select("status, by_name, by_responder, note, created_at").eq("handoff_id", h.id).order("created_at", { ascending: true }).limit(100),
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
      updates: ((up ?? []) as any[]).map((u) => ({ status: u.status as string, by_name: u.by_name as string, by_responder: !!u.by_responder, note: (u.note as string | null) ?? null, at: u.created_at as string })),
      message: h.summary,
    };
  });

/** Public: the responder confirms receipt or reports progress. Status only moves forward; a note can be added any time. */
export const postResponderUpdate = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      token: tokenSchema,
      status: z.enum([...RESPONDER_STATUS, "note"]),
      by_name: z.string().trim().min(2).max(120),
      note: z.string().trim().max(1000).optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const h = await handoffByToken(data.token);
    if (!h || h.withdrawn_at || (h.share_expires_at && Date.parse(h.share_expires_at) < Date.now())) throw new Error("This link isn't active any more.");
    if (data.status === "note" && !data.note) throw new Error("Write a note first.");
    const db = await admin();
    const { count } = await db.from("movement_handoff_updates").select("id", { count: "exact", head: true }).eq("handoff_id", h.id).eq("by_responder", true);
    if ((count ?? 0) >= 40) throw new Error("Too many updates on this link. Call the operator instead.");
    if (data.status !== "note") {
      if ((ORDER[data.status] ?? 0) <= (ORDER[h.status] ?? 0)) throw new Error(`Already marked "${RESPONDER_STATUS_LABEL[h.status] ?? h.status}".`);
      const { data: moved } = await db.from("movement_handoffs").update({ status: data.status, status_at: new Date().toISOString() }).eq("id", h.id).eq("status", h.status).select("id");
      if (!moved?.length) throw new Error("Someone else just updated this. Reload the page.");
    }
    await db.from("movement_handoff_updates").insert({ handoff_id: h.id, organisation_id: h.organisation_id, status: data.status, by_name: data.by_name, note: data.note || null });
    if (h.subject_id) {
      const { raiseAlert } = await import("./movement.server");
      const what = data.status === "note" ? `added a note: ${data.note}` : `marked "${RESPONDER_STATUS_LABEL[data.status]}"`;
      await raiseAlert({ id: h.subject_id, organisation_id: h.organisation_id }, "responder_update", data.status === "resolved" ? 2 : 3, `${h.responder_name} (${data.by_name}) ${what}`.slice(0, 500), null, h.voyage_id);
    }
    // The responder has no account, so their own update row (name, time, status) is the record.
    return { ok: true };
  });

/** Operator: withdraw a responder link so it stops working at once. */
export const withdrawResponderLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ handoff_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const db = await admin();
    const { roleIn } = await import("./links.server");
    const role = await roleIn(db, context.userId, orgId);
    if (role !== "manager" && role !== "supervisor") throwSafeError("respond.withdraw", new Error("forbidden"), "Only managers and supervisors can withdraw a responder link.");
    const { data: me } = await db.from("profiles").select("display_name").eq("user_id", context.userId).maybeSingle();
    const who = (me?.display_name as string | undefined)?.trim() || "Operator";
    const { data: h } = await db.from("movement_handoffs").update({ withdrawn_at: new Date().toISOString(), withdrawn_by_name: who, status: "withdrawn" }).eq("id", data.handoff_id).eq("organisation_id", orgId).is("withdrawn_at", null).select("id, subject_id, voyage_id, responder_name").maybeSingle();
    if (!h) throwSafeError("respond.withdraw", new Error("not found"), "That link is already withdrawn or doesn't exist.");
    await db.from("movement_handoff_updates").insert({ handoff_id: h.id, organisation_id: orgId, status: "withdrawn", by_name: who, by_responder: false });
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "movement_handoff", resourceId: h.id, actionType: "responder_link_withdrawn", actionDetail: { responder: h.responder_name } });
    return { ok: true };
  });
