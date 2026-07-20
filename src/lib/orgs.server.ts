import type { SupabaseClient } from "@supabase/supabase-js";
import { getRequest } from "@tanstack/react-start/server";

export function getSiteUrl(): string {
  const envUrl = process.env.SITE_URL;
  if (envUrl && envUrl.trim() !== "" && envUrl.toLowerCase() !== "none selected" && envUrl.toLowerCase() !== "none") {
    return envUrl.replace(/\/$/, "");
  }
  try {
    const request = getRequest();
    if (request) {
      const url = new URL(request.url);
      const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
      const proto = request.headers.get("x-forwarded-proto") ?? (request.url.startsWith("https") ? "https" : "http");
      return `${proto}://${host}`;
    }
  } catch (e) {
    // ignore
  }
  return "http://localhost:3000";
}

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
