import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getActiveOrgId } from "@/lib/orgs.server";
import { throwSafeError } from "@/lib/server-errors";
import { recordBlackboxAudit } from "@/lib/audit.server";
import { admin, logEvent, myName, roleIn } from "@/lib/links.server";
import { trainingState, type TrainingState } from "@/lib/isps.rules";

// Drill evidence (photos, documents, attendance, lessons learned) and training records for
// security staff. Files go straight from the browser to a private bucket through a short-lived
// signed link; when attached, the server reads each one back and stores its SHA-256 so the
// record shows if a file was ever swapped.

export const EVIDENCE_BUCKET = "isps-evidence";
export const EVIDENCE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"] as const;
export const EVIDENCE_MAX_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 20;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const opt = (n: number) => z.string().trim().max(n).nullable().transform((v) => (v ? v : null));
const fileIn = z.object({ name: z.string().min(1).max(200), type: z.enum(EVIDENCE_TYPES), size: z.number().int().min(1).max(EVIDENCE_MAX_BYTES, "Each file can be up to 25 MB.") });
const lagosToday = () => new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);

export type EvidenceFile = { path: string; name: string; type: string; size: number; sha256: string; added_at: string; added_by_name: string | null };
export type EvidenceFileView = Omit<EvidenceFile, "path"> & { path: string; url: string | null };
export type Attendee = { name: string; role: string | null };

async function ctx(context: { supabase: unknown; userId: string }) {
  const orgId = await getActiveOrgId(context.supabase as any, context.userId);
  const db = await admin();
  const role = await roleIn(db, context.userId, orgId);
  return { orgId, db, role };
}
function canRecord(role: string | null) {
  if (!role || !["manager", "supervisor"].includes(role)) throwSafeError("isps.evidence", new Error("role"), "Only managers and operators can add evidence and training records.");
}
async function signedUploadUrl(db: any, prefix: string, name: string) {
  const safe = name.replace(/[^\w.\-]+/g, "_").slice(-80) || "file";
  const path = `${prefix}${crypto.randomUUID()}-${safe}`;
  const { data, error } = await db.storage.from(EVIDENCE_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throwSafeError("isps.evidence", (error ?? new Error("upload")) as Error, "Couldn't prepare the upload. Try again.");
  return { path, token: data.token as string };
}
async function fingerprint(db: any, path: string) {
  const { data, error } = await db.storage.from(EVIDENCE_BUCKET).download(path);
  if (error || !data) return null;
  const bytes = new Uint8Array(await (data as Blob).arrayBuffer());
  const { createHash } = await import("node:crypto");
  return { sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.byteLength, type: (data as Blob).type || "application/octet-stream" };
}
async function sign(db: any, paths: string[]) {
  const urls = new Map<string, string>();
  if (!paths.length) return urls;
  const { data } = await db.storage.from(EVIDENCE_BUCKET).createSignedUrls(paths, 3600);
  for (const s of data ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  return urls;
}
const drillPrefix = (orgId: string, drillId: string) => `${orgId}/drills/${drillId}/`;
const trainingPrefix = (orgId: string) => `${orgId}/training/`;

/** The viewer's own org, or an org that shares ISPS records with the viewer's org (logged). */
async function readableOrg(db: any, userId: string, myOrg: string, orgId: string, area: string) {
  if (orgId === myOrg) return;
  const { data: link } = await db.from("org_links").select("id, owner_org_id, partner_org_id, scopes").eq("owner_org_id", orgId).eq("partner_org_id", myOrg).eq("status", "active").gt("expires_at", new Date().toISOString()).contains("scopes", ["isps"]).maybeSingle();
  if (!link) throwSafeError("isps.evidence", new Error("link"), "That organisation doesn't share ISPS records with you.");
  await logEvent(db, link, { id: userId, name: await myName(db, userId), org: myOrg }, "viewed", { area });
}

// ───────────────────────────── Drill evidence ─────────────────────────────

export type DrillEvidence = {
  id: string;
  organisation_id: string;
  facility: string;
  kind: "drill" | "exercise";
  scenario: string;
  held_on: string;
  participants: number | null;
  findings: string | null;
  corrective_actions: string | null;
  lessons_learned: string | null;
  attendance: Attendee[];
  evidence: EvidenceFileView[];
  evidence_updated_at: string | null;
  recorded_by_name: string | null;
  can_edit: boolean;
};

export const getDrillEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ drill_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<DrillEvidence> => {
    const { orgId, db, role } = await ctx(context);
    const { data: d } = await db.from("isps_drills").select("*, isps_facilities(name)").eq("id", data.drill_id).maybeSingle();
    if (!d) throwSafeError("isps.evidence", new Error("missing"), "Drill not found.");
    await readableOrg(db, context.userId, orgId, d.organisation_id, "isps_drill_evidence");
    const files = (Array.isArray(d.evidence) ? d.evidence : []) as EvidenceFile[];
    const urls = await sign(db, files.map((f) => f.path));
    return {
      id: d.id, organisation_id: d.organisation_id, facility: (d as any).isps_facilities?.name ?? "—",
      kind: d.kind, scenario: d.scenario, held_on: d.held_on, participants: d.participants,
      findings: d.findings, corrective_actions: d.corrective_actions, lessons_learned: d.lessons_learned,
      attendance: (Array.isArray(d.attendance) ? d.attendance : []) as Attendee[],
      evidence: files.map((f) => ({ ...f, url: urls.get(f.path) ?? null })),
      evidence_updated_at: d.evidence_updated_at, recorded_by_name: d.recorded_by_name,
      can_edit: d.organisation_id === orgId && !!role && ["manager", "supervisor"].includes(role),
    };
  });

export const drillEvidenceUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ drill_id: z.string().uuid() }).merge(fileIn).parse(d))
  .handler(async ({ data, context }) => {
    const { orgId, db, role } = await ctx(context);
    canRecord(role);
    const { data: d } = await db.from("isps_drills").select("id").eq("id", data.drill_id).eq("organisation_id", orgId).maybeSingle();
    if (!d) throwSafeError("isps.evidence", new Error("missing"), "Drill not found.");
    return signedUploadUrl(db, drillPrefix(orgId, d.id), data.name);
  });

