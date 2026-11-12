// ISPS broadcasts: tell people in an organisation about a security level change, an authority
// notice or a due drill, on every free channel they've turned on, record when each person
// acknowledges, and chase the ones who haven't. Called from ISPS actions and the every-minute
// scheduled checks. No SMS or WhatsApp is used (those are paid per message).

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { complianceFlags, LEVEL_LABEL } from "./isps.rules";

const db = () => supabaseAdmin as any;
const SITE = "https://app.lemtik.com.ng";

export type BroadcastKind = "level_change" | "authority_notice" | "reminder";
type Role = "manager" | "supervisor" | "officer" | "client_admin";
const ROLES: Record<BroadcastKind, Role[]> = {
  level_change: ["manager", "supervisor", "officer", "client_admin"],
  authority_notice: ["manager", "supervisor", "client_admin"],
  reminder: ["manager", "supervisor"],
};

type Broadcast = {
  id: string;
  organisation_id: string;
  kind: BroadcastKind;
  title: string;
  body: string;
  level: number | null;
  notice_id: string | null;
  require_ack: boolean;
  chase_every_min: number;
  max_chases: number;
  chases_sent: number;
  last_sent_at: string;
};
type Recipient = { id: string; user_id: string; name: string | null; role: string | null; channels_sent: string[]; channels_failed: string[]; acknowledged_at: string | null };

async function members(orgId: string, roles: Role[]) {
  const { data } = await db().from("organisation_members").select("user_id, role").eq("organisation_id", orgId).in("role", roles);
  const rows = (data ?? []) as { user_id: string; role: string }[];
  if (!rows.length) return [] as { user_id: string; role: string; name: string }[];
  const { data: profiles } = await db().from("profiles").select("user_id, display_name, is_active").in("user_id", rows.map((r) => r.user_id));
  const p = new Map(((profiles ?? []) as any[]).map((x) => [x.user_id as string, x]));
  return rows.filter((r) => p.get(r.user_id)?.is_active !== false).map((r) => ({ user_id: r.user_id, role: r.role, name: ((p.get(r.user_id)?.display_name as string) || "Team member").slice(0, 120) }));
}

const urlFor = (b: Pick<Broadcast, "kind">, role: string | null) => (role === "officer" ? "/officer/home" : "/app/isps");

