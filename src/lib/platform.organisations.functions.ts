import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recordBlackboxAudit } from "@/lib/audit.server";
import { buildWelcomeEmail, sendResendEmail } from "@/lib/email.service";
import { throwSafeError } from "@/lib/server-errors";
import { getSiteUrl } from "@/lib/orgs.server";

const orgType = z.enum(["estate", "corporate", "hotel", "government"]);
const subscriptionTier = z.enum(["basic", "professional", "enterprise", "government"]);
const subscriptionStatus = z.enum(["trial", "active", "past_due", "suspended"]);

const tierWeight: Record<string, number> = {
  basic: 150_000,
  professional: 350_000,
  enterprise: 750_000,
  government: 1_000_000,
};

async function assertPlatformAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "lemtik_admin")
    .maybeSingle();
  if (error) throwSafeError("platform.admin.check", error, "Unable to verify platform admin access.");
  if (!data) throw new Error("Access denied.");
}

function formatMoney(amount: number) {
  return `₦${amount.toLocaleString("en-NG")}`;
}

async function sendWelcomeEmail(input: {
  email: string;
  organisationName: string;
  adminName?: string | null;
  inviteUrl: string;
}) {
  const email = buildWelcomeEmail({
    organisationName: input.organisationName,
    adminName: input.adminName ?? null,
    inviteUrl: input.inviteUrl,
  });
  const delivery = await sendResendEmail({
    to: input.email,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });

  if (!delivery.ok) {
    return delivery.skipped ? null : delivery.error ?? "Unable to deliver welcome email.";
  }

  return null;
}

export const listPlatformOrganisations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context.supabase, context.userId);

    const [orgsRes, membersRes, incidentsRes] = await Promise.all([
      context.supabase
        .from("organisations")
        .select("id, name, type, subscription_tier, subscription_status, created_at, updated_at, address, billing_contact_email, billing_contact_name, billing_contact_phone")
        .order("created_at", { ascending: false }),
      context.supabase
        .from("organisation_members")
        .select("organisation_id")
        .order("created_at", { ascending: false }),
      context.supabase
        .from("incidents")
        .select("organisation_id")
        .gte("reported_at", new Date(Date.now() - 30 * 24 * 3600_000).toISOString()),
    ]);

    if (orgsRes.error) throwSafeError("platform.orgs.list", orgsRes.error, "Unable to load organisations.");
    if (membersRes.error) throwSafeError("platform.orgs.members", membersRes.error, "Unable to load organisation users.");
    if (incidentsRes.error) throwSafeError("platform.orgs.incidents", incidentsRes.error, "Unable to load organisation incidents.");

    const memberCounts = membersRes.data?.reduce<Record<string, number>>((acc, row: any) => {
      acc[row.organisation_id] = (acc[row.organisation_id] ?? 0) + 1;
      return acc;
    }, {}) ?? {};
    const incidentCounts = incidentsRes.data?.reduce<Record<string, number>>((acc, row: any) => {
      acc[row.organisation_id] = (acc[row.organisation_id] ?? 0) + 1;
      return acc;
    }, {}) ?? {};

    const organisations = (orgsRes.data ?? []).map((org: any) => ({
      ...org,
      users: memberCounts[org.id] ?? 0,
      incidents30d: incidentCounts[org.id] ?? 0,
      mrr: formatMoney(tierWeight[String(org.subscription_tier)] ?? 0),
    }));

    return { organisations };
  });

