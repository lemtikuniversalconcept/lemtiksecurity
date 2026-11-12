// Reports by Telegram bot (server only).
//
// Two kinds of sender:
//  - staff whose Telegram is linked to Lemtik: reports go to their organisation as incidents
//  - community reporters who opened an organisation's report link: reports go to that
//    organisation as unverified, internal incidents, and the reporter is known only by a number
//
// A report is put together over several messages: /report, a category button, then any mix
// of text, photos and a location, then /send. Photos are copied into incident evidence with
// a SHA-256 fingerprint.

import { createHash } from "node:crypto";
import { botToken, html, tg } from "@/lib/telegram.server";

const DRAFT_TTL_MS = 6 * 3_600_000;
const MAX_PHOTOS = 5;
const SITE = "https://app.lemtik.com.ng";

export const REPORT_CATEGORIES: [string, string, number][] = [
  ["suspicious", "Suspicious boat or activity", 2],
  ["sea_robbery", "Sea robbery", 4],
  ["armed_attack", "Armed attack", 5],
  ["kidnapping", "Kidnapping", 5],
  ["capsize", "Boat in distress or capsized", 4],
  ["man_overboard", "Person in the water", 5],
  ["theft", "Theft", 3],
  ["crude_theft", "Oil theft or illegal refining", 3],
  ["pollution_spill", "Oil spill or pollution", 3],
  ["fire", "Fire", 4],
  ["medical", "Medical emergency", 3],
  ["other", "Something else", 2],
];
const CAT = new Map(REPORT_CATEGORIES.map(([k, label, sev]) => [k, { label, sev }]));
const lagosDay = () => new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);

type Db = any;
type Sender =
  | { kind: "staff"; userId: string; name: string; orgs: { id: string; name: string }[] }
  | { kind: "community"; reporter: { id: string; organisation_id: string; number: number; blocked_at: string | null; day: string | null; day_count: number; reports: number }; org: { id: string; name: string }; limit: number }
  | { kind: "none" };

async function sender(db: Db, chatId: number): Promise<Sender> {
  const { data: link } = await db.from("user_telegram").select("user_id").eq("chat_id", chatId).maybeSingle();
  if (link) {
    const [{ data: mem }, { data: me }] = await Promise.all([
      db.from("organisation_members").select("organisation_id, role, organisations(name)").eq("user_id", link.user_id),
      db.from("profiles").select("display_name").eq("user_id", link.user_id).maybeSingle(),
    ]);
    const orgs = ((mem ?? []) as any[]).map((m) => ({ id: m.organisation_id as string, name: (m.organisations?.name ?? "Your organisation") as string }));
    if (orgs.length) return { kind: "staff", userId: link.user_id, name: (me?.display_name as string | undefined)?.trim() || "Team member", orgs };
  }
  const { data: rep } = await db.from("telegram_reporters").select("id, organisation_id, number, blocked_at, day, day_count, reports").eq("chat_id", chatId).order("last_started_at", { ascending: false }).limit(1).maybeSingle();
  if (rep) {
    const [{ data: org }, { data: rl }] = await Promise.all([
      db.from("organisations").select("id, name").eq("id", rep.organisation_id).maybeSingle(),
      db.from("telegram_report_links").select("daily_limit").eq("organisation_id", rep.organisation_id).is("revoked_at", null).maybeSingle(),
    ]);
    if (org && rl) return { kind: "community", reporter: rep, org, limit: rl.daily_limit };
  }
  return { kind: "none" };
}

async function liveDraft(db: Db, chatId: number) {
  const { data } = await db.from("telegram_report_drafts").select("*").eq("chat_id", chatId).maybeSingle();
  if (!data) return null;
  if (Date.now() - Date.parse(data.updated_at) > DRAFT_TTL_MS) {
    await db.from("telegram_report_drafts").delete().eq("chat_id", chatId);
    return null;
  }
  return data;
}

const send = (chatId: number, text: string, extra: Record<string, unknown> = {}) => tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });

function categoryKeyboard() {
  const rows: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < REPORT_CATEGORIES.length; i += 2) rows.push(REPORT_CATEGORIES.slice(i, i + 2).map(([k, label]) => ({ text: label, callback_data: `rcat:${k}` })));
  rows.push([{ text: "Cancel", callback_data: "rcat:cancel" }]);
  return { inline_keyboard: rows };
}
const HOW_TO = "Now send:\n• <b>what happened</b> (where, how many people or boats, which direction)\n• <b>photos</b>, up to 5\n• <b>your location</b>: 📎 → Location\n\nThen send /send. Send /cancel to discard.";

