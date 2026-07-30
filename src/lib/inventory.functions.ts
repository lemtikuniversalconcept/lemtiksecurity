import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getActiveOrgId } from "@/lib/orgs.server";
import { throwSafeError } from "@/lib/server-errors";

type VehicleRow = {
  id: string;
  org_id: string;
  vehicle_id: string;
  type: string;
  status: string;
  fuel_percentage: number | null;
  fuel_litres: number | null;
  condition: string | null;
  assigned_driver_id: string | null;
  current_lat: number | null;
  current_lng: number | null;
  location_updated_at: string | null;
  zone: string | null;
  location: string | null;
};

type OfficerRow = {
  id: string;
  org_id: string;
  name: string;
  badge_number: string | null;
  status: string | null;
  armed: boolean | null;
  rank: string | null;
  certifications: unknown;
  contact: string | null;
  assigned_zone: string | null;
  shift_start: string | null;
  shift_end: string | null;
};

type WeaponRow = {
  id: string;
  org_id: string;
  serial_number: string | null;
  type: string;
  status: string;
  assigned_to: string | null;
  condition: string | null;
  last_inspection_date: string | null;
};

type AmmoRow = {
  id: string;
  org_id: string;
  type: string;
  quantity: number;
  threshold: number;
  last_restocked: string | null;
};

type EquipmentRow = {
  id: string;
  org_id: string;
  category: string;
  total_quantity: number;
  available_quantity: number;
  in_use_quantity: number;
  threshold: number;
  condition_breakdown: unknown;
};

type FuelReserveRow = {
  id: string;
  org_id: string;
  current_litres: number;
  capacity_litres: number;
  threshold_litres: number;
  last_restocked: string | null;
  resupply_contact: string | null;
  updated_at: string | null;
};

type InventoryAlertRow = {
  id: string;
  org_id: string;
  alert_level: string | null;
  resource_type: string | null;
  metric: string | null;
  current_value: number | null;
  threshold_value: number | null;
  message: string | null;
  affected_resources: unknown;
  recommended_action: string | null;
  resolved: boolean | null;
  first_alerted_at: string | null;
  last_alerted_at: string | null;
  alert_count: number | null;
  llm_review: unknown;
};

type DeviceRow = {
  id: string;
  org_id: string;
  device_id: string | null;
  type: string | null;
  name: string | null;
  lat: number | null;
  lng: number | null;
  floor: number | null;
  building_id: string | null;
  description: string | null;
  connection_protocol: string | null;
  connection_endpoint: string | null;
  auth_type: string | null;
  auth_key_reference: string | null;
  capabilities: unknown;
  default_state: string | null;
  safety_constraints: unknown;
  operational: boolean | null;
  last_health_check: string | null;
  health_status: string | null;
};

type CCTVCameraRow = {
  camera_id: string;
  org_id: string;
  name: string | null;
  zone: string | null;
  stream_url: string | null;
  status: string | null;
  topology: unknown;
  metadata: unknown;
};

const officerInput = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  badge: z.string().min(1).max(40).optional(),
  status: z.string().min(1).max(40),
  armed: z.boolean(),
  location: z.string().max(200).optional(),
  zone: z.string().max(200).optional(),
  shift: z.string().max(80).optional(),
  certifications: z.array(z.string().max(80)).max(20).optional(),
  contact: z.string().max(120).optional(),
});

const vehicleInput = z.object({
  id: z.string().min(1),
  vehicleId: z.string().min(1).max(40),
  type: z.string().min(1).max(80),
  status: z.string().min(1).max(40),
  fuel: z.number().min(0).max(100),
  condition: z.string().max(240).optional(),
  driver: z.string().max(120).optional(),
  zone: z.string().max(120).optional(),
  location: z.string().max(240).optional(),
});

const weaponInput = z.object({
  id: z.string().min(1),
  weaponId: z.string().min(1).max(40).optional(),
  type: z.string().min(1).max(80),
  status: z.string().min(1).max(40),
  issuedTo: z.string().nullable().optional(),
  notes: z.string().max(240).optional(),
});

const ammoInput = z.object({
  id: z.string().min(1).optional(),
  type: z.string().min(1).max(80),
  quantity: z.number().int().min(0),
  threshold: z.number().int().min(0),
});

