import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { listMyOrgs, createOrganisation, switchActiveOrg } from "@/lib/orgs.functions";
import { redeemMyInvites } from "@/lib/users.functions";
import { Loader2, Building, Building2, ChevronRight, Hotel, Landmark } from "lucide-react";
import { LemtikMark, Notice, initialsOf } from "@/components/nw";
import { normalizeRole, roleLabel } from "@/lib/rbac";

export const Route = createFileRoute("/onboarding")({
  head: () => ({ meta: [{ title: "Welcome · Lemtik SOD" }] }),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/login" });
  },
  component: Onboarding,
});

const ORG_TYPES = [
  { value: "estate", label: "Estate", icon: Building },
  { value: "hotel", label: "Hotel", icon: Hotel },
  { value: "corporate", label: "Corporate", icon: Building2 },
  { value: "government", label: "Government", icon: Landmark },
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
  const [type, setType] = useState<typeof ORG_TYPES[number]["value"]>("estate");
  const [address, setAddress] = useState("");

  const createMut = useMutation({
    mutationFn: () => createOrg({ data: { name, type, address: address || undefined } }),
    onSuccess: () => navigate({ to: "/app" }),
  });

  const switchMut = useMutation({
    mutationFn: (id: string) => switchOrg({ data: { organisation_id: id } }),
    onSuccess: () => navigate({ to: "/app" }),
  });

  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login", search: { redirect: undefined }, replace: true });
  };

  const hasOrgs = orgs.length > 0;

  return (
    <div className="flex min-h-screen flex-col" style={{ background: "var(--ink-0)" }}>
      <header className="row g10" style={{ padding: "20px 32px" }}>
        <LemtikMark />
        <b style={{ fontStretch: "122%", letterSpacing: ".14em", fontSize: 13 }}>LEMTIK</b>
        <span className="flex-auto" />
        {email ? <span className="t3 max-[560px]:hidden" style={{ fontSize: 12.5 }}>{email}</span> : null}
        <button type="button" onClick={signOut} className="b b-sm b-gh">
          Sign out
        </button>
      </header>

      <main className="col g20 w-full" style={{ maxWidth: 640, margin: "24px auto 48px", padding: "0 24px" }}>
        <div className="col g6">
          <h1 style={{ fontSize: 26, fontWeight: 650, fontStretch: "110%", lineHeight: 1.2 }}>
            {hasOrgs ? "Choose where you’re working" : "Set up your organisation"}
          </h1>
          <p className="t2" style={{ fontSize: 14 }}>
            {isLoading
              ? "Checking your organisations…"
              : hasOrgs
                ? `You belong to ${orgs.length} organisation${orgs.length === 1 ? "" : "s"}. You can switch any time from the sidebar.`
                : "You’re not part of an organisation yet. If you were invited, ask your manager to resend the invite — or create one below."}
          </p>
        </div>

        {isLoading ? (
          <div className="card row g8 t2" style={{ padding: "14px 16px" }}>
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : hasOrgs ? (
          <div className="col g8">
            {orgs.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => switchMut.mutate(o.id)}
                disabled={switchMut.isPending}
                className="card row g12 w-full text-left hover:border-line-2 hover:bg-ink-3"
                style={{ padding: "14px 16px" }}
              >
                <span className="grid place-items-center" style={{ width: 36, height: 36, borderRadius: 8, fontWeight: 700, fontSize: 13, background: "#1E3A2F", color: "#7FE0AE", flex: "none" }}>
                  {initialsOf(o.name)}
                </span>
                <span className="f1 col">
                  <b style={{ fontSize: 14 }} className="trunc">{o.name}</b>
                  <span className="t3" style={{ fontSize: 12.5 }}>{ORG_TYPES.find((t) => t.value === o.type)?.label ?? o.type}</span>
                </span>
                <span className="tg">{roleLabel(normalizeRole(o.role))}</span>
                {switchMut.isPending && switchMut.variables === o.id ? (
                  <Loader2 className="h-4 w-4 animate-spin t3" />
                ) : (
                  <ChevronRight size={16} strokeWidth={1.75} className="ic t3" />
                )}
              </button>
            ))}
          </div>
        ) : null}

        {hasOrgs && (
          <div className="row g10 t3" style={{ fontSize: 12 }}>
            <span className="hr f1" />
            or set up a new one
            <span className="hr f1" />
          </div>
        )}

        <section className="pn">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createMut.mutate();
            }}
            className="col g16"
            style={{ padding: 18 }}
          >
            <div className="col g4">
              <b style={{ fontSize: 15 }}>Create an organisation</b>
              <span className="t3" style={{ fontSize: 12.5 }}>You’ll be its client admin. Add sites, people and cameras next.</span>
            </div>
            <div className="fl">
              <label htmlFor="org-name">Organisation name</label>
              <input
                id="org-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={120}
                placeholder="e.g. Lekki Gardens Residents Association"
                className="in"
                style={{ height: 40 }}
              />
            </div>
            <div className="fl">
              <span className="lbl" id="org-type-label">Type</span>
              <div className="row g6 wrap" role="radiogroup" aria-labelledby="org-type-label">
                {ORG_TYPES.map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      role="radio"
                      aria-checked={type === t.value}
                      className={`chip${type === t.value ? " on" : ""}`}
                      onClick={() => setType(t.value)}
                    >
                      <Icon size={13} strokeWidth={1.75} className="ic" />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="fl">
              <label htmlFor="org-address">
                Primary address <span className="t3">· optional</span>
              </label>
              <input
                id="org-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                maxLength={300}
                placeholder="Street, city"
                className="in"
                style={{ height: 40 }}
              />
            </div>
            {createMut.error && <Notice tone="fail">{(createMut.error as Error).message}</Notice>}
            <div className="row g8">
              <span className="flex-auto" />
              <button type="submit" disabled={createMut.isPending || !name.trim()} className="b b-pri b-lg">
                {createMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Create organisation
              </button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
