import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getActiveOrgId, getSiteUrl } from "@/lib/orgs.server";
import { throwSafeError } from "@/lib/server-errors";
import { recordBlackboxAudit } from "@/lib/audit.server";
import type { ShareRow, ShareScope, SharedRecord } from "./shares.server";

// Sharing one incident, voyage or movement alert with a partner organisation (an authority
// or responder on the platform) or through a link. A manager's share is live at once; an
// operator's waits for a manager to approve it. Shares expire, can be withdrawn, and every
// view and acknowledgement is logged.

export const SHARE_SCOPES = ["summary", "location", "track", "evidence", "people"] as const;
export const SHARE_SCOPE_LABEL: Record<ShareScope, string> = {
  summary: "What happened: type, severity, times and the timeline (always included)",
  location: "Where: the location and last known position",
  track: "Track: the planned route and the recorded track",
  evidence: "Evidence: photos, videos and documents (links last 15 minutes)",
  people: "People: names and phone numbers of victims, witnesses, crew and passengers",
};
export type ShareKind = ShareRow["record_kind"];
export type ShareState = "pending_approval" | "active" | "declined" | "revoked" | "expired";
export type ShareListItem = Omit<ShareRow, "share_token" | "status" | "requested_by"> & { status: ShareState; link: string | null; partner_name: string | null; events: { action: string; actor_name: string | null; actor_org_name: string | null; via: string | null; created_at: string }[] };

const PARTNER_TYPES = ["authority", "responder"];
const VIEW_ROLES = ["manager", "supervisor", "client_admin"];
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{24,64}$/);
const kindSchema = z.enum(["incident", "voyage", "movement_alert"]);

const srv = () => import("./shares.server");
const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;
const helpers = () => import("./links.server");
const siteUrl = () => getSiteUrl().replace(/\/$/, "");

async function staffContext(context: { supabase: unknown; userId: string }) {
  const orgId = await getActiveOrgId(context.supabase as any, context.userId);
  await (await import("./features.server")).assertFeature(orgId, "links");
  const db = await admin();
  const { roleIn, myName } = await helpers();
  const role = await roleIn(db, context.userId, orgId);
  return { orgId, db, role, name: await myName(db, context.userId) };
}

async function recordLabel(db: any, orgId: string, kind: ShareKind, id: string): Promise<string | null> {
  if (kind === "incident") {
    const { data } = await db.from("incidents").select("code, title, type").eq("id", id).eq("organisation_id", orgId).maybeSingle();
    return data ? `${data.code ?? "Incident"} · ${data.title || String(data.type ?? "").replace(/_/g, " ")}` : null;
  }
  if (kind === "voyage") {
    const { data } = await db.from("movement_voyages").select("name").eq("id", id).eq("organisation_id", orgId).maybeSingle();
    return data ? `Voyage · ${data.name}` : null;
  }
  const { data } = await db.from("movement_alerts").select("message").eq("id", id).eq("organisation_id", orgId).maybeSingle();
  return data ? `Alert · ${data.message}` : null;
}

async function event(db: any, s: { id: string; organisation_id: string }, action: string, actor: { name: string | null; org: string | null; via?: "app" | "link" }, detail: Record<string, unknown> = {}) {
  await db.from("record_share_events").insert({ share_id: s.id, organisation_id: s.organisation_id, action, actor_name: actor.name, actor_org_name: actor.org, via: actor.via ?? "app", detail });
}

async function orgName(db: any, id: string) {
  const { data } = await db.from("organisations").select("name").eq("id", id).maybeSingle();
  return (data?.name as string | undefined) ?? "";
}

async function tellPartner(s: ShareRow) {
  if (!s.partner_org_id) return;
  const db = await admin();
  const { notifyStaff, kindWord } = await srv();
  await notifyStaff(s.partner_org_id, VIEW_ROLES, `${await orgName(db, s.organisation_id)} shared an ${kindWord(s.record_kind)} with you: ${s.record_label}`, `Purpose: ${s.purpose}\nAvailable until ${new Date(s.expires_at).toLocaleString("en-GB", { timeZone: "Africa/Lagos" })}.`, 3);
}

