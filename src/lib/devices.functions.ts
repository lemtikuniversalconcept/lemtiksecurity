import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getActiveOrgId } from "@/lib/orgs.server";
import { requestRelationshipApi } from "@/lib/relationship-api";

export type ConnectionType = "REST_API" | "MQTT" | "HARDWARE_BRIDGE";

export type DeviceRecord = {
  id: string;
  org_id: string;
  name: string;
  type: string;
  connection_type: ConnectionType;
  connection_config?: Record<string, any>;
  supported_actions?: string[];
  building_id?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  lat?: number | null;
  lng?: number | null;
  floor?: number | null;
  zone?: string | null;
  area?: string | null;
  status?: string | null;
};

// The 9 pre-vetted device types the Safety Constraints Engine already knows
// how to gate (see DEVICE_ACTION_ALIASES in autonomouscontroller/constraints.py).
// `type` on the wire is free text — these are suggestions, not an enum.
export const KNOWN_DEVICE_TYPES = [
  "smart_gate",
  "smart_door",
  "smart_elevator",
  "traffic_light",
  "smart_barrier",
  "smart_lock",
  "drone",
  "smart_siren",
  "turnstile",
  "sensor_camera",
  "sensor",
] as const;

type GatewayEnvelope<T = unknown> = { status?: string; data?: T; error?: string };

// Everything here goes through relationship_api, never straight to autonomouscontroller — it's
// the single audited/authenticated choke point for every backend service, matching the rest of
// the dashboard's server functions (cameras, cctv, incidents, etc).
function unwrapOrThrow<T>(result: GatewayEnvelope<T> | null, fallbackError: string): T {
  if (!result) throw new Error(fallbackError);
  if (result.status === "success") return result.data as T;
  throw new Error(result.error || fallbackError);
}

const connectionConfigSchema = z.record(z.string(), z.any());

const deviceInput = z.object({
  id: z.string().min(1).max(120).optional(),
  name: z.string().min(1).max(200),
  type: z.string().min(1).max(80),
  connection_type: z.enum(["REST_API", "MQTT", "HARDWARE_BRIDGE"]),
  connection_config: connectionConfigSchema.optional(),
  supported_actions: z.array(z.string().min(1).max(80)).max(30).optional(),
  building_id: z.string().max(120).nullable().optional(),
  manufacturer: z.string().max(120).nullable().optional(),
  model: z.string().max(120).nullable().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  floor: z.number().int().nullable().optional(),
  zone: z.string().max(120).nullable().optional(),
  area: z.string().max(120).nullable().optional(),
});

function slugId(name: string) {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${base || "device"}-${Math.random().toString(36).slice(2, 8)}`;
}

export const listDevices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const result = await requestRelationshipApi<GatewayEnvelope<DeviceRecord[]>>("/api/v1/devices", {
      method: "GET",
      query: { org_id: orgId },
    });
    if (!result || result.status !== "success") return [];
    return result.data ?? [];
  });

export const getDevice = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ device_id: z.string().min(1) }).parse(data))
  .handler(async ({ data }) => {
    const result = await requestRelationshipApi<GatewayEnvelope<DeviceRecord>>(
      `/api/v1/devices/${encodeURIComponent(data.device_id)}`,
      { method: "GET" },
    );
    return unwrapOrThrow(result, "Failed to load device.");
  });

export const registerDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => deviceInput.parse(data))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const result = await requestRelationshipApi<GatewayEnvelope<DeviceRecord>>("/api/v1/devices", {
      body: { ...data, id: data.id || slugId(data.name), org_id: orgId },
    });
    return unwrapOrThrow(result, "Relationship API is not configured (RELATIONSHIP_API_URL/KEY missing).");
  });

export const updateDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => deviceInput.extend({ id: z.string().min(1) }).parse(data))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { id, ...payload } = data;
    const result = await requestRelationshipApi<GatewayEnvelope<DeviceRecord>>(`/api/v1/devices/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: { ...payload, org_id: orgId },
    });
    return unwrapOrThrow(result, "Failed to update device.");
  });

export const checkDeviceConnectivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ device_id: z.string().min(1) }).parse(data))
  .handler(async ({ data }) => {
    const result = await requestRelationshipApi<GatewayEnvelope<{ device_id: string; found: boolean; connectivity?: Record<string, any> }>>(
      `/api/v1/devices/${encodeURIComponent(data.device_id)}/check`,
    );
    return unwrapOrThrow(result, "Connectivity check failed.");
  });

const executeActionInput = z.object({
  device_id: z.string().min(1),
  action_key: z.string().min(1).max(80),
  parameters: z.record(z.string(), z.any()).optional(),
  incident_id: z.string().max(120).optional(),
});

export const executeDeviceAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => executeActionInput.parse(data))
  .handler(async ({ data, context }) => {
    const orgId = await getActiveOrgId(context.supabase, context.userId);
    const { data: settings } = await context.supabase
      .from("organisation_settings")
      .select("automation_mode")
      .eq("organisation_id", orgId)
      .maybeSingle();
    const automationMode = Number((settings as any)?.automation_mode ?? 1);

    const result = await requestRelationshipApi<GatewayEnvelope<Record<string, any>>>(
      `/api/v1/devices/${encodeURIComponent(data.device_id)}/execute`,
      {
        body: {
          org_id: orgId,
          automation_mode: automationMode,
          action_key: data.action_key,
          parameters: data.parameters ?? {},
          requested_by: context.userId,
          incident_id: data.incident_id ?? null,
        },
      },
    );
    return unwrapOrThrow(result, "Relationship API is not configured (RELATIONSHIP_API_URL/KEY missing).");
  });
