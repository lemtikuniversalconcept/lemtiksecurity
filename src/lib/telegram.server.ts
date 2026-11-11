// Telegram Bot API helpers. The bot token lives in TELEGRAM_BOT_TOKEN (Vercel). The webhook
// secret is derived from the token, so there is nothing else to configure.

import { createHash, timingSafeEqual } from "node:crypto";

export function botToken(): string | null {
  const t = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return t && /^\d+:[A-Za-z0-9_-]{20,}$/.test(t) ? t : null;
}

export function webhookSecret(token: string) {
  return createHash("sha256").update(`lemtik-telegram-webhook:${token}`).digest("hex").slice(0, 48);
}

export function secretMatches(got: string | null, token: string) {
  if (!got) return false;
  const a = createHash("sha256").update(got).digest();
  const b = createHash("sha256").update(webhookSecret(token)).digest();
  return timingSafeEqual(a, b);
}

export async function tg<T = any>(method: string, body: Record<string, unknown>): Promise<{ ok: boolean; result?: T; description?: string }> {
  const token = botToken();
  if (!token) return { ok: false, description: "TELEGRAM_BOT_TOKEN not set" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    return (await res.json()) as { ok: boolean; result?: T; description?: string };
  } catch (e) {
    return { ok: false, description: (e as Error).message };
  }
}

let cachedUsername: string | null = null;
export async function botUsername(): Promise<string | null> {
  if (cachedUsername) return cachedUsername;
  const r = await tg<{ username: string }>("getMe", {});
  cachedUsername = r.ok ? r.result?.username ?? null : null;
  return cachedUsername;
}

/** Points the bot at this app's webhook if it isn't already. */
export async function ensureWebhook(siteUrl: string) {
  const token = botToken();
  if (!token) return { ok: false, description: "TELEGRAM_BOT_TOKEN not set" };
  const url = `${siteUrl.replace(/\/$/, "")}/telegram/webhook`;
  const info = await tg<{ url: string }>("getWebhookInfo", {});
  if (info.ok && info.result?.url === url) return { ok: true };
  return tg("setWebhook", { url, secret_token: webhookSecret(token), allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
export const html = (s: string) => s.replace(/[&<>]/g, (c) => ESC[c]);