/** Share one record. Managers' shares go live at once; operators' wait for a manager. */
export const createShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      record_kind: kindSchema,
      record_id: z.string().uuid(),
      partner_org_id: z.string().uuid().nullable(),
      recipient_label: z.string().trim().max(160).nullable(),
      recipient_contact: z.string().trim().max(160).nullable(),
      scopes: z.array(z.enum(SHARE_SCOPES)).max(5),
      purpose: z.string().trim().min(3, "Say why you're sharing it.").max(500),
      hours: z.number().int().min(1).max(720),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { orgId, db, role, name } = await staffContext(context);
    if (role !== "manager" && role !== "supervisor") throwSafeError("shares.create", new Error("role"), "Only managers and operators can share records.");
    if (data.record_kind !== "incident") await (await import("./features.server")).assertFeature(orgId, "movement");
    const label = await recordLabel(db, orgId, data.record_kind, data.record_id);
    if (!label) throwSafeError("shares.create", new Error("record"), "That record wasn't found in your organisation.");

    let recipient = data.recipient_label ?? "";
    let token: string | null = null;
    if (data.partner_org_id) {
      const { data: p } = await db.from("organisations").select("id, name, type").eq("id", data.partner_org_id).maybeSingle();
      if (!p || !PARTNER_TYPES.includes(p.type) || p.id === orgId) throwSafeError("shares.create", new Error("partner"), "You can only share with an authority or responder on Lemtik.");
      recipient = p.name;
    } else {
      if (recipient.length < 2) throwSafeError("shares.create", new Error("label"), "Say who the link is for (name and unit or organisation).");
      const { randomBytes } = await import("node:crypto");
      token = randomBytes(24).toString("base64url");
    }

    const scopes = Array.from(new Set<ShareScope>(["summary", ...data.scopes]));
    const live = role === "manager";
    const now = new Date().toISOString();
    const { SHARE_COLS } = await srv();
    const { data: row, error } = await db
      .from("record_shares")
      .insert({
        organisation_id: orgId,
        record_kind: data.record_kind,
        record_id: data.record_id,
        record_label: label!.slice(0, 200),
        partner_org_id: data.partner_org_id,
        share_token: token,
        recipient_label: recipient.slice(0, 160),
        recipient_contact: data.partner_org_id ? null : data.recipient_contact || null,
        scopes,
        purpose: data.purpose,
        expires_at: new Date(Date.now() + data.hours * 3600_000).toISOString(),
        status: live ? "active" : "pending_approval",
        requested_by: context.userId,
        requested_by_name: name,
        ...(live ? { approved_by: context.userId, approved_by_name: name, approved_at: now } : {}),
      })
      .select(SHARE_COLS)
      .single();
    if (error) throwSafeError("shares.create", error, "Couldn't create the share.");
    const s = row as ShareRow;
    const org = await orgName(db, orgId);
    await event(db, s, "requested", { name, org }, { scopes, hours: data.hours });
    if (live) await event(db, s, "approved", { name, org }, { self: true });
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "record_share", resourceId: s.id, actionType: live ? "share" : "share_requested", actionDetail: { record_kind: s.record_kind, record_id: s.record_id, recipient: s.recipient_label, scopes, hours: data.hours } });
    if (live) await tellPartner(s);
    else {
      const { notifyStaff } = await srv();
      await notifyStaff(orgId, ["manager"], `${name} asks to share ${s.record_label} with ${s.recipient_label}`, `Purpose: ${s.purpose}\nWhat: ${scopes.join(", ")}. Approve or decline it on the Shared access page.`, 3);
    }
    return { id: s.id, status: s.status, link: token && live ? `${siteUrl()}/shared/${token}` : null };
  });

