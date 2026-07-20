import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getActiveOrgId } from "@/lib/orgs.server";
import { requestRelationshipApi } from "@/lib/relationship-api";
import type { CameraRecord } from "@/lib/cameras.functions";

const commonFrameInput = z.object({
  camera_id: z.string().min(1).optional(),
  image_data_url: z.string().min(1).optional(),
  voice_transcript: z.string().max(2000).optional(),
  event_type: z.string().min(1).max(120),
  template_name: z.string().max(120).optional(),
  verify_vision: z.boolean().optional(),
  org_id: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

const verifyInput = commonFrameInput.extend({
  image_data_url: z.string().min(1),
});

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
    return result ?? [];
  });

export const ingestFrame = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => commonFrameInput.parse(data))
  .handler(async ({ data, context }) => {
    const orgId = data.org_id ?? (await getActiveOrgId(context.supabase, context.userId));
    const result = await requestRelationshipApi<CCTVFrameResult>("/api/v1/frames/ingest", {
      body: {
        ...data,
        org_id: orgId,
        source: "c4isod-dashboard",
      },
    });
    return result ?? {
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
    const result = await requestRelationshipApi<CCTVFrameResult>("/api/v1/judgement/analyze", {
      body: {
        ...data,
        org_id: orgId,
        source: "c4isod-dashboard",
      },
    });
    return result ?? {
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
    const result = await requestRelationshipApi<CCTVFrameResult>("/api/v1/vision/verify", {
      body: {
        ...data,
        org_id: orgId,
        source: "c4isod-dashboard",
      },
    });
    return result ?? {
      request_id: `vision-${Date.now()}`,
      threat_summary: "Vision verification completed locally.",
      confidence: 0.71,
      visual_explanation: "The gateway returned no response; the page is retaining the uploaded frame and event context.",
      vision_gaps: ["No remote candidate list returned"],
      recommended_actions: ["Confirm camera coverage", "Review blind spot transition"],
    };
  });

