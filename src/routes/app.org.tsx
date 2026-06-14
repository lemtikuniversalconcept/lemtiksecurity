import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import {
  getActiveOrg, updateOrganisation,
  listEmergencyContacts, upsertEmergencyContact, deleteEmergencyContact,
  getSettings, updateSettings,
} from "@/lib/orgs.functions";
import { Loader2, Save, Plus, X, Building2, Activity, ShieldAlert, Mail } from "lucide-react";

export const Route = createFileRoute("/app/org")({
  head: () => ({ meta: [{ title: "Organisation · Lemtik SOD" }] }),
  component: OrgSettings,
});

function OrgSettings() {
  const getOrg = useServerFn(getActiveOrg);
  const updateOrg = useServerFn(updateOrganisation);
  const listContacts = useServerFn(listEmergencyContacts);
  const upsertContact = useServerFn(upsertEmergencyContact);
  const deleteContact = useServerFn(deleteEmergencyContact);
  const getSet = useServerFn(getSettings);
  const updSet = useServerFn(updateSettings);
  const qc = useQueryClient();

  const { data: org, isLoading } = useQuery({ queryKey: ["active-org"], queryFn: () => getOrg() });
  const { data: contacts = [] } = useQuery({ queryKey: ["org-contacts"], queryFn: () => listContacts() });
  const { data: settings } = useQuery({ queryKey: ["org-settings"], queryFn: () => getSet() });
  const health = useMemo(() => {
    const configuredContacts = contacts.length;
    const alertsConfigured = (settings?.whatsapp_alert_numbers ?? []).length + (settings?.default_incident_categories ?? []).length;
    const webhookOn = !!settings?.webhook_url;
    const completeness = Math.min(100, configuredContacts * 18 + alertsConfigured * 8 + (webhookOn ? 20 : 0));
    return { configuredContacts, alertsConfigured, webhookOn, completeness };
  }, [contacts, settings]);

  const [profile, setProfile] = useState<Record<string, string>>({});
  useEffect(() => {
    if (org) setProfile({
      name: org.name ?? "", type: org.type ?? "corporate",
      address: org.address ?? "",
      billing_contact_name: org.billing_contact_name ?? "",
      billing_contact_email: org.billing_contact_email ?? "",
      billing_contact_phone: org.billing_contact_phone ?? "",
      brand_primary_color: org.brand_primary_color ?? "#3b82f6",
      brand_secondary_color: org.brand_secondary_color ?? "#10b981",
      logo_url: org.logo_url ?? "",
    });

  }, [org]);

  const orgMut = useMutation({
    mutationFn: () => updateOrg({ data: {
      name: profile.name, type: profile.type as never, address: profile.address || null,
      billing_contact_name: profile.billing_contact_name || null,
      billing_contact_email: profile.billing_contact_email || null,
      billing_contact_phone: profile.billing_contact_phone || null,
      brand_primary_color: profile.brand_primary_color || null,
      brand_secondary_color: profile.brand_secondary_color || null,
      logo_url: profile.logo_url || null,
    }}),

    onSuccess: () => qc.invalidateQueries({ queryKey: ["active-org"] }),
  });

  const [newContact, setNewContact] = useState({ label: "", name: "", phone: "", notes: "" });
  const contactMut = useMutation({
    mutationFn: (d: typeof newContact) => upsertContact({ data: { ...d, name: d.name || undefined, notes: d.notes || undefined } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["org-contacts"] }); setNewContact({ label: "", name: "", phone: "", notes: "" }); },
  });
  const delContactMut = useMutation({
    mutationFn: (id: string) => deleteContact({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org-contacts"] }),
  });

  // settings state
  const [setForm, setSetForm] = useState<{ schedule: string; whatsapp: string; webhook_url: string; webhook_secret: string; categories: string }>({
    schedule: "", whatsapp: "", webhook_url: "", webhook_secret: "", categories: "",
  });
  useEffect(() => {
    if (settings) setSetForm({
      schedule: settings.report_delivery_schedule ?? "",
      whatsapp: (settings.whatsapp_alert_numbers ?? []).join(", "),
      webhook_url: settings.webhook_url ?? "",
      webhook_secret: settings.webhook_secret ?? "",
      categories: (settings.default_incident_categories ?? []).join(", "),
    });
  }, [settings]);
  const setMut = useMutation({
    mutationFn: () => updSet({ data: {
      report_delivery_schedule: setForm.schedule || null,
      whatsapp_alert_numbers: setForm.whatsapp.split(",").map((s) => s.trim()).filter(Boolean),
      webhook_url: setForm.webhook_url || null,
      webhook_secret: setForm.webhook_secret || null,
      default_incident_categories: setForm.categories.split(",").map((s) => s.trim()).filter(Boolean),
    }}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org-settings"] }),
  });

  if (isLoading) {
    return <div className="p-10 text-center text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…</div>;
  }

  if (!org) {
    return <div className="p-6 text-sm text-muted-foreground">No active organisation.</div>;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Building2 className="h-5 w-5 text-primary" />
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Organisation</div>
          <h1 className="text-2xl font-semibold">{org.name}</h1>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <Metric label="Contacts" value={health.configuredContacts.toString()} icon={Mail} />
        <Metric label="Alert rules" value={health.alertsConfigured.toString()} icon={Activity} tone="resolved" />
        <Metric label="Webhook" value={health.webhookOn ? "armed" : "off"} icon={ShieldAlert} tone={health.webhookOn ? "resolved" : "critical"} />
        <Metric label="Health score" value={`${health.completeness}%`} icon={Building2} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_0.9fr] gap-4">
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Configuration health</div>
              <h2 className="text-sm font-semibold">Organisation readiness</h2>
            </div>
            <span className="rounded-md border border-border bg-surface px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              {health.completeness}%
            </span>
          </div>
          <div className="mt-4 h-28 rounded-lg border border-border bg-surface p-3">
            <div className="flex h-full items-end gap-2">
              <div className="flex-1">
                <div className="rounded-t bg-resolved/80" style={{ height: `${Math.max(10, health.configuredContacts * 16)}%` }} />
                <div className="mt-1 text-[10px] text-center text-muted-foreground">Contacts</div>
              </div>
              <div className="flex-1">
                <div className="rounded-t bg-primary/70" style={{ height: `${Math.max(10, health.alertsConfigured * 8)}%` }} />
                <div className="mt-1 text-[10px] text-center text-muted-foreground">Rules</div>
              </div>
              <div className="flex-1">
                <div className="rounded-t bg-critical/70" style={{ height: `${health.webhookOn ? 78 : 18}%` }} />
                <div className="mt-1 text-[10px] text-center text-muted-foreground">Webhook</div>
              </div>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-5 space-y-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Readiness notes</div>
            <h3 className="text-sm font-semibold">Live profile checks</h3>
          </div>
          <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
            {health.configuredContacts} emergency contact{health.configuredContacts === 1 ? "" : "s"} configured.
          </div>
          <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
            {settings?.report_delivery_schedule ? `Reports scheduled: ${settings.report_delivery_schedule}.` : "No report delivery schedule set."}
          </div>
          <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
            {health.webhookOn ? "Webhook integration is live." : "Webhook integration is currently disabled."}
          </div>
        </div>
      </div>

      {/* Profile */}
      <section className="rounded-lg border border-border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Profile</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" value={profile.name ?? ""} onChange={(v) => setProfile((p) => ({ ...p, name: v }))} />
          <SelectField label="Type" value={profile.type ?? ""} onChange={(v) => setProfile((p) => ({ ...p, type: v }))}
            options={[["estate","Estate"],["corporate","Corporate"],["hotel","Hotel"],["government","Government"]]} />
          <Field label="Primary address" value={profile.address ?? ""} onChange={(v) => setProfile((p) => ({ ...p, address: v }))} className="col-span-2" />
          <Field label="Logo URL" value={profile.logo_url ?? ""} onChange={(v) => setProfile((p) => ({ ...p, logo_url: v }))} className="col-span-2" />
          <div className="col-span-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Subscription: <span className="font-medium text-foreground">{org.subscription_tier}</span> · <span className="font-medium text-foreground">{org.subscription_status}</span>
            <span className="ml-2 opacity-70">(managed by billing — contact support to change)</span>
          </div>

          <Field label="Billing contact name" value={profile.billing_contact_name ?? ""} onChange={(v) => setProfile((p) => ({ ...p, billing_contact_name: v }))} />
          <Field label="Billing email" value={profile.billing_contact_email ?? ""} onChange={(v) => setProfile((p) => ({ ...p, billing_contact_email: v }))} />
          <Field label="Billing phone" value={profile.billing_contact_phone ?? ""} onChange={(v) => setProfile((p) => ({ ...p, billing_contact_phone: v }))} />
          <ColorField label="Brand primary" value={profile.brand_primary_color ?? "#3b82f6"} onChange={(v) => setProfile((p) => ({ ...p, brand_primary_color: v }))} />
          <ColorField label="Brand secondary" value={profile.brand_secondary_color ?? "#10b981"} onChange={(v) => setProfile((p) => ({ ...p, brand_secondary_color: v }))} />
        </div>
        {orgMut.error && <ErrText>{(orgMut.error as Error).message}</ErrText>}
        <button onClick={() => orgMut.mutate()} disabled={orgMut.isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {orgMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save profile
        </button>
      </section>

      {/* Emergency contacts */}
      <section className="rounded-lg border border-border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Emergency contacts</h2>
        <ul className="divide-y divide-border">
          {contacts.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <div className="font-medium">{c.label} {c.name ? <span className="text-muted-foreground">· {c.name}</span> : null}</div>
                <div className="text-xs text-muted-foreground font-mono">{c.phone}{c.notes ? ` · ${c.notes}` : ""}</div>
              </div>
              <button onClick={() => delContactMut.mutate(c.id)} className="text-muted-foreground hover:text-critical"><X className="h-4 w-4" /></button>
            </li>
          ))}
          {contacts.length === 0 && <li className="py-2 text-xs text-muted-foreground">No contacts yet.</li>}
        </ul>
        <div className="grid grid-cols-4 gap-2">
          <input placeholder="Label (Police)" value={newContact.label} onChange={(e) => setNewContact({ ...newContact, label: e.target.value })} className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm" />
          <input placeholder="Name" value={newContact.name} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })} className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm" />
          <input placeholder="Phone" value={newContact.phone} onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })} className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm" />
          <button onClick={() => contactMut.mutate(newContact)} disabled={!newContact.label || !newContact.phone || contactMut.isPending}
            className="inline-flex items-center justify-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>
        {contactMut.error && <ErrText>{(contactMut.error as Error).message}</ErrText>}
      </section>

      {/* Settings */}
      <section className="rounded-lg border border-border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Alerts, reports & integrations</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Report delivery schedule" value={setForm.schedule} onChange={(v) => setSetForm({ ...setForm, schedule: v })} placeholder="e.g. weekly Mondays 09:00" />
          <Field label="WhatsApp alert numbers" value={setForm.whatsapp} onChange={(v) => setSetForm({ ...setForm, whatsapp: v })} placeholder="+234..., +234..." />
          <Field label="Default incident categories" value={setForm.categories} onChange={(v) => setSetForm({ ...setForm, categories: v })} placeholder="intrusion, theft, fire" className="col-span-2" />
          <Field label="Integration webhook URL" value={setForm.webhook_url} onChange={(v) => setSetForm({ ...setForm, webhook_url: v })} className="col-span-2" />
          <Field label="Webhook secret" value={setForm.webhook_secret} onChange={(v) => setSetForm({ ...setForm, webhook_secret: v })} className="col-span-2" />
        </div>
        {setMut.error && <ErrText>{(setMut.error as Error).message}</ErrText>}
        <button onClick={() => setMut.mutate()} disabled={setMut.isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {setMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save settings
        </button>
      </section>
    </div>
  );
}

function Metric({ label, value, icon: Icon, tone = "muted" }: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "muted" | "critical" | "resolved";
}) {
  const toneClass = tone === "critical"
    ? "text-critical bg-critical/10 border-critical/30"
    : tone === "resolved"
      ? "text-resolved bg-resolved/10 border-resolved/30"
      : "text-muted-foreground bg-surface border-border";
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={`grid h-7 w-7 place-items-center rounded-md border ${toneClass}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function Field({ label, value, onChange, className = "", placeholder }: { label: string; value: string; onChange: (v: string) => void; className?: string; placeholder?: string }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
    </div>
  );
}
function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</label>
      <div className="flex items-center gap-2">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-12 rounded-md border border-border bg-surface" />
        <input value={value} onChange={(e) => onChange(e.target.value)} className="flex-1 rounded-md border border-border bg-surface px-3 py-2 text-xs font-mono" />
      </div>
    </div>
  );
}
function ErrText({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical">{children}</div>;
}
