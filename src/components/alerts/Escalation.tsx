import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BellRing, Loader2, Plus, Send, Trash2 } from "lucide-react";
import { Notice, Switch } from "@/components/nw";
import { getEscalationPolicy, listAlertDeliveries, saveEscalationPolicy, type EscalationStep } from "@/lib/escalation.functions";
import { getPushStatus, removePushSubscription, savePushSubscription, sendPushTest } from "@/lib/push.functions";
import { getMyTelegram, sendTelegramTest, startTelegramLink, unlinkTelegram } from "@/lib/telegram.functions";
import { TelegramReportsCard } from "@/components/alerts/TelegramReports";

const ROLE_LABEL: Record<string, string> = { supervisor: "Supervisors", manager: "Security managers", client_admin: "Client admins" };
const CHANNEL_LABEL: Record<string, string> = { in_app: "In-app", push: "Push", email: "Email", telegram: "Telegram" };
const ROLES = ["supervisor", "manager", "client_admin"] as const;
const CHANNELS = ["in_app", "push", "email", "telegram"] as const;

/** Security manager settings: who is told about a serious movement alert, and when, until someone acknowledges it. */
export function EscalationPanel({ canConfigure }: { canConfigure: boolean }) {
  const getFn = useServerFn(getEscalationPolicy);
  const saveFn = useServerFn(saveEscalationPolicy);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["escalation-policy"], queryFn: () => getFn() });
  const [enabled, setEnabled] = useState(true);
  const [minSev, setMinSev] = useState(4);
  const [steps, setSteps] = useState<EscalationStep[]>([]);
  useEffect(() => {
    if (!q.data) return;
    setEnabled(q.data.enabled);
    setMinSev(q.data.min_severity);
    setSteps(q.data.steps);
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => saveFn({ data: { enabled, min_severity: minSev, steps } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["escalation-policy"] });
      toast.success("Escalation chain saved");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const patch = (i: number, p: Partial<EscalationStep>) => setSteps((c) => c.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const toggle = <T extends string>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const valid = steps.length > 0 && steps.every((s) => s.roles.length > 0 && s.channels.length > 0);

  return (
    <section className="pn" style={{ flex: "1 1 100%", minWidth: 0 }} id="escalation">
      <div className="pn-h">
        <h3>Escalation chain</h3>
        <span className="meta">Protected movement alerts</span>
        <span className="flex-auto" />
        {canConfigure && q.data && (
          <button type="button" className="b b-sm b-pri" onClick={() => save.mutate()} disabled={save.isPending || !valid}>
            {save.isPending && <Loader2 className="h-3 w-3 animate-spin" />} Save
          </button>
        )}
      </div>
      {!q.data ? (
        <div className="empty row g8" style={{ padding: 12 }}><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>
      ) : (
        <div className="col g12" style={{ padding: 12 }}>
          <span className="t3" style={{ fontSize: 12.5 }}>
            When a serious alert (SOS, man overboard, possible hijack, off route, overdue…) isn't acknowledged, each step below is sent in turn.
            Acknowledging the alert stops the chain. Every send is logged on the alert.
            {q.data.is_default ? " These are the default steps; save to make them your own." : q.data.updated_by_name ? ` Last changed by ${q.data.updated_by_name}.` : ""}
          </span>
          {!q.data.email_configured && <Notice tone="warn">Email isn't set up on this system yet, so email steps are logged as skipped.</Notice>}
          <PushCard />
          <TelegramCard />
          <TelegramReportsCard />
          <div className="row g12 wrap" style={{ alignItems: "center" }}>
            <Switch on={enabled} onChange={(v) => canConfigure && setEnabled(v)} label="Escalation on" />
            <b>{enabled ? "On" : "Off"}</b>
            <label className="row g8" style={{ alignItems: "center" }}>
              <span className="lbl">For alerts of severity</span>
              <select className="in" style={{ width: 90 }} value={minSev} disabled={!canConfigure} onChange={(e) => setMinSev(Number(e.target.value))}>
                {[3, 4, 5].map((s) => <option key={s} value={s}>S{s}+</option>)}
              </select>
            </label>
          </div>
          {steps.map((s, i) => (
            <div key={i} className="card col g8" style={{ padding: "10px 12px" }}>
              <div className="row g8 wrap" style={{ alignItems: "center" }}>
                <b>Step {i + 1}</b>
                <label className="row g6" style={{ alignItems: "center" }}>
                  <input className="in" type="number" min={0} max={240} style={{ width: 72 }} value={s.after_min} disabled={!canConfigure} onChange={(e) => patch(i, { after_min: Math.max(0, Math.min(240, Number(e.target.value) || 0)) })} aria-label={`Step ${i + 1} delay in minutes`} />
                  <span className="t3">{s.after_min === 0 ? "min (straight away)" : "min after the alert, if still not acknowledged"}</span>
                </label>
                <span className="flex-auto" />
                {canConfigure && steps.length > 1 && <button type="button" className="ibtn" aria-label={`Remove step ${i + 1}`} onClick={() => setSteps((c) => c.filter((_, j) => j !== i))}><Trash2 size={14} /></button>}
              </div>
              <div className="row g12 wrap" style={{ fontSize: 13 }}>
                <span className="t3">Tell</span>
                {ROLES.map((r) => (
                  <label key={r} className="row g4" style={{ alignItems: "center" }}>
                    <input type="checkbox" checked={s.roles.includes(r)} disabled={!canConfigure} onChange={() => patch(i, { roles: toggle(s.roles, r) })} /> {ROLE_LABEL[r]}
                  </label>
                ))}
              </div>
              <div className="row g12 wrap" style={{ fontSize: 13 }}>
                <span className="t3">By</span>
                {CHANNELS.map((c) => (
                  <label key={c} className="row g4" style={{ alignItems: "center" }}>
                    <input type="checkbox" checked={s.channels.includes(c)} disabled={!canConfigure} onChange={() => patch(i, { channels: toggle(s.channels, c) })} /> {CHANNEL_LABEL[c]}
                  </label>
                ))}
              </div>
            </div>
          ))}
          {canConfigure && steps.length < 5 && (
            <button type="button" className="b b-sm b-sec self-start" onClick={() => setSteps((c) => [...c, { after_min: (c[c.length - 1]?.after_min ?? 0) + 5, roles: ["manager"], channels: ["email"] }])}>
              <Plus size={13} /> Add step
            </button>
          )}
          {!canConfigure && <span className="t3" style={{ fontSize: 12 }}>Only security managers can change the escalation chain.</span>}
        </div>
      )}
    </section>
  );
}

function urlB64ToUint8Array(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Push notifications on this browser or phone. Each device is turned on separately. */
function PushCard() {
  const statusFn = useServerFn(getPushStatus);
  const saveFn = useServerFn(savePushSubscription);
  const removeFn = useServerFn(removePushSubscription);
  const testFn = useServerFn(sendPushTest);
  const q = useQuery({ queryKey: ["push-status"], queryFn: () => statusFn() });
  const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const [here, setHere] = useState<PushSubscription | null>(null);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">(supported ? Notification.permission : "unsupported");
  useEffect(() => {
    if (!supported) return;
    navigator.serviceWorker.getRegistration().then((r) => r?.pushManager.getSubscription()).then((s) => setHere(s ?? null)).catch(() => null);
  }, [supported]);
  const on = useMutation({
    mutationFn: async () => {
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p !== "granted") throw new Error(p === "denied" ? "Notifications are blocked for this site. Allow them in your browser settings, then try again." : "Notifications weren't allowed.");
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(q.data!.public_key) }));
      const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await saveFn({ data: { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, device_label: navigator.userAgent.slice(0, 120) } });
      setHere(sub);
    },
    onSuccess: () => { q.refetch(); toast.success("Notifications on for this device"); },
    onError: (e) => toast.error((e as Error).message),
  });
  const off = useMutation({
    mutationFn: async () => {
      if (!here) return;
      await removeFn({ data: { endpoint: here.endpoint } });
      await here.unsubscribe().catch(() => null);
      setHere(null);
    },
    onSuccess: () => { q.refetch(); toast.success("Notifications off for this device"); },
    onError: (e) => toast.error((e as Error).message),
  });
  const test = useMutation({ mutationFn: () => testFn(), onSuccess: (r) => toast.success(`Test sent to ${r.sent} device${r.sent === 1 ? "" : "s"}`), onError: (e) => toast.error((e as Error).message) });
  const s = q.data;
  if (!s) return null;
  return (
    <div className="card row g10 wrap" style={{ padding: "10px 12px", alignItems: "center" }}>
      <BellRing size={16} />
      <span className="col f1" style={{ minWidth: 0 }}>
        <b>Notifications on this device</b>
        <span className="t3" style={{ fontSize: 12 }}>
          {!s.configured ? "Push isn't set up on this system yet."
            : !supported ? "This browser can't receive push notifications. On iPhone, add Lemtik to your home screen first (Share → Add to Home Screen), then open it from there."
            : here ? `On for this device${s.devices > 1 ? ` (and ${s.devices - 1} other${s.devices > 2 ? "s" : ""})` : ""}. Alerts pop up even when Lemtik is closed.`
            : perm === "denied" ? "Blocked for this site. Allow notifications in your browser settings."
            : `Get alerts as phone or desktop notifications, even with Lemtik closed.${s.devices ? ` On for ${s.devices} other device${s.devices > 1 ? "s" : ""}.` : ""}`}
        </span>
      </span>
      {s.configured && supported && (here ? (
        <span className="row g6">
          <button type="button" className="b b-sm b-pri" disabled={test.isPending} onClick={() => test.mutate()}>{test.isPending ? <Loader2 size={13} className="animate-spin" /> : null} Send test</button>
          <button type="button" className="b b-sm b-sec" disabled={off.isPending} onClick={() => off.mutate()}>Turn off</button>
        </span>
      ) : (
        <button type="button" className="b b-sm b-pri" disabled={on.isPending || perm === "denied"} onClick={() => on.mutate()}>{on.isPending ? <Loader2 size={13} className="animate-spin" /> : null} Turn on</button>
      ))}
    </div>
  );
}

