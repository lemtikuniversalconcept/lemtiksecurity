import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getActiveOrgId } from "@/lib/orgs.server";
import { throwSafeError } from "@/lib/server-errors";
import { admin, logEvent, myName, roleIn } from "@/lib/links.server";

// Shared access between organisations. The owner chooses what to share, with whom,
// why and until when; the partner accepts; either side can end it; every step and
// every look at the shared picture is logged where both organisations can see it.
// Shared data is read with the service role only after the link is checked, and
// only the columns listed here leave the owner's organisation.

export const SCOPES = ["vessels", "voyages", "alerts", "search_rescue", "corridors", "isps", "people"] as const;
export type Scope = (typeof SCOPES)[number];
export const SCOPE_LABEL: Record<Scope, string> = {
  vessels: "Boats: name, licence number, live position, speed and status",
  voyages: "Voyages: route, times, head counts, off-route and overdue flags",
  alerts: "Alerts from the last 48 hours (SOS, man overboard, off route…)",
  search_rescue: "Search and rescue plans: last known position and status",
  corridors: "Corridors: routes, curfews and wind limits (they can copy them)",
  isps: "ISPS compliance: security levels, drills, Declarations of Security, breach register",
  people: "Tracked people: name, live position and status (no phone numbers)",
};
const PARTNER_TYPES = ["authority", "responder"];
const VIEW_ROLES = ["manager", "supervisor", "client_admin"];
const MANAGE_ROLES = ["manager", "client_admin"];

const sb = (c: { supabase: unknown }) => c.supabase as any;

export type OrgLink = {
  id: string;
  direction: "outgoing" | "incoming";
  owner_org_id: string;
  owner_name: string;
  partner_org_id: string;
  partner_name: string;
  partner_type: string;
  scopes: Scope[];
  purpose: string;
  status: "pending" | "active" | "declined" | "revoked" | "expired";
  expires_at: string;
  created_by_name: string | null;
  responded_by_name: string | null;
  responded_at: string | null;
  revoked_by_name: string | null;
  revoked_at: string | null;
  created_at: string;
};
export type LinkEvent = { id: string; link_id: string; actor_name: string | null; actor_org_name: string; action: string; corridor: string | null; created_at: string };

const LINK_COLS = "id, owner_org_id, partner_org_id, scopes, purpose, status, expires_at, created_by_name, responded_by_name, responded_at, revoked_by_name, revoked_at, created_at";

/** Authorities and responders on the platform you can share with (names only). */
export const listLinkDirectory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const db = await admin();
    const { data, error } = await db.from("organisations").select("id, name, type").in("type", PARTNER_TYPES).neq("id", orgId).order("name");
    if (error) throwSafeError("links.directory", error, "Unable to load the list of authorities and responders.");
    return (data ?? []) as { id: string; name: string; type: string }[];
  });

export const listLinks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const supabase = sb(context);
    const [{ data: rows, error }, { data: ev }, role] = await Promise.all([
      supabase.from("org_links").select(LINK_COLS).or(`owner_org_id.eq.${orgId},partner_org_id.eq.${orgId}`).order("created_at", { ascending: false }).limit(200),
      supabase.from("org_link_events").select("id, link_id, actor_name, actor_org_id, action, detail, created_at").or(`owner_org_id.eq.${orgId},partner_org_id.eq.${orgId}`).order("created_at", { ascending: false }).limit(200),
      roleIn(supabase, context.userId, orgId),
    ]);
    if (error) throwSafeError("links.list", error, "Unable to load shared access.");
    const ids = new Set<string>([orgId]);
    for (const r of rows ?? []) ids.add(r.owner_org_id), ids.add(r.partner_org_id);
    for (const e of ev ?? []) if (e.actor_org_id) ids.add(e.actor_org_id);
    const db = await admin();
    const { data: orgs } = await db.from("organisations").select("id, name, type").in("id", [...ids]);
    const org = new Map<string, { name: string; type: string }>((orgs ?? []).map((o: any) => [o.id, { name: o.name, type: o.type }]));
    const now = Date.now();
    const links: OrgLink[] = (rows ?? []).map((r: any) => ({
      ...r,
      direction: r.owner_org_id === orgId ? "outgoing" : "incoming",
      owner_name: org.get(r.owner_org_id)?.name ?? "Unknown organisation",
      partner_name: org.get(r.partner_org_id)?.name ?? "Unknown organisation",
      partner_type: org.get(r.partner_org_id)?.type ?? "",
      status: (r.status === "active" || r.status === "pending") && Date.parse(r.expires_at) <= now ? "expired" : r.status,
    }));
    const events: LinkEvent[] = (ev ?? []).map((e: any) => ({ id: e.id, link_id: e.link_id, actor_name: e.actor_name, actor_org_name: org.get(e.actor_org_id)?.name ?? "", action: e.action, corridor: typeof e.detail?.corridor === "string" ? e.detail.corridor : null, created_at: e.created_at }));
    return { links, events, my_org: { id: orgId, name: org.get(orgId)?.name ?? "", type: org.get(orgId)?.type ?? "" }, can_manage: !!role && MANAGE_ROLES.includes(role) };
  });

