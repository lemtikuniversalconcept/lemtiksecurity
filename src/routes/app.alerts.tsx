import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Bell, Check, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { PageHeader, Sev, Switch } from "@/components/nw";
import { toast } from "sonner";
import { requireSectionAccess } from "@/lib/rbac";
import { listAlerts, markAllNotificationsRead, markNotificationRead, getAlertPreferences, updateAlertPreferences } from "@/lib/alerts.functions";
import { useRealtimeInvalidate } from "@/lib/useRealtime";
import { EscalationPanel } from "@/components/alerts/Escalation";

type AlertRow = {
  id: string;
  title: string;
  body?: string | null;
  severity: number;
  alert_type?: string | null;
  sent_at: string;
  incident_id?: string | null;
  channel?: string | null;
  channels?: string[] | null;
  read?: boolean;
};

type Recipient = { label: string; phone: string; channels: string[]; severity_floor: number };

const tabs = ["All", "Unread", "Incidents", "Patrols", "Inventory", "OSINT", "System"] as const;
type Tab = (typeof tabs)[number];

const ALERT_TYPES = [
  { id: "incident_critical", label: "Critical Incident (Sev 5)", default: ["whatsapp", "sms", "in-app"] },
  { id: "incident_high", label: "High Incident (Sev 4)", default: ["whatsapp", "in-app"] },
  { id: "incident_assigned", label: "Incident Assigned", default: ["in-app", "whatsapp"] },
  { id: "missed_checkin", label: "Missed Check-In", default: ["whatsapp", "in-app"] },
  { id: "prolonged_missed", label: "3+ Missed Check-Ins", default: ["whatsapp", "sms"] },
  { id: "shift_start", label: "Shift Start Reminder", default: ["whatsapp"] },
  { id: "shift_handover", label: "Shift Handover", default: ["whatsapp"] },
  { id: "daily_summary", label: "Daily Summary", default: ["email", "whatsapp"] },
  { id: "weekly_brief", label: "Weekly Brief (PDF)", default: ["email"] },
  { id: "osint_threat", label: "OSINT Threat Alert", default: ["whatsapp", "email"] },
  { id: "inventory_threshold", label: "Inventory Threshold", default: ["in-app", "email"] },
  { id: "sos", label: "SOS Triggered", default: ["sms", "whatsapp", "in-app"] },
] as const;

const ALL_CHANNELS = ["in-app", "whatsapp", "sms", "email", "push"] as const;

