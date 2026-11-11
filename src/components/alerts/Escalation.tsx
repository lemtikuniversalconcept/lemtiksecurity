import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Send, Trash2 } from "lucide-react";
import { Notice, Switch } from "@/components/nw";
import { getEscalationPolicy, listAlertDeliveries, saveEscalationPolicy, type EscalationStep } from "@/lib/escalation.functions";
import { getMyTelegram, startTelegramLink, unlinkTelegram } from "@/lib/telegram.functions";

const ROLE_LABEL: Record<string, string> = { supervisor: "Supervisors", manager: "Security managers", client_admin: "Client admins" };
const CHANNEL_LABEL: Record<string, string> = { in_app: "In-app", email: "Email", telegram: "Telegram" };
const ROLES = ["supervisor", "manager", "client_admin"] as const;
const CHANNELS = ["in_app", "email", "telegram"] as const;

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
          <TelegramCard />
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
                <span className="t3">· Push comes next</span>
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

/** The signed-in user's own Telegram link. Anyone can link; alerts only arrive if a chain step includes Telegram and their role. */
function TelegramCard() {
  const getFn = useServerFn(getMyTelegram);
  const startFn = useServerFn(startTelegramLink);
  const stopFn = useServerFn(unlinkTelegram);
  const q = useQuery({ queryKey: ["my-telegram"], queryFn: () => getFn(), refetchInterval: (query) => (query.state.data && !query.state.data.linked ? 5_000 : false) });
  const start = useMutation({
    mutationFn: () => startFn(),
    onSuccess: (r) => {
      const w = window.open(r.url, "_blank", "noopener");
      if (!w) window.location.href = r.url; // popup blocked (common on phones)
      toast.message("Telegram opened. Press Start in the bot chat to finish.");
    },
    onError: (e) => toast.error((e as Error).message),
  });
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
        <button type="button" className="b b-sm b-sec" disabled={stop.isPending} onClick={() => stop.mutate()}>Unlink</button>
      ) : (
        <button type="button" className="b b-sm b-pri" disabled={start.isPending} onClick={() => start.mutate()}>{start.isPending ? <Loader2 size={13} className="animate-spin" /> : null} Connect Telegram</button>
      ))}
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
