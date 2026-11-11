// Escalation chain for serious movement alerts. Called from the every-minute checks.
// Each step that is due is sent while the alert is still unacknowledged; acknowledging it stops
// the chain. Every send, failure or skip is written to alert_deliveries.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type EscalationRole = "supervisor" | "manager" | "client_admin";
export type EscalationChannel = "in_app" | "email" | "telegram";
export type EscalationStep = { after_min: number; roles: EscalationRole[]; channels: EscalationChannel[] };
export type EscalationPolicy = { enabled: boolean; min_severity: number; steps: EscalationStep[] };

/** Used until a security manager saves their own. */
export const DEFAULT_POLICY: EscalationPolicy = {
  enabled: true,
  min_severity: 4,
  steps: [
    { after_min: 0, roles: ["supervisor", "manager"], channels: ["in_app", "telegram"] },
    { after_min: 2, roles: ["manager"], channels: ["in_app", "email"] },
    { after_min: 10, roles: ["client_admin", "manager"], channels: ["email"] },
  ],
};

const db = () => supabaseAdmin as any;
const WINDOW_MS = 24 * 3600_000;
const MAX_PER_RUN = 50;

export async function loadPolicy(orgId: string): Promise<EscalationPolicy> {
  const { data } = await db().from("escalation_policies").select("enabled, min_severity, steps").eq("organisation_id", orgId).maybeSingle();
  if (!data) return DEFAULT_POLICY;
  return { enabled: !!data.enabled, min_severity: data.min_severity ?? 4, steps: Array.isArray(data.steps) ? (data.steps as EscalationStep[]) : DEFAULT_POLICY.steps };
}

type AlertRow = { id: string; organisation_id: string; subject_id: string | null; kind: string; severity: number; message: string; created_at: string; escalation_step: number };

async function recipients(orgId: string, roles: EscalationRole[]) {
  const { data: members } = await db().from("organisation_members").select("user_id, role").eq("organisation_id", orgId).in("role", roles);
  const ids = [...new Set(((members ?? []) as { user_id: string }[]).map((m) => m.user_id))];
  if (!ids.length) return [] as { user_id: string; name: string }[];
  const { data: profiles } = await db().from("profiles").select("user_id, display_name, is_active").in("user_id", ids);
  const active = new Map(((profiles ?? []) as any[]).map((p) => [p.user_id as string, p]));
  return ids.filter((id) => active.get(id)?.is_active !== false).map((id) => ({ user_id: id, name: ((active.get(id)?.display_name as string) || "Team member").slice(0, 120) }));
}

const SEV_WORD: Record<number, string> = { 5: "Critical", 4: "High", 3: "Medium", 2: "Low", 1: "Info" };

