import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPatrols } from "@/lib/patrols.functions";
import { listIncidents } from "@/lib/incidents.functions";
import {
  listActiveAlerts,
  getInventory,
  addInventoryItem,
  updateFuelReserve,
  updateOfficerInventory,
  updateVehicleInventory,
  updateWeaponInventory,
  listOfficers,
  listVehicles,
  listWeapons,
  listAmmunition,
  listEquipment,
  getFuelReserve,
} from "@/lib/inventory.functions";
import { useRealtimeInvalidate } from "@/lib/useRealtime";
import { requireSectionAccess } from "@/lib/rbac";
import { severityMeta } from "@/lib/mockData";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Download,
  Filter,
  Fuel,
  Loader2,
  MapPinned,
  Pencil,
  Plus,
  Printer,
  Search,
  Save,
  Shield,
  TimerReset,
  Trash2,
  Users,
  Wrench,
  CarFront,
  Package,
  CircleAlert,
  RotateCcw,
  FileText,
} from "lucide-react";

type Tab = "officers" | "vehicles" | "weapons" | "equipment" | "fuel";
type OfficerRow = {
  id: string;
  user_id: string;
  name: string;
  badge: string;
  status: string;
  armed: boolean;
  location: string;
  zone: string;
  shift: string;
  certifications: string[];
  contact: string;
};
type VehicleRow = {
  id: string;
  vehicleId: string;
  type: string;
  status: string;
  fuel: number;
  condition: string;
  driver: string;
  zone: string;
  location: string;
  history: number[];
};
type WeaponRow = {
  id: string;
  weaponId: string;
  type: string;
  status: string;
  issuedTo: string | null;
  notes: string;
};
type EquipmentRow = {
  id: string;
  category: string;
  available: number;
  inUse: number;
  total: number;
};
type FuelLog = { id: string; date: string; litres: number; note: string };
type FuelReserveRow = {
  id: string;
  current_litres: number | null;
  capacity_litres: number | null;
  threshold_litres: number | null;
  last_restocked: string | null;
  updated_at: string | null;
};
type AmmoRow = { type: string; quantity: number; threshold: number; restocks: number[] };
type InventoryAlert = {
  id: string;
  resource: string;
  currentValue: string;
  threshold: string;
  action: string;
  createdAt: string;
  resolved: boolean;
};
type InventoryState = {
  officers: OfficerRow[];
  vehicles: VehicleRow[];
  weapons: WeaponRow[];
  ammo: AmmoRow[];
  equipment: EquipmentRow[];
  fuelReserve: number;
  fuelThreshold: number;
  fuelLogs: FuelLog[];
  alerts: InventoryAlert[];
};

