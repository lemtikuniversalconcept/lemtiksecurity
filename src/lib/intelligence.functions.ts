import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getActiveOrgId } from "@/lib/orgs.server";
import { requestRelationshipApi } from "@/lib/relationship-api";

export type BriefEntry = {
  id: string;
  generatedAt: string;
  title: string;
  summary: string;
  highlights: string[];
  score: number;
  windowLabel: string;
};

const getBriefsInput = z.object({
  org_id: z.string().uuid().optional(),
});

const generateBriefInput = z.object({
  title: z.string().min(1).max(160),
  summary: z.string().max(2400).optional(),
  highlights: z.array(z.string().min(1).max(180)).max(12).optional(),
  score: z.number().int().min(0).max(100).optional(),
  windowLabel: z.string().max(80).optional(),
  items: z.array(z.record(z.string(), z.any())).optional(),
  context: z.record(z.string(), z.any()).optional(),
  org_id: z.string().uuid().optional(),
});

export const getBriefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => getBriefsInput.parse(data ?? {}))
  .handler(async ({ data, context }) => {
    const orgId = data.org_id ?? (await getActiveOrgId(context.supabase, context.userId));
    const result = await requestRelationshipApi<BriefEntry[]>("/api/v1/briefs", {
      method: "GET",
      query: { org_id: orgId },
    });
    return result ?? [];
  });

export const generateBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => generateBriefInput.parse(data))
  .handler(async ({ data, context }) => {
    const orgId = data.org_id ?? (await getActiveOrgId(context.supabase, context.userId));
    const result = await requestRelationshipApi<BriefEntry>("/api/v1/briefs/generate", {
      body: {
        org_id: orgId,
        ...data,
        source: "c4isod-dashboard",
      },
    });
    return result ?? {
      id: `brief-${Date.now()}`,
      generatedAt: new Date().toISOString(),
      title: data.title,
      summary: data.summary ?? "",
      highlights: data.highlights ?? [],
      score: data.score ?? 0,
      windowLabel: data.windowLabel ?? "Current window",
    };
  });

