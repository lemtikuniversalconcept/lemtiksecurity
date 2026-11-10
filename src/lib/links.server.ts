// Shared helpers for links between organisations (server only).
import { recordBlackboxAudit } from "@/lib/audit.server";

export async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}
export async function roleIn(db: any, userId: string, orgId: string): Promise<string | null> {
  const { data } = await db.from("organisation_members").select("role").eq("user_id", userId).eq("organisation_id", orgId).maybeSingle();
  return (data?.role as string | undefined) ?? null;
}
export async function myName(db: any, userId: string) {
  const { data } = await db.from("profiles").select("display_name").eq("user_id", userId).maybeSingle();
  return (data?.display_name as string | undefined)?.trim() || "A manager";
}
export async function logEvent(db: any, link: { id: string; owner_org_id: string; partner_org_id: string }, actor: { id: string; name: string; org: string }, action: string, detail: Record<string, unknown> = {}) {
  await db.from("org_link_events").insert({ link_id: link.id, owner_org_id: link.owner_org_id, partner_org_id: link.partner_org_id, actor_id: actor.id, actor_name: actor.name, actor_org_id: actor.org, action, detail });
  // Into both organisations' audit logs.
  for (const orgId of [link.owner_org_id, link.partner_org_id]) {
    await recordBlackboxAudit({ userId: actor.id, orgId, resourceType: "org_link", resourceId: link.id, actionType: action, actionDetail: { ...detail, by_org: actor.org } });
  }
}

