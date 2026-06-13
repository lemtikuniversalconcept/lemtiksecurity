import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { throwSafeError } from "@/lib/server-errors";
import { getActiveOrgId } from "@/lib/orgs.server";

export const listAuditLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("audit_log").select("*")
      .eq("organisation_id", orgId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throwSafeError("audit.list", error, "Access denied or unable to load audit log.");
    return data;
  });
