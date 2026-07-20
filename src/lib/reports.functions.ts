import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildReportDeliveryEmail, sendResendEmail } from "@/lib/email.service";
import { throwSafeError } from "@/lib/server-errors";
import { getActiveOrgId } from "@/lib/orgs.server";
import { requestRelationshipApi } from "@/lib/relationship-api";

export const sendReportDelivery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      report_name: z.string().min(1).max(160),
      summary: z.string().min(1).max(1200),
      recipient_emails: z.array(z.string().email().max(200)).min(1).max(10),
      report_url: z.string().url().max(1000).nullable().optional(),
      unsubscribe_url: z.string().url().max(1000).nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { data: org, error } = await context.supabase
      .from("organisations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle();
    if (error) throwSafeError("reports.delivery.org", error, "Unable to load organisation.");
    if (!org) throw new Error("Organisation not found.");

    const email = buildReportDeliveryEmail({
      reportName: data.report_name,
      organisationName: org.name,
      summary: data.summary,
      reportUrl: data.report_url ?? null,
      unsubscribeUrl: data.unsubscribe_url ?? null,
    });

    const delivery = await sendResendEmail({
      to: data.recipient_emails,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });

    if (!delivery.ok) {
      return { ok: true, warning: delivery.error ?? "Report email delivery skipped.", skipped: delivery.skipped };
    }

    return { ok: true };
  });

export const generateReportSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      template_id: z.string().min(1).max(40),
      template_title: z.string().min(1).max(160),
      org_id: z.string().uuid().optional(),
      stats: z.record(z.string(), z.any()).optional(),
      sections: z.array(z.string().max(80)).max(20).optional(),
      range_label: z.string().max(80).optional(),
      commentary: z.string().max(2000).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = data.org_id ?? await getActiveOrgId(context.supabase, context.userId);
    const result = await requestRelationshipApi<{ summary?: string }>("/api/v1/ai/generate-summary", {
      body: {
        org_id: orgId,
        template_id: data.template_id,
        template_title: data.template_title,
        stats: data.stats ?? {},
        sections: data.sections ?? [],
        range_label: data.range_label ?? null,
        commentary: data.commentary ?? null,
        source: "c4isod-dashboard",
      },
    });
    if (result?.summary) return result.summary;

    const stats = data.stats ?? {};
    const parts = [
      `${data.template_title} prepared for ${orgId}.`,
      data.range_label ? `Window: ${data.range_label}.` : null,
      data.commentary ? data.commentary : null,
      data.sections?.length ? `Included sections: ${data.sections.join(", ")}.` : null,
      Object.keys(stats).length ? `Key metrics: ${Object.entries(stats).map(([key, value]) => `${key}=${String(value)}`).join(", ")}.` : null,
    ].filter(Boolean);
    return parts.join(" ");
  });
