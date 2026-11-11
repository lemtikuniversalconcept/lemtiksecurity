import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getActiveOrgId, getSiteUrl } from "@/lib/orgs.server";
import { throwSafeError } from "@/lib/server-errors";
import { recordBlackboxAudit } from "@/lib/audit.server";

const sb = (c: { supabase: unknown }) => c.supabase as any;
async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}
async function roleIn(db: any, userId: string, orgId: string): Promise<string | null> {
  const { data } = await db.from("organisation_members").select("role").eq("user_id", userId).eq("organisation_id", orgId).maybeSingle();
  return (data?.role as string | undefined) ?? null;
}
async function nameOf(db: any, userId: string) {
  const { data } = await db.from("profiles").select("display_name").eq("user_id", userId).maybeSingle();
  return (data?.display_name as string | undefined)?.trim() || "Staff";
}
const CREATE_ROLES = ["manager", "supervisor"];
const RECORD_ROLES = ["manager", "supervisor", "officer"];

export const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "video/mp4", "video/quicktime", "video/webm", "video/3gpp"] as const;
export const MAX_BYTES = 50 * 1024 * 1024;
const KIND = z.enum(["loaded", "sealed", "departed", "checkpoint", "handover", "inspection", "delivered", "exception"]);
const DRIVER_KIND = z.enum(["loaded", "departed", "checkpoint", "handover", "inspection", "delivered", "exception"]);
const opt = (n: number) => z.string().trim().max(n).nullable().transform((v) => (v ? v : null));
const fileIn = z.object({ name: z.string().min(1).max(200), type: z.enum(MEDIA_TYPES), size: z.number().int().min(1).max(MAX_BYTES, "Each file can be up to 50 MB. Keep video clips short (under a minute).") });
const eventIn = {
  kind: KIND,
  checkpoint_index: z.number().int().min(0).max(49).nullable(),
  device_at: z.string().datetime({ offset: true }).nullable(),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  accuracy_m: z.number().min(0).max(100000).nullable(),
  seals_observed: z.array(z.string().trim().min(1).max(40)).max(20),
  from_party: opt(160),
  to_party: opt(160),
  note: opt(2000),
  media: z.array(z.object({ path: z.string().min(10).max(400), name: z.string().min(1).max(200) })).max(4),
};

export type Consignment = {
  id: string;
  reference: string;
  description: string;
  quantity: string | null;
  container_numbers: string[];
  seal_numbers: string[];
  origin: string;
  destination: string;
  consignee: string | null;
  carrier: string | null;
  subject_id: string | null;
  checkpoints: { name: string; lat: number; lng: number; radius_m: number }[];
  max_gap_hours: number;
  status: "planned" | "in_transit" | "delivered" | "cancelled";
  has_exception: boolean;
  last_event_at: string | null;
  delivered_at: string | null;
  created_by_name: string | null;
  created_at: string;
};
const COLS = "id, reference, description, quantity, container_numbers, seal_numbers, origin, destination, consignee, carrier, subject_id, checkpoints, max_gap_hours, status, has_exception, last_event_at, delivered_at, created_by_name, created_at";

export const listConsignments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    await (await import("./features.server")).assertFeature(orgId, "cargo");
    const supabase = sb(context);
    const [{ data, error }, role] = await Promise.all([
      supabase.from("cargo_consignments").select(COLS).eq("organisation_id", orgId).order("created_at", { ascending: false }).limit(200),
      roleIn(supabase, context.userId, orgId),
    ]);
    if (error) throwSafeError("cargo.list", error, "Unable to load consignments. If this is new, the database update may not be applied yet.");
    return { consignments: (data ?? []) as Consignment[], can_create: !!role && CREATE_ROLES.includes(role) };
  });