const equipmentInput = z.object({
  id: z.string().min(1).optional(),
  category: z.string().min(1).max(120),
  total: z.number().int().min(0),
  available: z.number().int().min(0),
  inUse: z.number().int().min(0),
});

const fuelInput = z.object({
  fuelReserve: z.number().min(0).optional(),
  fuelThreshold: z.number().min(0).max(100).optional(),
  litresAdded: z.number().min(0).optional(),
  note: z.string().max(240).optional(),
  current_litres: z.number().min(0).optional(),
  capacity_litres: z.number().min(0).optional(),
  threshold_litres: z.number().min(0).optional(),
});

const commandInput = z.object({
  deviceId: z.string().min(1),
  command: z.string().min(1),
  incidentId: z.string().min(1).optional(),
});

function toNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
    } catch {
      return value ? [value] : [];
    }
  }
  return [];
}

function mapOfficer(row: OfficerRow, index: number = 0) {
  const shift = row.shift_start || row.shift_end
    ? `${row.shift_start ? new Date(row.shift_start).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—"} – ${row.shift_end ? new Date(row.shift_end).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—"}`
    : "—";
  return {
    id: row.id,
    user_id: row.id,
    name: row.name,
    badge: row.badge_number || "—",
    status: normalizeOfficerStatus(row.status),
    armed: Boolean(row.armed),
    location: row.assigned_zone || "Unassigned",
    zone: row.assigned_zone || "Unassigned",
    shift,
    certifications: toStringArray(row.certifications),
    contact: row.contact || "—",
  };
}

function normalizeOfficerStatus(status: string | null | undefined) {
  const value = String(status ?? "").toLowerCase();
  if (value.includes("on_duty") || value.includes("on-duty") || value === "active") return "on-duty";
  if (value.includes("respond")) return "responding";
  if (value.includes("break")) return "break";
  return "off-duty";
}

function mapVehicle(row: VehicleRow) {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    type: row.type,
    status: row.status,
    fuel: toNumber(row.fuel_percentage, 0),
    condition: row.condition || "—",
    driver: row.assigned_driver_id || "Unassigned",
    zone: row.zone || row.location || "Unassigned",
    location: row.location || row.zone || "Unassigned",
    history: [toNumber(row.fuel_percentage, 0)],
  };
}

function mapWeapon(row: WeaponRow) {
  return {
    id: row.id,
    weaponId: row.serial_number || row.id,
    type: row.type,
    status: row.status,
    issuedTo: row.assigned_to,
    notes: row.condition || "",
  };
}

function mapAmmo(row: AmmoRow) {
  return {
    id: row.id,
    type: row.type,
    quantity: toNumber(row.quantity, 0),
    threshold: toNumber(row.threshold, 0),
    restocks: [toNumber(row.quantity, 0)],
  };
}

function mapEquipment(row: EquipmentRow) {
  return {
    id: row.id,
    category: row.category,
    available: toNumber(row.available_quantity, 0),
    inUse: toNumber(row.in_use_quantity, 0),
    total: toNumber(row.total_quantity, 0),
  };
}

function mapAlert(row: InventoryAlertRow) {
  return {
    id: row.id,
    resource: row.resource_type || row.metric || "Resource",
    currentValue: row.metric ? `${row.metric}: ${row.current_value ?? "—"}` : String(row.current_value ?? "—"),
    threshold: row.threshold_value != null ? String(row.threshold_value) : "—",
    action: row.recommended_action || row.message || "Review inventory",
    createdAt: row.last_alerted_at || row.first_alerted_at || new Date().toISOString(),
    resolved: Boolean(row.resolved),
  };
}

async function currentOrgId(context: { supabase: any; userId: string }) {
  return getActiveOrgId(context.supabase, context.userId);
}

export const listVehicles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await currentOrgId(context);
    const { data, error } = await context.supabase
      .from("vehicles")
      .select("*")
      .eq("org_id", orgId.toString())
      .order("vehicle_id");
    if (error) throwSafeError("vehicles.list", error, "Unable to load vehicles.");
    return (data ?? []) as VehicleRow[];
  });

export const listOfficers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await currentOrgId(context);
    const { data, error } = await context.supabase
      .from("officers")
      .select("*")
      .eq("org_id", orgId.toString())
      .order("name");
    if (error) throwSafeError("officers.list", error, "Unable to load officers.");
    return (data ?? []) as OfficerRow[];
  });

