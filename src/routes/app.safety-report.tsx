import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Download, Loader2, Printer } from "lucide-react";
import { requireFeature, requireSectionAccess } from "@/lib/rbac";
import { Empty, Kpi, Notice, PageHeader, Panel, Status } from "@/components/nw";
import { getSafetyReport, type MonthStats, type SafetyReport } from "@/lib/safety-report.functions";

export const Route = createFileRoute("/app/safety-report")({
  head: () => ({ meta: [{ title: "Monthly safety report · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    requireSectionAccess(context.appAccess, ["security_manager", "operator", "client_admin"]);
    requireFeature(context.appAccess, "movement");
    return { appAccess: context.appAccess };
  },
  component: SafetyReportPage,
});

const KIND: Record<string, string> = {
  sos: "SOS", man_overboard: "Man overboard", zone_enter: "Entered a zone", silent: "Tracker silent", unexpected_stop: "Unexpected stop",
  checkin_missed: "Missed check-in", off_route: "Off route", overdue: "Overdue", headcount_mismatch: "Head count mismatch", curfew: "Moving in curfew",
  boarding_override: "Departed despite boarding check", possible_hijack: "Possible hijack", geofence_enter: "Entered a zone", geofence_exit: "Left a zone",
};
const kindLabel = (k: string) => KIND[k] ?? k.replace(/_/g, " ");
const dur = (s: number | null) => (s == null ? "—" : s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min ${s % 60 ? `${s % 60} s` : ""}`.trim() : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`);
const share = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");
const dt = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });

function monthOptions() {
  const out: { v: string; l: string }[] = [];
  const now = new Date(Date.now() + 3600_000);
  for (let i = 0; i < 18; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 15));
    out.push({ v: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, l: `${d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}${i === 0 ? " (so far)" : ""}` });
  }
  return out;
}

/** "+3 on last month" style comparison. Lower is better for some figures. */
function vs(cur: number | null, prev: number | null, opts: { lowerBetter?: boolean; unit?: string; fmt?: (n: number) => string } = {}) {
  if (cur == null || prev == null) return { text: prev == null ? "No figure last month" : "", cls: "" };
  const diff = cur - prev;
  if (diff === 0) return { text: "Same as last month", cls: "" };
  const f = opts.fmt ?? ((n: number) => `${n}${opts.unit ?? ""}`);
  const worse = opts.lowerBetter ? diff > 0 : diff < 0;
  return { text: `${diff > 0 ? "+" : "−"}${f(Math.abs(diff))} on last month`, cls: worse ? "dn-bad" : "" };
}
const pctOf = (n: number, d: number) => (d ? Math.round((n / d) * 100) : null);

