import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RefreshCw, Ship } from "lucide-react";
import { requireSectionAccess } from "@/lib/rbac";
import { Empty, Notice, PageHeader, Panel, Status, timeAgo, useNow, type Tone } from "@/components/nw";
import { IncomingRecordShares } from "@/components/shares/SharesPanels";
import { getResponderBoard, type BoardItem } from "@/lib/responder-board.functions";
import { RESPONDER_STATUS_LABEL } from "@/lib/respond.functions";

export const Route = createFileRoute("/app/responder")({
  head: () => ({ meta: [{ title: "Responder board · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    requireSectionAccess(context.appAccess, ["security_manager", "operator", "client_admin"]);
    return { appAccess: context.appAccess };
  },
  component: BoardPage,
});

const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" }) : "—");
const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" }) : "—");
const km = (m: number | null) => (m == null ? null : m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);
const STATUS_TONE: Record<string, Tone> = { sent: "fail", acknowledged: "warn", dispatched: "warn", on_scene: "blue", resolved: "ok", withdrawn: "off" };
const ENDED: Record<NonNullable<BoardItem["ended"]>, string> = { resolved: "Resolved", withdrawn: "Withdrawn by the operator", expired: "Expired" };

function BoardPage() {
  const load = useServerFn(getResponderBoard);
  const q = useQuery({ queryKey: ["responder-board"], queryFn: () => load(), refetchInterval: 20_000 });
  const now = useNow(30_000);
  const items = q.data?.items ?? [];
  const col = (c: BoardItem["column"]) => items.filter((i) => i.column === c);
  const incoming = col("incoming");

  return (
    <div className="col g16">
      <PageHeader title="Responder board" sub="Emergency hand-offs operators have sent you. Open one to see the boat's live position and track, then confirm receipt, dispatch and arrival. The operator sees each step with your name.">
        <button type="button" className="b b-sec b-sm" onClick={() => q.refetch()} disabled={q.isFetching}>
          {q.isFetching ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
        </button>
      </PageHeader>
      {q.error && <Notice tone="fail">{(q.error as Error).message}</Notice>}
      {incoming.length > 0 && <Notice tone="fail">{incoming.length} new hand-off{incoming.length === 1 ? "" : "s"} waiting for you to confirm receipt.</Notice>}

      <div className="grid g16 board-cols">
        <Column title="Incoming" hint="Not yet confirmed" list={incoming} now={now} loading={q.isLoading} empty="Nothing waiting." />
        <Column title="Active" hint="Received, dispatched or on scene" list={col("active")} now={now} loading={q.isLoading} empty="No active hand-offs." />
        <Column title="History" hint="Last 30 days" list={col("history")} now={now} loading={q.isLoading} empty="No finished hand-offs in the last 30 days." />
      </div>

      <IncomingRecordShares />
      <style>{`.board-cols{grid-template-columns:repeat(3,minmax(0,1fr))}@media (max-width:1100px){.board-cols{grid-template-columns:minmax(0,1fr)}}`}</style>
    </div>
  );
}

function Column({ title, hint, list, now, loading, empty }: { title: string; hint: string; list: BoardItem[]; now: number; loading: boolean; empty: string }) {
  return (
    <Panel title={title} meta={list.length || undefined}>
      <div className="col g8">
        <span className="t3" style={{ fontSize: 12 }}>{hint}</span>
        {loading ? <Empty>Loading…</Empty> : list.length === 0 ? <Empty>{empty}</Empty> : list.map((i) => <Card key={i.id} i={i} now={now} />)}
      </div>
    </Panel>
  );
}

function Card({ i, now }: { i: BoardItem; now: number }) {
  const status = i.ended ? ENDED[i.ended] : i.status === "sent" && i.first_viewed_at ? "Opened, not yet confirmed" : RESPONDER_STATUS_LABEL[i.status] ?? i.status;
  const inner = (
    <div className="card col g4" style={{ padding: "10px 12px", fontSize: 12.5, borderColor: i.column === "incoming" ? "var(--s5, #F2384B)" : undefined }}>
      <div className="row g8" style={{ alignItems: "center" }}>
        <Ship size={14} />
        <b className="f1 trunc">{i.boat ?? "Unknown boat"}</b>
        <Status tone={i.ended ? (i.ended === "resolved" ? "ok" : "off") : STATUS_TONE[i.status] ?? "neutral"}>{status}</Status>
      </div>
      <span className="t2">From {i.from_org}{i.sent_by ? ` (${i.sent_by})` : ""} · {i.column === "history" ? dt(i.sent_at) : `${clock(i.sent_at)}, ${timeAgo(i.sent_at, now)}`}</span>
      {(i.voyage || i.aboard != null || i.distance_m != null) && (
        <span className="t3">{[i.voyage ? `Voyage "${i.voyage}"` : null, i.aboard != null ? `${i.aboard} aboard` : null, km(i.distance_m) ? `${km(i.distance_m)} from you` : null].filter(Boolean).join(" · ")}</span>
      )}
      {i.last_update && <span className="t3">Last: {RESPONDER_STATUS_LABEL[i.last_update.status] ?? i.last_update.status} by {i.last_update.by_name}, {timeAgo(i.last_update.at, now)}</span>}
    </div>
  );
  return i.column === "history" ? inner : <Link to="/app/responder/$id" params={{ id: i.id }} className="hover:opacity-90">{inner}</Link>;
}
