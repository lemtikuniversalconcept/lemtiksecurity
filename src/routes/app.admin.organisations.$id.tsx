import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import {
  deletePlatformOrganisation,
  getPlatformOrganisation,
  setPlatformOrganisationStatus,
  updatePlatformOrganisation,
} from "@/lib/platform.organisations.functions";
import { requireSectionAccess } from "@/lib/rbac";
import {
  ArrowLeft,
  CalendarDays,
  Loader2,
  MapPin,
  ShieldAlert,
  Users,
  Trash2,
  PauseCircle,
  Save,
} from "lucide-react";

const TIER_LABELS = {
  basic: "Basic",
  professional: "Standard",
  enterprise: "Enterprise",
  government: "Government",
} as const;

const TYPE_OPTIONS = [
  ["estate", "Estate"],
  ["corporate", "Corporate"],
  ["hotel", "Hotel"],
  ["government", "Government"],
] as const;

const TIER_OPTIONS = [
  ["basic", "Basic"],
  ["professional", "Standard"],
  ["enterprise", "Enterprise"],
  ["government", "Government"],
] as const;

const STATUS_OPTIONS = [
  ["active", "Active"],
  ["trial", "Trial"],
  ["past_due", "Past due"],
  ["suspended", "Suspended"],
] as const;

export const Route = createFileRoute("/app/admin/organisations/$id")({
  head: () => ({ meta: [{ title: "Organisation · Lemtik Admin" }] }),
  beforeLoad: async ({ context }) => {
    const access = context.appAccess;
    requireSectionAccess(access, ["lemtik_admin"]);
    return { appAccess: access };
  },
  component: OrganisationDetail,
});

