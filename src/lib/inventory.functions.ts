import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getActiveOrgId } from "@/lib/orgs.server";
import { requestRelationshipApi } from "@/lib/relationship-api";

const officerInventoryInput = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  badge: z.string().min(1).max(40),
  status: z.string().min(1).max(40),
  armed: z.boolean(),
  location: z.string().max(200),
  zone: z.string().max(200),
  shift: z.string().max(80),
  certifications: z.array(z.string().max(80)).max(20),
  contact: z.string().max(120),
});

const vehicleInventoryInput = z.object({
  id: z.string().min(1),
  vehicleId: z.string().min(1).max(40),
  type: z.string().min(1).max(80),
  status: z.string().min(1).max(40),
  fuel: z.number().min(0).max(100),
  condition: z.string().max(240),
  driver: z.string().max(120),
  zone: z.string().max(120),
  location: z.string().max(240),
});

const weaponInventoryInput = z.object({
  id: z.string().min(1),
  weaponId: z.string().min(1).max(40),
  type: z.string().min(1).max(80),
  status: z.string().min(1).max(40),
  issuedTo: z.string().nullable().optional(),
  notes: z.string().max(240),
});

const fuelReserveInput = z.object({
  fuelReserve: z.number().min(0),
  fuelThreshold: z.number().min(0).max(100),
  litresAdded: z.number().min(0).optional(),
  note: z.string().max(240).optional(),
});

export type ActiveInventoryAlert = {
  id: string;
  resource: string;
  currentValue: string;
  threshold: string;
  action: string;
  createdAt: string;
  severity?: "warning" | "critical";
};

export const listActiveAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const result = await requestRelationshipApi<ActiveInventoryAlert[]>("/api/v1/alerts/active", {
      method: "GET",
      query: { org_id: orgId },
    });
    return result ?? [];
  });

export const updateOfficerInventory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => officerInventoryInput.parse(data))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const result = await requestRelationshipApi("/api/v1/update/officer", {
      body: { org_id: orgId, ...data, source: "c4isod-dashboard" },
    });

    const { data: member } = await context.supabase
      .from("organisation_members")
      .select("user_id")
      .eq("id", data.id)
      .maybeSingle();

    const targetUserId = member?.user_id || data.id;
    if (targetUserId) {
      await context.supabase
        .from("profiles")
        .update({
          status: data.status,
          zone: data.zone,
          display_name: data.name
        })
        .eq("user_id", targetUserId);
    }

    return result ?? { ok: true };
  });

export const updateVehicleInventory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => vehicleInventoryInput.parse(data))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const result = await requestRelationshipApi("/api/v1/update/vehicle", {
      body: { org_id: orgId, ...data, source: "c4isod-dashboard" },
    });
    return result ?? { ok: true };
  });

export const updateWeaponInventory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => weaponInventoryInput.parse(data))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const result = await requestRelationshipApi("/api/v1/update/weapon", {
      body: { org_id: orgId, ...data, source: "c4isod-dashboard" },
    });
    return result ?? { ok: true };
  });

export const updateFuelReserve = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => fuelReserveInput.parse(data))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const result = await requestRelationshipApi("/api/v1/update/fuel", {
      body: { org_id: orgId, ...data, source: "c4isod-dashboard" },
    });
    return result ?? { ok: true };
  });

export const listInventoryOfficers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const result = await requestRelationshipApi<any>("/api/v1/inventory/officers", {
      method: "GET",
      query: { org_id: orgId },
    });
    return result?.officers ?? [];
  });

export const listInventoryVehicles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const result = await requestRelationshipApi<any>("/api/v1/inventory/vehicles", {
      method: "GET",
      query: { org_id: orgId },
    });
    return result?.vehicles ?? [];
  });