function csv(rows: (string | number | null)[][]) {
  return rows.map((r) => r.map((c) => { const s = c == null ? "" : String(c); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n");
}
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SafetyReportPage() {
  const months = monthOptions();
  const [month, setMonth] = useState(months[1]?.v ?? months[0].v);
  const fn = useServerFn(getSafetyReport);
  const q = useQuery({ queryKey: ["safety-report", month], queryFn: () => fn({ data: { month } }) });
  const r = q.data;
  return (
    <div className="col g16 safety-report">
      <style>{`@media print {
        aside, nav, header:not(.sr-keep), .no-print { display: none !important; }
        body, .safety-report { background: #fff !important; color: #000 !important; }
        .safety-report * { color: #000 !important; border-color: #ccc !important; }
        .safety-report .pn, .safety-report .kpis { break-inside: avoid; }
      }`}</style>
      <PageHeader title="Monthly safety report" sub={r ? `${r.org} · ${r.label} · generated ${dt(r.generated_at)} Lagos time` : "Voyages, check-ins, alerts and response times for one month"}>
        <label className="row g6 no-print" style={{ fontSize: 13 }}>
          <span className="t3">Month</span>
          <select className="in" style={{ height: 32 }} value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
          </select>
        </label>
        {r && <button type="button" className="b b-sec b-sm no-print" onClick={() => downloadAll(r)}><Download size={13} /> CSV</button>}
        <button type="button" className="b b-pri b-sm no-print" onClick={() => window.print()} disabled={!r}><Printer size={13} /> Print or save as PDF</button>
      </PageHeader>

      {q.isLoading ? (
        <span className="row g8 t3"><Loader2 className="h-4 w-4 animate-spin" /> Counting the month…</span>
      ) : q.error || !r ? (
        <Notice tone="fail">{(q.error as Error)?.message || "Couldn't build the report."}</Notice>
      ) : (
        <Report r={r} />
      )}
    </div>
  );
}

function Report({ r }: { r: SafetyReport }) {
  const c = r.current, p = r.previous;
  const arrPct = pctOf(c.voyages.arr_on_time, c.voyages.arr_timed), arrPrev = pctOf(p.voyages.arr_on_time, p.voyages.arr_timed);
  const ckTotal = c.checkins.kept + c.checkins.late + c.checkins.missed;
  const empty = c.voyages.total === 0 && c.alerts.total === 0 && ckTotal === 0;
  return (
    <>
      {empty && <Notice tone="blue">Nothing was recorded for {r.label}: no voyages, check-ins or alerts. The figures below are all zero.</Notice>}
      <div className="kpis">
        <Kpi label="Voyages" value={c.voyages.total} {...k(vs(c.voyages.total, p.voyages.total))} />
        <Kpi label="Arrived on time" value={arrPct != null ? `${arrPct}%` : "—"} {...k(vs(arrPct, arrPrev, { unit: " pts" }))} title={`Within ${15} minutes of the planned arrival, out of ${c.voyages.arr_timed} voyages with both times recorded`} />
        <Kpi label="People carried" value={c.voyages.people} {...k(vs(c.voyages.people, p.voyages.people))} />
        <Kpi label="Missed check-ins" value={c.checkins.missed} {...k(vs(c.checkins.missed, p.checkins.missed, { lowerBetter: true }))} />
        <Kpi label="Serious alerts" value={c.alerts.serious} {...k(vs(c.alerts.serious, p.alerts.serious, { lowerBetter: true }))} />
        <Kpi label="Median time to acknowledge" value={dur(c.alerts.median_ack_s)} {...k(vs(c.alerts.median_ack_s, p.alerts.median_ack_s, { lowerBetter: true, fmt: (n) => dur(n) }))} />
      </div>

      <div className="grid g16 sr-two">
        <Panel title="Voyages">
          <Table rows={[
            ["Voyages planned or run", c.voyages.total, p.voyages.total],
            ["Completed", c.voyages.completed, p.voyages.completed],
            ["Cancelled", c.voyages.cancelled, p.voyages.cancelled],
            ["Still under way at month end", c.voyages.still_underway, p.voyages.still_underway],
            ["Departed on time", `${share(c.voyages.dep_on_time, c.voyages.dep_timed)} (${c.voyages.dep_on_time} of ${c.voyages.dep_timed})`, share(p.voyages.dep_on_time, p.voyages.dep_timed)],
            ["Arrived on time", `${share(c.voyages.arr_on_time, c.voyages.arr_timed)} (${c.voyages.arr_on_time} of ${c.voyages.arr_timed})`, share(p.voyages.arr_on_time, p.voyages.arr_timed)],
            ["People carried (counted at departure)", c.voyages.people, p.voyages.people],
            ["Head count different at arrival", c.voyages.headcount_mismatch, p.voyages.headcount_mismatch],
            ["Went off route", c.voyages.off_route, p.voyages.off_route],
            ["Overdue", c.voyages.overdue, p.voyages.overdue],
            ["Moving during curfew", c.voyages.curfew, p.voyages.curfew],
          ]} />
          <span className="t3" style={{ fontSize: 12 }}>On time means within 15 minutes of the planned time. Voyages are counted in the month they departed, or were planned to depart if they never left.</span>
        </Panel>
        <Panel title="Check-ins and response">
          <Table rows={[
            ["Check-ins on time", c.checkins.kept, p.checkins.kept],
            ["Check-ins made late", c.checkins.late, p.checkins.late],
            ["Check-ins missed", c.checkins.missed, p.checkins.missed],
            ["Safety alerts", c.alerts.total, p.alerts.total],
            ["Serious alerts (severity 3 and above)", c.alerts.serious, p.alerts.serious],
            ["Acknowledged", `${c.alerts.acknowledged} of ${c.alerts.serious}`, `${p.alerts.acknowledged} of ${p.alerts.serious}`],
            ["Acknowledged within 2 minutes", share(c.alerts.within_2min, c.alerts.acknowledged), share(p.alerts.within_2min, p.alerts.acknowledged)],
            ["Median time to acknowledge", dur(c.alerts.median_ack_s), dur(p.alerts.median_ack_s)],
            ["Slowest 10% took longer than", dur(c.alerts.p90_ack_s), dur(p.alerts.p90_ack_s)],
            ["Escalated to the next person", c.alerts.escalated, p.alerts.escalated],
            ["Never acknowledged", c.alerts.unacknowledged, p.alerts.unacknowledged],
          ]} />
        </Panel>
      </div>

      <div className="grid g16 sr-two">
        <Panel title="Emergencies">
          <Table rows={[
            ["Hand-offs to responders", c.handoffs.total, p.handoffs.total],
            ["Confirmed by the responder", c.handoffs.confirmed, p.handoffs.confirmed],
            ["Median time for the responder to confirm", dur(c.handoffs.median_confirm_s), dur(p.handoffs.median_confirm_s)],
            ["Responder reached the scene", c.handoffs.on_scene, p.handoffs.on_scene],
            ["Search and rescue cases opened", c.sar.opened, p.sar.opened],
            ["Possible hijack flags", c.hijack.flagged, p.hijack.flagged],
            ["  confirmed by the operator", c.hijack.confirmed, p.hijack.confirmed],
            ["  dismissed as a false alarm", c.hijack.dismissed, p.hijack.dismissed],
          ]} />
        </Panel>
        <Panel title="Alerts by kind">
          {c.alerts.by_kind.length === 0 ? <Empty>No safety alerts this month.</Empty> : (
            <div style={{ overflowX: "auto" }}>
              <table className="tbl w-full" style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
                <thead><tr><th className="text-left">Kind</th><th className="text-right">All</th><th className="text-right">Serious</th><th className="text-right">Median to acknowledge</th></tr></thead>
                <tbody>{c.alerts.by_kind.map((x) => <tr key={x.kind}><td>{kindLabel(x.kind)}</td><td className="text-right">{x.count}</td><td className="text-right">{x.serious}</td><td className="text-right">{dur(x.median_ack_s)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="By boat" meta={r.boats.length || undefined}>
        {r.boats.length === 0 ? <Empty>No boat had a voyage or alert this month.</Empty> : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl w-full" style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
              <thead><tr><th className="text-left">Boat</th><th className="text-right">Voyages</th><th className="text-right">Arrived on time</th><th className="text-right">People</th><th className="text-right">Missed check-ins</th><th className="text-right">Serious alerts</th><th className="text-right">Median to acknowledge</th><th className="text-right">Head count mismatches</th></tr></thead>
              <tbody>
                {r.boats.map((b) => (
                  <tr key={b.id}>
                    <td>{b.name}</td><td className="text-right">{b.voyages}</td><td className="text-right">{b.on_time_pct != null ? `${b.on_time_pct}%` : "—"}</td><td className="text-right">{b.people}</td>
                    <td className="text-right">{b.missed_checkins}</td><td className="text-right">{b.serious_alerts}</td><td className="text-right">{dur(b.median_ack_s)}</td><td className="text-right">{b.mismatches || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {r.corridors.length > 0 && (
        <Panel title="By corridor">
          <div style={{ overflowX: "auto" }}>
            <table className="tbl w-full" style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
              <thead><tr><th className="text-left">Corridor</th><th className="text-right">Voyages</th><th className="text-right">Serious alerts</th><th className="text-right">Off route</th><th className="text-right">In curfew</th></tr></thead>
              <tbody>{r.corridors.map((x) => <tr key={x.id}><td>{x.name}</td><td className="text-right">{x.voyages}</td><td className="text-right">{x.serious_alerts}</td><td className="text-right">{x.off_route}</td><td className="text-right">{x.curfew}</td></tr>)}</tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title="Serious alerts" meta={r.serious.length || undefined}>
        {r.serious.length === 0 ? <Empty>No serious alerts this month.</Empty> : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl w-full" style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
              <thead><tr><th className="text-left">When</th><th className="text-left">Boat</th><th className="text-left">What</th><th className="text-right">Severity</th><th className="text-right">Acknowledged after</th></tr></thead>
              <tbody>
                {r.serious.map((a, i) => (
                  <tr key={i} style={{ verticalAlign: "top" }}>
                    <td>{dt(a.at)}</td><td>{a.boat}</td>
                    <td><b>{kindLabel(a.kind)}</b><div className="t3">{a.message}</div></td>
                    <td className="text-right">{a.severity}</td>
                    <td className="text-right">{a.ack_s != null ? dur(a.ack_s) : <Status tone="fail">Never</Status>}{a.escalated ? <div className="t3">escalated</div> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="t3" style={{ fontSize: 12 }}>
        Counted from {r.org}'s own records for {r.label} (Lagos time), compared with the month before. Routine events such as departures, arrivals and check-ins made are not counted as alerts. Response time is from when an alert was raised to when someone acknowledged it.
      </p>
      <style>{`.sr-two{grid-template-columns:repeat(2,minmax(0,1fr))}@media (max-width:1000px){.sr-two{grid-template-columns:minmax(0,1fr)}}`}</style>
    </>
  );
}

const k = (x: { text: string; cls: string }) => ({ delta: x.text || undefined, deltaClass: x.cls });

function Table({ rows }: { rows: (string | number)[][] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="tbl w-full" style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
        <thead><tr><th className="text-left"></th><th className="text-right">This month</th><th className="text-right">Last month</th></tr></thead>
        <tbody>{rows.map((row, i) => <tr key={i}><td style={{ whiteSpace: "pre" }}>{row[0]}</td><td className="text-right">{row[1]}</td><td className="text-right t3">{row[2]}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function downloadAll(r: SafetyReport) {
  const c: MonthStats = r.current;
  const summary = csv([
    ["Lemtik monthly safety report", r.org, r.label],
    ["Figure", "This month", "Last month"],
    ["Voyages", c.voyages.total, r.previous.voyages.total],
    ["Arrived on time (count)", c.voyages.arr_on_time, r.previous.voyages.arr_on_time],
    ["Voyages with arrival times", c.voyages.arr_timed, r.previous.voyages.arr_timed],
    ["People carried", c.voyages.people, r.previous.voyages.people],
    ["Check-ins missed", c.checkins.missed, r.previous.checkins.missed],
    ["Serious alerts", c.alerts.serious, r.previous.alerts.serious],
    ["Median seconds to acknowledge", c.alerts.median_ack_s, r.previous.alerts.median_ack_s],
    ["Hand-offs", c.handoffs.total, r.previous.handoffs.total],
    [],
    ["Boat", "Voyages", "Arrived on time %", "People", "Missed check-ins", "Serious alerts", "Median seconds to acknowledge", "Head count mismatches"],
    ...r.boats.map((b) => [b.name, b.voyages, b.on_time_pct, b.people, b.missed_checkins, b.serious_alerts, b.median_ack_s, b.mismatches]),
    [],
    ["When (UTC)", "Boat", "Kind", "Severity", "Message", "Seconds to acknowledge", "Escalated"],
    ...r.serious.map((a) => [a.at, a.boat, a.kind, a.severity, a.message, a.ack_s, a.escalated ? "yes" : "no"]),
  ]);
  download(`safety-report-${r.month}.csv`, summary);
}
