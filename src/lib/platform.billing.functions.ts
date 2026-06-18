import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { throwSafeError } from "@/lib/server-errors";

const TIERS = ["basic", "professional", "enterprise", "government"] as const;
type Tier = (typeof TIERS)[number];

const DEFAULT_PRICING: Record<Tier, { monthly_amount: number; features: string[] }> = {
  basic: { monthly_amount: 150_000, features: ["Core incidents", "Basic reports", "Single site"] },
  professional: { monthly_amount: 350_000, features: ["Multi-site operations", "Advanced analytics", "Priority support"] },
  enterprise: { monthly_amount: 750_000, features: ["All operational modules", "Custom integrations", "Dedicated success"] },
  government: { monthly_amount: 1_000_000, features: ["Compliance controls", "Multi-agency support", "Priority SLA"] },
};

function formatMoney(value: number) {
  return `₦${value.toLocaleString("en-NG")}`;
}

function addMonths(base: Date, months: number) {
  const d = new Date(base);
  d.setMonth(d.getMonth() + months);
  return d;
}

function monthLabel(date: Date) {
  return new Intl.DateTimeFormat("en-NG", { month: "short", year: "2-digit" }).format(date);
}

function normalizeFeatures(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function isBillable(status: string) {
  return !["suspended", "cancelled"].includes(status);
}

async function assertPlatformAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "lemtik_admin")
    .maybeSingle();
  if (error) throwSafeError("billing.admin.check", error, "Unable to verify platform admin access.");
  if (!data) throw new Error("Access denied.");
}

export const getPlatformBilling = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context.supabase, context.userId);

    const [orgsRes, pricingRes] = await Promise.all([
      context.supabase
        .from("organisations")
        .select("id, name, type, subscription_tier, subscription_status, created_at, updated_at, billing_contact_name, billing_contact_email, billing_contact_phone")
        .order("created_at", { ascending: false }),
      (context.supabase as any)
        .from("billing_tier_pricing")
        .select("*")
        .order("tier"),
    ]);

    if (orgsRes.error) throwSafeError("billing.orgs", orgsRes.error, "Unable to load organisations.");
    if (pricingRes.error) throwSafeError("billing.pricing", pricingRes.error, "Unable to load tier pricing.");

    const orgs = orgsRes.data ?? [];
    const pricingRows = pricingRes.data ?? [];
    const pricingMap = new Map<string, { monthly_amount: number; features: string[] }>();
    for (const tier of TIERS) {
      const row = pricingRows.find((r: any) => r.tier === tier) ?? DEFAULT_PRICING[tier];
      pricingMap.set(tier, {
        monthly_amount: Number(row.monthly_amount ?? DEFAULT_PRICING[tier].monthly_amount),
        features: normalizeFeatures(row.features).length ? normalizeFeatures(row.features) : DEFAULT_PRICING[tier].features,
      });
    }

    const billable = orgs.filter((org: any) => isBillable(String(org.subscription_status)));
    const totalMrr = billable.reduce((sum: number, org: any) => sum + (pricingMap.get(String(org.subscription_tier))?.monthly_amount ?? 0), 0);
    const mrrByTier = TIERS.map((tier) => ({
      tier,
      label: tier.replace(/\b\w/g, (c) => c.toUpperCase()),
      amount: billable
        .filter((org: any) => String(org.subscription_tier) === tier)
        .reduce((sum: number, org: any) => sum + (pricingMap.get(tier)?.monthly_amount ?? 0), 0),
    }));

    const series = Array.from({ length: 12 }, (_, idx) => {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      monthStart.setMonth(monthStart.getMonth() - (11 - idx));
      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);
      const active = orgs.filter((org: any) => new Date(org.created_at) <= monthEnd && isBillable(String(org.subscription_status)));
      const byTier = TIERS.reduce<Record<Tier, number>>((acc, tier) => {
        acc[tier] = active.filter((org: any) => String(org.subscription_tier) === tier).length * (pricingMap.get(tier)?.monthly_amount ?? 0);
        return acc;
      }, { basic: 0, professional: 0, enterprise: 0, government: 0 });
      return {
        month: monthLabel(monthStart),
        total: Object.values(byTier).reduce((sum, value) => sum + value, 0),
        ...byTier,
      };
    });

    const subscriptions = billable.map((org: any) => {
      const pricing = pricingMap.get(String(org.subscription_tier)) ?? DEFAULT_PRICING.basic;
      const nextBilling = addMonths(new Date(org.updated_at ?? org.created_at), 1);
      return {
        id: org.id,
        name: org.name,
        tier: org.subscription_tier,
        amount: pricing.monthly_amount,
        next_billing_date: nextBilling.toISOString(),
        status: org.subscription_status,
        contact: org.billing_contact_email ?? org.billing_contact_phone ?? null,
      };
    });

    const overdue = orgs
      .filter((org: any) => String(org.subscription_status) === "past_due")
      .map((org: any) => {
        const pricing = pricingMap.get(String(org.subscription_tier)) ?? DEFAULT_PRICING.basic;
        const updatedAt = new Date(org.updated_at ?? org.created_at);
        const daysOverdue = Math.max(0, Math.floor((Date.now() - updatedAt.getTime()) / 86_400_000));
        return {
          id: org.id,
          name: org.name,
          tier: org.subscription_tier,
          amount: pricing.monthly_amount,
          days_overdue: daysOverdue,
          contact: org.billing_contact_email ?? org.billing_contact_phone ?? null,
          next_billing_date: addMonths(updatedAt, 1).toISOString(),
        };
      })
      .sort((a: any, b: any) => b.days_overdue - a.days_overdue);

    return {
      pricing: Object.fromEntries([...pricingMap.entries()].map(([tier, value]) => [tier, value])),
      overview: {
        totalMrr: formatMoney(totalMrr),
        byTier: mrrByTier.map((item) => ({ ...item, amountFormatted: formatMoney(item.amount) })),
        trend: series.map((row) => ({
          month: row.month,
          total: row.total,
          totalFormatted: formatMoney(row.total),
          basic: row.basic,
          professional: row.professional,
          enterprise: row.enterprise,
          government: row.government,
        })),
      },
      subscriptions: subscriptions.map((row) => ({
        ...row,
        amountFormatted: formatMoney(row.amount),
      })),
      overdue: overdue.map((row: any) => ({
        ...row,
        amountFormatted: formatMoney(row.amount),
      })),
    };
  });

export const updateTierPricing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      tier: z.enum(TIERS),
      monthly_amount: z.number().nonnegative(),
      features: z.array(z.string().min(1).max(80)).max(20),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context.supabase, context.userId);
    const { error } = await (context.supabase as any)
      .from("billing_tier_pricing")
      .upsert({
        tier: data.tier,
        monthly_amount: data.monthly_amount,
        features: data.features,
      }, { onConflict: "tier" });
    if (error) throwSafeError("billing.pricing.update", error, "Unable to update tier pricing.");
    return { ok: true };
  });