export const listWeapons = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await currentOrgId(context);
    const { data, error } = await context.supabase
      .from("weapons")
      .select("*")
      .eq("org_id", orgId.toString())
      .order("serial_number");
    if (error) throwSafeError("weapons.list", error, "Unable to load weapons.");
    return (data ?? []) as WeaponRow[];
  });

export const listAmmunition = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await currentOrgId(context);
    const { data, error } = await context.supabase
      .from("ammunition")
      .select("*")
      .eq("org_id", orgId.toString())
      .order("type");
    if (error) throwSafeError("ammunition.list", error, "Unable to load ammunition.");
    return (data ?? []) as AmmoRow[];
  });

export const listEquipment = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await currentOrgId(context);
    const { data, error } = await context.supabase
      .from("tactical_equipment")
      .select("*")
      .eq("org_id", orgId.toString())
      .order("category");
    if (error) throwSafeError("equipment.list", error, "Unable to load equipment.");
    return (data ?? []) as EquipmentRow[];
  });

export const getFuelReserve = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await currentOrgId(context);
    const { data, error } = await context.supabase
      .from("fuel_reserves")
      .select("*")
      .eq("org_id", orgId.toString())
      .maybeSingle();
    if (error) throwSafeError("fuel.get", error, "Unable to load fuel reserve.");
    return (data as FuelReserveRow | null) ?? null;
  });

export const listInventoryAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await currentOrgId(context);
    const { data, error } = await context.supabase
      .from("inventory_alerts")
      .select("*")
      .eq("org_id", orgId.toString())
      .eq("resolved", false)
      .order("last_alerted_at", { ascending: false });
    if (error) throwSafeError("inventory_alerts.list", error, "Unable to load alerts.");
    return (data ?? []).map(mapAlert);
  });

export const listInfrastructureDevices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await currentOrgId(context);
    const [infrastructureRes, autonomousRes] = await Promise.all([
      context.supabase
        .from("infrastructure_devices")
        .select("*")
        .eq("org_id", orgId.toString())
        .order("name"),
      context.supabase
        .from("autonomous_devices")
        .select("*")
        .eq("org_id", orgId.toString())
        .order("name"),
    ]);
    if (infrastructureRes.error) throwSafeError("devices.infrastructure.list", infrastructureRes.error, "Unable to load devices.");
    if (autonomousRes.error) throwSafeError("devices.autonomous.list", autonomousRes.error, "Unable to load devices.");
    return {
      infrastructure: (infrastructureRes.data ?? []) as DeviceRow[],
      autonomous: (autonomousRes.data ?? []) as DeviceRow[],
    };
  });

export const listCCTVCameras = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await currentOrgId(context);
    const { data, error } = await context.supabase
      .from("cctv_ai_cameras")
      .select("*")
      .eq("org_id", orgId.toString())
      .order("name");
    if (error) throwSafeError("cctv.list", error, "Unable to load cameras.");
    return (data ?? []) as CCTVCameraRow[];
  });

