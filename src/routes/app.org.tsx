import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  getActiveOrg, updateOrganisation,
  listEmergencyContacts, upsertEmergencyContact, deleteEmergencyContact, listLocations,
  getSettings, updateSettings,
} from "@/lib/orgs.functions";
import { issueConsumerSession } from "@/lib/consumer.functions";
import { requireSectionAccess } from "@/lib/rbac";
import { Loader2, Save, Plus, X, MapPin } from "lucide-react";
import { Empty, Notice, PageHeader, Panel, Tabs, Tag } from "@/components/nw";

export const Route = createFileRoute("/app/org")({
  head: () => ({ meta: [{ title: "Organisation · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    requireSectionAccess(context.appAccess, [
      "security_manager",
      "client_admin",
    ]);
  },
  component: OrgSettings,
});

function OrgSettings() {
  const getOrg = useServerFn(getActiveOrg);
  const updateOrg = useServerFn(updateOrganisation);
  const listContacts = useServerFn(listEmergencyContacts);
  const listLoc = useServerFn(listLocations);
  const upsertContact = useServerFn(upsertEmergencyContact);
  const deleteContact = useServerFn(deleteEmergencyContact);
  const getSet = useServerFn(getSettings);
  const updSet = useServerFn(updateSettings);
  const qc = useQueryClient();

  const { data: org, isLoading } = useQuery({ queryKey: ["active-org"], queryFn: () => getOrg() });
  const { data: contacts = [] } = useQuery({ queryKey: ["org-contacts"], queryFn: () => listContacts() });
  const { data: locations = [] } = useQuery({ queryKey: ["org-locations"], queryFn: () => listLoc() });
  const { data: settings } = useQuery({ queryKey: ["org-settings"], queryFn: () => getSet() });
  const [activeTab, setActiveTab] = useState<"profile" | "locations" | "alerts" | "thresholds" | "devices" | "integrations" | "subscription">("profile");

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
  const [thresholdForm, setThresholdForm] = useState({
    officers_min_total: "",
    officers_min_armed: "",
    vehicles_min_total: "",
    vehicles_min_fuelled: "",
    fuel_reserve_min: "",
    equipment_thresholds: "",
  });
  const [devicesForm, setDevicesForm] = useState("");
  const [automationMode, setAutomationMode] = useState(1);
  const [integrationForm, setIntegrationForm] = useState({
    resend_sender: "",
    termii_sender_id: "",
    twilio_whatsapp_number: "",
    api_key_label: "",
  });
  useEffect(() => {
    if (settings) setSetForm({
      schedule: settings.report_delivery_schedule ?? "",
      whatsapp: (settings.whatsapp_alert_numbers ?? []).join(", "),
      webhook_url: settings.webhook_url ?? "",
      webhook_secret: settings.webhook_secret ?? "",
      categories: (settings.default_incident_categories ?? []).join(", "),
    });
    const thresholds = (settings as any)?.threshold_config ?? {};
    setThresholdForm({
      officers_min_total: String(thresholds.officers_min_total ?? ""),
      officers_min_armed: String(thresholds.officers_min_armed ?? ""),
      vehicles_min_total: String(thresholds.vehicles_min_total ?? ""),
      vehicles_min_fuelled: String(thresholds.vehicles_min_fuelled ?? ""),
      fuel_reserve_min: String(thresholds.fuel_reserve_min ?? ""),
      equipment_thresholds: Array.isArray(thresholds.equipment_thresholds) ? thresholds.equipment_thresholds.map((item: any) => `${item.label ?? ""}:${item.minimum ?? ""}`).join(", ") : "",
    });
    const devices = (settings as any)?.smart_devices ?? [];
    setDevicesForm(JSON.stringify(devices, null, 2));
    setAutomationMode(Number((settings as any)?.automation_mode ?? 1));
    const integrations = (settings as any)?.integration_config ?? {};
    setIntegrationForm({
      resend_sender: String(integrations.resend_sender ?? ""),
      termii_sender_id: String(integrations.termii_sender_id ?? ""),
      twilio_whatsapp_number: String(integrations.twilio_whatsapp_number ?? ""),
      api_key_label: String(integrations.api_key_label ?? ""),
    });
  }, [settings]);
  const setMut = useMutation({
    mutationFn: () => updSet({ data: {
      report_delivery_schedule: setForm.schedule || null,
      whatsapp_alert_numbers: setForm.whatsapp.split(",").map((s) => s.trim()).filter(Boolean),
      webhook_url: setForm.webhook_url || null,
      webhook_secret: setForm.webhook_secret || null,
      default_incident_categories: setForm.categories.split(",").map((s) => s.trim()).filter(Boolean),
      threshold_config: {
        officers_min_total: toNumberOrNull(thresholdForm.officers_min_total),
        officers_min_armed: toNumberOrNull(thresholdForm.officers_min_armed),
        vehicles_min_total: toNumberOrNull(thresholdForm.vehicles_min_total),
        vehicles_min_fuelled: toNumberOrNull(thresholdForm.vehicles_min_fuelled),
        fuel_reserve_min: toNumberOrNull(thresholdForm.fuel_reserve_min),
        equipment_thresholds: parseEquipmentThresholds(thresholdForm.equipment_thresholds),
      },
      smart_devices: parseSmartDevices(devicesForm),
      automation_mode: automationMode,
      integration_config: {
        resend_sender: integrationForm.resend_sender || null,
        termii_sender_id: integrationForm.termii_sender_id || null,
        twilio_whatsapp_number: integrationForm.twilio_whatsapp_number || null,
        api_key_label: integrationForm.api_key_label || null,
      },
    }}),
    onSuccess: () => {
      toast.success("Settings saved");
      qc.invalidateQueries({ queryKey: ["org-settings"] });
    },
    onError: (err: unknown) => {
      toast.error("Failed to save settings", { description: err instanceof Error ? err.message : "Unknown error." });
    },
  });

  if (isLoading) {
    return (
      <Panel>
        <Empty>
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
        </Empty>
      </Panel>
    );
  }

  if (!org) {
    return (
      <Panel>
        <Empty>No active organisation.</Empty>
      </Panel>
    );
  }

  const settingsTabs = ["alerts", "thresholds", "devices", "integrations"] as const;
  const onSettingsTab = (settingsTabs as readonly string[]).includes(activeTab);
  const devicesJsonError = devicesJsonProblem(devicesForm);
  const typeLabel: Record<string, string> = { estate: "Estate", corporate: "Corporate", hotel: "Hotel", government: "Government" };

  return (
    <div className="col g16">
      <PageHeader title="Organisation" sub={`${org.name} · ${typeLabel[org.type] ?? org.type}${org.address ? ` · ${org.address}` : ""} · plan: ${org.subscription_tier ?? "—"}`}>
        {activeTab === "profile" && (
          <button type="button" className="b b-pri" onClick={() => orgMut.mutate()} disabled={orgMut.isPending}>
            {orgMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save profile
          </button>
        )}
        {onSettingsTab && (
          <button type="button" className="b b-pri" onClick={() => setMut.mutate()} disabled={setMut.isPending || !!devicesJsonError} title={devicesJsonError ?? undefined}>
            {setMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save changes
          </button>
        )}
      </PageHeader>

      <Tabs
        label="Organisation settings"
        value={activeTab}
        onChange={setActiveTab}
        tabs={[
          { value: "profile", label: "Profile" },
          { value: "locations", label: "Sites & guest access", count: locations.length },
          { value: "alerts", label: "Alerts" },
          { value: "thresholds", label: "Thresholds" },
          { value: "devices", label: "AI & automation" },
          { value: "integrations", label: "Integrations" },
          { value: "subscription", label: "Subscription" },
        ]}
      />

      {activeTab === "profile" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]" style={{ alignItems: "start" }}>
          <Panel title="Profile">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" value={profile.name ?? ""} onChange={(v) => setProfile((p) => ({ ...p, name: v }))} />
              <label className="fl">
                <span className="lbl">Type</span>
                <select className="in" value={profile.type ?? ""} onChange={(e) => setProfile((p) => ({ ...p, type: e.target.value }))}>
                  {Object.entries(typeLabel).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <Field label="Primary address" value={profile.address ?? ""} onChange={(v) => setProfile((p) => ({ ...p, address: v }))} className="sm:col-span-2" />
              <Field label="Logo URL" value={profile.logo_url ?? ""} onChange={(v) => setProfile((p) => ({ ...p, logo_url: v }))} className="sm:col-span-2" mono />
              <Field label="Billing contact name" value={profile.billing_contact_name ?? ""} onChange={(v) => setProfile((p) => ({ ...p, billing_contact_name: v }))} />
              <Field label="Billing email" value={profile.billing_contact_email ?? ""} onChange={(v) => setProfile((p) => ({ ...p, billing_contact_email: v }))} />
              <Field label="Billing phone" value={profile.billing_contact_phone ?? ""} onChange={(v) => setProfile((p) => ({ ...p, billing_contact_phone: v }))} mono />
              <div />
              <ColorField label="Brand primary" value={profile.brand_primary_color ?? "#3b82f6"} onChange={(v) => setProfile((p) => ({ ...p, brand_primary_color: v }))} />
              <ColorField label="Brand secondary" value={profile.brand_secondary_color ?? "#10b981"} onChange={(v) => setProfile((p) => ({ ...p, brand_secondary_color: v }))} />
            </div>
            {orgMut.error && (
              <div style={{ marginTop: 12 }}>
                <Notice tone="fail">{(orgMut.error as Error).message}</Notice>
              </div>
            )}
            {orgMut.isSuccess && !orgMut.isPending && (
              <div style={{ marginTop: 12 }}>
                <Notice tone="ok">Profile saved.</Notice>
              </div>
            )}
          </Panel>

          <Panel title="Emergency contacts" meta={`${contacts.length}`} bodyClassName="">
            {contacts.length === 0 ? (
              <Empty>No emergency contacts yet. Officers and guests see these when they need help.</Empty>
            ) : (
              <div className="list">
                {contacts.map((c) => (
                  <div key={c.id} className="row g10" style={{ padding: "9px 14px" }}>
                    <span className="f1 col" style={{ minWidth: 0 }}>
                      <b className="trunc">
                        {c.label}
                        {c.name ? <span className="t3"> · {c.name}</span> : null}
                      </b>
                      <span className="mono t3" style={{ fontSize: 12 }}>
                        {c.phone}
                        {c.notes ? ` · ${c.notes}` : ""}
                      </span>
                    </span>
                    <button type="button" className="ibtn" style={{ width: 28, height: 28 }} aria-label={`Remove ${c.label}`} disabled={delContactMut.isPending} onClick={() => delContactMut.mutate(c.id)}>
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="pn-b col g8" style={{ borderTop: "1px solid var(--line-1)" }}>
              <div className="grid grid-cols-2 gap-2">
                <input className="in" placeholder="Label (e.g. Police)" aria-label="Label" value={newContact.label} onChange={(e) => setNewContact({ ...newContact, label: e.target.value })} />
                <input className="in" placeholder="Name (optional)" aria-label="Name" value={newContact.name} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })} />
                <input className="in mono" placeholder="Phone" aria-label="Phone" value={newContact.phone} onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })} />
                <button type="button" className="b b-sec" onClick={() => contactMut.mutate(newContact)} disabled={!newContact.label || !newContact.phone || contactMut.isPending}>
                  <Plus className="h-4 w-4" /> Add contact
                </button>
              </div>
              {contactMut.error && <Notice tone="fail">{(contactMut.error as Error).message}</Notice>}
            </div>
          </Panel>
        </div>
      )}

      {activeTab === "locations" && (
        <>
          <Panel
            title="Sites"
            meta={`${locations.length} · ${locations.filter((l: any) => l.coord_x != null && l.coord_y != null).length} on the map · ${locations.filter((l: any) => !!l.geofence).length} with a geofence`}
            actions={
              <Link to="/app/locations" className="b b-sm b-sec">
                <MapPin className="h-3.5 w-3.5" /> Manage sites
              </Link>
            }
            bodyClassName=""
          >
            {locations.length === 0 ? (
              <Empty>No sites yet.</Empty>
            ) : (
              <div className="scroll">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Address</th>
                      <th>Coordinates</th>
                      <th>Geofence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {locations.map((l: any) => (
                      <tr key={l.id}>
                        <td>
                          <b>{l.name}</b>
                        </td>
                        <td className="t2">{l.address ?? "—"}</td>
                        <td className="mono t2">{l.coord_x != null && l.coord_y != null ? `${Number(l.coord_y).toFixed(4)}, ${Number(l.coord_x).toFixed(4)}` : "—"}</td>
                        <td>{l.geofence ? <Tag tone="ok">Set</Tag> : <span className="t3">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          <GuestAccessCard locations={locations} />
        </>
      )}

      {activeTab === "alerts" && (
        <Panel title="Alert delivery">
          <div className="col g12" style={{ maxWidth: 640 }}>
            <Field label="WhatsApp alert numbers (comma separated)" value={setForm.whatsapp} onChange={(v) => setSetForm({ ...setForm, whatsapp: v })} placeholder="+234…, +234…" mono />
            <Field label="Default incident categories (comma separated)" value={setForm.categories} onChange={(v) => setSetForm({ ...setForm, categories: v })} placeholder="intrusion, theft, fire" />
            <div className="fl">
              <span className="lbl">Escalation contacts</span>
              {((settings as any)?.alert_escalation_contacts ?? []).length === 0 ? (
                <span className="t3" style={{ fontSize: 12.5 }}>
                  None set.
                </span>
              ) : (
                <div className="list card">
                  {((settings as any)?.alert_escalation_contacts ?? []).map((c: any, i: number) => (
                    <div key={i} className="row g10" style={{ padding: "8px 12px", fontSize: 12.5 }}>
                      <span className="tg">Level {c.level}</span>
                      <span className="f1">{c.name}</span>
                      <span className="mono t2">{c.phone}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Panel>
      )}

      {activeTab === "thresholds" && (
        <Panel title="Minimum levels" meta="Inventory raises an alert when anything drops below these">
          <div className="grid gap-3 sm:grid-cols-2" style={{ maxWidth: 720 }}>
            <Field label="Officers on the roster" value={thresholdForm.officers_min_total} onChange={(v) => setThresholdForm((p) => ({ ...p, officers_min_total: v }))} mono />
            <Field label="Armed officers" value={thresholdForm.officers_min_armed} onChange={(v) => setThresholdForm((p) => ({ ...p, officers_min_armed: v }))} mono />
            <Field label="Vehicles" value={thresholdForm.vehicles_min_total} onChange={(v) => setThresholdForm((p) => ({ ...p, vehicles_min_total: v }))} mono />
            <Field label="Vehicles fuelled" value={thresholdForm.vehicles_min_fuelled} onChange={(v) => setThresholdForm((p) => ({ ...p, vehicles_min_fuelled: v }))} mono />
            <Field label="Fuel reserve (%)" value={thresholdForm.fuel_reserve_min} onChange={(v) => setThresholdForm((p) => ({ ...p, fuel_reserve_min: v }))} mono />
            <Field label="Equipment (item:minimum, comma separated)" value={thresholdForm.equipment_thresholds} onChange={(v) => setThresholdForm((p) => ({ ...p, equipment_thresholds: v }))} placeholder="radios:8, first aid kits:4" className="sm:col-span-2" />
          </div>
        </Panel>
      )}

      {activeTab === "devices" && (
        <>
          <Panel title="How much can Lemtik do on its own?" meta="Applies to every device on the Devices page">
            <div className="grid gap-3 md:grid-cols-2">
              {AUTOMATION_MODES.map((mode) => (
                <label
                  key={mode.value}
                  className="card col g8"
                  style={{ padding: 14, cursor: "pointer", borderColor: automationMode === mode.value ? "var(--blue-ln)" : undefined, background: automationMode === mode.value ? "var(--blue-bg)" : undefined }}
                >
                  <span className="row g8">
                    <input type="radio" name="automation_mode" checked={automationMode === mode.value} onChange={() => setAutomationMode(mode.value)} />
                    <b>{mode.label}</b>
                    {mode.value === 1 && <span className="tg">Default</span>}
                    {Number((settings as any)?.automation_mode ?? 1) === mode.value && <span className="tg tg-blue">Current</span>}
                  </span>
                  <span className="t2" style={{ fontSize: 12.5 }}>
                    {mode.description}
                  </span>
                </label>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <Notice tone="blue">
                Physical actuators (doors, gates, lifts, locks, barriers, turnstiles) always need a person to approve them, except under Emergency response with a pre-signed playbook.
              </Notice>
            </div>
          </Panel>
          <Panel title="Legacy device list" meta="Replaced by the Devices page; kept for reference">
            <div className="col g8">
              <textarea className="in mono" rows={8} value={devicesForm} onChange={(e) => setDevicesForm(e.target.value)} aria-label="Legacy device list (JSON)" style={{ height: "auto", paddingTop: 8, fontSize: 12 }} />
              {devicesJsonError && <Notice tone="fail">{devicesJsonError} Fix it before saving, or the list would be lost.</Notice>}
            </div>
          </Panel>
        </>
      )}

      {activeTab === "integrations" && (
        <div className="grid gap-4 lg:grid-cols-2" style={{ alignItems: "start" }}>
          <Panel title="Messaging">
            <div className="col g12">
              <Field label="Email sender (Resend)" value={integrationForm.resend_sender} onChange={(v) => setIntegrationForm((p) => ({ ...p, resend_sender: v }))} placeholder="alerts@yourdomain.com" />
              <Field label="SMS sender ID (Termii)" value={integrationForm.termii_sender_id} onChange={(v) => setIntegrationForm((p) => ({ ...p, termii_sender_id: v }))} mono />
              <Field label="WhatsApp number (Twilio)" value={integrationForm.twilio_whatsapp_number} onChange={(v) => setIntegrationForm((p) => ({ ...p, twilio_whatsapp_number: v }))} mono />
              <Field label="API key label" value={integrationForm.api_key_label} onChange={(v) => setIntegrationForm((p) => ({ ...p, api_key_label: v }))} />
            </div>
          </Panel>
          <Panel title="Reports and webhook">
            <div className="col g12">
              <Field label="Report delivery schedule" value={setForm.schedule} onChange={(v) => setSetForm({ ...setForm, schedule: v })} placeholder="e.g. weekly Mondays 09:00" />
              <Field label="Webhook URL" value={setForm.webhook_url} onChange={(v) => setSetForm({ ...setForm, webhook_url: v })} mono />
              <Field label="Webhook secret" value={setForm.webhook_secret} onChange={(v) => setSetForm({ ...setForm, webhook_secret: v })} mono secret />
            </div>
          </Panel>
        </div>
      )}

      {activeTab === "subscription" && (
        <Panel title="Subscription">
          <dl className="kv">
            <dt>Plan</dt>
            <dd>{org.subscription_tier ?? "—"}</dd>
            <dt>Status</dt>
            <dd>{org.subscription_status ?? "—"}</dd>
            <dt>Billing contact</dt>
            <dd>{org.billing_contact_email ?? "—"}</dd>
          </dl>
          <p className="t3" style={{ fontSize: 12.5, marginBottom: 0 }}>
            Plan changes are handled by Lemtik billing. Contact support to change your plan.
          </p>
        </Panel>
      )}
    </div>
  );
}

function Field({ label, value, onChange, className = "", placeholder, mono = false, secret = false }: { label: string; value: string; onChange: (v: string) => void; className?: string; placeholder?: string; mono?: boolean; secret?: boolean }) {
  return (
    <label className={`fl ${className}`}>
      <span className="lbl">{label}</span>
      <input className={`in${mono ? " mono" : ""}`} type={secret ? "password" : "text"} autoComplete={secret ? "new-password" : "off"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="fl">
      <span className="lbl">{label}</span>
      <span className="row g8">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`${label} colour picker`} style={{ width: 40, height: 34, borderRadius: 8, border: "1px solid var(--line-2)", background: "var(--ink-1)", padding: 2 }} />
        <input className="in mono f1" value={value} onChange={(e) => onChange(e.target.value)} />
      </span>
    </label>
  );
}

function devicesJsonProblem(value: string): string | null {
  if (!value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? null : "The legacy device list must be a JSON array.";
  } catch {
    return "The legacy device list isn't valid JSON.";
  }
}

function GuestAccessCard({ locations }: { locations: any[] }) {
  const issue = useServerFn(issueConsumerSession);
  const [locationId, setLocationId] = useState("");
  const [guestReference, setGuestReference] = useState("");
  const [expiresInHours, setExpiresInHours] = useState("24");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const issueMut = useMutation({
    mutationFn: () =>
      issue({
        data: {
          location_id: locationId || undefined,
          guest_reference: guestReference || undefined,
          expires_in_hours: Number(expiresInHours) || 24,
        },
      }),
    onSuccess: async (result) => {
      const QRCode = (await import("qrcode")).default;
      setQrDataUrl(await QRCode.toDataURL(result.qr_code_url, { width: 220, margin: 1 }));
    },
  });

  return (
    <Panel title="Guest emergency access" meta="A one-time code so a guest can report an emergency while on site">
      <div className="col g12">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="fl">
            <span className="lbl">Site</span>
            <select className="in" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">Any site</option>
              {locations.map((l: any) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <Field label="Guest reference" value={guestReference} onChange={setGuestReference} placeholder="Booking #12345" />
          <Field label="Expires in (hours)" value={expiresInHours} onChange={setExpiresInHours} placeholder="24" mono />
        </div>
        {issueMut.error && <Notice tone="fail">{(issueMut.error as Error).message}</Notice>}
        <div className="row">
          <button type="button" className="b b-pri" onClick={() => issueMut.mutate()} disabled={issueMut.isPending}>
            {issueMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Issue code
          </button>
        </div>
        {issueMut.data && (
          <div className="card row g16 wrap" style={{ padding: 14 }}>
            {qrDataUrl && <img src={qrDataUrl} alt="Guest access QR code" style={{ width: 160, height: 160, borderRadius: 8, background: "#fff", padding: 8 }} />}
            <div className="col g6" style={{ minWidth: 0 }}>
              <span className="t3" style={{ fontSize: 12 }}>
                Code
              </span>
              <b className="mono" style={{ fontSize: 18 }}>
                {issueMut.data.token}
              </b>
              <span className="t3 mono" style={{ fontSize: 11.5, wordBreak: "break-all" }}>
                {issueMut.data.qr_code_url}
              </span>
              <span className="t2" style={{ fontSize: 12.5 }}>
                Expires {new Date(issueMut.data.expires_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

function toNumberOrNull(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseEquipmentThresholds(value: string) {
  return value
    .split(",")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [label, minimum] = chunk.split(":").map((part) => part.trim());
      return {
        label: label || "Equipment",
        minimum: toNumberOrNull(minimum ?? "") ?? 0,
      };
    });
}

const AUTOMATION_MODES = [
  { value: 0, label: "Advisory only", description: "Lemtik suggests. Nothing runs by itself, not even a camera move." },
  { value: 1, label: "Human approval", description: "Every action, including camera and sensor control, waits for a named person to approve it." },
  { value: 2, label: "Policy automation", description: "A fixed list of low-risk, non-physical actions (camera view, pan, snapshot; sensor on/off) runs straight away. Everything else waits for approval." },
  { value: 3, label: "Emergency response", description: "Pre-approved emergency playbooks run by themselves during a declared emergency. Everything else waits for approval." },
];

function parseSmartDevices(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
