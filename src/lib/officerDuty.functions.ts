import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { throwSafeError } from "@/lib/server-errors";
import { getActiveOrgId } from "@/lib/orgs.server";

type OfficerDutyRow = {
  status: string | null;
  current_lat: number | null;
  current_lng: number | null;
  location_updated_at: string | null;
  shift_start: string | null;
};

// The `officers` table (owned by inventoryservices' schema, shared via the same
// Supabase project) has RLS enabled but no policies defined, so it's currently
// unreachable through the ordinary RLS-scoped client for any role — this must
// go through the admin client, with the authorization check done here instead.
// officers.id is the same UUID as the signed-in user's own id (the only link
// available; there's no separate officer_user_id column), so every write is
// scoped to the caller's own row by construction — an officer can only ever
// change their own duty status and location, never anyone else's.

export const setDutyStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      on_duty: z.boolean(),
      lat: z.number().optional(),
      lng: z.number().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // `officers` isn't in the generated Supabase types — it was provisioned by
    // inventoryservices' own schema.sql, outside this app's migration history.

    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("officers" as any)
      .select("id, org_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (lookupError) throwSafeError("officer.duty.lookup", lookupError, "Unable to look up officer record.");
    if (!existing) throw new Error("No officer record found for this account.");
    if ((existing as unknown as { org_id: string }).org_id !== orgId) throw new Error("Officer record does not belong to your active organisation.");

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      status: data.on_duty ? "available" : "off_duty",
      updated_at: now,
      ...(data.on_duty ? { shift_start: now } : { shift_end: now }),
    };
    if (data.on_duty && typeof data.lat === "number" && typeof data.lng === "number") {
      patch.current_lat = data.lat;
      patch.current_lng = data.lng;
      patch.location_updated_at = now;
    }

    const { error } = await supabaseAdmin.from("officers" as any).update(patch).eq("id", context.userId);
    if (error) throwSafeError("officer.duty.update", error, "Unable to update duty status.");
    return { ok: true, status: patch.status as string };
  });

export const reportOwnLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      lat: z.number(),
      lng: z.number(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // `officers` isn't in the generated Supabase types — it was provisioned by
    // inventoryservices' own schema.sql, outside this app's migration history.
    const { error } = await supabaseAdmin
      .from("officers" as any)
      .update({
        current_lat: data.lat,
        current_lng: data.lng,
        location_updated_at: new Date().toISOString(),
      })
      .eq("id", context.userId);
    if (error) throwSafeError("officer.location.report", error, "Unable to report location.");
    return { ok: true };
  });

export const getOwnDutyStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OfficerDutyRow | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // `officers` isn't in the generated Supabase types — it was provisioned by
    // inventoryservices' own schema.sql, outside this app's migration history.
    const { data, error } = await supabaseAdmin
      .from("officers" as any)
      .select("status, current_lat, current_lng, location_updated_at, shift_start")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throwSafeError("officer.duty.get", error, "Unable to load duty status.");
    return (data as unknown as OfficerDutyRow) ?? null;
  });
