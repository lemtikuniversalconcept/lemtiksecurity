import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getActiveOrgId } from "@/lib/orgs.server";
import { throwSafeError } from "@/lib/server-errors";
import { recordBlackboxAudit } from "@/lib/audit.server";
import type { DriftSnapshot, ObjectType, SearchPattern } from "./sar.server";

const sb = (c: { supabase: unknown }) => c.supabase as any;
const OBJECT = z.enum(["person_in_water", "person_with_lifejacket", "life_raft", "small_boat", "disabled_powerboat", "canoe"]);

export type SarCase = {
  id: string;
  subject_id: string | null;
  voyage_id: string | null;
  alert_id: string | null;
  title: string;
  status: "active" | "found" | "stood_down";
  object_type: ObjectType;
  persons: number | null;
  lkp_lat: number;
  lkp_lng: number;
  lkp_at: string;
  lkp_error_m: number;
  current_kn: number | null;
  current_toward_deg: number | null;
  notes: string | null;
  outcome: string | null;
  created_by_name: string | null;
  created_at: string;
  closed_at: string | null;
};
const COLS = "id, subject_id, voyage_id, alert_id, title, status, object_type, persons, lkp_lat, lkp_lng, lkp_at, lkp_error_m, current_kn, current_toward_deg, notes, outcome, created_by_name, created_at, closed_at";

export const listSarCases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { data, error } = await sb(context).from("sar_cases").select(COLS).eq("organisation_id", orgId).order("created_at", { ascending: false }).limit(50);
    if (error) throwSafeError("sar.list", error, "Unable to load search and rescue plans.");
    return (data ?? []).map((c: any) => ({ ...c, current_kn: c.current_kn == null ? null : Number(c.current_kn) })) as SarCase[];
  });

/** Starts a plan from an alert (man overboard, SOS…) or a tracked boat's last position. */
export const createSarCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      alert_id: z.string().uuid().optional(),
      subject_id: z.string().uuid().optional(),
      object_type: OBJECT.optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    await (await import("./features.server")).assertFeature(orgId, "sar");
    const supabase = sb(context);
    let lat: number | null = null;
    let lng: number | null = null;
    let at: string | null = null;
    let subjectId = data.subject_id ?? null;
    let voyageId: string | null = null;
    let kind: string | null = null;
    if (data.alert_id) {
      const { data: a } = await supabase.from("movement_alerts").select("subject_id, voyage_id, kind, lat, lng, created_at").eq("id", data.alert_id).eq("organisation_id", orgId).maybeSingle();
      if (!a) throwSafeError("sar.create", new Error("alert"), "Alert not found.");
      ({ lat, lng } = a);
      at = a.created_at;
      subjectId = a.subject_id;
      voyageId = a.voyage_id;
      kind = a.kind;
    }
    const { data: s } = subjectId ? await supabase.from("movement_subjects").select("id, name, kind, last_lat, last_lng, last_seen_at").eq("id", subjectId).eq("organisation_id", orgId).maybeSingle() : { data: null };
    if (lat == null && s?.last_lat != null) {
      lat = s.last_lat;
      lng = s.last_lng;
      at = s.last_seen_at;
    }
    if (lat == null || lng == null || !at) throwSafeError("sar.create", new Error("no position"), "There's no known position to start from. A plan needs at least one position fix.");
    if (!voyageId && s) {
      const { data: v } = await supabase.from("movement_voyages").select("id").eq("subject_id", s.id).eq("status", "underway").maybeSingle();
      voyageId = v?.id ?? null;
    }
    let persons: number | null = null;
    if (voyageId) {
      const { data: v } = await supabase.from("movement_voyages").select("departure_count").eq("id", voyageId).maybeSingle();
      persons = v?.departure_count ?? null;
    }
    const objectType = data.object_type ?? (kind === "man_overboard" ? "person_in_water" : s?.kind === "vessel" ? "small_boat" : "person_in_water");
    if (objectType === "person_in_water" || objectType === "person_with_lifejacket") persons = 1;
    const { data: me } = await supabase.from("profiles").select("display_name").eq("user_id", context.userId).maybeSingle();
    const title = `${kind === "man_overboard" ? "Man overboard" : kind === "sos" ? "SOS" : "Missing"} — ${s?.name ?? "unknown"}`;
    const { data: row, error } = await supabase
      .from("sar_cases")
      .insert({
        organisation_id: orgId,
        subject_id: s?.id ?? null,
        voyage_id: voyageId,
        alert_id: data.alert_id ?? null,
        title,
        object_type: objectType,
        persons,
        lkp_lat: lat,
        lkp_lng: lng,
        lkp_at: at,
        lkp_error_m: 100,
        created_by: context.userId,
        created_by_name: (me?.display_name as string | undefined)?.trim() || "Operator",
      })
      .select("id")
      .single();
    if (error) throwSafeError("sar.create", error, "Unable to start a search plan. Only managers and operators can.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "sar_case", resourceId: row.id, actionType: "create", actionDetail: { title, alert_id: data.alert_id ?? null } });
    return { id: row.id as string };
  });