export const saveDrillEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      drill_id: z.string().uuid(),
      lessons_learned: opt(4000),
      attendance: z.array(z.object({ name: z.string().trim().min(1).max(160), role: opt(120) })).max(500),
      add_files: z.array(z.object({ path: z.string().min(1).max(400), name: z.string().min(1).max(200) })).max(MAX_FILES),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { orgId, db, role } = await ctx(context);
    canRecord(role);
    await (await import("./features.server")).assertFeature(orgId, "isps");
    const { data: d } = await db.from("isps_drills").select("id, evidence, participants").eq("id", data.drill_id).eq("organisation_id", orgId).maybeSingle();
    if (!d) throwSafeError("isps.evidence", new Error("missing"), "Drill not found.");
    const existing = (Array.isArray(d.evidence) ? d.evidence : []) as EvidenceFile[];
    if (existing.length + data.add_files.length > MAX_FILES) throwSafeError("isps.evidence", new Error("too many"), `Up to ${MAX_FILES} files per drill.`);
    const prefix = drillPrefix(orgId, d.id);
    const name = await myName(db, context.userId);
    const now = new Date().toISOString();
    const added: EvidenceFile[] = [];
    for (const f of data.add_files) {
      if (!f.path.startsWith(prefix) || f.path.includes("..")) throwSafeError("isps.evidence", new Error("path"), "A file doesn't belong to this drill.");
      if (existing.some((x) => x.path === f.path)) continue;
      const fp = await fingerprint(db, f.path);
      if (!fp) throwSafeError("isps.evidence", new Error("upload"), `"${f.name}" didn't finish uploading. Try attaching it again.`);
      added.push({ path: f.path, name: f.name.slice(0, 120), type: fp!.type, size: fp!.size, sha256: fp!.sha256, added_at: now, added_by_name: name });
    }
    // Attendance: drop blank and repeated names.
    const seen = new Set<string>();
    const attendance = data.attendance.filter((a) => {
      const k = a.name.toLowerCase().replace(/\s+/g, " ");
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const patch: Record<string, unknown> = { lessons_learned: data.lessons_learned, attendance, evidence: [...existing, ...added], evidence_updated_at: now };
    if (attendance.length && (d.participants == null || d.participants < attendance.length)) patch.participants = attendance.length;
    const { error } = await db.from("isps_drills").update(patch).eq("id", d.id);
    if (error) throwSafeError("isps.evidence", error, "Unable to save the evidence.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "isps_drill", resourceId: d.id, actionType: "evidence", actionDetail: { files_added: added.map((f) => ({ name: f.name, sha256: f.sha256 })), attendance: attendance.length, lessons: !!data.lessons_learned } });
    return { added: added.length };
  });

// ───────────────────────────── Training records ─────────────────────────────

export type TrainingRecord = {
  id: string;
  organisation_id: string;
  facility_id: string | null;
  facility: string | null;
  person_name: string;
  person_role: string;
  course: string;
  provider: string | null;
  certificate_no: string | null;
  completed_on: string;
  expires_on: string | null;
  notes: string | null;
  certificate: (EvidenceFileView) | null;
  recorded_by_name: string | null;
  updated_at: string;
  state: TrainingState;
  days_left: number | null;
};

async function trainingFor(db: any, orgId: string, withUrls: boolean): Promise<TrainingRecord[]> {
  const { data, error } = await db.from("isps_training").select("*, isps_facilities(name)").eq("organisation_id", orgId).is("archived_at", null).order("person_name").limit(2000);
  if (error) throwSafeError("isps.training", error, "Unable to load training records.");
  const rows = (data ?? []) as any[];
  const urls = withUrls ? await sign(db, rows.map((r) => r.certificate?.path).filter(Boolean)) : new Map<string, string>();
  const today = lagosToday();
  return rows.map((r) => ({
    id: r.id, organisation_id: r.organisation_id, facility_id: r.facility_id, facility: r.isps_facilities?.name ?? null,
    person_name: r.person_name, person_role: r.person_role, course: r.course, provider: r.provider, certificate_no: r.certificate_no,
    completed_on: r.completed_on, expires_on: r.expires_on, notes: r.notes,
    certificate: r.certificate ? { ...r.certificate, url: urls.get(r.certificate.path) ?? null } : null,
    recorded_by_name: r.recorded_by_name, updated_at: r.updated_at,
    ...trainingState(r.expires_on, today),
  }));
}

export const listTraining = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ org_id: z.string().uuid().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const { orgId, db, role } = await ctx(context);
    const target = data.org_id ?? orgId;
    if (target === orgId) await (await import("./features.server")).assertFeature(orgId, "isps");
    await readableOrg(db, context.userId, orgId, target, "isps_training");
    return { records: await trainingFor(db, target, true), can_edit: target === orgId && !!role && ["manager", "supervisor"].includes(role) };
  });