export const Route = createFileRoute("/app/inventory")({
  head: () => ({ meta: [{ title: "Inventory · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    const appAccess = context.appAccess;
    requireSectionAccess(appAccess, ["security_manager", "operator", "client_admin"]);
    return { appAccess };
  },
  component: InventoryPage,
});

function InventoryPage() {
  const { appAccess } = Route.useRouteContext();
  const canEdit = appAccess.specRole === "security_manager";
  const listPat = useServerFn(listPatrols);
  const listInc = useServerFn(listIncidents);
  const loadInventory = useServerFn(getInventory);
  const loadAlerts = useServerFn(listActiveAlerts);
  const addInventory = useServerFn(addInventoryItem);
  const saveOfficerFn = useServerFn(updateOfficerInventory);
  const saveVehicleFn = useServerFn(updateVehicleInventory);
  const saveWeaponFn = useServerFn(updateWeaponInventory);
  const saveFuelFn = useServerFn(updateFuelReserve);
  const listOfficersFn = useServerFn(listOfficers);
  const listVehiclesFn = useServerFn(listVehicles);
  const listWeaponsFn = useServerFn(listWeapons);
  const listAmmoFn = useServerFn(listAmmunition);
  const listEquipmentFn = useServerFn(listEquipment);
  const getFuelFn = useServerFn(getFuelReserve);

  const { data: patrols = [], isLoading: patrolsLoading } = useQuery({ queryKey: ["inventory-patrols"], queryFn: () => listPat() });
  const { data: incidents = [], isLoading: incidentsLoading } = useQuery({ queryKey: ["inventory-incidents"], queryFn: () => listInc() });
  const { data: officers = [], isLoading: officersLoading } = useQuery({ queryKey: ["inventory-officers", appAccess.orgId], queryFn: () => listOfficersFn() });
  const { data: vehicles = [], isLoading: vehiclesLoading } = useQuery({ queryKey: ["inventory-vehicles", appAccess.orgId], queryFn: () => listVehiclesFn() });
  const { data: weapons = [], isLoading: weaponsLoading } = useQuery({ queryKey: ["inventory-weapons", appAccess.orgId], queryFn: () => listWeaponsFn() });
  const { data: ammo = [], isLoading: ammoLoading } = useQuery({ queryKey: ["inventory-ammo", appAccess.orgId], queryFn: () => listAmmoFn() });
  const { data: equipment = [], isLoading: equipmentLoading } = useQuery({ queryKey: ["inventory-equipment", appAccess.orgId], queryFn: () => listEquipmentFn() });
  const { data: fuelReserve = null, isLoading: fuelLoading } = useQuery({ queryKey: ["inventory-fuel", appAccess.orgId], queryFn: () => getFuelFn() });
  const { data: inventoryAlerts = [] } = useQuery({
    queryKey: ["inventory-alerts", appAccess.orgId],
    queryFn: () => loadAlerts(),
  });
  const { data: inventorySnapshot = null, isLoading: inventorySnapshotLoading } = useQuery({
    queryKey: ["inventory-snapshot", appAccess.orgId],
    queryFn: () => loadInventory({ data: { org_id: appAccess.orgId, scope: "overview" } }),
  });

  useRealtimeInvalidate("officers", [["inventory-officers"]]);
  useRealtimeInvalidate("vehicles", [["inventory-vehicles"]]);
  useRealtimeInvalidate("weapons", [["inventory-weapons"]]);
  useRealtimeInvalidate("ammunition", [["inventory-ammo"]]);
  useRealtimeInvalidate("tactical_equipment", [["inventory-equipment"]]);
  useRealtimeInvalidate("fuel_reserves", [["inventory-fuel"]]);
  useRealtimeInvalidate("inventory_alerts", [["inventory-alerts"], ["inventory-snapshot", appAccess.orgId]]);
  useRealtimeInvalidate("patrols", [["inventory-patrols"]]);
  useRealtimeInvalidate("incidents", [["inventory-incidents"]]);
  const dataReady = !patrolsLoading && !incidentsLoading && !officersLoading && !vehiclesLoading && !weaponsLoading && !ammoLoading && !equipmentLoading && !fuelLoading && !inventorySnapshotLoading;

  const baseState = useMemo(() => normalizeInventorySnapshot(inventorySnapshot, { officers, vehicles, weapons, ammo, equipment, fuelReserve, inventoryAlerts }), [ammo, equipment, fuelReserve, inventoryAlerts, inventorySnapshot, officers, vehicles, weapons]);
  const [state, setState] = useState<InventoryState | null>(null);
  const [tab, setTab] = useState<Tab>("officers");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterZone, setFilterZone] = useState("");
  const [filterArmed, setFilterArmed] = useState<"all" | "armed" | "unarmed">("all");
  const [filterCert, setFilterCert] = useState("all");
  const [selectedOfficer, setSelectedOfficer] = useState<string | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null);
  const [selectedWeapon, setSelectedWeapon] = useState<string | null>(null);
  const [editingOfficer, setEditingOfficer] = useState<OfficerRow | null>(null);
  const [editingVehicle, setEditingVehicle] = useState<VehicleRow | null>(null);
  const [fuelLogNote, setFuelLogNote] = useState("");
  const [deliveryLitres, setDeliveryLitres] = useState(500);
  const [dismissedAlertIds, setDismissedAlertIds] = useState<string[]>([]);

  useEffect(() => {
    if (dataReady) {
      setState(baseState);
    }
  }, [baseState, dataReady]);

  const inventory = state ?? baseState;
  const activeAlerts = useMemo(
    () => inventory.alerts.filter((a) => !dismissedAlertIds.includes(a.id)),
    [dismissedAlertIds, inventory.alerts],
  );
  const filteredOfficers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inventory.officers.filter((o) => {
      if (filterStatus && o.status !== filterStatus) return false;
      if (filterZone && o.zone !== filterZone) return false;
      if (filterArmed !== "all" && (filterArmed === "armed") !== o.armed) return false;
      if (filterCert !== "all" && !o.certifications.includes(filterCert)) return false;
      if (!q) return true;
      return [o.name, o.badge, o.location, o.shift, o.zone, o.certifications.join(" "), o.contact].join(" ").toLowerCase().includes(q);
    });
  }, [filterArmed, filterCert, filterStatus, filterZone, inventory.officers, search]);

  const stats = useMemo(() => {
    const availableOfficers = inventory.officers.filter((o) => o.status === "on-duty").length;
    const vehicleAvailable = inventory.vehicles.filter((v) => v.status === "available").length;
    const fuelled = inventory.vehicles.filter((v) => v.fuel >= 50).length;
    const weaponsIssued = inventory.weapons.filter((w) => w.status === "issued").length;
    const ammoQty = inventory.ammo.reduce((acc, row) => acc + row.quantity, 0);
    const equipmentAvail = inventory.equipment.reduce((acc, row) => acc + row.available, 0);
    const fuelPct = Math.round((inventory.fuelReserve / 5000) * 100);
    return { availableOfficers, vehicleAvailable, fuelled, weaponsIssued, ammoQty, equipmentAvail, fuelPct };
  }, [inventory]);

  const fuelReservePct = Math.round((inventory.fuelReserve / Math.max(1, fuelReserve?.capacity_litres ?? 5000)) * 100);
  const showLoading = !dataReady;

  const resolveAlert = (id: string) => setDismissedAlertIds((current) => (current.includes(id) ? current : [...current, id]));
  const updateState = (updater: (prev: InventoryState) => InventoryState) => setState((prev) => (prev ? updater(prev) : prev));

  const rosterSave = async (row: OfficerRow) => {
    await saveOfficerFn({
      data: {
        id: row.id,
        name: row.name,
        badge: row.badge,
        status: row.status,
        armed: row.armed,
        location: row.location,
        zone: row.zone,
        shift: row.shift,
        certifications: row.certifications,
        contact: row.contact,
      },
    });
    updateState((prev) => ({
      ...prev,
      officers: prev.officers.map((o) => (o.id === row.id ? row : o)),
    }));
  };
  const rosterAdd = () => {
    const next = newOfficer();
    setEditingOfficer(next);
  };
  const rosterCommit = async () => {
    if (!editingOfficer) return;
    const exists = inventory.officers.some((o) => o.id === editingOfficer.id);
    if (!exists) {
      await addInventory({
        data: {
          id: editingOfficer.id,
          type: "officer",
          action: "add",
          org_id: appAccess.orgId,
          payload: editingOfficer,
        },
      });
    }
    await rosterSave(editingOfficer);
    updateState((prev) => {
      const exists = prev.officers.some((o) => o.id === editingOfficer.id);
      return {
        ...prev,
        officers: exists
          ? prev.officers.map((o) => (o.id === editingOfficer.id ? editingOfficer : o))
          : [editingOfficer, ...prev.officers],
      };
    });
    setEditingOfficer(null);
  };

  const vehicleCommit = async () => {
    if (!editingVehicle) return;
    await saveVehicleFn({
      data: {
        id: editingVehicle.id,
        vehicleId: editingVehicle.vehicleId,
        type: editingVehicle.type,
        status: editingVehicle.status,
        fuel: editingVehicle.fuel,
        condition: editingVehicle.condition,
        driver: editingVehicle.driver,
        zone: editingVehicle.zone,
        location: editingVehicle.location,
      },
    });
    updateState((prev) => ({
      ...prev,
      vehicles: prev.vehicles.map((v) => (v.id === editingVehicle.id ? editingVehicle : v)),
    }));
    setEditingVehicle(null);
  };
  const markVehicleService = (vehicleId: string) => updateState((prev) => ({
    ...prev,
    vehicles: prev.vehicles.map((v) => v.id === vehicleId ? { ...v, status: "unavailable", condition: "Service required" } : v),
    alerts: ensureAlert(prev.alerts, {
      id: `alert-${Date.now()}`,
      resource: vehicleId,
      currentValue: "Unavailable",
      threshold: "Available",
      action: "Mark vehicle as available after inspection",
      createdAt: new Date().toISOString(),
      resolved: false,
    }),
  }));
  const issueWeapon = (weaponId: string) => updateState((prev) => {
    const targetOfficer = prev.officers.find((o) => o.status === "on-duty" && !o.armed) ?? prev.officers[0];
    if (!targetOfficer) return prev;
    const source = prev.weapons.find((w) => w.id === weaponId);
    if (source) {
      void saveWeaponFn({
        data: {
          id: source.id,
          weaponId: source.weaponId,
          type: source.type,
          status: "issued",
          issuedTo: targetOfficer.name,
          notes: source.notes,
        },
      });
    }
    return {
      ...prev,
      officers: prev.officers.map((o) => o.id === targetOfficer.id ? { ...o, armed: true } : o),
      weapons: prev.weapons.map((w) => w.id === weaponId ? { ...w, status: "issued", issuedTo: targetOfficer.name } : w),
    };
  });
  const returnWeapon = (weaponId: string) => updateState((prev) => {
    const weapon = prev.weapons.find((w) => w.id === weaponId);
    if (weapon) {
      void saveWeaponFn({
        data: {
          id: weapon.id,
          weaponId: weapon.weaponId,
          type: weapon.type,
          status: "available",
          issuedTo: null,
          notes: weapon.notes,
        },
      });
    }
    return {
      ...prev,
      weapons: prev.weapons.map((w) => w.id === weaponId ? { ...w, status: "available", issuedTo: null } : w),
    };
  });
  const equipmentCheckout = (category: string) => updateState((prev) => ({
    ...prev,
    equipment: prev.equipment.map((e) => e.category === category && e.available > 0 ? { ...e, available: e.available - 1, inUse: e.inUse + 1 } : e),
  }));
  const equipmentReturn = (category: string) => updateState((prev) => ({
    ...prev,
    equipment: prev.equipment.map((e) => e.category === category && e.inUse > 0 ? { ...e, available: e.available + 1, inUse: e.inUse - 1 } : e),
  }));
  const addFuelDelivery = () => {
    updateState((prev) => {
      const litres = Math.max(100, Number(deliveryLitres) || 0);
      const reserve = Math.min(5000, prev.fuelReserve + litres);
      void saveFuelFn({
        data: {
          fuelReserve: reserve,
          fuelThreshold: prev.fuelThreshold,
          litresAdded: litres,
          note: fuelLogNote || "Fuel delivery logged",
        },
      });
      return {
        ...prev,
        fuelReserve: reserve,
        fuelLogs: [{ id: `fuel-${Date.now()}`, date: new Date().toISOString(), litres, note: fuelLogNote || "Fuel delivery logged" }, ...prev.fuelLogs].slice(0, 30),
        alerts: prev.alerts.filter((a) => a.resource !== "fuel-reserve" || a.resolved).concat(reserve / 5000 * 100 >= prev.fuelThreshold ? [] : [{
          id: `fuel-alert-${Date.now()}`,
          resource: "fuel-reserve",
          currentValue: `${Math.round((reserve / 5000) * 100)}%`,
          threshold: `${prev.fuelThreshold}%`,
          action: "Increase reserve or lower threshold",
          createdAt: new Date().toISOString(),
          resolved: false,
        }]),
      };
    });
    setFuelLogNote("");
  };

  const exportRoster = () => window.print();
  const zones = useMemo(() => Array.from(new Set(inventory.officers.map((o) => o.zone))).sort(), [inventory.officers]);
  const certifications = useMemo(() => Array.from(new Set(inventory.officers.flatMap((o) => o.certifications))).sort(), [inventory.officers]);

  if (showLoading || !state) {
    return <div className="rounded-lg border border-border bg-card p-6 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading inventory…</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Inventory Management</div>
          <h1 className="mt-1 text-2xl font-semibold">Assets, armoury, and fuel control</h1>
          <p className="text-sm text-muted-foreground">Live operational inventory, derived from current org data and manager-editable settings.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportRoster} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-xs hover:bg-surface-2"><Printer className="h-3.5 w-3.5" /> Export roster PDF</button>
          <button onClick={() => setState(baseState)} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-xs hover:bg-surface-2"><RotateCcw className="h-3.5 w-3.5" /> Reset live view</button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Metric icon={Users} label="Officers" value={`${stats.availableOfficers}/${inventory.officers.length}`} sub="available / total" />
        <Metric icon={CarFront} label="Vehicles" value={`${stats.vehicleAvailable}/${inventory.vehicles.length}`} sub={`fuelled ${stats.fuelled}`} />
        <Metric icon={Shield} label="Weapons" value={`${inventory.weapons.filter((w) => w.status === "available").length}/${inventory.weapons.length}`} sub="armoury / issued" />
        <Metric icon={Package} label="Ammunition" value={`${stats.ammoQty}`} sub="rounds in stock" />
        <Metric icon={Wrench} label="Tactical gear" value={`${stats.equipmentAvail}`} sub="available units" />
        <Metric icon={Fuel} label="Fuel reserve" value={`${fuelReservePct}%`} sub={`${Math.round(inventory.fuelReserve)} litres`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-4">
        <section className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Active Alerts Panel</div>
              <h2 className="text-sm font-semibold">Threshold exceptions</h2>
            </div>
            <span className="inline-flex items-center gap-1 rounded-md border border-critical/30 bg-critical/10 px-2 py-1 text-[10px] uppercase tracking-wider text-critical"><CircleAlert className="h-3 w-3" /> {activeAlerts.length} active</span>
          </div>
          {activeAlerts.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-surface p-6 text-center text-sm text-muted-foreground">No active threshold alerts.</div>
          ) : (
            <div className="space-y-2">
              {activeAlerts.map((alert) => (
                <div key={alert.id} className="rounded-md border border-border bg-surface px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">{alert.resource}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Current {alert.currentValue} · Threshold {alert.threshold} · {timeAgo(alert.createdAt)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{alert.action}</div>
                    </div>
                    {canEdit && (
                      <button onClick={() => resolveAlert(alert.id)} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Resolve
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Inventory overview</div>
              <h2 className="text-sm font-semibold">Operational snapshot</h2>
            </div>
            <span className="rounded-md border border-border bg-surface px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              {appAccess.roleLabel}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Pill label="Officers on duty" value={`${stats.availableOfficers}`} />
            <Pill label="Vehicles low fuel" value={`${inventory.vehicles.filter((v) => v.status === "low_fuel").length}`} tone="critical" />
            <Pill label="Weapons issued" value={`${inventory.weapons.filter((w) => w.status === "issued").length}`} />
            <Pill label="Fuel threshold" value={`${inventory.fuelThreshold}%`} />
          </div>
          <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
            {incidents.filter((i) => i.severity >= 4).length} critical incidents and {patrols.filter((p) => p.status !== "complete").length} active patrols are feeding inventory pressure.
          </div>
        </section>
      </div>

      <div className="rounded-lg border border-border bg-card p-1">
        <div className="flex flex-wrap gap-1 rounded-md bg-surface p-1">
          {[
            ["officers", "Officers roster"],
            ["vehicles", "Vehicles fleet"],
            ["weapons", "Weapons & ammo"],
            ["equipment", "Tactical equipment"],
            ["fuel", "Fuel reserve"],
          ].map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTab(value as Tab)}
              className={`rounded-md px-3 py-2 text-xs font-medium ${tab === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "officers" && (
        <div className="grid grid-cols-1 xl:grid-cols-[1.25fr_0.75fr] gap-4 items-start">
          <section className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold">Officers roster</h2>
                <p className="text-xs text-muted-foreground">Filter by status, armed state, certification, or zone.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canEdit && <button onClick={rosterAdd} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"><Plus className="h-3.5 w-3.5" /> Add new officer</button>}
                <button onClick={exportRoster} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-xs hover:bg-surface-2"><Download className="h-3.5 w-3.5" /> Export PDF</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <SearchBox value={search} onChange={setSearch} placeholder="Search officers" />
              <SelectBox label="Status" value={filterStatus} onChange={setFilterStatus} options={["", "on-duty", "off-duty", "break"]} />
              <SelectBox label="Armed" value={filterArmed} onChange={(v) => setFilterArmed(v as any)} options={["all", "armed", "unarmed"]} />
              <SelectBox label="Certification" value={filterCert} onChange={setFilterCert} options={["all", ...certifications]} />
              <SelectBox label="Zone" value={filterZone} onChange={setFilterZone} options={["", ...zones]} />
            </div>
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="bg-surface text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-left">Badge</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Armed</th>
                    <th className="px-3 py-2 text-left">Location</th>
                    <th className="px-3 py-2 text-left">Shift</th>
                    <th className="px-3 py-2 text-left">Certs</th>
                    <th className="px-3 py-2 text-left">Contact</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOfficers.map((officer) => (
                    <tr key={officer.id} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{officer.name}</td>
                      <td className="px-3 py-2 font-mono text-muted-foreground">{officer.badge}</td>
                      <td className="px-3 py-2">{statusPill(officer.status)}</td>
                      <td className="px-3 py-2">{officer.armed ? "Yes" : "No"}</td>
                      <td className="px-3 py-2">{officer.location}<div className="text-[10px] text-muted-foreground">{officer.zone}</div></td>
                      <td className="px-3 py-2">{officer.shift}</td>
                      <td className="px-3 py-2">{officer.certifications.join(", ")}</td>
                      <td className="px-3 py-2">{officer.contact}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button onClick={() => setSelectedOfficer(officer.id)} className="rounded border border-border bg-surface px-2 py-1 text-[11px] hover:bg-surface-2">View</button>
                          {canEdit && <button onClick={() => setEditingOfficer(officer)} className="rounded border border-border bg-surface px-2 py-1 text-[11px] hover:bg-surface-2"><Pencil className="h-3 w-3" /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <DetailPanel title="Officer profile" visible={Boolean(selectedOfficer)} onClose={() => setSelectedOfficer(null)}>
            {selectedOfficer && (
              <div className="space-y-3">
                <div className="text-sm font-semibold">{inventory.officers.find((o) => o.id === selectedOfficer)?.name}</div>
                <div className="text-xs text-muted-foreground">{inventory.officers.find((o) => o.id === selectedOfficer)?.badge}</div>
                <InfoLine label="Location" value={inventory.officers.find((o) => o.id === selectedOfficer)?.location ?? "—"} />
                <InfoLine label="Shift" value={inventory.officers.find((o) => o.id === selectedOfficer)?.shift ?? "—"} />
                <InfoLine label="Certifications" value={inventory.officers.find((o) => o.id === selectedOfficer)?.certifications.join(", ") ?? "—"} />
              </div>
            )}
          </DetailPanel>
        </div>
      )}

      {tab === "vehicles" && (
        <div className="grid grid-cols-1 xl:grid-cols-[1.25fr_0.75fr] gap-4 items-start">
          <section className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {inventory.vehicles.map((vehicle) => (
                <button
                  key={vehicle.id}
                  onClick={() => setSelectedVehicle(vehicle.id)}
                  className={`rounded-lg border p-4 text-left ${vehicleTone(vehicle.status, vehicle.fuel)}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{vehicle.vehicleId}</div>
                      <div className="mt-1 text-sm font-semibold">{vehicle.type}</div>
                    </div>
                    <CarFront className="h-4 w-4" />
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span>{vehicle.driver}</span>
                    <span>{vehicle.zone}</span>
                  </div>
                  <FuelBar fuel={vehicle.fuel} />
                  <div className="mt-2 text-[11px] text-muted-foreground">{vehicle.condition}</div>
                </button>
              ))}
            </div>
          </section>

          <DetailPanel title="Vehicle detail" visible={Boolean(selectedVehicle)} onClose={() => setSelectedVehicle(null)}>
            {selectedVehicle && (() => {
              const vehicle = inventory.vehicles.find((v) => v.id === selectedVehicle);
              if (!vehicle) return null;
              return (
                <div className="space-y-3">
                  <div className="text-sm font-semibold">{vehicle.vehicleId}</div>
                  <InfoLine label="Type" value={vehicle.type} />
                  <InfoLine label="Driver" value={vehicle.driver} />
                  <InfoLine label="Fuel" value={`${vehicle.fuel}%`} />
                  <InfoLine label="Condition" value={vehicle.condition} />
                  <InfoLine label="Location" value={vehicle.location} />
                  <div className="rounded-md border border-border bg-surface p-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Fuel history</div>
                    <div className="mt-2 flex h-20 items-end gap-1">
                      {vehicle.history.map((value, idx) => (
                        <div key={idx} className="flex-1 rounded-t bg-primary/70" style={{ height: `${Math.max(10, value)}%` }} />
                      ))}
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex gap-2">
                      <button onClick={() => setEditingVehicle(vehicle)} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"><Pencil className="h-3.5 w-3.5" /> Edit</button>
                      <button onClick={() => markVehicleService(vehicle.id)} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-xs hover:bg-surface-2"><Wrench className="h-3.5 w-3.5" /> Mark for service</button>
                    </div>
                  )}
                </div>
              );
            })()}
          </DetailPanel>
        </div>
      )}

      {tab === "weapons" && (
        <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-4 items-start">
          <section className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold">Weapons & ammunition</h2>
                <p className="text-xs text-muted-foreground">Armoury and stock thresholds.</p>
              </div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Restock log</div>
            </div>
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="bg-surface text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Weapon ID</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Issued to</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.weapons.map((weapon) => (
                    <tr key={weapon.id} className="border-t border-border">
                      <td className="px-3 py-2 font-mono">{weapon.weaponId}</td>
                      <td className="px-3 py-2">{weapon.type}</td>
                      <td className="px-3 py-2">{weaponStatus(weapon.status)}</td>
                      <td className="px-3 py-2">{weapon.issuedTo ?? "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button onClick={() => setSelectedWeapon(weapon.id)} className="rounded border border-border bg-surface px-2 py-1 text-[11px] hover:bg-surface-2">View</button>
                          {canEdit && weapon.status !== "issued" && <button onClick={() => issueWeapon(weapon.id)} className="rounded border border-border bg-surface px-2 py-1 text-[11px] hover:bg-surface-2">Issue</button>}
                          {canEdit && weapon.status === "issued" && <button onClick={() => returnWeapon(weapon.id)} className="rounded border border-border bg-surface px-2 py-1 text-[11px] hover:bg-surface-2">Return</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {inventory.ammo.map((ammo) => (
                <div key={ammo.type} className="rounded-md border border-border bg-surface px-3 py-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{ammo.type}</span>
                    <span className={ammo.quantity <= ammo.threshold ? "text-critical" : "text-resolved"}>{ammo.quantity} vs {ammo.threshold}</span>
                  </div>
                  <div className="mt-1 text-muted-foreground">Threshold indicator</div>
                  <div className="mt-2 flex gap-1">
                    {ammo.restocks.slice(-8).map((value, idx) => <span key={idx} className="h-5 flex-1 rounded bg-primary/30" style={{ opacity: Math.max(0.2, value / 100) }} />)}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <DetailPanel title="Weapon detail" visible={Boolean(selectedWeapon)} onClose={() => setSelectedWeapon(null)}>
            {selectedWeapon && (() => {
              const weapon = inventory.weapons.find((w) => w.id === selectedWeapon);
              if (!weapon) return null;
              return (
                <div className="space-y-3">
                  <div className="text-sm font-semibold">{weapon.weaponId}</div>
                  <InfoLine label="Type" value={weapon.type} />
                  <InfoLine label="Status" value={weapon.status} />
                  <InfoLine label="Issued to" value={weapon.issuedTo ?? "—"} />
                  <InfoLine label="Notes" value={weapon.notes} />
                </div>
              );
            })()}
          </DetailPanel>
        </div>
      )}

      {tab === "equipment" && (
        <section className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">Tactical equipment</h2>
              <p className="text-xs text-muted-foreground">Body armour, radios, first aid kits, and other deployables.</p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {inventory.equipment.map((item) => (
              <div key={item.id} className="rounded-lg border border-border bg-surface p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">{item.category}</div>
                  <Package className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <InfoBox label="Available" value={item.available} />
                  <InfoBox label="In use" value={item.inUse} />
                  <InfoBox label="Total" value={item.total} />
                </div>
                {canEdit && (
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => equipmentCheckout(item.category)} disabled={item.available === 0} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-60"><ArrowRight className="h-3.5 w-3.5" /> Check out</button>
                    <button onClick={() => equipmentReturn(item.category)} disabled={item.inUse === 0} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-xs hover:bg-surface-2 disabled:opacity-60"><RotateCcw className="h-3.5 w-3.5" /> Check in</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === "fuel" && (
        <section className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
          <div className="rounded-lg border border-border bg-card p-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold">Fuel reserve</h2>
                <p className="text-xs text-muted-foreground">Reserve gauge and 30-day history.</p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground"><Fuel className="h-3 w-3" /> {fuelReservePct}%</span>
            </div>
            <div className="rounded-lg border border-border bg-surface p-4">
              <div className="flex items-end justify-between gap-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Current reserve</div>
                <div className="text-xs text-muted-foreground">{Math.round(inventory.fuelReserve)} litres / 5000</div>
              </div>
              <div className="mt-3 h-4 overflow-hidden rounded-full bg-background">
                <div className={`h-full rounded-full ${fuelReservePct <= inventory.fuelThreshold ? "bg-critical" : "bg-resolved"}`} style={{ width: `${fuelReservePct}%` }} />
              </div>
              <div className="mt-3 flex gap-1">
                {inventory.fuelLogs.slice(0, 30).map((log, idx) => (
                  <div key={log.id} className="flex-1 rounded-t bg-primary/70" style={{ height: `${Math.max(12, Math.min(100, log.litres / 10))}%`, opacity: Math.max(0.35, 1 - idx / 30) }} title={`${new Date(log.date).toLocaleDateString("en-GB")} · ${log.litres}L`} />
                ))}
              </div>
            </div>
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="bg-surface text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Litres</th><th className="px-3 py-2 text-left">Note</th></tr>
                </thead>
                <tbody>
                  {inventory.fuelLogs.map((log) => (
                    <tr key={log.id} className="border-t border-border">
                      <td className="px-3 py-2">{new Date(log.date).toLocaleDateString("en-GB")}</td>
                      <td className="px-3 py-2">{log.litres}L</td>
                      <td className="px-3 py-2">{log.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <h3 className="text-sm font-semibold">Threshold controls</h3>
            <div className="grid gap-3">
              <InfoBox label="Reserve threshold" value={`${inventory.fuelThreshold}%`} />
              {canEdit ? (
                <>
                  <label className="block">
                    <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Set threshold</div>
                    <input
                      type="range"
                      min={10}
                      max={90}
                      value={inventory.fuelThreshold}
                      onChange={(e) => updateState((prev) => ({ ...prev, fuelThreshold: Number(e.target.value) }))}
                      className="w-full"
                    />
                  </label>
                  <div className="rounded-md border border-border bg-surface p-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Log fuel delivery</div>
                    <div className="mt-2 grid gap-2">
                      <input type="number" min={50} max={5000} value={deliveryLitres} onChange={(e) => setDeliveryLitres(Number(e.target.value))} className="inp" />
                      <input value={fuelLogNote} onChange={(e) => setFuelLogNote(e.target.value)} placeholder="Delivery note" className="inp" />
                      <button onClick={addFuelDelivery} className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                        <Save className="h-3.5 w-3.5" /> Save delivery
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-md border border-dashed border-border bg-surface p-4 text-sm text-muted-foreground">Threshold changes and fuel deliveries are manager-only.</div>
              )}
            </div>
          </div>
        </section>
      )}

      {editingOfficer && canEdit && (
        <EditorModal title={editingOfficer.id.startsWith("off-") ? "Edit officer" : "Add officer"} onClose={() => setEditingOfficer(null)} onSave={rosterCommit}>
          <div className="grid gap-2">
            <input className="inp" value={editingOfficer.name} onChange={(e) => setEditingOfficer({ ...editingOfficer, name: e.target.value })} placeholder="Name" />
            <input className="inp" value={editingOfficer.badge} onChange={(e) => setEditingOfficer({ ...editingOfficer, badge: e.target.value })} placeholder="Badge" />
            <input className="inp" value={editingOfficer.location} onChange={(e) => setEditingOfficer({ ...editingOfficer, location: e.target.value })} placeholder="Location" />
            <input className="inp" value={editingOfficer.zone} onChange={(e) => setEditingOfficer({ ...editingOfficer, zone: e.target.value })} placeholder="Zone" />
            <input className="inp" value={editingOfficer.shift} onChange={(e) => setEditingOfficer({ ...editingOfficer, shift: e.target.value })} placeholder="Shift" />
            <input className="inp" value={editingOfficer.contact} onChange={(e) => setEditingOfficer({ ...editingOfficer, contact: e.target.value })} placeholder="Contact" />
          </div>
        </EditorModal>
      )}

      {editingVehicle && canEdit && (
        <EditorModal title="Edit vehicle" onClose={() => setEditingVehicle(null)} onSave={vehicleCommit}>
          <div className="grid gap-2">
            <input className="inp" value={editingVehicle.vehicleId} onChange={(e) => setEditingVehicle({ ...editingVehicle, vehicleId: e.target.value })} placeholder="Vehicle ID" />
            <input className="inp" value={editingVehicle.type} onChange={(e) => setEditingVehicle({ ...editingVehicle, type: e.target.value })} placeholder="Type" />
            <input className="inp" value={editingVehicle.condition} onChange={(e) => setEditingVehicle({ ...editingVehicle, condition: e.target.value })} placeholder="Condition" />
            <input className="inp" value={editingVehicle.driver} onChange={(e) => setEditingVehicle({ ...editingVehicle, driver: e.target.value })} placeholder="Driver" />
          </div>
        </EditorModal>
      )}

      <style>{`.inp{width:100%;border-radius:.375rem;border:1px solid var(--border);background:var(--surface);padding:.5rem .65rem;font-size:.8125rem;color:var(--foreground)}.inp:focus{outline:none;box-shadow:0 0 0 1px var(--ring)}.thin-scroll::-webkit-scrollbar{height:6px;width:6px}.thin-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,.15);border-radius:999px}`}</style>
    </div>
  );
}

function newOfficer(): OfficerRow {
  return {
    id: `off-${Date.now()}`,
    user_id: `temp-${Date.now()}`,
    name: "",
    badge: "",
    status: "off-duty",
    armed: false,
    location: "Unassigned",
    zone: "Unassigned",
    shift: "Pending",
    certifications: ["Radio"],
    contact: "Set contact",
  };
}

function normalizeInventorySnapshot(
  snapshot: unknown,
  fallback: {
    officers: OfficerRow[];
    vehicles: VehicleRow[];
    weapons: WeaponRow[];
    ammo: AmmoRow[];
    equipment: EquipmentRow[];
    fuelReserve: FuelReserveRow | null;
    inventoryAlerts: InventoryAlert[];
  },
): InventoryState {
  const record = snapshot && typeof snapshot === "object" ? (snapshot as Partial<InventoryState>) : null;
  if (
    record &&
    Array.isArray(record.officers) &&
    Array.isArray(record.vehicles) &&
    Array.isArray(record.weapons) &&
    Array.isArray(record.ammo) &&
    Array.isArray(record.equipment) &&
    Array.isArray(record.alerts)
  ) {
    return {
      officers: record.officers as OfficerRow[],
      vehicles: record.vehicles as VehicleRow[],
      weapons: record.weapons as WeaponRow[],
      ammo: record.ammo as AmmoRow[],
      equipment: record.equipment as EquipmentRow[],
      fuelReserve: Number(record.fuelReserve ?? 0),
      fuelThreshold: Number(record.fuelThreshold ?? 0),
      fuelLogs: Array.isArray(record.fuelLogs) ? (record.fuelLogs as FuelLog[]) : [],
      alerts: record.alerts as InventoryAlert[],
    };
  }

  const reserve = fallback.fuelReserve;
  const fuelReserve = Number(reserve?.current_litres ?? 0);
  const fuelThreshold = reserve && Number(reserve.capacity_litres) > 0
    ? Math.round((Number(reserve.threshold_litres ?? 0) / Number(reserve.capacity_litres)) * 100)
    : 0;

  return {
    officers: fallback.officers.map((officer) => ({ ...officer })),
    vehicles: fallback.vehicles.map((vehicle) => ({ ...vehicle })),
    weapons: fallback.weapons.map((weapon) => ({ ...weapon })),
    ammo: fallback.ammo.map((row) => ({ ...row })),
    equipment: fallback.equipment.map((row) => ({ ...row })),
    fuelReserve,
    fuelThreshold,
    fuelLogs: reserve
      ? [{
          id: reserve.id,
          date: reserve.updated_at || reserve.last_restocked || new Date().toISOString(),
          litres: fuelReserve,
          note: "Current reserve snapshot",
        }]
      : [],
    alerts: fallback.inventoryAlerts.map((alert) => ({ ...alert })),
  };
}

function vehicleTone(status: VehicleRow["status"], fuel: number) {
  if (status === "unavailable") return "border-critical/40 bg-critical/10";
  if (fuel < 30) return "border-high/40 bg-high/10";
  return "border-resolved/30 bg-resolved/10";
}

function statusPill(status: OfficerRow["status"]) {
  const tone = status === "on-duty" ? "border-resolved/30 bg-resolved/10 text-resolved" : status === "break" ? "border-high/30 bg-high/10 text-high" : "border-border bg-surface text-muted-foreground";
  return <span className={`rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${tone}`}>{status}</span>;
}

function weaponStatus(status: WeaponRow["status"]) {
  const tone = status === "issued" ? "border-high/30 bg-high/10 text-high" : status === "maintenance" ? "border-critical/30 bg-critical/10 text-critical" : "border-resolved/30 bg-resolved/10 text-resolved";
  return <span className={`rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${tone}`}>{status}</span>;
}

function Metric({ icon: Icon, label, value, sub }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function Pill({ label, value, tone }: { label: string; value: string; tone?: "critical" | "muted" }) {
  return (
    <div className={`rounded-md border px-3 py-2 ${tone === "critical" ? "border-critical/30 bg-critical/10" : "border-border bg-surface"}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${tone === "critical" ? "text-critical" : ""}`}>{value}</div>
    </div>
  );
}

function SelectBox({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5 text-xs">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <select className="bg-transparent outline-none" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => <option key={option} value={option}>{option || "All"}</option>)}
      </select>
    </label>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="relative inline-flex items-center">
      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-56 rounded-md border border-border bg-surface pl-7 pr-3 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
    </label>
  );
}

function DetailPanel({ title, visible, onClose, children }: { title: string; visible: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!visible) return <aside className="rounded-lg border border-dashed border-border bg-surface p-4 text-sm text-muted-foreground">Select an item to view details.</aside>;
  return (
    <aside className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
      </div>
      {children}
    </aside>
  );
}

function EditorModal({ title, onClose, onSave, children }: { title: string; onClose: () => void; onSave: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card p-4 shadow-elegant">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
        </div>
        <div className="mt-3 space-y-3">{children}</div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border bg-surface px-3 py-2 text-xs hover:bg-surface-2">Cancel</button>
          <button onClick={onSave} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"><Save className="h-3.5 w-3.5" /> Save</button>
        </div>
      </div>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm">{value}</div>
    </div>
  );
}

function InfoBox({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-border bg-background px-2 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

function FuelBar({ fuel }: { fuel: number }) {
  return (
    <div className="mt-3 h-3 overflow-hidden rounded-full bg-background">
      <div className={`h-full rounded-full ${fuel < 30 ? "bg-critical" : fuel < 50 ? "bg-high" : "bg-resolved"}`} style={{ width: `${fuel}%` }} />
    </div>
  );
}

function ensureAlert(alerts: InventoryAlert[], alert: InventoryAlert) {
  if (alerts.some((a) => a.id === alert.id)) return alerts;
  return [alert, ...alerts];
}
