type EmailKind =
  | "welcome"
  | "user_invitation"
  | "daily_incident_log"
  | "weekly_security_summary"
  | "monthly_threat_analysis"
  | "inventory_threshold_alert"
  | "osint_high_confidence_alert"
  | "subscription_confirmation"
  | "subscription_renewal_reminder"
  | "subscription_overdue_notice"
  | "account_suspended_notice";

type EmailMessage = {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  from?: string;
  replyTo?: string;
  unsubscribeUrl?: string | null;
  attachments?: Array<{ filename: string; content: string; content_type?: string }>;
};

const DEFAULT_FROM = "Lemtik Security <alerts@lemtik.com.ng>";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripTags(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function formatLink(label: string, href: string) {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:#22d3ee;color:#06121c;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:700">${escapeHtml(label)}</a>`;
}

function shell({ title, intro, body, footer, unsubscribeUrl }: {
  title: string;
  intro: string;
  body: string;
  footer?: string;
  unsubscribeUrl?: string | null;
}) {
  const safeFooter = footer ?? "Lemtik Security";
  const unsubscribe = unsubscribeUrl
    ? `<div style="margin-top:24px;font-size:12px;color:#94a3b8"><a href="${escapeHtml(unsubscribeUrl)}" style="color:#38bdf8">Unsubscribe</a> from non-critical emails.</div>`
    : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;background:#020617;color:#e2e8f0;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:680px;margin:0 auto;padding:32px 18px;">
      <div style="border:1px solid rgba(148,163,184,.18);border-radius:24px;overflow:hidden;background:linear-gradient(180deg,#0f172a 0%,#020617 100%);box-shadow:0 18px 60px rgba(2,6,23,.45);">
        <div style="padding:24px 28px;border-bottom:1px solid rgba(148,163,184,.12);">
          <div style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#67e8f9;">Lemtik Security</div>
          <h1 style="margin:10px 0 0;font-size:28px;line-height:1.2;color:#f8fafc;">${escapeHtml(title)}</h1>
          <p style="margin:14px 0 0;font-size:15px;line-height:1.7;color:#cbd5e1;">${escapeHtml(intro)}</p>
        </div>
        <div style="padding:28px;">${body}</div>
        <div style="padding:20px 28px;border-top:1px solid rgba(148,163,184,.12);font-size:12px;line-height:1.6;color:#94a3b8;">
          ${escapeHtml(safeFooter)}.
          ${unsubscribe}
        </div>
      </div>
    </div>
  </body>
</html>`;
}

function list(items: string[]) {
  return `<ul style="margin:16px 0 0;padding:0 0 0 18px;color:#dbeafe;line-height:1.7;">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function table(rows: Array<[string, string]>) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-top:16px;">
    ${rows.map(([label, value]) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid rgba(148,163,184,.12);font-size:13px;color:#94a3b8;width:42%">${escapeHtml(label)}</td>
        <td style="padding:10px 0;border-bottom:1px solid rgba(148,163,184,.12);font-size:13px;color:#e2e8f0;font-weight:600">${escapeHtml(value)}</td>
      </tr>
    `).join("")}
  </table>`;
}

export function buildUserInvitationEmail(input: {
  organisationName: string;
  invitedRole: string;
  invitedBy?: string | null;
  inviteUrl?: string | null;
}) {
  const title = `You have been invited to ${input.organisationName}`;
  const text = [
    `You have been invited to join ${input.organisationName} as ${input.invitedRole}.`,
    input.invitedBy ? `Invited by ${input.invitedBy}.` : null,
    input.inviteUrl ? `Open this link to accept the invitation: ${input.inviteUrl}` : "Your account has been provisioned and your administrator will share the sign-in password separately.",
  ].filter(Boolean).join("\n");
  const body = `
    <p style="margin:0;font-size:15px;line-height:1.7;color:#cbd5e1;">You have been invited to join <strong style="color:#f8fafc">${escapeHtml(input.organisationName)}</strong> as <strong style="color:#f8fafc">${escapeHtml(input.invitedRole)}</strong>.</p>
    ${input.invitedBy ? `<p style="margin:14px 0 0;font-size:14px;color:#94a3b8;">Invited by ${escapeHtml(input.invitedBy)}.</p>` : ""}
    ${input.inviteUrl ? `<div style="margin-top:22px;">${formatLink("Accept invitation", input.inviteUrl)}</div>` : ""}
    <p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:#94a3b8;">This invitation expires in 48 hours. If you are not expecting this email, you can ignore it.</p>
  `;
  return {
    subject: title,
    html: shell({ title, intro: "Complete your account setup to start using the dashboard.", body, footer: "Invitation email", unsubscribeUrl: null }),
    text,
  };
}

export function buildWelcomeEmail(input: {
  organisationName: string;
  inviteUrl: string;
  adminName?: string | null;
}) {
  const title = `Welcome to ${input.organisationName}`;
  const text = [
    `Welcome to ${input.organisationName}.`,
    input.adminName ? `Hello ${input.adminName}.` : null,
    `Open this link to get started: ${input.inviteUrl}`,
  ].filter(Boolean).join("\n");
  const body = `
    <p style="margin:0;font-size:15px;line-height:1.7;color:#cbd5e1;">Welcome to <strong style="color:#f8fafc">${escapeHtml(input.organisationName)}</strong>.</p>
    ${input.adminName ? `<p style="margin:14px 0 0;font-size:14px;color:#94a3b8;">Hello ${escapeHtml(input.adminName)}.</p>` : ""}
    <div style="margin-top:22px;">${formatLink("Open dashboard setup", input.inviteUrl)}</div>
    <p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:#94a3b8;">Use the link above to finish account setup and activate your organisation.</p>
  `;
  return {
    subject: title,
    html: shell({ title, intro: "Your organisation is ready for onboarding.", body, footer: "Welcome email", unsubscribeUrl: null }),
    text,
  };
}

export function buildReportDeliveryEmail(input: {
  reportName: string;
  organisationName: string;
  summary: string;
  reportUrl?: string | null;
  unsubscribeUrl?: string | null;
}) {
  const title = `${input.reportName} for ${input.organisationName}`;
  const text = `${input.reportName} for ${input.organisationName}\n\n${input.summary}${input.reportUrl ? `\n\nOpen report: ${input.reportUrl}` : ""}`;
  const body = `
    <p style="margin:0;font-size:15px;line-height:1.7;color:#cbd5e1;">${escapeHtml(input.summary)}</p>
    ${input.reportUrl ? `<div style="margin-top:22px;">${formatLink("Open report", input.reportUrl)}</div>` : ""}
    ${table([
      ["Organisation", input.organisationName],
      ["Report", input.reportName],
    ])}
  `;
  return {
    subject: title,
    html: shell({ title, intro: `Your ${input.reportName.toLowerCase()} is ready.`, body, footer: "Report delivery", unsubscribeUrl: input.unsubscribeUrl }),
    text,
  };
}

export function buildAlertEmail(input: {
  subject: string;
  headline: string;
  summary: string;
  severityLabel: string;
  actionLabel?: string;
  actionUrl?: string | null;
  unsubscribeUrl?: string | null;
}) {
  const text = `${input.headline}\n\n${input.summary}${input.actionUrl ? `\n\nOpen: ${input.actionUrl}` : ""}`;
  const body = `
    <div style="display:inline-block;border:1px solid rgba(103,232,249,.3);background:rgba(34,211,238,.12);color:#cffafe;border-radius:999px;padding:6px 12px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;">${escapeHtml(input.severityLabel)}</div>
    <h2 style="margin:16px 0 0;font-size:20px;line-height:1.3;color:#f8fafc;">${escapeHtml(input.headline)}</h2>
    <p style="margin:12px 0 0;font-size:15px;line-height:1.7;color:#cbd5e1;">${escapeHtml(input.summary)}</p>
    ${input.actionUrl ? `<div style="margin-top:22px;">${formatLink(input.actionLabel ?? "Open details", input.actionUrl)}</div>` : ""}
  `;
  return {
    subject: input.subject,
    html: shell({ title: input.subject, intro: input.headline, body, footer: "Alert delivery", unsubscribeUrl: input.unsubscribeUrl }),
    text,
  };
}

export function buildSubscriptionEmail(input: {
  kind: "confirmation" | "renewal_reminder" | "overdue_notice" | "suspended";
  organisationName: string;
  amount?: string;
  actionUrl?: string | null;
}) {
  const titles: Record<typeof input.kind, string> = {
    confirmation: "Subscription confirmed",
    renewal_reminder: "Subscription renewal reminder",
    overdue_notice: "Subscription overdue notice",
    suspended: "Account suspended notice",
  };
  const bodyText: Record<typeof input.kind, string> = {
    confirmation: "Your subscription is active and billing is ready.",
    renewal_reminder: "Your subscription will renew soon.",
    overdue_notice: "Your account has an overdue invoice that requires attention.",
    suspended: "Your account has been suspended until billing is resolved.",
  };
  const body = `
    <p style="margin:0;font-size:15px;line-height:1.7;color:#cbd5e1;">${escapeHtml(bodyText[input.kind])}</p>
    ${input.amount ? `<p style="margin:14px 0 0;font-size:14px;color:#94a3b8;">Amount: <strong style="color:#f8fafc">${escapeHtml(input.amount)}</strong></p>` : ""}
    ${input.actionUrl ? `<div style="margin-top:22px;">${formatLink("Open billing", input.actionUrl)}</div>` : ""}
  `;
  return {
    subject: `${titles[input.kind]} · ${input.organisationName}`,
    html: shell({ title: titles[input.kind], intro: input.organisationName, body, footer: "Subscription notice", unsubscribeUrl: input.kind === "overdue_notice" || input.kind === "suspended" ? null : undefined }),
    text: `${titles[input.kind]} for ${input.organisationName}${input.amount ? `\nAmount: ${input.amount}` : ""}`,
  };
}

export function buildInventoryAlertEmail(input: {
  organisationName: string;
  resource: string;
  threshold: string;
  current: string;
  actionUrl?: string | null;
}) {
  return buildAlertEmail({
    subject: `Inventory threshold alert · ${input.organisationName}`,
    headline: `${input.resource} is below threshold`,
    summary: `${input.resource} is currently ${input.current}, against the threshold ${input.threshold}.`,
    severityLabel: "Inventory alert",
    actionLabel: "Open inventory",
    actionUrl: input.actionUrl,
  });
}

export function buildOsintAlertEmail(input: {
  organisationName: string;
  title: string;
  summary: string;
  actionUrl?: string | null;
}) {
  return buildAlertEmail({
    subject: `OSINT high-confidence alert · ${input.organisationName}`,
    headline: input.title,
    summary: input.summary,
    severityLabel: "OSINT alert",
    actionLabel: "Open intelligence",
    actionUrl: input.actionUrl,
  });
}

export async function sendResendEmail(message: EmailMessage) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, skipped: true, reason: "RESEND_API_KEY not configured" as const };
  }

  const from = message.from ?? DEFAULT_FROM;
  const payload = {
    from,
    to: Array.isArray(message.to) ? message.to : [message.to],
    subject: message.subject,
    html: message.html,
    text: message.text,
    ...(message.replyTo ? { reply_to: message.replyTo } : {}),
    ...(message.attachments?.length ? { attachments: message.attachments } : {}),
  };

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { ok: false, skipped: false, status: response.status, error: body || response.statusText };
  }

  return { ok: true, skipped: false };
}

export function emailTextFallback(value: string) {
  return stripTags(value);
}

export type {
  EmailKind,
  EmailMessage,
};