async function managerShare(context: { supabase: unknown; userId: string }, id: string) {
  const c = await staffContext(context);
  const { SHARE_COLS } = await srv();
  const { data } = await c.db.from("record_shares").select(SHARE_COLS).eq("id", id).eq("organisation_id", c.orgId).maybeSingle();
  if (!data) throwSafeError("shares.manage", new Error("missing"), "Share not found.");
  return { ...c, s: data as ShareRow };
}

export const approveShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db, role, name, s, orgId } = await managerShare(context, data.id);
    if (role !== "manager") throwSafeError("shares.approve", new Error("role"), "Only a manager can approve a share.");
    if (s.status !== "pending_approval") throwSafeError("shares.approve", new Error("state"), "This share isn't waiting for approval.");
    if (Date.parse(s.expires_at) <= Date.now()) throwSafeError("shares.approve", new Error("expired"), "This request has already expired. Ask for a new one.");
    const { data: moved } = await db.from("record_shares").update({ status: "active", approved_by: context.userId, approved_by_name: name, approved_at: new Date().toISOString() }).eq("id", s.id).eq("status", "pending_approval").select("id");
    if (!moved?.length) throwSafeError("shares.approve", new Error("race"), "Someone else just dealt with this request.");
    await event(db, s, "approved", { name, org: await orgName(db, orgId) });
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "record_share", resourceId: s.id, actionType: "share_approved", actionDetail: { recipient: s.recipient_label, requested_by: s.requested_by_name } });
    await tellPartner({ ...s, status: "active" });
    return { link: s.share_token ? `${siteUrl()}/shared/${s.share_token}` : null };
  });

export const declineShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), reason: z.string().trim().min(3, "Give a reason.").max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const { db, role, name, s, orgId } = await managerShare(context, data.id);
    if (role !== "manager") throwSafeError("shares.decline", new Error("role"), "Only a manager can decline a share.");
    const { data: moved } = await db.from("record_shares").update({ status: "declined", decline_reason: data.reason, approved_by: context.userId, approved_by_name: name, approved_at: new Date().toISOString() }).eq("id", s.id).eq("status", "pending_approval").select("id");
    if (!moved?.length) throwSafeError("shares.decline", new Error("state"), "This share isn't waiting for approval.");
    await event(db, s, "declined", { name, org: await orgName(db, orgId) }, { reason: data.reason });
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "record_share", resourceId: s.id, actionType: "share_declined", actionDetail: { reason: data.reason } });
    return { ok: true };
  });

/** Withdraw a share so it stops working at once. Managers, or the operator who asked for it. */
export const revokeShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db, role, name, s, orgId } = await managerShare(context, data.id);
    const mine = s.requested_by === context.userId;
    if (role !== "manager" && !(role === "supervisor" && mine)) throwSafeError("shares.revoke", new Error("role"), "Only a manager can withdraw this share.");
    const { data: moved } = await db.from("record_shares").update({ status: "revoked", revoked_at: new Date().toISOString(), revoked_by_name: name }).eq("id", s.id).in("status", ["active", "pending_approval"]).select("id");
    if (!moved?.length) throwSafeError("shares.revoke", new Error("state"), "This share has already ended.");
    await event(db, s, "revoked", { name, org: await orgName(db, orgId) });
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "record_share", resourceId: s.id, actionType: "share_revoked", actionDetail: { recipient: s.recipient_label } });
    return { ok: true };
  });

async function decorate(db: any, rows: ShareRow[], canSeeLinks: boolean): Promise<ShareListItem[]> {
  if (!rows.length) return [];
  const { shareState } = await srv();
  const ids = rows.map((r) => r.id);
  const partnerIds = [...new Set(rows.map((r) => r.partner_org_id).filter(Boolean))] as string[];
  const [{ data: ev }, { data: orgs }] = await Promise.all([
    db.from("record_share_events").select("share_id, action, actor_name, actor_org_name, via, created_at").in("share_id", ids).order("created_at", { ascending: true }).limit(2000),
    partnerIds.length ? db.from("organisations").select("id, name").in("id", partnerIds) : Promise.resolve({ data: [] }),
  ]);
  const names = new Map(((orgs ?? []) as any[]).map((o) => [o.id, o.name]));
  return rows.map(({ share_token, requested_by, ...r }) => {
    const state = shareState(r as ShareRow);
    return {
      ...r,
      status: state,
      partner_name: r.partner_org_id ? names.get(r.partner_org_id) ?? r.recipient_label : null,
      link: canSeeLinks && share_token && state === "active" ? `${siteUrl()}/shared/${share_token}` : null,
      events: ((ev ?? []) as any[]).filter((e) => e.share_id === r.id).map(({ share_id, ...e }) => e),
    };
  });
}

