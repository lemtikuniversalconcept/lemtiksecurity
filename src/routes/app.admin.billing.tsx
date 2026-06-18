import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getPlatformBilling, updateTierPricing } from "@/lib/platform.billing.functions";
import { resolveAppAccess, requireSectionAccess } from "@/lib/rbac";
import { Area, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarDays, Loader2, Mail, Percent, RefreshCw, SlidersHorizontal, TrendingUp } from "lucide-react";

const TIER_LABELS: Record<string, string> = {
  basic: "Basic",
  professional: "Standard",
  enterprise: "Enterprise",
  government: "Government",
};

function featuresList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

export const Route = createFileRoute("/app/admin/billing")({
  head: () => ({ meta: [{ title: "Billing · Lemtik Admin" }] }),
  beforeLoad: async () => {
    const access = await resolveAppAccess(supabase);
    requireSectionAccess(access, ["lemtik_admin"]);
    return { appAccess: access };
  },
  component: BillingPage,
});

function BillingPage() {
  const loadBilling = useServerFn(getPlatformBilling);
  const updatePricing = useServerFn(updateTierPricing);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["platform-billing"],
    queryFn: () => loadBilling(),
  });
  const [pricingDraft, setPricingDraft] = useState<Record<string, { amount: string; features: string }>>({});

  const pricing = data?.pricing ?? {};
  const overview = data?.overview;
  const subscriptions = data?.subscriptions ?? [];
  const overdue = data?.overdue ?? [];

  const defaults = useMemo(() => Object.keys(TIER_LABELS).map((tier) => ({
    tier,
    amount: pricingDraft[tier]?.amount ?? String(pricing[tier]?.monthly_amount ?? ""),
    features: pricingDraft[tier]?.features ?? featuresList(pricing[tier]?.features).join(", "),
  })), [pricing, pricingDraft]);

  const saveMut = useMutation({
    mutationFn: (tier: string) => {
      const draft = pricingDraft[tier] ?? {
        amount: String(pricing[tier]?.monthly_amount ?? 0),
        features: featuresList(pricing[tier]?.features).join(", "),
      };
      return updatePricing({
        data: {
          tier: tier as never,
          monthly_amount: Number(draft.amount || 0),
          features: draft.features.split(",").map((s) => s.trim()).filter(Boolean),
        },
      });
    },
    onSuccess: async () => {
      await refetch();
    },
  });

  const chartData = overview?.trend ?? [];

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-white/10 bg-white/5 p-5">
        <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Admin Console</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Billing & subscriptions</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-300">
          MRR and tier pricing are derived from live organisation records and pricing config stored in Supabase.
        </p>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Total MRR" value={overview?.totalMrr ?? "—"} icon={TrendingUp} tone="resolved" />
        <Stat label="Active subscriptions" value={subscriptions.length.toString()} icon={CalendarDays} />
        <Stat label="Overdue accounts" value={overdue.length.toString()} icon={Percent} tone="critical" />
        <Stat label="Pricing tiers" value={Object.keys(TIER_LABELS).length.toString()} icon={SlidersHorizontal} />
      </div>

      <section className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded-3xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">MRR overview</div>
              <h2 className="text-lg font-semibold">MRR by tier and 12-month trend</h2>
            </div>
            <button onClick={() => refetch()} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs hover:bg-surface-2">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-4">
            {overview?.byTier?.map((tier) => (
              <div key={tier.tier} className="rounded-2xl border border-border bg-surface p-4">
                <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{tier.label}</div>
                <div className="mt-2 text-xl font-semibold">{tier.amountFormatted}</div>
              </div>
            ))}
          </div>

          <div className="mt-5 h-72 rounded-2xl border border-border bg-surface p-3">
            {isLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading chart…</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => `₦${Number(v) / 1000}k`} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value) => [`₦${Number(value).toLocaleString("en-NG")}`, "MRR"]} />
                  <Line type="monotone" dataKey="total" stroke="var(--primary)" strokeWidth={2.5} dot={false} />
                  <Area type="monotone" dataKey="total" fill="rgba(59,130,246,0.12)" stroke="none" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-card p-5 space-y-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Subscription table</div>
            <h2 className="text-lg font-semibold">Active subscriptions</h2>
          </div>
          <div className="space-y-3">
            {subscriptions.slice(0, 8).map((sub) => (
              <div key={sub.id} className="rounded-2xl border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{sub.name}</div>
                    <div className="text-xs text-muted-foreground">{TIER_LABELS[sub.tier] ?? sub.tier} · {sub.status.replace(/_/g, " ")}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium">{sub.amountFormatted}</div>
                    <div className="text-xs text-muted-foreground">Next bill {formatDate(sub.next_billing_date)}</div>
                  </div>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {sub.contact ? `Contact: ${sub.contact}` : "No billing contact on file"}
                </div>
              </div>
            ))}
            {subscriptions.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">No active subscriptions found.</div>}
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-3xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Overdue accounts</div>
              <h2 className="text-lg font-semibold">Highlighted list</h2>
            </div>
            <Mail className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-4 space-y-3">
            {overdue.map((org) => (
              <div key={org.id} className="rounded-2xl border border-critical/30 bg-critical/10 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-foreground">{org.name}</div>
                    <div className="text-xs text-muted-foreground">{org.days_overdue} days overdue · {TIER_LABELS[org.tier] ?? org.tier}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium text-foreground">{org.amountFormatted}</div>
                    <div className="text-xs text-muted-foreground">Due {formatDate(org.next_billing_date)}</div>
                  </div>
                </div>
                <div className="mt-3">
                  {org.contact ? (
                    <a href={mailLink(org.contact)} className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs hover:bg-surface-2">
                      Contact
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground">No contact button available</span>
                  )}
                </div>
              </div>
            ))}
            {overdue.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">No overdue accounts.</div>}
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-card p-5">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Tier pricing configuration</div>
            <h2 className="text-lg font-semibold">Edit pricing and feature unlocks</h2>
          </div>

          <div className="mt-4 grid gap-4">
            {defaults.map((row) => (
              <div key={row.tier} className="rounded-2xl border border-border bg-surface p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">{TIER_LABELS[row.tier] ?? row.tier}</div>
                    <div className="text-xs text-muted-foreground">Feature set unlocked by this tier</div>
                  </div>
                  <button
                    onClick={() => saveMut.mutate(row.tier)}
                    disabled={saveMut.isPending}
                    className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {saveMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    Save
                  </button>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-[0.35fr_1fr]">
                  <label className="space-y-1.5">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Monthly amount</div>
                    <input
                      value={pricingDraft[row.tier]?.amount ?? row.amount}
                      onChange={(e) => setPricingDraft((p) => ({ ...p, [row.tier]: { amount: e.target.value, features: pricingDraft[row.tier]?.features ?? row.features } }))}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Features</div>
                    <input
                      value={pricingDraft[row.tier]?.features ?? row.features}
                      onChange={(e) => setPricingDraft((p) => ({ ...p, [row.tier]: { amount: pricingDraft[row.tier]?.amount ?? row.amount, features: e.target.value } }))}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
                      placeholder="Comma-separated features"
                    />
                  </label>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Unlocks: {featuresList(pricing[row.tier]?.features).join(", ") || "No features set"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-md border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical">
          {(error as Error).message}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, icon: Icon, tone = "muted" }: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "muted" | "resolved" | "critical";
}) {
  const toneClass = tone === "resolved" ? "text-resolved" : tone === "critical" ? "text-critical" : "text-foreground";
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
        <Icon className={`h-4 w-4 ${toneClass}`} />
      </div>
      <div className={`mt-3 text-3xl font-semibold tracking-tight ${toneClass}`}>{value}</div>
    </div>
  );
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium" }).format(new Date(iso));
}

function mailLink(contact: string) {
  return contact.includes("@") ? `mailto:${contact}` : `tel:${contact}`;
}
