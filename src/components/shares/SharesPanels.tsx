import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileText } from "lucide-react";
import { Empty, Panel, Status } from "@/components/nw";
import { listOutgoingShares, listSharedWithUs } from "@/lib/shares.functions";
import { SHARE_STATE, ShareRowView } from "./RecordShares";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const KIND: Record<string, string> = { incident: "Incident", voyage: "Voyage", movement_alert: "Alert" };

/** Single records (incidents, voyages, alerts) shared by this organisation, with requests waiting for approval first. */
export function OutgoingRecordShares() {
  const fn = useServerFn(listOutgoingShares);
  const q = useQuery({ queryKey: ["outgoing-shares"], queryFn: () => fn(), refetchInterval: 60_000 });
  const rows = q.data?.shares ?? [];
  const pending = rows.filter((r) => r.status === "pending_approval").length;
  return (
    <Panel title="Records shared by us" icon={<FileText size={15} className="ic" />} meta={pending ? `${pending} waiting for approval` : rows.length || undefined}>
      <div className="col g8">
        <span className="t3" style={{ fontSize: 12 }}>One incident, voyage or alert at a time, shared from its own page with a Share button. Operators' shares wait here until a manager approves them.</span>
        {q.isLoading ? <Empty>Loading…</Empty> : q.error ? <Empty>{(q.error as Error).message}</Empty> : rows.length === 0 ? <Empty>No single records shared yet.</Empty> : rows.map((s) => <ShareRowView key={s.id} s={s} role={q.data?.role ?? null} showRecord />)}
      </div>
    </Panel>
  );
}

/** Single records other organisations have shared with this one. Hidden when there are none. */
export function IncomingRecordShares() {
  const fn = useServerFn(listSharedWithUs);
  const q = useQuery({ queryKey: ["incoming-shares"], queryFn: () => fn(), refetchInterval: 60_000 });
  const rows = q.data ?? [];
  if (!rows.length) return null;
  return (
    <Panel title="Records shared with us" icon={<FileText size={15} className="ic" />} meta={rows.filter((r) => r.status === "active" && !r.acknowledged_at).length ? `${rows.filter((r) => r.status === "active" && !r.acknowledged_at).length} to acknowledge` : rows.length}>
      <div className="col g8">
        {rows.map((r) => {
          const st = SHARE_STATE[r.status];
          const row = (
            <>
              <span className="col f1" style={{ minWidth: 0 }}>
                <b className="trunc" style={{ fontSize: 13 }}>{KIND[r.record_kind]}: {r.record_label}</b>
                <span className="t3" style={{ fontSize: 12 }}>From {r.owner}{r.shared_by ? ` (${r.shared_by})` : ""} · {when(r.created_at)} · {r.purpose}</span>
              </span>
              <Status tone={r.acknowledged_at && r.status === "active" ? "ok" : r.status === "active" ? "warn" : st.tone}>{r.status === "active" ? (r.acknowledged_at ? `Acknowledged by ${r.acknowledged_by_name}` : "Not acknowledged") : st.label}</Status>
            </>
          );
          return r.status === "active" ? (
            <Link key={r.id} to="/app/shared/$id" params={{ id: r.id }} className="row g8 hover:underline" style={{ borderTop: "1px solid var(--line-1)", paddingTop: 8 }}>{row}</Link>
          ) : (
            <div key={r.id} className="row g8" style={{ borderTop: "1px solid var(--line-1)", paddingTop: 8, opacity: 0.7 }}>{row}</div>
          );
        })}
      </div>
    </Panel>
  );
}
