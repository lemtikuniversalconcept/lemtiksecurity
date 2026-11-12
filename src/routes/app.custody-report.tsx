import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, Download, Loader2, Printer } from "lucide-react";
import { requireFeature, requireSectionAccess } from "@/lib/rbac";
import { Empty, Kpi, Notice, PageHeader, Panel, Status } from "@/components/nw";
import { EXCEPTION_LABEL, getCustodyReport, type CustodyReport } from "@/lib/custody-report.functions";

export const Route = createFileRoute("/app/custody-report")({
  head: () => ({ meta: [{ title: "Custody exceptions report · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    requireSectionAccess(context.appAccess, ["security_manager", "operator", "client_admin"]);
    requireFeature(context.appAccess, "cargo");
    return { appAccess: context.appAccess };
  },
  component: CustodyReportPage,
});

const iso = (t: number) => new Date(t + 3600_000).toISOString().slice(0, 10);
const day = (d: string | null) => (d ? new Date(d.length === 10 ? `${d}T12:00:00+01:00` : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" }) : "—");
const dt = (d: string | null) => (d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" }) : "—");
const STATUS: Record<string, string> = { planned: "Planned", in_transit: "In transit", delivered: "Delivered" };

function CustodyReportPage() {
  const today = iso(Date.now());
  const [range, setRange] = useState({ from: iso(Date.now() - 30 * 86_400_000), to: today });
  const fn = useServerFn(getCustodyReport);
  const q = useQuery({ queryKey: ["custody-report", range.from, range.to], queryFn: () => fn({ data: range }), retry: false });
  const r = q.data;
  const preset = (days: number) => setRange({ from: iso(Date.now() - days * 86_400_000), to: today });
  return (
    <div className="col g16 custody-report">
      <style>{`@media print {
        aside, nav, header, .no-print { display: none !important; }
        body, .custody-report { background: #fff !important; color: #000 !important; }
        .custody-report * { color: #000 !important; border-color: #ccc !important; }
        .custody-report .pn { break-inside: avoid; }
      }`}</style>
      <Link to="/app/cargo" className="row g4 t3 no-print" style={{ fontSize: 12 }}><ArrowLeft size={13} /> Cargo custody</Link>
      <PageHeader title="Custody exceptions report" sub={r ? `${r.org} · ${day(r.from)} to ${day(r.to)} · produced ${dt(r.generated_at)}` : "Everything that went wrong in the chain of custody, for a period"}>
        <div className="row g6 wrap no-print" style={{ alignItems: "center" }}>
          {[[7, "7 days"], [30, "30 days"], [90, "90 days"]].map(([d, l]) => <button key={d} type="button" className="b b-sm b-gh" onClick={() => preset(d as number)}>{l}</button>)}
          <input type="date" className="in" style={{ height: 32 }} value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} aria-label="From" />
          <span className="t3">to</span>
          <input type="date" className="in" style={{ height: 32 }} value={range.to} min={range.from} max={today} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} aria-label="To" />
        </div>
        {r && <button type="button" className="b b-sec b-sm no-print" onClick={() => downloadCsv(r)}><Download size={13} /> CSV</button>}
        <button type="button" className="b b-pri b-sm no-print" disabled={!r} onClick={() => window.print()}><Printer size={13} /> Print or save as PDF</button>
      </PageHeader>
      {q.isLoading ? (
        <span className="row g8 t3"><Loader2 className="h-4 w-4 animate-spin" /> Checking every custody record…</span>
      ) : q.error || !r ? (
        <Notice tone="fail">{(q.error as Error)?.message || "Couldn't build the report."}</Notice>
      ) : (
        <Body r={r} />
      )}
    </div>
  );
}

function Body({ r }: { r: CustodyReport }) {
  const s = r.summary;
  return (
    <>
      <div className="kpis">
        <Kpi label="Consignments" value={s.consignments} delta={`${s.delivered} delivered`} />
        <Kpi label="With an exception" value={s.with_exceptions} delta={s.consignments ? `${Math.round((s.with_exceptions / s.consignments) * 100)}% of consignments` : undefined} deltaClass={s.with_exceptions ? "dn-bad" : ""} />
        <Kpi label="Exceptions" value={s.exceptions} />
        <Kpi label="Broken custody chains" value={s.broken_chains} deltaClass={s.broken_chains ? "dn-bad" : ""} delta={s.broken_chains ? "Records changed or missing" : "Every chain verifies"} />
        <Kpi label="Median time to deliver" value={s.median_hours_to_deliver != null ? `${s.median_hours_to_deliver} h` : "—"} title="From departure (or creation) to delivery" />
      </div>

      <div className="grid g16 cr-two">
        <Panel title="By kind">
          {r.by_kind.length === 0 ? <Empty>No exceptions in the period.</Empty> : (
            <table className="tbl w-full" style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
              <thead><tr><th className="text-left">Kind</th><th className="text-right">Times</th><th className="text-right">Consignments</th></tr></thead>
              <tbody>{r.by_kind.map((k) => <tr key={k.kind}><td>{EXCEPTION_LABEL[k.kind]}</td><td className="text-right">{k.count}</td><td className="text-right">{k.consignments}</td></tr>)}</tbody>
            </table>
          )}
        </Panel>
        <Panel title="By carrier">
          {r.by_carrier.length === 0 ? <Empty>No consignments.</Empty> : (
            <table className="tbl w-full" style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
              <thead><tr><th className="text-left">Carrier</th><th className="text-right">Consignments</th><th className="text-right">With exceptions</th><th className="text-right">Exceptions</th></tr></thead>
              <tbody>{r.by_carrier.map((c) => <tr key={c.carrier}><td>{c.carrier}</td><td className="text-right">{c.consignments}</td><td className="text-right">{c.with_exceptions}</td><td className="text-right">{c.exceptions}</td></tr>)}</tbody>
            </table>
          )}
        </Panel>
      </div>

      {r.by_party.length > 0 && (
        <Panel title="Hand-over parties">
          <span className="t3" style={{ fontSize: 12 }}>Everyone named as handing cargo over or receiving it, with the seal problems and exceptions recorded at their hand-overs.</span>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl w-full" style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
              <thead><tr><th className="text-left">Party</th><th className="text-right">Hand-overs</th><th className="text-right">Seal problems</th><th className="text-right">Exceptions</th></tr></thead>
              <tbody>{r.by_party.map((p) => <tr key={p.party}><td>{p.party}</td><td className="text-right">{p.handovers}</td><td className="text-right">{p.seal_issues}</td><td className="text-right">{p.exceptions}</td></tr>)}</tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title="Exceptions" meta={r.exceptions.length || undefined}>
        {r.exceptions.length === 0 ? <Empty>Nothing went wrong in any chain of custody in the period.</Empty> : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl w-full" style={{ fontSize: 12.5 }}>
              <thead><tr><th className="text-left">When</th><th className="text-left">Consignment</th><th className="text-left">What</th><th className="text-left">Recorded by</th></tr></thead>
              <tbody>
                {r.exceptions.map((x, i) => (
                  <tr key={i} style={{ verticalAlign: "top" }}>
                    <td>{dt(x.at)}</td>
                    <td><Link to="/app/cargo/$id" params={{ id: x.consignment_id }} className="mono hover:underline">{x.reference}</Link>{x.seq ? <div className="t3">record {x.seq}</div> : null}</td>
                    <td><b>{EXCEPTION_LABEL[x.kind]}</b><div className="t3">{x.detail}{x.party ? ` · ${x.party}` : ""}</div></td>
                    <td>{x.by ?? "—"}{x.via === "driver_link" ? <div className="t3">driver link</div> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Consignments" meta={r.consignments.length || undefined}>
        {r.consignments.length === 0 ? <Empty>No consignments in the period.</Empty> : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl w-full" style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
              <thead><tr><th className="text-left">Reference</th><th className="text-left">Route</th><th className="text-left">Carrier</th><th className="text-left">Status</th><th className="text-right">Records</th><th className="text-left">Chain</th><th className="text-right">Exceptions</th></tr></thead>
              <tbody>
                {r.consignments.map((c) => (
                  <tr key={c.id} style={{ verticalAlign: "top" }}>
                    <td><Link to="/app/cargo/$id" params={{ id: c.id }} className="mono hover:underline">{c.reference}</Link><div className="t3 trunc" style={{ maxWidth: 220 }}>{c.description}</div></td>
                    <td>{c.route || "—"}</td>
                    <td>{c.carrier ?? "—"}</td>
                    <td>{STATUS[c.status] ?? c.status}{c.delivered_at ? <div className="t3">{dt(c.delivered_at)}</div> : null}</td>
                    <td className="text-right">{c.records}</td>
                    <td>{c.chain_intact ? <Status tone="ok">Verifies</Status> : <Status tone="fail">Broken</Status>}</td>
                    <td className="text-right">{c.exceptions || ""}{c.kinds.length ? <div className="t3">{c.kinds.map((k) => EXCEPTION_LABEL[k]).join(", ")}</div> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <p className="t3" style={{ fontSize: 12 }}>
        Covers consignments created in the period or with a custody record in it (cancelled ones are left out), Lagos time. A gap is time in transit with no record for longer than the consignment's limit. A record counts as entered late when it was saved more than 30 minutes after the time on the recording device. Each chain is checked record by record against its fingerprints.
      </p>
      <style>{`.cr-two{grid-template-columns:repeat(2,minmax(0,1fr))}@media (max-width:1000px){.cr-two{grid-template-columns:minmax(0,1fr)}}`}</style>
    </>
  );
}

function downloadCsv(r: CustodyReport) {
  const q = (c: unknown) => { const s = c == null ? "" : String(c); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows: unknown[][] = [
    ["Custody exceptions report", r.org, r.from, r.to, `produced ${r.generated_at}`],
    [],
    ["When (UTC)", "Consignment", "Record", "Kind", "Detail", "Party", "Recorded by", "Via"],
    ...r.exceptions.map((x) => [x.at, x.reference, x.seq, EXCEPTION_LABEL[x.kind], x.detail, x.party, x.by, x.via]),
    [],
    ["Consignment", "Description", "Route", "Carrier", "Consignee", "Status", "Created (UTC)", "Delivered (UTC)", "Records", "Chain verifies", "Exceptions"],
    ...r.consignments.map((c) => [c.reference, c.description, c.route, c.carrier, c.consignee, c.status, c.created_at, c.delivered_at, c.records, c.chain_intact ? "yes" : "no", c.exceptions]),
  ];
  const url = URL.createObjectURL(new Blob([rows.map((x) => x.map(q).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `custody-exceptions-${r.from}-to-${r.to}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
