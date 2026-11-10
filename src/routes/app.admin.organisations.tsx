import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  createPlatformOrganisation,
  deletePlatformOrganisation,
  listPlatformOrganisations,
  setPlatformOrganisationStatus,
} from "@/lib/platform.organisations.functions";
import { toast } from "sonner";
import { Kpi, PageHeader } from "@/components/nw";
import { requireSectionAccess } from "@/lib/rbac";
import {
  Building2,
  CalendarDays,
  ChevronRight,
  Eye,
  Filter,
  Loader2,
  MapPin,
  Plus,
  Search,
  ShieldAlert,
  SquarePen,
  Trash2,
  Users,
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
  ["maritime_operator", "Maritime operator (ferries, barges, crew boats)"],
  ["port_facility", "Port facility (terminal, jetty, tank farm)"],
  ["authority", "Authority (regulator, police, navy)"],
  ["responder", "Responder (rescue, medical)"],
] as const;

const STATUS_OPTIONS = [
  ["active", "Active"],
  ["trial", "Trial"],
  ["past_due", "Past due"],
  ["suspended", "Suspended"],
] as const;

const TIER_OPTIONS = [
  ["basic", "Basic"],
  ["professional", "Standard"],
  ["enterprise", "Enterprise"],
  ["government", "Government"],
] as const;

type Tier = (typeof TIER_OPTIONS)[number][0];
type OrgStatus = (typeof STATUS_OPTIONS)[number][0];

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium" }).format(new Date(iso));
}

export const Route = createFileRoute("/app/admin/organisations")({
  head: () => ({ meta: [{ title: "Organisations · Lemtik Admin" }] }),
  beforeLoad: async ({ context }) => {
    const access = context.appAccess;
    requireSectionAccess(access, ["lemtik_admin"]);
    return { appAccess: access };
  },
  component: OrganisationsPage,
});

function OrganisationsPage() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isDetailRoute = pathname.startsWith("/app/admin/organisations/") && pathname !== "/app/admin/organisations";

  if (isDetailRoute) {
    return <Outlet />;
  }

  return <OrganisationsList />;
}

