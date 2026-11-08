import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { listIncidents } from "@/lib/incidents.functions";
import { listPatrols } from "@/lib/patrols.functions";
import { listSecurityReports, recordSecurityReport, sendReportDelivery, type SecurityReportRow } from "@/lib/reports.functions";
import { getActiveOrg } from "@/lib/orgs.functions";
import { requireSectionAccess } from "@/lib/rbac";
import { type IncidentType, typeMeta } from "@/lib/mockData";
import { Loader2, Mail, Printer } from "lucide-react";
import { Empty, Notice, Panel } from "@/components/nw";

type IncidentRow = { id: string; code: string; title?: string | null; type: IncidentType; severity: number; status: string; location: string; zone: string; officer: string | null; reported_at: string; description?: string | null };
type PatrolRow = { id: string; code: string; name: string; officer: string | null; status: string; waypoints: number; checked_in: number; archived_at?: string | null };
type OrgRow = { id: string; name: string; billing_contact_email?: string | null };
type Kind = "daily" | "weekly" | "monthly" | "incident";

const DAY = 86_400_000;
const KINDS: { id: Kind; title: string; sub: string }[] = [
  { id: "daily", title: "Daily incident log", sub: "The last 24 hours" },
  { id: "weekly", title: "Weekly security summary", sub: "The last 7 days" },
  { id: "monthly", title: "Monthly threat analysis", sub: "The last 30 days" },
  { id: "incident", title: "Incident report", sub: "One incident, for legal and insurance" },
];
const SEV_NAME: Record<number, string> = { 5: "Critical", 4: "High", 3: "Medium", 2: "Low", 1: "Minor" };
const fmtDate = (t: number | string) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const fmtDateTime = (t: number | string) => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const Route = createFileRoute("/app/report-centre")({
  head: () => ({ meta: [{ title: "Report centre · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    const appAccess = context.appAccess;
    requireSectionAccess(appAccess, ["security_manager", "operator", "client_admin"]);
    return { appAccess };
  },
  component: ReportCentre,
});

function ReportCentre() {
  const { appAccess } = Route.useRouteContext();
  const qc = useQueryClient();
  const listInc = useServerFn(listIncidents);
  const listPat = useServerFn(listPatrols);
  const loadOrg = useServerFn(getActiveOrg);
  const listReports = useServerFn(listSecurityReports);
  const recordReport = useServerFn(recordSecurityReport);
  const sendReport = useServerFn(sendReportDelivery);

  const { data: incidents = [], isLoading } = useQuery({ queryKey: ["report-centre-incidents", appAccess.orgId], queryFn: () => listInc() as Promise<IncidentRow[]> });
  const { data: patrols = [] } = useQuery({ queryKey: ["report-centre-patrols", appAccess.orgId], queryFn: () => listPat() as Promise<PatrolRow[]> });
  const { data: org } = useQuery({ queryKey: ["report-centre-org", appAccess.orgId], queryFn: () => loadOrg() as Promise<OrgRow | null> });
  const { data: history = [], isLoading: historyLoading, isError: historyError } = useQuery({
    queryKey: ["security-reports", appAccess.orgId],
    queryFn: () => listReports(),
    retry: false,
  });

  const [kind, setKind] = useState<Kind>("weekly");
  const [incidentId, setIncidentId] = useState<string>("");
  const [sending, setSending] = useState(false);
  const [generatedAt] = useState(() => Date.now());

  const orgName = org?.name ?? appAccess.orgName;
  const email = org?.billing_contact_email ?? null;
  const all = incidents as IncidentRow[];
  const sortedIncidents = useMemo(() => [...all].sort((a, b) => Date.parse(b.reported_at) - Date.parse(a.reported_at)), [all]);
  const selectedIncident = sortedIncidents.find((i) => i.id === incidentId) ?? null;

  const windowFor = (k: Kind) => {
    const days = k === "daily" ? 1 : k === "weekly" ? 7 : 30;
    return { start: generatedAt - days * DAY, end: generatedAt };
  };
  const win = windowFor(kind);
  const inWindow = useMemo(() => all.filter((i) => Date.parse(i.reported_at) >= win.start && Date.parse(i.reported_at) <= win.end), [all, win.start, win.end]);
  const meta = KINDS.find((k) => k.id === kind)!;
  const periodLabel = kind === "incident" ? (selectedIncident ? selectedIncident.code : "No incident chosen") : `${fmtDate(win.start)} – ${fmtDate(win.end)}`;

  const summaryText = useMemo(() => {
    if (kind === "incident") {
      if (!selectedIncident) return "";
      return `${selectedIncident.code}: ${typeMeta[selectedIncident.type] ?? selectedIncident.type} at ${selectedIncident.location} (${selectedIncident.zone}), severity ${selectedIncident.severity}, status ${selectedIncident.status}.`;
    }
    const high = inWindow.filter((i) => i.severity >= 4).length;
    const resolved = inWindow.filter((i) => i.status === "resolved" || i.status === "closed").length;
    return `${inWindow.length} incident${inWindow.length === 1 ? "" : "s"} reported ${periodLabel}: ${high} high or critical, ${resolved} resolved.`;
  }, [kind, selectedIncident, inWindow, periodLabel]);

  const canSend = !!email && (kind !== "incident" || !!selectedIncident);

  const emailReport = async () => {
    if (!email) return;
    setSending(true);
    try {
      const result = (await sendReport({ data: { report_name: `${meta.title} · ${periodLabel}`, summary: summaryText, recipient_emails: [email], report_url: null, unsubscribe_url: null } })) as {
        warning?: string;
        skipped?: boolean;
      };
      if (result?.warning || result?.skipped) {
        toast.error(`Not sent: ${result.warning ?? "email delivery isn't configured."}`);
        return;
      }
      try {
        await recordReport({ data: { title: meta.title, report_type: kind, period_label: periodLabel, summary: summaryText, channels: ["Email"], recipient_emails: [email] } });
        qc.invalidateQueries({ queryKey: ["security-reports", appAccess.orgId] });
      } catch (e) {
        toast.warning(`Sent, but not added to history: ${(e as Error).message}`);
        return;
      }
      toast.success(`Sent to ${email}`);
    } catch (e) {
      toast.error((e as Error)?.message || "The email didn't send.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]" style={{ alignItems: "start" }}>
      {/* Only the report sheet prints. */}
      <style>{`@media print { body * { visibility: hidden !important; } #report-sheet, #report-sheet * { visibility: visible !important; } #report-sheet { position: absolute; inset: 0 auto auto 0; width: 100%; box-shadow: none !important; } }`}</style>

      <div className="col g12">
        <div className="col">
          <h1 className="ph1">Report centre</h1>
          <span className="sub">Build a report from your live records, print it or email it.</span>
        </div>

        <Panel title="Report types" bodyClassName="">
          <div className="list">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                className="row g10 w-full text-left"
                aria-pressed={kind === k.id}
                onClick={() => setKind(k.id)}
                style={{ padding: "10px 14px", background: kind === k.id ? "var(--ink-2)" : undefined, borderLeft: `2px solid ${kind === k.id ? "var(--blue-hi)" : "transparent"}` }}
              >
                <span className="f1 col">
                  <b>{k.title}</b>
                  <span className="t3">{k.sub}</span>
                </span>
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="History" meta={historyError ? undefined : `${history.length}`} bodyClassName="">
          {historyLoading ? (
            <Empty>Loading…</Empty>
          ) : historyError ? (
            <Empty>Report history isn't available for this organisation yet.</Empty>
          ) : history.length === 0 ? (
            <Empty>No reports have been sent yet.</Empty>
          ) : (
            <div className="list scroll" style={{ maxHeight: 360 }}>
              {(history as SecurityReportRow[]).map((r) => (
                <div key={r.id} className="row g10" style={{ padding: "9px 14px" }} title={r.summary ?? undefined}>
                  <span className="f1 col" style={{ minWidth: 0 }}>
                    <span className="trunc">{r.title}</span>
                    <span className="t3 trunc" style={{ fontSize: 12 }}>
                      {r.period_label ?? ""}
                      {r.recipient_count ? ` · ${r.recipient_count} recipient${r.recipient_count === 1 ? "" : "s"}` : ""}
                    </span>
                  </span>
                  <span className="t3 mono" style={{ fontSize: 11 }}>
                    {new Date(r.generated_at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="col g12" style={{ minWidth: 0 }}>
        <div className="row g8 wrap">
          <span className="mono t3">Preview</span>
          <span className="tg">{periodLabel}</span>
          <span className="flex-auto" />
          {kind === "incident" && (
            <select className="in" style={{ width: 280 }} value={incidentId} onChange={(e) => setIncidentId(e.target.value)} aria-label="Incident">
              <option value="">Choose an incident</option>
              {sortedIncidents.slice(0, 200).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.code} · {typeMeta[i.type] ?? i.type} · {fmtDate(i.reported_at)}
                </option>
              ))}
            </select>
          )}
          <button type="button" className="b b-sec" onClick={() => window.print()} disabled={kind === "incident" && !selectedIncident}>
            <Printer className="h-4 w-4" /> Print or save PDF
          </button>
          <button type="button" className="b b-pri" onClick={emailReport} disabled={!canSend || sending} title={email ? `Send to ${email}` : "Add a billing contact email in Organisation settings to email reports"}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Email report
          </button>
        </div>
        {!email && <Notice tone="warn">There's no contact email for this organisation, so reports can't be emailed yet. Add one in Organisation settings.</Notice>}

        <div id="report-sheet" className="paper" style={{ borderRadius: 10, padding: "36px 40px", boxShadow: "0 1px 0 rgba(255,255,255,.04), 0 12px 32px rgba(0,0,0,.35)" }}>
          {isLoading ? (
            <span className="t3">Loading records…</span>
          ) : kind === "incident" ? (
            selectedIncident ? (
              <IncidentSheet incident={selectedIncident} orgName={orgName} generatedAt={generatedAt} />
            ) : (
              <span className="t3">Choose an incident above to build its report.</span>
            )
          ) : (
            <PeriodSheet title={meta.title} orgName={orgName} period={periodLabel} generatedAt={generatedAt} incidents={inWindow} patrols={(patrols as PatrolRow[]).filter((p) => !p.archived_at)} />
          )}
        </div>
      </div>
    </div>
  );
}

function SheetHeader({ title, orgName, period, generatedAt }: { title: string; orgName: string; period: string; generatedAt: number }) {
  return (
    <div className="col g4" style={{ borderBottom: "1px solid var(--paper-2)", paddingBottom: 14, marginBottom: 18 }}>
      <span className="t3 mono" style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase" }}>
        Lemtik Security · {orgName}
      </span>
      <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{title}</h2>
      <span className="t2" style={{ fontSize: 13 }}>
        {period} · generated {fmtDateTime(generatedAt)}
      </span>
    </div>
  );
}

function PeriodSheet({ title, orgName, period, generatedAt, incidents, patrols }: { title: string; orgName: string; period: string; generatedAt: number; incidents: IncidentRow[]; patrols: PatrolRow[] }) {
  const bySev = [5, 4, 3, 2, 1].map((s) => [s, incidents.filter((i) => Math.max(1, Math.min(5, Number(i.severity))) === s).length] as const);
  const byType = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of incidents) m.set(typeMeta[i.type] ?? i.type, (m.get(typeMeta[i.type] ?? i.type) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [incidents]);
  const byZone = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of incidents) m.set(i.zone || "No zone", (m.get(i.zone || "No zone") ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [incidents]);
  const high = incidents.filter((i) => i.severity >= 4).sort((a, b) => Date.parse(b.reported_at) - Date.parse(a.reported_at));
  const resolved = incidents.filter((i) => i.status === "resolved" || i.status === "closed").length;

  return (
    <div className="col g16" style={{ fontSize: 13 }}>
      <SheetHeader title={title} orgName={orgName} period={period} generatedAt={generatedAt} />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Fig label="Incidents" value={incidents.length} />
        <Fig label="High or critical" value={high.length} />
        <Fig label="Resolved" value={resolved} />
        <Fig label="Active patrol routes" value={patrols.length} />
      </div>
      {incidents.length === 0 ? (
        <p className="t2" style={{ margin: 0 }}>
          No incidents were reported in this period.
        </p>
      ) : (
        <>
          <SheetSection title="By severity">
            <SheetTable head={["Severity", "Incidents"]} rows={bySev.filter(([, n]) => n).map(([s, n]) => [SEV_NAME[s], String(n)])} />
          </SheetSection>
          <div className="grid gap-6 sm:grid-cols-2">
            <SheetSection title="By type">
              <SheetTable head={["Type", "Incidents"]} rows={byType.map(([t, n]) => [t, String(n)])} />
            </SheetSection>
            <SheetSection title="Busiest zones">
              <SheetTable head={["Zone", "Incidents"]} rows={byZone.map(([z, n]) => [z, String(n)])} />
            </SheetSection>
          </div>
          {high.length > 0 && (
            <SheetSection title="High and critical incidents">
              <SheetTable head={["Code", "Type", "Where", "Reported", "Status"]} rows={high.slice(0, 25).map((i) => [i.code, typeMeta[i.type] ?? i.type, `${i.location} · ${i.zone}`, fmtDateTime(i.reported_at), i.status])} />
            </SheetSection>
          )}
        </>
      )}
      {patrols.length > 0 && (
        <SheetSection title="Patrol routes (current round)">
          <SheetTable head={["Route", "Officer", "Waypoints checked", "Status"]} rows={patrols.map((p) => [`${p.code} · ${p.name}`, p.officer ?? "—", `${p.checked_in}/${p.waypoints}`, p.status.replace(/_/g, " ")])} />
        </SheetSection>
      )}
      <span className="t3" style={{ fontSize: 11 }}>
        Figures come from the incident and patrol records in Lemtik at the time this report was generated.
      </span>
    </div>
  );
}

function IncidentSheet({ incident, orgName, generatedAt }: { incident: IncidentRow; orgName: string; generatedAt: number }) {
  return (
    <div className="col g16" style={{ fontSize: 13 }}>
      <SheetHeader title={`Incident report · ${incident.code}`} orgName={orgName} period={fmtDateTime(incident.reported_at)} generatedAt={generatedAt} />
      <SheetTable
        head={["Field", "Value"]}
        rows={[
          ["Type", typeMeta[incident.type] ?? incident.type],
          ["Severity", `${incident.severity} · ${SEV_NAME[Math.max(1, Math.min(5, Number(incident.severity)))]}`],
          ["Status", incident.status],
          ["Location", incident.location],
          ["Zone", incident.zone],
          ["Reported", fmtDateTime(incident.reported_at)],
          ["Assigned officer", incident.officer ?? "—"],
        ]}
      />
      {incident.description && (
        <SheetSection title="Description">
          <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{incident.description}</p>
        </SheetSection>
      )}
      <span className="t3" style={{ fontSize: 12 }}>
        Timeline, evidence and chain of custody are on the{" "}
        <Link to="/app/incidents/$id" params={{ id: incident.id }} className="lnk">
          incident page
        </Link>
        .
      </span>
    </div>
  );
}

function Fig({ label, value }: { label: string; value: number }) {
  return (
    <div className="col">
      <span className="t3" style={{ fontSize: 11.5 }}>
        {label}
      </span>
      <b style={{ fontSize: 24, fontVariantNumeric: "tabular-nums" }}>{value}</b>
    </div>
  );
}

function SheetSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="col g8">
      <h3 style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>{title}</h3>
      {children}
    </section>
  );
}

function SheetTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} className="t3" style={{ textAlign: "left", fontWeight: 600, padding: "6px 8px 6px 0", borderBottom: "1px solid var(--paper-2)" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} style={{ padding: "6px 8px 6px 0", borderBottom: "1px solid var(--paper-2)", fontVariantNumeric: "tabular-nums" }}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
