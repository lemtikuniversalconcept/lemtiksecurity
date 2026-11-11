import { createFileRoute } from "@tanstack/react-router";

/**
 * Telegram sends every message to the Lemtik bot here. Handles:
 *  - /start <code>  links the chat to the Lemtik user who generated the code
 *  - /stop          unlinks it
 *  - the Acknowledge button on an alert message
 *  - anything else  a short explanation of what the bot does
 * Only requests carrying the webhook secret (set when the webhook was registered) are accepted.
 */

const ok = () => new Response("ok");

async function handle(request: Request) {
  const { botToken, secretMatches, tg, html } = await import("@/lib/telegram.server");
  const token = botToken();
  if (!token || !secretMatches(request.headers.get("x-telegram-bot-api-secret-token"), token)) return new Response("Forbidden", { status: 403 });
  const update = (await request.json().catch(() => null)) as any;
  if (!update) return ok();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const site = "https://app.lemtik.com.ng";

  // ---- Acknowledge button on an alert
  const cb = update.callback_query;
  if (cb?.data && typeof cb.data === "string") {
    const chatId = cb.message?.chat?.id;
    const answer = (text: string) => tg("answerCallbackQuery", { callback_query_id: cb.id, text, show_alert: false });
    const m = /^ack:([0-9a-f-]{36})$/.exec(cb.data);
    if (!m || !chatId) {
      await answer("This button isn't valid any more.");
      return ok();
    }
    const { data: link } = await db.from("user_telegram").select("user_id").eq("chat_id", chatId).maybeSingle();
    if (!link) {
      await answer("This Telegram account isn't linked to Lemtik any more.");
      return ok();
    }
    const { data: a } = await db.from("movement_alerts").select("id, organisation_id, acknowledged_at, message").eq("id", m[1]).maybeSingle();
    if (!a) {
      await answer("Alert not found.");
      return ok();
    }
    const { data: member } = await db.from("organisation_members").select("role").eq("organisation_id", a.organisation_id).eq("user_id", link.user_id).maybeSingle();
    if (!member || !["manager", "supervisor"].includes(member.role)) {
      await answer("Only managers and supervisors can acknowledge alerts.");
      return ok();
    }
    const { data: me } = await db.from("profiles").select("display_name").eq("user_id", link.user_id).maybeSingle();
    const who = (me?.display_name as string | undefined)?.trim() || "a team member";
    if (a.acknowledged_at) {
      await answer("Already acknowledged.");
    } else {
      await db.from("movement_alerts").update({ acknowledged_at: new Date().toISOString(), acknowledged_by: link.user_id }).eq("id", a.id).is("acknowledged_at", null);
      await db.from("alert_deliveries").insert({ organisation_id: a.organisation_id, movement_alert_id: a.id, step: 0, channel: "telegram", recipient_user_id: link.user_id, recipient_label: who.slice(0, 120), status: "sent", detail: "Acknowledged from Telegram" });
      await answer("Acknowledged. Escalation stopped.");
    }
    if (cb.message?.message_id) {
      await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } });
      await tg("sendMessage", { chat_id: chatId, reply_to_message_id: cb.message.message_id, text: `✅ Acknowledged by ${html(who)}`, parse_mode: "HTML" });
    }
    return ok();
  }

  // ---- Text messages
  const msg = update.message;
  const chatId = msg?.chat?.id;
  if (!chatId || msg.chat.type !== "private") return ok();
  const text: string = (msg.text ?? "").trim();
  const reply = (t: string) => tg("sendMessage", { chat_id: chatId, text: t, parse_mode: "HTML", disable_web_page_preview: true });

  const start = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{16,64})$/.exec(text);
  if (start) {
    const { data: code } = await db.from("telegram_link_codes").select("code, user_id, expires_at, used_at").eq("code", start[1]).maybeSingle();
    if (!code || code.used_at || Date.parse(code.expires_at) < Date.now()) {
      await reply(`That link has expired. Open Lemtik → Alerts → <b>Connect Telegram</b> to get a fresh one.\n${site}/app/alerts#escalation`);
      return ok();
    }
    const { data: used } = await db.from("telegram_link_codes").update({ used_at: new Date().toISOString() }).eq("code", code.code).is("used_at", null).select("code");
    if (!used?.length) return ok();
    await db.from("user_telegram").delete().eq("chat_id", chatId);
    const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ").slice(0, 120) || null;
    const { error } = await db.from("user_telegram").upsert({ user_id: code.user_id, chat_id: chatId, tg_username: msg.from?.username ?? null, tg_name: name, linked_at: new Date().toISOString() });
    if (error) {
      await reply("Something went wrong linking your account. Try again from Lemtik.");
      return ok();
    }
    const { data: me } = await db.from("profiles").select("display_name").eq("user_id", code.user_id).maybeSingle();
    await reply(
      `✅ Linked to Lemtik${me?.display_name ? ` as <b>${html(me.display_name)}</b>` : ""}.\n\nYou'll get alerts here when your organisation's escalation chain includes Telegram, with a button to acknowledge them.\n\nSend /stop to unlink.`,
    );
    return ok();
  }

  if (/^\/stop(?:@\w+)?$/.test(text)) {
    const { data: gone } = await db.from("user_telegram").delete().eq("chat_id", chatId).select("user_id");
    await reply(gone?.length ? "Unlinked. You won't get Lemtik alerts here any more." : "This chat isn't linked to Lemtik.");
    return ok();
  }

  const { data: linked } = await db.from("user_telegram").select("user_id").eq("chat_id", chatId).maybeSingle();
  await reply(
    linked
      ? "This chat is linked to Lemtik. Alerts arrive here automatically; you don't need to send anything. Send /stop to unlink."
      : `This is the Lemtik alerts bot. To get alerts here, open Lemtik → Alerts → <b>Connect Telegram</b>.\n${site}/app/alerts#escalation`,
  );
  return ok();
}

export const Route = createFileRoute("/telegram/webhook")({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
    },
  },
});
