import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type CommandScope = "incidents" | "patrols" | "targets" | "intelligence" | "system";

export type ParsedCommandIntent = {
  text: string;
  scope: CommandScope;
  filters: {
    query: string;
    severityMin: number | null;
    status: string | null;
    location: string | null;
    zone: string | null;
    target: string | null;
  };
  confidence: number;
  summary: string;
  routingNote: string;
};

export type ApprovalDecision = "approve_all" | "approve_selected" | "reject" | "modify" | "delay";

export type ApprovalProposal = {
  id: string;
  title: string;
  confidence: number;
  reasoning: string[];
  devices: string[];
  risk: "low" | "medium" | "high";
  status: "pending" | "approved" | "rejected" | "delayed" | "modified";
};

export type AiQueryResult = ParsedCommandIntent & {
  accepted: boolean;
  request_id: string;
};

export type AiRecommendation = {
  accepted: boolean;
  request_id: string;
  priority: "low" | "medium" | "high" | "critical";
  suggested_patrols: Array<{
    id: string;
    name: string;
    eta_minutes: number;
    route: string;
    confidence: number;
  }>;
  dispatch_route: string[];
  affected_devices: string[];
  actions: Array<{
    id: string;
    label: string;
    selected: boolean;
    requiresApproval: boolean;
    kind: "patrol" | "device" | "zone" | "dispatch";
  }>;
  reasoning: string[];
};

const intentInput = z.object({
  text: z.string().min(1).max(500),
  context: z
    .object({
      scope: z.enum(["incidents", "patrols", "targets", "intelligence", "system"]).optional(),
      org_id: z.string().uuid().optional(),
      selected_ids: z.array(z.string().min(1)).max(50).optional(),
    })
    .optional(),
});

const queryInput = z.object({
  text: z.string().min(1).max(500),
  context: z
    .object({
      scope: z.enum(["incidents", "patrols", "targets", "intelligence", "system"]).optional(),
      org_id: z.string().uuid().optional(),
      selected_ids: z.array(z.string().min(1)).max(50).optional(),
    })
    .optional(),
});

const recommendationInput = z.object({
  incident_id: z.string().min(1).optional(),
  command_text: z.string().min(1).max(500).optional(),
  org_id: z.string().uuid().optional(),
  scope: z.enum(["incidents", "patrols", "targets", "intelligence", "system"]).optional(),
  selected_ids: z.array(z.string().min(1)).max(50).optional(),
});

const approvalInput = z.object({
  decision: z.enum(["approve_all", "approve_selected", "reject", "modify", "delay"]),
  proposal_ids: z.array(z.string().min(1)).max(50),
  note: z.string().max(500).optional(),
  delay_minutes: z.number().int().min(1).max(240).optional(),
  modification: z.string().max(500).optional(),
  command_text: z.string().max(500).optional(),
});

function relationshipApiConfig() {
  const baseUrl = process.env.RELATIONSHIP_API_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.RELATIONSHIP_API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey };
}

function controllerConfig() {
  const baseUrl = process.env.AUTONOMOUS_CONTROLLER_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.AUTONOMOUS_CONTROLLER_KEY?.trim();
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey };
}

function scoreConfidence(text: string) {
  const normalized = text.toLowerCase();
  const signalCount = [
    "incident",
    "patrol",
    "target",
    "lock",
    "camera",
    "zone",
    "floor",
    "wing",
    "respond",
    "elev",
    "blind spot",
    "perimeter",
  ].reduce((count, token) => count + (normalized.includes(token) ? 1 : 0), 0);
  return Math.max(62, Math.min(96, 68 + signalCount * 4));
}