/** Sends (or re-sends) a broadcast to the given recipients and records which channels worked. */
async function send(b: Broadcast, people: Recipient[], opts: { chase: number }) {
  if (!people.length) return;
  const chase = opts.chase;
  const prefix = chase ? `REMINDER ${chase}, not yet acknowledged: ` : "";
  const title = `${prefix}${b.title}`.slice(0, 200);
  const sev = b.kind === "level_change" ? (b.level === 3 ? 5 : b.level === 2 ? 4 : 3) : b.kind === "authority_notice" ? 4 : 2;
  const icon = b.level === 3 ? "🚨" : b.kind === "reminder" ? "🗓" : "⚠️";
  const sent = new Map<string, string[]>(people.map((p) => [p.id, []]));
  const failed = new Map<string, string[]>(people.map((p) => [p.id, []]));

  // In the app (the bell): one row for everyone.
  const { error: inAppErr } = await db().from("alerts").insert({
    organisation_id: b.organisation_id, severity: sev, channel: "in-app", channels: ["in-app"], alert_type: `isps_${b.kind}`, status: "delivered",
    title, body: b.body.slice(0, 1000), action: "Open ISPS Watch", recipients: people.length, delivered_count: people.length, failed_count: 0,
    recipient_user_ids: people.map((p) => p.user_id), acknowledged: false,
  });
  for (const p of people) (inAppErr ? failed : sent).get(p.id)!.push("in_app");

  // Push to every device each person has turned on.
  try {
    const { vapidConfigured } = await import("./webpush.server");
    if (vapidConfigured()) {
      const { sendToUsers } = await import("./push.server");
      for (const p of people) {
        const r = (await sendToUsers([p.user_id], { title, body: b.body.slice(0, 300), url: urlFor(b, p.role), tag: `isps-${b.id}`, requireInteraction: b.require_ack })).get(p.user_id);
        if (r?.sent) sent.get(p.id)!.push("push");
        else if (r && r.detail !== "No devices") failed.get(p.id)!.push("push");
      }
    }
  } catch {
    /* push not available */
  }

  // Telegram, with an "I've read this" button.
  try {
    const { botToken, tg, html } = await import("./telegram.server");
    if (botToken()) {
      const { data: chats } = await db().from("user_telegram").select("user_id, chat_id").in("user_id", people.map((p) => p.user_id));
      const chatOf = new Map(((chats ?? []) as { user_id: string; chat_id: number }[]).map((c) => [c.user_id, c.chat_id]));
      for (const p of people) {
        const chat = chatOf.get(p.user_id);
        if (!chat) continue;
        const buttons: any[] = [];
        if (b.require_ack && b.kind !== "authority_notice") buttons.push({ text: "✅ I've read this", callback_data: `isa:${p.id}` });
        buttons.push({ text: b.kind === "authority_notice" ? "Open to acknowledge" : "Open Lemtik", url: `${SITE}${urlFor(b, p.role)}` });
        const r = await tg("sendMessage", { chat_id: chat, text: `${icon} <b>${html(title)}</b>\n\n${html(b.body.slice(0, 3000))}`, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: { inline_keyboard: [buttons] } });
        (r.ok ? sent : failed).get(p.id)!.push("telegram");
      }
    }
  } catch {
    /* telegram not available */
  }

  // Email: on the first send of anything serious, and on the last chase.
  const serious = b.kind === "authority_notice" || (b.kind === "level_change" && (b.level ?? 1) >= 2) || (b.kind === "reminder" && b.title.includes("overdue"));
  const emailNow = chase === 0 ? serious : chase === b.max_chases;
  if (emailNow) {
    try {
      const { buildAlertEmail, sendResendEmail } = await import("./email.service");
      for (const p of people) {
        const { data: u } = await db().auth.admin.getUserById(p.user_id).catch(() => ({ data: null }));
        const email = u?.user?.email as string | undefined;
        if (!email) continue;
        const msg = buildAlertEmail({ subject: title, headline: title, summary: b.body.slice(0, 1500), severityLabel: b.kind === "level_change" ? LEVEL_LABEL[b.level ?? 1] ?? "ISPS" : b.kind === "authority_notice" ? "Authority notice" : "Reminder", actionLabel: b.require_ack ? "Open and acknowledge" : "Open ISPS Watch", actionUrl: `${SITE}${urlFor(b, p.role)}` });
        const r = await sendResendEmail({ to: email, ...msg }).catch(() => ({ ok: false }) as any);
        (r.ok ? sent : failed).get(p.id)!.push("email");
      }
    } catch {
      /* email not available */
    }
  }

  for (const p of people) {
    const s = [...new Set([...p.channels_sent, ...sent.get(p.id)!])];
    const f = [...new Set([...p.channels_failed, ...failed.get(p.id)!])].filter((c) => !s.includes(c));
    await db().from("isps_broadcast_recipients").update({ channels_sent: s, channels_failed: f }).eq("id", p.id);
  }
}

