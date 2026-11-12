import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getActiveOrgId } from "@/lib/orgs.server";
import { throwSafeError } from "@/lib/server-errors";
import { recordBlackboxAudit } from "@/lib/audit.server";
import { RESPONDER_STATUS, type ResponderView } from "./respond.functions";

// The responder board: emergency hand-offs that operators have sent to this organisation,
// in three columns (incoming, active, history), and the same live view and progress buttons
// as the responder link, but signed in, so each step carries the person's name and unit.

const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;
const ROLES = ["manager", "supervisor", "client_admin"];
const ACT_ROLES = ["manager", "supervisor"];

export type BoardItem = {
  id: string;
  from_org: string;
  boat: string | null;
  boat_kind: string | null;
  voyage: string | null;
  aboard: number | null;
  distance_m: number | null;
  sent_at: string;
  sent_by: string | null;
  operator_phone: string | null;
  status: string;
  status_at: string | null;
  first_viewed_at: string | null;
  expires_at: string | null;
  withdrawn_at: string | null;
  column: "incoming" | "active" | "history";
  ended: "resolved" | "withdrawn" | "expired" | null;
  last_update: { status: string; by_name: string; at: string } | null;
  summary: string;
};

async function ctx(context: { supabase: unknown; userId: string }) {
  const orgId = await getActiveOrgId(context.supabase as any, context.userId);
  const db = await admin();
  const { roleIn, myName } = await import("./links.server");
  const role = await roleIn(db, context.userId, orgId);
  if (!role || !ROLES.includes(role)) throwSafeError("board.role", new Error("role"), "Only managers, operators and client admins can open the responder board.");
  const { data: org } = await db.from("organisations").select("name").eq("id", orgId).maybeSingle();
  return { orgId, db, role, name: await myName(db, context.userId), org: (org?.name as string) ?? "" };
}

export const getResponderBoard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { orgId, db, role } = await ctx(context);
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { data: rows, error } = await db
      .from("movement_handoffs")
      .select("id, organisation_id, voyage_id, subject_id, distance_m, summary, approved_by_name, operator_phone, created_at, share_expires_at, status, status_at, first_viewed_at, withdrawn_at")
      .eq("responder_org_id", orgId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throwSafeError("board.list", error, "Unable to load the responder board.");
    const list = (rows ?? []) as any[];
    const ids = (k: string) => [...new Set(list.map((r) => r[k]).filter(Boolean))] as string[];
    const [{ data: orgs }, { data: subs }, { data: voys }, { data: ups }] = await Promise.all([
      ids("organisation_id").length ? db.from("organisations").select("id, name").in("id", ids("organisation_id")) : { data: [] },
      ids("subject_id").length ? db.from("movement_subjects").select("id, name, kind").in("id", ids("subject_id")) : { data: [] },
      ids("voyage_id").length ? db.from("movement_voyages").select("id, name, departure_count").in("id", ids("voyage_id")) : { data: [] },
      list.length ? db.from("movement_handoff_updates").select("handoff_id, status, by_name, by_org_name, created_at").in("handoff_id", list.map((r) => r.id)).order("created_at", { ascending: false }).limit(1000) : { data: [] },
    ]);
    const by = <T extends { id: string }>(xs: T[] | null) => new Map(((xs ?? []) as T[]).map((x) => [x.id, x]));
    const O = by(orgs as any), S = by(subs as any), V = by(voys as any);
    const now = Date.now();
    const items: BoardItem[] = list.map((h) => {
      const expired = !!h.share_expires_at && Date.parse(h.share_expires_at) < now;
      const ended: BoardItem["ended"] = h.status === "resolved" ? "resolved" : h.withdrawn_at ? "withdrawn" : expired ? "expired" : null;
      const last = ((ups ?? []) as any[]).find((u) => u.handoff_id === h.id);
      const s = S.get(h.subject_id) as any, v = V.get(h.voyage_id) as any;
      return {
        id: h.id,
        from_org: (O.get(h.organisation_id) as any)?.name ?? "",
        boat: s?.name ?? null,
        boat_kind: s?.kind ?? null,
        voyage: v?.name ?? null,
        aboard: v?.departure_count ?? null,
        distance_m: h.distance_m,
        sent_at: h.created_at,
        sent_by: h.approved_by_name,
        operator_phone: ended ? null : h.operator_phone,
        status: h.status,
        status_at: h.status_at,
        first_viewed_at: h.first_viewed_at,
        expires_at: h.share_expires_at,
        withdrawn_at: h.withdrawn_at,
        column: ended ? "history" : h.status === "sent" ? "incoming" : "active",
        ended,
        last_update: last ? { status: last.status, by_name: last.by_org_name ? `${last.by_name} (${last.by_org_name})` : last.by_name, at: last.created_at } : null,
        summary: ended ? "" : h.summary,
      };
    });
    return { role, can_act: ACT_ROLES.includes(role!), items };
  });

async function boardHandoff(context: { supabase: unknown; userId: string }, id: string) {
  const c = await ctx(context);
  const { handoffBy } = await import("./respond.server");
  const h = await handoffBy("id", id);
  if (!h || h.responder_org_id !== c.orgId) throwSafeError("board.handoff", new Error("missing"), "That hand-off isn't on your board.");
  return { ...c, h: h! };
}

export const getBoardHandoff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ view: ResponderView; can_act: boolean }> => {
    const { h, name, org, role } = await boardHandoff(context, data.id);
    const { buildResponderView } = await import("./respond.server");
    return { view: await buildResponderView(h, { markViewedAs: `${name} (${org})` }), can_act: ACT_ROLES.includes(role!) };
  });

export const postBoardUpdate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), status: z.enum([...RESPONDER_STATUS, "note"]), note: z.string().trim().max(1000).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { h, name, org, role, orgId } = await boardHandoff(context, data.id);
    if (!ACT_ROLES.includes(role!)) throwSafeError("board.update", new Error("role"), "Only managers and operators can update a hand-off.");
    const { applyResponderUpdate } = await import("./respond.server");
    try {
      await applyResponderUpdate(h, { status: data.status, by_name: name, note: data.note, by_org_name: org });
    } catch (e) {
      throwSafeError("board.update", e as Error, (e as Error).message);
    }
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "movement_handoff", resourceId: h.id, actionType: `responder_${data.status}`, actionDetail: { from_org: h.organisation_id, note: data.note ?? null } });
    return { ok: true };
  });
