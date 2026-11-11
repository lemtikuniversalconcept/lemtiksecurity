import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getActiveOrgId } from "@/lib/orgs.server";
import { throwSafeError } from "@/lib/server-errors";
import { recordBlackboxAudit } from "@/lib/audit.server";
import type { EscalationPolicy } from "./escalation.server";

export type { EscalationPolicy, EscalationStep } from "./escalation.server";

const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;

export const getEscalationPolicy = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EscalationPolicy & { is_default: boolean; updated_at: string | null; updated_by_name: string | null; email_configured: boolean; telegram_configured: boolean }> => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { data, error } = await (context.supabase as any).from("escalation_policies").select("enabled, min_severity, steps, updated_at, updated_by_name").eq("organisation_id", orgId).maybeSingle();
    if (error) throwSafeError("escalation.get", error, "Unable to load the escalation chain.");
    const { DEFAULT_POLICY } = await import("./escalation.server");
    const email_configured = !!process.env.RESEND_API_KEY?.trim();
    const { botToken } = await import("./telegram.server");
    const telegram_configured = !!botToken();
    if (!data) return { ...DEFAULT_POLICY, is_default: true, updated_at: null, updated_by_name: null, email_configured, telegram_configured };
    return { enabled: data.enabled, min_severity: data.min_severity, steps: data.steps, is_default: false, updated_at: data.updated_at, updated_by_name: data.updated_by_name, email_configured, telegram_configured };
  });

const stepSchema = z.object({
  after_min: z.number().int().min(0).max(240),
  roles: z.array(z.enum(["supervisor", "manager", "client_admin"])).min(1).max(3),
  channels: z.array(z.enum(["in_app", "email", "telegram", "push"])).min(1).max(4),
});

export const saveEscalationPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ enabled: z.boolean(), min_severity: z.number().int().min(3).max(5), steps: z.array(stepSchema).min(1).max(5) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const db = await admin();
    const { roleIn, myName } = await import("./links.server");
    if ((await roleIn(db, context.userId, orgId)) !== "manager") throwSafeError("escalation.save", new Error("forbidden"), "Only security managers can change the escalation chain.");
    const steps = [...data.steps].sort((a, b) => a.after_min - b.after_min);
    const { error } = await db.from("escalation_policies").upsert({
      organisation_id: orgId, enabled: data.enabled, min_severity: data.min_severity, steps,
      updated_at: new Date().toISOString(), updated_by: context.userId, updated_by_name: await myName(db, context.userId),
    });
    if (error) throwSafeError("escalation.save", error, "Unable to save the escalation chain.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "escalation_policy", resourceId: orgId, actionType: "update", actionDetail: { enabled: data.enabled, min_severity: data.min_severity, steps: steps.length } });
    return { ok: true };
  });

export type AlertDelivery = { step: number; channel: string; recipient_label: string | null; status: "sent" | "failed" | "skipped"; detail: string | null; created_at: string };

export const listAlertDeliveries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ alert_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ deliveries: AlertDelivery[]; acknowledged_at: string | null; escalation_done: boolean }> => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const sb = context.supabase as any;
    const [{ data: rows, error }, { data: a }] = await Promise.all([
      sb.from("alert_deliveries").select("step, channel, recipient_label, status, detail, created_at").eq("organisation_id", orgId).eq("movement_alert_id", data.alert_id).order("created_at", { ascending: true }).limit(200),
      sb.from("movement_alerts").select("acknowledged_at, escalation_done").eq("id", data.alert_id).eq("organisation_id", orgId).maybeSingle(),
    ]);
    if (error) throwSafeError("escalation.deliveries", error, "Unable to load the delivery log.");
    return { deliveries: (rows ?? []) as AlertDelivery[], acknowledged_at: (a?.acknowledged_at as string | null) ?? null, escalation_done: !!a?.escalation_done };
  });