/** Creates a broadcast for an organisation's people and sends it straight away. */
export async function createBroadcast(input: {
  orgId: string;
  kind: BroadcastKind;
  title: string;
  body: string;
  level?: number | null;
  facilityIds?: string[];
  noticeId?: string | null;
  requireAck?: boolean;
  createdBy?: string | null;
  createdByName?: string | null;
  chaseEveryMin?: number;
  maxChases?: number;
}): Promise<{ id: string; recipients: number } | null> {
  const people = await members(input.orgId, ROLES[input.kind]);
  const requireAck = input.requireAck ?? input.kind !== "reminder";
  const { data: b, error } = await db()
    .from("isps_broadcasts")
    .insert({
      organisation_id: input.orgId, kind: input.kind, title: input.title.slice(0, 200), body: input.body.slice(0, 4000), level: input.level ?? null,
      facility_ids: input.facilityIds ?? [], notice_id: input.noticeId ?? null, require_ack: requireAck,
      chase_every_min: input.chaseEveryMin ?? (input.level === 3 ? 10 : 15), max_chases: requireAck ? input.maxChases ?? 3 : 0,
      created_by: input.createdBy ?? null, created_by_name: input.createdByName ?? null, closed_at: requireAck ? null : new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error || !b) return null;
  if (!people.length) return { id: b.id, recipients: 0 };
  const { data: rec } = await db()
    .from("isps_broadcast_recipients")
    .insert(people.map((p) => ({ broadcast_id: b.id, organisation_id: input.orgId, user_id: p.user_id, name: p.name, role: p.role })))
    .select("id, user_id, name, role, channels_sent, channels_failed, acknowledged_at");
  await send(b as Broadcast, (rec ?? []) as Recipient[], { chase: 0 });
  return { id: b.id, recipients: people.length };
}

/** One person acknowledges. Returns false if it wasn't theirs or was already done. */
export async function acknowledgeRecipient(recipientId: string, userId: string, via: "app" | "telegram") {
  const { data } = await db()
    .from("isps_broadcast_recipients")
    .update({ acknowledged_at: new Date().toISOString(), acknowledged_via: via })
    .eq("id", recipientId)
    .eq("user_id", userId)
    .is("acknowledged_at", null)
    .select("id, broadcast_id");
  if (!data?.length) return false;
  const { count } = await db().from("isps_broadcast_recipients").select("id", { count: "exact", head: true }).eq("broadcast_id", data[0].broadcast_id).is("acknowledged_at", null);
  if (!count) await db().from("isps_broadcasts").update({ closed_at: new Date().toISOString() }).eq("id", data[0].broadcast_id).is("closed_at", null);
  return true;
}

/** When the organisation acknowledges an authority notice, stop chasing everyone about it. */
export async function closeNoticeBroadcasts(orgId: string, noticeId: string, userId: string) {
  const { data: bs } = await db().from("isps_broadcasts").select("id").eq("organisation_id", orgId).eq("notice_id", noticeId).is("closed_at", null);
  for (const b of (bs ?? []) as { id: string }[]) {
    await db().from("isps_broadcast_recipients").update({ acknowledged_at: new Date().toISOString(), acknowledged_via: "app" }).eq("broadcast_id", b.id).eq("user_id", userId).is("acknowledged_at", null);
    await db().from("isps_broadcasts").update({ closed_at: new Date().toISOString() }).eq("id", b.id);
  }
}

const lagosHour = () => (new Date().getUTCHours() + 1) % 24;
function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}w${Math.ceil(((t.getTime() - y.getTime()) / 86_400_000 + 1) / 7)}`;
}

/** Every-minute work for one organisation: chase unacknowledged broadcasts, send due reminders. */
export async function sweepIsps(orgId: string) {
  const now = Date.now();
  const { data: open } = await db().from("isps_broadcasts").select("*").eq("organisation_id", orgId).is("closed_at", null).eq("require_ack", true).limit(50);
  for (const b of (open ?? []) as Broadcast[]) {
    if (now - Date.parse(b.last_sent_at) < b.chase_every_min * 60_000) continue;
    if (b.kind === "authority_notice" && b.notice_id) {
      const { data: r } = await db().from("authority_notice_recipients").select("acknowledged_at").eq("notice_id", b.notice_id).eq("org_id", orgId).maybeSingle();
      if (r?.acknowledged_at) {
        await db().from("isps_broadcasts").update({ closed_at: new Date().toISOString() }).eq("id", b.id);
        continue;
      }
    }
    if (b.chases_sent >= b.max_chases) {
      await db().from("isps_broadcasts").update({ closed_at: new Date().toISOString() }).eq("id", b.id);
      continue;
    }
    // Claim the chase so two overlapping runs don't both send it.
    const { data: claimed } = await db().from("isps_broadcasts").update({ chases_sent: b.chases_sent + 1, last_sent_at: new Date().toISOString() }).eq("id", b.id).eq("chases_sent", b.chases_sent).select("id");
    if (!claimed?.length) continue;
    const { data: rec } = await db().from("isps_broadcast_recipients").select("id, user_id, name, role, channels_sent, channels_failed, acknowledged_at").eq("broadcast_id", b.id).is("acknowledged_at", null);
    await send({ ...b, chases_sent: b.chases_sent + 1 }, (rec ?? []) as Recipient[], { chase: b.chases_sent + 1 });
  }

  // Reminders: every 15 minutes, in working hours (07:00–19:00 Lagos time).
  const h = lagosHour();
  if (new Date().getUTCMinutes() % 15 !== 0 || h < 7 || h >= 19) return;
  const [{ data: fac }, { data: drills }, { data: br }] = await Promise.all([
    db().from("isps_facilities").select("id, name, plan_approved_on, plan_expires_on, security_officer_name, created_at").eq("organisation_id", orgId),
    db().from("isps_drills").select("facility_id, kind, held_on").eq("organisation_id", orgId).order("held_on", { ascending: false }).limit(2000),
    db().from("isps_breaches").select("facility_id, reported_to_authority").eq("organisation_id", orgId).eq("reported_to_authority", false).limit(2000),
  ]);
  const week = isoWeek();
  const due: { facility_id: string; key: string; text: string; fail: boolean; name: string }[] = [];
  for (const f of (fac ?? []) as any[]) {
    const d = ((drills ?? []) as any[]).filter((x) => x.facility_id === f.id);
    const row = {
      ...f,
      last_drill_on: d.find((x) => x.kind === "drill")?.held_on ?? null,
      last_exercise_on: d.find((x) => x.kind === "exercise")?.held_on ?? null,
      unreported_breaches: ((br ?? []) as any[]).filter((x) => x.facility_id === f.id).length,
    };
    for (const flag of complianceFlags(row)) {
      if (flag.code === "officer") continue;
      const basis = flag.code === "drill" ? row.last_drill_on : flag.code === "exercise" ? row.last_exercise_on : flag.code === "plan" ? `${row.plan_approved_on}:${row.plan_expires_on}` : String(row.unreported_breaches);
      // A warning goes once per basis; anything overdue repeats once a week until it's fixed.
      const key = `${flag.code}:${flag.tone}:${basis ?? "none"}${flag.tone === "fail" ? `:${week}` : ""}`;
      due.push({ facility_id: f.id, key, text: flag.text, fail: flag.tone === "fail", name: f.name });
    }
  }
  if (!due.length) return;
  const { data: done } = await db().from("isps_reminders").select("facility_id, reminder_key").eq("organisation_id", orgId).in("facility_id", [...new Set(due.map((x) => x.facility_id))]);
  const sentKeys = new Set(((done ?? []) as any[]).map((x) => `${x.facility_id}|${x.reminder_key}`));
  const fresh = due.filter((x) => !sentKeys.has(`${x.facility_id}|${x.key}`));
  if (!fresh.length) return;
  // Claim them first, so a second run in the same minute can't send them again.
  const { data: claimed } = await db().from("isps_reminders").upsert(fresh.map((x) => ({ facility_id: x.facility_id, reminder_key: x.key, organisation_id: orgId })), { onConflict: "facility_id,reminder_key", ignoreDuplicates: true }).select("facility_id, reminder_key");
  const mine = fresh.filter((x) => ((claimed ?? []) as any[]).some((c) => c.facility_id === x.facility_id && c.reminder_key === x.key));
  if (!mine.length) return;
  const anyFail = mine.some((x) => x.fail);
  const b = await createBroadcast({
    orgId,
    kind: "reminder",
    title: anyFail ? "ISPS records overdue" : "ISPS records due soon",
    body: mine.map((x) => `• ${x.name}: ${x.text}`).join("\n") + "\n\nRecord drills and exercises in ISPS Watch once they're done.",
    facilityIds: [...new Set(mine.map((x) => x.facility_id))],
    requireAck: false,
  });
  if (b) for (const x of mine) await db().from("isps_reminders").update({ broadcast_id: b.id }).eq("facility_id", x.facility_id).eq("reminder_key", x.key);
}
