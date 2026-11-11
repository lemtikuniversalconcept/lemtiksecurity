import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { throwSafeError } from "@/lib/server-errors";

// Browser push: register this device, remove it, send a test to my own devices.

const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;

export const getPushStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ configured: boolean; public_key: string; devices: number }> => {
    const { VAPID_PUBLIC_KEY, vapidConfigured } = await import("./webpush.server");
    const { count } = await (context.supabase as any).from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", context.userId);
    return { configured: vapidConfigured(), public_key: VAPID_PUBLIC_KEY, devices: count ?? 0 };
  });

export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      endpoint: z.string().url().max(1000).startsWith("https://"),
      p256dh: z.string().min(80).max(200),
      auth: z.string().min(16).max(100),
      device_label: z.string().max(120).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { count } = await db.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", context.userId);
    if ((count ?? 0) >= 10) throwSafeError("push.save", new Error("too many"), "You have push turned on for 10 devices already. Turn it off on one first.");
    const { error } = await db.from("push_subscriptions").upsert(
      { user_id: context.userId, endpoint: data.endpoint, p256dh: data.p256dh, auth: data.auth, device_label: data.device_label ?? null },
      { onConflict: "endpoint" },
    );
    if (error) throwSafeError("push.save", error, "Couldn't turn on notifications for this device.");
    return { ok: true };
  });

export const removePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ endpoint: z.string().max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    const db = await admin();
    await db.from("push_subscriptions").delete().eq("user_id", context.userId).eq("endpoint", data.endpoint);
    return { ok: true };
  });

/** Sends a test notification to all of the signed-in user's devices. */
export const sendPushTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { sendToUsers } = await import("./push.server");
    const r = await sendToUsers([context.userId], { title: "🧪 Test alert from Lemtik", body: "Push notifications work on this device.", url: "/app/alerts#escalation", tag: "lemtik-test" });
    const mine = r.get(context.userId) ?? { sent: 0, failed: 0, detail: "No devices" };
    if (!mine.sent) throwSafeError("push.test", new Error(mine.detail ?? "none"), mine.detail === "No devices" ? "Turn on notifications on this device first." : `Couldn't send: ${mine.detail}`);
    return { sent: mine.sent };
  });
