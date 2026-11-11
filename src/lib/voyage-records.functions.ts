import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getActiveOrgId } from "@/lib/orgs.server";
import { throwSafeError } from "@/lib/server-errors";
import { recordBlackboxAudit } from "@/lib/audit.server";
import { statementText, type VoyageRecord } from "./voyage-records";

// Statements and media attached to a voyage, for its case file. Records can be added but never
// edited or removed, and each is fingerprinted (SHA-256) when it is added.

const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;
const COLS = "id, voyage_id, kind, given_by_name, given_by_role, given_by_contact, statement, path, file_name, mime, size_bytes, caption, sha256, taken_at, recorded_by_name, created_at";

async function guard(context: { supabase: unknown; userId: string }, voyageId: string) {
  const orgId = await getActiveOrgId(context.supabase as any, context.userId);
  await (await import("./features.server")).assertFeature(orgId, "movement");
  const db = await admin();
  const { roleIn, myName } = await import("./links.server");
  const role = await roleIn(db, context.userId, orgId);
  if (role !== "manager" && role !== "supervisor") throwSafeError("voyage.records", new Error("role"), "Only managers and operators can add statements and media.");
  const { data: v } = await db.from("movement_voyages").select("id").eq("id", voyageId).eq("organisation_id", orgId).maybeSingle();
  if (!v) throwSafeError("voyage.records", new Error("voyage"), "Voyage not found.");
  return { orgId, db, name: await myName(db, context.userId) };
}

export const listVoyageRecords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ voyage_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<(VoyageRecord & { url: string | null })[]> => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const sb = context.supabase as any;
    const { data: rows, error } = await sb.from("voyage_records").select(COLS).eq("voyage_id", data.voyage_id).eq("organisation_id", orgId).order("taken_at", { ascending: true }).limit(500);
    if (error) throwSafeError("voyage.records.list", error, "Unable to load statements and media.");
    const list = (rows ?? []) as VoyageRecord[];
    const paths = list.filter((r) => r.path).map((r) => r.path!);
    const { data: signed } = paths.length ? await sb.storage.from("incident-evidence").createSignedUrls(paths, 3600) : { data: [] };
    const byPath = new Map(((signed ?? []) as { path: string; signedUrl: string }[]).map((s) => [s.path, s.signedUrl]));
    return list.map((r) => ({ ...r, url: r.path ? byPath.get(r.path) ?? null : null }));
  });

export const addVoyageStatement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      voyage_id: z.string().uuid(),
      given_by_name: z.string().trim().min(1).max(120),
      given_by_role: z.string().trim().max(80).nullable(),
      given_by_contact: z.string().trim().max(120).nullable(),
      statement: z.string().trim().min(10, "Write at least a sentence.").max(20000),
      taken_at: z.string().datetime({ offset: true }),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (Date.parse(data.taken_at) > Date.now() + 60_000) throwSafeError("voyage.statement", new Error("future"), "The time taken can't be in the future.");
    const { orgId, db, name } = await guard(context, data.voyage_id);
    const { sha256Hex } = await import("./casefile.server");
    const row = { ...data, kind: "statement" as const, taken_at: new Date(data.taken_at).toISOString(), recorded_by_name: name };
    const sha256 = sha256Hex(statementText(row));
    const { data: saved, error } = await db.from("voyage_records").insert({ ...row, organisation_id: orgId, sha256, recorded_by: context.userId }).select("id").single();
    if (error) throwSafeError("voyage.statement", error, "Couldn't save the statement.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "voyage_statement", resourceId: saved.id, actionType: "create", actionDetail: { voyage_id: data.voyage_id, given_by: data.given_by_name, sha256 } });
    return { id: saved.id as string, sha256 };
  });

/** Records a file the browser has already uploaded to the evidence store, and fingerprints it. */
export const addVoyageMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      voyage_id: z.string().uuid(),
      path: z.string().max(300),
      file_name: z.string().trim().min(1).max(200),
      mime: z.string().max(100),
      caption: z.string().trim().max(500).nullable(),
      taken_at: z.string().datetime({ offset: true }).nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { orgId, db, name } = await guard(context, data.voyage_id);
    if (!data.path.startsWith(`${orgId}/voyages/${data.voyage_id}/`) || data.path.includes("..")) throwSafeError("voyage.media", new Error("path"), "That file isn't in this voyage's folder.");
    const { hashStoredFile } = await import("./casefile.server");
    const h = await hashStoredFile(db, data.path);
    if (!h) throwSafeError("voyage.media", new Error("unreadable"), "The upload didn't arrive. Try again.");
    const { data: saved, error } = await db
      .from("voyage_records")
      .insert({
        organisation_id: orgId,
        voyage_id: data.voyage_id,
        kind: "media",
        path: data.path,
        file_name: data.file_name,
        mime: data.mime || "application/octet-stream",
        size_bytes: h.size,
        caption: data.caption,
        sha256: h.sha256,
        taken_at: data.taken_at ? new Date(data.taken_at).toISOString() : new Date().toISOString(),
        recorded_by: context.userId,
        recorded_by_name: name,
      })
      .select("id")
      .single();
    if (error) throwSafeError("voyage.media", error, "Couldn't save the file.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "voyage_media", resourceId: saved.id, actionType: "create", actionDetail: { voyage_id: data.voyage_id, file: data.file_name, sha256: h.sha256 } });
    return { id: saved.id as string, sha256: h.sha256 };
  });
