import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { throwSafeError } from "@/lib/server-errors";
import { getActiveOrgId } from "@/lib/orgs.server";
import { requestRelationshipApi, relationshipApiConfig } from "@/lib/relationship-api";

// ---------------------------------------------------------------------------
// Operator-facing: issue a guest session token. Everything below this point
// is called by the unauthenticated consumer PWA — it passes its own token
// as a plain argument (not a header), since these are TanStack server
// functions running on this app's server, not a direct browser call to
// relationship_api.
// ---------------------------------------------------------------------------

export const issueConsumerSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      location_id: z.string().optional(),
      guest_reference: z.string().optional(),
      expires_in_hours: z.number().min(1).max(168).default(24),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const expiresAt = new Date(Date.now() + data.expires_in_hours * 3600 * 1000).toISOString();
    const result = await requestRelationshipApi<{ token: string; qr_code_url: string; expires_at: string }>(
      "/consumer/session/issue",
      {
        method: "POST",
        body: {
          org_id: orgId,
          created_by: context.userId,
          location_id: data.location_id,
          guest_reference: data.guest_reference,
          expires_at: expiresAt,
        },
      },
    );
    if (!result) throwSafeError("consumer.session.issue", new Error("relationship API unreachable"), "Unable to issue a guest access code right now.");
    return result;
  });

type ActivateResult =
  | {
      valid: true;
      status: string;
      session_id: string;
      organisation_name: string;
      expires_at: string;
      geofence: { lat: number | null; lng: number | null; radius_m: number };
      allowed_ssids: string[];
    }
  | { valid: false; reason: string };

export const activateConsumerSession = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      token: z.string().min(1),
      device_wifi_ssid: z.string().optional(),
      device_lat: z.number().optional(),
      device_lng: z.number().optional(),
    }).parse(d),
  )
  .handler(async ({ data }): Promise<ActivateResult> => {
    // requestRelationshipApi throws away the response body on a non-2xx status, but
    // that body is exactly where /consumer/session/activate puts the real failure
    // reason (invalid_token / expired / outside_premises / deactivated) — a plain
    // fetch here keeps that reason instead of collapsing every failure into one
    // generic message.
    const config = relationshipApiConfig();
    if (!config) throwSafeError("consumer.session.activate", new Error("relationship API not configured"), "Could not connect. Please try again.");
    const response = await fetch(`${config.baseUrl}/consumer/session/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": config.apiKey, "X-Client-Name": "c4isod-dashboard" },
      body: JSON.stringify(data),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { valid: false, reason: body?.reason || "invalid_token" };
    }
    const result = { valid: true as const, ...body };
    return result;
  });

export const validateConsumerSessionToken = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      token: z.string().min(1),
      lat: z.number().optional(),
      lng: z.number().optional(),
      wifi_ssid: z.string().optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const result = await requestRelationshipApi<{ valid: boolean; reason: string | null }>(
      "/consumer/session/validate",
      {
        method: "GET",
        query: { lat: data.lat, lng: data.lng, wifi_ssid: data.wifi_ssid },
        headers: { "X-Consumer-Token": data.token },
      },
    );
    return result ?? { valid: false, reason: "invalid_token" as const };
  });

export const createConsumerReport = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      token: z.string().min(1),
      report_type: z.string().optional(),
      description: z.string().optional(),
      location_text: z.string().optional(),
      lat: z.number().optional(),
      lng: z.number().optional(),
      accuracy_m: z.number().optional(),
      ai_transcription: z.string().optional(),
      ai_language: z.string().optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { token, ...body } = data;
    const result = await requestRelationshipApi<{ report_id: string; status: string; message: string }>(
      "/consumer/report",
      { method: "POST", body, headers: { "X-Consumer-Token": token } },
    );
    if (!result) throwSafeError("consumer.report.create", new Error("relationship API unreachable"), "Could not send your report. Please try again.");
    return result;
  });

export const updateConsumerReport = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      token: z.string().min(1),
      report_id: z.string().min(1),
      description: z.string().optional(),
      location_text: z.string().optional(),
      lat: z.number().optional(),
      lng: z.number().optional(),
      accuracy_m: z.number().optional(),
      ai_transcription: z.string().optional(),
      ai_language: z.string().optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { token, report_id, ...body } = data;
    const result = await requestRelationshipApi<{ report_id: string; status: string }>(
      `/consumer/report/${report_id}`,
      { method: "PATCH", body, headers: { "X-Consumer-Token": token } },
    );
    return result;
  });

export const sendIntakeTurn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      token: z.string().min(1),
      report_id: z.string().min(1),
      transcript: z.string().min(1),
      conversation_history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { token, report_id, ...body } = data;
    const result = await requestRelationshipApi<{
      spoken_response: string;
      follow_up_question: string | null;
      danger_detected: boolean;
      ai_generated: boolean;
    }>(`/consumer/report/${report_id}/intake-turn`, {
      method: "POST",
      body,
      headers: { "X-Consumer-Token": token },
    });
    if (!result) throwSafeError("consumer.report.intakeTurn", new Error("relationship API unreachable"), "Could not process that right now. Please try again.");
    return result;
  });

export const getConsumerReportStatus = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ token: z.string().min(1), report_id: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data }) => {
    const result = await requestRelationshipApi<{
      report_id: string;
      status: string;
      created_at: string;
      linked_incident: boolean;
    }>(`/consumer/report/${data.report_id}/status`, {
      method: "GET",
      headers: { "X-Consumer-Token": data.token },
    });
    return result;
  });

export const queryConsumerAi = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      token: z.string().min(1),
      report_id: z.string().optional(),
      query: z.string().min(1),
      conversation_history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { token, ...body } = data;
    const result = await requestRelationshipApi<{
      response: string;
      ai_generated: boolean;
      model: string | null;
      model_provider: string | null;
    }>("/consumer/ai/query", { method: "POST", body, headers: { "X-Consumer-Token": token } });
    if (!result) throwSafeError("consumer.ai.query", new Error("relationship API unreachable"), "The assistant is unavailable right now.");
    return result;
  });