function parseIntent(text: string, scope: CommandScope = "incidents"): ParsedCommandIntent {
  const normalized = text.trim().toLowerCase();
  const severityMin = normalized.includes("critical") || normalized.includes("sev 4") || normalized.includes("severity 4") || normalized.includes("4+") ? 4 : normalized.includes("high") ? 3 : null;
  const status = normalized.includes("resolved")
    ? "resolved"
    : normalized.includes("responding")
      ? "responding"
      : normalized.includes("open")
        ? "open"
        : normalized.includes("patrol")
          ? "active"
          : null;
  const locationMatch = normalized.match(/(?:zone|area|location|floor|wing)\s+([a-z0-9\- ]{2,30})/i);
  const targetMatch = normalized.match(/(reid-[a-z0-9\-]+)/i);
  const scopeHint = normalized.includes("patrol")
    ? "patrols"
    : normalized.includes("target") || targetMatch
      ? "targets"
      : normalized.includes("intel") || normalized.includes("osint")
        ? "intelligence"
        : normalized.includes("system") || normalized.includes("device")
          ? "system"
          : scope;

  return {
    text,
    scope: scopeHint,
    filters: {
      query: normalized.replace(/\s+/g, " ").trim(),
      severityMin,
      status,
      location: locationMatch?.[1]?.trim() ?? null,
      zone: normalized.includes("zone") ? (locationMatch?.[1]?.trim() ?? null) : null,
      target: targetMatch?.[1]?.toUpperCase?.() ?? null,
    },
    confidence: scoreConfidence(text),
    summary:
      scopeHint === "targets"
        ? `Track ${targetMatch?.[1]?.toUpperCase?.() ?? "tracked target"} and keep movement inside the selected topology.`
        : scopeHint === "patrols"
          ? "Filter active patrols, compliance, and missed check-ins from the live command feed."
          : scopeHint === "intelligence"
            ? "Focus on OSINT signals and area risk around the requested location."
            : "Filter incidents and live command data for the operator request.",
    routingNote: "Proposal staged for Relationship API validation and audit logging.",
  };
}

async function sendRelationshipApi<T>(path: string, body: Record<string, unknown>): Promise<T | null> {
  const config = relationshipApiConfig();
  if (!config) return null;
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": config.apiKey,
      "X-Client-Name": "c4isod-dashboard",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`Relationship API request failed: ${response.status} ${message}`.trim());
  }
  return response.json().catch(() => null);
}

async function sendAutonomousController<T>(path: string, body: Record<string, unknown>): Promise<T | null> {
  const config = controllerConfig();
  if (!config) return null;
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": config.apiKey,
      "X-Client-Name": "c4isod-dashboard",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`Autonomous controller request failed: ${response.status} ${message}`.trim());
  }
  return response.json().catch(() => null);
}

function buildRecommendation(text: string, context?: { scope?: CommandScope; selected_ids?: string[]; incident_id?: string }): AiRecommendation {
  const intent = parseIntent(text, context?.scope ?? "incidents");
  const focus = intent.filters.zone ?? intent.filters.location ?? intent.filters.target ?? intent.text.split(/\s+/).slice(0, 4).join(" ");
  const severity = intent.filters.severityMin ?? (intent.scope === "targets" ? 3 : 4);
  const priority: AiRecommendation["priority"] = severity >= 4 ? "critical" : severity >= 3 ? "high" : "medium";
  const patrolBase = context?.selected_ids?.length ? context.selected_ids : [context?.incident_id ?? `${intent.scope}-focus`];

  return {
    accepted: true,
    request_id: `local-${crypto.randomUUID()}`,
    priority,
    suggested_patrols: patrolBase.slice(0, 3).map((id, index) => ({
      id,
      name: `Patrol ${index + 1}`,
      eta_minutes: Math.max(1, 2 + index),
      route: `${focus} → Control Node ${index + 1}`,
      confidence: Math.max(72, 94 - index * 6),
    })),
    dispatch_route: [`${focus}`, "Primary Camera", "Command Node", "Response Point"],
    affected_devices: [
      `CCTV-${String(focus).replace(/\s+/g, "-").toUpperCase().slice(0, 12)}`,
      `ACCESS-${String(focus).replace(/\s+/g, "-").toUpperCase().slice(0, 12)}`,
      `RADIO-${String(intent.scope).toUpperCase()}`,
    ],
    actions: [
      {
        id: "lock-adjacent-entrance",
        label: "Lock adjacent entrance",
        selected: true,
        requiresApproval: true,
        kind: "zone",
      },
      {
        id: "rotate-ptz-camera-3",
        label: "Rotate PTZ Camera 3",
        selected: false,
        requiresApproval: true,
        kind: "device",
      },
      {
        id: "dispatch-nearest-patrol",
        label: "Dispatch nearest patrol",
        selected: true,
        requiresApproval: true,
        kind: "dispatch",
      },
    ],
    reasoning: [
      `Command scope resolved to ${intent.scope}.`,
      `Target focus: ${focus}.`,
      "Approval is mandatory before any action is forwarded to the Autonomous Controller.",
    ],
  };
}

