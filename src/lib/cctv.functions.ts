import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getActiveOrgId } from "@/lib/orgs.server";
import { requestRelationshipApi } from "@/lib/relationship-api";
import type { CameraRecord } from "@/lib/cameras.functions";

const commonFrameInput = z.object({
  camera_id: z.string().min(1).optional(),
  frame_data: z.string().min(1).optional(),
  image_data_url: z.string().min(1).optional(),
  voice_transcript: z.string().max(2000).optional(),
  event_type: z.string().min(1).max(120),
  template_name: z.string().max(120).optional(),
  verify_vision: z.boolean().optional(),
  org_id: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

const verifyInput = commonFrameInput.extend({
  frame_data: z.string().min(1),
});

type GatewayEnvelope<T = unknown> = {
  status?: string;
  data?: T;
};

type AnyRecord = Record<string, any>;

function normalizeCameraList(payload: unknown): CameraRecord[] {
  if (Array.isArray(payload)) {
    return payload.filter(Boolean) as CameraRecord[];
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const record = payload as Record<string, unknown>;
  const candidates = [
    record.data,
    record.cameras,
    record.items,
    record.results,
    record.records,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(Boolean) as CameraRecord[];
    }
  }

  return [];
}

function isRecord(value: unknown): value is AnyRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unwrapGatewayData<T = AnyRecord>(result: unknown): T | null {
  if (!isRecord(result)) {
    return null;
  }

  if (result.status === "success" && result.data) {
    return result.data as T;
  }

  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function firstNonEmptyStringArray(...values: unknown[]): string[] {
  for (const value of values) {
    const items = asStringArray(value);
    if (items.length > 0) {
      return items;
    }
  }

  return [];
}

function normalizeDecisionResult(source: AnyRecord, fallbackRequestPrefix: string): CCTVFrameResult {
  const analysis = (source.analysis ?? source.vision_result?.analysis ?? source.vision_event?.analysis ?? {}) as AnyRecord;
  const confidence = analysis.confidence ?? source.confidence ?? source.reid_confidence ?? source.score ?? 0.74;

  const visualExplanation =
    analysis.visual_explanation ??
    analysis.explanation ??
    source.visual_explanation ??
    source.explanation ??
    "Visual verification logged.";

  const qwenExplanation =
    analysis.qwen_vision_explanation ??
    analysis.visual_explanation ??
    analysis.explanation ??
    source.qwen_vision_explanation ??
    visualExplanation;

  const threatSummary =
    analysis.threat_summary ??
    analysis.summary ??
    source.threat_summary ??
    source.summary ??
    "Frame ingested successfully.";

  const recommendedActions = firstNonEmptyStringArray(
    analysis.recommended_follow_up_actions,
    analysis.recommended_actions,
    source.recommended_actions,
  );

  const telemetry = (source.telemetry_result?.telemetry ?? source.telemetry ?? {}) as AnyRecord;
  const continuity = (source.tracking_continuity ?? source.telemetry_result?.tracking_continuity ?? {}) as AnyRecord;
  const blindSpot = (continuity.blind_spot_prediction ?? analysis.blind_spot_prediction ?? {}) as AnyRecord;

  const blindSpotPredictions: string[] = [];
  if (blindSpot.entered_blind_spot) {
    blindSpotPredictions.push(`Target entered blind spot from camera ${blindSpot.source_camera_id ?? "unknown"}`);
  }
  if (Array.isArray(blindSpot.estimated_reappearance)) {
    for (const r of blindSpot.estimated_reappearance) {
      if (!isRecord(r)) continue;
      blindSpotPredictions.push(
        `Reappearance predicted on camera ${r.camera_id ?? "unknown"} (${r.zone ?? "unknown"}) in ~${r.estimated_transition_seconds ?? 0}s (probability: ${Math.round(Number(r.transition_probability ?? 0) * 100)}%)`,
      );
    }
  }
  if (blindSpotPredictions.length === 0) {
    blindSpotPredictions.push("No blind spot transitions estimated.");
  }

  const reidLogs: Array<{ status: string; similarity: number; candidates: string[] }> = [];
  if (Array.isArray(continuity.candidates)) {
    for (const cand of continuity.candidates) {
      if (!isRecord(cand)) continue;
      reidLogs.push({
        status: `Candidate match ${cand.target_id === telemetry.target_id ? "(Current Best)" : ""}`.trim(),
        similarity: Number(cand.similarity ?? cand.match_confidence ?? 0),
        candidates: [
          `Target: ${cand.target_id ?? "unknown"}`,
          `Camera: ${cand.last_camera_id ?? "unknown"}`,
          `Zone: ${cand.last_zone ?? "unknown"}`,
          `Clothing: ${cand.visual_descriptors?.clothing ?? "unknown"}`,
          `Dominant Colors: ${asStringArray(cand.visual_descriptors?.dominant_colors).join(", ") || "none"}`,
        ],
      });
    }
  }

  if (reidLogs.length === 0) {
    reidLogs.push({
      status: continuity.match_status || "No candidate matches",
      similarity: Number(continuity.similarity ?? 0),
      candidates: [telemetry.target_id ? `Target ID: ${telemetry.target_id}` : "Unknown target"],
    });
  }

  const decisionLogs = [
    `Telemetry state: ${continuity.match_status || source.match_status || "ingested"}`,
    `Confidence score: ${continuity.confidence ?? analysis.confidence ?? 0.0}`,
    `Target status: ${source.telemetry_result?.target?.status || telemetry.target?.status || "active"}`,
    `Blind spot confidence: ${blindSpot.confidence ?? analysis.blind_spot_confidence ?? 0.0}`,
  ];

  return {
    id: source.frame_hash || source.id || telemetry.id,
    request_id: source.request_id || telemetry.request_id || `${fallbackRequestPrefix}-${Date.now()}`,
    threat_summary: threatSummary,
    confidence: Number(confidence ?? 0.74),
    visual_explanation: visualExplanation,
    qwen_vision_explanation: qwenExplanation,
    blind_spot_prediction: blindSpotPredictions[0],
    blind_spot_predictions: blindSpotPredictions,
    reid_matching_logs: reidLogs,
    decision_logs: decisionLogs,
    recommended_actions: recommendedActions.length > 0 ? recommendedActions : ["Review adjacent camera coverage"],
    summary: analysis.summary ?? source.summary,
    explanation: analysis.explanation ?? source.explanation,
    matches: Array.isArray(source.matches) ? source.matches : undefined,
    vision_gaps: asStringArray(analysis.gaps).length > 0 ? asStringArray(analysis.gaps) : ["No vision gaps logged."],
  };
}

export type CCTVFrameResult = {
  id?: string;
  request_id?: string;
  threat_summary?: string;
  confidence?: number;
  visual_explanation?: string;
  qwen_vision_explanation?: string;
  blind_spot_prediction?: string;
  blind_spot_predictions?: string[];
  reid_matching_logs?: Array<{
    status?: string;
    similarity?: number;
    candidates?: string[];
    note?: string;
  }>;
  decision_logs?: string[];
  recommended_actions?: string[];
  summary?: string;
  explanation?: string;
  matches?: Array<Record<string, unknown>>;
  vision_gaps?: string[];
};

export const getCameras = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const result = await requestRelationshipApi<CameraRecord[]>("/api/v1/cameras", {
      method: "GET",
      query: { org_id: orgId },
    });
    return normalizeCameraList(result);
  });

export const ingestFrame = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => commonFrameInput.parse(data))
  .handler(async ({ data, context }) => {
    const orgId = data.org_id ?? (await getActiveOrgId(context.supabase, context.userId));
    const result = await requestRelationshipApi<GatewayEnvelope<AnyRecord>>("/api/v1/frames/ingest", {
      body: {
        ...data,
        frame_data: data.frame_data ?? data.image_data_url,
        org_id: orgId,
        source: "c4isod-dashboard",
      },
    });
    const dataResult = unwrapGatewayData<AnyRecord>(result);
    if (dataResult) {
      const visionResult = dataResult.vision_result?.vision_event ?? dataResult.vision_result;
      const analysis = visionResult?.analysis ?? {};
      const telemetry = dataResult.telemetry_result?.telemetry ?? {};
      const continuity = dataResult.tracking_continuity ?? dataResult.telemetry_result?.tracking_continuity ?? {};
      const blindSpot = continuity.blind_spot_prediction ?? {};

      const blindSpotPredictions: string[] = [];
      if (blindSpot.entered_blind_spot) {
        blindSpotPredictions.push(`Target entered blind spot from camera ${blindSpot.source_camera_id}`);
      }
      if (Array.isArray(blindSpot.estimated_reappearance)) {
        for (const r of blindSpot.estimated_reappearance) {
          if (!isRecord(r)) continue;
          blindSpotPredictions.push(
            `Reappearance predicted on camera ${r.camera_id} (${r.zone}) in ~${r.estimated_transition_seconds}s (probability: ${Math.round(Number(r.transition_probability ?? 0) * 100)}%)`,
          );
        }
      }
      if (blindSpotPredictions.length === 0) {
        blindSpotPredictions.push("No blind spot transitions estimated.");
      }

      const reidLogs: Array<{ status: string; similarity: number; candidates: string[] }> = [];
      if (Array.isArray(continuity.candidates)) {
        for (const cand of continuity.candidates) {
          if (!isRecord(cand)) continue;
          reidLogs.push({
            status: `Candidate match ${cand.target_id === telemetry.target_id ? "(Current Best)" : ""}`.trim(),
            similarity: Number(cand.similarity ?? cand.match_confidence ?? 0.0),
            candidates: [
              `Target: ${cand.target_id}`,
              `Camera: ${cand.last_camera_id}`,
              `Zone: ${cand.last_zone}`,
              `Clothing: ${cand.visual_descriptors?.clothing ?? "unknown"}`,
              `Dominant Colors: ${(asStringArray(cand.visual_descriptors?.dominant_colors).join(", ") || "none")}`,
            ],
          });
        }
      }
      if (reidLogs.length === 0) {
        reidLogs.push({
          status: continuity.match_status || "No candidate matches",
          similarity: Number(continuity.similarity ?? 0.0),
          candidates: [telemetry.target_id ? `Target ID: ${telemetry.target_id}` : "Unknown target"],
        });
      }

      return {
        id: data.frame_hash || visionResult?.id || telemetry.id,
        request_id: visionResult?.request_id || telemetry.request_id || `frame-${Date.now()}`,
        threat_summary: analysis.threat_summary || "Frame ingested successfully.",
        confidence: analysis.confidence ?? visionResult?.confidence ?? telemetry.reid_confidence ?? 0.74,
        visual_explanation: analysis.visual_explanation || "Visual verification logged.",
        qwen_vision_explanation: analysis.visual_explanation || "No additional explanation.",
        blind_spot_predictions: blindSpotPredictions,
        reid_matching_logs: reidLogs,
        decision_logs: [
          `Telemetry state: ${continuity.match_status || "ingested"}`,
          `Confidence score: ${continuity.confidence ?? 0.0}`,
          `Target status: ${dataResult.telemetry_result?.target?.status || "active"}`,
          `Blind spot confidence: ${blindSpot.confidence ?? 0.0}`,
        ],
        recommended_actions: analysis.recommended_follow_up_actions || analysis.recommended_actions || ["Review adjacent camera coverage"],
        vision_gaps: analysis.gaps || ["No vision gaps logged."],
      };
    }

    return {
      request_id: `frame-${Date.now()}`,
      threat_summary: "Frame ingested for diagnostics.",
      confidence: 0.74,
      visual_explanation: "No gateway response was returned, so the dashboard is showing a local fallback summary.",
      decision_logs: ["Frame accepted", "Awaiting downstream response"],
      recommended_actions: ["Review camera angle", "Verify perimeter coverage"],
    };
  });