/** The signed-in user's own Telegram link. Anyone can link; alerts only arrive if a chain step includes Telegram and their role. */
function TelegramCard() {
  const getFn = useServerFn(getMyTelegram);
  const startFn = useServerFn(startTelegramLink);
  const stopFn = useServerFn(unlinkTelegram);
  const q = useQuery({ queryKey: ["my-telegram"], queryFn: () => getFn(), refetchInterval: (query) => (query.state.data && !query.state.data.linked ? 5_000 : false) });
  const [pending, setPending] = useState<null | { url: string; app_url: string; bot: string; command: string }>(null);
  const start = useMutation({
    mutationFn: () => startFn(),
    onSuccess: (r) => setPending(r),
    onError: (e) => toast.error((e as Error).message),
  });
  const testFn = useServerFn(sendTelegramTest);
  const test = useMutation({ mutationFn: () => testFn(), onSuccess: () => toast.success("Test sent. Check Telegram."), onError: (e) => toast.error((e as Error).message) });
  const stop = useMutation({ mutationFn: () => stopFn(), onSuccess: () => { q.refetch(); toast.success("Telegram unlinked"); }, onError: (e) => toast.error((e as Error).message) });
  const t = q.data;
  if (!t) return null;
  return (
    <div className="card row g10 wrap" style={{ padding: "10px 12px", alignItems: "center" }}>
      <Send size={16} />
      <span className="col f1" style={{ minWidth: 0 }}>
        <b>Your Telegram</b>
        <span className="t3" style={{ fontSize: 12 }}>
          {!t.configured ? "Telegram isn't set up on this system yet." : t.linked ? `Linked${t.username ? ` as @${t.username}` : t.name ? ` as ${t.name}` : ""}. Alerts arrive with an Acknowledge button.` : "Link your Telegram to get alerts on your phone, with an Acknowledge button."}
        </span>
      </span>
      {t.configured && (t.linked ? (
        <span className="row g6">
          <button type="button" className="b b-sm b-pri" disabled={test.isPending} onClick={() => test.mutate()}>{test.isPending ? <Loader2 size={13} className="animate-spin" /> : null} Send test</button>
          <button type="button" className="b b-sm b-sec" disabled={stop.isPending} onClick={() => stop.mutate()}>Unlink</button>
        </span>
      ) : (
        <button type="button" className="b b-sm b-pri" disabled={start.isPending} onClick={() => start.mutate()}>{start.isPending ? <Loader2 size={13} className="animate-spin" /> : null} Connect Telegram</button>
      ))}
      {pending && t.configured && !t.linked && (
        <div className="col g6" style={{ flex: "1 1 100%", fontSize: 12.5 }}>
          <div className="row g8 wrap">
            <a className="b b-sm b-pri" href={pending.app_url}>Open in the Telegram app</a>
            <a className="b b-sm b-sec" href={pending.url} target="_blank" rel="noopener noreferrer">Open t.me link</a>
          </div>
          <span className="t3">If neither opens, search for <b>@{pending.bot}</b> in Telegram and send this message (valid 15 minutes):</span>
          <span className="row g8" style={{ alignItems: "center" }}>
            <code className="mono" style={{ padding: "4px 8px", borderRadius: 6, background: "var(--bg-2, rgba(127,127,127,.12))" }}>{pending.command}</code>
            <button type="button" className="b b-sm b-gh" onClick={() => navigator.clipboard?.writeText(pending.command).then(() => toast.success("Copied"), () => null)}>Copy</button>
          </span>
          <span className="t3">This card updates by itself once the bot confirms.</span>
        </div>
      )}
    </div>
  );
}

