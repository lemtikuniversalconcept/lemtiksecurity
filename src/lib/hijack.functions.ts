import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getActiveOrgId } from "@/lib/orgs.server";
import { throwSafeError } from "@/lib/server-errors";
import { recordBlackboxAudit } from "@/lib/audit.server";

// The operator's decision on a possible-hijack flag: confirm it (then hand off to a responder)
// or dismiss it as a false alarm with a reason. Either way the decision, who made it and why
// are kept on the voyage and in the audit trail.

export const reviewPossibleHijack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      alert_id: z.string().uuid(),
      decision: z.enum(["confirmed", "dismissed"]),
      note: z.string().trim().max(1000).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { roleIn } = await import("./links.server");
    const role = await roleIn(db, context.userId, orgId);
    if (role !== "manager" && role !== "supervisor") throwSafeError("hijack.review", new Error("forbidden"), "Only managers and supervisors can confirm or dismiss a possible hijack.");
    if (data.decision === "dismissed" && (data.note ?? "").length < 5) throwSafeError("hijack.review", new Error("no reason"), "Say why it's a false alarm (at least a few words).");

    const { data: a } = await db.from("movement_alerts").select("id, subject_id, voyage_id, kind, lat, lng").eq("id", data.alert_id).eq("organisation_id", orgId).maybeSingle();
    if (!a || a.kind !== "possible_hijack" || !a.voyage_id) throwSafeError("hijack.review", new Error("not found"), "That flag wasn't found.");
    const { data: me } = await db.from("profiles").select("display_name").eq("user_id", context.userId).maybeSingle();
    const who = (me?.display_name as string | undefined)?.trim() || "Operator";
    const now = new Date().toISOString();

    const { data: v } = await db
      .from("movement_voyages")
      .update({ hijack_review: data.decision, hijack_reviewed_at: now, hijack_reviewed_by: context.userId, hijack_reviewed_by_name: who, hijack_review_note: data.note || null })
      .eq("id", a.voyage_id)
      .eq("organisation_id", orgId)
      .is("hijack_review", null)
      .select("id, name")
      .maybeSingle();
    if (!v) throwSafeError("hijack.review", new Error("already reviewed"), "Someone has already decided on this flag.");

    await db.from("movement_alerts").update({ acknowledged_at: now, acknowledged_by: context.userId }).eq("id", a.id).is("acknowledged_at", null);
    const { data: subj } = await db.from("movement_subjects").select("id, organisation_id, name").eq("id", a.subject_id).maybeSingle();
    if (subj) {
      const { raiseAlert } = await import("./movement.server");
      await raiseAlert(
        subj,
        "hijack_review",
        data.decision === "confirmed" ? 4 : 1,
        data.decision === "confirmed"
          ? `${who} confirmed the possible hijack of ${subj.name} on "${v.name}"${data.note ? `: ${data.note}` : ""}`
          : `${who} dismissed the possible-hijack flag on ${subj.name} as a false alarm: ${data.note}`,
        a.lat != null ? { lat: a.lat, lng: a.lng } : null,
        a.voyage_id,
      );
    }
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "movement_voyage", resourceId: a.voyage_id, actionType: `possible_hijack_${data.decision}`, actionDetail: { note: data.note ?? null } });
    return { ok: true, subject_id: a.subject_id as string };
  });