function OrganisationDetail() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const loadOrg = useServerFn(getPlatformOrganisation);
  const updateOrg = useServerFn(updatePlatformOrganisation);
  const suspendOrg = useServerFn(setPlatformOrganisationStatus);
  const deleteOrg = useServerFn(deletePlatformOrganisation);

  const { data, isLoading, error } = useQuery({
    queryKey: ["platform-organisation", id],
    queryFn: () => loadOrg({ data: { organisation_id: id } }),
  });

  const [form, setForm] = useState({
    name: "",
    type: "estate",
    address: "",
    billing_contact_name: "",
    billing_contact_email: "",
    billing_contact_phone: "",
    subscription_tier: "basic",
    subscription_status: "active",
    logo_url: "",
    coord_x: "",
    coord_y: "",
  });

  useEffect(() => {
    if (!data?.org) return;
    setForm({
      name: data.org.name ?? "",
      type: data.org.type ?? "estate",
      address: data.org.address ?? "",
      billing_contact_name: data.org.billing_contact_name ?? "",
      billing_contact_email: data.org.billing_contact_email ?? "",
      billing_contact_phone: data.org.billing_contact_phone ?? "",
      subscription_tier: data.org.subscription_tier ?? "basic",
      subscription_status: data.org.subscription_status ?? "active",
      logo_url: data.org.logo_url ?? "",
      coord_x: data.org.coord_x?.toString() ?? "",
      coord_y: data.org.coord_y?.toString() ?? "",
    });
  }, [data]);

  const saveMut = useMutation({
    mutationFn: () => updateOrg({
      data: {
        organisation_id: id,
        name: form.name,
        type: form.type as never,
        address: form.address || null,
        billing_contact_name: form.billing_contact_name || null,
        billing_contact_email: form.billing_contact_email || null,
        billing_contact_phone: form.billing_contact_phone || null,
        subscription_tier: form.subscription_tier as never,
        subscription_status: form.subscription_status as never,
        logo_url: form.logo_url || null,
        coord_x: form.coord_x ? Number(form.coord_x) : null,
        coord_y: form.coord_y ? Number(form.coord_y) : null,
      },
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["platform-organisation", id] }),
  });

  const suspendMut = useMutation({
    mutationFn: () => suspendOrg({ data: { organisation_id: id, subscription_status: "suspended" } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["platform-organisation", id] }),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteOrg({ data: { organisation_id: id } }),
    onSuccess: () => nav({ to: "/app/admin/organisations" }),
  });

  const metrics = useMemo(() => data?.metrics ?? null, [data]);
  const members = data?.members ?? [];
  const locations = data?.locations ?? [];
  const incidents = data?.incidents ?? [];
  const invites = data?.invites ?? [];
  const activity = data?.activity ?? [];
  const org = data?.org;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button onClick={() => nav({ to: "/app/admin/organisations" })} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to organisations
          </button>
          <h1 className="mt-2 text-2xl font-semibold">{org?.name ?? "Organisation"}</h1>
          <p className="text-sm text-muted-foreground">
            {org ? `${pretty(org.type)} · ${pretty(org.subscription_status)} · ${pretty(org.subscription_tier)}` : "Loading organisation profile"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => suspendMut.mutate()} disabled={suspendMut.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs hover:bg-surface-2 disabled:opacity-50">
            {suspendMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PauseCircle className="h-3.5 w-3.5" />} Suspend
          </button>
          <button
            onClick={() => {
              if (window.confirm(`Delete ${org?.name ?? "this organisation"}? This cannot be undone.`)) deleteMut.mutate();
            }}
            disabled={deleteMut.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-critical/30 px-3 py-2 text-xs text-critical hover:bg-critical/10 disabled:opacity-50"
          >
            {deleteMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Users" value={metrics ? metrics.users.toString() : "—"} icon={Users} />
        <Stat label="Locations" value={metrics ? metrics.locations.toString() : "—"} icon={MapPin} tone="resolved" />
        <Stat label="Incidents 30d" value={metrics ? metrics.incidents30d.toString() : "—"} icon={ShieldAlert} tone="critical" />
        <Stat label="MRR" value={metrics ? metrics.mrr : "—"} icon={CalendarDays} tone="resolved" />
      </div>

      {isLoading ? (
        <div className="rounded-3xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading organisation…
        </div>
      ) : error ? (
        <div className="rounded-md border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical">{(error as Error).message}</div>
      ) : (
        <>
          <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
            <div className="rounded-3xl border border-border bg-card p-5 space-y-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Profile overview</div>
                <h2 className="text-lg font-semibold">Edit organisation profile</h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
                <SelectField label="Type" value={form.type} onChange={(v) => setForm({ ...form, type: v })} options={TYPE_OPTIONS} />
                <Field label="Address" value={form.address} onChange={(v) => setForm({ ...form, address: v })} className="sm:col-span-2" />
                <Field label="Logo URL" value={form.logo_url} onChange={(v) => setForm({ ...form, logo_url: v })} className="sm:col-span-2" />
                <SelectField label="Subscription tier" value={form.subscription_tier} onChange={(v) => setForm({ ...form, subscription_tier: v })} options={TIER_OPTIONS} />
                <SelectField label="Subscription status" value={form.subscription_status} onChange={(v) => setForm({ ...form, subscription_status: v })} options={STATUS_OPTIONS} />
                <Field label="Billing contact name" value={form.billing_contact_name} onChange={(v) => setForm({ ...form, billing_contact_name: v })} />
                <Field label="Billing contact email" value={form.billing_contact_email} onChange={(v) => setForm({ ...form, billing_contact_email: v })} />
                <Field label="Billing contact phone" value={form.billing_contact_phone} onChange={(v) => setForm({ ...form, billing_contact_phone: v })} />
                <Field label="Latitude" value={form.coord_y} onChange={(v) => setForm({ ...form, coord_y: v })} />
                <Field label="Longitude" value={form.coord_x} onChange={(v) => setForm({ ...form, coord_x: v })} />
              </div>
              {saveMut.error && <div className="rounded-md border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical">{(saveMut.error as Error).message}</div>}
              <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {saveMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save changes
              </button>
            </div>

            <div className="rounded-3xl border border-border bg-card p-5 space-y-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Subscription</div>
                <h2 className="text-lg font-semibold">Billing snapshot</h2>
              </div>
              <InfoRow label="Tier" value={org ? TIER_LABELS[org.subscription_tier as keyof typeof TIER_LABELS] : "—"} />
              <InfoRow label="Status" value={org ? pretty(org.subscription_status) : "—"} />
              <InfoRow label="Billing contact" value={org?.billing_contact_email || "—"} />
              <InfoRow label="Created" value={org?.created_at ? new Intl.DateTimeFormat("en-NG", { dateStyle: "medium" }).format(new Date(org.created_at)) : "—"} />
              <div className="rounded-2xl border border-border bg-surface p-4">
                <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Billing history</div>
                <div className="mt-3 space-y-3">
                  {(data?.activity ?? []).slice(0, 5).map((entry) => (
                    <div key={entry.id} className="flex items-start justify-between gap-3 text-sm">
                      <div>
                        <div className="font-medium">{pretty(entry.label)}</div>
                        <div className="text-xs text-muted-foreground">{pretty(entry.detail)}</div>
                      </div>
                      <div className="text-xs text-muted-foreground">{fmtDate(entry.created_at)}</div>
                    </div>
                  ))}
                  {(data?.activity ?? []).length === 0 && <div className="text-sm text-muted-foreground">No billing or activity records yet.</div>}
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-3xl border border-border bg-card p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Users</div>
                  <h3 className="text-lg font-semibold">All organisation users</h3>
                </div>
                <span className="rounded-full border border-border px-2 py-1 text-[11px] uppercase tracking-wider text-muted-foreground">{members.length}</span>
              </div>
              <div className="mt-4 overflow-hidden rounded-2xl border border-border">
                <table className="min-w-full text-sm">
                  <thead className="bg-surface text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    <tr>
                      <Th>User</Th>
                      <Th>Role</Th>
                      <Th>Status</Th>
                      <Th>Assigned</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-card">
                    {members.map((member: any) => {
                      const profile = Array.isArray(member.profile) ? member.profile[0] : member.profile;
                      return (
                        <tr key={member.id}>
                          <Td>
                            <div className="font-medium">{profile?.display_name ?? member.user_id}</div>
                            <div className="text-xs text-muted-foreground">{profile?.employee_id ?? "No employee ID"}</div>
                          </Td>
                          <Td>{pretty(member.role)}</Td>
                          <Td>{profile?.is_active === false ? "Inactive" : pretty(profile?.status ?? "unknown")}</Td>
                          <Td>{Array.isArray(profile?.assigned_location_ids) ? profile.assigned_location_ids.length : 0}</Td>
                        </tr>
                      );
                    })}
                    {members.length === 0 && <tr><Td colSpan={4}><div className="py-8 text-center text-sm text-muted-foreground">No members yet.</div></Td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-3xl border border-border bg-card p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Locations</div>
                  <h3 className="text-lg font-semibold">Registered locations</h3>
                </div>
                <span className="rounded-full border border-border px-2 py-1 text-[11px] uppercase tracking-wider text-muted-foreground">{locations.length}</span>
              </div>
              <div className="mt-4 space-y-3">
                {locations.map((location: any) => (
                  <div key={location.id} className="rounded-2xl border border-border bg-surface p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium">{location.name}</div>
                        <div className="text-xs text-muted-foreground">{location.address ?? "No address"}</div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {location.coord_y ?? "—"}, {location.coord_x ?? "—"}
                      </div>
                    </div>
                    <div className="mt-3 text-xs text-muted-foreground">
                      Geofence: {location.geofence ? "configured" : "not set"}
                    </div>
                  </div>
                ))}
                {locations.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">No locations registered yet.</div>}
              </div>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
            <div className="rounded-3xl border border-border bg-card p-5">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Usage metrics</div>
              <h3 className="text-lg font-semibold">Platform usage snapshot</h3>
              <div className="mt-4 space-y-3">
                <InfoRow label="Incidents (30d)" value={data?.incidents.length.toString() ?? "0"} />
                <InfoRow label="Invites" value={invites.length.toString()} />
                <InfoRow label="Users" value={members.length.toString()} />
                <InfoRow label="Locations" value={locations.length.toString()} />
              </div>
            </div>

            <div className="rounded-3xl border border-border bg-card p-5">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Recent activity</div>
              <h3 className="text-lg font-semibold">Organisation timeline</h3>
              <div className="mt-4 space-y-3">
                {activity.map((entry: any) => (
                  <div key={entry.id} className="rounded-2xl border border-border bg-surface p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium">{pretty(entry.label)}</div>
                        <div className="text-xs text-muted-foreground">{pretty(entry.detail)}</div>
                      </div>
                      <div className="text-xs text-muted-foreground">{fmtDate(entry.created_at)}</div>
                    </div>
                  </div>
                ))}
                {activity.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">No recent activity found.</div>}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 text-left font-medium">{children}</th>;
}

function Td({ children, colSpan }: { children: React.ReactNode; colSpan?: number }) {
  return <td colSpan={colSpan} className="px-4 py-3">{children}</td>;
}

function pretty(v?: string | null) {
  if (!v) return "—";
  return v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <label className={`block space-y-1.5 ${className ?? ""}`}>
      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none" />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<readonly [string, string]>;
  className?: string;
}) {
  return (
    <label className={`block space-y-1.5 ${className ?? ""}`}>
      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none">
        {options.map(([v, label]) => (
          <option key={v} value={v}>{label}</option>
        ))}
      </select>
    </label>
  );
}

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium" }).format(new Date(iso));
}