const STATUS_TONE: Record<string, string> = { sent: "tg-ok", failed: "tg-fail", skipped: "tg-warn" };

/** Who was told about one movement alert, how and when. */
export function DeliveryLog({ alertId }: { alertId: string }) {
  const fn = useServerFn(listAlertDeliveries);
  const q = useQuery({ queryKey: ["alert-deliveries", alertId], queryFn: () => fn({ data: { alert_id: alertId } }), refetchInterval: 30_000 });
  if (q.isLoading) return <span className="row g8 t3" style={{ fontSize: 12 }}><Loader2 size={12} className="animate-spin" /> Loading delivery log…</span>;
  const d = q.data;
  if (!d) return null;
  return (
    <div className="col g4" style={{ fontSize: 12 }}>
      {d.deliveries.length === 0 ? (
        <span className="t3">Nothing sent yet{d.escalation_done ? " (this alert isn't escalated)" : ". The first step goes out within a minute"}.</span>
      ) : (
        d.deliveries.map((x, i) => (
          <span key={i} className="row g6 wrap" style={{ alignItems: "center" }}>
            <span className="mono t3">{new Date(x.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
            <span>Step {x.step + 1}</span>
            <span>{CHANNEL_LABEL[x.channel] ?? x.channel}</span>
            <span>{x.recipient_label ?? ""}</span>
            <span className={`tg ${STATUS_TONE[x.status] ?? ""}`}>{x.status}</span>
            {x.detail && <span className="t3">{x.detail}</span>}
          </span>
        ))
      )}
      {d.acknowledged_at && <span className="t3">Acknowledged {new Date(d.acknowledged_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}; escalation stopped.</span>}
    </div>
  );
}
