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

const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;
const tokenSchema = z.string().min(20).max(64).regex(/^[A-Za-z0-9_-]+$/);

async function handoffByToken(token: string) {
  const { handoffBy } = await import("./respond.server");
  return handoffBy("share_token", token);
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
    const { buildResponderView } = await import("./respond.server");
    return buildResponderView(h, { markViewedAs: h.responder_name });
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
    const { applyResponderUpdate } = await import("./respond.server");
    await applyResponderUpdate(h, { status: data.status, by_name: data.by_name, note: data.note, by_org_name: null });
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
