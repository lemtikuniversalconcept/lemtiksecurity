import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recordBlackboxAudit } from "@/lib/audit.server";
import { buildUserInvitationEmail, sendResendEmail } from "@/lib/email.service";
import { throwSafeError } from "@/lib/server-errors";
import { getActiveOrgId } from "@/lib/orgs.server";

const appRole = z.enum(["officer", "supervisor", "manager", "client_admin"]);

async function assertAdmin(supabase: any, userId: string, orgId: string) {
  const { data } = await supabase
    .from("organisation_members").select("role")
    .eq("organisation_id", orgId).eq("user_id", userId).maybeSingle();
  if (!data || !["manager", "client_admin", "lemtik_admin"].includes(data.role))
    throw new Error("Access denied. Admin role required.");
}

function defaultInvitePassword(email: string) {
  const local = email.split("@")[0] ?? "user";
  const safeLocal = local.replace(/[^a-zA-Z0-9]/g, "").toUpperCase() || "USER";
  return `LEM-2026-${safeLocal}`;
}

async function findAuthUserByEmail(email: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const target = email.toLowerCase().trim();
  for (let page = 1; page <= 5; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throwSafeError("users.lookupAuthUser", error, "Unable to provision account.");
    const users = data?.users ?? [];
    const match = users.find((user: any) => (user.email ?? "").toLowerCase() === target);
    if (match) return match;
    if (users.length < 1000) break;
  }
  return null;
}

async function provisionAuthUserForInvite(input: {
  email: string;
  password?: string | null;
  orgId: string;
  role: string;
  invitedByName?: string | null;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const email = input.email.toLowerCase().trim();
  const password = (input.password?.trim() || defaultInvitePassword(email)).slice(0, 128);
  const existing = await findAuthUserByEmail(email);

  if (existing) {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: {
        invited_role: input.role,
        organisation_id: input.orgId,
        invited_by: input.invitedByName ?? null,
      },
    });
    if (error) throwSafeError("users.provisionExisting", error, "Unable to provision login.");
    return { userId: existing.id, password };
  }

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      invited_role: input.role,
      organisation_id: input.orgId,
      invited_by: input.invitedByName ?? null,
    },
  });
  if (error || !data.user) throwSafeError("users.createAuth", error ?? new Error("Unable to create auth user."), "Unable to provision login.");
  return { userId: data.user.id, password };
}

async function sendInvitationEmail(input: {
  email: string;
  organisationName: string;
  role: string;
  invitedBy?: string | null;
  inviteUrl?: string | null;
}) {
  const email = buildUserInvitationEmail({
    organisationName: input.organisationName,
    invitedRole: input.role,
    invitedBy: input.invitedBy ?? null,
    inviteUrl: input.inviteUrl,
  });
  const delivery = await sendResendEmail({
    to: input.email,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });

  if (!delivery.ok) {
    return delivery.skipped ? null : delivery.error ?? "Unable to deliver invitation email.";
  }

  return null;
}

// ---- Update self profile (extended fields) ---------------------------------

export const updateMyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    display_name: z.string().min(1).max(120).optional(),
    phone: z.string().max(40).nullable().optional(),
    employee_id: z.string().max(60).nullable().optional(),
    photo_url: z.string().url().max(500).nullable().optional(),
    zone: z.string().max(80).nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles").update(data).eq("user_id", context.userId);
    if (error) throwSafeError("users.updateSelf", error, "Unable to update profile.");
    return { ok: true };
  });

export const heartbeat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await context.supabase.from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("user_id", context.userId);
    return { ok: true };
  });

// ---- Member detail + activity ---------------------------------------------

export const getMemberDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ user_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: mem } = await context.supabase
      .from("organisation_members").select("id, role, created_at")
      .eq("organisation_id", orgId).eq("user_id", data.user_id).maybeSingle();
    if (!mem) throw new Error("User is not a member of this organisation.");
    const { data: prof } = await context.supabase
      .from("profiles").select("*").eq("user_id", data.user_id).maybeSingle();
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(data.user_id);
    return { membership: mem, profile: prof, email: authUser?.user?.email ?? null };
  });

