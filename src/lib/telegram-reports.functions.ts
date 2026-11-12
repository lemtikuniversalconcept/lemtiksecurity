import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getActiveOrgId, getSiteUrl } from "@/lib/orgs.server";
import { throwSafeError } from "@/lib/server-errors";
import { recordBlackboxAudit } from "@/lib/audit.server";
import { admin, myName, roleIn } from "@/lib/links.server";

// The organisation's public link for community reports by Telegram.

export type ReportLinkState = {
  configured: boolean;
  can_manage: boolean;
  link: { url: string; label: string | null; daily_limit: number; created_at: string; created_by_name: string | null } | null;
  reporters: number;
  blocked: number;
  reports_30d: number;
  staff_reports_30d: number;
};

async function ctx(context: { supabase: unknown; userId: string }) {
  const orgId = await getActiveOrgId(context.supabase as any, context.userId);
  const db = await admin();
  const role = await roleIn(db, context.userId, orgId);
  return { orgId, db, role };
}

export const getReportLink = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ReportLinkState> => {
    const { orgId, db, role } = await ctx(context);
    if (!role || !["manager", "supervisor"].includes(role)) throwSafeError("telegram.reports", new Error("role"), "Only managers and operators can see the report link.");
    const { botToken, botUsername } = await import("./telegram.server");
    const configured = !!botToken();
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const [{ data: link }, { count: reporters }, { count: blocked }, { count: community }, { count: staff }] = await Promise.all([
      db.from("telegram_report_links").select("code, label, daily_limit, created_at, created_by_name").eq("organisation_id", orgId).is("revoked_at", null).maybeSingle(),
      db.from("telegram_reporters").select("id", { count: "exact", head: true }).eq("organisation_id", orgId),
      db.from("telegram_reporters").select("id", { count: "exact", head: true }).eq("organisation_id", orgId).not("blocked_at", "is", null),
      db.from("incidents").select("id", { count: "exact", head: true }).eq("organisation_id", orgId).eq("source", "telegram_community").gte("created_at", since),
      db.from("incidents").select("id", { count: "exact", head: true }).eq("organisation_id", orgId).eq("source", "telegram").gte("created_at", since),
    ]);
    const bot = link && configured ? await botUsername() : null;
    return {
      configured,
      can_manage: role === "manager",
      link: link ? { url: bot ? `https://t.me/${bot}?start=rpt_${link.code}` : "", label: link.label, daily_limit: link.daily_limit, created_at: link.created_at, created_by_name: link.created_by_name } : null,
      reporters: reporters ?? 0,
      blocked: blocked ?? 0,
      reports_30d: community ?? 0,
      staff_reports_30d: staff ?? 0,
    };
  });

/** Creates the link, or replaces it (the old one stops working). */
export const createReportLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ label: z.string().trim().max(120).nullable(), daily_limit: z.number().int().min(1).max(100) }).parse(d))
  .handler(async ({ data, context }) => {
    const { orgId, db, role } = await ctx(context);
    if (role !== "manager") throwSafeError("telegram.reports", new Error("role"), "Only managers can create the report link.");
    const { botToken, ensureWebhook } = await import("./telegram.server");
    if (!botToken()) throwSafeError("telegram.reports", new Error("no token"), "Telegram isn't set up on this system yet.");
    const hook = await ensureWebhook(getSiteUrl());
    if (!hook.ok) throwSafeError("telegram.reports", new Error(hook.description ?? "setWebhook failed"), "Couldn't connect to Telegram. Try again.");
    const { tg } = await import("./telegram.server");
    await tg("setMyCommands", { commands: [{ command: "report", description: "Start a security report" }, { command: "send", description: "Send the report" }, { command: "cancel", description: "Discard the report" }] });
    const now = new Date().toISOString();
    await db.from("telegram_report_links").update({ revoked_at: now }).eq("organisation_id", orgId).is("revoked_at", null);
    const { randomBytes } = await import("node:crypto");
    const code = randomBytes(15).toString("base64url");
    const { error } = await db.from("telegram_report_links").insert({ organisation_id: orgId, code, label: data.label || null, daily_limit: data.daily_limit, created_by: context.userId, created_by_name: await myName(db, context.userId) });
    if (error) throwSafeError("telegram.reports", error, "Couldn't create the link.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "telegram_report_link", resourceId: orgId, actionType: "create", actionDetail: { daily_limit: data.daily_limit } });
    return { ok: true };
  });

export const revokeReportLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { orgId, db, role } = await ctx(context);
    if (role !== "manager") throwSafeError("telegram.reports", new Error("role"), "Only managers can turn off the report link.");
    await db.from("telegram_report_links").update({ revoked_at: new Date().toISOString() }).eq("organisation_id", orgId).is("revoked_at", null);
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "telegram_report_link", resourceId: orgId, actionType: "revoke", actionDetail: {} });
    return { ok: true };
  });

/** Stops accepting reports from one community reporter (by number, from an incident). */
export const blockReporter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ number: z.number().int().min(1), block: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { orgId, db, role } = await ctx(context);
    if (role !== "manager") throwSafeError("telegram.reports", new Error("role"), "Only managers can block a reporter.");
    const { data: r } = await db.from("telegram_reporters").update({ blocked_at: data.block ? new Date().toISOString() : null }).eq("organisation_id", orgId).eq("number", data.number).select("id").maybeSingle();
    if (!r) throwSafeError("telegram.reports", new Error("missing"), `There's no Reporter #${data.number}.`);
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "telegram_reporter", resourceId: r.id, actionType: data.block ? "block" : "unblock", actionDetail: { number: data.number } });
    return { ok: true };
  });
