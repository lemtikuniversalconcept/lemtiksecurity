import { redirect } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";

export type DbRole = "manager" | "supervisor" | "officer" | "client_admin" | "lemtik_admin";
export type SpecRole = "security_manager" | "operator" | "field_officer" | "client_admin" | "lemtik_admin";

export interface AppAccess {
  userId: string;
  orgId: string;
  orgName: string;
  dbRole: DbRole;
  specRole: SpecRole;
  roleLabel: string;
}

export function normalizeRole(role: string): DbRole {
  if (role === "manager" || role === "supervisor" || role === "officer" || role === "client_admin" || role === "lemtik_admin") {
    return role;
  }
  return "officer";
}

export function toSpecRole(role: DbRole): SpecRole {
  switch (role) {
    case "manager":
      return "security_manager";
    case "supervisor":
      return "operator";
    case "officer":
      return "field_officer";
    default:
      return role;
  }
}

export function roleLabel(role: DbRole | SpecRole): string {
  switch (role) {
    case "manager":
    case "security_manager":
      return "Security Manager";
    case "supervisor":
    case "operator":
      return "Operator";
    case "officer":
    case "field_officer":
      return "Field Officer";
    case "client_admin":
      return "Client Admin";
    case "lemtik_admin":
      return "Lemtik Admin";
    default:
      return "Member";
  }
}

export function canAccessSection(access: AppAccess, allowedRoles: SpecRole[]) {
  return allowedRoles.includes(access.specRole);
}

export function requireSectionAccess(access: AppAccess, allowedRoles: SpecRole[]) {
  if (canAccessSection(access, allowedRoles)) {
    return;
  }
  throw redirect({ to: "/" });
}

export async function resolveAppAccess(supabase: SupabaseClient, redirectPath?: string): Promise<AppAccess> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw redirect({ to: "/login", search: { redirect: redirectPath } });
  }

  const { data: directRole } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .eq("role", "lemtik_admin")
    .maybeSingle();

  if (directRole) {
    return {
      userId: data.user.id,
      orgId: "",
      orgName: "Lemtik Platform",
      dbRole: "lemtik_admin",
      specRole: "lemtik_admin",
      roleLabel: roleLabel("lemtik_admin"),
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("active_organisation_id")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (profileError) {
    throw new Error("Unable to resolve active organisation.");
  }

  if (!profile?.active_organisation_id) {
    throw redirect({ to: "/onboarding" });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("organisation_members")
    .select("role, organisation:organisations(id, name)")
    .eq("organisation_id", profile.active_organisation_id)
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (membershipError || !membership) {
    throw redirect({ to: "/onboarding" });
  }

  const dbRole = normalizeRole(String(membership.role));
  const org = Array.isArray(membership.organisation)
    ? membership.organisation[0]
    : membership.organisation;

  return {
    userId: data.user.id,
    orgId: profile.active_organisation_id,
    orgName: org?.name ?? "Active organisation",
    dbRole,
    specRole: toSpecRole(dbRole),
    roleLabel: roleLabel(dbRole),
  };
}
