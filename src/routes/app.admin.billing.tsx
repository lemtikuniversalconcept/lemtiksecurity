import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { getPlatformBilling, updateTierPricing } from "@/lib/platform.billing.functions";
import { requireSectionAccess } from "@/lib/rbac";
import { toast } from "sonner";
import { Loader2, Mail, RefreshCw } from "lucide-react";
import { Empty, Kpi, Notice, PageHeader, Panel, Status } from "@/components/nw";

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
  beforeLoad: async ({ context }) => {
    const access = context.appAccess;
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
    onSuccess: async (_r, tier) => {
      toast.success(`${TIER_LABELS[tier] ?? tier} pricing saved`);
      await refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="col g16">
      <PageHeader title="Billing" sub="Figures use each organisation's current tier at its list price. Lemtik doesn't record invoices or payments here, so there's no billing history.">
        <button type="button" className="b b-sec" onClick={() => void refetch()}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </PageHeader>

      {error && <Notice tone="fail">{(error as Error).message}</Notice>}

      <div className="kpis">
        <Kpi label="Monthly revenue at list price" value={overview?.totalMrr ?? "—"} title="Sum of the list price of each billable organisation's current tier" />
        <Kpi label="Billable subscriptions" value={isLoading ? "—" : subscriptions.length} />
        <Kpi label="Marked past due" value={isLoading ? "—" : overdue.length} deltaClass={overdue.length ? "up-bad" : ""} delta={overdue.length ? "needs follow-up" : undefined} />
        {(overview?.byTier ?? []).map((t) => (
          <Kpi key={t.tier} label={TIER_LABELS[t.tier] ?? t.label} value={t.amountFormatted} />
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2" style={{ alignItems: "start" }}>
        <Panel title="Billable subscriptions" meta={`${subscriptions.length}`} bodyClassName="">
          {isLoading ? (
            <Empty>
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
            </Empty>
          ) : subscriptions.length === 0 ? (
            <Empty>No billable subscriptions.</Empty>
          ) : (
            <div className="scroll" style={{ maxHeight: 460 }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Organisation</th>
                    <th>Tier</th>
                    <th>List price</th>
                    <th>Status</th>
                    <th>Contact</th>
                  </tr>
                </thead>
                <tbody>
                  {subscriptions.map((sub) => (
                    <tr key={sub.id}>
                      <td>
                        <b>{sub.name}</b>
                      </td>
                      <td>{TIER_LABELS[sub.tier] ?? sub.tier}</td>
                      <td className="mono">{sub.amountFormatted}</td>
                      <td>
                        <Status tone={sub.status === "active" ? "ok" : sub.status === "trial" ? "blue" : "neutral"}>{sub.status.replace(/_/g, " ")}</Status>
                      </td>
                      <td className="t2">{sub.contact ? <a className="lnk" href={mailLink(sub.contact)}>{sub.contact}</a> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Marked past due" meta={`${overdue.length}`} bodyClassName="">
          {overdue.length === 0 ? (
            <Empty>No organisations are marked past due.</Empty>
          ) : (
            <div className="list">
              {overdue.map((org) => (
                <div key={org.id} className="row g10" style={{ padding: "10px 14px" }}>
                  <span className="f1 col" style={{ minWidth: 0 }}>
                    <b className="trunc">{org.name}</b>
                    <span className="t3" style={{ fontSize: 12 }}>
                      {TIER_LABELS[org.tier] ?? org.tier} · {org.amountFormatted} · record last changed {org.days_overdue} day{org.days_overdue === 1 ? "" : "s"} ago
                    </span>
                  </span>
                  {org.contact ? (
                    <a href={mailLink(org.contact)} className="b b-sm b-sec">
                      <Mail className="h-3.5 w-3.5" /> Contact
                    </a>
                  ) : (
                    <span className="t3" style={{ fontSize: 12 }}>
                      No contact on file
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Tier pricing" meta="Changes apply to how revenue is calculated here and what each tier unlocks">
        <div className="grid gap-3 lg:grid-cols-2">
          {defaults.map((row) => (
            <div key={row.tier} className="card col g10" style={{ padding: 14 }}>
              <div className="row g8">
                <b className="f1">{TIER_LABELS[row.tier] ?? row.tier}</b>
                <button type="button" className="b b-sm b-pri" onClick={() => saveMut.mutate(row.tier)} disabled={saveMut.isPending && saveMut.variables === row.tier}>
                  {saveMut.isPending && saveMut.variables === row.tier ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
                <label className="fl">
                  <span className="lbl">Monthly (₦)</span>
                  <input className="in mono" inputMode="numeric" value={pricingDraft[row.tier]?.amount ?? row.amount} onChange={(e) => setPricingDraft((p) => ({ ...p, [row.tier]: { amount: e.target.value, features: pricingDraft[row.tier]?.features ?? row.features } }))} />
                </label>
                <label className="fl">
                  <span className="lbl">Features (comma separated)</span>
                  <input className="in" value={pricingDraft[row.tier]?.features ?? row.features} onChange={(e) => setPricingDraft((p) => ({ ...p, [row.tier]: { amount: pricingDraft[row.tier]?.amount ?? row.amount, features: e.target.value } }))} />
                </label>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function mailLink(contact: string) {
  return contact.includes("@") ? `mailto:${contact}` : `tel:${contact}`;
}
