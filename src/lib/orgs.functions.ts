import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { throwSafeError } from "@/lib/server-errors";
import { getActiveOrgId } from "@/lib/orgs.server";
import { requestRelationshipApi } from "@/lib/relationship-api";

const orgType = z.enum(["estate", "corporate", "hotel", "government"]);
// Subscription tier/status are intentionally not exposed in any user-facing
// validator — billing must be updated via privileged paths only.

const appRole = z.enum(["officer", "supervisor", "manager", "client_admin", "lemtik_admin"]);

// ---------- READS ----------------------------------------------------------

export const listMyOrgs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("organisation_members")
      .select("role, organisation:organisations(id, name, type, logo_url, subscription_tier, subscription_status)")
      .eq("user_id", context.userId);
    if (error) throwSafeError("orgs.listMine", error, "Unable to load organisations.");
    return data.map((r) => ({ ...r.organisation, role: r.role }));
  });

export const getActiveOrg = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    let orgId: string;
    try {
      orgId = await getActiveOrgId(context.supabase, context.userId);
    } catch {
      return null;
    }
    const { data, error } = await context.supabase
      .from("organisations").select("*").eq("id", orgId).maybeSingle();
    if (error) throwSafeError("orgs.getActive", error, "Unable to load organisation.");
    return data;
  });

// ---------- CREATE ORG -----------------------------------------------------

export const createOrganisation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      name: z.string().min(1).max(120),
      type: orgType,
      address: z.string().max(300).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: org, error } = await context.supabase
      .from("organisations")
      .insert({ name: data.name, type: data.type, address: data.address, created_by: context.userId })
      .select().single();
    if (error) throwSafeError("orgs.create", error, "Unable to create organisation.");

    // Seat creator as client_admin
    const { error: memErr } = await context.supabase
      .from("organisation_members")
      .insert({ organisation_id: org.id, user_id: context.userId, role: "client_admin" });
    if (memErr) throwSafeError("orgs.create.member", memErr, "Organisation created but membership failed.");

    // Seed empty settings row
    await context.supabase.from("organisation_settings").insert({ organisation_id: org.id });

    // Make it active. Use upsert so users without an existing profile row
    // (e.g. OAuth users created before the auth.users trigger existed) still
    // get a profile created — otherwise the /app gate redirects them back
    // to onboarding indefinitely.
    await context.supabase
      .from("profiles")
      .upsert(
        { user_id: context.userId, active_organisation_id: org.id },
        { onConflict: "user_id" },
      );

    return org;
  });


export const switchActiveOrg = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ organisation_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // Verify membership via RLS by reading it back
    const { data: mem, error: e1 } = await context.supabase
      .from("organisation_members").select("id")
      .eq("organisation_id", data.organisation_id).eq("user_id", context.userId).maybeSingle();
    if (e1 || !mem) throw new Error("Not a member of that organisation.");
    const { error } = await context.supabase
      .from("profiles").update({ active_organisation_id: data.organisation_id }).eq("user_id", context.userId);
    if (error) throwSafeError("orgs.switch", error, "Unable to switch organisation.");
    return { ok: true };
  });

// ---------- UPDATE ORG PROFILE --------------------------------------------

export const updateOrganisation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      name: z.string().min(1).max(120).optional(),
      type: orgType.optional(),
      address: z.string().max(300).nullable().optional(),
      coord_x: z.number().nullable().optional(),
      coord_y: z.number().nullable().optional(),
      logo_url: z.string().url().max(500).nullable().optional(),
      billing_contact_name: z.string().max(120).nullable().optional(),
      billing_contact_email: z.string().email().max(200).nullable().optional(),
      billing_contact_phone: z.string().max(40).nullable().optional(),
      brand_primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
      brand_secondary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    // Subscription tier/status are intentionally NOT writable here — they
    // must be changed via a privileged billing/admin path only.
    const { error } = await context.supabase
      .from("organisations").update(data).eq("id", orgId);

    if (error) throwSafeError("orgs.update", error, "Access denied or unable to update organisation.");
    return { ok: true };
  });

// ---------- LOCATIONS ------------------------------------------------------

export const listLocations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("organisation_locations").select("*").eq("organisation_id", orgId).order("created_at");
    if (error) throwSafeError("orgs.locations.list", error, "Unable to load locations.");
    return data;
  });

export const upsertLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      name: z.string().min(1).max(120),
      address: z.string().max(300).optional(),
      coord_x: z.number().optional(),
      coord_y: z.number().optional(),
      geofence: z.any().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const payload = { ...data, organisation_id: orgId };
    const { error } = data.id
      ? await context.supabase.from("organisation_locations").update(payload).eq("id", data.id)
      : await context.supabase.from("organisation_locations").insert(payload);
    if (error) throwSafeError("orgs.locations.save", error, "Unable to save location.");
    return { ok: true };
  });

export const deleteLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("organisation_locations").delete().eq("id", data.id);
    if (error) throwSafeError("orgs.locations.delete", error, "Unable to delete location.");
    return { ok: true };
  });

// ---------- EMERGENCY CONTACTS --------------------------------------------

export const listEmergencyContacts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("organisation_emergency_contacts").select("*").eq("organisation_id", orgId).order("created_at");
    if (error) throwSafeError("orgs.emerg.list", error, "Unable to load contacts.");
    return data;
  });

