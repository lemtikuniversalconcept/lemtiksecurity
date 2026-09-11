import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2, FileStack, ScanFace, Sparkles, ChevronDown, ChevronRight, Printer, Send } from "lucide-react";
import { getForensicCase, getForensicTimeline, getForensicEvidence, addForensicCaseNote } from "@/lib/forensic.functions";

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
  forensic_note: "Analyst note",
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
  const getEvidence = useServerFn(getForensicEvidence);
  const addNote = useServerFn(addForensicCaseNote);
  const queryClient = useQueryClient();
  const [noteText, setNoteText] = useState("");

  const { data: caseData, isLoading: caseLoading } = useQuery({
    queryKey: ["forensic-case", id],
    queryFn: () => getCase({ data: { incident_id: id } }),
  });
  const { data: timeline = [], isLoading: timelineLoading } = useQuery({
    queryKey: ["forensic-timeline", id],
    queryFn: () => getTimeline({ data: { incident_id: id } }),
  });
  // Fetched here (not just in the Evidence tab) so the printable case file below
  // can include a full evidence manifest without the analyst needing to visit
  // every tab first.
  const { data: evidenceData } = useQuery({
    queryKey: ["forensic-evidence", id],
    queryFn: () => getEvidence({ data: { incident_id: id } }),
  });

  const noteMutation = useMutation({
    mutationFn: () => addNote({ data: { incident_id: id, note: noteText.trim() } }),
    onSuccess: () => {
      setNoteText("");
      void queryClient.invalidateQueries({ queryKey: ["forensic-timeline", id] });
    },
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
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-white">{incident.title || incident.code}</h1>
            <span className="rounded-full bg-[#3b82f6]/15 px-2 py-0.5 text-[11px] text-[#3b82f6]">{incident.status}</span>
          </div>
          <p className="text-sm text-[#94a3b8]">{incident.code} · {incident.type} · severity {incident.severity}</p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="forensic-no-print flex shrink-0 items-center gap-1.5 rounded-md border border-[#2d3748] bg-[#1a2234] px-3 py-1.5 text-xs text-[#e2e8f0] hover:bg-white/5"
        >
          <Printer className="h-3.5 w-3.5" /> Print case file
        </button>
      </div>

      <div className="forensic-no-print flex gap-1 border-b border-[#2d3748]">
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
              <h2 className="text-[11px] uppercase tracking-wider text-[#94a3b8]">Guest emergency report</h2>
              {(caseData as any).consumer_report ? (
                <div className="mt-2 rounded-md bg-black/20 p-2 text-sm">
                  <div className="text-[#e2e8f0]">
                    Reported via the guest emergency app
                    {(caseData as any).consumer_report.guest_reference ? ` · ${(caseData as any).consumer_report.guest_reference}` : ""}
                  </div>
                  {(caseData as any).consumer_report.activated_at && (
                    <div className="mt-0.5 text-[11px] text-[#94a3b8]">
                      Session activated {new Date((caseData as any).consumer_report.activated_at).toLocaleString()}
                    </div>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-sm text-[#94a3b8]">Not reported via the guest app.</p>
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

            <section className="rounded-lg border border-[#2d3748] bg-[#1a2234] p-4">
              <h2 className="text-[11px] uppercase tracking-wider text-[#94a3b8]">Analyst notes</h2>
              <div className="mt-2 space-y-2">
                {(timeline as any[]).filter((e) => e.type === "forensic_note").length === 0 && (
                  <p className="text-sm text-[#94a3b8]">No notes on this case yet.</p>
                )}
                {(timeline as any[])
                  .filter((e) => e.type === "forensic_note")
                  .map((e, i) => (
                    <div key={i} className="rounded-md bg-black/20 p-2 text-sm">
                      <div className="text-[#e2e8f0]">{e.summary}</div>
                      <div className="mt-0.5 text-[11px] text-[#94a3b8]">{e.actor} · {new Date(e.timestamp).toLocaleString()}</div>
                    </div>
                  ))}
              </div>
              <div className="mt-3 flex flex-col gap-2">
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Record a finding for the case record…"
                  rows={2}
                  className="w-full resize-none rounded-md border border-[#2d3748] bg-[#0a0f1e] px-3 py-2 text-sm text-[#e2e8f0] placeholder:text-[#94a3b8]/60 focus:border-[#3b82f6] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => noteText.trim() && noteMutation.mutate()}
                  disabled={!noteText.trim() || noteMutation.isPending}
                  className="flex items-center justify-center gap-1.5 self-end rounded-md bg-[#3b82f6] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                >
                  {noteMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Add note
                </button>
                {noteMutation.isError && (
                  <p className="text-[11px] text-[#ef4444]">{(noteMutation.error as Error).message}</p>
                )}
              </div>
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

      <PrintableCaseFile caseData={caseData} timeline={timeline as any[]} evidence={evidenceData as any} />
    </div>
  );
}

// Rendered off-screen at all times and shown only under print media (see
// ForensicShell's .forensic-no-print rule for the inverse) — a plain, self-
// contained document an analyst can hand off as a case file, independent of
// which on-screen tab was active when they hit print.
function PrintableCaseFile({ caseData, timeline, evidence }: { caseData: any; timeline: any[]; evidence: any }) {
  if (!caseData) return null;
  const incident = caseData.incident;
  const notes = timeline.filter((e) => e.type === "forensic_note");
  const caseFiles = evidence?.case_files || [];
  const cctvSnapshots = evidence?.cctv_snapshots || [];

  return (
    <div className="hidden print:block print:text-black">
      <h1 className="text-xl font-bold">{incident.title || incident.code}</h1>
      <p className="text-sm">
        {incident.code} · {incident.type} · severity {incident.severity} · status {incident.status}
      </p>
      <p className="mt-1 text-xs text-black/60">Printed {new Date().toLocaleString()} · Lemtik Security forensic case file</p>

      <h2 className="mt-4 text-sm font-semibold uppercase tracking-wide">Incident</h2>
      <table className="mt-1 w-full text-sm">
        <tbody>
          <tr><td className="w-32 py-0.5 align-top text-black/60">Location</td><td>{[incident.zone, incident.location, incident.floor].filter(Boolean).join(" · ") || "—"}</td></tr>
          <tr><td className="py-0.5 align-top text-black/60">Reported</td><td>{new Date(incident.reported_at).toLocaleString()}</td></tr>
          {incident.occurred_at && <tr><td className="py-0.5 align-top text-black/60">Occurred</td><td>{new Date(incident.occurred_at).toLocaleString()}</td></tr>}
          <tr><td className="py-0.5 align-top text-black/60">Description</td><td>{incident.description || "—"}</td></tr>
          {incident.suspect_description && <tr><td className="py-0.5 align-top text-black/60">Suspect</td><td>{incident.suspect_description}</td></tr>}
          {incident.victim_name && <tr><td className="py-0.5 align-top text-black/60">Victim</td><td>{incident.victim_name}</td></tr>}
        </tbody>
      </table>

      <h2 className="mt-4 text-sm font-semibold uppercase tracking-wide">Officers involved</h2>
      {caseData.officers_involved?.length ? (
        <ul className="mt-1 list-disc pl-5 text-sm">
          {caseData.officers_involved.map((o: any, i: number) => (
            <li key={i}>{typeof o === "string" ? o : o.name || o.officer_id || JSON.stringify(o)}</li>
          ))}
        </ul>
      ) : <p className="mt-1 text-sm">No officer dispatch recorded.</p>}

      <h2 className="mt-4 text-sm font-semibold uppercase tracking-wide">Guest emergency report</h2>
      <p className="mt-1 text-sm">
        {caseData.consumer_report
          ? `Reported via the guest emergency app${caseData.consumer_report.guest_reference ? ` · ${caseData.consumer_report.guest_reference}` : ""}`
          : "Not reported via the guest app."}
      </p>

      <h2 className="mt-4 text-sm font-semibold uppercase tracking-wide">Autonomous actions</h2>
      {caseData.autonomous_actions?.length ? (
        <ul className="mt-1 list-disc pl-5 text-sm">
          {caseData.autonomous_actions.map((a: any) => (
            <li key={a.action_log_id}>{a.action_key} on {a.device_name} — {a.execution_result}</li>
          ))}
        </ul>
      ) : <p className="mt-1 text-sm">No autonomous actions taken.</p>}

      <h2 className="mt-4 text-sm font-semibold uppercase tracking-wide">Evidence manifest ({caseFiles.length + cctvSnapshots.length} items)</h2>
      {caseFiles.length === 0 && cctvSnapshots.length === 0 ? (
        <p className="mt-1 text-sm">No evidence attached.</p>
      ) : (
        <ul className="mt-1 list-disc pl-5 text-sm">
          {caseFiles.map((f: any, i: number) => (
            <li key={`f${i}`}>
              {f.name} ({f.kind}) — added by {f.added_by_name || "—"} on {new Date(f.added_at).toLocaleString()}
              {f.legal ? " — LEGAL HOLD" : ""}
            </li>
          ))}
          {cctvSnapshots.map((s: any, i: number) => (
            <li key={`c${i}`}>
              CCTV snapshot, camera {s.camera_id}, target {s.target_id} — {new Date(s.timestamp).toLocaleString()}
              {s.confidence != null ? ` (${Math.round(s.confidence * 100)}% re-id confidence)` : ""}
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-4 text-sm font-semibold uppercase tracking-wide">Analyst notes</h2>
      {notes.length === 0 ? (
        <p className="mt-1 text-sm">No notes recorded.</p>
      ) : (
        <ul className="mt-1 list-disc pl-5 text-sm">
          {notes.map((n, i) => (
            <li key={i}>{n.summary} — {n.actor}, {new Date(n.timestamp).toLocaleString()}</li>
          ))}
        </ul>
      )}

      <h2 className="mt-4 text-sm font-semibold uppercase tracking-wide">Full timeline</h2>
      <table className="mt-1 w-full text-sm">
        <tbody>
          {timeline.map((e, i) => (
            <tr key={i} className="align-top">
              <td className="w-40 py-0.5 pr-2 text-xs text-black/60 whitespace-nowrap">{new Date(e.timestamp).toLocaleString()}</td>
              <td className="py-0.5 pr-2 text-xs font-medium">{TIMELINE_LABELS[e.type] || e.type}</td>
              <td className="py-0.5">{e.summary} <span className="text-black/60">— {e.actor}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
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
