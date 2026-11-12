import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BellRing, Cctv, FileSignature, Loader2, Package, RefreshCw, ShieldAlert, ShieldCheck, Siren } from "lucide-react";
import { requireSectionAccess } from "@/lib/rbac";
import { Empty, Kpi, Notice, PageHeader, Panel, Status, timeAgo, useNow, type Tone } from "@/components/nw";
import { MyIspsAcks } from "@/components/isps/Broadcasts";
import { getFacilityOverview, type AttentionItem, type FacilityOverview } from "@/lib/facility.functions";
import { BREACH_LABEL, FACILITY_KIND, LEVEL_LABEL } from "@/lib/isps.rules";

export const Route = createFileRoute("/app/facility")({
  head: () => ({ meta: [{ title: "Facility overview · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    requireSectionAccess(context.appAccess, ["security_manager", "operator", "client_admin"]);
    return { appAccess: context.appAccess };
  },
  component: FacilityPage,
});

const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" }) : "—");
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" }) : "—");
const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" }) : "—");
const LEVEL_TONE: Record<number, Tone> = { 1: "ok", 2: "warn", 3: "fail" };
const AREA_ICON = { isps: ShieldCheck, cargo: Package, cameras: Cctv, incidents: Siren } as const;
const CUSTODY: Record<string, string> = { loaded: "Loaded", sealed: "Sealed", departed: "Departed", checkpoint: "Checkpoint", handover: "Handed over", inspection: "Inspected", delivered: "Delivered", exception: "Exception" };

function FacilityPage() {
  const load = useServerFn(getFacilityOverview);
  const q = useQuery({ queryKey: ["facility-overview"], queryFn: () => load(), refetchInterval: 60_000 });
  const now = useNow(60_000);
  const d = q.data;
  const maxLevel = d?.facilities.reduce((m, f) => Math.max(m, f.security_level), 0) ?? 0;
  const overdue = d?.facilities.filter((f) => f.flags.some((x) => x.tone === "fail")).length ?? 0;
  const unreported = d?.facilities.reduce((n, f) => n + f.unreported_breaches, 0) ?? 0;

  return (
    <div className="col g16">
      <PageHeader title="Facility overview" sub={d ? `${d.org} · updated ${clock(d.generated_at)} · refreshes every minute` : "Loading…"}>
        <button type="button" className="b b-sec b-sm" onClick={() => q.refetch()} disabled={q.isFetching}>
          {q.isFetching ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
        </button>
        {d?.modules.isps && <Link to="/app/isps" className="b b-pri b-sm">Open ISPS Watch</Link>}
      </PageHeader>

      <MyIspsAcks />
      {q.error && <Notice tone="fail">{(q.error as Error).message}</Notice>}

      <div className="kpis">
        {d?.modules.isps !== false && (
          <>
            <Kpi label="Security level" value={d ? (maxLevel ? maxLevel : "—") : "—"} delta={d ? (maxLevel ? LEVEL_LABEL[maxLevel]?.split(" · ")[1] ?? "" : "No facilities set up") : undefined} deltaClass={maxLevel >= 2 ? "dn-bad" : ""} />
            <Kpi label="Facilities overdue" value={d ? overdue : "—"} delta={d ? `of ${d.facilities.length} facilit${d.facilities.length === 1 ? "y" : "ies"}` : undefined} deltaClass={overdue ? "dn-bad" : ""} />
            <Kpi label="Open breaches" value={d ? d.breaches.length : "—"} delta={d ? (unreported ? `${unreported} not reported` : "All reported") : undefined} deltaClass={unreported ? "dn-bad" : ""} />
            <Kpi label="Declarations in force" value={d ? d.declarations.active : "—"} delta={d ? `${d.declarations.awaiting_ship.length} waiting for the ship` : undefined} />
          </>
        )}
        {d?.cargo && <Kpi label="Cargo in transit" value={d.cargo.in_transit} delta={`${d.cargo.events_today.length} custody records today`} deltaClass={d.cargo.exceptions ? "dn-bad" : ""} />}
        {d?.cameras && <Kpi label="Camera alerts, 24 h" value={d.cameras.events_24h} delta={`${d.cameras.total} camera${d.cameras.total === 1 ? "" : "s"}`} />}
      </div>

      <div className="grid g16 fac-top">
        <div className="col g16" style={{ minWidth: 0 }}>
          {d?.modules.isps !== false && <FacilitiesPanel d={d} />}
          {d?.cargo && <CustodyPanel cargo={d.cargo} />}
        </div>
        <div className="col g16" style={{ minWidth: 0 }}>
          <AttentionPanel list={d?.attention} now={now} />
          {d && d.level_acks.length > 0 && <AcksPanel acks={d.level_acks} />}
          {d && (d.declarations.today.length > 0 || d.declarations.awaiting_ship.length > 0) && <DeclarationsPanel d={d} />}
          {d?.cameras && <CamerasPanel cams={d.cameras} />}
        </div>
      </div>

      {d && d.breaches.length > 0 && <BreachesPanel list={d.breaches} />}
      {d && d.incidents_open.length > 0 && <IncidentsPanel list={d.incidents_open} />}
      <style>{`.fac-top{grid-template-columns:minmax(0,1fr) 360px}@media (max-width:1100px){.fac-top{grid-template-columns:minmax(0,1fr)}}`}</style>
    </div>
  );
}

function AttentionPanel({ list, now }: { list?: AttentionItem[]; now: number }) {
  return (
    <Panel title="Needs attention" icon={<BellRing size={15} className="ic" />} meta={list?.length || undefined}>
      {!list ? (
        <Empty>Loading…</Empty>
      ) : list.length === 0 ? (
        <Empty>Nothing needs attention. Drills, plans, breaches, cargo and cameras are all in order.</Empty>
      ) : (
        <div className="col g8">
          {list.slice(0, 14).map((a, i) => {
            const Icon = AREA_ICON[a.area];
            return (
              <Link key={i} to={a.to as any} className="row g8 hover:underline" style={{ alignItems: "flex-start", fontSize: 12.5 }}>
                <Icon size={14} style={{ marginTop: 2, color: a.tone === "fail" ? "var(--s5, #F2384B)" : "var(--s4, #E8590C)", flexShrink: 0 }} />
                <span className="col f1" style={{ minWidth: 0 }}>
                  <b className="trunc">{a.title}</b>
                  <span className="t3">{a.detail}{a.at ? ` · ${timeAgo(a.at, now)}` : ""}</span>
                </span>
                <Status tone={a.tone}>{a.tone === "fail" ? "Act now" : "Soon"}</Status>
              </Link>
            );
          })}
          {list.length > 14 && <span className="t3" style={{ fontSize: 12 }}>And {list.length - 14} more.</span>}
        </div>
      )}
    </Panel>
  );
}

function FacilitiesPanel({ d }: { d?: FacilityOverview }) {
  return (
    <Panel title="Facilities" icon={<ShieldCheck size={15} className="ic" />} meta={d?.facilities.length || undefined}>
      {!d ? (
        <Empty>Loading…</Empty>
      ) : d.facilities.length === 0 ? (
        <Empty>No facilities yet. Add your port facility, terminal or jetty in ISPS Watch to track its security level, drills and breaches here.</Empty>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="tbl w-full" style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
            <thead>
              <tr><th className="text-left">Facility</th><th className="text-left">Level</th><th className="text-left">Last drill</th><th className="text-left">Next drill due</th><th className="text-left">Last exercise</th><th className="text-left">Plan approval</th><th className="text-right">Open breaches</th></tr>
            </thead>
            <tbody>
              {d.facilities.map((f) => (
                <tr key={f.id} style={{ verticalAlign: "top" }}>
                  <td>
                    <b>{f.name}</b>
                    <div className="t3">{FACILITY_KIND[f.kind] ?? f.kind}{f.security_officer_name ? ` · PFSO ${f.security_officer_name}` : " · no PFSO named"}</div>
                    {f.flags.filter((x) => x.code !== "officer").map((x, i) => <div key={i} style={{ color: x.tone === "fail" ? "var(--s5, #F2384B)" : "var(--s4, #E8590C)", fontSize: 12 }}>{x.text}</div>)}
                  </td>
                  <td><Status tone={LEVEL_TONE[f.security_level] ?? "neutral"}>{LEVEL_LABEL[f.security_level] ?? `Level ${f.security_level}`}</Status><div className="t3" style={{ marginTop: 3 }}>since {dt(f.level_set_at)}{f.level_set_by_name ? ` by ${f.level_set_by_name}` : ""}</div></td>
                  <td>{day(f.last_drill_on)}</td>
                  <td>{f.next_drill_due ? <span style={{ fontWeight: Date.parse(f.next_drill_due) < Date.now() ? 600 : 400 }}>{day(f.next_drill_due)}</span> : <span className="t3">Record a drill</span>}</td>
                  <td>{day(f.last_exercise_on)}</td>
                  <td>{f.plan_expires_on ? `until ${day(f.plan_expires_on)}` : <span className="t3">Not entered</span>}</td>
                  <td className="text-right">{f.open_breaches}{f.unreported_breaches ? <div style={{ color: "var(--s5, #F2384B)" }}>{f.unreported_breaches} unreported</div> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function AcksPanel({ acks }: { acks: FacilityOverview["level_acks"] }) {
  return (
    <Panel title="Level change acknowledgements" icon={<ShieldAlert size={15} className="ic" />}>
      <div className="col g8">
        {acks.map((a, i) => (
          <div key={i} className="col g2" style={{ fontSize: 12.5 }}>
            <div className="row g8"><b className="f1 trunc">{a.title}</b><Status tone={a.acked === a.total ? "ok" : "warn"}>{a.acked} of {a.total}</Status></div>
            {a.waiting.length > 0 && <span className="t3">Waiting for {a.waiting.slice(0, 6).join(", ")}{a.waiting.length > 6 ? ` and ${a.waiting.length - 6} more` : ""}</span>}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function DeclarationsPanel({ d }: { d: FacilityOverview }) {
  const rows = d.declarations.today;
  return (
    <Panel title="Declarations of Security, today" icon={<FileSignature size={15} className="ic" />} meta={rows.length || undefined}>
      {rows.length === 0 ? (
        <Empty>None in force today or tomorrow.</Empty>
      ) : (
        <div className="col g6">
          {rows.map((r) => (
            <div key={r.id} className="row g8" style={{ fontSize: 12.5 }}>
              <span className="col f1" style={{ minWidth: 0 }}>
                <b className="trunc">{r.ship_name}</b>
                <span className="t3">{r.reference} · {r.facility} · {dt(r.valid_from)} to {dt(r.valid_to)}</span>
              </span>
              <Status tone={r.status === "signed" ? "ok" : "warn"}>{r.status === "signed" ? "Signed by both" : "Ship to sign"}</Status>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function CustodyPanel({ cargo }: { cargo: NonNullable<FacilityOverview["cargo"]> }) {
  return (
    <Panel title="Today's cargo custody" icon={<Package size={15} className="ic" />} meta={cargo.events_today.length || undefined} actions={<Link to="/app/cargo" className="b b-gh b-sm">Cargo custody</Link>}>
      <div className="col g8">
        <span className="t3" style={{ fontSize: 12 }}>{cargo.in_transit} in transit · {cargo.planned} planned · {cargo.delivered_today} delivered today{cargo.exceptions ? ` · ${cargo.exceptions} with an exception` : ""}</span>
        {cargo.events_today.length === 0 ? (
          <Empty>No custody records yet today.</Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl w-full" style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
              <thead><tr><th className="text-left">Time</th><th className="text-left">Consignment</th><th className="text-left">What</th><th className="text-left">Seals</th><th className="text-left">By</th></tr></thead>
              <tbody>
                {cargo.events_today.map((e, i) => (
                  <tr key={i}>
                    <td>{clock(e.at)}</td>
                    <td><Link to="/app/cargo/$id" params={{ id: e.consignment_id }} className="hover:underline mono">{e.reference}</Link></td>
                    <td>{CUSTODY[e.kind] ?? e.kind}{e.party ? <div className="t3">{e.party}</div> : null}{e.note ? <div className="t3 trunc" style={{ maxWidth: 260 }}>{e.note}</div> : null}</td>
                    <td>{e.seals_ok == null ? <span className="t3">—</span> : e.seals_ok ? "Intact" : <span style={{ color: "var(--s5, #F2384B)", fontWeight: 600 }}>{e.seal_issue || "Problem"}</span>}</td>
                    <td>{e.by ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Panel>
  );
}

function CamerasPanel({ cams }: { cams: NonNullable<FacilityOverview["cameras"]> }) {
  return (
    <Panel title="Camera alerts, last 24 hours" icon={<Cctv size={15} className="ic" />} meta={cams.events_24h || undefined} actions={<Link to="/app/sensors" className="b b-gh b-sm">Cameras</Link>}>
      {cams.recent.length === 0 ? (
        <Empty>No camera alerts in the last 24 hours.</Empty>
      ) : (
        <div className="col g6">
          {cams.recent.map((e, i) => (
            <div key={i} className="row g8" style={{ fontSize: 12.5 }}>
              <span className="col f1" style={{ minWidth: 0 }}>
                <b className="trunc" style={{ textTransform: "capitalize" }}>{e.event}</b>
                <span className="t3">{e.camera}{e.zone ? ` · ${e.zone}` : ""}{e.confidence != null ? ` · ${Math.round((e.confidence <= 1 ? e.confidence * 100 : e.confidence))}% confidence` : ""}</span>
              </span>
              <span className="t3 mono" style={{ fontSize: 12 }}>{clock(e.at)}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function BreachesPanel({ list }: { list: FacilityOverview["breaches"] }) {
  return (
    <Panel title="Open breaches" icon={<ShieldAlert size={15} className="ic" />} meta={list.length} actions={<Link to="/app/isps" className="b b-gh b-sm">Breach register</Link>}>
      <div style={{ overflowX: "auto" }}>
        <table className="tbl w-full" style={{ fontSize: 12.5 }}>
          <thead><tr><th className="text-left">When</th><th className="text-left">Facility</th><th className="text-left">What</th><th className="text-left">Reported to the authority</th></tr></thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.id} style={{ verticalAlign: "top" }}>
                <td>{dt(b.occurred_at)}</td>
                <td>{b.facility}</td>
                <td><b>{BREACH_LABEL[b.category] ?? b.category}</b><div className="t3" style={{ maxWidth: 420 }}>{b.description.length > 160 ? `${b.description.slice(0, 160)}…` : b.description}</div></td>
                <td>{b.reported_to_authority ? "Yes" : <span style={{ color: "var(--s5, #F2384B)", fontWeight: 600 }}>Not yet</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function IncidentsPanel({ list }: { list: FacilityOverview["incidents_open"] }) {
  return (
    <Panel title="Open incidents" icon={<Siren size={15} className="ic" />} meta={list.length} actions={<Link to="/app/incidents" className="b b-gh b-sm">All incidents</Link>}>
      <div className="col g6">
        {list.map((i) => (
          <Link key={i.id} to="/app/incidents/$id" params={{ id: i.id }} className="row g8 hover:underline" style={{ fontSize: 12.5 }}>
            <Status tone={i.severity >= 5 ? "fail" : i.severity >= 4 ? "warn" : "neutral"}>Severity {i.severity}</Status>
            <span className="col f1" style={{ minWidth: 0 }}><b className="trunc">{i.code} · {i.title}</b><span className="t3">{i.status.replace(/_/g, " ")} · reported {dt(i.reported_at)}</span></span>
          </Link>
        ))}
      </div>
    </Panel>
  );
}
