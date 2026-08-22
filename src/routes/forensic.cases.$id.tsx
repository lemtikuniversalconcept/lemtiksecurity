import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2, FileStack, ScanFace, Sparkles, ChevronDown, ChevronRight } from "lucide-react";
import { getForensicCase, getForensicTimeline } from "@/lib/forensic.functions";

export const Route = createFileRoute("/forensic/cases/$id")({
  component: CaseDetailPage,
});

const TIMELINE_LABELS: Record<string, string> = {
  incident_logged: "Incident logged",
  status_changed: "Status changed",
  ai_recommendation: "AI recommendation",
  human_approval: "Operator decision",
  officer_dispatched: "Officer dispatched",
  autonomous_action: "Autonomous action",
  escalation: "Escalation",
  evidence_added: "Evidence added",
  evidence_legal_flagged: "Evidence flagged for legal hold",
  consumer_report: "Guest emergency report",
  note: "Note",
};

function TimelineCard({ event }: { event: any }) {
  const [open, setOpen] = useState(false);
  const hasDetail = event.detail && Object.keys(event.detail).length > 0;
  return (
    <div className="rounded-lg border border-[#2d3748] bg-[#1a2234] px-4 py-3">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((o) => !o)}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-[#94a3b8]">
            <span>{new Date(event.timestamp).toLocaleString()}</span>
            <span className="text-[#3b82f6]">{TIMELINE_LABELS[event.type] || event.type}</span>
          </div>
          <div className="mt-1 text-sm text-[#e2e8f0]">{event.summary}</div>
          <div className="mt-0.5 text-xs text-[#94a3b8]">by {event.actor}</div>
        </div>
        {hasDetail && (open ? <ChevronDown className="h-4 w-4 shrink-0 text-[#94a3b8]" /> : <ChevronRight className="h-4 w-4 shrink-0 text-[#94a3b8]" />)}
      </button>
      {open && hasDetail && (
        <pre className="mt-3 overflow-x-auto rounded-md bg-black/30 p-3 text-[11px] text-[#94a3b8]">
          {JSON.stringify(event.detail, null, 2)}
        </pre>
      )}
    </div>
  );
}