export const offerLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      partner_org_id: z.string().uuid(),
      scopes: z.array(z.enum(SCOPES)).min(1),
      purpose: z.string().trim().min(10, "Say why you are sharing (at least 10 characters).").max(500),
      days: z.number().int().min(1).max(365),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const db = await admin();
    const role = await roleIn(db, context.userId, orgId);
    if (!role || !MANAGE_ROLES.includes(role)) throwSafeError("links.offer", new Error("role"), "Only security managers and client admins can share access.");
    const { data: partner } = await db.from("organisations").select("id, name, type").eq("id", data.partner_org_id).maybeSingle();
    if (!partner || !PARTNER_TYPES.includes(partner.type) || partner.id === orgId) throwSafeError("links.offer", new Error("partner"), "You can only share with an authority or responder organisation.");
    const { data: open } = await db.from("org_links").select("id").eq("owner_org_id", orgId).eq("partner_org_id", partner.id).in("status", ["pending", "active"]).gt("expires_at", new Date().toISOString()).limit(1);
    if (open?.length) throwSafeError("links.offer", new Error("dup"), `You already have an open share with ${partner.name}. End it first to change what's shared.`);
    const name = await myName(db, context.userId);
    const scopes = SCOPES.filter((s) => data.scopes.includes(s));
    const { data: link, error } = await db
      .from("org_links")
      .insert({ owner_org_id: orgId, partner_org_id: partner.id, scopes, purpose: data.purpose, expires_at: new Date(Date.now() + data.days * 86_400_000).toISOString(), created_by: context.userId, created_by_name: name })
      .select("id, owner_org_id, partner_org_id")
      .single();
    if (error) throwSafeError("links.offer", error, "Unable to share access.");
    await logEvent(db, link, { id: context.userId, name, org: orgId }, "offered", { scopes, days: data.days, purpose: data.purpose });
    return { id: link.id as string };
  });

async function loadLink(db: any, id: string) {
  const { data } = await db.from("org_links").select(LINK_COLS).eq("id", id).maybeSingle();
  if (!data) throwSafeError("links.load", new Error("not found"), "Shared access not found.");
  return data;
}

export const respondLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), accept: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const db = await admin();
    const link = await loadLink(db, data.id);
    if (link.partner_org_id !== orgId) throwSafeError("links.respond", new Error("org"), "This offer was made to another organisation.");
    const role = await roleIn(db, context.userId, orgId);
    if (!role || !MANAGE_ROLES.includes(role)) throwSafeError("links.respond", new Error("role"), "Only security managers and client admins can accept or decline.");
    if (link.status !== "pending") throwSafeError("links.respond", new Error("status"), "This offer has already been answered or ended.");
    if (Date.parse(link.expires_at) <= Date.now()) throwSafeError("links.respond", new Error("expired"), "This offer has expired.");
    const name = await myName(db, context.userId);
    const status = data.accept ? "active" : "declined";
    const { error } = await db.from("org_links").update({ status, responded_by: context.userId, responded_by_name: name, responded_at: new Date().toISOString() }).eq("id", link.id).eq("status", "pending");
    if (error) throwSafeError("links.respond", error, "Unable to answer the offer.");
    await logEvent(db, link, { id: context.userId, name, org: orgId }, data.accept ? "accepted" : "declined");
    return { ok: true };
  });

/** Either side can end a share at any time. */
export const revokeLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const db = await admin();
    const link = await loadLink(db, data.id);
    if (link.owner_org_id !== orgId && link.partner_org_id !== orgId) throwSafeError("links.revoke", new Error("org"), "Shared access not found.");
    const role = await roleIn(db, context.userId, orgId);
    if (!role || !MANAGE_ROLES.includes(role)) throwSafeError("links.revoke", new Error("role"), "Only security managers and client admins can end shared access.");
    if (link.status !== "pending" && link.status !== "active") throwSafeError("links.revoke", new Error("status"), "This share has already ended.");
    const name = await myName(db, context.userId);
    const { error } = await db.from("org_links").update({ status: "revoked", revoked_by: context.userId, revoked_by_name: name, revoked_at: new Date().toISOString() }).eq("id", link.id);
    if (error) throwSafeError("links.revoke", error, "Unable to end shared access.");
    await logEvent(db, link, { id: context.userId, name, org: orgId }, "revoked");
    return { ok: true };
  });

