import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Loader2, X } from "lucide-react";
import { submitAiRecommendation, submitApprovalDecision, type AiRecommendation } from "@/lib/ai-commands.functions";
import { appendStoredCommandHistory, loadStoredCommandHistory, type CommandHistoryEntry } from "@/lib/command-memory";
import { Confidence } from "@/components/nw";

/*
 * AI proposals for one incident. Only two sources count as AI output: a model result from the
 * recommendation service, and a plan the backend stored on the incident. The service's offline
 * fallback (request_id "local-…") is a fixed template, so it is never shown as a proposal.
 */

export type ProposalIncident = {
  id: string;
  code: string;
  dispatch_plan?: { recommended_actions?: unknown } | null;
  agent_output?: { recommended_actions?: unknown } | null;
};

export type Proposal = { id: string; title: string; detail: string | null; confidence: number | null };

type Recommendation = AiRecommendation & { meta?: { operation_id?: string; request_id?: string } };

function storedPlan(incident: ProposalIncident): Proposal[] {
  const raw = incident.dispatch_plan?.recommended_actions ?? incident.agent_output?.recommended_actions;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((a: any, idx: number) => {
    const title = typeof a === "string" ? a : a?.title || a?.label || a?.name;
    if (!title) return [];
    const obj = typeof a === "object" && a ? a : null;
    const confidence = obj && Number.isFinite(Number(obj.confidence)) ? Number(obj.confidence) : null;
    const detail = obj ? ((Array.isArray(obj.reasoning) ? obj.reasoning[0] : obj.detail || obj.description) ?? null) : null;
    return [{ id: String(obj?.id || `${incident.id}-plan-${idx}`), title: String(title), detail, confidence }];
  });
}

export function useIncidentProposals(incident: ProposalIncident | null, orgId: string) {
  const recommend = useServerFn(submitAiRecommendation);
  const query = useQuery({
    queryKey: ["ai-recommendation", incident?.id],
    queryFn: () => recommend({ data: { incident_id: incident!.id, org_id: orgId, scope: "incidents" } }) as Promise<Recommendation>,
    enabled: !!incident,
    staleTime: 5 * 60_000,
    retry: 0,
  });
  const rec = query.data ?? null;
  const fromModel = !!rec && !String(rec.request_id ?? "").startsWith("local-");
  const proposals: Proposal[] = incident
    ? [
        ...storedPlan(incident),
        ...(fromModel ? rec!.actions.map((a) => ({ id: a.id, title: a.label, detail: rec!.reasoning?.[0] ?? null, confidence: null })) : []),
      ]
    : [];
  const emptyReason = query.isError
    ? "Couldn’t reach the recommendation service."
    : rec && !fromModel
      ? `No AI recommendations for ${incident?.code} — the recommendation service didn’t return a model result.`
      : `No AI proposals for ${incident?.code}.`;
  return { proposals, loading: query.isLoading, emptyReason, rec, fromModel };
}