export const updateSarCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      object_type: OBJECT,
      persons: z.number().int().min(0).max(5000).nullable(),
      lkp_lat: z.number().min(-90).max(90),
      lkp_lng: z.number().min(-180).max(180),
      lkp_at: z.string().datetime({ offset: true }),
      lkp_error_m: z.number().int().min(5).max(20000),
      current_kn: z.number().min(0).max(8).nullable(),
      current_toward_deg: z.number().int().min(0).max(359).nullable(),
      notes: z.string().trim().max(2000).nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    if (Date.parse(data.lkp_at) > Date.now() + 60_000) throwSafeError("sar.update", new Error("future"), "The last known time can't be in the future.");
    const { id, ...row } = data;
    const { error } = await sb(context).from("sar_cases").update(row).eq("id", id).eq("organisation_id", orgId).eq("status", "active");
    if (error) throwSafeError("sar.update", error, "Unable to update the plan.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "sar_case", resourceId: id, actionType: "update", actionDetail: { object_type: data.object_type, current_kn: data.current_kn, lkp_error_m: data.lkp_error_m } });
    return { ok: true };
  });

export const closeSarCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), status: z.enum(["found", "stood_down"]), outcome: z.string().trim().min(3).max(2000) }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { error } = await sb(context).from("sar_cases").update({ status: data.status, outcome: data.outcome, closed_at: new Date().toISOString() }).eq("id", data.id).eq("organisation_id", orgId).eq("status", "active");
    if (error) throwSafeError("sar.close", error, "Unable to close the plan.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "sar_case", resourceId: data.id, actionType: data.status, actionDetail: { outcome: data.outcome } });
    return { ok: true };
  });

export type SarPlan = {
  case: SarCase;
  organisation: string;
  subject: { name: string; mmsi: string | null; reference: string | null } | null;
  snapshots: (DriftSnapshot & { label: string })[];
  focus: number; // index of the snapshot the pattern is for
  pattern: SearchPattern;
  object: { label: string; sweepNm: number };
  wind: { hours: number; nowKn: number | null; nowFromDeg: number | null } ;
  generated_at: string;
};

export const getSarPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), focus_hours: z.number().min(0).max(48).default(0), spacing_nm: z.number().min(0.05).max(10).nullable().default(null) }).parse(d))
  .handler(async ({ data, context }): Promise<SarPlan> => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const supabase = sb(context);
    const { data: c } = await supabase.from("sar_cases").select(COLS).eq("id", data.id).eq("organisation_id", orgId).maybeSingle();
    if (!c) throwSafeError("sar.plan", new Error("not found"), "Search plan not found.");
    const sc = { ...c, current_kn: c.current_kn == null ? null : Number(c.current_kn) } as SarCase;
    const [{ data: s }, { data: org }] = await Promise.all([
      sc.subject_id ? supabase.from("movement_subjects").select("name, mmsi, reference").eq("id", sc.subject_id).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from("organisations").select("name").eq("id", orgId).maybeSingle(),
    ]);
    const { LEEWAY, searchPattern, simulateDrift, windSeries } = await import("./sar.server");
    const lkpAt = Date.parse(sc.lkp_at);
    const end = sc.closed_at ? Date.parse(sc.closed_at) : Date.now();
    const wind = await windSeries(sc.lkp_lat, sc.lkp_lng);
    const marks: { at: number; label: string }[] = [{ at: lkpAt, label: "Last known" }];
    if (end - lkpAt > 60_000) marks.push({ at: end, label: sc.closed_at ? "Closed" : "Now" });
    if (!sc.closed_at) for (const h of [1, 3, 6, 12]) marks.push({ at: end + h * 3_600_000, label: `+${h} h` });
    const snaps = simulateDrift({
      seed: parseInt(sc.id.replace(/-/g, "").slice(0, 8), 16),
      objectType: sc.object_type,
      lkp: { lat: sc.lkp_lat, lng: sc.lkp_lng, at: lkpAt, errorM: sc.lkp_error_m },
      current: sc.current_kn != null && sc.current_toward_deg != null ? { kn: sc.current_kn, towardDeg: sc.current_toward_deg } : null,
      wind,
      times: marks.map((m) => m.at),
    }).map((s, i) => ({ ...s, label: marks[i].label }));
    const target = end + data.focus_hours * 3_600_000;
    let focus = snaps.findIndex((s) => s.at >= target - 60_000);
    if (focus < 0) focus = snaps.length - 1;
    const L = LEEWAY[sc.object_type];
    const pattern = searchPattern(snaps[focus], data.spacing_nm ?? L.sweepNm);
    const nowW = wind.find((w) => w.at >= Date.now() - 3_600_000);
    return {
      case: sc,
      organisation: org?.name ?? "",
      subject: s ?? null,
      snapshots: snaps,
      focus,
      pattern,
      object: { label: L.label, sweepNm: L.sweepNm },
      wind: {
        hours: wind.length,
        nowKn: nowW ? Math.round(Math.hypot(nowW.u, nowW.v) * 1.943844) : null,
        nowFromDeg: nowW ? Math.round((((Math.atan2(nowW.u, nowW.v) * 180) / Math.PI + 180) % 360 + 360) % 360) : null,
      },
      generated_at: new Date().toISOString(),
    };
  });
