import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Bell, CheckCircle2, Loader2, Mail, MessageCircle, Mic2, Radar, Settings2, ShieldAlert, Smartphone, TriangleAlert, XCircle } from "lucide-react";
import { toast } from "sonner";
import { requireSectionAccess } from "@/lib/rbac";
import { listAlerts, listMyNotifications, markAllNotificationsRead, markNotificationRead, getAlertPreferences, updateAlertPreferences } from "@/lib/alerts.functions";
import { useRealtimeInvalidate } from "@/lib/useRealtime";

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
  const listMine = useServerFn(listMyNotifications);
  const markRead = useServerFn(markNotificationRead);
  const markAll = useServerFn(markAllNotificationsRead);
  const getPrefs = useServerFn(getAlertPreferences);
  const updatePrefs = useServerFn(updateAlertPreferences);
  const qc = useQueryClient();
  useRealtimeInvalidate("alerts", [["alerts"], ["my-notifications"]]);

  const { data: alerts = [], isLoading } = useQuery({
    queryKey: ["alerts"],
    queryFn: () => list() as Promise<AlertRow[]>,
  });
  const { data: unreadFeed = [] } = useQuery({
    queryKey: ["my-notifications"],
    queryFn: () => listMine() as Promise<AlertRow[]>,
  });
  const { data: prefs } = useQuery({
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
  const recentUnread = unreadFeed.slice(0, 5);

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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Alerts & Notifications</div>
          <h1 className="mt-1 text-2xl font-semibold">Alert centre</h1>
          <p className="text-sm text-muted-foreground">Unread, incident, patrol, inventory, OSINT, and system alerts in one feed.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-md border border-border bg-card px-3 py-2 text-xs">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Unread</div>
            <div className="mt-1 text-lg font-semibold">{unreadCount}</div>
          </div>
          <button
            onClick={() => allMut.mutate()}
            disabled={!unreadCount || allMut.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-xs hover:bg-surface-2 disabled:opacity-50"
          >
            {allMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            Mark all as read
          </button>
          <a href="#settings" className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90">
            <Settings2 className="h-3.5 w-3.5" /> Configure preferences
          </a>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-2">
        <div className="flex flex-wrap gap-2">
          {tabs.map((item) => (
            <button
              key={item}
              onClick={() => setTab(item)}
              className={`rounded-md px-3 py-2 text-xs font-medium ${tab === item ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_0.8fr] gap-4">
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Alert Centre Page</div>
              <h2 className="mt-1 text-lg font-semibold">{tab} alerts</h2>
            </div>
            <Bell className="h-4 w-4 text-muted-foreground" />
          </div>

          {isLoading ? (
            <div className="mt-5 flex items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 py-8 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading alerts…
            </div>
          ) : visibleAlerts.length === 0 ? (
            <div className="mt-5 rounded-md border border-dashed border-border bg-surface px-4 py-8 text-center text-xs text-muted-foreground">
              No alerts in this bucket.
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {visibleAlerts.map((alert) => {
                const category = getCategory(alert);
                const Icon = categoryIcon(category);
                return (
                  <article key={alert.id} className={`rounded-xl border p-4 ${alert.read ? "border-border bg-surface" : "border-primary/25 bg-primary/5"}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="grid h-10 w-10 place-items-center rounded-md border border-border bg-background">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${severityTone(alert.severity)}`}>{severityLabel(alert.severity)}</span>
                            {!alert.read && <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-primary">Unread</span>}
                          </div>
                          <h3 className="mt-2 text-sm font-semibold">{alert.title}</h3>
                          {alert.body && <p className="mt-1 max-w-2xl text-xs text-muted-foreground whitespace-pre-line">{alert.body}</p>}
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                            <span>{new Date(alert.sent_at).toLocaleString("en-GB", { hour12: false })}</span>
                            <span>·</span>
                            <span>{timeAgo(alert.sent_at)}</span>
                            <span>·</span>
                            <span>{category.toUpperCase()}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {alert.incident_id ? (
                          <Link to="/app/incidents/$id" params={{ id: alert.incident_id }} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                            View
                          </Link>
                        ) : null}
                        {!alert.read && (
                          <button
                            type="button"
                            onClick={() => readMut.mutate(alert.id)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-surface-2"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" /> Dismiss
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Unread Alerts</div>
                <h2 className="mt-1 text-lg font-semibold">Last five unread</h2>
              </div>
              <Mic2 className="h-4 w-4 text-muted-foreground" />
            </div>

            <div className="mt-4 space-y-2">
              {recentUnread.length === 0 ? (
                <div className="rounded-md border border-dashed border-border bg-surface px-3 py-6 text-center text-xs text-muted-foreground">No unread alerts.</div>
              ) : (
                recentUnread.map((alert) => (
                  <div key={alert.id} className="rounded-md border border-border bg-surface px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{alert.title}</span>
                      <span className="text-[10px] text-muted-foreground">{timeAgo(alert.sent_at)}</span>
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">{getCategory(alert).toUpperCase()}</div>
                  </div>
                ))
              )}
            </div>

            <a href="#settings" className="mt-4 inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
              View all <span aria-hidden>→</span>
            </a>
          </section>

          <section id="settings" className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Alert Configuration</div>
                <h2 className="mt-1 text-lg font-semibold">Manager preferences</h2>
              </div>
              <Settings2 className="h-4 w-4 text-muted-foreground" />
            </div>

            {!canConfigure ? (
              <div className="mt-4 rounded-md border border-dashed border-border bg-surface px-4 py-6 text-xs text-muted-foreground">
                Alert preferences are manager-only. You can still view the live alert centre.
              </div>
            ) : !prefs ? (
              <div className="mt-4 rounded-md border border-dashed border-border bg-surface px-4 py-6 text-xs text-muted-foreground">
                Loading preferences…
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="grid gap-2">
                  {ALERT_TYPES.map((type) => {
                    const isEnabled = enabled.includes(type.id);
                    const channels = channelMap[type.id] ?? [...type.default];
                    return (
                      <button
                        key={type.id}
                        type="button"
                        onClick={() => toggleEnabled(type.id)}
                        className={`rounded-md border px-3 py-2 text-left text-xs ${isEnabled ? "border-primary bg-primary/5" : "border-border bg-surface"}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{type.label}</span>
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{isEnabled ? "Enabled" : "Disabled"}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {ALL_CHANNELS.map((ch) => (
                            <button
                              key={ch}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleChannel(type.id, ch);
                              }}
                              className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${channels.includes(ch) ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground"}`}
                            >
                              {ch}
                            </button>
                          ))}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={quietEnabled} onChange={(e) => setQuietEnabled(e.target.checked)} />
                    Quiet hours enabled
                  </label>
                  <div className="mt-2 flex items-center gap-2">
                    <input type="time" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} className="rounded border border-border bg-card px-2 py-1" />
                    <span>→</span>
                    <input type="time" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} className="rounded border border-border bg-card px-2 py-1" />
                  </div>
                </div>

                <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs">
                  <div className="font-medium">Additional recipients</div>
                  <div className="mt-2 space-y-2">
                    {extras.length === 0 ? (
                      <div className="text-muted-foreground">No additional recipients configured.</div>
                    ) : extras.map((recipient, index) => (
                      <div key={index} className="grid grid-cols-12 items-center gap-2">
                        <input
                          value={recipient.label}
                          onChange={(e) => setExtras((current) => current.map((row, i) => i === index ? { ...row, label: e.target.value } : row))}
                          placeholder="Name"
                          className="col-span-4 rounded border border-border bg-card px-2 py-1.5"
                        />
                        <input
                          value={recipient.phone}
                          onChange={(e) => setExtras((current) => current.map((row, i) => i === index ? { ...row, phone: e.target.value } : row))}
                          placeholder="+234..."
                          className="col-span-3 rounded border border-border bg-card px-2 py-1.5"
                        />
                        <select
                          value={recipient.severity_floor}
                          onChange={(e) => setExtras((current) => current.map((row, i) => i === index ? { ...row, severity_floor: Number(e.target.value) } : row))}
                          className="col-span-2 rounded border border-border bg-card px-2 py-1.5"
                        >
                          {[1, 2, 3, 4, 5].map((s) => <option key={s} value={s}>Sev {s}+</option>)}
                        </select>
                        <button
                          type="button"
                          onClick={() => setExtras((current) => current.filter((_, i) => i !== index))}
                          className="col-span-1 text-muted-foreground hover:text-critical"
                        >
                          <XCircle className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setExtras((current) => [...current, { label: "", phone: "", channels: ["whatsapp"], severity_floor: 5 }])}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-[11px]"
                  >
                    <Bell className="h-3.5 w-3.5" /> Add recipient
                  </button>
                </div>

                <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs">
                  <label className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Language</span>
                    <select value={lang} onChange={(e) => setLang(e.target.value as "en" | "pcm")} className="rounded border border-border bg-card px-2 py-1">
                      <option value="en">English</option>
                      <option value="pcm">Pidgin</option>
                    </select>
                  </label>
                </div>

                <button
                  type="button"
                  onClick={savePrefs}
                  disabled={updatePrefs.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {updatePrefs.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Settings2 className="h-3.5 w-3.5" />}
                  Save preferences
                </button>
              </div>
            )}
          </section>
        </aside>
      </div>

      <div className="rounded-md border border-border bg-surface px-4 py-3 text-[11px] text-muted-foreground">
        <strong className="text-foreground">Delivery note:</strong> In-app alert delivery is live. WhatsApp, SMS, and email routes remain configurable through the preferences panel and downstream providers.
      </div>
    </div>
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

function categoryIcon(category: string) {
  switch (category) {
    case "incidents":
      return TriangleAlert;
    case "patrols":
      return Radar;
    case "inventory":
      return ShieldAlert;
    case "osint":
      return MessageCircle;
    case "system":
    default:
      return Bell;
  }
}

function severityLabel(severity: number) {
  if (severity >= 5) return "Critical";
  if (severity >= 4) return "High";
  if (severity >= 3) return "Moderate";
  return "Low";
}

function severityTone(severity: number) {
  if (severity >= 5) return "border-critical/30 bg-critical/10 text-critical";
  if (severity >= 4) return "border-high/30 bg-high/10 text-high";
  if (severity >= 3) return "border-medium/30 bg-medium/10 text-medium";
  return "border-border bg-background text-muted-foreground";
}

function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} hr ago` : `${Math.floor(h / 24)} d ago`;
}