/** /start rpt_<code>: a community member opens an organisation's report link. */
export async function startCommunity(db: Db, chatId: number, code: string) {
  const { data: link } = await db.from("telegram_report_links").select("organisation_id, revoked_at, organisations(name)").eq("code", code).maybeSingle();
  if (!link || link.revoked_at) {
    await send(chatId, "This report link isn't active any more. Ask the organisation for a new one.");
    return;
  }
  const orgName = (link as any).organisations?.name ?? "the organisation";
  let { data: rep } = await db.from("telegram_reporters").select("id, number").eq("organisation_id", link.organisation_id).eq("chat_id", chatId).maybeSingle();
  if (rep) await db.from("telegram_reporters").update({ last_started_at: new Date().toISOString() }).eq("id", rep.id);
  else {
    for (let attempt = 0; attempt < 5 && !rep; attempt++) {
      const { data: top } = await db.from("telegram_reporters").select("number").eq("organisation_id", link.organisation_id).order("number", { ascending: false }).limit(1).maybeSingle();
      const { data: ins, error } = await db.from("telegram_reporters").insert({ organisation_id: link.organisation_id, chat_id: chatId, number: (top?.number ?? 0) + 1 }).select("id, number").maybeSingle();
      if (!error) rep = ins;
      else if (String(error.code) !== "23505") break;
      else {
        const { data: again } = await db.from("telegram_reporters").select("id, number").eq("organisation_id", link.organisation_id).eq("chat_id", chatId).maybeSingle();
        if (again) rep = again;
      }
    }
  }
  if (!rep) {
    await send(chatId, "Something went wrong. Please open the link again.");
    return;
  }
  await send(
    chatId,
    `You can send security reports to <b>${html(orgName)}</b> here.\n\nYour name, phone number and Telegram username are not passed on. ${html(orgName)} sees you only as <b>Reporter #${rep.number}</b>.\n\nSend /report to start a report.\n\nIf someone's life is in danger, also call the emergency services.`,
  );
}

