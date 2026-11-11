import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getActiveOrgId, getSiteUrl } from "@/lib/orgs.server";
import { throwSafeError } from "@/lib/server-errors";
import { recordBlackboxAudit } from "@/lib/audit.server";
import { admin, logEvent, myName, roleIn } from "@/lib/links.server";
import { complianceFlags, type ComplianceFlag } from "@/lib/isps.rules";

const sb = (c: { supabase: unknown }) => c.supabase as any;
const FAC_KIND = z.enum(["port_facility", "terminal", "jetty", "offshore", "ship"]);
const BREACH = z.enum(["unauthorised_access", "stowaway", "theft", "tampering", "suspicious_activity", "armed_attack", "smuggling", "cyber", "other"]);
const LEVEL = z.number().int().min(1).max(3);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const opt = (n: number) => z.string().trim().max(n).nullable().transform((v) => (v ? v : null));

async function ctxRole(context: { supabase: unknown; userId: string }) {
  const orgId = await getActiveOrgId(context.supabase as any, context.userId);
  const role = await roleIn(sb(context), context.userId, orgId);
  return { orgId, role };
}
function need(role: string | null, roles: string[], msg: string) {
  if (!role || !roles.includes(role)) throwSafeError("isps.role", new Error("role"), msg);
}
async function sha(text: string) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(text, "utf8").digest("hex");
}
const stamp = (prefix: string) => `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

// ───────────────────────────── Facility side ─────────────────────────────

export type Facility = {
  id: string;
  name: string;
  kind: string;
  identifier: string | null;
  security_level: number;
  level_set_at: string;
  level_set_by_name: string | null;
  level_reason: string | null;
  security_officer_name: string | null;
  security_officer_phone: string | null;
  plan_approved_on: string | null;
  plan_expires_on: string | null;
  notes: string | null;
  created_at: string;
  last_drill_on: string | null;
  last_exercise_on: string | null;
  open_breaches: number;
  unreported_breaches: number;
  flags: ComplianceFlag[];
};
const FAC_COLS = "id, organisation_id, name, kind, identifier, security_level, level_set_at, level_set_by_name, level_reason, security_officer_name, security_officer_phone, plan_approved_on, plan_expires_on, notes, created_at";

/** Facilities with their compliance state, for any set of organisations (caller has already checked access). */
async function facilitiesFor(db: any, orgIds: string[]): Promise<(Facility & { organisation_id: string })[]> {
  if (!orgIds.length) return [];
  const [{ data: fac }, { data: drills }, { data: br }] = await Promise.all([
    db.from("isps_facilities").select(FAC_COLS).in("organisation_id", orgIds).order("name"),
    db.from("isps_drills").select("facility_id, kind, held_on").in("organisation_id", orgIds).order("held_on", { ascending: false }).limit(2000),
    db.from("isps_breaches").select("facility_id, status, reported_to_authority").in("organisation_id", orgIds).limit(5000),
  ]);
  return (fac ?? []).map((f: any) => {
    const d = (drills ?? []).filter((x: any) => x.facility_id === f.id);
    const b = (br ?? []).filter((x: any) => x.facility_id === f.id);
    const row = {
      ...f,
      last_drill_on: d.find((x: any) => x.kind === "drill")?.held_on ?? null,
      last_exercise_on: d.find((x: any) => x.kind === "exercise")?.held_on ?? null,
      open_breaches: b.filter((x: any) => x.status === "open").length,
      unreported_breaches: b.filter((x: any) => !x.reported_to_authority).length,
    };
    return { ...row, flags: complianceFlags(row) };
  });
}

export const getIspsOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { orgId, role } = await ctxRole(context);
    await (await import("./features.server")).assertFeature(orgId, "isps");
    const supabase = sb(context);
    const [facilities, drills, dos, breaches, levels, org] = await Promise.all([
      facilitiesFor(supabase, [orgId]),
      supabase.from("isps_drills").select("id, facility_id, kind, scenario, held_on, participants, findings, corrective_actions, recorded_by_name, created_at").eq("organisation_id", orgId).order("held_on", { ascending: false }).limit(100),
      supabase.from("isps_declarations").select("id, facility_id, reference, ship_name, ship_imo, security_level, valid_from, valid_to, status, port_signatory_name, ship_signatory_name, ship_signed_at, created_at").eq("organisation_id", orgId).order("created_at", { ascending: false }).limit(100),
      supabase.from("isps_breaches").select("id, facility_id, occurred_at, category, description, action_taken, security_level, reported_to_authority, reported_at, reported_to, status, closed_at, recorded_by_name, created_at").eq("organisation_id", orgId).order("occurred_at", { ascending: false }).limit(200),
      supabase.from("isps_level_changes").select("id, facility_id, from_level, to_level, reason, changed_by_name, notice_id, created_at").eq("organisation_id", orgId).order("created_at", { ascending: false }).limit(50),
      supabase.from("organisations").select("name, type").eq("id", orgId).maybeSingle(),
    ]);
    return {
      org: { id: orgId, name: org.data?.name ?? "", type: org.data?.type ?? "" },
      role,
      can_manage: role === "manager",
      can_record: role === "manager" || role === "supervisor",
      facilities: facilities as Facility[],
      drills: (drills.data ?? []) as { id: string; facility_id: string; kind: "drill" | "exercise"; scenario: string; held_on: string; participants: number | null; findings: string | null; corrective_actions: string | null; recorded_by_name: string | null; created_at: string }[],
      declarations: (dos.data ?? []) as { id: string; facility_id: string; reference: string; ship_name: string; ship_imo: string | null; security_level: number; valid_from: string; valid_to: string; status: "awaiting_ship" | "signed" | "cancelled"; port_signatory_name: string; ship_signatory_name: string | null; ship_signed_at: string | null; created_at: string }[],
      breaches: (breaches.data ?? []) as { id: string; facility_id: string; occurred_at: string; category: string; description: string; action_taken: string | null; security_level: number | null; reported_to_authority: boolean; reported_at: string | null; reported_to: string | null; status: "open" | "closed"; closed_at: string | null; recorded_by_name: string | null; created_at: string }[],
      level_changes: (levels.data ?? []) as { id: string; facility_id: string; from_level: number; to_level: number; reason: string; changed_by_name: string | null; notice_id: string | null; created_at: string }[],
    };
  });

export const saveFacility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid().nullable(),
      name: z.string().trim().min(1).max(160),
      kind: FAC_KIND,
      identifier: opt(60),
      security_officer_name: opt(120),
      security_officer_phone: opt(40),
      plan_approved_on: day.nullable(),
      plan_expires_on: day.nullable(),
      notes: opt(2000),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { orgId, role } = await ctxRole(context);
    await (await import("./features.server")).assertFeature(orgId, "isps");
    need(role, ["manager"], "Only security managers can add or edit facilities.");
    const { id, ...row } = data;
    const supabase = sb(context);
    const q = id
      ? supabase.from("isps_facilities").update({ ...row, updated_at: new Date().toISOString() }).eq("id", id).eq("organisation_id", orgId).select("id").single()
      : supabase.from("isps_facilities").insert({ ...row, organisation_id: orgId, created_by: context.userId, level_set_by_name: await myName(supabase, context.userId), level_reason: "Facility added" }).select("id").single();
    const { data: r, error } = await q;
    if (error) throwSafeError("isps.facility", error, "Unable to save the facility.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "isps_facility", resourceId: r.id, actionType: id ? "update" : "create", actionDetail: { name: data.name } });
    return { id: r.id as string };
  });

export const setSecurityLevel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ facility_ids: z.array(z.string().uuid()).min(1).max(100), level: LEVEL, reason: z.string().trim().min(3, "Give a reason.").max(500), notice_id: z.string().uuid().nullable().default(null) }).parse(d))
  .handler(async ({ data, context }) => {
    const { orgId, role } = await ctxRole(context);
    await (await import("./features.server")).assertFeature(orgId, "isps");
    need(role, ["manager"], "Only security managers can change the security level.");
    const db = await admin();
    const { data: facs } = await db.from("isps_facilities").select("id, name, security_level").eq("organisation_id", orgId).in("id", data.facility_ids);
    if (!facs?.length) throwSafeError("isps.level", new Error("none"), "Facility not found.");
    const name = await myName(db, context.userId);
    const at = new Date().toISOString();
    const changed = facs.filter((f: any) => f.security_level !== data.level);
    for (const f of changed) {
      await db.from("isps_facilities").update({ security_level: data.level, level_set_at: at, level_set_by_name: name, level_reason: data.reason, updated_at: at }).eq("id", f.id);
      await db.from("isps_level_changes").insert({ organisation_id: orgId, facility_id: f.id, from_level: f.security_level, to_level: data.level, reason: data.reason, notice_id: data.notice_id, changed_by: context.userId, changed_by_name: name });
      await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "isps_facility", resourceId: f.id, actionType: "security_level", actionDetail: { from: f.security_level, to: data.level, reason: data.reason } });
    }
    if (changed.length && data.level >= 2) {
      await db.from("alerts").insert({
        organisation_id: orgId, severity: data.level === 3 ? 5 : 4, channel: "in-app", channels: ["in-app"], alert_type: "isps_level", status: "delivered",
        title: `Security level ${data.level} set at ${changed.map((f: any) => f.name).join(", ")}`.slice(0, 200),
        body: `${name}: ${data.reason}`, action: "Open ISPS Watch", recipients: 1, delivered_count: 1, failed_count: 0, recipient_user_ids: [], acknowledged: false,
      });
    }
    return { changed: changed.length };
  });

export const recordDrill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      facility_id: z.string().uuid(),
      kind: z.enum(["drill", "exercise"]),
      scenario: z.string().trim().min(3).max(300),
      held_on: day,
      participants: z.number().int().min(0).max(10000).nullable(),
      findings: opt(4000),
      corrective_actions: opt(4000),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { orgId, role } = await ctxRole(context);
    await (await import("./features.server")).assertFeature(orgId, "isps");
    need(role, ["manager", "supervisor"], "Only managers and operators can record drills.");
    if (Date.parse(data.held_on) > Date.now() + 86_400_000) throwSafeError("isps.drill", new Error("future"), "A drill can't be recorded before it happens.");
    const supabase = sb(context);
    const { data: r, error } = await supabase.from("isps_drills").insert({ ...data, organisation_id: orgId, recorded_by: context.userId, recorded_by_name: await myName(supabase, context.userId) }).select("id").single();
    if (error) throwSafeError("isps.drill", error, "Unable to record the drill.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "isps_drill", resourceId: r.id, actionType: "create", actionDetail: { kind: data.kind, held_on: data.held_on } });
    return { id: r.id as string };
  });

export const recordBreach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      facility_id: z.string().uuid(),
      occurred_at: z.string().datetime({ offset: true }),
      category: BREACH,
      description: z.string().trim().min(3).max(4000),
      action_taken: opt(4000),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { orgId, role } = await ctxRole(context);
    need(role, ["manager", "supervisor"], "Only managers and operators can record a breach.");
    if (Date.parse(data.occurred_at) > Date.now() + 60_000) throwSafeError("isps.breach", new Error("future"), "The time can't be in the future.");
    const supabase = sb(context);
    const { data: f } = await supabase.from("isps_facilities").select("security_level").eq("id", data.facility_id).eq("organisation_id", orgId).maybeSingle();
    if (!f) throwSafeError("isps.breach", new Error("facility"), "Facility not found.");
    const { data: r, error } = await supabase.from("isps_breaches").insert({ ...data, organisation_id: orgId, security_level: f.security_level, recorded_by: context.userId, recorded_by_name: await myName(supabase, context.userId) }).select("id").single();
    if (error) throwSafeError("isps.breach", error, "Unable to record the breach.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "isps_breach", resourceId: r.id, actionType: "create", actionDetail: { category: data.category } });
    return { id: r.id as string };
  });

export const updateBreach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), reported_to: z.string().trim().min(2).max(200).optional(), close: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { orgId, role } = await ctxRole(context);
    need(role, ["manager", "supervisor"], "Only managers and operators can update a breach.");
    const patch: Record<string, unknown> = {};
    if (data.reported_to) Object.assign(patch, { reported_to_authority: true, reported_at: new Date().toISOString(), reported_to: data.reported_to });
    if (data.close) Object.assign(patch, { status: "closed", closed_at: new Date().toISOString() });
    if (!Object.keys(patch).length) return { ok: true };
    const { error } = await sb(context).from("isps_breaches").update(patch).eq("id", data.id).eq("organisation_id", orgId);
    if (error) throwSafeError("isps.breach.update", error, "Unable to update the breach.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "isps_breach", resourceId: data.id, actionType: data.close ? "close" : "reported", actionDetail: { reported_to: data.reported_to ?? null } });
    return { ok: true };
  });

// ───────────────────────── Declarations of Security ─────────────────────────

function dosText(d: any, facility: any, orgName: string) {
  return JSON.stringify({
    reference: d.reference,
    port_facility: { organisation: orgName, name: facility.name, identifier: facility.identifier ?? null },
    ship: { name: d.ship_name, imo: d.ship_imo ?? null, flag: d.ship_flag ?? null },
    security_level: d.security_level,
    activities: d.activities,
    measures: d.measures,
    valid_from: new Date(d.valid_from).toISOString(),
    valid_to: new Date(d.valid_to).toISOString(),
    port_signatory: { name: d.port_signatory_name, title: d.port_signatory_title, signed_at: new Date(d.port_signed_at).toISOString() },
  });
}

export const createDeclaration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      facility_id: z.string().uuid(),
      ship_name: z.string().trim().min(1).max(160),
      ship_imo: opt(20),
      ship_flag: opt(60),
      security_level: LEVEL,
      activities: z.string().trim().min(3).max(1000),
      measures: z.string().trim().min(3).max(4000),
      valid_from: z.string().datetime({ offset: true }),
      valid_to: z.string().datetime({ offset: true }),
      port_signatory_title: z.string().trim().min(2).max(120),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { orgId, role } = await ctxRole(context);
    await (await import("./features.server")).assertFeature(orgId, "isps");
    need(role, ["manager", "supervisor"], "Only managers and operators can issue a Declaration of Security.");
    if (Date.parse(data.valid_to) <= Date.parse(data.valid_from)) throwSafeError("isps.dos", new Error("dates"), "The end must be after the start.");
    const db = await admin();
    const [{ data: f }, { data: org }] = await Promise.all([
      db.from("isps_facilities").select("id, name, identifier, security_level").eq("id", data.facility_id).eq("organisation_id", orgId).maybeSingle(),
      db.from("organisations").select("name").eq("id", orgId).maybeSingle(),
    ]);
    if (!f) throwSafeError("isps.dos", new Error("facility"), "Facility not found.");
    const { randomBytes } = await import("node:crypto");
    const row = {
      ...data,
      organisation_id: orgId,
      reference: stamp("DOS"),
      port_signatory_name: await myName(db, context.userId),
      port_signed_by: context.userId,
      port_signed_at: new Date().toISOString(),
      sign_token: randomBytes(12).toString("base64url"),
    };
    const content_sha256 = await sha(dosText(row, f, org?.name ?? ""));
    const { data: r, error } = await db.from("isps_declarations").insert({ ...row, content_sha256 }).select("id, sign_token").single();
    if (error) throwSafeError("isps.dos", error, "Unable to create the declaration.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "isps_declaration", resourceId: r.id, actionType: "create", actionDetail: { reference: row.reference, ship: data.ship_name, sha256: content_sha256 } });
    return { id: r.id as string, sign_url: `${getSiteUrl()}/dos/${r.sign_token}` };
  });

export const cancelDeclaration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(300) }).parse(d))
  .handler(async ({ data, context }) => {
    const { orgId, role } = await ctxRole(context);
    need(role, ["manager"], "Only security managers can cancel a declaration.");
    const db = await admin();
    const { error } = await db.from("isps_declarations").update({ status: "cancelled", cancelled_reason: data.reason, sign_token: null }).eq("id", data.id).eq("organisation_id", orgId).eq("status", "awaiting_ship");
    if (error) throwSafeError("isps.dos.cancel", error, "Unable to cancel.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "isps_declaration", resourceId: data.id, actionType: "cancel", actionDetail: { reason: data.reason } });
    return { ok: true };
  });

export type Declaration = {
  id: string;
  reference: string;
  organisation: string;
  facility: { name: string; identifier: string | null; kind: string };
  ship_name: string;
  ship_imo: string | null;
  ship_flag: string | null;
  security_level: number;
  activities: string;
  measures: string;
  valid_from: string;
  valid_to: string;
  port_signatory_name: string;
  port_signatory_title: string;
  port_signed_at: string;
  ship_signatory_name: string | null;
  ship_signatory_title: string | null;
  ship_signed_at: string | null;
  status: "awaiting_ship" | "signed" | "cancelled";
  cancelled_reason: string | null;
  content_sha256: string;
  sign_url: string | null;
};
async function loadDeclaration(db: any, match: { id?: string; token?: string }, orgId?: string): Promise<Declaration | null> {
  let q = db.from("isps_declarations").select("*");
  q = match.id ? q.eq("id", match.id) : q.eq("sign_token", match.token);
  if (orgId) q = q.eq("organisation_id", orgId);
  const { data: d } = await q.maybeSingle();
  if (!d) return null;
  const [{ data: f }, { data: org }] = await Promise.all([
    db.from("isps_facilities").select("name, identifier, kind").eq("id", d.facility_id).maybeSingle(),
    db.from("organisations").select("name").eq("id", d.organisation_id).maybeSingle(),
  ]);
  return {
    id: d.id, reference: d.reference, organisation: org?.name ?? "", facility: { name: f?.name ?? "", identifier: f?.identifier ?? null, kind: f?.kind ?? "port_facility" },
    ship_name: d.ship_name, ship_imo: d.ship_imo, ship_flag: d.ship_flag, security_level: d.security_level, activities: d.activities, measures: d.measures,
    valid_from: d.valid_from, valid_to: d.valid_to, port_signatory_name: d.port_signatory_name, port_signatory_title: d.port_signatory_title, port_signed_at: d.port_signed_at,
    ship_signatory_name: d.ship_signatory_name, ship_signatory_title: d.ship_signatory_title, ship_signed_at: d.ship_signed_at, status: d.status, cancelled_reason: d.cancelled_reason,
    content_sha256: d.content_sha256, sign_url: d.sign_token && d.status === "awaiting_ship" ? `${getSiteUrl()}/dos/${d.sign_token}` : null,
  };
}

export const getDeclaration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const d = await loadDeclaration(await admin(), { id: data.id }, orgId);
    if (!d) throwSafeError("isps.dos.get", new Error("missing"), "Declaration not found.");
    return d as Declaration;
  });

/** Public: the ship's master or security officer opens the link to read and sign. */
export const getDeclarationForShip = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: z.string().min(10).max(40) }).parse(d))
  .handler(async ({ data }) => {
    const d = await loadDeclaration(await admin(), { token: data.token });
    if (!d || d.status === "cancelled") return { found: false as const };
    const { sign_url: _s, ...rest } = d;
    return { found: true as const, declaration: rest };
  });

export const signDeclarationAsShip = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      token: z.string().min(10).max(40),
      name: z.string().trim().min(2).max(120),
      title: z.enum(["Master", "Ship Security Officer", "Chief Officer (for the Master)"]),
      content_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const { data: d } = await db.from("isps_declarations").select("*").eq("sign_token", data.token).maybeSingle();
    if (!d || d.status === "cancelled") throw new Error("This link isn't valid any more. Ask the port facility for a new one.");
    if (d.status === "signed") throw new Error("This declaration has already been signed for the ship.");
    if (Date.parse(d.valid_to) <= Date.now()) throw new Error("This declaration's period has ended. Ask the port facility for a new one.");
    const [{ data: f }, { data: org }] = await Promise.all([
      db.from("isps_facilities").select("name, identifier").eq("id", d.facility_id).maybeSingle(),
      db.from("organisations").select("name").eq("id", d.organisation_id).maybeSingle(),
    ]);
    const now = await sha(dosText(d, f ?? {}, org?.name ?? ""));
    if (now !== d.content_sha256 || data.content_sha256 !== d.content_sha256) throw new Error("The declaration changed after you opened it. Reload the page and read it again.");
    const at = new Date().toISOString();
    const { error } = await db.from("isps_declarations").update({ ship_signatory_name: data.name, ship_signatory_title: data.title, ship_signed_at: at, status: "signed" }).eq("id", d.id).eq("status", "awaiting_ship");
    if (error) throw new Error("Couldn't record the signature. Try again.");
    await recordBlackboxAudit({ userId: d.port_signed_by, orgId: d.organisation_id, resourceType: "isps_declaration", resourceId: d.id, actionType: "ship_signed", actionDetail: { name: data.name, title: data.title, sha256: d.content_sha256 } });
    return { signed_at: at };
  });

// ───────────────────────────── Authority notices ─────────────────────────────

export type ReceivedNotice = {
  id: string;
  reference: string;
  from_org: string;
  kind: "directive" | "advisory" | "security_level";
  title: string;
  body: string;
  required_level: number | null;
  respond_by: string | null;
  issued_by_name: string | null;
  issued_at: string;
  body_sha256: string;
  first_read_at: string | null;
  acknowledged_at: string | null;
  acknowledged_by_name: string | null;
  response: string | null;
};

export const listReceivedNotices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const supabase = sb(context);
    const { data: rec } = await supabase.from("authority_notice_recipients").select("notice_id, from_org_id, first_read_at, acknowledged_at, acknowledged_by_name, response").eq("org_id", orgId).order("delivered_at", { ascending: false }).limit(100);
    if (!rec?.length) return [] as ReceivedNotice[];
    const db = await admin();
    const [{ data: notices }, { data: orgs }] = await Promise.all([
      db.from("authority_notices").select("id, reference, from_org_id, kind, title, body, required_level, respond_by, issued_by_name, issued_at, body_sha256").in("id", rec.map((r: any) => r.notice_id)),
      db.from("organisations").select("id, name").in("id", [...new Set(rec.map((r: any) => r.from_org_id))]),
    ]);
    const on = new Map((orgs ?? []).map((o: any) => [o.id, o.name]));
    return rec
      .map((r: any) => {
        const n = (notices ?? []).find((x: any) => x.id === r.notice_id);
        if (!n) return null;
        return { ...n, from_org: on.get(n.from_org_id) ?? "", first_read_at: r.first_read_at, acknowledged_at: r.acknowledged_at, acknowledged_by_name: r.acknowledged_by_name, response: r.response };
      })
      .filter(Boolean) as ReceivedNotice[];
  });

/** Records that someone in the receiving organisation opened the notice (the read receipt). */
export const markNoticeRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const db = await admin();
    if (!(await roleIn(db, context.userId, orgId))) throwSafeError("notice.read", new Error("member"), "Not a member.");
    const name = await myName(db, context.userId);
    const { data: r } = await db.from("authority_notice_recipients").update({ first_read_at: new Date().toISOString(), first_read_by_name: name }).eq("notice_id", data.id).eq("org_id", orgId).is("first_read_at", null).select("id");
    if (r?.length) await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "authority_notice", resourceId: data.id, actionType: "read", actionDetail: {} });
    return { ok: true };
  });

export const acknowledgeNotice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), response: opt(4000) }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const db = await admin();
    need(await roleIn(db, context.userId, orgId), ["manager", "supervisor", "client_admin"], "Only managers, operators and client admins can acknowledge notices.");
    const name = await myName(db, context.userId);
    const at = new Date().toISOString();
    const { data: r, error } = await db
      .from("authority_notice_recipients")
      .update({ acknowledged_at: at, acknowledged_by: context.userId, acknowledged_by_name: name, response: data.response, first_read_at: at, first_read_by_name: name })
      .eq("notice_id", data.id).eq("org_id", orgId).is("acknowledged_at", null).select("id");
    if (error || !r?.length) throwSafeError("notice.ack", error ?? new Error("none"), "Already acknowledged, or not found.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "authority_notice", resourceId: data.id, actionType: "acknowledge", actionDetail: { response: data.response } });
    return { ok: true };
  });

// ───────────────────────────── Authority side ─────────────────────────────

export type RegulatedOrg = { id: string; name: string; link_id: string; shares_isps: boolean; expires_at: string; facilities: (Facility & { organisation_id: string })[]; max_level: number; failing: number; declarations_90d: number };

/** Organisations that have an active share with us. Only those with the ISPS scope expose ISPS records. */
async function linkedOrgs(db: any, orgId: string) {
  const { data } = await db.from("org_links").select("id, owner_org_id, partner_org_id, scopes, expires_at").eq("partner_org_id", orgId).eq("status", "active").gt("expires_at", new Date().toISOString());
  return (data ?? []) as { id: string; owner_org_id: string; partner_org_id: string; scopes: string[]; expires_at: string }[];
}

export const getRegulatedOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { orgId, role } = await ctxRole(context);
    need(role, ["manager", "supervisor", "client_admin"], "Your role can't view regulated organisations.");
    const db = await admin();
    const links = await linkedOrgs(db, orgId);
    const ownerIds = [...new Set(links.map((l) => l.owner_org_id))];
    const ispsIds = [...new Set(links.filter((l) => l.scopes.includes("isps")).map((l) => l.owner_org_id))];
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const [{ data: orgs }, facilities, { data: breaches }, { data: dos }] = await Promise.all([
      ownerIds.length ? db.from("organisations").select("id, name, type").in("id", ownerIds) : Promise.resolve({ data: [] }),
      facilitiesFor(db, ispsIds),
      ispsIds.length ? db.from("isps_breaches").select("id, organisation_id, facility_id, occurred_at, category, description, status, reported_to_authority, reported_at, security_level").in("organisation_id", ispsIds).gte("occurred_at", since).order("occurred_at", { ascending: false }).limit(300) : Promise.resolve({ data: [] }),
      ispsIds.length ? db.from("isps_declarations").select("organisation_id, status, created_at").in("organisation_id", ispsIds).gte("created_at", since) : Promise.resolve({ data: [] }),
    ]);
    // A look at regulated records is logged on each link, at most every 30 minutes per person.
    const name = await myName(db, context.userId);
    for (const l of links.filter((x) => x.scopes.includes("isps"))) {
      const { data: recent } = await db.from("org_link_events").select("id").eq("link_id", l.id).eq("actor_id", context.userId).eq("action", "viewed").gte("created_at", new Date(Date.now() - 30 * 60_000).toISOString()).limit(1);
      if (!recent?.length) await logEvent(db, l, { id: context.userId, name, org: orgId }, "viewed", { area: "isps" });
    }
    const facName = new Map(facilities.map((f) => [f.id, f.name]));
    return {
      can_send: role === "manager" || role === "client_admin",
      organisations: ((orgs ?? []) as any[]).map((o: any): RegulatedOrg => {
        const isps = ispsIds.includes(o.id);
        const fac = facilities.filter((f) => f.organisation_id === o.id);
        return {
          id: o.id,
          name: o.name,
          link_id: links.find((l) => l.owner_org_id === o.id)!.id,
          shares_isps: isps,
          expires_at: links.find((l) => l.owner_org_id === o.id)!.expires_at,
          facilities: fac,
          max_level: fac.reduce((m, f) => Math.max(m, f.security_level), 0),
          failing: fac.reduce((n, f) => n + f.flags.filter((x) => x.tone === "fail").length, 0),
          declarations_90d: (dos ?? []).filter((d: any) => d.organisation_id === o.id && d.status === "signed").length,
        };
      }),
      breaches: (breaches ?? []).map((b: any) => ({ ...b, organisation: (orgs ?? []).find((o: any) => o.id === b.organisation_id)?.name ?? "", facility: facName.get(b.facility_id) ?? "" })) as {
        id: string; organisation_id: string; organisation: string; facility: string; occurred_at: string; category: string; description: string; status: string; reported_to_authority: boolean; reported_at: string | null; security_level: number | null;
      }[],
    };
  });

export const sendNotice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      kind: z.enum(["directive", "advisory", "security_level"]),
      title: z.string().trim().min(3).max(200),
      body: z.string().trim().min(3).max(8000),
      required_level: LEVEL.nullable(),
      respond_by: z.string().datetime({ offset: true }).nullable(),
      org_ids: z.array(z.string().uuid()).min(1).max(500),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { orgId, role } = await ctxRole(context);
    await (await import("./features.server")).assertFeature(orgId, "isps");
    need(role, ["manager", "client_admin"], "Only security managers and client admins can issue notices.");
    const db = await admin();
    const { data: me } = await db.from("organisations").select("name, type").eq("id", orgId).maybeSingle();
    if (me?.type !== "authority") throwSafeError("notice.send", new Error("type"), "Only organisations registered as an authority can issue formal notices.");
    const allowed = new Set((await linkedOrgs(db, orgId)).map((l) => l.owner_org_id));
    const targets = [...new Set(data.org_ids)].filter((id) => allowed.has(id));
    if (!targets.length) throwSafeError("notice.send", new Error("none"), "You can only send notices to organisations that share access with you.");
    if (data.kind === "security_level" && !data.required_level) throwSafeError("notice.send", new Error("level"), "Choose the security level to set.");
    const name = await myName(db, context.userId);
    const reference = stamp("NTC");
    const body_sha256 = await sha(`${reference}\n${data.title}\n${data.body}\n${data.required_level ?? ""}`);
    const { data: n, error } = await db
      .from("authority_notices")
      .insert({ from_org_id: orgId, reference, kind: data.kind, title: data.title, body: data.body, required_level: data.kind === "security_level" ? data.required_level : null, respond_by: data.respond_by, issued_by: context.userId, issued_by_name: name, body_sha256 })
      .select("id")
      .single();
    if (error) throwSafeError("notice.send", error, "Unable to issue the notice.");
    await db.from("authority_notice_recipients").insert(targets.map((t) => ({ notice_id: n.id, from_org_id: orgId, org_id: t })));
    // In-app notification for each recipient organisation (no SMS or email is sent).
    await db.from("alerts").insert(
      targets.map((t) => ({
        organisation_id: t, severity: data.kind === "security_level" ? 5 : data.kind === "directive" ? 4 : 3, channel: "in-app", channels: ["in-app"], alert_type: "authority_notice", status: "delivered",
        title: `${me?.name ?? "Authority"}: ${data.title}`.slice(0, 200), body: data.kind === "security_level" ? `Set security level ${data.required_level}. Open ISPS Watch to read and acknowledge.` : "Open ISPS Watch to read and acknowledge.",
        action: "Open ISPS Watch", recipients: 1, delivered_count: 1, failed_count: 0, recipient_user_ids: [], acknowledged: false,
      })),
    );
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "authority_notice", resourceId: n.id, actionType: "issue", actionDetail: { reference, kind: data.kind, recipients: targets.length, sha256: body_sha256 } });
    for (const t of targets) await recordBlackboxAudit({ userId: context.userId, orgId: t, resourceType: "authority_notice", resourceId: n.id, actionType: "received", actionDetail: { reference, from: me?.name ?? "" } });
    return { id: n.id as string, reference, recipients: targets.length };
  });

export const listSentNotices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const supabase = sb(context);
    const { data: notices } = await supabase.from("authority_notices").select("id, reference, kind, title, body, required_level, respond_by, issued_by_name, issued_at, body_sha256").eq("from_org_id", orgId).order("issued_at", { ascending: false }).limit(100);
    if (!notices?.length) return [];
    const { data: rec } = await supabase.from("authority_notice_recipients").select("notice_id, org_id, delivered_at, first_read_at, first_read_by_name, acknowledged_at, acknowledged_by_name, response").in("notice_id", notices.map((n: any) => n.id));
    const db = await admin();
    const { data: orgs } = await db.from("organisations").select("id, name").in("id", [...new Set((rec ?? []).map((r: any) => r.org_id))]);
    const on = new Map((orgs ?? []).map((o: any) => [o.id, o.name]));
    return notices.map((n: any) => ({
      ...n,
      recipients: (rec ?? []).filter((r: any) => r.notice_id === n.id).map((r: any) => ({ org: on.get(r.org_id) ?? "", delivered_at: r.delivered_at as string, first_read_at: r.first_read_at as string | null, first_read_by_name: r.first_read_by_name as string | null, acknowledged_at: r.acknowledged_at as string | null, acknowledged_by_name: r.acknowledged_by_name as string | null, response: r.response as string | null })),
    })) as {
      id: string; reference: string; kind: string; title: string; body: string; required_level: number | null; respond_by: string | null; issued_by_name: string | null; issued_at: string; body_sha256: string;
      recipients: { org: string; delivered_at: string; first_read_at: string | null; first_read_by_name: string | null; acknowledged_at: string | null; acknowledged_by_name: string | null; response: string | null }[];
    }[];
  });