export const trainingUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => fileIn.parse(d))
  .handler(async ({ data, context }) => {
    const { orgId, db, role } = await ctx(context);
    canRecord(role);
    return signedUploadUrl(db, trainingPrefix(orgId), data.name);
  });

export const saveTraining = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid().nullable(),
      facility_id: z.string().uuid().nullable(),
      person_name: z.string().trim().min(2).max(160),
      person_role: z.string().trim().min(2).max(120),
      course: z.string().trim().min(2).max(200),
      provider: opt(200),
      certificate_no: opt(120),
      completed_on: day,
      expires_on: day.nullable(),
      notes: opt(2000),
      // undefined: keep the current certificate; null: remove it; object: a newly uploaded file
      certificate: z.object({ path: z.string().min(1).max(400), name: z.string().min(1).max(200) }).nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { orgId, db, role } = await ctx(context);
    canRecord(role);
    await (await import("./features.server")).assertFeature(orgId, "isps");
    if (data.completed_on > lagosToday()) throwSafeError("isps.training", new Error("future"), "The completion date can't be in the future.");
    if (data.expires_on && data.expires_on < data.completed_on) throwSafeError("isps.training", new Error("dates"), "The expiry date must be on or after the completion date.");
    if (data.facility_id) {
      const { data: f } = await db.from("isps_facilities").select("id").eq("id", data.facility_id).eq("organisation_id", orgId).maybeSingle();
      if (!f) throwSafeError("isps.training", new Error("facility"), "Facility not found.");
    }
    const name = await myName(db, context.userId);
    let certificate: EvidenceFile | null | undefined = undefined;
    if (data.certificate === null) certificate = null;
    else if (data.certificate) {
      if (!data.certificate.path.startsWith(trainingPrefix(orgId)) || data.certificate.path.includes("..")) throwSafeError("isps.training", new Error("path"), "That file doesn't belong to your organisation.");
      const fp = await fingerprint(db, data.certificate.path);
      if (!fp) throwSafeError("isps.training", new Error("upload"), "The certificate didn't finish uploading. Try attaching it again.");
      certificate = { path: data.certificate.path, name: data.certificate.name.slice(0, 120), type: fp!.type, size: fp!.size, sha256: fp!.sha256, added_at: new Date().toISOString(), added_by_name: name };
    }
    const { certificate: _c, id, ...fields } = data;
    const row: Record<string, unknown> = { ...fields, updated_at: new Date().toISOString() };
    if (certificate !== undefined) row.certificate = certificate;
    let saved: string;
    if (id) {
      const { data: r, error } = await db.from("isps_training").update(row).eq("id", id).eq("organisation_id", orgId).is("archived_at", null).select("id").maybeSingle();
      if (error) throwSafeError("isps.training", error, "Unable to save the training record.");
      if (!r) throwSafeError("isps.training", new Error("missing"), "Training record not found.");
      saved = r.id;
    } else {
      const { data: r, error } = await db.from("isps_training").insert({ ...row, organisation_id: orgId, recorded_by: context.userId, recorded_by_name: name }).select("id").single();
      if (error) throwSafeError("isps.training", error, "Unable to save the training record.");
      saved = r.id;
    }
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "isps_training", resourceId: saved, actionType: id ? "update" : "create", actionDetail: { person: data.person_name, course: data.course, expires_on: data.expires_on, certificate: certificate ? certificate.sha256 : certificate } });
    return { id: saved };
  });

export const archiveTraining = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { orgId, db, role } = await ctx(context);
    canRecord(role);
    const { data: r, error } = await db.from("isps_training").update({ archived_at: new Date().toISOString(), archived_by_name: await myName(db, context.userId) }).eq("id", data.id).eq("organisation_id", orgId).is("archived_at", null).select("id, person_name, course").maybeSingle();
    if (error) throwSafeError("isps.training", error, "Unable to remove the training record.");
    if (!r) throwSafeError("isps.training", new Error("missing"), "Training record not found.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "isps_training", resourceId: r.id, actionType: "archive", actionDetail: { person: r.person_name, course: r.course } });
    return { ok: true };
  });