export const getInventory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ org_id: z.string().uuid().optional(), scope: z.string().optional() }).parse(input ?? {}))
  .handler(async ({ context }) => {
    const orgId = await currentOrgId(context);
    const [vehicles, officers, weapons, ammo, equipment, reserve, alerts] = await Promise.all([
      context.supabase.from("vehicles").select("*").eq("org_id", orgId.toString()).order("vehicle_id"),
      context.supabase.from("officers").select("*").eq("org_id", orgId.toString()).order("name"),
      context.supabase.from("weapons").select("*").eq("org_id", orgId.toString()).order("serial_number"),
      context.supabase.from("ammunition").select("*").eq("org_id", orgId.toString()).order("type"),
      context.supabase.from("tactical_equipment").select("*").eq("org_id", orgId.toString()).order("category"),
      context.supabase.from("fuel_reserves").select("*").eq("org_id", orgId.toString()).maybeSingle(),
      context.supabase.from("inventory_alerts").select("*").eq("org_id", orgId.toString()).eq("resolved", false).order("last_alerted_at", { ascending: false }),
    ]);
    if (vehicles.error) throwSafeError("inventory.vehicles", vehicles.error, "Unable to load vehicles.");
    if (officers.error) throwSafeError("inventory.officers", officers.error, "Unable to load officers.");
    if (weapons.error) throwSafeError("inventory.weapons", weapons.error, "Unable to load weapons.");
    if (ammo.error) throwSafeError("inventory.ammunition", ammo.error, "Unable to load ammunition.");
    if (equipment.error) throwSafeError("inventory.equipment", equipment.error, "Unable to load equipment.");
    if (reserve.error) throwSafeError("inventory.fuel", reserve.error, "Unable to load fuel reserve.");
    if (alerts.error) throwSafeError("inventory.alerts", alerts.error, "Unable to load inventory alerts.");

    const reserveRow = (reserve.data as FuelReserveRow | null) ?? null;
    const currentLitres = reserveRow?.current_litres ?? 0;
    const fuelThreshold = reserveRow && reserveRow.capacity_litres > 0
      ? Math.round((Number(reserveRow.threshold_litres ?? 0) / Number(reserveRow.capacity_litres)) * 100)
      : 0;

    return {
      officers: ((officers.data ?? []) as OfficerRow[]).map(mapOfficer),
      vehicles: ((vehicles.data ?? []) as VehicleRow[]).map(mapVehicle),
      weapons: ((weapons.data ?? []) as WeaponRow[]).map(mapWeapon),
      ammo: ((ammo.data ?? []) as AmmoRow[]).map(mapAmmo),
      equipment: ((equipment.data ?? []) as EquipmentRow[]).map(mapEquipment),
      fuelReserve: currentLitres,
      fuelThreshold,
      fuelLogs: reserveRow
        ? [{
            id: reserveRow.id,
            date: reserveRow.updated_at || reserveRow.last_restocked || new Date().toISOString(),
            litres: currentLitres,
            note: "Current reserve snapshot",
          }]
        : [],
      alerts: ((alerts.data ?? []) as InventoryAlertRow[]).map(mapAlert),
    };
  });

export const updateOfficerInventory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => officerInput.parse(input))
  .handler(async ({ data, context }) => {
    const orgId = await currentOrgId(context);
    const { error } = await context.supabase
      .from("officers")
      .upsert({
        id: data.id,
        org_id: orgId.toString(),
      name: data.name,
      badge_number: data.badge ?? null,
        status: data.status.replace(/-/g, "_"),
        armed: data.armed,
        assigned_zone: data.zone ?? data.location ?? null,
        contact: data.contact ?? null,
        certifications: data.certifications ?? [],
      }, { onConflict: "id" });
    if (error) throwSafeError("officers.update", error, "Unable to save officer.");
    return { ok: true };
  });

export const updateVehicleInventory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => vehicleInput.parse(input))
  .handler(async ({ data, context }) => {
    const orgId = await currentOrgId(context);
    const { error } = await context.supabase
      .from("vehicles")
      .upsert({
        id: data.id,
        org_id: orgId.toString(),
        vehicle_id: data.vehicleId,
        type: data.type,
        status: data.status,
        fuel_percentage: data.fuel,
        condition: data.condition ?? null,
        zone: data.zone ?? null,
        location: data.location ?? null,
      }, { onConflict: "id" });
    if (error) throwSafeError("vehicles.update", error, "Unable to save vehicle.");
    return { ok: true };
  });

export const updateWeaponInventory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => weaponInput.parse(input))
  .handler(async ({ data, context }) => {
    const orgId = await currentOrgId(context);
    const { error } = await context.supabase
      .from("weapons")
      .upsert({
        id: data.id,
        org_id: orgId.toString(),
        serial_number: data.weaponId ?? data.id,
        type: data.type,
        status: data.status,
        assigned_to: data.issuedTo ?? null,
        condition: data.notes ?? null,
      }, { onConflict: "id" });
    if (error) throwSafeError("weapons.update", error, "Unable to save weapon.");
    return { ok: true };
  });

export const updateAmmoQuantity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ammoInput.parse(input))
  .handler(async ({ data, context }) => {
    const orgId = await currentOrgId(context);
    const { error } = await context.supabase
      .from("ammunition")
      .upsert({
        id: data.id ?? undefined,
        org_id: orgId.toString(),
        type: data.type,
        quantity: data.quantity,
        threshold: data.threshold,
      }, { onConflict: "id" });
    if (error) throwSafeError("ammunition.update", error, "Unable to save ammunition.");
    return { ok: true };
  });

