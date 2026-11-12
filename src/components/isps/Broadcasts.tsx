import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, Megaphone } from "lucide-react";
import { Empty, Panel, Status, type Tone } from "@/components/nw";
import { acknowledgeIspsBroadcast, listIspsBroadcasts, listMyIspsBroadcasts, type BroadcastLog } from "@/lib/isps.functions";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const took = (from: string, to: string | null) => {
  if (!to) return null;
  const m = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 60_000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
const CHANNEL: Record<string, string> = { in_app: "app", push: "push", telegram: "Telegram", email: "email" };
const KIND: Record<string, string> = { level_change: "Level change", authority_notice: "Authority notice", reminder: "Reminder" };

/** Shown to anyone with a security level change they haven't acknowledged yet. */
export function MyIspsAcks() {
  const qc = useQueryClient();
  const list = useServerFn(listMyIspsBroadcasts);
  const ack = useServerFn(acknowledgeIspsBroadcast);
  const q = useQuery({ queryKey: ["isps-my-acks"], queryFn: () => list(), refetchInterval: 60_000 });
  const m = useMutation({
    mutationFn: (recipient_id: string) => ack({ data: { recipient_id } }),
    onSuccess: () => {
      toast.success("Acknowledged");
      qc.invalidateQueries({ queryKey: ["isps-my-acks"] });
      qc.invalidateQueries({ queryKey: ["isps-broadcasts"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const rows = q.data ?? [];
  if (!rows.length) return null;
  return (
    <div className="col g8" role="alert">
      {rows.map((b) => (
        <div key={b.recipient_id} className="col g6" style={{ border: `2px solid ${b.level === 3 ? "var(--s5, #F2384B)" : "var(--s4, #E8590C)"}`, borderRadius: 10, padding: "12px 14px" }}>
          <div className="row g8 wrap" style={{ alignItems: "center" }}>
            <Megaphone size={16} />
            <b className="f1" style={{ fontSize: 14 }}>{b.title}</b>
            <span className="t3" style={{ fontSize: 12 }}>{when(b.created_at)}</span>
          </div>
          <span style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{b.body}</span>
          <button type="button" className="b b-pri b-sm" style={{ alignSelf: "flex-start" }} disabled={m.isPending} onClick={() => m.mutate(b.recipient_id)}>
            {m.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} I've read this
          </button>
        </div>
      ))}
    </div>
  );
}

/** Who was told about each level change, notice and reminder, and when each person acknowledged. */
export function BroadcastsPanel() {
  const list = useServerFn(listIspsBroadcasts);
  const q = useQuery({ queryKey: ["isps-broadcasts"], queryFn: () => list(), refetchInterval: 60_000 });
  const [open, setOpen] = useState<string | null>(null);
  const rows = q.data ?? [];
  return (
    <Panel title="Who was told" icon={<Megaphone size={15} className="ic" />} meta={rows.length || undefined}>
      <div className="col g8">
        <span className="t3" style={{ fontSize: 12 }}>
          Level changes go to everyone in the organisation by app, push and Telegram (email for level 2 and 3). Anyone who hasn't acknowledged is reminded up to 3 times. Drill and plan reminders go to managers and operators in working hours.
        </span>
        {q.isLoading ? (
          <Empty>Loading…</Empty>
        ) : rows.length === 0 ? (
          <Empty>Nothing sent yet. Changing a security level sends the first one.</Empty>
        ) : (
          rows.map((b) => <BroadcastRow key={b.id} b={b} open={open === b.id} onToggle={() => setOpen(open === b.id ? null : b.id)} />)
        )}
      </div>
    </Panel>
  );
}

function BroadcastRow({ b, open, onToggle }: { b: BroadcastLog; open: boolean; onToggle: () => void }) {
  const acked = b.recipients.filter((r) => r.acknowledged_at).length;
  const total = b.recipients.length;
  const tone: Tone = !b.require_ack ? "neutral" : acked === total ? "ok" : b.closed_at ? "fail" : "warn";
  const label = !b.require_ack ? `Sent to ${total}` : `${acked} of ${total} acknowledged`;
  return (
    <div className="col g6" style={{ borderTop: "1px solid var(--line-1)", paddingTop: 8 }}>
      <button type="button" className="row g8 w-full text-left" onClick={onToggle} aria-expanded={open}>
        <span className="col f1" style={{ minWidth: 0 }}>
          <b className="trunc" style={{ fontSize: 13 }}>{b.title}</b>
          <span className="t3" style={{ fontSize: 12 }}>
            {KIND[b.kind] ?? b.kind} · {when(b.created_at)}{b.created_by_name ? ` · by ${b.created_by_name}` : ""}{b.chases_sent ? ` · ${b.chases_sent} reminder${b.chases_sent === 1 ? "" : "s"} sent` : ""}
          </span>
        </span>
        <Status tone={tone}>{label}</Status>
      </button>
      {open && (
        <div style={{ overflowX: "auto" }}>
          <table className="tbl w-full" style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
            <thead>
              <tr><th className="text-left">Person</th><th className="text-left">Reached by</th><th className="text-left">Sent</th><th className="text-left">Acknowledged</th><th className="text-right">Took</th></tr>
            </thead>
            <tbody>
              {b.recipients.map((r, i) => (
                <tr key={i}>
                  <td>{r.name ?? "—"}<div className="t3">{r.role === "officer" ? "Field officer" : r.role === "supervisor" ? "Operator" : r.role === "client_admin" ? "Client admin" : r.role === "manager" ? "Security manager" : r.role}</div></td>
                  <td>{r.channels_sent.map((c) => CHANNEL[c] ?? c).join(", ") || <span className="t3">Not reached</span>}{r.channels_failed.length ? <div className="t3">failed: {r.channels_failed.map((c) => CHANNEL[c] ?? c).join(", ")}</div> : null}</td>
                  <td>{when(r.first_sent_at)}</td>
                  <td>{r.acknowledged_at ? `${when(r.acknowledged_at)}${r.acknowledged_via === "telegram" ? " (Telegram)" : ""}` : b.require_ack ? <span style={{ fontWeight: 600 }}>Not yet</span> : <span className="t3">Not needed</span>}</td>
                  <td className="text-right">{took(r.first_sent_at, r.acknowledged_at) ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
