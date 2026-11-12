// Tells a responder organisation's staff that a hand-off has arrived on their board.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const db = () => supabaseAdmin as any;
const BOARD_ROLES = ["manager", "supervisor"];

export async function notifyResponderOrg(responderOrgId: string, fromOrgId: string, boat: string, summary: string) {
  const [{ data: members }, { data: from }] = await Promise.all([
    db().from("organisation_members").select("user_id").eq("organisation_id", responderOrgId).in("role", BOARD_ROLES),
    db().from("organisations").select("name").eq("id", fromOrgId).maybeSingle(),
  ]);
  const ids = ((members ?? []) as { user_id: string }[]).map((m) => m.user_id);
  if (!ids.length) return;
  const title = `Emergency hand-off from ${from?.name ?? "an operator"}: ${boat}`.slice(0, 200);
  await db().from("alerts").insert({
    organisation_id: responderOrgId, severity: 5, channel: "in-app", channels: ["in-app", "push"], alert_type: "responder_handoff", status: "delivered",
    title, body: summary.slice(0, 1000), action: "Open the responder board", recipients: ids.length, delivered_count: ids.length, failed_count: 0,
    recipient_user_ids: ids, acknowledged: false,
  });
  try {
    const { sendToUsers } = await import("./push.server");
    await sendToUsers(ids, { title, body: summary.slice(0, 300), url: "/app/responder", tag: `handoff-${fromOrgId}-${boat}`, requireInteraction: true });
  } catch {
    // Push is best effort; the in-app alert and the board already carry it.
  }
}
