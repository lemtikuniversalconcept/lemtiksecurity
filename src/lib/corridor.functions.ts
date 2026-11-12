import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getActiveOrgId } from "@/lib/orgs.server";
import { throwSafeError } from "@/lib/server-errors";
import { recordBlackboxAudit } from "@/lib/audit.server";
import type { BoardingProblem, Weather } from "./corridor.server";

// Corridor Watch: approved corridors, the jetty boarding check, passenger QR boarding,
// responders and the approved hand-off of an emergency to the nearest one.

const sb = (c: { supabase: unknown }) => c.supabase as any;
const lngLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable();

export type Corridor = {
  id: string;
  name: string;
  route: [number, number][];
  corridor_m: number;
  curfew_start: string | null;
  curfew_end: string | null;
  max_wind_kn: number | null;
  active: boolean;
  notes: string | null;
};
export type Responder = {
  id: string;
  name: string;
  kind: "marine_police" | "navy" | "search_rescue" | "waterways_authority" | "medical" | "private_security" | "other";
  phone: string | null;
  whatsapp: string | null;
  lat: number | null;
  lng: number | null;
  notes: string | null;
  active: boolean;
  responder_org_id: string | null;
};
export type Passenger = { id: string; name: string; phone: string | null; next_of_kin_phone: string | null; source: "qr" | "staff"; boarded_at: string };

// ---------------------------------------------------------------- Corridors

export const listCorridors = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Corridor[]> => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { data, error } = await sb(context).from("movement_corridors").select("id, name, route, corridor_m, curfew_start, curfew_end, max_wind_kn, active, notes").eq("organisation_id", orgId).order("name");
    if (error) throwSafeError("corridors.list", error, "Unable to load corridors.");
    return ((data ?? []) as Corridor[]).map((c) => ({ ...c, curfew_start: c.curfew_start?.slice(0, 5) ?? null, curfew_end: c.curfew_end?.slice(0, 5) ?? null }));
  });

export const saveCorridor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      name: z.string().trim().min(1).max(160),
      route: z.array(lngLat).max(200),
      corridor_m: z.number().int().min(100).max(50_000),
      curfew_start: hhmm,
      curfew_end: hhmm,
      max_wind_kn: z.number().int().min(5).max(80).nullable(),
      active: z.boolean(),
      notes: z.string().trim().max(2000).nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    await (await import("./features.server")).assertFeature(orgId, "corridors");
    if (!!data.curfew_start !== !!data.curfew_end) throwSafeError("corridors.save", new Error("half curfew"), "Set both curfew times, or neither.");
    const { id, ...row } = data;
    const q = id
      ? sb(context).from("movement_corridors").update({ ...row, updated_at: new Date().toISOString() }).eq("id", id).eq("organisation_id", orgId).select("id").single()
      : sb(context).from("movement_corridors").insert({ ...row, organisation_id: orgId, created_by: context.userId }).select("id").single();
    const { data: saved, error } = await q;
    if (error) throwSafeError("corridors.save", error, "Unable to save. Only security managers can change corridors.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "movement_corridor", resourceId: saved.id, actionType: id ? "update" : "create", actionDetail: { name: data.name, curfew: data.curfew_start ? `${data.curfew_start}-${data.curfew_end}` : null, max_wind_kn: data.max_wind_kn } });
    return { id: saved.id as string };
  });

export const deleteCorridor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { error } = await sb(context).from("movement_corridors").delete().eq("id", data.id).eq("organisation_id", orgId);
    if (error) throwSafeError("corridors.delete", error, "Unable to remove the corridor.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "movement_corridor", resourceId: data.id, actionType: "delete", actionDetail: {} });
    return { ok: true };
  });

// ---------------------------------------------------------------- Boarding

export type BoardingCheck = {
  boat: string;
  is_vessel: boolean;
  capacity: number | null;
  life_jackets: number | null;
  corridor: { name: string; curfew_start: string | null; curfew_end: string | null; max_wind_kn: number } | null;
  in_curfew: boolean;
  lagos_time: string;
  weather: Weather | null;
  weather_point: [number, number] | null;
  qr_passengers: Passenger[];
  boarding_token: string | null;
};