async function deliver(a: AlertRow, stepIndex: number, step: EscalationStep, subjectName: string | null) {
  const people = await recipients(a.organisation_id, step.roles);
  const log: any[] = [];
  const escalated = stepIndex > 0;
  const title = `${escalated ? "ESCALATED, not yet acknowledged: " : ""}${a.message}`.slice(0, 200);
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(a.created_at)) / 60_000));
  const body = `${subjectName ? `${subjectName} · ` : ""}${SEV_WORD[a.severity] ?? ""} alert raised ${mins} min ago${escalated ? " and still not acknowledged" : ""}. Open Protected movement to acknowledge it.`;

  if (!people.length) {
    log.push({ organisation_id: a.organisation_id, movement_alert_id: a.id, step: stepIndex, channel: step.channels[0] ?? "in_app", recipient_label: step.roles.join(", "), status: "skipped", detail: "Nobody in these roles" });
  }

  if (people.length && step.channels.includes("in_app")) {
    const { error } = await db().from("alerts").insert({
      organisation_id: a.organisation_id, severity: a.severity, channel: "in-app", channels: ["in-app"], alert_type: "movement_escalation", status: "delivered",
      title, body, action: "Open Protected movement", recipients: people.length, delivered_count: people.length, failed_count: 0,
      recipient_user_ids: people.map((p) => p.user_id), acknowledged: false,
    });
    for (const p of people) log.push({ organisation_id: a.organisation_id, movement_alert_id: a.id, step: stepIndex, channel: "in_app", recipient_user_id: p.user_id, recipient_label: p.name, status: error ? "failed" : "sent", detail: error ? String(error.message).slice(0, 500) : null });
  }

  if (people.length && step.channels.includes("email")) {
    const { buildAlertEmail, sendResendEmail } = await import("./email.service");
    const { getSiteUrl } = await import("./orgs.server");
    let site = "https://app.lemtik.com.ng";
    try { site = getSiteUrl(); } catch { /* no request context in the scheduled job */ }
    const msg = buildAlertEmail({ subject: title, headline: title, summary: body, severityLabel: SEV_WORD[a.severity] ?? "Alert", actionLabel: "Open Protected movement", actionUrl: `${site.replace(/\/$/, "")}/app/movement` });
    for (const p of people) {
      const { data: u } = await db().auth.admin.getUserById(p.user_id).catch(() => ({ data: null }));
      const email = u?.user?.email as string | undefined;
      if (!email) {
        log.push({ organisation_id: a.organisation_id, movement_alert_id: a.id, step: stepIndex, channel: "email", recipient_user_id: p.user_id, recipient_label: p.name, status: "skipped", detail: "No email address" });
        continue;
      }
      const r = await sendResendEmail({ to: email, ...msg }).catch((e: Error) => ({ ok: false, skipped: false, error: e.message }) as any);
      log.push({
        organisation_id: a.organisation_id, movement_alert_id: a.id, step: stepIndex, channel: "email", recipient_user_id: p.user_id, recipient_label: p.name,
        status: r.ok ? "sent" : r.skipped ? "skipped" : "failed",
        detail: r.ok ? null : String(r.reason ?? r.error ?? "send failed").slice(0, 500),
      });
    }
  }
  if (people.length && step.channels.includes("telegram")) {
    const { botToken, tg, html } = await import("./telegram.server");
    const { data: chats } = await db().from("user_telegram").select("user_id, chat_id").in("user_id", people.map((p) => p.user_id));
    const chatOf = new Map(((chats ?? []) as { user_id: string; chat_id: number }[]).map((c) => [c.user_id, c.chat_id]));
    const icon = a.severity >= 5 ? "🚨" : "⚠️";
    const text = `${icon} <b>${html(title)}</b>\n\n${html(body)}`;
    for (const p of people) {
      const chat = chatOf.get(p.user_id);
      if (!botToken() || !chat) {
        log.push({ organisation_id: a.organisation_id, movement_alert_id: a.id, step: stepIndex, channel: "telegram", recipient_user_id: p.user_id, recipient_label: p.name, status: "skipped", detail: !botToken() ? "Telegram not set up" : "Telegram not linked" });
        continue;
      }
      const r = await tg("sendMessage", {
        chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [[{ text: "✅ Acknowledge", callback_data: `ack:${a.id}` }, { text: "Open Lemtik", url: "https://app.lemtik.com.ng/app/movement" }]] },
      });
      log.push({ organisation_id: a.organisation_id, movement_alert_id: a.id, step: stepIndex, channel: "telegram", recipient_user_id: p.user_id, recipient_label: p.name, status: r.ok ? "sent" : "failed", detail: r.ok ? null : String(r.description ?? "send failed").slice(0, 500) });
    }
  }
  if (log.length) await db().from("alert_deliveries").insert(log);
}

export async function escalateOrg(orgId: string) {
  const policy = await loadPolicy(orgId);
  if (!policy.enabled || !policy.steps.length) return;
  const steps = [...policy.steps].sort((x, y) => x.after_min - y.after_min);
  const now = Date.now();
  const { data } = await db()
    .from("movement_alerts")
    .select("id, organisation_id, subject_id, kind, severity, message, created_at, escalation_step, escalation_next_at")
    .eq("organisation_id", orgId)
    .is("acknowledged_at", null)
    .eq("escalation_done", false)
    .gte("severity", policy.min_severity)
    .gte("created_at", new Date(now - WINDOW_MS).toISOString())
    .or(`escalation_next_at.is.null,escalation_next_at.lte.${new Date(now).toISOString()}`)
    .order("created_at", { ascending: true })
    .limit(MAX_PER_RUN);
  const names = new Map<string, string>();
  for (const a of (data ?? []) as AlertRow[]) {
    const idx = a.escalation_step + 1;
    const step = steps[idx];
    if (!step) {
      await db().from("movement_alerts").update({ escalation_done: true }).eq("id", a.id);
      continue;
    }
    const due = Date.parse(a.created_at) + step.after_min * 60_000;
    if (due > now) {
      await db().from("movement_alerts").update({ escalation_next_at: new Date(due).toISOString() }).eq("id", a.id);
      continue;
    }
    // Claim the step so two overlapping runs can't both send it.
    const following = steps[idx + 1];
    const { data: claimed } = await db()
      .from("movement_alerts")
      .update({ escalation_step: idx, escalation_next_at: following ? new Date(Date.parse(a.created_at) + following.after_min * 60_000).toISOString() : null, escalation_done: !following })
      .eq("id", a.id)
      .eq("escalation_step", a.escalation_step)
      .is("acknowledged_at", null)
      .select("id");
    if (!claimed?.length) continue;
    let subjectName: string | null = null;
    if (a.subject_id) {
      if (!names.has(a.subject_id)) {
        const { data: s } = await db().from("movement_subjects").select("name").eq("id", a.subject_id).maybeSingle();
        names.set(a.subject_id, (s?.name as string) ?? "");
      }
      subjectName = names.get(a.subject_id) || null;
    }
    await deliver(a, idx, step, subjectName);
  }
}