export const upsertEmergencyContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      label: z.string().min(1).max(60),
      name: z.string().max(120).optional(),
      phone: z.string().min(1).max(40),
      notes: z.string().max(300).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const payload = { ...data, organisation_id: orgId };
    const { error } = data.id
      ? await context.supabase.from("organisation_emergency_contacts").update(payload).eq("id", data.id)
      : await context.supabase.from("organisation_emergency_contacts").insert(payload);
    if (error) throwSafeError("orgs.emerg.save", error, "Unable to save contact.");
    return { ok: true };
  });

export const deleteEmergencyContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("organisation_emergency_contacts").delete().eq("id", data.id);
    if (error) throwSafeError("orgs.emerg.delete", error, "Unable to delete contact.");
    return { ok: true };
  });

// ---------- SETTINGS -------------------------------------------------------

export const getSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    // Only managers/client_admins may view the webhook secret. Other members
    // get all non-sensitive settings.
    const { data: adminMem } = await context.supabase
      .from("organisation_members")
      .select("role")
      .eq("organisation_id", orgId)
      .eq("user_id", context.userId)
      .maybeSingle();
    const isAdmin = adminMem?.role === "manager" || adminMem?.role === "client_admin" || adminMem?.role === "lemtik_admin";
    const cols = isAdmin
      ? "*"
      : "organisation_id, alert_escalation_contacts, default_incident_categories, report_delivery_schedule, whatsapp_alert_numbers, webhook_url, threshold_config, smart_devices, integration_config, updated_at";
    const { data, error } = await (context.supabase as any)
      .from("organisation_settings").select(cols).eq("organisation_id", orgId).maybeSingle();
    if (error) throwSafeError("orgs.settings.get", error, "Unable to load settings.");
    return (data ?? null) as {
      organisation_id?: string;
      alert_escalation_contacts?: Array<{ name: string; phone: string; level: number }>;
      default_incident_categories?: string[];
      report_delivery_schedule?: string | null;
      whatsapp_alert_numbers?: string[];
      webhook_url?: string | null;
      webhook_secret?: string | null;
      threshold_config?: Record<string, unknown>;
      smart_devices?: Array<Record<string, unknown>>;
      integration_config?: Record<string, unknown>;
      updated_at?: string;
    } | null;
  });




export const updateSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      alert_escalation_contacts: z.array(z.object({
        name: z.string().max(120),
        phone: z.string().max(40),
        level: z.number().int().min(1).max(5),
      })).max(20).optional(),
      default_incident_categories: z.array(z.string().max(60)).max(40).optional(),
      report_delivery_schedule: z.string().max(60).nullable().optional(),
      whatsapp_alert_numbers: z.array(z.string().max(40)).max(20).optional(),
      webhook_url: z.string().url().max(500).nullable().optional(),
      webhook_secret: z.string().max(200).nullable().optional(),
      threshold_config: z.record(z.string(), z.any()).optional(),
      smart_devices: z.array(z.record(z.string(), z.any())).optional(),
      integration_config: z.record(z.string(), z.any()).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const payload: any = { organisation_id: orgId, ...data };
    const { error } = await (context.supabase as any)
      .from("organisation_settings")
      .upsert(payload, { onConflict: "organisation_id" });
    if (error) throwSafeError("orgs.settings.update", error, "Access denied or unable to update settings.");
    return { ok: true };
  });

// ---------- MEMBERS --------------------------------------------------------

export const listMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { data: members, error } = await context.supabase
      .from("organisation_members")
      .select("id, user_id, role, created_at")
      .eq("organisation_id", orgId);
    if (error) throwSafeError("orgs.members.list", error, "Unable to load members.");

    const ids = members.map((m) => m.user_id);
    if (ids.length === 0) return [];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profiles } = await context.supabase
      .from("profiles").select("user_id, display_name, zone, status, assigned_location_ids, updated_at").in("user_id", ids);
    const pMap = new Map(profiles?.map((p) => [p.user_id, p]) ?? []);
    const authPairs = await Promise.all(ids.map(async (userId) => {
      try {
        const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
        return [userId, data?.user?.email ?? null] as const;
      } catch {
        return [userId, null] as const;
      }
    }));
    const emailMap = new Map(authPairs);
    return members.map((m) => ({ ...m, email: emailMap.get(m.user_id) ?? null, profile: pMap.get(m.user_id) ?? null }));
  });

export const updateMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    member_id: z.string().uuid(),
    role: appRole,
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("organisation_members").update({ role: data.role }).eq("id", data.member_id);
    if (error) throwSafeError("orgs.members.update", error, "Access denied or unable to update member.");
    return { ok: true };
  });

export const removeMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ member_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("organisation_members").delete().eq("id", data.member_id);
    if (error) throwSafeError("orgs.members.remove", error, "Access denied or unable to remove member.");
    return { ok: true };
  });

export const findProximityMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      coord_x: z.number(),
      coord_y: z.number(),
      incident_id: z.string().uuid().optional(),
      org_id: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(20).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = data.org_id ?? await getActiveOrgId(context.supabase, context.userId);
    const result = await requestRelationshipApi<Array<{
      id: string;
      user_id: string;
      name: string;
      role: string;
      zone: string;
      status: string;
      coordinates: [number, number];
      distance: number;
      source: string;
    }>>("/api/v1/proximity/find", {
      body: {
        org_id: orgId,
        incident_id: data.incident_id ?? null,
        coord_x: data.coord_x,
        coord_y: data.coord_y,
        limit: data.limit ?? 10,
        source: "c4isod-dashboard",
      },
    });
    return result ?? [];
  });