/** Checks the caller may look at this share right now; returns the link and their name. */
async function openShare(context: { supabase: unknown; userId: string }, id: string, roles = VIEW_ROLES) {
  const orgId = await getActiveOrgId(context.supabase as any, context.userId);
  const db = await admin();
  const link = await loadLink(db, id);
  if (link.partner_org_id !== orgId) throwSafeError("links.view", new Error("org"), "Switch to the organisation this was shared with to open it.");
  const role = await roleIn(db, context.userId, orgId);
  if (!role || !roles.includes(role)) throwSafeError("links.view", new Error("role"), "Your role can't open shared access.");
  if (link.status !== "active") throwSafeError("links.view", new Error("status"), link.status === "pending" ? "Accept the offer first." : "This share has ended.");
  if (Date.parse(link.expires_at) <= Date.now()) throwSafeError("links.view", new Error("expired"), "This share has expired.");
  return { db, link, orgId };
}

export type SharedView = {
  link: { id: string; owner_name: string; scopes: Scope[]; purpose: string; expires_at: string };
  vessels: { id: string; name: string; reference: string | null; mmsi: string | null; lat: number | null; lng: number | null; speed_kn: number | null; heading: number | null; seen_at: string | null; state: string | null; capacity: number | null }[];
  people: { id: string; name: string; lat: number | null; lng: number | null; seen_at: string | null; state: string | null }[];
  voyages: { id: string; subject_id: string | null; name: string; status: string; route: [number, number][]; planned_departure: string | null; planned_arrival: string | null; departed_at: string | null; arrived_at: string | null; departure_count: number | null; arrival_count: number | null; off_route: boolean; overdue: boolean }[];
  alerts: { id: string; subject_id: string | null; kind: string; severity: number; message: string | null; lat: number | null; lng: number | null; created_at: string; acknowledged: boolean }[];
  sar: { id: string; title: string; status: string; object_type: string; persons: number | null; lat: number; lng: number; lkp_at: string; created_at: string; closed_at: string | null }[];
  corridors: { id: string; name: string; route: [number, number][]; corridor_m: number; curfew_start: string | null; curfew_end: string | null; max_wind_kn: number | null }[];
  generated_at: string;
};

