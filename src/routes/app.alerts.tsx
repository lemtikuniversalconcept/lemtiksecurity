import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import {
  listAlerts, getAlertPreferences, updateAlertPreferences, sendTestAlert,
} from "@/lib/alerts.functions";
import { SeverityBadge } from "@/components/SeverityBadge";
import { useRealtimeInvalidate } from "@/lib/useRealtime";
import { type Severity } from "@/lib/mockData";
import {
  MessageCircle, Mail, Bell, Smartphone, Loader2, CheckCircle2, XCircle, Send, Plus, Trash2,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/alerts")({
  head: () => ({ meta: [{ title: "Alerts · Lemtik SOD" }] }),
  component: Alerts,
});

const channelIcon: Record<string, React.ComponentType<{ className?: string }>> = {
  whatsapp: MessageCircle,
  sms: Smartphone,
  email: Mail,
  "in-app": Bell,
  push: Bell,
};

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
  { id: "sos", label: "SOS Triggered", default: ["sms", "whatsapp", "in-app"] },
] as const;

const ALL_CHANNELS = ["in-app", "whatsapp", "sms", "email", "push"] as const;

function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} hr ago` : `${Math.floor(h / 24)} d ago`;
}

function Alerts() {
  const [tab, setTab] = useState<"history" | "settings">("history");
  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Alerts & Notifications</div>
          <h1 className="mt-1 text-2xl font-semibold">Alert centre</h1>
          <p className="text-sm text-muted-foreground">Multi-channel dispatch — in-app, WhatsApp, SMS, email.</p>
        </div>
        <div className="flex rounded-md border border-border bg-surface p-0.5">
          <button onClick={() => setTab("history")} className={`px-3 py-1.5 text-xs rounded ${tab === "history" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>History</button>
          <button onClick={() => setTab("settings")} className={`px-3 py-1.5 text-xs rounded ${tab === "settings" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Configuration</button>
        </div>
      </div>

      {tab === "history" ? <History /> : <Settings />}
    </div>
  );
}

function History() {
  const list = useServerFn(listAlerts);
  const test = useServerFn(sendTestAlert);
  const qc = useQueryClient();
  useRealtimeInvalidate("alerts", [["alerts"], ["my-notifications"]]);
  const { data: alerts = [], isLoading } = useQuery({ queryKey: ["alerts"], queryFn: () => list() });

  const testMut = useMutation({
    mutationFn: () => test(),
    onSuccess: () => { toast.success("Test alert dispatched"); qc.invalidateQueries({ queryKey: ["alerts"] }); qc.invalidateQueries({ queryKey: ["my-notifications"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const stats = {
    delivered: alerts.filter((a) => a.status === "delivered").length,
    failed: alerts.filter((a) => a.status === "failed").length,
    pending: alerts.filter((a) => a.status === "pending" || a.status === "queued").length,
  };

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Cfg label="Severity 1–2" value="Field officer" />
        <Cfg label="Severity 3" value="+ Supervisor" />
        <Cfg label="Severity 4" value="+ Security Manager" />
        <Cfg label="Severity 5" value="+ Auto-draft to authorities" tone="critical" />
      </div>

      <div className="flex items-center justify-between gap-3 mt-4">
        <div className="flex items-center gap-4 text-xs">
          <span className="text-muted-foreground">Total <strong className="text-foreground">{alerts.length}</strong></span>
          <span className="inline-flex items-center gap-1 text-resolved"><CheckCircle2 className="h-3 w-3" /> {stats.delivered}</span>
          <span className="inline-flex items-center gap-1 text-critical"><XCircle className="h-3 w-3" /> {stats.failed}</span>
          {stats.pending > 0 && <span className="text-muted-foreground">{stats.pending} pending</span>}
        </div>
        <button
          onClick={() => testMut.mutate()}
          disabled={testMut.isPending}
          className="inline-flex items-center gap-1.5 text-xs rounded-md border border-border bg-surface hover:bg-surface-2 px-3 py-1.5"
        >
          {testMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          Send test alert
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {isLoading ? (
          <div className="p-10 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading alerts…
          </div>
        ) : alerts.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">No alerts dispatched yet.</div>
        ) : (
          <ul className="divide-y divide-border">
            {alerts.map((a) => {
              const channels: string[] = (a.channels && a.channels.length ? a.channels : [a.channel]) as string[];
              return (
                <li key={a.id} className={`px-5 py-4 flex items-start gap-4 ${a.read ? "" : "bg-primary/5"}`}>
                  <div className="flex flex-col items-center gap-1 pt-0.5">
                    <SeverityBadge severity={a.severity as Severity} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">{a.title}</span>
                      <span className={`text-[9px] uppercase tracking-wider font-medium ${
                        a.status === "delivered" ? "text-resolved" :
                        a.status === "failed" ? "text-critical" : "text-muted-foreground"
                      }`}>
                        {a.status}
                      </span>
                    </div>
                    {a.body && <div className="text-[11px] text-muted-foreground mt-1 line-clamp-2 whitespace-pre-line">{a.body}</div>}
                    <div className="text-[10px] text-muted-foreground font-mono mt-1">
                      {a.code} · {a.recipients} recipients · {timeAgo(a.sent_at)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {channels.map((c) => {
                      const Icon = channelIcon[c] ?? Bell;
                      return (
                        <span key={c} title={c} className="grid h-7 w-7 place-items-center rounded border border-border bg-surface">
                          <Icon className="h-3 w-3 text-muted-foreground" />
                        </span>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

type Recipient = { label: string; phone: string; channels: string[]; severity_floor: number };

function Settings() {
  const get = useServerFn(getAlertPreferences);
  const upd = useServerFn(updateAlertPreferences);
  const qc = useQueryClient();
  const { data: prefs, isLoading } = useQuery({ queryKey: ["alert-prefs"], queryFn: () => get() });
  const [enabled, setEnabled] = useState<string[]>([]);
  const [channelMap, setChannelMap] = useState<Record<string, string[]>>({});
  const [quietEnabled, setQuietEnabled] = useState(true);
  const [quietStart, setQuietStart] = useState("23:00");
  const [quietEnd, setQuietEnd] = useState("06:00");
  const [extras, setExtras] = useState<Recipient[]>([]);
  const [lang, setLang] = useState<"en" | "pcm">("en");

  useEffect(() => {
    if (!prefs) return;
    setEnabled(prefs.enabled_types ?? []);
    const cm: Record<string, string[]> = {};
    for (const t of ALERT_TYPES) {
      cm[t.id] = (prefs.channel_map as Record<string, string[]>)?.[t.id] ?? [...t.default];
    }
    setChannelMap(cm);
    const qh = (prefs.quiet_hours as { enabled: boolean; start: string; end: string }) ?? { enabled: true, start: "23:00", end: "06:00" };
    setQuietEnabled(qh.enabled); setQuietStart(qh.start); setQuietEnd(qh.end);
    setExtras((prefs.extra_recipients as Recipient[]) ?? []);
    setLang((prefs.language as "en" | "pcm") ?? "en");
  }, [prefs]);

  const saveMut = useMutation({
    mutationFn: () => upd({ data: {
      enabled_types: enabled,
      channel_map: channelMap,
      quiet_hours: { enabled: quietEnabled, start: quietStart, end: quietEnd },
      extra_recipients: extras,
      language: lang,
    } }),
    onSuccess: () => { toast.success("Preferences saved"); qc.invalidateQueries({ queryKey: ["alert-prefs"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="p-10 text-center text-sm text-muted-foreground flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;

  const toggle = (id: string) =>
    setEnabled((e) => e.includes(id) ? e.filter((x) => x !== id) : [...e, id]);
  const toggleChan = (typeId: string, ch: string) =>
    setChannelMap((m) => {
      const cur = m[typeId] ?? [];
      return { ...m, [typeId]: cur.includes(ch) ? cur.filter((c) => c !== ch) : [...cur, ch] };
    });

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Alert types & channels</h2>
        <p className="text-xs text-muted-foreground mb-3">Choose which alerts to receive and through which channels.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="py-2 pr-2">Enabled</th>
                <th className="py-2 pr-3">Alert</th>
                {ALL_CHANNELS.map((c) => <th key={c} className="py-2 px-2 text-center capitalize">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {ALERT_TYPES.map((t) => {
                const on = enabled.includes(t.id);
                return (
                  <tr key={t.id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-2">
                      <input type="checkbox" checked={on} onChange={() => toggle(t.id)} />
                    </td>
                    <td className="py-2 pr-3 font-medium">{t.label}</td>
                    {ALL_CHANNELS.map((c) => (
                      <td key={c} className="py-2 px-2 text-center">
                        <input
                          type="checkbox"
                          disabled={!on}
                          checked={(channelMap[t.id] ?? []).includes(c)}
                          onChange={() => toggleChan(t.id, c)}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section className="rounded-lg border border-border bg-card p-5 space-y-3">
          <h2 className="text-sm font-semibold">Quiet hours</h2>
          <p className="text-xs text-muted-foreground">Suppress non-critical alerts during this window. Severity 5 always fires.</p>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={quietEnabled} onChange={(e) => setQuietEnabled(e.target.checked)} />
            Enable quiet hours
          </label>
          <div className="flex items-center gap-2 text-xs">
            <input type="time" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} className="rounded border border-border bg-surface px-2 py-1" />
            <span>→</span>
            <input type="time" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} className="rounded border border-border bg-surface px-2 py-1" />
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-5 space-y-3">
          <h2 className="text-sm font-semibold">Alert language</h2>
          <p className="text-xs text-muted-foreground">Used for WhatsApp/SMS message body.</p>
          <div className="flex gap-2">
            {(["en", "pcm"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`px-3 py-1.5 text-xs rounded border ${lang === l ? "border-primary bg-primary/10 text-foreground" : "border-border bg-surface text-muted-foreground"}`}
              >
                {l === "en" ? "English" : "Pidgin"}
              </button>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold">Additional recipients</h2>
            <p className="text-xs text-muted-foreground">External contacts to copy on alerts (e.g. estate chairman on Severity 5).</p>
          </div>
          <button
            onClick={() => setExtras((x) => [...x, { label: "", phone: "", channels: ["whatsapp"], severity_floor: 5 }])}
            className="inline-flex items-center gap-1 text-xs rounded-md border border-border bg-surface hover:bg-surface-2 px-2.5 py-1.5"
          >
            <Plus className="h-3 w-3" /> Add recipient
          </button>
        </div>
        {extras.length === 0 ? (
          <div className="text-xs text-muted-foreground py-3">No additional recipients configured.</div>
        ) : (
          <div className="space-y-2">
            {extras.map((r, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center text-xs">
                <input
                  placeholder="Name / label"
                  value={r.label}
                  onChange={(e) => setExtras((x) => x.map((p, j) => j === i ? { ...p, label: e.target.value } : p))}
                  className="col-span-4 rounded border border-border bg-surface px-2 py-1.5"
                />
                <input
                  placeholder="+234…"
                  value={r.phone}
                  onChange={(e) => setExtras((x) => x.map((p, j) => j === i ? { ...p, phone: e.target.value } : p))}
                  className="col-span-3 rounded border border-border bg-surface px-2 py-1.5 font-mono"
                />
                <select
                  value={r.severity_floor}
                  onChange={(e) => setExtras((x) => x.map((p, j) => j === i ? { ...p, severity_floor: Number(e.target.value) } : p))}
                  className="col-span-2 rounded border border-border bg-surface px-2 py-1.5"
                >
                  {[1,2,3,4,5].map((s) => <option key={s} value={s}>Sev {s}+</option>)}
                </select>
                <div className="col-span-2 flex gap-1">
                  {(["whatsapp","sms","email"] as const).map((c) => (
                    <button
                      key={c}
                      onClick={() => setExtras((x) => x.map((p, j) => j === i ? { ...p, channels: p.channels.includes(c) ? p.channels.filter((cc) => cc !== c) : [...p.channels, c] } : p))}
                      className={`px-1.5 py-1 rounded border text-[10px] ${r.channels.includes(c) ? "border-primary bg-primary/10" : "border-border bg-surface text-muted-foreground"}`}
                    >
                      {c[0].toUpperCase()}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setExtras((x) => x.filter((_, j) => j !== i))}
                  className="col-span-1 text-muted-foreground hover:text-critical"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="rounded-md border border-border bg-surface px-4 py-3 text-[11px] text-muted-foreground">
        <strong className="text-foreground">Heads-up:</strong> In-app delivery is live. WhatsApp (Twilio), SMS (Termii), and Email (Resend) are queued — connect those providers in project settings to enable actual outbound delivery.
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending}
          className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {saveMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save preferences
        </button>
      </div>
    </div>
  );
}

function Cfg({ label, value, tone = "muted" }: { label: string; value: string; tone?: "muted" | "critical" }) {
  return (
    <div className={`rounded-lg border p-4 ${tone === "critical" ? "border-critical/40 bg-critical/5" : "border-border bg-card"}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-sm font-medium ${tone === "critical" ? "text-critical" : ""}`}>{value}</div>
    </div>
  );
}
