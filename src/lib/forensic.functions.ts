import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { throwSafeError } from "@/lib/server-errors";
import { getActiveOrgId } from "@/lib/orgs.server";
import { requestRelationshipApi } from "@/lib/relationship-api";

export const getForensicCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ incident_id: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const result = await requestRelationshipApi<Record<string, any>>(
      `/forensic/case/${data.incident_id}`,
      { method: "GET", query: { org_id: orgId }, headers: { "X-Org-Id": orgId } },
    );
    if (!result) throwSafeError("forensic.case", new Error("relationship API unreachable"), "Unable to load this case.");
    return result;
  });

export const getForensicTimeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ incident_id: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const result = await requestRelationshipApi<{ timeline: Record<string, any>[] }>(
      `/forensic/timeline/${data.incident_id}`,
      { method: "GET", query: { org_id: orgId }, headers: { "X-Org-Id": orgId } },
    );
    return result?.timeline ?? [];
  });

export const getForensicEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ incident_id: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const result = await requestRelationshipApi<Record<string, any>>(
      `/forensic/evidence/${data.incident_id}`,
      { method: "GET", query: { org_id: orgId }, headers: { "X-Org-Id": orgId } },
    );
    if (!result) throwSafeError("forensic.evidence", new Error("relationship API unreachable"), "Unable to load evidence for this case.");
    return result;
  });

export const queryForensicAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      incident_id: z.string().min(1),
      query: z.string().min(1),
      mode: z.enum(["plain", "technical"]).default("plain"),
      conversation_history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const result = await requestRelationshipApi<{
      response: string;
      sources: { type: string; id: string; timestamp: string | null }[];
      confidence: number | null;
      ai_generated: boolean;
      model: string | null;
      model_provider: string | null;
    }>("/forensic/ai/query", {
      method: "POST",
      headers: { "X-Org-Id": orgId },
      body: {
        org_id: orgId,
        analyst_id: context.userId,
        incident_id: data.incident_id,
        query: data.query,
        mode: data.mode,
        conversation_history: data.conversation_history || [],
      },
    });
    if (!result) throwSafeError("forensic.ai.query", new Error("relationship API unreachable"), "The assistant is unavailable right now.");
    return result;
  });

export const listMyForensicQueries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // forensic_ai_queries has RLS enabled with no policies (service-role only, by
    // design — see its migration), so this goes through the admin client with the
    // ownership check done here instead: every row is scoped to the caller's own
    // analyst_id by construction, never another analyst's or another org's.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("forensic_ai_queries" as any)
      .select("id, incident_id, query_text, response_text, response_mode, model_used, confidence, created_at")
      .eq("analyst_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throwSafeError("forensic.queries.mine", error, "Unable to load your query history.");
    return (data as unknown as Array<{
      id: string;
      incident_id: string;
      query_text: string;
      response_text: string | null;
      response_mode: string;
      model_used: string | null;
      confidence: number | null;
      created_at: string;
    }>) ?? [];
  });