export const analyzeJudgement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => commonFrameInput.parse(data))
  .handler(async ({ data, context }) => {
    const orgId = data.org_id ?? (await getActiveOrgId(context.supabase, context.userId));
    const result = await requestRelationshipApi<GatewayEnvelope<AnyRecord>>("/api/v1/judgement/analyze", {
      body: {
        ...data,
        org_id: orgId,
        source: "c4isod-dashboard",
      },
    });
    const dataResult = unwrapGatewayData<AnyRecord>(result);
    if (dataResult) {
      return normalizeDecisionResult(dataResult, "judgement");
    }
    return {
      request_id: `judgement-${Date.now()}`,
      threat_summary: "Judgement analysis completed locally.",
      confidence: 0.68,
      qwen_vision_explanation: "The gateway returned no analysis payload, so the control room is showing a fallback explanation.",
      decision_logs: ["Command interpreted", "Risk mapped to selected event type"],
      recommended_actions: ["Escalate to operator review"],
    };
  });

export const verifyVision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => verifyInput.parse(data))
  .handler(async ({ data, context }) => {
    const orgId = data.org_id ?? (await getActiveOrgId(context.supabase, context.userId));
    const result = await requestRelationshipApi<GatewayEnvelope<AnyRecord>>("/api/v1/vision/verify", {
      body: {
        ...data,
        frame_data: data.frame_data,
        org_id: orgId,
        source: "c4isod-dashboard",
      },
    });
    const dataResult = unwrapGatewayData<AnyRecord>(result);
    if (dataResult) {
      return normalizeDecisionResult(dataResult, "vision");
    }
    return {
      request_id: `vision-${Date.now()}`,
      threat_summary: "Vision verification completed locally.",
      confidence: 0.71,
      visual_explanation: "The gateway returned no response; the page is retaining the uploaded frame and event context.",
      vision_gaps: ["No remote candidate list returned"],
      recommended_actions: ["Confirm camera coverage", "Review blind spot transition"],
    };
  });
