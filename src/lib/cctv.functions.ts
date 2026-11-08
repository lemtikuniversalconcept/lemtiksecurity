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

export function normalizeCameraList(payload: unknown): CameraRecord[] {
  if (!payload) return [];
  if (Array.isArray(payload)) {
    return payload.filter(Boolean) as CameraRecord[];
  }
  if (typeof payload !== "object") {
    return [];
  }

  const record = payload as Record<string, unknown>;

  // Recursively unwrap nested gateway 'data' objects
  if (record.data && typeof record.data === "object") {
    return normalizeCameraList(record.data);
  }

  const candidates = [record.cameras, record.items, record.results, record.records];

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

/**
 * Maps any of the gateway's analysis shapes (frame ingest, judgement, vision verify) onto one
 * result. Only fields the gateway actually returned are filled; nothing is defaulted to a
 * plausible-looking value.
 */
function normalizeDecisionResult(source: AnyRecord): CCTVFrameResult {
  const vision = (source.vision_result?.vision_event ?? source.vision_result ?? source.vision_event ?? {}) as AnyRecord;
  const analysis = (source.analysis ?? vision.analysis ?? {}) as AnyRecord;
  const telemetry = (source.telemetry_result?.telemetry ?? source.telemetry ?? {}) as AnyRecord;
  const continuity = (source.tracking_continuity ?? source.telemetry_result?.tracking_continuity ?? {}) as AnyRecord;
  const blindSpot = (continuity.blind_spot_prediction ?? analysis.blind_spot_prediction ?? {}) as AnyRecord;

  const rawConfidence = analysis.confidence ?? vision.confidence ?? source.confidence ?? telemetry.reid_confidence ?? source.score;
  const confidence = rawConfidence == null || !Number.isFinite(Number(rawConfidence)) ? null : Number(rawConfidence);

  const blindSpotPredictions: string[] = [];
  if (blindSpot.entered_blind_spot) {
    blindSpotPredictions.push(`Target entered a blind spot from camera ${blindSpot.source_camera_id ?? "unknown"}`);
  }
  if (Array.isArray(blindSpot.estimated_reappearance)) {
    for (const r of blindSpot.estimated_reappearance) {
      if (!isRecord(r)) continue;
      const prob = r.transition_probability == null ? "" : ` (probability ${Math.round(Number(r.transition_probability) * 100)}%)`;
      const secs = r.estimated_transition_seconds == null ? "" : ` in ~${r.estimated_transition_seconds}s`;
      blindSpotPredictions.push(`May reappear on camera ${r.camera_id ?? "unknown"}${r.zone ? ` (${r.zone})` : ""}${secs}${prob}`);
    }
  }

  const reidLogs: NonNullable<CCTVFrameResult["reid_matching_logs"]> = [];
  if (Array.isArray(continuity.candidates)) {
    for (const cand of continuity.candidates) {
      if (!isRecord(cand)) continue;
      const sim = cand.similarity ?? cand.match_confidence;
      reidLogs.push({
        status: cand.target_id === telemetry.target_id ? "Best match" : "Candidate",
        similarity: sim == null ? undefined : Number(sim),
        candidates: [
          cand.target_id ? `Target ${cand.target_id}` : null,
          cand.last_camera_id ? `Camera ${cand.last_camera_id}` : null,
          cand.last_zone ? `Zone ${cand.last_zone}` : null,
          cand.visual_descriptors?.clothing ? `Clothing: ${cand.visual_descriptors.clothing}` : null,
          asStringArray(cand.visual_descriptors?.dominant_colors).length ? `Colours: ${asStringArray(cand.visual_descriptors?.dominant_colors).join(", ")}` : null,
        ].filter((x): x is string => !!x),
      });
    }
  }
  if (Array.isArray(source.matches)) {
    for (const m of source.matches) {
      if (!isRecord(m)) continue;
      reidLogs.push({
        status: String(m.status ?? "Candidate"),
        similarity: m.similarity == null ? undefined : Number(m.similarity),
        candidates: Array.isArray(m.candidates) ? m.candidates.map(String) : [],
      });
    }
  }

  const requestId = source.request_id ?? vision.request_id ?? telemetry.request_id ?? null;
  return {
    id: source.frame_hash || source.id || vision.id || telemetry.id,
    request_id: requestId ? String(requestId) : undefined,
    threat_summary: analysis.threat_summary ?? analysis.summary ?? source.threat_summary ?? source.summary ?? undefined,
    confidence: confidence ?? undefined,
    visual_explanation:
      analysis.qwen_vision_explanation ?? analysis.visual_explanation ?? analysis.explanation ?? source.qwen_vision_explanation ?? source.visual_explanation ?? source.explanation ?? undefined,
    blind_spot_predictions: blindSpotPredictions,
    reid_matching_logs: reidLogs,
    decision_logs: asStringArray(source.decision_logs),
    match_status: continuity.match_status ?? source.match_status ?? undefined,
    recommended_actions: firstNonEmptyStringArray(analysis.recommended_follow_up_actions, analysis.recommended_actions, source.recommended_actions),
    vision_gaps: asStringArray(analysis.gaps ?? source.vision_gaps),
  };
}

export type CCTVFrameResult = {
  id?: string;
  request_id?: string;
  threat_summary?: string;
  /** 0–1, as the gateway returned it. Absent when the gateway gave none. */
  confidence?: number;
  visual_explanation?: string;
  blind_spot_predictions?: string[];
  reid_matching_logs?: Array<{ status?: string; similarity?: number; candidates?: string[] }>;
  decision_logs?: string[];
  match_status?: string;
  recommended_actions?: string[];
  vision_gaps?: string[];
};

const NO_RESPONSE = "The analysis service didn't return a result. Nothing was analysed. Check the gateway and try again.";

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
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const result = await requestRelationshipApi<GatewayEnvelope<AnyRecord>>("/api/v1/frames/ingest", {
      body: {
        ...data,
        frame_data: data.frame_data ?? data.image_data_url,
        org_id: orgId,
        source: "c4isod-dashboard",
      },
    });
    const dataResult = unwrapGatewayData<AnyRecord>(result);
    if (!dataResult) throw new Error(NO_RESPONSE);
    return normalizeDecisionResult(dataResult);
  });

export const analyzeJudgement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => commonFrameInput.parse(data))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const result = await requestRelationshipApi<GatewayEnvelope<AnyRecord>>("/api/v1/judgement/analyze", {
      body: {
        ...data,
        org_id: orgId,
        source: "c4isod-dashboard",
      },
    });
    const dataResult = unwrapGatewayData<AnyRecord>(result);
    if (!dataResult) throw new Error(NO_RESPONSE);
    return normalizeDecisionResult(dataResult);
  });

export const verifyVision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => verifyInput.parse(data))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const result = await requestRelationshipApi<GatewayEnvelope<AnyRecord>>("/api/v1/vision/verify", {
      body: {
        ...data,
        frame_data: data.frame_data,
        org_id: orgId,
        source: "c4isod-dashboard",
      },
    });
    const dataResult = unwrapGatewayData<AnyRecord>(result);
    if (!dataResult) throw new Error(NO_RESPONSE);
    return normalizeDecisionResult(dataResult);
  });
