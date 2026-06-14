import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { throwSafeError } from "@/lib/server-errors";
import { getActiveOrgId } from "@/lib/orgs.server";

const evidenceItem = z.object({
  path: z.string().min(1).max(500),
  kind: z.enum(["image", "video", "audio", "document"]),
  size: z.number().int().min(0).max(60_000_000),
  name: z.string().min(1).max(200),
});

const incidentInput = z.object({
  type: z.enum([
    "intrusion", "theft", "robbery", "armed_attack", "kidnapping",
    "medical", "fire", "suspicious", "civil_unrest", "vandalism",
    "fraud_scam", "cyber_incident", "other",
  ]),
  severity: z.number().int().min(1).max(5),
  title: z.string().max(100).optional(),
  location: z.string().min(1).max(200),
  zone: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  officer: z.string().max(120).optional(),
  coord_x: z.number().optional(),
  coord_y: z.number().optional(),
  location_id: z.string().uuid().nullable().optional(),
  occurred_at: z.string().datetime().optional(),
  suspect_count: z.number().int().min(0).max(999).optional(),
  suspect_description: z.string().max(500).optional(),
  victim_name: z.string().max(120).optional(),
  victim_contact: z.string().max(120).optional(),
  witnesses: z.string().max(500).optional(),
  linked_incident_id: z.string().uuid().nullable().optional(),
  client_visible: z.boolean().optional(),
  quick_report: z.boolean().optional(),
  evidence: z.array(evidenceItem).max(15).optional(),
});


export const listIncidents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("incidents").select("*")
      .eq("organisation_id", orgId)
      .order("reported_at", { ascending: false });
    if (error) throwSafeError("incidents.list", error, "Unable to load incidents.");
    return data;
  });

export const createIncident = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => incidentInput.parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { error, data: row } = await context.supabase
      .from("incidents")
      .insert({ ...data, reported_by: context.userId, organisation_id: orgId })
      .select().single();
    if (error) throwSafeError("incidents.create", error, "Unable to create incident.");
    return row;
  });

export const updateIncidentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["reported", "acknowledged", "responding", "contained", "resolved", "escalated", "closed"]),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("incidents").update({ status: data.status }).eq("id", data.id);
    if (error) throwSafeError("incidents.updateStatus", error, "Access denied or unable to update incident.");
    return { ok: true };
  });

export const assignIncidentToMe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: profile } = await context.supabase
      .from("profiles").select("display_name").eq("user_id", context.userId).maybeSingle();
    const name = profile?.display_name?.trim() || "Operator";
    const { error } = await context.supabase
      .from("incidents")
      .update({ officer: name, status: "responding" })
      .eq("id", data.id);
    if (error) throwSafeError("incidents.assign", error, "Access denied or unable to assign incident.");
    return { ok: true, officer: name };
  });
