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

// osint's /briefs and /briefs/generate return { org_id, days, markdown } - raw markdown text,
// never the structured BriefEntry shape this dashboard's UI is built around. The UI code used to
// do `as BriefEntry` on that raw response, which is a type-level lie: at runtime `next.id`,
// `next.highlights`, etc. were all undefined, so the brief panel silently fell back to
// locally-computed placeholder content instead of ever showing what osint actually generated.
// This parses the real markdown (see weekly_report_markdown in osint/operations/core.py for the
// exact format) into the shape the UI expects.
type OsintBriefResponse = { org_id?: string; days?: number; markdown?: string };

function parseBriefMarkdown(payload: OsintBriefResponse, orgId: string): BriefEntry {
  const markdown = payload.markdown ?? "";
  const days = payload.days ?? 7;

  const generatedMatch = markdown.match(/Generated:\s*(.+)/);
  const generatedAt = generatedMatch ? new Date(generatedMatch[1].trim()).toISOString() : new Date().toISOString();

  const riskMatch = markdown.match(/Week's risk rating:\s*(\w+)/);
  const riskRating = riskMatch ? riskMatch[1].trim() : "Green";
  const score = { Red: 90, Orange: 60, Green: 25 }[riskRating] ?? 40;

  const verifyMatch = markdown.match(/Severity 3\+ items still requiring independent verification:\s*(\d+)/);
  const highCritMatch = markdown.match(/High\/Critical items:\s*(\d+)/);
  const verifyCount = verifyMatch ? Number(verifyMatch[1]) : 0;
  const highCritCount = highCritMatch ? Number(highCritMatch[1]) : 0;
  const summary =
    highCritCount > 0 || verifyCount > 0
      ? `${highCritCount} high/critical item${highCritCount === 1 ? "" : "s"}, ${verifyCount} still requiring independent verification.`
      : "No significant items in this window.";

  const summarySectionMatch = markdown.match(/## Executive Summary\n([\s\S]*?)(?=\n## |$)/);
  const highlights = (summarySectionMatch?.[1] ?? "")
    .split("\n")
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 6);

  return {
    id: `brief-${orgId}-${generatedAt}`,
    generatedAt,
    title: `Weekly Intelligence Brief — ${riskRating} risk`,
    summary,
    highlights: highlights.length ? highlights : ["No logged incidents in this period."],
    score,
    windowLabel: `Last ${days} days`,
  };
}

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
    // osint's /briefs returns the single latest brief for the window, not a list - there's no
    // "list brief history" endpoint on osint yet, so this wraps the one available brief in an
    // array rather than pretending a fuller history exists.
    const result = await requestRelationshipApi<OsintBriefResponse>("/api/v1/briefs", {
      method: "GET",
      query: { org_id: orgId },
    });
    if (!result?.markdown) return [];
    return [parseBriefMarkdown(result, orgId)];
  });

export const generateBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => generateBriefInput.parse(data))
  .handler(async ({ data, context }) => {
    const orgId = data.org_id ?? (await getActiveOrgId(context.supabase, context.userId));
    const result = await requestRelationshipApi<OsintBriefResponse>("/api/v1/briefs/generate", {
      body: {
        org_id: orgId,
        ...data,
        source: "c4isod-dashboard",
      },
    });
    if (result?.markdown) return parseBriefMarkdown(result, orgId);
    return {
      id: `brief-${Date.now()}`,
      generatedAt: new Date().toISOString(),
      title: data.title,
      summary: data.summary ?? "",
      highlights: data.highlights ?? [],
      score: data.score ?? 0,
      windowLabel: data.windowLabel ?? "Current window",
    };
  });

export const getBriefings = getBriefs;
export const generateBriefing = generateBrief;