export const getMemberActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ user_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);

    const [incidentsRes, checkinsRes, auditRes, notesRes] = await Promise.all([
      context.supabase
        .from("incidents")
        .select("id, code, type, severity, status, location, reported_at, occurred_at, reported_by")
        .eq("organisation_id", orgId)
        .eq("reported_by", data.user_id)
        .order("reported_at", { ascending: false }).limit(50),
      context.supabase
        .from("patrol_check_ins")
        .select("id, patrol_id, waypoint_id, status, minutes_late, created_at")
        .eq("organisation_id", orgId)
        .eq("officer_id", data.user_id)
        .order("created_at", { ascending: false }).limit(50),
      context.supabase
        .from("audit_log")
        .select("id, action, entity, entity_id, details, created_at")
        .eq("organisation_id", orgId)
        .eq("actor_id", data.user_id)
        .order("created_at", { ascending: false }).limit(100),
      context.supabase
        .from("incident_notes")
        .select("id, incident_id, body, created_at")
        .eq("organisation_id", orgId)
        .eq("author_id", data.user_id)
        .order("created_at", { ascending: false }).limit(50),
    ]);

    return {
      incidents: incidentsRes.data ?? [],
      checkins: checkinsRes.data ?? [],
      audit: auditRes.data ?? [],
      notes: notesRes.data ?? [],
      counts: {
        incidents: incidentsRes.data?.length ?? 0,
        checkins: checkinsRes.data?.length ?? 0,
        notes: notesRes.data?.length ?? 0,
      },
    };
  });

// ---- Activate / deactivate ------------------------------------------------

export const setUserActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    user_id: z.string().uuid(),
    is_active: z.boolean(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    await assertAdmin(context.supabase, context.userId, orgId);
    const { error } = await context.supabase
      .from("profiles").update({ is_active: data.is_active }).eq("user_id", data.user_id);
    if (error) throwSafeError("users.setActive", error, "Unable to update active state.");
    await recordBlackboxAudit({
      orgId,
      userId: context.userId,
      actionType: data.is_active ? "user.reactivated" : "user.deactivated",
      resourceType: "user",
      resourceId: data.user_id,
      actionDetail: { user_id: data.user_id, is_active: data.is_active } as any,
    });
    return { ok: true };
  });

// ---- Invites --------------------------------------------------------------

export const listInvites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("user_invites").select("*")
      .eq("organisation_id", orgId)
      .order("created_at", { ascending: false });
    if (error) throwSafeError("invites.list", error, "Unable to load invites.");
    return data;
  });

export const createInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    email: z.string().email().max(200),
    role: appRole,
    assigned_location_ids: z.array(z.string().uuid()).max(50).optional(),
    password: z.string().min(8).max(128).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    await assertAdmin(context.supabase, context.userId, orgId);

    // Inviter name for the email body
    const { data: meProf } = await context.supabase
      .from("profiles").select("display_name").eq("user_id", context.userId).maybeSingle();
    const { data: org } = await context.supabase
      .from("organisations").select("name").eq("id", orgId).maybeSingle();

    const provisioned = await provisionAuthUserForInvite({
      email: data.email,
      password: data.password,
      orgId,
      role: data.role,
      invitedByName: meProf?.display_name ?? null,
    });

    // Insert invite record (RLS scoped to admin)
    const { data: invite, error } = await context.supabase
      .from("user_invites").insert({
        organisation_id: orgId,
        email: data.email.toLowerCase().trim(),
        role: data.role,
        assigned_location_ids: data.assigned_location_ids ?? [],
        invited_by: context.userId,
        invited_by_name: meProf?.display_name ?? null,
      }).select().single();
    if (error) throwSafeError("invites.create", error, "Unable to create invite.");

    const deliveryWarning = await sendInvitationEmail({
      email: invite.email,
      organisationName: org?.name ?? "your team",
      role: data.role,
      invitedBy: meProf?.display_name ?? null,
      inviteUrl: null,
    });

    await context.supabase.from("profiles").upsert(
      {
        user_id: provisioned.userId,
        active_organisation_id: orgId,
        assigned_location_ids: data.assigned_location_ids ?? [],
      },
      { onConflict: "user_id" },
    );

    await recordBlackboxAudit({
      orgId,
      userId: context.userId,
      actionType: "invite.sent",
      resourceType: "invite",
      resourceId: invite.id,
      actionDetail: { email: invite.email, role: data.role } as any,
    });

    return { ok: true, invite, delivery_warning: deliveryWarning, login_provisioned: true };
  });

export const resendInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ invite_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    await assertAdmin(context.supabase, context.userId, orgId);
    const { data: invite, error: e0 } = await context.supabase
      .from("user_invites").select("*").eq("id", data.invite_id).maybeSingle();
    if (e0 || !invite) throw new Error("Invite not found.");
    // Refresh expiry
    await context.supabase.from("user_invites")
      .update({ expires_at: new Date(Date.now() + 48 * 3600 * 1000).toISOString(), status: "pending" })
      .eq("id", invite.id);

    const { data: meProf } = await context.supabase
      .from("profiles").select("display_name").eq("user_id", context.userId).maybeSingle();
    const { data: org } = await context.supabase
      .from("organisations").select("name").eq("id", orgId).maybeSingle();
    await provisionAuthUserForInvite({
      email: invite.email,
      orgId,
      role: invite.role,
      invitedByName: meProf?.display_name ?? null,
    });
    const deliveryWarning = await sendInvitationEmail({
      email: invite.email,
      organisationName: org?.name ?? "your team",
      role: invite.role,
      invitedBy: meProf?.display_name ?? null,
      inviteUrl: null,
    });
    return { ok: true, delivery_warning: deliveryWarning };
  });

