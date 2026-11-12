import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, Download, Loader2, Printer } from "lucide-react";
import { requireSectionAccess } from "@/lib/rbac";
import { Empty, Kpi, Notice, PageHeader, Panel, Status } from "@/components/nw";
import { getIspsReport, type IspsFacilityReport, type IspsReport } from "@/lib/isps-report.functions";
import { BREACH_LABEL, FACILITY_KIND, LEVEL_LABEL } from "@/lib/isps.rules";
import { DrillEvidenceButton, TRAINING_STATE } from "@/components/isps/Evidence";
import { CLOCK_NOTE, ClosureClock } from "@/components/isps/Clock";

type Search = { org?: string };
export const Route = createFileRoute("/app/isps-report")({
  head: () => ({ meta: [{ title: "ISPS compliance report · Lemtik SOD" }] }),
  validateSearch: (s: Record<string, unknown>): Search => (typeof s.org === "string" && /^[0-9a-f-]{36}$/i.test(s.org) ? { org: s.org } : {}),
  beforeLoad: async ({ context }) => {
    requireSectionAccess(context.appAccess, ["security_manager", "operator", "client_admin"]);
    return { appAccess: context.appAccess };
  },
  component: IspsReportPage,
});

const iso = (t: number) => new Date(t + 3600_000).toISOString().slice(0, 10);
const day = (d: string | null) => (d ? new Date(d.length === 10 ? `${d}T12:00:00+01:00` : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" }) : "—");
const dt = (d: string | null) => (d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" }) : "—");
const PRESETS = [
  { l: "Last 3 months", m: 3 },
  { l: "Last 12 months", m: 12 },
  { l: "This year", m: 0 },
];

function IspsReportPage() {
  const { org } = Route.useSearch();
  const today = iso(Date.now());
  const yearAgo = iso(Date.now() - 365 * 86_400_000);
  const [range, setRange] = useState({ from: yearAgo, to: today });
  const fn = useServerFn(getIspsReport);
  const q = useQuery({ queryKey: ["isps-report", org ?? null, range.from, range.to], queryFn: () => fn({ data: { org_id: org ?? null, from: range.from, to: range.to } }), retry: false });
  const r = q.data;
  const preset = (m: number) => {
    const now = new Date(Date.now() + 3600_000);
    const from = m === 0 ? `${now.getUTCFullYear()}-01-01` : iso(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, now.getUTCDate()) - 3600_000);
    setRange({ from, to: today });
  };
  return (
    <div className="col g16 isps-report">
      <style>{`@media print {
        aside, nav, header, .no-print { display: none !important; }
        body, .isps-report { background: #fff !important; color: #000 !important; }
        .isps-report * { color: #000 !important; border-color: #ccc !important; }
        .isps-report .pn { break-inside: avoid; }
        .isps-report .fac { break-before: page; }
      }`}</style>
      <Link to="/app/isps" className="row g4 t3 no-print" style={{ fontSize: 12 }}><ArrowLeft size={13} /> ISPS Watch</Link>
      <PageHeader title="ISPS compliance report" sub={r ? `${r.org.name} · ${day(r.from)} to ${day(r.to)} · produced ${dt(r.generated_at)} by ${r.generated_by}` : "Security levels, drills, exercises, breaches and Declarations of Security for a period"}>
        <div className="row g6 wrap no-print" style={{ alignItems: "center" }}>
          {PRESETS.map((p) => <button key={p.l} type="button" className="b b-sm b-gh" onClick={() => preset(p.m)}>{p.l}</button>)}
          <input type="date" className="in" style={{ height: 32 }} value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} aria-label="From" />
          <span className="t3">to</span>
          <input type="date" className="in" style={{ height: 32 }} value={range.to} min={range.from} max={today} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} aria-label="To" />
        </div>
        {r && <button type="button" className="b b-sec b-sm no-print" onClick={() => downloadCsv(r)}><Download size={13} /> CSV</button>}
        <button type="button" className="b b-pri b-sm no-print" disabled={!r} onClick={() => window.print()}><Printer size={13} /> Print or save as PDF</button>
      </PageHeader>
      {q.isLoading ? (
        <span className="row g8 t3"><Loader2 className="h-4 w-4 animate-spin" /> Building the report…</span>
      ) : q.error || !r ? (
        <Notice tone="fail">{(q.error as Error)?.message || "Couldn't build the report."}</Notice>
      ) : (
        <Body r={r} />
      )}
    </div>
  );
}

