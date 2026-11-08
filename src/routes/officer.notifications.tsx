import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Sev, Switch, timeAgo } from "@/components/nw";
import { OHeader } from "@/components/officer/kit";
import {
  getAlertPreferences,
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  updateAlertPreferences,
} from "@/lib/alerts.functions";

type NotificationRow = {
  id: string;
  title: string;
  body?: string | null;
  severity: number;
  sent_at: string;
  incident_id?: string | null;
  read?: boolean;
  alert_type?: string | null;
};

const OFFICER_GROUPS = {
  dispatches: ["incident_assigned", "incident_critical", "incident_high", "sos"],
  shiftReminders: ["missed_checkin", "prolonged_missed", "shift_start", "shift_handover"],
  commandUpdates: ["daily_summary", "weekly_brief", "osint_threat", "inventory_threshold", "system_test"],
} as const;

export const Route = createFileRoute("/officer/notifications")({
  component: OfficerNotifications,
});

function OfficerNotifications() {
  const qc = useQueryClient();
  const listNotifs = useServerFn(listMyNotifications);
  const markRead = useServerFn(markNotificationRead);
  const markAll = useServerFn(markAllNotificationsRead);
  const getPrefs = useServerFn(getAlertPreferences);
  const updatePrefs = useServerFn(updateAlertPreferences);

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ["officer-notifications"],
    queryFn: () => listNotifs() as Promise<NotificationRow[]>,
    refetchInterval: 20_000,
  });
  const { data: prefs } = useQuery({
    queryKey: ["officer-alert-prefs"],
    queryFn: () => getPrefs(),
  });

  const unreadCount = notifications.filter((item) => !item.read).length;

  const [dispatches] = useState(true);
  const [shiftReminders, setShiftReminders] = useState(true);
  const [commandUpdates, setCommandUpdates] = useState(true);
  const [quietHours, setQuietHours] = useState(true);
  const [quietStart, setQuietStart] = useState("23:00");
  const [quietEnd, setQuietEnd] = useState("06:00");
  const [language, setLanguage] = useState<"en" | "pcm">("en");
  const [channelMap, setChannelMap] = useState<Record<string, string[]>>({});
  const [extraRecipients, setExtraRecipients] = useState<Array<{ label: string; phone: string; channels: string[]; severity_floor: number }>>([]);

  useEffect(() => {
    if (!prefs) return;
    const enabled = new Set(prefs.enabled_types ?? []);
    setShiftReminders(OFFICER_GROUPS.shiftReminders.some((item) => enabled.has(item)));
    setCommandUpdates(OFFICER_GROUPS.commandUpdates.some((item) => enabled.has(item)));
    setQuietHours((prefs.quiet_hours as { enabled: boolean } | undefined)?.enabled ?? true);
    setQuietStart((prefs.quiet_hours as { start: string } | undefined)?.start ?? "23:00");
    setQuietEnd((prefs.quiet_hours as { end: string } | undefined)?.end ?? "06:00");
    setLanguage((prefs.language as "en" | "pcm") ?? "en");
    setChannelMap((prefs.channel_map as Record<string, string[]>) ?? {});
    setExtraRecipients((prefs.extra_recipients as Array<{ label: string; phone: string; channels: string[]; severity_floor: number }>) ?? []);
  }, [prefs]);

  const readMut = useMutation({
    mutationFn: (id: string) => markRead({ data: { alert_id: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["officer-notifications"] }),
  });
  const allMut = useMutation({
    mutationFn: () => markAll(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["officer-notifications"] });
    },
  });
  const savePrefs = useMutation({
    mutationFn: () =>
      updatePrefs({
        data: {
          enabled_types: [
            ...(dispatches ? OFFICER_GROUPS.dispatches : []),
            ...(shiftReminders ? OFFICER_GROUPS.shiftReminders : []),
            ...(commandUpdates ? OFFICER_GROUPS.commandUpdates : []),
          ],
          channel_map: channelMap,
          quiet_hours: { enabled: quietHours, start: quietStart, end: quietEnd },
          extra_recipients: extraRecipients,
          language,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["officer-alert-prefs"] });
      toast.success("Preferences saved");
    },
    onError: (e: Error) => toast.error(e.message || "Preferences didn't save."),
  });

  return (
    <>
      <OHeader title="Alerts" eyebrow={unreadCount ? `${unreadCount} unread` : "All read"} />
      <div className="o-b">
        <div className="row g8">
          <span className="t2 f1">{notifications.length ? `${notifications.length} recent` : ""}</span>
          <button type="button" className="b b-sm b-sec" onClick={() => allMut.mutate()} disabled={!unreadCount || allMut.isPending}>
            {allMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Mark all read
          </button>
        </div>

        {isLoading ? (
          <div className="o-card t3">Loading…</div>
        ) : notifications.length === 0 ? (
          <div className="o-card t3">No alerts yet.</div>
        ) : (
          <div className="col g8">
            {notifications.map((item) => (
              <article key={item.id} className="o-card col g6" style={{ borderColor: item.read ? undefined : "var(--blue-ln)" }}>
                <div className="row g8">
                  {item.severity != null && item.severity >= 4 ? <Sev level={item.severity} /> : null}
                  <b className="f1">{item.title}</b>
                  <span className="mono t3" style={{ fontSize: 11.5 }}>
                    {timeAgo(item.sent_at)}
                  </span>
                </div>
                {item.body && (
                  <span className="t2" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
                    {item.body}
                  </span>
                )}
                <div className="row g8">
                  {item.incident_id && (
                    <Link to="/officer/incident/$id" params={{ id: item.incident_id }} className="b b-sm b-sec">
                      View incident
                    </Link>
                  )}
                  {!item.read && (
                    <button type="button" className="b b-sm b-gh" onClick={() => readMut.mutate(item.id)}>
                      Mark read
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}

        <div className="o-card col g12">
          <div className="row g8">
            <b className="f1">What reaches your phone</b>
            <button type="button" className="b b-sm b-pri" onClick={() => savePrefs.mutate()} disabled={savePrefs.isPending}>
              {savePrefs.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
            </button>
          </div>
          <PrefRow label="Dispatches and SOS" description="Always on. These can't be turned off." checked locked />
          <PrefRow label="Shift reminders" description="Upcoming patrols, check-ins and handovers." checked={shiftReminders} onChange={setShiftReminders} />
          <PrefRow label="Command updates" description="Messages, summaries and system notices." checked={commandUpdates} onChange={setCommandUpdates} />
          <PrefRow label="Quiet hours" description="Hold other alerts during rest. Dispatches and SOS still come through." checked={quietHours} onChange={setQuietHours} />
          {quietHours && (
            <div className="grid grid-cols-2 gap-3">
              <label className="fl">
                <span className="lbl">From</span>
                <input className="in mono" type="time" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} />
              </label>
              <label className="fl">
                <span className="lbl">To</span>
                <input className="in mono" type="time" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} />
              </label>
            </div>
          )}
          <label className="fl">
            <span className="lbl">Language</span>
            <select className="in" value={language} onChange={(e) => setLanguage(e.target.value as "en" | "pcm")}>
              <option value="en">English</option>
              <option value="pcm">Pidgin</option>
            </select>
          </label>
        </div>
      </div>
    </>
  );
}

function PrefRow({ label, description, checked, onChange, locked = false }: { label: string; description: string; checked: boolean; onChange?: (v: boolean) => void; locked?: boolean }) {
  return (
    <div className="row g12">
      <span className="col f1" style={{ minWidth: 0 }}>
        <b style={{ fontSize: 14 }}>{label}</b>
        <span className="t3" style={{ fontSize: 12.5 }}>
          {description}
        </span>
      </span>
      <Switch on={checked} onChange={(v) => onChange?.(v)} label={label} disabled={locked} />
    </div>
  );
}