// app.admin.organisations.$id is a nested child route of this one — see the
// identical comment in app.users.tsx for why this split is required.
function OrganisationsList() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const loadOrgs = useServerFn(listPlatformOrganisations);
  const createOrg = useServerFn(createPlatformOrganisation);
  const setStatus = useServerFn(setPlatformOrganisationStatus);
  const deleteOrg = useServerFn(deletePlatformOrganisation);

  const { data, isLoading, error } = useQuery({
    queryKey: ["platform-organisations"],
    queryFn: () => loadOrgs(),
  });

  const [search, setSearch] = useState("");
  const [type, setType] = useState<string>("all");
  const [tier, setTier] = useState<string>("all");
  const [status, setStatusFilter] = useState<string>("all");
  const [step, setStep] = useState(1);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "",
    type: "estate",
    address: "",
    billing_contact_name: "",
    billing_contact_email: "",
    billing_contact_phone: "",
    subscription_tier: "basic" as Tier,
    subscription_status: "active" as OrgStatus,
    admin_email: "",
    admin_name: "",
    location_name: "Head Office",
    location_address: "",
    coord_x: "",
    coord_y: "",
    geofence: "[]",
  });

  const createMut = useMutation({
    mutationFn: () => {
      setCreating(true);
      return createOrg({
        data: {
          name: form.name,
          type: form.type as never,
          address: form.address || undefined,
          billing_contact_name: form.billing_contact_name || undefined,
          billing_contact_email: form.billing_contact_email || undefined,
          billing_contact_phone: form.billing_contact_phone || undefined,
          subscription_tier: form.subscription_tier,
          subscription_status: form.subscription_status,
          admin_email: form.admin_email,
          admin_name: form.admin_name || undefined,
          location_name: form.location_name,
          location_address: form.location_address || undefined,
          coord_x: form.coord_x ? Number(form.coord_x) : undefined,
          coord_y: form.coord_y ? Number(form.coord_y) : undefined,
          geofence: safeJson(form.geofence),
        },
      });
    },
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["platform-organisations"] });
      setCreating(false);
      nav({ to: `/app/admin/organisations/${res.org.id}` });
    },
    onError: () => setCreating(false),
  });

  const [pending, setPending] = useState<{ kind: "suspend" | "delete"; id: string; name: string } | null>(null);
  const suspendMut = useMutation({
    mutationFn: (organisation_id: string) => setStatus({ data: { organisation_id, subscription_status: "suspended" } }),
    onSuccess: () => {
      toast.success("Organisation suspended");
      setPending(null);
      qc.invalidateQueries({ queryKey: ["platform-organisations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (organisation_id: string) => deleteOrg({ data: { organisation_id } }),
    onSuccess: () => {
      toast.success("Organisation deleted");
      setPending(null);
      qc.invalidateQueries({ queryKey: ["platform-organisations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const organisations = data?.organisations ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return organisations.filter((org) => {
      const matchesSearch = !q || org.name.toLowerCase().includes(q);
      const matchesType = type === "all" || org.type === type;
      const matchesTier = tier === "all" || org.subscription_tier === tier;
      const matchesStatus = status === "all" || org.subscription_status === status;
      return matchesSearch && matchesType && matchesTier && matchesStatus;
    });
  }, [organisations, search, type, tier, status]);

  const totals = useMemo(() => ({
    total: organisations.length,
    active: organisations.filter((o) => o.subscription_status === "active").length,
    trial: organisations.filter((o) => o.subscription_status === "trial").length,
    overdue: organisations.filter((o) => o.subscription_status === "past_due").length,
  }), [organisations]);

  const steps = [
    { id: 1, title: "Organisation details" },
    { id: 2, title: "Subscription tier" },
    { id: 3, title: "Admin user" },
    { id: 4, title: "Location setup" },
    { id: 5, title: "Confirmation" },
  ];

  return (
    <div className="col g16">
      <PageHeader title="Organisations" sub="Create, inspect, suspend and remove client organisations." />

      <div className="kpis">
        <Kpi label="Organisations" value={data ? totals.total : "—"} />
        <Kpi label="Active" value={data ? totals.active : "—"} />
        <Kpi label="Trial" value={data ? totals.trial : "—"} />
        <Kpi label="Past due" value={data ? totals.overdue : "—"} />
      </div>

      <section className="rounded-[10px] border border-border bg-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Organisations table</div>
            <h2 className="text-lg font-semibold">All client organisations</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name" className="bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
            </div>
            <Select value={type} onChange={setType} options={[["all", "Type"], ...TYPE_OPTIONS]} icon={Filter} />
            <Select value={tier} onChange={setTier} options={[["all", "Tier"], ...TIER_OPTIONS]} icon={Filter} />
            <Select value={status} onChange={setStatusFilter} options={[["all", "Status"], ...STATUS_OPTIONS]} icon={Filter} />
          </div>
        </div>

        {isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading organisations…</div>
        ) : error ? (
          <div className="rounded-md border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical">{(error as Error).message}</div>
        ) : (
          <div className="overflow-x-auto rounded-[9px] border border-border">
            <table className="min-w-full text-sm">
              <thead className="bg-surface text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                <tr>
                  <Th>Name</Th>
                  <Th>Type</Th>
                  <Th>Tier</Th>
                  <Th>Status</Th>
                  <Th>Users</Th>
                  <Th>Incidents (30d)</Th>
                  <Th>Created</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {filtered.map((org) => (
                  <tr key={org.id} className="align-top">
                    <Td>
                      <div className="font-medium">{org.name}</div>
                      <div className="text-xs text-muted-foreground">{org.address ?? "No address set"}</div>
                    </Td>
                    <Td>{pretty(org.type)}</Td>
                    <Td>{TIER_LABELS[org.subscription_tier as Tier] ?? org.subscription_tier}</Td>
                    <Td><Badge status={org.subscription_status} /></Td>
                    <Td>{org.users}</Td>
                    <Td>{org.incidents30d}</Td>
                    <Td>{fmtDate(org.created_at)}</Td>
                    <Td>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link to="/app/admin/organisations/$id" params={{ id: org.id }} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-surface-2">
                          <Eye className="h-3.5 w-3.5" /> View
                        </Link>
                        <Link to="/app/admin/organisations/$id" params={{ id: org.id }} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-surface-2">
                          <SquarePen className="h-3.5 w-3.5" /> Edit
                        </Link>
                        <button
                          onClick={() => setPending({ kind: "suspend", id: org.id, name: org.name })}
                          disabled={suspendMut.isPending || org.subscription_status === "suspended"}
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-surface-2 disabled:opacity-50"
                        >
                          Suspend
                        </button>
                        <button
                          onClick={() => setPending({ kind: "delete", id: org.id, name: org.name })}
                          disabled={deleteMut.isPending}
                          className="inline-flex items-center gap-1 rounded-md border border-critical/30 px-2.5 py-1 text-xs text-critical hover:bg-critical/10 disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </button>
                      </div>
                    </Td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><Td colSpan={8}><div className="py-8 text-center text-sm text-muted-foreground">No organisations matched the current filters.</div></Td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-[10px] border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Create organisation</div>
              <h2 className="text-lg font-semibold">Step {step} of 5</h2>
            </div>
            <div className="hidden sm:flex items-center gap-1 text-[11px] text-muted-foreground">
              {steps.map((item) => (
                <span key={item.id} className={`rounded-full px-2 py-1 ${step === item.id ? "bg-primary/10 text-primary" : ""}`}>{item.id}</span>
              ))}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {steps.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setStep(item.id)}
                className={`rounded-full border px-3 py-1.5 text-xs ${step === item.id ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-surface-2"}`}
              >
                {item.title}
              </button>
            ))}
          </div>

          <div className="mt-4 space-y-4">
            {step === 1 && (
              <>
                <Field label="Organisation name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
                <SelectField label="Type" value={form.type} onChange={(v) => setForm({ ...form, type: v })} options={TYPE_OPTIONS} />
                <Field label="Address" value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
              </>
            )}
            {step === 2 && (
              <>
                <SelectField label="Subscription tier" value={form.subscription_tier} onChange={(v) => setForm({ ...form, subscription_tier: v as Tier })} options={TIER_OPTIONS} />
                <SelectField label="Initial status" value={form.subscription_status} onChange={(v) => setForm({ ...form, subscription_status: v as OrgStatus })} options={STATUS_OPTIONS} />
                <Field label="Billing contact name" value={form.billing_contact_name} onChange={(v) => setForm({ ...form, billing_contact_name: v })} />
                <Field label="Billing contact email" value={form.billing_contact_email} onChange={(v) => setForm({ ...form, billing_contact_email: v })} />
                <Field label="Billing contact phone" value={form.billing_contact_phone} onChange={(v) => setForm({ ...form, billing_contact_phone: v })} />
              </>
            )}
            {step === 3 && (
              <>
                <Field label="Admin email" value={form.admin_email} onChange={(v) => setForm({ ...form, admin_email: v })} />
                <Field label="Admin name" value={form.admin_name} onChange={(v) => setForm({ ...form, admin_name: v })} />
                <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
                  An invite will be generated for this address and sent through the transactional invite flow.
                </div>
              </>
            )}
            {step === 4 && (
              <>
                <Field label="First location name" value={form.location_name} onChange={(v) => setForm({ ...form, location_name: v })} />
                <Field label="Location address" value={form.location_address} onChange={(v) => setForm({ ...form, location_address: v })} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Latitude" value={form.coord_y} onChange={(v) => setForm({ ...form, coord_y: v })} />
                  <Field label="Longitude" value={form.coord_x} onChange={(v) => setForm({ ...form, coord_x: v })} />
                </div>
                <Field label="Geofence JSON" value={form.geofence} onChange={(v) => setForm({ ...form, geofence: v })} />
                <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
                  The geofence is stored as JSON and can be replaced with a map editor later without changing the schema.
                </div>
              </>
            )}
            {step === 5 && (
              <div className="space-y-3 rounded-[9px] border border-border bg-surface p-4 text-sm">
                <SummaryRow label="Organisation" value={form.name || "—"} />
                <SummaryRow label="Tier" value={TIER_LABELS[form.subscription_tier]} />
                <SummaryRow label="Admin invite" value={form.admin_email || "—"} />
                <SummaryRow label="First location" value={form.location_name || "—"} />
                <SummaryRow label="Status" value={form.subscription_status} />
                <div className="pt-1 text-xs text-muted-foreground">Creation seeds the organisation, location, invite, and billing profile from live data.</div>
              </div>
            )}
          </div>

          {createMut.error && (
            <div className="mt-4 rounded-md border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical">
              {(createMut.error as Error).message}
            </div>
          )}

          <div className="mt-4 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              disabled={step === 1}
              className="rounded-md border border-border px-3 py-2 text-xs hover:bg-surface-2 disabled:opacity-50"
            >
              Back
            </button>
            {step < 5 ? (
              <button
                type="button"
                onClick={() => setStep((s) => Math.min(5, s + 1))}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => createMut.mutate()}
                disabled={creating || createMut.isPending || !form.name || !form.admin_email}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {(creating || createMut.isPending) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Create organisation
              </button>
            )}
          </div>
        </div>

        <div className="rounded-[10px] border border-border bg-card p-5 space-y-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Create confirmation</div>
            <h3 className="text-lg font-semibold">What gets provisioned</h3>
          </div>
          <div className="rounded-[9px] border border-border bg-surface p-4 text-sm text-muted-foreground space-y-2">
            <div className="flex items-start gap-3">
              <MapPin className="mt-0.5 h-4 w-4 text-primary" />
              <div>
                <div className="font-medium text-foreground">First location</div>
                <div>Creates the initial location and stores its geofence data for downstream routing and patrol setup.</div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Users className="mt-0.5 h-4 w-4 text-primary" />
              <div>
                <div className="font-medium text-foreground">Client admin invite</div>
                <div>Generates the admin invitation record and sends the onboarding email flow to the specified address.</div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Building2 className="mt-0.5 h-4 w-4 text-primary" />
              <div>
                <div className="font-medium text-foreground">Live billing profile</div>
                <div>Seeds the organisation with the requested type, tier, subscription status, and contact details.</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {pending && (
        <div className="fixed inset-0 z-50 grid place-items-center px-4" style={{ background: "rgba(5,7,10,.72)" }} role="dialog" aria-modal="true" aria-label={pending.kind === "delete" ? "Delete organisation" : "Suspend organisation"}>
          <div className="pn w-full" style={{ maxWidth: 460, borderColor: "var(--line-2)" }}>
            <div className="pn-h">
              <h3 style={{ fontSize: 15 }}>
                {pending.kind === "delete" ? "Delete" : "Suspend"} {pending.name}?
              </h3>
            </div>
            <div className="pn-b col g12">
              <p className="t2" style={{ margin: 0 }}>
                {pending.kind === "delete"
                  ? "The organisation and its data are removed. This can't be undone."
                  : "Their staff, officers and guests lose access until you reactivate the subscription."}
              </p>
              <div className="row g8" style={{ justifyContent: "flex-end" }}>
                <button type="button" className="b b-gh" onClick={() => setPending(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="b b-red"
                  disabled={suspendMut.isPending || deleteMut.isPending}
                  onClick={() => (pending.kind === "delete" ? deleteMut.mutate(pending.id) : suspendMut.mutate(pending.id))}
                >
                  {(suspendMut.isPending || deleteMut.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}
                  {pending.kind === "delete" ? "Delete organisation" : "Suspend"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Badge({ status }: { status: string }) {
  const tone =
    status === "active" ? "border-resolved/30 bg-resolved/10 text-resolved" :
    status === "trial" ? "border-medium/30 bg-medium/10 text-medium" :
    status === "past_due" ? "border-high/30 bg-high/10 text-high" :
    "border-critical/30 bg-critical/10 text-critical";
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wider ${tone}`}>{pretty(status)}</span>;
}

function Stat({ label, value, icon: Icon, tone = "muted" }: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "muted" | "resolved" | "critical";
}) {
  const toneClass = tone === "resolved" ? "text-resolved" : tone === "critical" ? "text-critical" : "text-foreground";
  return (
    <div className="rounded-[9px] border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
        <Icon className={`h-4 w-4 ${toneClass}`} />
      </div>
      <div className={`mt-3 text-3xl font-semibold tracking-tight ${toneClass}`}>{value}</div>
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
  icon: Icon,
}: {
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<readonly [string, string]>;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <select value={value} onChange={(e) => onChange(e.target.value)} className="bg-transparent text-sm outline-none">
        {options.map(([v, label]) => (
          <option key={v} value={v}>{label}</option>
        ))}
      </select>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block space-y-1.5">
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <label className="block space-y-1.5">
      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none">
        {options.map(([v, label]) => (
          <option key={v} value={v}>{label}</option>
        ))}
      </select>
    </label>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 text-left font-medium">{children}</th>;
}

function Td({ children, colSpan }: { children: React.ReactNode; colSpan?: number }) {
  return <td colSpan={colSpan} className="px-4 py-3">{children}</td>;
}

function pretty(v: string) {
  return v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border pb-2 last:border-b-0 last:pb-0">
      <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

function safeJson(input: string) {
  try {
    return input ? JSON.parse(input) : null;
  } catch {
    return input;
  }
}