export const createConsignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      reference: opt(60),
      description: z.string().trim().min(2).max(500),
      quantity: opt(120),
      container_numbers: z.array(z.string().trim().min(1).max(20)).max(50),
      seal_numbers: z.array(z.string().trim().min(1).max(40)).max(20),
      origin: z.string().trim().min(1).max(200),
      destination: z.string().trim().min(1).max(200),
      consignee: opt(200),
      carrier: opt(200),
      subject_id: z.string().uuid().nullable(),
      checkpoints: z.array(z.object({ name: z.string().trim().min(1).max(120), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), radius_m: z.number().int().min(50).max(20000) })).max(50),
      max_gap_hours: z.number().int().min(1).max(168),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    await (await import("./features.server")).assertFeature(orgId, "cargo");
    const db = await admin();
    const role = await roleIn(db, context.userId, orgId);
    if (!role || !CREATE_ROLES.includes(role)) throwSafeError("cargo.create", new Error("role"), "Only managers and operators can add consignments.");
    if (data.subject_id) {
      const { data: s } = await db.from("movement_subjects").select("id").eq("id", data.subject_id).eq("organisation_id", orgId).maybeSingle();
      if (!s) throwSafeError("cargo.create", new Error("subject"), "That vehicle or boat isn't in your organisation.");
    }
    const { normSeal } = await import("./cargo.server");
    const reference = data.reference ?? `CGO-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const { data: row, error } = await db
      .from("cargo_consignments")
      .insert({
        ...data,
        reference,
        seal_numbers: [...new Set(data.seal_numbers.map(normSeal))],
        container_numbers: data.container_numbers.map((c) => c.toUpperCase().replace(/\s+/g, "")),
        organisation_id: orgId,
        created_by: context.userId,
        created_by_name: await nameOf(db, context.userId),
      })
      .select("id")
      .single();
    if (error) throwSafeError("cargo.create", error, String(error.code) === "23505" ? "That reference is already used." : "Unable to add the consignment.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "cargo_consignment", resourceId: row.id, actionType: "create", actionDetail: { reference } });
    return { id: row.id as string };
  });

export const cancelConsignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const db = await admin();
    if ((await roleIn(db, context.userId, orgId)) !== "manager") throwSafeError("cargo.cancel", new Error("role"), "Only security managers can cancel a consignment.");
    const { error } = await db.from("cargo_consignments").update({ status: "cancelled", driver_token: null }).eq("id", data.id).eq("organisation_id", orgId).in("status", ["planned", "in_transit"]);
    if (error) throwSafeError("cargo.cancel", error, "Unable to cancel.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "cargo_consignment", resourceId: data.id, actionType: "cancel", actionDetail: {} });
    return { ok: true };
  });

export type CustodyEvent = {
  id: string;
  seq: number;
  kind: string;
  checkpoint_index: number | null;
  recorded_at: string;
  device_at: string | null;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  off_checkpoint_m: number | null;
  seals_observed: string[];
  seals_ok: boolean | null;
  seal_issue: string | null;
  from_party: string | null;
  to_party: string | null;
  note: string | null;
  media: { name: string; type: string; size: number; sha256: string | null; url: string | null }[];
  recorded_via: "app" | "driver_link";
  recorded_by_name: string;
  event_hash: string;
};

export const getConsignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const supabase = sb(context);
    const { data: c } = await supabase.from("cargo_consignments").select(`${COLS}, driver_token`).eq("id", data.id).eq("organisation_id", orgId).maybeSingle();
    if (!c) throwSafeError("cargo.get", new Error("missing"), "Consignment not found.");
    const [{ data: ev }, role, subj] = await Promise.all([
      supabase.from("cargo_custody_events").select("*").eq("consignment_id", c.id).order("seq", { ascending: true }).limit(2000),
      roleIn(supabase, context.userId, orgId),
      c.subject_id ? supabase.from("movement_subjects").select("name, kind, last_lat, last_lng, last_seen_at").eq("id", c.subject_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const { verifyChain, CUSTODY_BUCKET } = await import("./cargo.server");
    const chain = verifyChain(ev ?? []);
    const db = await admin();
    const paths = (ev ?? []).flatMap((e: any) => (e.media ?? []).map((m: any) => m.path));
    const urls = new Map<string, string>();
    if (paths.length) {
      const { data: signed } = await db.storage.from(CUSTODY_BUCKET).createSignedUrls(paths, 3600);
      for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
    }
    const { driver_token, ...rest } = c;
    return {
      consignment: rest as Consignment,
      subject: subj.data as { name: string; kind: string; last_lat: number | null; last_lng: number | null; last_seen_at: string | null } | null,
      events: (ev ?? []).map((e: any) => ({
        id: e.id, seq: e.seq, kind: e.kind, checkpoint_index: e.checkpoint_index, recorded_at: e.recorded_at, device_at: e.device_at, lat: e.lat, lng: e.lng, accuracy_m: e.accuracy_m,
        off_checkpoint_m: e.off_checkpoint_m, seals_observed: e.seals_observed ?? [], seals_ok: e.seals_ok, seal_issue: e.seal_issue, from_party: e.from_party, to_party: e.to_party, note: e.note,
        media: (e.media ?? []).map((m: any) => ({ name: m.name, type: m.type, size: m.size, sha256: m.sha256, url: urls.get(m.path) ?? null })),
        recorded_via: e.recorded_via, recorded_by_name: e.recorded_by_name, event_hash: e.event_hash,
      })) as CustodyEvent[],
      chain,
      driver_url: driver_token ? `${getSiteUrl()}/custody/${driver_token}` : null,
      can_record: !!role && RECORD_ROLES.includes(role),
      can_manage: !!role && CREATE_ROLES.includes(role),
      can_cancel: role === "manager",
    };
  });

export const setDriverLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), enable: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const db = await admin();
    const role = await roleIn(db, context.userId, orgId);
    if (!role || !CREATE_ROLES.includes(role)) throwSafeError("cargo.link", new Error("role"), "Only managers and operators can manage the driver link.");
    const { randomBytes } = await import("node:crypto");
    const token = data.enable ? randomBytes(12).toString("base64url") : null;
    const { error } = await db.from("cargo_consignments").update({ driver_token: token }).eq("id", data.id).eq("organisation_id", orgId);
    if (error) throwSafeError("cargo.link", error, "Unable to update the driver link.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "cargo_consignment", resourceId: data.id, actionType: data.enable ? "driver_link_issued" : "driver_link_revoked", actionDetail: {} });
    return { url: token ? `${getSiteUrl()}/custody/${token}` : null };
  });

async function mineForRecording(context: { supabase: unknown; userId: string }, id: string) {
  const orgId = await getActiveOrgId(context.supabase as any, context.userId);
  const db = await admin();
  const role = await roleIn(db, context.userId, orgId);
  if (!role || !RECORD_ROLES.includes(role)) throwSafeError("cargo.record", new Error("role"), "Your role can't record custody.");
  const { data: c } = await db.from("cargo_consignments").select("*").eq("id", id).eq("organisation_id", orgId).maybeSingle();
  if (!c) throwSafeError("cargo.record", new Error("missing"), "Consignment not found.");
  return { c, db, orgId };
}

export const custodyUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ consignment_id: z.string().uuid() }).merge(fileIn).parse(d))
  .handler(async ({ data, context }) => {
    const { c } = await mineForRecording(context, data.consignment_id);
    if (c.status === "delivered" || c.status === "cancelled") throwSafeError("cargo.upload", new Error("closed"), "This consignment is closed.");
    const { uploadUrl } = await import("./cargo.server");
    return uploadUrl(c.organisation_id, c.id, data.name);
  });

export const recordCustody = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ consignment_id: z.string().uuid(), ...eventIn }).parse(d))
  .handler(async ({ data, context }) => {
    const { c, db } = await mineForRecording(context, data.consignment_id);
    const { appendCustodyEvent } = await import("./cargo.server");
    const { consignment_id: _c, ...input } = data;
    try {
      return await appendCustodyEvent(c, input, { via: "app", userId: context.userId, name: await nameOf(db, context.userId) });
    } catch (e) {
      throwSafeError("cargo.record", e as Error, (e as Error).message);
    }
  });

// ───────────────────────────── Driver link (no account) ─────────────────────────────

async function byToken(token: string) {
  const db = await admin();
  const { data: c } = await db.from("cargo_consignments").select("*").eq("driver_token", token).maybeSingle();
  if (!c || c.status === "cancelled") return null;
  return c;
}

export const getDriverConsignment = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: z.string().min(10).max(40) }).parse(d))
  .handler(async ({ data }) => {
    const c = await byToken(data.token);
    if (!c) return { found: false as const };
    const db = await admin();
    const [{ data: org }, { data: ev }] = await Promise.all([
      db.from("organisations").select("name").eq("id", c.organisation_id).maybeSingle(),
      db.from("cargo_custody_events").select("seq, kind, checkpoint_index, recorded_at, recorded_by_name").eq("consignment_id", c.id).order("seq", { ascending: true }).limit(500),
    ]);
    // The driver isn't shown the seal numbers on record: they type what they see.
    return {
      found: true as const,
      reference: c.reference as string,
      description: c.description as string,
      origin: c.origin as string,
      destination: c.destination as string,
      operator: (org?.name as string) ?? "",
      status: c.status as Consignment["status"],
      seal_count: (c.seal_numbers ?? []).length as number,
      checkpoints: ((c.checkpoints ?? []) as Consignment["checkpoints"]).map((p) => p.name),
      events: (ev ?? []) as { seq: number; kind: string; checkpoint_index: number | null; recorded_at: string; recorded_by_name: string }[],
    };
  });

export const driverUploadUrl = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: z.string().min(10).max(40) }).merge(fileIn).parse(d))
  .handler(async ({ data }) => {
    const c = await byToken(data.token);
    if (!c || c.status === "delivered") throw new Error("This link is closed. Ask the operator for a new one.");
    const { uploadUrl } = await import("./cargo.server");
    return uploadUrl(c.organisation_id, c.id, data.name);
  });

export const driverRecordCustody = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: z.string().min(10).max(40), driver_name: z.string().trim().min(2).max(80), ...eventIn, kind: DRIVER_KIND }).parse(d))
  .handler(async ({ data }) => {
    const c = await byToken(data.token);
    if (!c) throw new Error("This link isn't valid any more. Ask the operator for a new one.");
    const db = await admin();
    const { count } = await db.from("cargo_custody_events").select("id", { count: "exact", head: true }).eq("consignment_id", c.id);
    if ((count ?? 0) >= 500) throw new Error("This consignment has too many records. Contact the operator.");
    const { appendCustodyEvent } = await import("./cargo.server");
    const { token: _t, driver_name, ...input } = data;
    const r = await appendCustodyEvent(c, input, { via: "driver_link", userId: null, name: `${driver_name} (driver link)` });
    return { seq: r.seq, seals_ok: r.seals_ok, off_checkpoint_m: r.off_checkpoint_m };
  });