export const updateEquipment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => equipmentInput.parse(input))
  .handler(async ({ data, context }) => {
    const orgId = await currentOrgId(context);
    const { error } = await context.supabase
      .from("tactical_equipment")
      .upsert({
        id: data.id ?? undefined,
        org_id: orgId.toString(),
        category: data.category,
        total_quantity: data.total,
        available_quantity: data.available,
        in_use_quantity: data.inUse,
      }, { onConflict: "id" });
    if (error) throwSafeError("equipment.update", error, "Unable to save equipment.");
    return { ok: true };
  });

export const logFuelDelivery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => fuelInput.parse(input))
  .handler(async ({ data, context }) => {
    const orgId = await currentOrgId(context);
    const { data: existing, error: readError } = await context.supabase
      .from("fuel_reserves")
      .select("*")
      .eq("org_id", orgId.toString())
      .maybeSingle();
    if (readError) throwSafeError("fuel.read", readError, "Unable to load fuel reserve.");
    const current = Number(existing?.current_litres ?? data.current_litres ?? 0);
    const capacity = Number(existing?.capacity_litres ?? data.capacity_litres ?? Math.max(current, 1));
    const threshold = Number(existing?.threshold_litres ?? data.threshold_litres ?? 0);
    const next = Math.min(capacity, current + Number(data.litresAdded ?? 0));
    const { error } = await context.supabase
      .from("fuel_reserves")
      .upsert({
        org_id: orgId.toString(),
        current_litres: next,
        capacity_litres: capacity,
        threshold_litres: threshold,
        updated_at: new Date().toISOString(),
      }, { onConflict: "org_id" });
    if (error) throwSafeError("fuel.update", error, "Unable to save fuel reserve.");
    return { ok: true, current_litres: next };
  });

export const sendDeviceCommand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => commandInput.parse(input))
  .handler(async ({ data, context }) => {
    const orgId = await currentOrgId(context);
    const { data: device, error: deviceError } = await context.supabase
      .from("infrastructure_devices")
      .select("*")
      .eq("org_id", orgId.toString())
      .or(`device_id.eq.${data.deviceId},id.eq.${data.deviceId}`)
      .maybeSingle();
    if (deviceError) throwSafeError("devices.lookup", deviceError, "Unable to locate device.");
    if (!device) throwSafeError("devices.lookup", new Error("not found"), "Device not found.");
    const now = new Date().toISOString();
    const { error: updateError } = await context.supabase
      .from("infrastructure_devices")
      .update({
        last_command: data.command,
        last_command_at: now,
      })
      .eq("id", device.id);
    if (updateError) throwSafeError("devices.command", updateError, "Unable to save device command.");

    await context.supabase.from("incident_activity").insert({
      incident_id: data.incidentId ?? null,
      kind: "device_command",
      message: `${device.name ?? data.deviceId}: ${data.command}`,
      meta: { device_id: data.deviceId, command: data.command },
      created_at: now,
      actor_id: context.userId,
    } as never);

    return { ok: true };
  });

export const addInventoryItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id: z.string().min(1),
      type: z.enum(["officer", "vehicle", "weapon", "ammo", "equipment"]),
      action: z.enum(["add", "update"]),
      org_id: z.string().uuid().optional(),
      payload: z.record(z.string(), z.any()),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const orgId = data.org_id ?? (await currentOrgId(context));
    if (data.action === "add" && data.type === "officer") {
      const payload = data.payload as Record<string, unknown>;
      const { error } = await context.supabase.from("officers").upsert({
        id: data.id,
        org_id: orgId.toString(),
        name: String(payload.name ?? "Officer"),
        badge_number: String(payload.badge ?? payload.badge_number ?? data.id),
        status: String(payload.status ?? "off_duty").replace(/-/g, "_"),
        armed: Boolean(payload.armed),
        assigned_zone: String(payload.zone ?? payload.location ?? "Unassigned"),
        contact: String(payload.contact ?? "—"),
        certifications: Array.isArray(payload.certifications) ? payload.certifications : [],
      }, { onConflict: "id" });
      if (error) throwSafeError("inventory.officer.add", error, "Unable to add officer.");
      return { ok: true };
    }
    return { ok: true };
  });
export const updateFuelReserve = logFuelDelivery;
export const listInventoryOfficers = listOfficers;
export const listInventoryVehicles = listVehicles;
export const listActiveAlerts = listInventoryAlerts;