/** Everything the jetty officer needs before departure. Counting happens on the page. */
export const getBoardingCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ voyage_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<BoardingCheck> => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { data: v } = await sb(context).from("movement_voyages").select("id, subject_id, route, corridor_id, boarding_token").eq("id", data.voyage_id).eq("organisation_id", orgId).maybeSingle();
    if (!v) throwSafeError("boarding.check", new Error("not found"), "Voyage not found.");
    const [{ data: s }, { data: c }, { data: pax }] = await Promise.all([
      sb(context).from("movement_subjects").select("name, kind, passenger_capacity, life_jackets, last_lat, last_lng").eq("id", v.subject_id).maybeSingle(),
      v.corridor_id ? sb(context).from("movement_corridors").select("name, curfew_start, curfew_end, max_wind_kn").eq("id", v.corridor_id).maybeSingle() : Promise.resolve({ data: null }),
      sb(context).from("voyage_passengers").select("id, name, phone, next_of_kin_phone, source, boarded_at").eq("voyage_id", v.id).order("boarded_at"),
    ]);
    const { weatherAt, inCurfew, lagosClock, DEFAULT_MAX_WIND_KN } = await import("./corridor.server");
    const route = (Array.isArray(v.route) ? v.route : []) as [number, number][];
    const point: [number, number] | null = route[0] ?? (s?.last_lng != null ? [s.last_lng, s.last_lat] : null);
    const weather = point ? await weatherAt(point[1], point[0]) : null;
    return {
      boat: s?.name ?? "Removed",
      is_vessel: s?.kind === "vessel",
      capacity: s?.passenger_capacity ?? null,
      life_jackets: s?.life_jackets ?? null,
      corridor: c ? { name: c.name, curfew_start: c.curfew_start?.slice(0, 5) ?? null, curfew_end: c.curfew_end?.slice(0, 5) ?? null, max_wind_kn: c.max_wind_kn ?? DEFAULT_MAX_WIND_KN } : null,
      in_curfew: c ? inCurfew(c.curfew_start, c.curfew_end) : false,
      lagos_time: lagosClock(),
      weather,
      weather_point: point,
      qr_passengers: (pax ?? []) as Passenger[],
      boarding_token: v.boarding_token ?? null,
    };
  });

export const openBoarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ voyage_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    await (await import("./features.server")).assertFeature(orgId, "corridors");
    const { randomBytes } = await import("node:crypto");
    const token = randomBytes(12).toString("base64url");
    const { error } = await sb(context).from("movement_voyages").update({ boarding_token: token }).eq("id", data.voyage_id).eq("organisation_id", orgId).eq("status", "planned");
    if (error) throwSafeError("boarding.open", error, "Unable to open boarding.");
    return { token };
  });

export const addPassengerByStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ voyage_id: z.string().uuid(), name: z.string().trim().min(1).max(120), next_of_kin_phone: z.string().trim().max(40).nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { error } = await sb(context).from("voyage_passengers").insert({ organisation_id: orgId, voyage_id: data.voyage_id, name: data.name, next_of_kin_phone: data.next_of_kin_phone, source: "staff" });
    if (error) throwSafeError("boarding.staffAdd", error, "Unable to add the passenger.");
    return { ok: true };
  });

export const removePassenger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await sb(context).from("voyage_passengers").delete().eq("id", data.id);
    if (error) throwSafeError("boarding.remove", error, "Unable to remove the passenger.");
    return { ok: true };
  });

// Public: the page a passenger opens by scanning the QR at the jetty.
async function voyageByBoardingToken(token: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data: v } = await db.from("movement_voyages").select("id, organisation_id, subject_id, name, status, planned_departure").eq("boarding_token", token).maybeSingle();
  if (!v) return null;
  const [{ data: s }, { data: org }, { count }] = await Promise.all([
    db.from("movement_subjects").select("name, passenger_capacity").eq("id", v.subject_id).maybeSingle(),
    db.from("organisations").select("name").eq("id", v.organisation_id).maybeSingle(),
    db.from("voyage_passengers").select("id", { count: "exact", head: true }).eq("voyage_id", v.id),
  ]);
  return { db, v, boat: s?.name ?? "", capacity: (s?.passenger_capacity as number | null) ?? null, org: org?.name ?? "", count: count ?? 0 };
}

