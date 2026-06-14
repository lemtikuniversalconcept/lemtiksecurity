import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolve the user's currently active organisation. Throws a friendly error
 * when none is set, which the caller should present as a "create or join an org"
 * prompt.
 */
export async function getActiveOrgId(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("active_organisation_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("Could not resolve active organisation.");
  const orgId = data?.active_organisation_id;
  if (!orgId) throw new Error("NO_ACTIVE_ORG");
  return orgId as string;
}
