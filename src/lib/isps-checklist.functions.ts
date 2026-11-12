import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getActiveOrgId } from "@/lib/orgs.server";
import { throwSafeError } from "@/lib/server-errors";
import { recordBlackboxAudit } from "@/lib/audit.server";
import { admin, myName, roleIn } from "@/lib/links.server";

// Checklists for each security level: the measures from the facility security plan, set up
// per guard post, and the checklists sent to each post when the level changes.

export type ChecklistItem = { text: string; done_at: string | null; done_by_name: string | null };
export type ChecklistRun = {
  id: string;
  facility_id: string;
  facility: string;
  level: number;
  post_id: string | null;
  post_name: string;
  items: ChecklistItem[];
  started_at: string;
  first_tick_at: string | null;
  completed_at: string | null;
  superseded_at: string | null;
};

async function ctx(context: { supabase: unknown; userId: string }) {
  const orgId = await getActiveOrgId(context.supabase as any, context.userId);
  const db = await admin();
  const role = await roleIn(db, context.userId, orgId);
  return { orgId, db, role };
}
const toRun = (r: any): ChecklistRun => ({
  id: r.id, facility_id: r.facility_id, facility: r.isps_facilities?.name ?? "—", level: r.level, post_id: r.post_id, post_name: r.post_name,
  items: ((r.items ?? []) as any[]).map((i) => ({ text: i.text, done_at: i.done_at ?? null, done_by_name: i.done_by_name ?? null })),
  started_at: r.started_at, first_tick_at: r.first_tick_at, completed_at: r.completed_at, superseded_at: r.superseded_at,
});

export const saveLevelMeasures = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    const measure = z.object({ text: z.string().trim().min(2).max(300), post_id: z.string().max(40).nullable() });
    return z.object({
      facility_id: z.string().uuid(),
      posts: z.array(z.object({ id: z.string().min(1).max(40), name: z.string().trim().min(1).max(80) })).max(40),
      measures: z.object({ "1": z.array(measure).max(40), "2": z.array(measure).max(40), "3": z.array(measure).max(40) }),
    }).parse(d);
  })
  .handler(async ({ data, context }) => {
    const { orgId, db, role } = await ctx(context);
    if (role !== "manager") throwSafeError("isps.measures", new Error("role"), "Only security managers can change the level measures.");
    await (await import("./features.server")).assertFeature(orgId, "isps");
    const ids = new Set(data.posts.map((p) => p.id));
    if (ids.size !== data.posts.length) throwSafeError("isps.measures", new Error("dup"), "Two posts have the same id.");
    for (const l of ["1", "2", "3"] as const) for (const m of data.measures[l]) if (m.post_id && !ids.has(m.post_id)) m.post_id = null;
    const { data: f, error } = await db.from("isps_facilities").update({ posts: data.posts, level_measures: data.measures, updated_at: new Date().toISOString() }).eq("id", data.facility_id).eq("organisation_id", orgId).select("id, name").maybeSingle();
    if (error) throwSafeError("isps.measures", error, "Unable to save the measures.");
    if (!f) throwSafeError("isps.measures", new Error("missing"), "Facility not found.");
    await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "isps_facility", resourceId: f.id, actionType: "level_measures", actionDetail: { posts: data.posts.length, l1: data.measures["1"].length, l2: data.measures["2"].length, l3: data.measures["3"].length } });
    return { ok: true };
  });

export const getLevelMeasures = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ facility_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { orgId, db } = await ctx(context);
    const { data: f } = await db.from("isps_facilities").select("id, name, posts, level_measures").eq("id", data.facility_id).eq("organisation_id", orgId).maybeSingle();
    if (!f) throwSafeError("isps.measures", new Error("missing"), "Facility not found.");
    const m = (f.level_measures ?? {}) as any;
    return { posts: (f.posts ?? []) as { id: string; name: string }[], measures: { "1": m["1"] ?? [], "2": m["2"] ?? [], "3": m["3"] ?? [] } as Record<"1" | "2" | "3", { text: string; post_id: string | null }[]> };
  });

/** Open checklists in the organisation, for anyone on duty (officers included). */
export const listOpenChecklists = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { orgId, db, role } = await ctx(context);
    if (!role) return [] as ChecklistRun[];
    const { data } = await db.from("isps_checklist_runs").select("*, isps_facilities(name)").eq("organisation_id", orgId).is("completed_at", null).is("superseded_at", null).order("started_at", { ascending: false }).limit(60);
    return ((data ?? []) as any[]).map(toRun);
  });

/** The latest checklists for each facility (open or done), for managers. */
export const listRecentChecklists = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { orgId, db } = await ctx(context);
    const { data } = await db.from("isps_checklist_runs").select("*, isps_facilities(name)").eq("organisation_id", orgId).order("started_at", { ascending: false }).limit(200);
    return ((data ?? []) as any[]).map(toRun);
  });

export const tickChecklistItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ run_id: z.string().uuid(), index: z.number().int().min(0).max(80), done: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { orgId, db, role } = await ctx(context);
    if (!role || !["manager", "supervisor", "officer"].includes(role)) throwSafeError("isps.checklist", new Error("role"), "Your role can't tick off checklists.");
    const name = await myName(db, context.userId);
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: r } = await db.from("isps_checklist_runs").select("id, items, version, first_tick_at, completed_at, superseded_at").eq("id", data.run_id).eq("organisation_id", orgId).maybeSingle();
      if (!r) throwSafeError("isps.checklist", new Error("missing"), "Checklist not found.");
      if (r.superseded_at) throwSafeError("isps.checklist", new Error("superseded"), "The security level has changed since. Use the new checklist.");
      if (r.completed_at) throwSafeError("isps.checklist", new Error("done"), "This checklist is already complete.");
      const items = [...((r.items ?? []) as any[])];
      if (!items[data.index]) throwSafeError("isps.checklist", new Error("index"), "Item not found.");
      const now = new Date().toISOString();
      items[data.index] = data.done ? { ...items[data.index], done_at: now, done_by: context.userId, done_by_name: name } : { ...items[data.index], done_at: null, done_by: null, done_by_name: null };
      const all = items.every((i) => i.done_at);
      // Compare-and-set on the version so two people ticking at once don't overwrite each other.
      const { data: upd } = await db.from("isps_checklist_runs").update({ items, version: r.version + 1, first_tick_at: r.first_tick_at ?? (data.done ? now : null), completed_at: all ? now : null }).eq("id", r.id).eq("version", r.version).is("completed_at", null).select("id");
      if (!upd?.length) continue;
      if (all) await recordBlackboxAudit({ userId: context.userId, orgId, resourceType: "isps_checklist", resourceId: r.id, actionType: "completed", actionDetail: { items: items.length } });
      return { completed: all };
    }
    throwSafeError("isps.checklist", new Error("busy"), "Someone else is updating this checklist. Try again.");
  });
