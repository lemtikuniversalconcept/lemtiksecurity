import { redirect } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/integrations/supabase/server";

// beforeLoad runs on the server during SSR (hard nav / refresh / deep link),
// where the browser client passed into resolveAppAccess has no session to
// read — its cookie jar only exists in `document`, which doesn't exist
// server-side. createIsomorphicFn is what lets server.ts's cookie-reading
// client (and its @tanstack/react-start/server import) exist at all without
// the bundler rejecting it as reachable from client code: on the client this
// resolves to the plain browser client passed in, on the server it resolves
// to a fresh per-request client that reads/writes the same session cookies
// the browser has, so SSR sees the real session instead of always treating
// the request as logged out.
const getRequestSupabase = createIsomorphicFn()
  .server((browserClient: SupabaseClient) => createServerSupabase() as SupabaseClient)
  .client((browserClient: SupabaseClient) => browserClient);

export type DbRole = "manager" | "supervisor" | "officer" | "client_admin" | "lemtik_admin" | "security_forensic_analyst";
export type SpecRole = "security_manager" | "operator" | "field_officer" | "client_admin" | "lemtik_admin" | "security_forensic_analyst";

export interface AppAccess {
  userId: string;
  email: string | null;
  displayName: string | null;
  orgId: string;
  orgName: string;
  dbRole: DbRole;
  specRole: SpecRole;
  roleLabel: string;
}

export function normalizeRole(role: string): DbRole {
  if (
    role === "manager" ||
    role === "supervisor" ||
    role === "officer" ||
    role === "client_admin" ||
    role === "lemtik_admin" ||
    role === "security_forensic_analyst"
  ) {
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
    case "security_forensic_analyst":
      return "Forensic Analyst";
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
  supabase = getRequestSupabase(supabase);

  // getUser() (not getSession()) is deliberate: it revalidates the token against the
  // Supabase Auth server rather than trusting whatever is sitting in local storage,
  // which matters on an access-control path like this one.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw redirect({ to: "/login", search: { redirect: redirectPath } });
  }

  // These two only depend on the user id, not on each other, so run them together
  // instead of waiting on one before starting the next.
  const [{ data: directRole }, { data: profile, error: profileError }] = await Promise.all([
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id)
      .eq("role", "lemtik_admin")
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("active_organisation_id, display_name")
      .eq("user_id", data.user.id)
      .maybeSingle(),
  ]);

  if (directRole) {
    return {
      userId: data.user.id,
      email: data.user.email ?? null,
      displayName: profile?.display_name ?? null,
      orgId: "",
      orgName: "Lemtik Platform",
      dbRole: "lemtik_admin",
      specRole: "lemtik_admin",
      roleLabel: roleLabel("lemtik_admin"),
    };
  }

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
    email: data.user.email ?? null,
    displayName: profile.display_name ?? null,
    orgId: profile.active_organisation_id,
    orgName: org?.name ?? "Active organisation",
    dbRole,
    specRole: toSpecRole(dbRole),
    roleLabel: roleLabel(dbRole),
  };
}