export const submitCommandIntent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => intentInput.parse(data))
  .handler(async ({ data, context }) => {
    const intent = parseIntent(data.text, data.context?.scope ?? "incidents");
    const result = await sendRelationshipApi<{
      accepted?: boolean;
      request_id?: string;
      filters?: ParsedCommandIntent["filters"];
      scope?: CommandScope;
    }>("/api/v1/command-intents", {
      actor_id: context.userId,
      organisation_id: data.context?.org_id ?? null,
      scope: intent.scope,
      text: data.text,
      filters: intent.filters,
      selected_ids: data.context?.selected_ids ?? [],
      confidence: intent.confidence,
      source: "c4isod-dashboard",
    });

    return (
      result ?? {
        accepted: true,
        request_id: `local-${crypto.randomUUID()}`,
        scope: intent.scope,
        filters: intent.filters,
      }
    );
  });

export const submitAiQuery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => queryInput.parse(data))
  .handler(async ({ data, context }) => {
    const intent = parseIntent(data.text, data.context?.scope ?? "incidents");
    const result = await sendRelationshipApi<AiQueryResult>("/api/v1/ai/query", {
      actor_id: context.userId,
      organisation_id: data.context?.org_id ?? null,
      scope: intent.scope,
      text: data.text,
      filters: intent.filters,
      selected_ids: data.context?.selected_ids ?? [],
      confidence: intent.confidence,
      source: "c4isod-dashboard",
    });
    return result ?? {
      accepted: true,
      request_id: `local-${crypto.randomUUID()}`,
      ...intent,
    };
  });

export const submitAiRecommendation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => recommendationInput.parse(data))
  .handler(async ({ data, context }) => {
    const commandText = data.command_text ?? data.incident_id ?? "recommend response";
    const result = await sendRelationshipApi<AiRecommendation>("/api/v1/ai/recommend-response", {
      actor_id: context.userId,
      organisation_id: data.org_id ?? null,
      incident_id: data.incident_id ?? null,
      scope: data.scope ?? "incidents",
      selected_ids: data.selected_ids ?? [],
      command_text: commandText,
      source: "c4isod-dashboard",
    });
    return result ?? buildRecommendation(commandText, {
      scope: data.scope ?? "incidents",
      selected_ids: data.selected_ids ?? [],
      incident_id: data.incident_id,
    });
  });

export const submitApprovalDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => approvalInput.parse(data))
  .handler(async ({ data, context }) => {
    const result = await sendRelationshipApi<{
      accepted?: boolean;
      request_id?: string;
    }>("/api/v1/approval-decisions", {
      actor_id: context.userId,
      decision: data.decision,
      proposal_ids: data.proposal_ids,
      note: data.note ?? null,
      delay_minutes: data.delay_minutes ?? null,
      modification: data.modification ?? null,
      command_text: data.command_text ?? null,
      source: "c4isod-dashboard",
    });

    if (result?.accepted !== false) {
      await sendAutonomousController("/api/v1/actions/execute", {
        actor_id: context.userId,
        decision: data.decision,
        proposal_ids: data.proposal_ids,
        note: data.note ?? null,
        delay_minutes: data.delay_minutes ?? null,
        modification: data.modification ?? null,
        command_text: data.command_text ?? null,
        source: "c4isod-dashboard",
      });
    }

    return result ?? {
      accepted: true,
      request_id: `local-${crypto.randomUUID()}`,
    };
  });