export const getPlatformOrganisation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ organisation_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context.supabase, context.userId);

    const [orgRes, membersRes, locationsRes, incidentsRes, auditRes, invitesRes, eventsRes] = await Promise.all([
      context.supabase.from("organisations").select("*").eq("id", data.organisation_id).maybeSingle(),
      context.supabase
        .from("organisation_members")
        .select("id, user_id, role, created_at, profile:profiles(user_id, display_name, phone, employee_id, photo_url, status, is_active, last_seen_at, assigned_location_ids)")
        .eq("organisation_id", data.organisation_id)
        .order("created_at", { ascending: false }),
      context.supabase.from("organisation_locations").select("*").eq("organisation_id", data.organisation_id).order("created_at", { ascending: false }),
      context.supabase
        .from("incidents")
        .select("id, code, type, severity, status, location, zone, reported_at, created_at")
        .eq("organisation_id", data.organisation_id)
        .order("reported_at", { ascending: false })
        .limit(25),
      context.supabase
        .from("audit_log")
        .select("id, action, entity, entity_id, details, created_at, actor_id")
        .eq("organisation_id", data.organisation_id)
        .order("created_at", { ascending: false })
        .limit(40),
      context.supabase
        .from("user_invites")
        .select("id, email, role, status, assigned_location_ids, created_at, expires_at, accepted_at")
        .eq("organisation_id", data.organisation_id)
        .order("created_at", { ascending: false })
        .limit(20),
      context.supabase
        .from("platform_events")
        .select("id, event_type, summary, metadata, created_at")
        .eq("organisation_id", data.organisation_id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    if (orgRes.error) throwSafeError("platform.org.detail", orgRes.error, "Unable to load organisation.");
    if (membersRes.error) throwSafeError("platform.org.members", membersRes.error, "Unable to load members.");
    if (locationsRes.error) throwSafeError("platform.org.locations", locationsRes.error, "Unable to load locations.");
    if (incidentsRes.error) throwSafeError("platform.org.incidents", incidentsRes.error, "Unable to load incidents.");
    if (auditRes.error) throwSafeError("platform.org.audit", auditRes.error, "Unable to load audit history.");
    if (invitesRes.error) throwSafeError("platform.org.invites", invitesRes.error, "Unable to load invite history.");
    if (eventsRes.error) throwSafeError("platform.org.events", eventsRes.error, "Unable to load activity history.");

    const org = orgRes.data;
    if (!org) throw new Error("Organisation not found.");

    const incidents = incidentsRes.data ?? [];
    const members = membersRes.data ?? [];
    const locations = locationsRes.data ?? [];
    const invites = invitesRes.data ?? [];
    const audit = auditRes.data ?? [];
    const events = eventsRes.data ?? [];
    const currentValue = tierWeight[String(org.subscription_tier)] ?? 0;

    const combinedActivity = [
      ...events.map((row: any) => ({
        id: row.id,
        kind: "platform_event",
        label: row.summary,
        detail: row.event_type,
        created_at: row.created_at,
      })),
      ...audit.map((row: any) => ({
        id: row.id,
        kind: "audit",
        label: row.action,
        detail: row.entity,
        created_at: row.created_at,
      })),
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return {
      org,
      members,
      locations,
      incidents,
      invites,
      audit,
      activity: combinedActivity,
      metrics: {
        users: members.length,
        locations: locations.length,
        incidents30d: incidents.length,
        inviteCount: invites.length,
        mrr: formatMoney(currentValue),
      },
    };
  });

export const createPlatformOrganisation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      name: z.string().min(1).max(120),
      type: orgType,
      address: z.string().max(300).optional(),
      billing_contact_name: z.string().max(120).optional(),
      billing_contact_email: z.string().email().optional(),
      billing_contact_phone: z.string().max(40).optional(),
      subscription_tier: subscriptionTier,
      subscription_status: subscriptionStatus.optional(),
      admin_email: z.string().email(),
      admin_name: z.string().max(120).optional(),
      location_name: z.string().min(1).max(120),
      location_address: z.string().max(300).optional(),
      coord_x: z.number().optional(),
      coord_y: z.number().optional(),
      geofence: z.any().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context.supabase, context.userId);

    const { data: me } = await context.supabase
      .from("profiles")
      .select("display_name")
      .eq("user_id", context.userId)
      .maybeSingle();

    const { data: org, error: orgErr } = await context.supabase
      .from("organisations")
      .insert({
        name: data.name,
        type: data.type,
        address: data.address ?? null,
        billing_contact_name: data.billing_contact_name ?? null,
        billing_contact_email: data.billing_contact_email ?? null,
        billing_contact_phone: data.billing_contact_phone ?? null,
        subscription_tier: data.subscription_tier,
        subscription_status: data.subscription_status ?? "active",
        created_by: context.userId,
      })
      .select()
      .single();
    if (orgErr) throwSafeError("platform.org.create", orgErr, "Unable to create organisation.");

    const { data: location, error: locationErr } = await context.supabase
      .from("organisation_locations")
      .insert({
        organisation_id: org.id,
        name: data.location_name,
        address: data.location_address ?? null,
        coord_x: data.coord_x ?? null,
        coord_y: data.coord_y ?? null,
        geofence: data.geofence ?? null,
      })
      .select()
      .single();
    if (locationErr) throwSafeError("platform.org.location", locationErr, "Organisation created but location setup failed.");

    const { data: invite, error: inviteErr } = await context.supabase
      .from("user_invites")
      .insert({
        organisation_id: org.id,
        email: data.admin_email.toLowerCase().trim(),
        role: "client_admin",
        assigned_location_ids: location ? [location.id] : [],
        invited_by: context.userId,
        invited_by_name: me?.display_name ?? null,
      })
      .select()
      .single();
    if (inviteErr) throwSafeError("platform.org.invite", inviteErr, "Organisation created but the admin invite failed.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const siteUrl = getSiteUrl();
    const redirectTo = `${siteUrl}/onboarding?invite=${invite.token}`;
    const { error: emailErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(invite.email, {
      data: {
        invite_token: invite.token,
        organisation_id: org.id,
        organisation_name: org.name,
        invited_role: "client_admin",
        invited_by: me?.display_name ?? null,
      },
      redirectTo,
    });
    const deliveryWarning = await sendWelcomeEmail({
      email: invite.email,
      organisationName: org.name,
      adminName: data.admin_name ?? me?.display_name ?? null,
      inviteUrl: redirectTo,
    });

    await recordBlackboxAudit({
      orgId: org.id,
      userId: context.userId,
      actionType: "organisation.created",
      resourceType: "organisation",
      resourceId: org.id,
      actionDetail: { name: org.name, tier: org.subscription_tier } as any,
    });

    return { ok: true, org, location, invite, delivery_warning: emailErr?.message ?? deliveryWarning };
  });

export const updatePlatformOrganisation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      organisation_id: z.string().uuid(),
      name: z.string().min(1).max(120).optional(),
      type: orgType.optional(),
      address: z.string().max(300).nullable().optional(),
      billing_contact_name: z.string().max(120).nullable().optional(),
      billing_contact_email: z.string().email().nullable().optional(),
      billing_contact_phone: z.string().max(40).nullable().optional(),
      subscription_tier: subscriptionTier.optional(),
      subscription_status: subscriptionStatus.optional(),
      logo_url: z.string().url().max(500).nullable().optional(),
      coord_x: z.number().nullable().optional(),
      coord_y: z.number().nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("organisations")
      .update({
        name: data.name,
        type: data.type,
        address: data.address,
        billing_contact_name: data.billing_contact_name,
        billing_contact_email: data.billing_contact_email,
        billing_contact_phone: data.billing_contact_phone,
        subscription_tier: data.subscription_tier,
        subscription_status: data.subscription_status,
        logo_url: data.logo_url,
        coord_x: data.coord_x,
        coord_y: data.coord_y,
      })
      .eq("id", data.organisation_id);
    if (error) throwSafeError("platform.org.update", error, "Unable to update organisation.");
    return { ok: true };
  });

export const setPlatformOrganisationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    organisation_id: z.string().uuid(),
    subscription_status: subscriptionStatus,
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("organisations")
      .update({ subscription_status: data.subscription_status })
      .eq("id", data.organisation_id);
    if (error) throwSafeError("platform.org.status", error, "Unable to update subscription status.");
    return { ok: true };
  });

export const deletePlatformOrganisation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ organisation_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("organisations")
      .delete()
      .eq("id", data.organisation_id);
    if (error) throwSafeError("platform.org.delete", error, "Unable to delete organisation.");
    return { ok: true };
  });
