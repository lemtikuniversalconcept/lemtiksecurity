// Sends a push notification to every device a set of users has enabled. Removes subscriptions
// the browser reports as gone.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendPush, type PushMessage } from "./webpush.server";

const db = () => supabaseAdmin as any;

export async function sendToUsers(userIds: string[], msg: PushMessage): Promise<Map<string, { sent: number; failed: number; detail?: string }>> {
  const out = new Map<string, { sent: number; failed: number; detail?: string }>();
  if (!userIds.length) return out;
  const { data } = await db().from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth").in("user_id", userIds);
  for (const u of userIds) out.set(u, { sent: 0, failed: 0, detail: "No devices" });
  const rows = (data ?? []) as { id: string; user_id: string; endpoint: string; p256dh: string; auth: string }[];
  await Promise.all(
    rows.map(async (s) => {
      const r = await sendPush(s, msg);
      const cur = out.get(s.user_id)!;
      if (r.ok) {
        cur.sent += 1;
        cur.detail = undefined;
        await db().from("push_subscriptions").update({ last_ok_at: new Date().toISOString() }).eq("id", s.id);
      } else {
        cur.failed += 1;
        if (!cur.sent) cur.detail = r.detail;
        if (r.gone) await db().from("push_subscriptions").delete().eq("id", s.id);
      }
    }),
  );
  return out;
}