export const Route = createFileRoute("/app/alerts")({
  head: () => ({ meta: [{ title: "Alert Centre · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    const access = context.appAccess;
    requireSectionAccess(access, ["security_manager", "operator"]);
    return { access };
  },
  component: AlertCentre,
});

function AlertCentre() {
  const { access } = Route.useRouteContext();
  const list = useServerFn(listAlerts);
  const markRead = useServerFn(markNotificationRead);
  const markAll = useServerFn(markAllNotificationsRead);
  const getPrefs = useServerFn(getAlertPreferences);
  const updatePrefsFn = useServerFn(updateAlertPreferences);
  const qc = useQueryClient();
  useRealtimeInvalidate("alerts", [["alerts"], ["my-notifications"]]);

  const { data: alerts = [], isLoading } = useQuery({
    queryKey: ["alerts"],
    queryFn: () => list() as Promise<AlertRow[]>,
  });
  const { data: prefs, isError: prefsError } = useQuery({
    queryKey: ["alert-prefs"],
    queryFn: () => getPrefs(),
  });

  const [tab, setTab] = useState<Tab>("All");
  const [enabled, setEnabled] = useState<string[]>([]);
  const [channelMap, setChannelMap] = useState<Record<string, string[]>>({});
  const [quietEnabled, setQuietEnabled] = useState(true);
  const [quietStart, setQuietStart] = useState("23:00");
  const [quietEnd, setQuietEnd] = useState("06:00");
  const [extras, setExtras] = useState<Recipient[]>([]);
  const [lang, setLang] = useState<"en" | "pcm">("en");
  const canConfigure = access.specRole === "security_manager";
  const unreadCount = alerts.filter((a) => !a.read).length;
  const visibleAlerts = useMemo(() => alerts.filter((alert) => matchesTab(alert, tab)), [alerts, tab]);

  useEffect(() => {
    if (!prefs) return;
    setEnabled(prefs.enabled_types ?? []);
    const cm: Record<string, string[]> = {};
    for (const t of ALERT_TYPES) {
      cm[t.id] = (prefs.channel_map as Record<string, string[]>)?.[t.id] ?? [...t.default];
    }
    setChannelMap(cm);
    const qh = (prefs.quiet_hours as { enabled: boolean; start: string; end: string }) ?? { enabled: true, start: "23:00", end: "06:00" };
    setQuietEnabled(qh.enabled);
    setQuietStart(qh.start);
    setQuietEnd(qh.end);
    setExtras((prefs.extra_recipients as Recipient[]) ?? []);
    setLang((prefs.language as "en" | "pcm") ?? "en");
  }, [prefs]);

  const readMut = useMutation({
    mutationFn: (id: string) => markRead({ data: { alert_id: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
  });

  const allMut = useMutation({
    mutationFn: () => markAll(),
    onSuccess: () => {
      toast.success("All alerts marked as read");
      qc.invalidateQueries({ queryKey: ["alerts"] });
      qc.invalidateQueries({ queryKey: ["my-notifications"] });
    },
  });

  const updatePrefs = useMutation({
    mutationFn: (input: Parameters<typeof updatePrefsFn>[0]) => updatePrefsFn(input),
    onSuccess: () => {
      toast.success("Delivery rules saved");
      qc.invalidateQueries({ queryKey: ["alert-prefs"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const savePrefs = () => {
    updatePrefs.mutate({
      data: {
        enabled_types: enabled,
        channel_map: channelMap,
        quiet_hours: { enabled: quietEnabled, start: quietStart, end: quietEnd },
        extra_recipients: extras,
        language: lang,
      },
    });
  };

  const toggleEnabled = (id: string) => {
    setEnabled((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const toggleChannel = (typeId: string, channel: string) => {
    setChannelMap((current) => {
      const existing = current[typeId] ?? [];
      return {
        ...current,
        [typeId]: existing.includes(channel) ? existing.filter((item) => item !== channel) : [...existing, channel],
      };
    });
  };

  const counts = (t: Tab) => alerts.filter((a) => matchesTab(a, t)).length;
  const CHANNEL_COLS = ["in-app", "whatsapp", "sms", "email"] as const;

  return (
    <>
      <PageHeader title="Alerts" sub={`Everything Lemtik sent, and the rules for who gets what · ${unreadCount} unread`}>
        <button type="button" className="b b-sec" onClick={() => allMut.mutate()} disabled={!unreadCount || allMut.isPending}>
          {allMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 size={15} strokeWidth={1.75} />} Mark all read
        </button>
      </PageHeader>

      <div className="flex flex-wrap items-start" style={{ gap: 12 }}>
        <section className="pn" style={{ flex: "999 1 560px", minWidth: 0 }}>
          <div className="tabs" role="tablist" aria-label="Alert types" style={{ padding: "0 8px" }}>
            {tabs.map((item) => (
              <button key={item} type="button" role="tab" aria-selected={tab === item} className={`tab${tab === item ? " on" : ""}`} onClick={() => setTab(item)}>
                {item}
                {(item === "All" || item === "Unread") && <span className="c">{counts(item)}</span>}
              </button>
            ))}
          </div>
          {isLoading ? (
            <div className="empty row g8" style={{ padding: 16 }}><Loader2 className="h-4 w-4 animate-spin" /> Loading alerts…</div>
          ) : visibleAlerts.length === 0 ? (
            <div className="empty" style={{ padding: 16 }}>No alerts here.</div>
          ) : (
            <div className="list">
              {visibleAlerts.map((alert) => {
                const category = getCategory(alert);
                return (
                  <div key={alert.id} className="row g10" style={{ padding: "10px 12px", alignItems: "flex-start", background: alert.read ? undefined : "rgba(52,98,240,.05)" }}>
                    <span className={`dot${alert.read ? " d-off" : " d-blue"}`} style={{ marginTop: 6 }} aria-label={alert.read ? "Read" : "Unread"} />
                    {alert.severity >= 2 && <Sev level={alert.severity} />}
                    <span className="f1 col min-w-0">
                      <span className="row g8 wrap">
                        <b>{alert.title}</b>
                        <span className="tg capitalize">{category}</span>
                      </span>
                      {alert.body && <span className="t3 whitespace-pre-line" style={{ fontSize: 12.5 }}>{alert.body}</span>}
                    </span>
                    <span className="mono t3" style={{ fontSize: 12 }} title={new Date(alert.sent_at).toLocaleString("en-GB")}>
                      {new Date(alert.sent_at).toLocaleTimeString("en-GB")}
                    </span>
                    {alert.incident_id && (
                      <Link to="/app/incidents/$id" params={{ id: alert.incident_id }} className="b b-sm b-gh">View</Link>
                    )}
                    {!alert.read && (
                      <button type="button" onClick={() => readMut.mutate(alert.id)} className="b b-sm b-gh">Mark read</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <aside className="pn" style={{ flex: "1 1 420px", minWidth: 0 }} id="settings">
          <div className="pn-h">
            <h3>Delivery rules</h3>
            <span className="meta">Security manager only</span>
            <span className="flex-auto" />
            {canConfigure && prefs && (
              <button type="button" className="b b-sm b-pri" onClick={savePrefs} disabled={updatePrefs.isPending}>
                {updatePrefs.isPending && <Loader2 className="h-3 w-3 animate-spin" />} Save
              </button>
            )}
          </div>
          {!canConfigure ? (
            <div className="empty" style={{ padding: 12 }}>Only security managers can change delivery rules.</div>
          ) : prefsError ? (
            <div className="empty" style={{ padding: 12 }}>Couldn’t load the delivery rules. Refresh to try again.</div>
          ) : !prefs ? (
            <div className="empty row g8" style={{ padding: 12 }}><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading rules…</div>
          ) : (
            <>
              <div className="tblw">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Alert</th>
                      <th>On</th>
                      {CHANNEL_COLS.map((ch) => <th key={ch} className="capitalize">{ch === "in-app" ? "In-app" : ch === "sms" ? "SMS" : ch}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {ALERT_TYPES.map((type) => {
                      const channels = channelMap[type.id] ?? [...type.default];
                      const on = enabled.includes(type.id);
                      return (
                        <tr key={type.id}>
                          <td className="wrapc">{type.label}</td>
                          <td><Switch on={on} onChange={() => toggleEnabled(type.id)} label={`${type.label} enabled`} /></td>
                          {CHANNEL_COLS.map((ch) => {
                            const checked = channels.includes(ch);
                            return (
                              <td key={ch}>
                                <button type="button" role="checkbox" aria-checked={checked} aria-label={`${type.label} by ${ch}`} disabled={!on} onClick={() => toggleChannel(type.id, ch)} className={`chk${checked ? " on" : ""}`} style={on ? undefined : { opacity: 0.4 }}>
                                  {checked && <Check size={11} strokeWidth={3} />}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="col g12" style={{ padding: 12 }}>
                <div className="row g10">
                  <Switch on={quietEnabled} onChange={setQuietEnabled} label="Quiet hours" />
                  <span className="f1 col">
                    <b>Quiet hours</b>
                    <span className="t3" style={{ fontSize: 12 }}>Only S4–S5 and SOS break through</span>
                  </span>
                  <input type="time" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} className="in" style={{ width: 110 }} aria-label="Quiet hours start" />
                  <span className="t3">to</span>
                  <input type="time" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} className="in" style={{ width: 110 }} aria-label="Quiet hours end" />
                </div>
                <div className="col g8">
                  <span className="lbl">Extra recipients</span>
                  {extras.length === 0 && <span className="empty">None yet.</span>}
                  {extras.map((recipient, index) => (
                    <div key={index} className="row g8">
                      <input value={recipient.label} onChange={(e) => setExtras((c) => c.map((r, i) => (i === index ? { ...r, label: e.target.value } : r)))} placeholder="Name" className="in" aria-label="Recipient name" />
                      <input value={recipient.phone} onChange={(e) => setExtras((c) => c.map((r, i) => (i === index ? { ...r, phone: e.target.value } : r)))} placeholder="+234…" className="in" aria-label="Recipient phone" />
                      <select value={recipient.severity_floor} onChange={(e) => setExtras((c) => c.map((r, i) => (i === index ? { ...r, severity_floor: Number(e.target.value) } : r)))} className="in" style={{ width: 96 }} aria-label="Minimum severity">
                        {[1, 2, 3, 4, 5].map((s) => <option key={s} value={s}>S{s}+</option>)}
                      </select>
                      <button type="button" onClick={() => setExtras((c) => c.filter((_, i) => i !== index))} className="ibtn" aria-label="Remove recipient"><XCircle size={15} strokeWidth={1.75} /></button>
                    </div>
                  ))}
                  <button type="button" className="b b-sm b-sec self-start" onClick={() => setExtras((c) => [...c, { label: "", phone: "", channels: ["whatsapp"], severity_floor: 5 }])}>
                    <Bell size={13} strokeWidth={1.75} /> Add recipient
                  </button>
                </div>
                <label className="row g8">
                  <span className="lbl">Message language</span>
                  <select value={lang} onChange={(e) => setLang(e.target.value as "en" | "pcm")} className="in" style={{ width: 140 }}>
                    <option value="en">English</option>
                    <option value="pcm">Pidgin</option>
                  </select>
                </label>
                <span className="t3" style={{ fontSize: 12 }}>In-app delivery is live. WhatsApp, SMS and email go out through the providers configured for your organisation.</span>
              </div>
            </>
          )}
        </aside>
        <EscalationPanel canConfigure={canConfigure} />
      </div>
    </>
  );
}

function matchesTab(alert: AlertRow, tab: Tab) {
  if (tab === "All") return true;
  if (tab === "Unread") return !alert.read;
  const category = getCategory(alert);
  return category === tab.toLowerCase();
}

function getCategory(alert: AlertRow) {
  const type = String(alert.alert_type ?? "").toLowerCase();
  if (type.includes("incident") || type.includes("sos")) return "incidents";
  if (type.includes("checkin") || type.includes("shift")) return "patrols";
  if (type.includes("inventory") || type.includes("fuel") || type.includes("supply")) return "inventory";
  if (type.includes("osint") || type.includes("threat")) return "osint";
  if (type.includes("system") || type.includes("test")) return "system";
  if (alert.severity >= 4) return "incidents";
  return "system";
}