/** Shares of one record, for its page. */
export const listSharesForRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ record_kind: kindSchema, record_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { orgId, db, role } = await staffContext(context);
    if (!role || !VIEW_ROLES.includes(role)) return { role, shares: [] as ShareListItem[] };
    const { SHARE_COLS } = await srv();
    const { data: rows } = await db.from("record_shares").select(SHARE_COLS).eq("organisation_id", orgId).eq("record_kind", data.record_kind).eq("record_id", data.record_id).order("created_at", { ascending: false }).limit(50);
    return { role, shares: await decorate(db, (rows ?? []) as ShareRow[], role === "manager" || role === "supervisor") };
  });

/** Everything this organisation has shared, newest first, with requests awaiting approval on top. */
export const listOutgoingShares = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { orgId, db, role } = await staffContext(context);
    if (!role || !VIEW_ROLES.includes(role)) return { role, shares: [] as ShareListItem[] };
    const { SHARE_COLS } = await srv();
    const { data: rows } = await db.from("record_shares").select(SHARE_COLS).eq("organisation_id", orgId).order("created_at", { ascending: false }).limit(200);
    const list = await decorate(db, (rows ?? []) as ShareRow[], role === "manager" || role === "supervisor");
    list.sort((a, b) => Number(b.status === "pending_approval") - Number(a.status === "pending_approval"));
    return { role, shares: list };
  });

export type IncomingShare = { id: string; owner: string; record_kind: ShareKind; record_label: string; purpose: string; scopes: ShareScope[]; expires_at: string; status: ShareState; shared_by: string | null; created_at: string; acknowledged_at: string | null; acknowledged_by_name: string | null };

/** Records other organisations have shared with this one. */
export const listSharedWithUs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<IncomingShare[]> => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const db = await admin();
    const { roleIn } = await helpers();
    const role = await roleIn(db, context.userId, orgId);
    if (!role || !VIEW_ROLES.includes(role)) return [];
    const { SHARE_COLS, shareState } = await srv();
    const { data: rows } = await db.from("record_shares").select(SHARE_COLS).eq("partner_org_id", orgId).in("status", ["active", "revoked"]).order("created_at", { ascending: false }).limit(200);
    const list = (rows ?? []) as ShareRow[];
    const owners = [...new Set(list.map((r) => r.organisation_id))];
    const { data: orgs } = owners.length ? await db.from("organisations").select("id, name").in("id", owners) : { data: [] };
    const names = new Map(((orgs ?? []) as any[]).map((o) => [o.id, o.name]));
    return list.map((r) => ({ id: r.id, owner: names.get(r.organisation_id) ?? "", record_kind: r.record_kind, record_label: r.record_label, purpose: r.purpose, scopes: r.scopes, expires_at: r.expires_at, status: shareState(r), shared_by: r.approved_by_name ?? r.requested_by_name, created_at: r.created_at, acknowledged_at: r.acknowledged_at, acknowledged_by_name: r.acknowledged_by_name }));
  });

export type ShareView = { found: true; record: SharedRecord; via: "app" | "link" } | { found: false; reason: "invalid" | "expired" | "revoked" | "pending"; owner?: string };