export const getBoardingInfo = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: z.string().min(10).max(40) }).parse(d))
  .handler(async ({ data }) => {
    const x = await voyageByBoardingToken(data.token);
    if (!x) return { found: false as const };
    return {
      found: true as const,
      open: x.v.status === "planned",
      voyage: x.v.name as string,
      boat: x.boat,
      operator: x.org,
      planned_departure: x.v.planned_departure as string | null,
      full: x.capacity != null && x.count >= x.capacity,
    };
  });

export const boardPassenger = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      token: z.string().min(10).max(40),
      name: z.string().trim().min(2).max(120),
      phone: z.string().trim().max(40).nullable(),
      next_of_kin_phone: z.string().trim().min(7).max(40),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const x = await voyageByBoardingToken(data.token);
    if (!x) throw new Error("This boarding code isn't valid. Ask the jetty staff.");
    if (x.v.status !== "planned") throw new Error("Boarding for this trip has closed. Ask the jetty staff.");
    const limit = x.capacity ?? 500;
    if (x.count >= limit) throw new Error(`This boat is full (${limit} people). Please don't board; speak to the jetty staff.`);
    const { error } = await x.db.from("voyage_passengers").insert({ organisation_id: x.v.organisation_id, voyage_id: x.v.id, name: data.name, phone: data.phone || null, next_of_kin_phone: data.next_of_kin_phone, source: "qr" });
    if (error) throw new Error("Couldn't record you. Please tell the jetty staff your name.");
    return { ok: true, number: x.count + 1 };
  });

// ---------------------------------------------------------------- Responders

export const listResponders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Responder[]> => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { data, error } = await sb(context).from("movement_responders").select("id, name, kind, phone, whatsapp, lat, lng, notes, active, responder_org_id").eq("organisation_id", orgId).order("name");
    if (error) throwSafeError("responders.list", error, "Unable to load responders.");
    return (data ?? []) as Responder[];
  });

export const saveResponder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      name: z.string().trim().min(1).max(160),
      kind: z.enum(["marine_police", "navy", "search_rescue", "waterways_authority", "medical", "private_security", "other"]),
      phone: z.string().trim().max(40).nullable(),
      whatsapp: z.string().trim().max(40).nullable(),
      lat: z.number().min(-90).max(90).nullable(),
      lng: z.number().min(-180).max(180).nullable(),
      notes: z.string().trim().max(1000).nullable(),
      active: z.boolean(),
      responder_org_id: z.string().uuid().nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { id, ...row } = data;
    if (row.responder_org_id) {
      const db = (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;
      const { data: o } = await db.from("organisations").select("id, type").eq("id", row.responder_org_id).maybeSingle();
      if (!o || !["responder", "authority"].includes(o.type) || o.id === orgId) throwSafeError("responders.save", new Error("org"), "Pick a responder or authority organisation on Lemtik.");
    }
    const q = id
      ? sb(context).from("movement_responders").update(row).eq("id", id).eq("organisation_id", orgId).select("id").single()
      : sb(context).from("movement_responders").insert({ ...row, organisation_id: orgId }).select("id").single();
    const { data: saved, error } = await q;
    if (error) throwSafeError("responders.save", error, "Unable to save. Only security managers can change responders.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "movement_responder", resourceId: saved.id, actionType: id ? "update" : "create", actionDetail: { name: data.name, kind: data.kind } });
    return { id: saved.id as string };
  });

export const deleteResponder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { error } = await sb(context).from("movement_responders").delete().eq("id", data.id).eq("organisation_id", orgId);
    if (error) throwSafeError("responders.delete", error, "Unable to remove the responder.");
    return { ok: true };
  });

// ---------------------------------------------------------------- Hand-off

export type HandoffContext = {
  subject: { id: string; name: string; mmsi: string | null; reference: string | null; lat: number | null; lng: number | null; last_seen_at: string | null; speed_kn: number | null };
  voyage_id: string | null;
  responders: (Responder & { distance_m: number | null })[];
  draft: string;
  previous: {
    id: string; responder_name: string; channel: string; approved_by_name: string | null; created_at: string;
    status: string; status_at: string | null; first_viewed_at: string | null; share_token: string | null; share_expires_at: string | null; withdrawn_at: string | null;
  }[];
};