export const getSharedView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<SharedView> => {
    const { db, link, orgId } = await openShare(context, data.id);
    const owner = link.owner_org_id as string;
    const has = (s: Scope) => (link.scopes as string[]).includes(s);
    const since48 = new Date(Date.now() - 48 * 3_600_000).toISOString();
    const since24 = new Date(Date.now() - 24 * 3_600_000).toISOString();
    const empty = Promise.resolve({ data: [] as any[] });
    const needSubjects = has("vessels") || has("people") || has("voyages") || has("alerts");
    const [subj, voy, al, sar, cor, ownerOrg] = await Promise.all([
      needSubjects ? db.from("movement_subjects").select("id, kind, name, reference, mmsi, last_lat, last_lng, last_speed_mps, last_heading, last_seen_at, state, passenger_capacity, tracking_enabled").eq("organisation_id", owner) : empty,
      has("voyages") ? db.from("movement_voyages").select("id, subject_id, name, status, route, planned_departure, planned_arrival, departed_at, arrived_at, departure_count, arrival_count, off_route, overdue_alerted").eq("organisation_id", owner).or(`status.in.(planned,underway),arrived_at.gte.${since24}`).order("created_at", { ascending: false }).limit(100) : empty,
      has("alerts") ? db.from("movement_alerts").select("id, subject_id, kind, severity, message, lat, lng, created_at, acknowledged_at").eq("organisation_id", owner).gte("created_at", since48).order("created_at", { ascending: false }).limit(200) : empty,
      has("search_rescue") ? db.from("sar_cases").select("id, title, status, object_type, persons, lkp_lat, lkp_lng, lkp_at, created_at, closed_at").eq("organisation_id", owner).order("created_at", { ascending: false }).limit(30) : empty,
      has("corridors") ? db.from("movement_corridors").select("id, name, route, corridor_m, curfew_start, curfew_end, max_wind_kn").eq("organisation_id", owner).eq("active", true).order("name") : empty,
      db.from("organisations").select("name").eq("id", owner).maybeSingle(),
    ]);
    const subjects: any[] = subj.data ?? [];
    const vesselIds = new Set(subjects.filter((s) => s.kind === "vessel").map((s) => s.id));
    // Voyages and alerts follow the subject's kind: boats need "vessels", people need "people".
    const visible = (sid: string | null) => !sid || (vesselIds.has(sid) ? has("vessels") || has("voyages") : has("people"));
    const name = await myName(db, context.userId);
    // Log a view at most every 30 minutes per person, so the record stays readable.
    const { data: recent } = await db.from("org_link_events").select("id").eq("link_id", link.id).eq("actor_id", context.userId).eq("action", "viewed").gte("created_at", new Date(Date.now() - 30 * 60_000).toISOString()).limit(1);
    if (!recent?.length) await logEvent(db, link, { id: context.userId, name, org: orgId }, "viewed", { scopes: link.scopes });
    return {
      link: { id: link.id, owner_name: ownerOrg.data?.name ?? "", scopes: link.scopes, purpose: link.purpose, expires_at: link.expires_at },
      vessels: has("vessels")
        ? subjects.filter((s) => s.kind === "vessel").map((s) => ({ id: s.id, name: s.name, reference: s.reference, mmsi: s.mmsi, lat: s.tracking_enabled ? s.last_lat : null, lng: s.tracking_enabled ? s.last_lng : null, speed_kn: s.last_speed_mps == null ? null : Math.round(s.last_speed_mps * 1.943844 * 10) / 10, heading: s.last_heading, seen_at: s.last_seen_at, state: s.state, capacity: s.passenger_capacity }))
        : [],
      people: has("people")
        ? subjects.filter((s) => s.kind !== "vessel").map((s) => ({ id: s.id, name: s.name, lat: s.tracking_enabled ? s.last_lat : null, lng: s.tracking_enabled ? s.last_lng : null, seen_at: s.last_seen_at, state: s.state }))
        : [],
      voyages: (voy.data ?? []).filter((v: any) => visible(v.subject_id)).map((v: any) => ({ id: v.id, subject_id: v.subject_id, name: v.name, status: v.status, route: Array.isArray(v.route) ? v.route : [], planned_departure: v.planned_departure, planned_arrival: v.planned_arrival, departed_at: v.departed_at, arrived_at: v.arrived_at, departure_count: v.departure_count, arrival_count: v.arrival_count, off_route: !!v.off_route, overdue: !!v.overdue_alerted })),
      alerts: (al.data ?? []).filter((a: any) => visible(a.subject_id)).map((a: any) => ({ id: a.id, subject_id: a.subject_id, kind: a.kind, severity: a.severity, message: a.message, lat: a.lat, lng: a.lng, created_at: a.created_at, acknowledged: !!a.acknowledged_at })),
      sar: (sar.data ?? []).map((c: any) => ({ id: c.id, title: c.title, status: c.status, object_type: c.object_type, persons: c.persons, lat: c.lkp_lat, lng: c.lkp_lng, lkp_at: c.lkp_at, created_at: c.created_at, closed_at: c.closed_at })),
      corridors: (cor.data ?? []).map((c: any) => ({ ...c, route: Array.isArray(c.route) ? c.route : [] })),
      generated_at: new Date().toISOString(),
    };
  });

/** Copies a shared corridor into your own organisation (managers only). */
export const importSharedCorridor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), corridor_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db, link, orgId } = await openShare(context, data.id, ["manager"]);
    if (!(link.scopes as string[]).includes("corridors")) throwSafeError("links.import", new Error("scope"), "Corridors aren't part of this share.");
    const { data: c } = await db.from("movement_corridors").select("name, route, corridor_m, curfew_start, curfew_end, max_wind_kn, notes").eq("id", data.corridor_id).eq("organisation_id", link.owner_org_id).maybeSingle();
    if (!c) throwSafeError("links.import", new Error("missing"), "Corridor not found.");
    const { data: ownerOrg } = await db.from("organisations").select("name").eq("id", link.owner_org_id).maybeSingle();
    const { data: row, error } = await db
      .from("movement_corridors")
      .insert({ ...c, organisation_id: orgId, created_by: context.userId, notes: [`Copied from ${ownerOrg?.name ?? "a partner"} on ${new Date().toISOString().slice(0, 10)}.`, c.notes].filter(Boolean).join(" ").slice(0, 2000) })
      .select("id")
      .single();
    if (error) throwSafeError("links.import", error, "Unable to copy the corridor.");
    const name = await myName(db, context.userId);
    await logEvent(db, link, { id: context.userId, name, org: orgId }, "imported_corridor", { corridor: c.name });
    return { id: row.id as string };
  });
