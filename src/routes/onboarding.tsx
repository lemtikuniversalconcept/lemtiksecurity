import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { listMyOrgs, createOrganisation, switchActiveOrg } from "@/lib/orgs.functions";
import { redeemMyInvites } from "@/lib/users.functions";
import { ShieldHalf, Loader2, Building2, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/onboarding")({
  head: () => ({ meta: [{ title: "Welcome · Lemtik SOD" }] }),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/login" });
  },
  component: Onboarding,
});

const ORG_TYPES = [
  { value: "estate", label: "Estate" },
  { value: "corporate", label: "Corporate" },
  { value: "hotel", label: "Hotel" },
  { value: "government", label: "Government" },
] as const;

function Onboarding() {
  const navigate = useNavigate();
  const listMine = useServerFn(listMyOrgs);
  const createOrg = useServerFn(createOrganisation);
  const switchOrg = useServerFn(switchActiveOrg);
  const redeem = useServerFn(redeemMyInvites);

  const { data: orgs = [], isLoading, refetch } = useQuery({
    queryKey: ["my-orgs"], queryFn: () => listMine(),
  });

  // Auto-redeem pending invites on landing
  useEffect(() => {
    redeem().then((r) => {
      if (r?.redeemed && r.redeemed > 0) {
        refetch().then(() => navigate({ to: "/app" }));
      }
    }).catch(() => {});
  }, []);

  const [name, setName] = useState("");
  const [type, setType] = useState<typeof ORG_TYPES[number]["value"]>("corporate");
  const [address, setAddress] = useState("");

  const createMut = useMutation({
    mutationFn: () => createOrg({ data: { name, type, address: address || undefined } }),
    onSuccess: () => navigate({ to: "/app" }),
  });

  const switchMut = useMutation({
    mutationFn: (id: string) => switchOrg({ data: { organisation_id: id } }),
    onSuccess: () => navigate({ to: "/app" }),
  });


  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="w-full max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-primary/15 border border-primary/40">
            <ShieldHalf className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight">LEMTIK SOD</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Get started</div>
          </div>
        </div>

        {isLoading ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…
          </div>
        ) : orgs.length > 0 ? (
          <div className="rounded-lg border border-border bg-card p-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Choose an organisation</h2>
              <p className="text-xs text-muted-foreground">You belong to {orgs.length} organisation{orgs.length === 1 ? "" : "s"}.</p>
            </div>
            <ul className="space-y-2">
              {orgs.map((o) => (
                <li key={o.id}>
                  <button
                    onClick={() => switchMut.mutate(o.id)}
                    disabled={switchMut.isPending}
                    className="w-full flex items-center justify-between rounded-md border border-border bg-surface hover:bg-surface-2 px-4 py-3 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <Building2 className="h-4 w-4 text-primary" />
                      <div>
                        <div className="text-sm font-medium">{o.name}</div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{o.type} · {o.role.replace("_", " ")}</div>
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
            <button
              onClick={() => refetch()}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Or create another organisation below ↓
            </button>
          </div>
        ) : null}

        <div className="rounded-lg border border-border bg-card p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Create a new organisation</h2>
            <p className="text-xs text-muted-foreground">You will become its client admin.</p>
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Organisation name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={120}
                placeholder="e.g. Lekki Phase 1 Residents Association"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Type</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as typeof type)}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                >
                  {ORG_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Primary address (optional)</label>
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  maxLength={300}
                  placeholder="Street, city"
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                />
              </div>
            </div>
            {createMut.error && (
              <div className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical">
                {(createMut.error as Error).message}
              </div>
            )}
            <button
              type="submit"
              disabled={createMut.isPending || !name.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {createMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Building2 className="h-3.5 w-3.5" />}
              Create organisation
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
