import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { BadgeAlert, CheckCircle2, Clock3, Loader2, MessageSquareMore, ShieldAlert, Sparkles, Target, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  submitAiQuery,
  submitAiRecommendation,
  submitApprovalDecision,
  type AiQueryResult,
  type AiRecommendation,
  type ApprovalProposal,
  type CommandScope,
} from "@/lib/ai-commands.functions";
import {
  loadStoredCommandIntent,
  type CommandHistoryEntry,
} from "@/lib/command-memory";

type IntentContext = {
  scope?: CommandScope;
  orgId?: string;
  selectedIds?: string[];
};

type AiChatWidgetProps = {
  title?: string;
  subtitle?: string;
  scope: CommandScope;
  context?: IntentContext;
  suggestions?: string[];
  className?: string;
  onQueryResult?: (intent: AiQueryResult) => void;
};

type HumanApprovalLayerProps = {
  title?: string;
  subtitle?: string;
  incidentId?: string | null;
  commandText?: string | null;
  scope?: CommandScope;
  orgId?: string | null;
  fallbackProposals?: ApprovalProposal[];
  className?: string;
  onDecision?: (
    decision: string,
    proposalIds: string[],
    details?: { note?: string; modification?: string; commandText?: string; priority?: string; scope?: string },
  ) => void;
};

const defaultSuggestions = [
  "Show critical incidents in Zone B",
  "Track REID targets crossing blind spots",
  "List patrols that missed check-ins in the last 24 hours",
];