/** /report: start a new draft. */
export async function startReport(db: Db, chatId: number) {
  const s = await sender(db, chatId);
  if (s.kind === "none") {
    await send(chatId, "To send a report, open the report link the organisation shared with you (on a poster or in a message), then send /report.");
    return;
  }
  if (s.kind === "community" && s.reporter.blocked_at) {
    await send(chatId, "Reports from this chat are no longer accepted.");
    return;
  }
  const base = { chat_id: chatId, text: "", photos: [], lat: null, lng: null, category: null, started_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  if (s.kind === "community") {
    await db.from("telegram_report_drafts").upsert({ ...base, organisation_id: s.org.id, user_id: null, reporter_id: s.reporter.id });
    await send(chatId, `New report to <b>${html(s.org.name)}</b>. What is it about?`, { reply_markup: categoryKeyboard() });
    return;
  }
  await db.from("telegram_report_drafts").upsert({ ...base, organisation_id: s.orgs.length === 1 ? s.orgs[0].id : null, user_id: s.userId, reporter_id: null });
  if (s.orgs.length === 1) await send(chatId, `New report to <b>${html(s.orgs[0].name)}</b>. What is it about?`, { reply_markup: categoryKeyboard() });
  else await send(chatId, "Which organisation is this report for?", { reply_markup: { inline_keyboard: s.orgs.slice(0, 20).map((o) => [{ text: o.name.slice(0, 60), callback_data: `rorg:${o.id}` }]) } });
}

/** Buttons: rorg:<org id> and rcat:<category>. Returns true when handled. */
export async function reportCallback(db: Db, chatId: number, data: string, answer: (t: string) => Promise<unknown>, messageId?: number) {
  const org = /^rorg:([0-9a-f-]{36})$/.exec(data);
  const cat = /^rcat:([a-z_]+)$/.exec(data);
  if (!org && !cat) return false;
  const clear = () => (messageId ? tg("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }) : null);
  const draft = await liveDraft(db, chatId);
  if (!draft) {
    await answer("That report has expired. Send /report to start again.");
    await clear();
    return true;
  }
  if (org) {
    const s = await sender(db, chatId);
    const o = s.kind === "staff" ? s.orgs.find((x) => x.id === org[1]) : null;
    if (!o || draft.user_id !== (s as any).userId) {
      await answer("You're not a member of that organisation.");
      return true;
    }
    await db.from("telegram_report_drafts").update({ organisation_id: o.id, updated_at: new Date().toISOString() }).eq("chat_id", chatId);
    await answer(o.name);
    await clear();
    await send(chatId, `Report to <b>${html(o.name)}</b>. What is it about?`, { reply_markup: categoryKeyboard() });
    return true;
  }
  if (cat![1] === "cancel") {
    await db.from("telegram_report_drafts").delete().eq("chat_id", chatId);
    await answer("Cancelled");
    await clear();
    await send(chatId, "Report discarded.");
    return true;
  }
  const c = CAT.get(cat![1]);
  if (!c || !draft.organisation_id) {
    await answer("Choose one of the options.");
    return true;
  }
  await db.from("telegram_report_drafts").update({ category: cat![1], updated_at: new Date().toISOString() }).eq("chat_id", chatId);
  await answer(c.label);
  await clear();
  await send(chatId, `<b>${html(c.label)}</b>\n\n${HOW_TO}`);
  return true;
}

/**
 * A message while a report is open: text, photo (with caption) or location. Returns true when
 * it was taken into a draft, false when there's no open draft (the caller replies as usual).
 */
export async function draftMessage(db: Db, chatId: number, msg: any) {
  const draft = await liveDraft(db, chatId);
  if (!draft) return false;
  if (!draft.organisation_id || !draft.category) {
    await send(chatId, "Choose the organisation and what the report is about first, using the buttons above. Or send /cancel.");
    return true;
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const got: string[] = [];
  const addText = (t: string) => {
    const next = [draft.text, t.trim()].filter(Boolean).join("\n").slice(0, 4000);
    patch.text = next;
    got.push("description");
  };
  if (Array.isArray(msg.photo) && msg.photo.length) {
    const photos = Array.isArray(draft.photos) ? draft.photos : [];
    if (photos.length >= MAX_PHOTOS) {
      await send(chatId, `That's the most photos one report can take (${MAX_PHOTOS}). Send /send, or add more in another report.`);
      return true;
    }
    const best = [...msg.photo].sort((a: any, b: any) => (b.file_size ?? 0) - (a.file_size ?? 0)).find((p: any) => (p.file_size ?? 0) <= 20_000_000) ?? msg.photo[msg.photo.length - 1];
    patch.photos = [...photos, { file_id: best.file_id, size: best.file_size ?? null }];
    got.push(`photo ${photos.length + 1} of ${MAX_PHOTOS}`);
    if (msg.caption) addText(String(msg.caption));
  } else if (msg.location && typeof msg.location.latitude === "number") {
    patch.lat = msg.location.latitude;
    patch.lng = msg.location.longitude;
    got.push("location");
  } else if (typeof msg.text === "string" && msg.text.trim()) {
    addText(msg.text);
  } else {
    await send(chatId, "Only text, photos and your location can go in a report. Voice notes and videos aren't taken yet.");
    return true;
  }
  await db.from("telegram_report_drafts").update(patch).eq("chat_id", chatId);
  await send(chatId, `Got the ${got.join(" and ")}. Add more, or send /send.`);
  return true;
}

export async function cancelReport(db: Db, chatId: number) {
  const { data } = await db.from("telegram_report_drafts").delete().eq("chat_id", chatId).select("chat_id");
  await send(chatId, data?.length ? "Report discarded." : "There's no report open. Send /report to start one.");
}

async function copyPhoto(db: Db, orgId: string, fileId: string, i: number) {
  const token = botToken();
  if (!token) return null;
  const f = await tg<{ file_path: string; file_size?: number }>("getFile", { file_id: fileId });
  if (!f.ok || !f.result?.file_path) return null;
  try {
    const res = await fetch(`https://api.telegram.org/file/bot${token}/${f.result.file_path}`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const ext = (f.result.file_path.split(".").pop() || "jpg").replace(/[^\w]/g, "").slice(0, 5) || "jpg";
    const path = `${orgId}/telegram/${crypto.randomUUID()}.${ext}`;
    const type = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    const { error } = await db.storage.from("incident-evidence").upload(path, bytes, { contentType: type });
    if (error) return null;
    return { path, kind: "image", size: bytes.byteLength, name: `telegram-photo-${i + 1}.${ext}`, sha256: createHash("sha256").update(bytes).digest("hex"), sha256_at: new Date().toISOString(), source: "telegram" };
  } catch {
    return null;
  }
}

/** /send: turn the draft into an incident. */
export async function sendReport(db: Db, chatId: number) {
  const draft = await liveDraft(db, chatId);
  if (!draft) {
    await send(chatId, "There's no report open. Send /report to start one.");
    return;
  }
  const c = draft.category ? CAT.get(draft.category) : null;
  if (!draft.organisation_id || !c) {
    await send(chatId, "Choose what the report is about first, using the buttons above.");
    return;
  }
  let photos = (Array.isArray(draft.photos) ? draft.photos : []) as { file_id: string }[];
  if ((draft.text ?? "").trim().length < 3 && !photos.length) {
    await send(chatId, "Add a short description or a photo first, then send /send.");
    return;
  }
  const s = await sender(db, chatId);
  const community = !draft.user_id;
  if (community) {
    if (s.kind !== "community" || s.reporter.id !== draft.reporter_id || s.org.id !== draft.organisation_id) {
      await db.from("telegram_report_drafts").delete().eq("chat_id", chatId);
      await send(chatId, "This report link isn't active any more. The report wasn't sent.");
      return;
    }
    if (s.reporter.blocked_at) {
      await send(chatId, "Reports from this chat are no longer accepted.");
      return;
    }
    const today = lagosDay();
    const used = s.reporter.day === today ? s.reporter.day_count : 0;
    if (used >= s.limit) {
      await send(chatId, `You've sent the most reports allowed in one day (${s.limit}). Please try again tomorrow, or call the emergency services if someone is in danger.`);
      return;
    }
  } else if (s.kind !== "staff" || s.userId !== draft.user_id || !s.orgs.some((o) => o.id === draft.organisation_id)) {
    await db.from("telegram_report_drafts").delete().eq("chat_id", chatId);
    await send(chatId, "You're no longer a member of that organisation. The report wasn't sent.");
    return;
  }

  // Claim the draft (delete it and use what was deleted) so a double /send can't make two incidents.
  const { data: claimed } = await db.from("telegram_report_drafts").delete().eq("chat_id", chatId).select("*");
  if (!claimed?.length) return;
  Object.assign(draft, claimed[0]);
  photos = (Array.isArray(draft.photos) ? draft.photos : []) as { file_id: string }[];
  await send(chatId, "Sending…");

  const orgId = draft.organisation_id as string;
  const evidence = (await Promise.all(photos.slice(0, MAX_PHOTOS).map((p, i) => copyPhoto(db, orgId, p.file_id, i)))).filter(Boolean);
  const who = community && s.kind === "community" ? `Reporter #${s.reporter.number}` : s.kind === "staff" ? s.name : "Telegram";
  const text = (draft.text ?? "").trim();
  const { data: inc, error } = await db.from("incidents").insert({
    organisation_id: orgId,
    type: draft.category,
    severity: c.sev,
    status: "reported",
    title: `${community ? "Community report (unverified)" : "Telegram report"}: ${c.label}`.slice(0, 200),
    description: [text || "(No description; see the photos.)", `Sent by ${who} via Telegram${community ? ". Not yet checked." : "."}`, evidence.length < photos.length ? `${photos.length - evidence.length} photo(s) couldn't be copied from Telegram.` : null].filter(Boolean).join("\n\n"),
    location: draft.lat != null ? `Shared location ${Number(draft.lat).toFixed(5)}, ${Number(draft.lng).toFixed(5)}` : "Location not given",
    zone: community ? "Community report" : "Telegram",
    coord_x: draft.lng,
    coord_y: draft.lat,
    occurred_at: draft.started_at,
    reported_by: community ? null : draft.user_id,
    evidence,
    client_visible: !community,
    source: community ? "telegram_community" : "telegram",
  }).select("id, code").single();
  if (error || !inc) {
    await send(chatId, "The report couldn't be saved. Please try again in a moment, or call if it's urgent.");
    return;
  }
  await db.from("incident_activity").insert({
    incident_id: inc.id, organisation_id: orgId, actor_id: community ? null : draft.user_id, actor_name: who,
    kind: "telegram_report", message: `Reported by ${who} via Telegram${evidence.length ? ` with ${evidence.length} photo${evidence.length === 1 ? "" : "s"}` : ""}${draft.lat != null ? " and a location" : ""}.`,
    meta: { community, reporter_number: community && s.kind === "community" ? s.reporter.number : null, photos: evidence.length },
  });
  await db.from("alerts").insert({
    organisation_id: orgId, severity: c.sev, channel: "in-app", channels: ["in-app"], alert_type: community ? "community_report" : "telegram_report", status: "delivered",
    title: `${community ? "Community report" : "Telegram report"}: ${c.label} · ${inc.code}`.slice(0, 200),
    body: `${who}: ${text || "photos only"}`.slice(0, 1000), action: "Open incident",
    recipients: 1, delivered_count: 1, failed_count: 0, recipient_user_ids: [], acknowledged: false,
  });
  if (community && s.kind === "community") {
    const today = lagosDay();
    await db.from("telegram_reporters").update({
      reports: (s.reporter.reports ?? 0) + 1,
      day: today, day_count: (s.reporter.day === today ? s.reporter.day_count : 0) + 1, last_report_at: new Date().toISOString(),
    }).eq("id", s.reporter.id);
    await send(chatId, `✅ Sent to ${html(s.org.name)}. Reference <b>${html(inc.code)}</b>.\n\nThank you. Someone will look at it. You can send another with /report.`);
  } else {
    await send(chatId, `✅ Incident <b>${html(inc.code)}</b> opened${evidence.length ? ` with ${evidence.length} photo${evidence.length === 1 ? "" : "s"}` : ""}.`, { reply_markup: { inline_keyboard: [[{ text: "Open in Lemtik", url: `${SITE}/app/incidents/${inc.id}` }]] } });
  }
}
