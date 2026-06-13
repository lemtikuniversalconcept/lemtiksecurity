import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { throwSafeError } from "@/lib/server-errors";
import { getActiveOrgId } from "@/lib/orgs.server";

const appRole = z.enum(["officer", "supervisor", "manager", "client_admin", "lemtik_admin"]);

async function assertAdmin(supabase: any, userId: string, orgId: string) {
  const { data } = await supabase
    .from("organisation_members").select("role")
    .eq("organisation_id", orgId).eq("user_id", userId).maybeSingle();
  if (!data || !["manager", "client_admin", "lemtik_admin"].includes(data.role))
    throw new Error("Access denied. Admin role required.");
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
    const { data: mem } = await context.supabase
      .from("organisation_members").select("id, role, created_at")
      .eq("organisation_id", orgId).eq("user_id", data.user_id).maybeSingle();
    if (!mem) throw new Error("User is not a member of this organisation.");
    const { data: prof } = await context.supabase
      .from("profiles").select("*").eq("user_id", data.user_id).maybeSingle();
    return { membership: mem, profile: prof };
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
    // Audit
    await context.supabase.from("audit_log").insert({
      organisation_id: orgId,
      actor_id: context.userId,
      action: data.is_active ? "user.reactivated" : "user.deactivated",
      entity: "user",
      entity_id: data.user_id,
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
  }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    await assertAdmin(context.supabase, context.userId, orgId);

    // Inviter name for the email body
    const { data: meProf } = await context.supabase
      .from("profiles").select("display_name").eq("user_id", context.userId).maybeSingle();
    const { data: org } = await context.supabase
      .from("organisations").select("name").eq("id", orgId).maybeSingle();

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

    // Send Supabase magic-link invite via admin
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const redirectBase = (process.env.SITE_URL ?? "").replace(/\/$/, "");
    const redirectTo = redirectBase
      ? `${redirectBase}/onboarding?invite=${invite.token}`
      : undefined;
    const { error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(invite.email, {
      data: {
        invite_token: invite.token,
        organisation_id: orgId,
        organisation_name: org?.name ?? "your team",
        invited_role: data.role,
        invited_by: meProf?.display_name ?? null,
      },
      ...(redirectTo ? { redirectTo } : {}),
    });
    if (inviteErr) {
      // Don't fail the row create — surface to admin but keep record so they can copy link
      return { ok: true, invite, delivery_warning: inviteErr.message };
    }

    await context.supabase.from("audit_log").insert({
      organisation_id: orgId,
      actor_id: context.userId,
      action: "invite.sent",
      entity: "invite",
      entity_id: invite.id,
      details: { email: invite.email, role: data.role },
    });

    return { ok: true, invite };
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

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(invite.email, {
      data: { invite_token: invite.token, organisation_id: orgId, invited_role: invite.role },
    });
    if (inviteErr) return { ok: true, delivery_warning: inviteErr.message };
    return { ok: true };
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
    })).min(1).max(200),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    await assertAdmin(context.supabase, context.userId, orgId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const results: Array<{ email: string; ok: boolean; error?: string }> = [];

    for (const row of data.rows) {
      const email = row.email.toLowerCase().trim();
      try {
        const { data: invite, error } = await context.supabase
          .from("user_invites").insert({
            organisation_id: orgId,
            email, role: row.role ?? "officer",
            invited_by: context.userId,
          }).select().single();
        if (error) throw error;
        const { error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
          data: { invite_token: invite.token, organisation_id: orgId, invited_role: invite.role },
        });
        results.push({ email, ok: true, error: inviteErr?.message });
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