export const getHandoffContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ subject_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<HandoffContext> => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { data: s } = await sb(context).from("movement_subjects").select("id, name, kind, mmsi, reference, last_lat, last_lng, last_seen_at, last_speed_mps, state, phone").eq("id", data.subject_id).eq("organisation_id", orgId).maybeSingle();
    if (!s) throwSafeError("handoff.ctx", new Error("not found"), "Not found.");
    const { data: v } = await sb(context).from("movement_voyages").select("id, name, departure_count, departed_at, planned_arrival, corridor_id, route").eq("subject_id", s.id).eq("status", "underway").maybeSingle();
    const since = new Date(Date.now() - 3 * 3600_000).toISOString();
    const [{ data: responders }, { data: alerts }, { data: pax }, { data: prev }] = await Promise.all([
      sb(context).from("movement_responders").select("id, name, kind, phone, whatsapp, lat, lng, notes, active, responder_org_id").eq("organisation_id", orgId).eq("active", true),
      sb(context).from("movement_alerts").select("kind, message, created_at").eq("subject_id", s.id).gte("created_at", since).gte("severity", 3).order("created_at", { ascending: false }).limit(6),
      v ? sb(context).from("voyage_passengers").select("id", { count: "exact", head: true }).eq("voyage_id", v.id) : Promise.resolve({ data: null, count: null } as any),
      sb(context).from("movement_handoffs").select("id, responder_name, channel, approved_by_name, created_at, status, status_at, first_viewed_at, share_token, share_expires_at, withdrawn_at").eq("subject_id", s.id).gte("created_at", since).order("created_at", { ascending: false }),
    ]);
    const { metres } = await import("./corridor.server");
    const ranked = ((responders ?? []) as Responder[])
      .map((r) => ({ ...r, distance_m: s.last_lat != null && r.lat != null && r.lng != null ? Math.round(metres(s.last_lat, s.last_lng, r.lat, r.lng)) : null }))
      .sort((a, b) => (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity));

    const t = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" });
    const speedKn = s.last_speed_mps != null ? Math.round(s.last_speed_mps * 1.943844 * 10) / 10 : null;
    const lines = [
      `EMERGENCY — ${s.kind === "vessel" ? "BOAT" : "VEHICLE"} ${s.name}${s.reference ? ` (${s.reference})` : ""}${s.mmsi ? `, MMSI ${s.mmsi}` : ""}`,
      s.last_lat != null ? `Last position ${s.last_lat.toFixed(5)}, ${s.last_lng.toFixed(5)} at ${t(s.last_seen_at)} Lagos time${speedKn != null ? `, moving ${speedKn} kn` : ""}` : "Position unknown",
      s.last_lat != null ? `Map: https://maps.google.com/?q=${s.last_lat.toFixed(5)},${s.last_lng.toFixed(5)}` : "",
      v ? `Voyage "${v.name}", departed ${v.departed_at ? t(v.departed_at) : "?"}${v.planned_arrival ? `, due ${t(v.planned_arrival)}` : ""}` : "",
      v?.departure_count != null ? `${v.departure_count} people aboard at departure${pax?.count ? ` (${pax.count} on the passenger list)` : ""}` : "",
      (alerts ?? []).length ? `What we've seen: ${(alerts as any[]).map((a) => `${t(a.created_at)} ${a.message}`).join("; ")}` : "",
      "Requesting immediate assistance.",
    ].filter(Boolean);
    return {
      subject: { id: s.id, name: s.name, mmsi: s.mmsi, reference: s.reference, lat: s.last_lat, lng: s.last_lng, last_seen_at: s.last_seen_at, speed_kn: speedKn },
      voyage_id: v?.id ?? null,
      responders: ranked,
      draft: lines.join("\n"),
      previous: (prev ?? []) as HandoffContext["previous"],
    };
  });

