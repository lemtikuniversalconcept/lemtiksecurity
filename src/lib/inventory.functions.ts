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

const inventoryQueryInput = z.object({
  org_id: z.string().uuid().optional(),
  scope: z.enum(["overview", "officers", "vehicles", "weapons", "fuel", "alerts"]).optional(),
});

const inventoryItemInput = z.object({
  id: z.string().min(1),
  type: z.enum(["officer", "vehicle", "weapon", "fuel", "alert"]),
  action: z.enum(["add", "update"]),
  payload: z.record(z.string(), z.any()),
  org_id: z.string().uuid().optional(),
});

async function sendInventoryUpdate(
  orgId: string,
  type: z.infer<typeof inventoryItemInput>["type"],
  action: z.infer<typeof inventoryItemInput>["action"],
  id: string,
  payload: Record<string, unknown>,
) {
  const endpoint = action === "add" ? "/api/v1/update/inventory/add" : "/api/v1/update/inventory/update";
  const result = await requestRelationshipApi(endpoint, {
    body: {
      org_id: orgId,
      id,
      type,
      payload,
      source: "c4isod-dashboard",
    },
  });
  return result ?? { ok: true };
}

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

export const getInventory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => inventoryQueryInput.parse(data ?? {}))
  .handler(async ({ data, context }) => {
    const orgId = data.org_id ?? (await getActiveOrgId(context.supabase, context.userId));
    const result = await requestRelationshipApi<any>("/api/v1/query", {
      method: "GET",
      query: {
        org_id: orgId,
        scope: data.scope ?? "overview",
      },
    });
    return result ?? null;
  });

export const addInventoryItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => inventoryItemInput.extend({ action: z.literal("add") }).parse(data))
  .handler(async ({ data, context }) => {
    const orgId = data.org_id ?? (await getActiveOrgId(context.supabase, context.userId));
    return sendInventoryUpdate(orgId, data.type, "add", data.id, data.payload);
  });

export const updateInventoryItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => inventoryItemInput.extend({ action: z.literal("update") }).parse(data))
  .handler(async ({ data, context }) => {
    const orgId = data.org_id ?? (await getActiveOrgId(context.supabase, context.userId));
    return sendInventoryUpdate(orgId, data.type, "update", data.id, data.payload);
  });

export const updateOfficerInventory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => officerInventoryInput.parse(data))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const result = await sendInventoryUpdate(orgId, "officer", "update", data.id, data);

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
    const result = await sendInventoryUpdate(orgId, "vehicle", "update", data.id, data);
    return result ?? { ok: true };
  });

export const updateWeaponInventory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => weaponInventoryInput.parse(data))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const result = await sendInventoryUpdate(orgId, "weapon", "update", data.id, data);
    return result ?? { ok: true };
  });

export const updateFuelReserve = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => fuelReserveInput.parse(data))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const result = await sendInventoryUpdate(orgId, "fuel", "update", "fuel-reserve", data);
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