export function AiChatWidget({
  title = "Natural Language Command",
  subtitle = "Convert operator text into structured filters for the Relationship API.",
  scope,
  context,
  suggestions = defaultSuggestions,
  className,
  onQueryResult,
}: AiChatWidgetProps) {
  const [text, setText] = useState("");
  const [lastIntent, setLastIntent] = useState<AiQueryResult | null>(null);
  const [history, setHistory] = useState<AiQueryResult[]>([]);
  const submitQuery = useServerFn(submitAiQuery);

  const activeSuggestion = useMemo(() => suggestions[0] ?? "", [suggestions]);

  useEffect(() => {
    if (!text && activeSuggestion) setText(activeSuggestion);
  }, [activeSuggestion, text]);

  useEffect(() => {
    const stored = loadStoredCommandIntent();
    if (!stored) return;
    setLastIntent(stored);
    setHistory([stored]);
  }, []);

  const send = async () => {
    const next = text.trim();
    if (!next) return;
    const intent = await submitQuery({
      data: {
        text: next,
        context: {
          scope,
          org_id: context?.orgId,
          selected_ids: context?.selectedIds ?? [],
        },
      },
    });
    setLastIntent(intent as AiQueryResult);
    setHistory((current) => [intent as AiQueryResult, ...current].slice(0, 4));
    onQueryResult?.(intent as AiQueryResult);
  };

  return (
    <section className={cn("rounded-3xl border border-white/10 bg-gradient-to-br from-white/8 to-transparent p-4 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.95)]", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-slate-400">
            <Sparkles className="h-3.5 w-3.5 text-high" />
            {title}
          </div>
          <h3 className="mt-2 text-lg font-semibold tracking-tight">{subtitle}</h3>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-300">
          <MessageSquareMore className="h-3.5 w-3.5" />
          Relationship API
        </span>
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3">
        <div className="flex flex-wrap gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void send();
              }
            }}
            className="min-w-[220px] flex-1 border-white/10 bg-black/20 text-sm text-slate-100 placeholder:text-slate-500"
            placeholder="Search high-risk alerts, patrol summaries, REID targets..."
          />
          <Button
            type="button"
            onClick={send}
            className="gap-2 rounded-full bg-primary px-4 text-sm text-primary-foreground shadow-lg shadow-primary/20"
          >
            <Wand2 className="h-4 w-4" />
            Query
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {suggestions.map((item) => (
              <button
                type="button"
                key={item}
                onClick={() => setText(item)}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-slate-200 transition hover:border-primary/50 hover:bg-primary/10"
              >
                {item}
              </button>
            ))}
          </div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
            Search only. No hardware command leaves this widget.
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Parsed filters</div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-200">
              <Target className="h-3.5 w-3.5 text-high" />
              {scope}
            </div>
          </div>
          {lastIntent ? (
            <div className="mt-3 space-y-2 text-sm">
              <KeyValue label="Query" value={lastIntent.filters.query} />
              <KeyValue label="Severity" value={lastIntent.filters.severityMin ? `>= ${lastIntent.filters.severityMin}` : "Any"} />
              <KeyValue label="Status" value={lastIntent.filters.status ?? "Any"} />
              <KeyValue label="Location" value={lastIntent.filters.location ?? "Any"} />
              <KeyValue label="Target" value={lastIntent.filters.target ?? "None"} />
              <KeyValue label="Scope" value={lastIntent.scope} />
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-dashed border-white/10 px-4 py-6 text-sm text-slate-400">
              No command parsed yet. Text entered here becomes a backend filter proposal, not a hardware action.
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Command history</div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-200">
              <ShieldAlert className="h-3.5 w-3.5 text-resolved" />
              Audit only
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {history.length ? (
              history.map((entry, index) => (
                <div key={`${entry.text}-${index}`} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-slate-100">{entry.summary}</div>
                      <div className="mt-1 text-xs text-slate-400">{entry.routingNote}</div>
                    </div>
                    <div className="rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-300">
                      {entry.confidence}%
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-sm text-slate-400">
                Recent commands will appear here after the Relationship API validates them.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

type ApprovalHistoryPanelProps = {
  entries: CommandHistoryEntry[];
  className?: string;
};

export function ApprovalHistoryPanel({ entries, className }: ApprovalHistoryPanelProps) {
  return (
    <section className={cn("rounded-3xl border border-white/10 bg-gradient-to-br from-white/6 to-transparent p-4 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.9)]", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-slate-400">
            <Clock3 className="h-3.5 w-3.5 text-high" />
            Approval history
          </div>
          <h3 className="mt-2 text-lg font-semibold tracking-tight">Recent human decisions</h3>
        </div>
        <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-300">
          Audit trail
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {entries.length ? (
          entries.map((entry) => (
            <article key={entry.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-100">{entry.summary}</div>
                  <div className="mt-1 text-xs text-slate-400">{entry.commandText}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-200">
                    {entry.decision.replace(/_/g, " ")}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-300">
                    {entry.proposalIds.length} items
                  </span>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300">
                  Scope {entry.scope}
                </span>
                {entry.priority && (
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300">
                    Priority {entry.priority}
                  </span>
                )}
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300">
                  {new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }).format(new Date(entry.at))}
                </span>
              </div>
              {entry.note ? <div className="mt-3 text-xs text-slate-400">Note: {entry.note}</div> : null}
            </article>
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-sm text-slate-400">
            No approval decisions have been recorded in this session yet.
          </div>
        )}
      </div>
    </section>
  );
}

export function HumanApprovalLayer({
  title = "Human-in-the-Loop Approval",
  subtitle = "Review AI reasoning, stage approval, and keep every action inside the Relationship API boundary.",
  incidentId,
  commandText,
  scope = "incidents",
  orgId,
  fallbackProposals = [],
  className,
  onDecision,
}: HumanApprovalLayerProps) {
  const submitDecision = useServerFn(submitApprovalDecision);
  const recommendResponse = useServerFn(submitAiRecommendation);
  const [recommendation, setRecommendation] = useState<AiRecommendation | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [selectedActions, setSelectedActions] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [editedRoute, setEditedRoute] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const result = await recommendResponse({
        data: {
          incident_id: incidentId ?? undefined,
          command_text: commandText ?? undefined,
          org_id: orgId ?? undefined,
          scope,
        },
      });
      if (cancelled) return;
      setRecommendation(result as AiRecommendation);
      if (result && (result as any).meta) {
        setOperationId((result as any).meta.operation_id || null);
        setRequestId((result as any).meta.request_id || null);
      }
      const actions = (result as AiRecommendation).actions ?? [];
      setSelectedActions(actions.filter((action) => action.selected).map((action) => action.id));
      setEditedRoute((result as AiRecommendation).dispatch_route.join(" → "));
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [commandText, incidentId, orgId, recommendResponse, scope]);

  const source = recommendation ?? {
    accepted: true,
    request_id: "local-fallback",
    priority: "medium" as const,
    suggested_patrols: fallbackProposals.slice(0, 3).map((proposal, index) => ({
      id: proposal.id,
      name: proposal.title,
      eta_minutes: 2 + index,
      route: proposal.reasoning[0] ?? proposal.title,
      confidence: proposal.confidence,
    })),
    dispatch_route: ["Command Node", "Response Point"],
    affected_devices: fallbackProposals.flatMap((proposal) => proposal.devices).slice(0, 6),
    actions: fallbackProposals.flatMap((proposal) =>
      proposal.devices.slice(0, 2).map((device, index) => ({
        id: `${proposal.id}-${index}`,
        label: index === 0 ? proposal.title : device,
        selected: index === 0,
        requiresApproval: true,
        kind: index === 0 ? "dispatch" : "device",
      })),
    ),
    reasoning: fallbackProposals.flatMap((proposal) => proposal.reasoning).slice(0, 5),
  };
  const selectedCount = selectedActions.length;
  const allActionIds = source.actions.map((action) => action.id);
  const chosenIds = selectedCount ? selectedActions : allActionIds;
  const activeReasoning = source.reasoning;
  const avgConfidence = Math.round(
    source.actions.length
      ? source.actions.reduce((acc, action) => acc + (action.selected ? 12 : 10), 0) / source.actions.length
      : 72,
  );

  const runDecision = async (decision: "approve_all" | "approve_selected" | "reject") => {
    setBusy(decision);
    try {
      const payload = {
        decision,
        proposal_ids: decision === "approve_all" ? allActionIds : chosenIds,
        note: note.trim() || undefined,
        modification: editedRoute.trim() || undefined,
        command_text: commandText ?? undefined,
        operation_id: operationId ?? undefined,
        request_id: requestId ?? undefined,
        org_id: orgId ?? undefined,
      };
      await submitDecision({ data: payload });
      onDecision?.(decision, payload.proposal_ids, {
        note: payload.note,
        modification: payload.modification,
        commandText: payload.command_text,
        scope,
        priority: source.priority,
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={cn("rounded-3xl border border-white/10 bg-gradient-to-br from-[#111827] via-[#0b1220] to-[#060a13] p-4 shadow-[0_24px_80px_-48px_rgba(15,23,42,1)]", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-slate-400">
            <CheckCircle2 className="h-3.5 w-3.5 text-resolved" />
            {title}
          </div>
          <h3 className="mt-2 text-lg font-semibold tracking-tight">{subtitle}</h3>
        </div>
        <div className="grid gap-2 text-right">
          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-slate-200">
            Confidence {avgConfidence}%
          </div>
          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-slate-300">
            Priority {source.priority} · {source.actions.length} actions
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-3">
          {source.actions.length ? (
            source.actions.map((action) => {
              const checked = selectedActions.includes(action.id);
              return (
                <label key={action.id} className={cn(
                  "block cursor-pointer rounded-2xl border p-4 transition-all",
                  checked ? "border-primary/50 bg-primary/10 shadow-[0_0_0_1px_rgba(59,130,246,0.2)]" : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/[0.08]",
                )}>
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setSelectedActions((current) => current.includes(action.id) ? current.filter((id) => id !== action.id) : [...current, action.id]);
                      }}
                      className="mt-1 h-4 w-4 rounded border-white/20 bg-transparent text-primary focus:ring-primary"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-slate-100">{action.label}</div>
                          <div className="mt-1 text-xs text-slate-400">{action.kind} · {action.requiresApproval ? "requires approval" : "auto"}</div>
                        </div>
                        <div className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-300">
                          {source.priority}
                        </div>
                      </div>
                      <div className="mt-3 text-sm text-slate-300">
                        {source.reasoning[0] ?? "Pending AI reasoning"}
                      </div>
                    </div>
                  </div>
                </label>
              );
            })
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-sm text-slate-400">
              No approval items are active yet. When AI produces a recommendation, it will appear here for human review.
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Response plan</div>
              <div className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-200">
                {source.priority}
              </div>
            </div>
            <div className="mt-3 space-y-2">
              <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100">
                <span className="text-xs uppercase tracking-[0.18em] text-slate-400">Dispatch route</span>
                <div className="mt-1 text-sm">{editedRoute || source.dispatch_route.join(" → ")}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Suggested patrols</div>
                <div className="mt-2 space-y-2">
                  {source.suggested_patrols.map((patrol) => (
                    <div key={patrol.id} className="flex items-center justify-between gap-3 text-sm text-slate-200">
                      <div>
                        <div className="font-medium">{patrol.name}</div>
                        <div className="text-xs text-slate-400">{patrol.route}</div>
                      </div>
                      <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-300">
                        {patrol.eta_minutes}m · {patrol.confidence}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Affected devices</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {source.affected_devices.map((device) => (
                    <span key={device} className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-slate-200">
                      {device}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Reasoning summary</div>
            <div className="mt-3 space-y-2 text-sm text-slate-200">
              {activeReasoning.length ? (
                activeReasoning.map((line) => (
                  <div key={line} className="flex items-start gap-2">
                    <BadgeAlert className="mt-0.5 h-4 w-4 text-high" />
                    <span>{line}</span>
                  </div>
                ))
              ) : (
                <div className="text-slate-400">No reasoning available yet.</div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-slate-400">
              <Clock3 className="h-3.5 w-3.5 text-high" />
              Edit draft
            </div>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional approval note"
              className="mt-3 border-white/10 bg-black/20 text-sm text-slate-100 placeholder:text-slate-500"
            />
            <Textarea
              value={editedRoute}
              onChange={(e) => setEditedRoute(e.target.value)}
              placeholder="Editable dispatch route"
              className="mt-3 min-h-[88px] border-white/10 bg-black/20 text-sm text-slate-100 placeholder:text-slate-500"
            />
            <div className="mt-3 text-xs text-slate-400">
              A modified route is submitted as a human-approved change request, not a direct device command.
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              onClick={() => void runDecision("approve_all")}
              className="rounded-xl bg-resolved px-4 text-sm font-medium text-white shadow-lg shadow-resolved/20"
              disabled={busy != null}
            >
              {busy === "approve_all" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Approve All
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void runDecision("approve_selected")}
              className="rounded-xl border-white/10 bg-white/5 px-4 text-sm text-slate-100 hover:bg-white/10"
              disabled={busy != null}
            >
              {busy === "approve_selected" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Approve Selected
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void runDecision("reject")}
              className="rounded-xl px-4 text-sm"
              disabled={busy != null}
            >
              {busy === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Reject
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
      <span className="text-xs uppercase tracking-[0.18em] text-slate-400">{label}</span>
      <span className="max-w-[60%] text-right text-sm text-slate-100">{value}</span>
    </div>
  );
}
