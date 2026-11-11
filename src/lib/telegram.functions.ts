import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { throwSafeError } from "@/lib/server-errors";

// Linking a user's own Telegram chat to their Lemtik account, for alerts.

const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;

export type MyTelegram = { configured: boolean; linked: boolean; username: string | null; name: string | null; linked_at: string | null };

export const getMyTelegram = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyTelegram> => {
    const { botToken } = await import("./telegram.server");
    const configured = !!botToken();
    const { data } = await (context.supabase as any).from("user_telegram").select("tg_username, tg_name, linked_at").eq("user_id", context.userId).maybeSingle();
    return { configured, linked: !!data, username: data?.tg_username ?? null, name: data?.tg_name ?? null, linked_at: data?.linked_at ?? null };
  });

/** Returns a t.me link that opens the bot with a one-time code (valid 15 minutes). */
export const startTelegramLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ url: string; app_url: string; bot: string; command: string }> => {
    const { botToken, botUsername, ensureWebhook } = await import("./telegram.server");
    if (!botToken()) throwSafeError("telegram.link", new Error("no token"), "Telegram isn't set up on this system yet.");
    const { getSiteUrl } = await import("./orgs.server");
    const hook = await ensureWebhook(getSiteUrl());
    if (!hook.ok) throwSafeError("telegram.link", new Error(hook.description ?? "setWebhook failed"), "Couldn't connect to Telegram. Check the bot token and try again.");
    const username = await botUsername();
    if (!username) throwSafeError("telegram.link", new Error("getMe failed"), "Couldn't reach the Telegram bot. Check the bot token.");
    const db = await admin();
    const { count } = await db.from("telegram_link_codes").select("code", { count: "exact", head: true }).eq("user_id", context.userId).gte("created_at", new Date(Date.now() - 3600_000).toISOString());
    if ((count ?? 0) >= 10) throwSafeError("telegram.link", new Error("rate"), "Too many attempts. Try again in an hour.");
    const { randomBytes } = await import("node:crypto");
    const code = randomBytes(18).toString("base64url");
    const { error } = await db.from("telegram_link_codes").insert({ code, user_id: context.userId, expires_at: new Date(Date.now() + 15 * 60_000).toISOString() });
    if (error) throwSafeError("telegram.link", error, "Couldn't start linking. Try again.");
    return { url: `https://t.me/${username}?start=${code}`, app_url: `tg://resolve?domain=${username}&start=${code}`, bot: username, command: `/start ${code}` };
  });

export const unlinkTelegram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin();
    const { data } = await db.from("user_telegram").delete().eq("user_id", context.userId).select("chat_id").maybeSingle();
    if (data?.chat_id) {
      const { tg } = await import("./telegram.server");
      await tg("sendMessage", { chat_id: data.chat_id, text: "Unlinked from Lemtik. You won't get alerts here any more." });
    }
    return { ok: true };
  });