export function useProposalDecisions(incident: ProposalIncident | null, orgId: string, actor: string, rec: Recommendation | null, fromModel: boolean) {
  const decide = useServerFn(submitApprovalDecision);
  const [history, setHistory] = useState<CommandHistoryEntry[]>(() => loadStoredCommandHistory());
  const [busy, setBusy] = useState<string | null>(null);

  const decided = (id: string) => history.find((h) => h.proposalIds.includes(id) && h.commandText === incident?.code);

  const run = async (proposal: Proposal, decision: "approve_selected" | "reject") => {
    if (!incident) return;
    setBusy(`${proposal.id}:${decision}`);
    try {
      const result = (await decide({
        data: {
          decision,
          proposal_ids: [proposal.id],
          command_text: incident.code,
          operation_id: rec?.meta?.operation_id,
          request_id: rec?.meta?.request_id ?? (fromModel ? rec?.request_id : undefined),
          org_id: orgId,
        },
      })) as { request_id?: string; controller_warning?: string | null } | null;
      const entry: CommandHistoryEntry = {
        id: `${Date.now()}-${proposal.id}`,
        at: new Date().toISOString(),
        decision,
        proposalIds: [proposal.id],
        commandText: incident.code,
        summary: `${decision === "reject" ? "Denied" : "Approved"} · ${proposal.title}`,
        scope: "incidents",
        note: `${actor}${result?.request_id?.startsWith("local-") ? " · recorded on this device only" : ""}`,
      };
      appendStoredCommandHistory(entry);
      setHistory((h) => [entry, ...h]);
      if (result?.controller_warning) toast.warning(decision === "reject" ? "Denied" : "Approved", { description: result.controller_warning });
      else toast.success(decision === "reject" ? "Denied" : "Approved");
    } catch (err) {
      toast.error("Couldn’t record that decision", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  };

  return { decided, run, busy };
}

export function ProposalCard({
  proposal,
  decision,
  readOnly,
  busy,
  onDecide,
}: {
  proposal: Proposal;
  decision: CommandHistoryEntry | undefined;
  readOnly: boolean;
  busy: string | null;
  onDecide: (decision: "approve_selected" | "reject") => void;
}) {
  if (decision) {
    const approved = decision.decision !== "reject";
    return (
      <div className="ai done col g6" style={{ padding: "9px 11px" }}>
        <div className="row g8">
          <span className="f1 trunc" style={{ fontWeight: 600 }}>{proposal.title}</span>
          <span className={`tg ${approved ? "tg-ok" : "tg-fail"}`}>
            {approved ? <Check size={12} strokeWidth={2.4} /> : <X size={12} strokeWidth={2.4} />}
            {approved ? "Approved" : "Denied"}
          </span>
        </div>
        <span className="t2 trunc" style={{ fontSize: 12 }}>
          {decision.note} · {new Date(decision.at).toLocaleTimeString("en-GB")}
        </span>
      </div>
    );
  }
  return (
    <div className="ai col g6" style={{ padding: "9px 11px" }}>
      <div className="row g8">
        <span className="f1 trunc" style={{ fontWeight: 600 }}>{proposal.title}</span>
        <Confidence value={proposal.confidence} size={11.5} />
      </div>
      {proposal.detail && <div className="t2 trunc" style={{ fontSize: 12 }}>{proposal.detail}</div>}
      <div className="row g8">
        <span className="t3 f1 trunc" style={{ fontSize: 11.5 }}>{readOnly ? "View only for client admins" : "Proposed · awaiting a decision"}</span>
        {!readOnly && (
          <>
            <button type="button" className="b b-sm b-gh" disabled={busy !== null} onClick={() => onDecide("reject")}>
              Deny
            </button>
            <button type="button" className="b b-sm b-pri" disabled={busy !== null} onClick={() => onDecide("approve_selected")}>
              {busy === `${proposal.id}:approve_selected` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check size={14} strokeWidth={1.75} />}
              Approve
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** The violet "Needs your decision" list for one incident, used by the overview, live map and incident page. */
export function IncidentProposals({ incident, orgId, readOnly, actor, limit = 3 }: { incident: ProposalIncident | null; orgId: string; readOnly: boolean; actor: string; limit?: number }) {
  const { proposals, loading, emptyReason, rec, fromModel } = useIncidentProposals(incident, orgId);
  const { decided, run, busy } = useProposalDecisions(incident, orgId, actor, rec, fromModel);
  if (!incident) return <div className="empty">No incident selected. AI proposals for an incident appear here for a person to approve.</div>;
  if (loading)
    return (
      <div className="row g8 t2" style={{ fontSize: 12.5 }}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Asking for recommendations on {incident.code}…
      </div>
    );
  if (proposals.length === 0) return <div className="empty">{emptyReason}</div>;
  return (
    <>
      {proposals.slice(0, limit).map((p) => (
        <ProposalCard key={p.id} proposal={p} decision={decided(p.id)} readOnly={readOnly} busy={busy} onDecide={(d) => run(p, d)} />
      ))}
    </>
  );
}