function CaseDetailPage() {
  const { id } = Route.useParams();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const getCase = useServerFn(getForensicCase);
  const getTimeline = useServerFn(getForensicTimeline);

  const { data: caseData, isLoading: caseLoading } = useQuery({
    queryKey: ["forensic-case", id],
    queryFn: () => getCase({ data: { incident_id: id } }),
  });
  const { data: timeline = [], isLoading: timelineLoading } = useQuery({
    queryKey: ["forensic-timeline", id],
    queryFn: () => getTimeline({ data: { incident_id: id } }),
  });

  if (caseLoading) {
    return <div className="flex items-center gap-2 text-sm text-[#94a3b8]"><Loader2 className="h-4 w-4 animate-spin" /> Loading case…</div>;
  }
  if (!caseData) {
    return <div className="text-sm text-[#94a3b8]">Case not found, or it doesn't belong to your organisation.</div>;
  }

  const incident = (caseData as any).incident;
  const tabs = [
    { to: `/forensic/cases/${id}/evidence`, label: "Evidence", icon: FileStack },
    { to: `/forensic/cases/${id}/reid`, label: "Re-ID Tracking", icon: ScanFace },
    { to: `/forensic/cases/${id}/ai`, label: "Ask AI", icon: Sparkles },
  ];
  const isOverview = pathname === `/forensic/cases/${id}`;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold text-white">{incident.title || incident.code}</h1>
          <span className="rounded-full bg-[#3b82f6]/15 px-2 py-0.5 text-[11px] text-[#3b82f6]">{incident.status}</span>
        </div>
        <p className="text-sm text-[#94a3b8]">{incident.code} · {incident.type} · severity {incident.severity}</p>
      </div>

      <div className="flex gap-1 border-b border-[#2d3748]">
        <Link
          to="/forensic/cases/$id"
          params={{ id }}
          className={`flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors ${
            isOverview ? "border-b-2 border-[#3b82f6] text-white" : "border-b-2 border-transparent text-[#94a3b8] hover:text-[#e2e8f0]"
          }`}
        >
          Overview
        </Link>
        {tabs.map((tab) => {
          const active = pathname === tab.to;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={`flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                active ? "border-b-2 border-[#3b82f6] text-white" : "border-b-2 border-transparent text-[#94a3b8] hover:text-[#e2e8f0]"
              }`}
            >
              <Icon className="h-4 w-4" /> {tab.label}
            </Link>
          );
        })}
      </div>

      {isOverview ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="flex flex-col gap-3 lg:col-span-2">
            <section className="rounded-lg border border-[#2d3748] bg-[#1a2234] p-4">
              <h2 className="text-[11px] uppercase tracking-wider text-[#94a3b8]">Incident</h2>
              <dl className="mt-2 space-y-1.5 text-sm">
                <Row label="Location" value={[incident.zone, incident.location, incident.floor].filter(Boolean).join(" · ")} />
                <Row label="Reported" value={new Date(incident.reported_at).toLocaleString()} />
                {incident.occurred_at && <Row label="Occurred" value={new Date(incident.occurred_at).toLocaleString()} />}
                <Row label="Description" value={incident.description || "—"} />
                {incident.suspect_description && <Row label="Suspect" value={incident.suspect_description} />}
                {incident.victim_name && <Row label="Victim" value={incident.victim_name} />}
              </dl>
            </section>

            <section className="rounded-lg border border-[#2d3748] bg-[#1a2234] p-4">
              <h2 className="text-[11px] uppercase tracking-wider text-[#94a3b8]">Officers involved</h2>
              {(caseData as any).officers_involved?.length ? (
                <ul className="mt-2 space-y-1 text-sm text-[#e2e8f0]">
                  {(caseData as any).officers_involved.map((o: any, i: number) => (
                    <li key={i}>{typeof o === "string" ? o : o.name || o.officer_id || JSON.stringify(o)}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-[#94a3b8]">No officer dispatch recorded for this case.</p>
              )}
            </section>

            <section className="rounded-lg border border-[#2d3748] bg-[#1a2234] p-4">
              <h2 className="text-[11px] uppercase tracking-wider text-[#94a3b8]">Guest emergency reports</h2>
              {(caseData as any).consumer_reports?.length ? (
                <ul className="mt-2 space-y-2 text-sm">
                  {(caseData as any).consumer_reports.map((r: any) => (
                    <li key={r.id} className="rounded-md bg-black/20 p-2">
                      <div className="text-[#e2e8f0]">{r.ai_transcription || r.description || r.report_type}</div>
                      <div className="mt-0.5 text-[11px] text-[#94a3b8]">{new Date(r.created_at).toLocaleString()} · {r.status}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-[#94a3b8]">None for this case.</p>
              )}
            </section>

            <section className="rounded-lg border border-[#2d3748] bg-[#1a2234] p-4">
              <h2 className="text-[11px] uppercase tracking-wider text-[#94a3b8]">Autonomous actions</h2>
              {(caseData as any).autonomous_actions?.length ? (
                <ul className="mt-2 space-y-1 text-sm text-[#e2e8f0]">
                  {(caseData as any).autonomous_actions.map((a: any) => (
                    <li key={a.action_log_id}>{a.action_key} on {a.device_name} — {a.execution_result}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-[#94a3b8]">No autonomous actions taken.</p>
              )}
            </section>
          </div>

          <div className="flex flex-col gap-2 lg:col-span-3">
            <h2 className="text-[11px] uppercase tracking-wider text-[#94a3b8]">Timeline</h2>
            {timelineLoading ? (
              <div className="flex items-center gap-2 text-sm text-[#94a3b8]"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
            ) : (
              <div className="flex flex-col gap-2">
                {(timeline as any[]).map((event, i) => <TimelineCard key={i} event={event} />)}
              </div>
            )}
          </div>
        </div>
      ) : (
        <Outlet />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] text-[#94a3b8]">{label}</dt>
      <dd className="text-[#e2e8f0]">{value}</dd>
    </div>
  );
}
