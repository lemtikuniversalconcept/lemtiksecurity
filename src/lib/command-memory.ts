import type { AiQueryResult, ApprovalDecision, CommandScope } from "@/lib/ai-commands.functions";

const ACTIVE_INTENT_KEY = "lemtik_active_command_intent";
const APPROVAL_HISTORY_KEY = "lemtik_approval_history";

export type CommandHistoryEntry = {
  id: string;
  at: string;
  decision: ApprovalDecision;
  proposalIds: string[];
  commandText: string;
  summary: string;
  scope: CommandScope;
  priority?: "low" | "medium" | "high" | "critical";
  note?: string;
  modification?: string;
};

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage failures
  }
}

export function loadStoredCommandIntent(): AiQueryResult | null {
  return readJson<AiQueryResult>(ACTIVE_INTENT_KEY);
}

export function saveStoredCommandIntent(intent: AiQueryResult | null) {
  if (!intent) {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(ACTIVE_INTENT_KEY);
    }
    return;
  }
  writeJson(ACTIVE_INTENT_KEY, intent);
}

export function loadStoredCommandHistory(): CommandHistoryEntry[] {
  return readJson<CommandHistoryEntry[]>(APPROVAL_HISTORY_KEY) ?? [];
}

export function saveStoredCommandHistory(entries: CommandHistoryEntry[]) {
  writeJson(APPROVAL_HISTORY_KEY, entries.slice(0, 12));
}

export function appendStoredCommandHistory(entry: CommandHistoryEntry) {
  const current = loadStoredCommandHistory();
  saveStoredCommandHistory([entry, ...current]);
}