export const recordHandoff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      subject_id: z.string().uuid(),
      voyage_id: z.string().uuid().nullable(),
      responder_id: z.string().uuid(),
      channel: z.enum(["call", "whatsapp", "lemtik"]),
      summary: z.string().trim().min(10).max(4000),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    await (await import("./features.server")).assertFeature(orgId, "corridors");
    const supabase = sb(context);
    const [{ data: r }, { data: s }, { data: me }] = await Promise.all([
      supabase.from("movement_responders").select("id, name, phone, whatsapp, lat, lng, responder_org_id").eq("id", data.responder_id).eq("organisation_id", orgId).maybeSingle(),
      supabase.from("movement_subjects").select("id, organisation_id, name, last_lat, last_lng").eq("id", data.subject_id).eq("organisation_id", orgId).maybeSingle(),
      supabase.from("profiles").select("display_name, phone").eq("user_id", context.userId).maybeSingle(),
    ]);
    if (!r || !s) throwSafeError("handoff.record", new Error("not found"), "Responder or boat not found.");
    const number = (data.channel === "whatsapp" ? r.whatsapp || r.phone : r.phone || r.whatsapp) as string | null;
    if (data.channel === "lemtik" && !r.responder_org_id) throwSafeError("handoff.record", new Error("not on lemtik"), `${r.name} isn't linked to an organisation on Lemtik.`);
    if (data.channel !== "lemtik" && !number) throwSafeError("handoff.record", new Error("no number"), `${r.name} has no ${data.channel === "whatsapp" ? "WhatsApp" : "phone"} number.`);
    const { metres } = await import("./corridor.server");
    const distance = s.last_lat != null && r.lat != null ? Math.round(metres(s.last_lat, s.last_lng, r.lat, r.lng)) : null;
    const who = (me?.display_name as string | undefined)?.trim() || "Operator";
    // The responder link: no account needed, valid for 24 hours, can be withdrawn.
    const { randomBytes } = await import("node:crypto");
    const shareToken = randomBytes(24).toString("base64url");
    const { getSiteUrl } = await import("./orgs.server");
    const respondUrl = `${getSiteUrl().replace(/\/$/, "")}/respond/${shareToken}`;
    const message = `${data.summary}\n\nLive position and to confirm you've received this: ${respondUrl}`;
    const { error } = await supabase.from("movement_handoffs").insert({
      organisation_id: orgId,
      voyage_id: data.voyage_id,
      subject_id: s.id,
      responder_id: r.id,
      responder_name: r.name,
      distance_m: distance,
      channel: data.channel,
      responder_org_id: r.responder_org_id ?? null,
      summary: data.summary,
      approved_by: context.userId,
      approved_by_name: who,
      share_token: shareToken,
      share_expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
      operator_phone: ((me as any)?.phone as string | null) ?? null,
    });
    if (error) throwSafeError("handoff.record", error, "Unable to record the hand-off. Only managers and operators can hand off.");
    if (r.responder_org_id) {
      const { notifyResponderOrg } = await import("./responder-board.server");
      await notifyResponderOrg(r.responder_org_id, orgId, s.name, data.summary);
    }
    const { raiseAlert } = await import("./movement.server");
    await raiseAlert(s, "handoff", 2, `${who} handed ${s.name} off to ${r.name} by ${data.channel === "whatsapp" ? "WhatsApp" : data.channel === "lemtik" ? "Lemtik" : "phone"}${distance != null ? ` (${(distance / 1000).toFixed(1)} km away)` : ""}`, s.last_lat != null ? { lat: s.last_lat, lng: s.last_lng } : null, data.voyage_id);
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "movement_handoff", resourceId: s.id, actionType: "handoff", actionDetail: { responder: r.name, channel: data.channel, voyage_id: data.voyage_id } });
    if (data.channel === "lemtik" || !number) return { url: null as string | null, respond_url: respondUrl };
    const digits = number.replace(/[^\d+]/g, "");
    const intl = digits.startsWith("+") ? digits.slice(1) : digits.startsWith("0") ? `234${digits.slice(1)}` : digits;
    return { url: data.channel === "whatsapp" ? `https://wa.me/${intl}?text=${encodeURIComponent(message)}` : `tel:${digits}`, respond_url: respondUrl };
  });

export type { BoardingProblem, Weather };