export const cancelInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ invite_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    await assertAdmin(context.supabase, context.userId, orgId);
    const { error } = await context.supabase
      .from("user_invites").update({ status: "cancelled" }).eq("id", data.invite_id);
    if (error) throwSafeError("invites.cancel", error, "Unable to cancel invite.");
    return { ok: true };
  });

export const bulkInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    rows: z.array(z.object({
      email: z.string().email().max(200),
      role: appRole.optional(),
      password: z.string().min(8).max(128).optional(),
    })).min(1).max(200),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    await assertAdmin(context.supabase, context.userId, orgId);

    const results: Array<{ email: string; ok: boolean; error?: string }> = [];
    const { data: meProf } = await context.supabase
      .from("profiles").select("display_name").eq("user_id", context.userId).maybeSingle();
    const { data: org } = await context.supabase
      .from("organisations").select("name").eq("id", orgId).maybeSingle();

    for (const row of data.rows) {
      const email = row.email.toLowerCase().trim();
      try {
        await provisionAuthUserForInvite({
          email,
          password: row.password,
          orgId,
          role: row.role ?? "officer",
          invitedByName: meProf?.display_name ?? null,
        });
        const { data: invite, error } = await context.supabase
          .from("user_invites").insert({
            organisation_id: orgId,
            email, role: row.role ?? "officer",
            invited_by: context.userId,
          }).select().single();
        if (error) throw error;
        const deliveryWarning = await sendInvitationEmail({
          email,
          organisationName: org?.name ?? "your team",
          role: invite.role,
          invitedBy: meProf?.display_name ?? null,
          inviteUrl: null,
        });
        results.push({ email, ok: true, error: deliveryWarning ?? undefined });
      } catch (e: any) {
        results.push({ email, ok: false, error: e?.message ?? "Failed" });
      }
    }
    return { results };
  });

// ---- Redeem invites for the current user (by email) -----------------------

export const redeemMyInvites = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(context.userId);
    const email = (u?.user?.email ?? "").toLowerCase();
    if (!email) return { redeemed: 0, active_org_id: null as string | null };

    const nowIso = new Date().toISOString();
    const { data: invites } = await supabaseAdmin
      .from("user_invites")
      .select("*")
      .eq("status", "pending")
      .ilike("email", email)
      .gt("expires_at", nowIso);

    let redeemed = 0;
    let lastOrg: string | null = null;
    for (const inv of invites ?? []) {
      const { error: memErr } = await supabaseAdmin
        .from("organisation_members")
        .upsert(
          { organisation_id: inv.organisation_id, user_id: context.userId, role: inv.role },
          { onConflict: "organisation_id,user_id", ignoreDuplicates: false },
        );
      if (memErr) continue;
      await supabaseAdmin.from("user_invites")
        .update({ status: "accepted", accepted_at: nowIso, accepted_user_id: context.userId })
        .eq("id", inv.id);
      if (inv.assigned_location_ids?.length) {
        await supabaseAdmin.from("profiles")
          .update({ assigned_location_ids: inv.assigned_location_ids })
          .eq("user_id", context.userId);
      }
      lastOrg = inv.organisation_id;
      redeemed += 1;
    }

    if (lastOrg) {
      await supabaseAdmin.from("profiles").upsert(
        { user_id: context.userId, active_organisation_id: lastOrg },
        { onConflict: "user_id" },
      );
    }
    return { redeemed, active_org_id: lastOrg };
  });

export const verifyGoogleLogin = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ email: z.string().email().max(200) }).parse(d))
  .handler(async ({ data }) => {
    const authUser = await findAuthUserByEmail(data.email);
    if (!authUser) {
      return { exists: false };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: platformRole } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", authUser.id)
      .eq("role", "lemtik_admin")
      .maybeSingle();
    if (platformRole) {
      return { exists: true };
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("active_organisation_id")
      .eq("user_id", authUser.id)
      .maybeSingle();
    if (!profile?.active_organisation_id) {
      return { exists: false };
    }

    const { data: membership } = await supabaseAdmin
      .from("organisation_members")
      .select("id")
      .eq("organisation_id", profile.active_organisation_id)
      .eq("user_id", authUser.id)
      .maybeSingle();

    return { exists: Boolean(membership) };
  });