async function viewFor(s: ShareRow | null, viewer: { name: string | null; org: string | null; via: "app" | "link"; key: string }): Promise<ShareView> {
  if (!s) return { found: false, reason: "invalid" };
  const { shareState, buildSharedRecord, logView } = await srv();
  const state = shareState(s);
  if (state !== "active") {
    const db = await admin();
    return { found: false, reason: state === "expired" ? "expired" : state === "revoked" ? "revoked" : state === "pending_approval" ? "pending" : "invalid", owner: await orgName(db, s.organisation_id) };
  }
  await logView(s, viewer);
  return { found: true, record: await buildSharedRecord(s), via: viewer.via };
}

async function shareByToken(token: string): Promise<ShareRow | null> {
  const db = await admin();
  const { SHARE_COLS } = await srv();
  const { data } = await db.from("record_shares").select(SHARE_COLS).eq("share_token", token).maybeSingle();
  return (data as ShareRow) ?? null;
}

async function partnerShare(context: { supabase: unknown; userId: string }, id: string) {
  const orgId = await getActiveOrgId(context.supabase as any, context.userId);
  const db = await admin();
  const { roleIn, myName } = await helpers();
  const role = await roleIn(db, context.userId, orgId);
  if (!role || !VIEW_ROLES.includes(role)) throwSafeError("shares.partner", new Error("role"), "Only managers, operators and client admins can open shared records.");
  const { SHARE_COLS } = await srv();
  const { data } = await db.from("record_shares").select(SHARE_COLS).eq("id", id).eq("partner_org_id", orgId).maybeSingle();
  return { s: (data as ShareRow) ?? null, orgId, db, name: await myName(db, context.userId), org: await orgName(db, orgId) };
}

/** A partner organisation member opens a record shared with them. */
export const getSharedRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { s, name, org } = await partnerShare(context, data.id);
    return viewFor(s, { name, org, via: "app", key: context.userId });
  });

export const acknowledgeSharedRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), note: z.string().trim().max(1000).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { s, name, org, orgId } = await partnerShare(context, data.id);
    await acknowledge(s, `${name} (${org})`, data.note, "app");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "record_share", resourceId: data.id, actionType: "share_acknowledged", actionDetail: { note: data.note ?? null } });
    return { ok: true };
  });

async function acknowledge(s: ShareRow | null, by: string, note: string | undefined, via: "app" | "link") {
  const { shareState, notifyStaff, kindWord } = await srv();
  if (!s || shareState(s) !== "active") throw new Error("This share isn't active any more.");
  if (s.acknowledged_at) throw new Error(`Already acknowledged by ${s.acknowledged_by_name ?? "someone"}.`);
  const db = await admin();
  const { data: moved } = await db.from("record_shares").update({ acknowledged_at: new Date().toISOString(), acknowledged_by_name: by.slice(0, 120), ack_note: note || null }).eq("id", s.id).is("acknowledged_at", null).select("id");
  if (!moved?.length) throw new Error("Someone else just acknowledged this.");
  await db.from("record_share_events").insert({ share_id: s.id, organisation_id: s.organisation_id, action: "acknowledged", actor_name: by.slice(0, 120), actor_org_name: s.partner_org_id ? s.recipient_label : null, via, detail: note ? { note } : {} });
  await notifyStaff(s.organisation_id, ["manager", "supervisor"], `${by} acknowledged the shared ${kindWord(s.record_kind)}: ${s.record_label}`, note ? `Their note: ${note}` : "No note added.", 3);
}

/** Public: open a shared record through its link. No account needed; the link expires and can be withdrawn. */
export const getShareByToken = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: tokenSchema }).parse(d))
  .handler(async ({ data }) => {
    const s = await shareByToken(data.token);
    const { linkViewerKey } = await srv();
    return viewFor(s, { name: null, org: null, via: "link", key: linkViewerKey() });
  });

/** Public: the recipient confirms they've received it. */
export const acknowledgeShareByToken = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: tokenSchema, by_name: z.string().trim().min(2, "Enter your name and unit.").max(120), note: z.string().trim().max(1000).optional() }).parse(d))
  .handler(async ({ data }) => {
    await acknowledge(await shareByToken(data.token), data.by_name, data.note, "link");
    return { ok: true };
  });