function Body({ r }: { r: IspsReport }) {
  const s = r.summary;
  return (
    <>
      {r.viewer_is_authority && <Notice tone="blue">Produced from the ISPS records {r.org.name} shares with you. {r.org.name} can see that you produced it.</Notice>}
      <div className="kpis">
        <Kpi label="Facilities" value={s.facilities} delta={s.failing_now ? `${s.failing_now} with an overdue item today` : "None overdue today"} deltaClass={s.failing_now ? "dn-bad" : ""} />
        <Kpi label="Drills held" value={s.drills} delta={`${s.exercises} exercise${s.exercises === 1 ? "" : "s"}`} />
        <Kpi label="Breaches" value={s.breaches} delta={s.unreported ? `${s.unreported} not reported to the authority` : s.breaches ? "All reported" : undefined} deltaClass={s.unreported ? "dn-bad" : ""} />
        <Kpi label="Declarations signed" value={s.declarations_signed} />
        <Kpi label="Training records" value={s.training_records} delta={s.training_expired_at_end ? `${s.training_expired_at_end} expired at the end of the period` : s.training_records ? "None expired" : undefined} deltaClass={s.training_expired_at_end ? "dn-bad" : ""} />
        <Kpi label="Days at level 2 or 3" value={s.days_at_level_2_or_3} title="Added up across facilities" />
      </div>

      <Panel title="Summary by facility">
        {r.facilities.length === 0 ? <Empty>No facilities registered.</Empty> : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl w-full" style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
              <thead><tr><th className="text-left">Facility</th><th className="text-right">Days at level 1 / 2 / 3</th><th className="text-right">Drills</th><th className="text-right">Days drill overdue</th><th className="text-right">Exercises</th><th className="text-right">Breaches</th><th className="text-right">Unreported</th><th className="text-left">Today</th><th className="text-left">Closure clock today</th></tr></thead>
              <tbody>
                {r.facilities.map((f) => (
                  <tr key={f.id} style={{ verticalAlign: "top" }}>
                    <td><b>{f.name}</b><div className="t3">{FACILITY_KIND[f.kind] ?? f.kind}</div></td>
                    <td className="text-right">{f.level_days[1]} / {f.level_days[2]} / {f.level_days[3]}</td>
                    <td className="text-right">{f.drills.filter((d) => d.kind === "drill").length}</td>
                    <td className="text-right" style={{ fontWeight: f.drill_overdue_days ? 600 : 400 }}>{f.drill_overdue_days}</td>
                    <td className="text-right">{f.exercises_in_period}</td>
                    <td className="text-right">{f.breaches.length}</td>
                    <td className="text-right">{f.breaches.filter((b) => !b.reported_to_authority).length}</td>
                    <td>{f.flags_now.some((x) => x.tone === "fail") ? <Status tone="fail">Overdue item</Status> : f.flags_now.length ? <Status tone="warn">Due soon</Status> : <Status tone="ok">In order</Status>}</td>
                    <td>{f.clock_now.since ? <ClosureClock clock={f.clock_now} compact /> : <span className="t3">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid g16 ir-two">
        <Panel title="Level change acknowledgements">
          {r.acks.broadcasts === 0 ? <Empty>No security level changes were broadcast in the period.</Empty> : (
            <div className="col g4" style={{ fontSize: 13 }}>
              <span>{r.acks.broadcasts} level change{r.acks.broadcasts === 1 ? "" : "s"} sent to {r.acks.recipients} people in all.</span>
              <span>{r.acks.acknowledged} acknowledged ({r.acks.recipients ? Math.round((r.acks.acknowledged / r.acks.recipients) * 100) : 0}%), {r.acks.within_30min} within 30 minutes.</span>
              <span>Median time to acknowledge: {r.acks.median_ack_min != null ? `${r.acks.median_ack_min} min` : "—"}.</span>
            </div>
          )}
        </Panel>
        <Panel title="Notices from the authority" meta={r.notices.length || undefined}>
          {r.notices.length === 0 ? <Empty>No notices received in the period.</Empty> : (
            <div style={{ overflowX: "auto" }}>
              <table className="tbl w-full" style={{ fontSize: 12.5 }}>
                <thead><tr><th className="text-left">Notice</th><th className="text-left">Issued</th><th className="text-left">Acknowledged</th></tr></thead>
                <tbody>
                  {r.notices.map((n, i) => (
                    <tr key={i} style={{ verticalAlign: "top" }}>
                      <td><b>{n.title}</b><div className="t3">{n.reference} · {n.from}</div></td>
                      <td>{dt(n.issued_at)}{n.respond_by ? <div className="t3">respond by {dt(n.respond_by)}</div> : null}</td>
                      <td>{n.acknowledged_at ? `${dt(n.acknowledged_at)}${n.acknowledged_by ? ` by ${n.acknowledged_by}` : ""}` : <b>Not acknowledged</b>}{n.on_time === false ? <div style={{ color: "var(--s5, #F2384B)" }}>After the deadline</div> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {r.facilities.map((f) => <FacilitySection key={f.id} f={f} />)}

      <Panel title="Training and certificates" meta={r.training.length || undefined}>
        {r.training.length === 0 ? <Empty>No training recorded.</Empty> : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl w-full" style={{ fontSize: 12.5 }}>
              <thead><tr><th className="text-left">Person</th><th className="text-left">Role</th><th className="text-left">Course</th><th className="text-left">Completed</th><th className="text-left">Expires</th><th className="text-left">At {day(r.to)}</th><th className="text-left">Today</th><th className="text-left">Certificate</th></tr></thead>
              <tbody>{r.training.map((t, i) => (
                <tr key={i} style={{ verticalAlign: "top" }}>
                  <td>{t.person}</td><td>{t.role}{t.facility ? <span className="t3"> · {t.facility}</span> : null}</td><td>{t.course}{t.provider ? <span className="t3"> · {t.provider}</span> : null}</td>
                  <td>{day(t.completed_on)}</td><td>{t.expires_on ? day(t.expires_on) : "No expiry"}</td>
                  <td><Status tone={TRAINING_STATE[t.at_end][1]}>{TRAINING_STATE[t.at_end][0]}</Status></td>
                  <td>{t.now === "removed" ? <span className="t3">Removed</span> : <Status tone={TRAINING_STATE[t.now][1]}>{TRAINING_STATE[t.now][0]}</Status>}</td>
                  <td>{t.certificate ? "On file" : "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="t3" style={{ fontSize: 12 }}>
        Counted from the records in Lemtik for {day(r.from)} to {day(r.to)}, Lagos time. A drill is due every 3 months (92 days); before a facility's first drill, the 92 days run from the day it was registered on Lemtik. An exercise is due at least once a calendar year and never more than 18 months apart. "Today" reflects the position when the report was produced. {CLOCK_NOTE}
      </p>
      <style>{`.print-only{display:none}@media print{.print-only{display:inline}}.ir-two{grid-template-columns:repeat(2,minmax(0,1fr))}@media (max-width:1000px){.ir-two{grid-template-columns:minmax(0,1fr)}}`}</style>
    </>
  );
}

function FacilitySection({ f }: { f: IspsFacilityReport }) {
  return (
    <section className="col g12 fac">
      <h2 className="ph1" style={{ fontSize: 17, marginTop: 8 }}>{f.name} <span className="t3" style={{ fontSize: 13, fontWeight: 400 }}>{FACILITY_KIND[f.kind] ?? f.kind}{f.identifier ? ` · ${f.identifier}` : ""}</span></h2>
      <Panel title="Facility and security plan">
        <dl className="grid g6" style={{ gridTemplateColumns: "minmax(160px, max-content) 1fr", fontSize: 13, margin: 0 }}>
          <dt className="t3">Port Facility Security Officer</dt><dd style={{ margin: 0 }}>{f.pfso ?? "Not named"}{f.pfso_phone ? ` · ${f.pfso_phone}` : ""}</dd>
          <dt className="t3">Security plan approved</dt><dd style={{ margin: 0 }}>{day(f.plan_approved_on)}</dd>
          <dt className="t3">Approval valid until</dt><dd style={{ margin: 0 }}>{day(f.plan_expires_on)}{f.plan_lapsed_days ? <b> · lapsed for {f.plan_lapsed_days} days of the period</b> : null}</dd>
          <dt className="t3">Security level today</dt><dd style={{ margin: 0 }}>{LEVEL_LABEL[f.level_now] ?? f.level_now}</dd>
          <dt className="t3">Longest gap between drills</dt><dd style={{ margin: 0 }}>{f.longest_drill_gap_days != null ? `${f.longest_drill_gap_days} days` : "—"}{f.drill_overdue_days ? <b> · drill overdue for {f.drill_overdue_days} days</b> : null}</dd>
          <dt className="t3">Open items today</dt><dd style={{ margin: 0 }}>{f.flags_now.length ? f.flags_now.map((x) => x.text).join("; ") : "None"}</dd>
        </dl>
      </Panel>
      <Panel title="Security level changes" meta={f.level_changes.length || undefined}>
        {f.level_changes.length === 0 ? <Empty>No changes in the period.</Empty> : (
          <table className="tbl w-full" style={{ fontSize: 12.5 }}>
            <thead><tr><th className="text-left">When</th><th className="text-left">Change</th><th className="text-left">Reason</th><th className="text-left">By</th></tr></thead>
            <tbody>{f.level_changes.map((c, i) => <tr key={i} style={{ verticalAlign: "top" }}><td>{dt(c.at)}</td><td>{c.from} → {c.to}</td><td>{c.reason}</td><td>{c.by ?? "—"}</td></tr>)}</tbody>
          </table>
        )}
      </Panel>
      <Panel title="Drills and exercises" meta={f.drills.length || undefined}>
        {f.drills.length === 0 ? <Empty>None recorded in the period.</Empty> : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl w-full" style={{ fontSize: 12.5 }}>
              <thead><tr><th className="text-left">Date</th><th className="text-left">Type</th><th className="text-left">Scenario</th><th className="text-right">Participants</th><th className="text-left">Findings, corrective actions and lessons</th><th className="text-left">Evidence</th></tr></thead>
              <tbody>{f.drills.map((d) => <tr key={d.id} style={{ verticalAlign: "top" }}><td>{day(d.held_on)}</td><td>{d.kind === "drill" ? "Drill" : "Exercise"}</td><td>{d.scenario}</td><td className="text-right">{d.participants ?? "—"}</td><td>{[d.findings, d.corrective_actions, d.lessons_learned ? `Lessons: ${d.lessons_learned}` : null].filter(Boolean).join(" · ") || "—"}</td><td>{d.files || d.attended ? <><span className="print-only">{[d.files ? `${d.files} file${d.files === 1 ? "" : "s"}` : null, d.attended ? `${d.attended} on attendance list` : null].filter(Boolean).join(", ")}</span><span className="no-print"><DrillEvidenceButton drillId={d.id} files={d.files} attended={d.attended} hasLessons={!!d.lessons_learned} /></span></> : <span className="t3">None</span>}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Breaches" meta={f.breaches.length || undefined}>
        {f.breaches.length === 0 ? <Empty>No breaches recorded in the period.</Empty> : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl w-full" style={{ fontSize: 12.5 }}>
              <thead><tr><th className="text-left">When</th><th className="text-left">What</th><th className="text-left">Reported to the authority</th><th className="text-left">Closed</th></tr></thead>
              <tbody>{f.breaches.map((b, i) => (
                <tr key={i} style={{ verticalAlign: "top" }}>
                  <td>{dt(b.occurred_at)}{b.level ? <div className="t3">at level {b.level}</div> : null}</td>
                  <td><b>{BREACH_LABEL[b.category] ?? b.category}</b><div className="t3">{b.description}</div>{b.incident_code ? <div className="t3">Incident {b.incident_code}</div> : null}</td>
                  <td>{b.reported_to_authority ? `${b.reported_at ? dt(b.reported_at) : "Yes"}${b.hours_to_report != null ? ` (after ${b.hours_to_report} h)` : ""}${b.reported_to ? ` · ${b.reported_to}` : ""}` : <b>Not reported</b>}</td>
                  <td>{b.closed_at ? `${dt(b.closed_at)}${b.days_to_close != null ? ` (${b.days_to_close} days)` : ""}` : "Open"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Declarations of Security" meta={f.declarations.length || undefined}>
        {f.declarations.length === 0 ? <Empty>None made in the period.</Empty> : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl w-full" style={{ fontSize: 12.5 }}>
              <thead><tr><th className="text-left">Reference</th><th className="text-left">Ship</th><th className="text-right">Level</th><th className="text-left">Valid</th><th className="text-left">Status</th></tr></thead>
              <tbody>{f.declarations.map((d, i) => <tr key={i}><td className="mono">{d.reference}</td><td>{d.ship_name}{d.ship_imo ? <span className="t3"> · IMO {d.ship_imo}</span> : null}</td><td className="text-right">{d.level}</td><td>{dt(d.valid_from)} to {dt(d.valid_to)}</td><td>{d.status === "signed" ? `Signed${d.ship_signed_at ? ` ${dt(d.ship_signed_at)}` : ""}` : d.status === "cancelled" ? "Cancelled" : "Ship didn't sign"}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </Panel>
    </section>
  );
}

function downloadCsv(r: IspsReport) {
  const q = (c: unknown) => { const s = c == null ? "" : String(c); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows: unknown[][] = [
    ["ISPS compliance report", r.org.name, r.from, r.to, `produced ${r.generated_at} by ${r.generated_by}`],
    [],
    ["Facility", "Days at level 1", "Days at level 2", "Days at level 3", "Drills", "Days drill overdue", "Longest drill gap (days)", "Exercises", "Breaches", "Unreported", "Plan valid until", "PFSO", "Days failing a rule (today)", "Failing since"],
    ...r.facilities.map((f) => [f.name, f.level_days[1], f.level_days[2], f.level_days[3], f.drills.filter((d) => d.kind === "drill").length, f.drill_overdue_days, f.longest_drill_gap_days, f.exercises_in_period, f.breaches.length, f.breaches.filter((b) => !b.reported_to_authority).length, f.plan_expires_on, f.pfso, f.clock_now.days, f.clock_now.since]),
    [],
    ["Facility", "Drill or exercise", "Date", "Scenario", "Participants", "Findings", "Corrective actions", "Lessons learned", "On attendance list", "Evidence files"],
    ...r.facilities.flatMap((f) => f.drills.map((d) => [f.name, d.kind, d.held_on, d.scenario, d.participants, d.findings, d.corrective_actions, d.lessons_learned, d.attended, d.files])),
    [],
    ["Person", "Role", "Facility", "Course", "Provider", "Certificate no.", "Completed", "Expires", "State at end of period", "State today", "Certificate on file"],
    ...r.training.map((t) => [t.person, t.role, t.facility, t.course, t.provider, t.certificate_no, t.completed_on, t.expires_on, t.at_end, t.now, t.certificate ? "yes" : "no"]),
    [],
    ["Facility", "Breach occurred (UTC)", "Category", "Description", "Reported", "Reported at (UTC)", "Hours to report", "Closed at (UTC)", "Days to close", "Incident"],
    ...r.facilities.flatMap((f) => f.breaches.map((b) => [f.name, b.occurred_at, b.category, b.description, b.reported_to_authority ? "yes" : "no", b.reported_at, b.hours_to_report, b.closed_at, b.days_to_close, b.incident_code])),
    [],
    ["Facility", "Level change at (UTC)", "From", "To", "Reason", "By"],
    ...r.facilities.flatMap((f) => f.level_changes.map((c) => [f.name, c.at, c.from, c.to, c.reason, c.by])),
    [],
    ["Facility", "Declaration", "Ship", "IMO", "Level", "Valid from (UTC)", "Valid to (UTC)", "Status"],
    ...r.facilities.flatMap((f) => f.declarations.map((d) => [f.name, d.reference, d.ship_name, d.ship_imo, d.level, d.valid_from, d.valid_to, d.status])),
  ];
  const url = URL.createObjectURL(new Blob([rows.map((x) => x.map(q).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `isps-compliance-${r.org.name.replace(/[^\w]+/g, "-").toLowerCase()}-${r.from}-to-${r.to}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
