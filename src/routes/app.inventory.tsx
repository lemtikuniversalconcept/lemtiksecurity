import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  getInventory,
  addInventoryItem,
  logFuelDelivery,
  updateOfficerInventory,
  updateVehicleInventory,
  updateWeaponInventory,
  updateEquipment,
  resolveInventoryAlert,
} from "@/lib/inventory.functions";
import { useRealtimeInvalidate } from "@/lib/useRealtime";
import { requireSectionAccess } from "@/lib/rbac";
import { Loader2, Pencil, Plus, Printer, Search, Wrench, X } from "lucide-react";
import { Empty, Kpi, Notice, PageHeader, Panel, Status, Tabs, Tag, timeAgo, type Tone } from "@/components/nw";

type Tab = "roster" | "fleet" | "weapons" | "equipment" | "fuel";
type OfficerRow = { id: string; name: string; badge: string; status: string; armed: boolean; location: string; zone: string; shift: string; certifications: string[]; contact: string };
type VehicleRow = { id: string; vehicleId: string; type: string; status: string; fuel: number; condition: string; driver: string; zone: string; location: string };
type WeaponRow = { id: string; weaponId: string; type: string; status: string; issuedTo: string | null; notes: string };
type AmmoRow = { id: string; type: string; quantity: number; threshold: number };
type EquipmentRow = { id: string; category: string; available: number; inUse: number; total: number };
type AlertRow = { id: string; resource: string; currentValue: string; threshold: string; action: string; level: string | null; createdAt: string | null };
type Snapshot = {
  officers: OfficerRow[];
  vehicles: VehicleRow[];
  weapons: WeaponRow[];
  ammo: AmmoRow[];
  equipment: EquipmentRow[];
  fuelReserve: number;
  fuelCapacity: number | null;
  fuelThresholdLitres: number | null;
  fuelUpdatedAt: string | null;
  hasFuelRecord: boolean;
  alerts: AlertRow[];
};

// The server maps missing values to these placeholder strings; treat them as empty when editing.
const PLACEHOLDERS = new Set(["—", "Unassigned"]);
const clean = (v: string | null | undefined) => (v && !PLACEHOLDERS.has(v) ? v : "");
const OFFICER_TONE: Record<string, Tone> = { "on-duty": "ok", responding: "blue", break: "warn", "off-duty": "off" };
const VEHICLE_TONE: Record<string, Tone> = { available: "ok", deployed: "blue", in_use: "blue", unavailable: "fail", maintenance: "warn", low_fuel: "warn" };
const WEAPON_TONE: Record<string, Tone> = { available: "ok", issued: "blue", maintenance: "warn" };
const words = (s: unknown) => String(s ?? "").replace(/[_-]/g, " ");

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
  const qc = useQueryClient();
  const load = useServerFn(getInventory);
  const addFn = useServerFn(addInventoryItem);
  const saveOfficerFn = useServerFn(updateOfficerInventory);
  const saveVehicleFn = useServerFn(updateVehicleInventory);
  const saveWeaponFn = useServerFn(updateWeaponInventory);
  const saveEquipmentFn = useServerFn(updateEquipment);
  const fuelFn = useServerFn(logFuelDelivery);
  const resolveFn = useServerFn(resolveInventoryAlert);

  const key = ["inventory-snapshot", appAccess.orgId];
  const { data, isLoading, error } = useQuery({ queryKey: key, queryFn: () => load({ data: { org_id: appAccess.orgId, scope: "overview" } }) as Promise<Snapshot> });
  for (const table of ["officers", "vehicles", "weapons", "ammunition", "tactical_equipment", "fuel_reserves", "inventory_alerts"]) {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- fixed list, same order every render
    useRealtimeInvalidate(table, [key]);
  }

  const [tab, setTab] = useState<Tab>("roster");
  const [busy, setBusy] = useState<string | null>(null);
  const [editingOfficer, setEditingOfficer] = useState<{ row: OfficerRow; isNew: boolean } | null>(null);
  const [editingVehicle, setEditingVehicle] = useState<VehicleRow | null>(null);
  const [issuing, setIssuing] = useState<WeaponRow | null>(null);

  /** Runs a save, reports the outcome honestly, and refetches the real state. */
  const run = async (id: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(id);
    try {
      await fn();
      toast.success(done);
      await qc.invalidateQueries({ queryKey: key });
      return true;
    } catch (e) {
      toast.error((e as Error)?.message || "That didn't save.");
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (error) {
    return (
      <div className="col g16">
        <PageHeader title="Inventory" />
        <Notice tone="fail">Inventory couldn't be loaded. {(error as Error).message}</Notice>
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="col g16">
        <PageHeader title="Inventory" sub="Loading…" />
        <Panel>
          <Empty>
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading inventory…
          </Empty>
        </Panel>
      </div>
    );
  }

  const inv = data;
  const onDuty = inv.officers.filter((o) => o.status === "on-duty").length;
  const onBreak = inv.officers.filter((o) => o.status === "break").length;
  const ready = inv.vehicles.filter((v) => v.status === "available").length;
  const inArmoury = inv.weapons.filter((w) => w.status === "available").length;
  const lowAmmo = inv.ammo.filter((a) => a.threshold > 0 && a.quantity <= a.threshold).length;
  const equipAvail = inv.equipment.reduce((a, e) => a + e.available, 0);
  const equipTotal = inv.equipment.reduce((a, e) => a + e.total, 0);
  const fuelPct = inv.fuelCapacity ? Math.round((inv.fuelReserve / inv.fuelCapacity) * 100) : null;

  const saveOfficer = (row: OfficerRow, isNew: boolean) =>
    run(
      `officer:${row.id}`,
      async () => {
        const payload = {
          id: row.id,
          name: row.name.trim(),
          badge: row.badge.trim() || undefined,
          status: row.status,
          armed: row.armed,
          zone: row.zone.trim() || undefined,
          location: row.zone.trim() || undefined,
          certifications: row.certifications,
          contact: row.contact.trim() || undefined,
        };
        if (isNew) await addFn({ data: { id: row.id, type: "officer", action: "add", org_id: appAccess.orgId, payload } });
        else await saveOfficerFn({ data: payload });
      },
      isNew ? "Officer added" : "Officer saved",
    );

  const saveVehicle = (v: VehicleRow, done = "Vehicle saved") =>
    run(
      `vehicle:${v.id}`,
      () =>
        saveVehicleFn({
          data: { id: v.id, vehicleId: v.vehicleId, type: v.type, status: v.status, fuel: v.fuel, condition: clean(v.condition) || undefined, zone: clean(v.zone) || undefined, location: clean(v.location) || undefined },
        }),
      done,
    );

  const setWeapon = (w: WeaponRow, status: string, issuedTo: string | null, done: string) =>
    run(`weapon:${w.id}`, () => saveWeaponFn({ data: { id: w.id, weaponId: w.weaponId, type: w.type, status, issuedTo, notes: w.notes || undefined } }), done);

  const moveEquipment = (e: EquipmentRow, delta: 1 | -1) =>
    run(
      `equip:${e.id}`,
      () => saveEquipmentFn({ data: { id: e.id, category: e.category, total: e.total, available: e.available - delta, inUse: e.inUse + delta } }),
      delta === 1 ? `${e.category}: one checked out` : `${e.category}: one checked in`,
    );

  return (
    <div className="col g16">
      <PageHeader title="Inventory" sub="People, vehicles, equipment and fuel. Thresholds are set by the security manager.">
        <button type="button" className="b b-sec" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Export roster
        </button>
        {canEdit && (
          <button
            type="button"
            className="b b-pri"
            onClick={() => {
              setTab("roster");
              setEditingOfficer({ row: { id: crypto.randomUUID(), name: "", badge: "", status: "off-duty", armed: false, location: "", zone: "", shift: "", certifications: [], contact: "" }, isNew: true });
            }}
          >
            <Plus className="h-4 w-4" /> Add officer
          </button>
        )}
      </PageHeader>

      <div className="kpis">
        <Kpi label="Officers on duty" value={onDuty} unit={`/ ${inv.officers.length}`} delta={onBreak ? `${onBreak} on break` : undefined} />
        <Kpi label="Vehicles ready" value={ready} unit={`/ ${inv.vehicles.length}`} />
        <Kpi label="Weapons in armoury" value={inArmoury} unit={`/ ${inv.weapons.length}`} />
        <Kpi label="Ammunition below minimum" value={lowAmmo} unit={`of ${inv.ammo.length} types`} deltaClass={lowAmmo ? "up-bad" : ""} />
        <Kpi label="Equipment available" value={equipAvail} unit={`/ ${equipTotal}`} />
        <Kpi label="Fuel reserve" value={inv.hasFuelRecord ? Math.round(inv.fuelReserve) : "—"} unit={inv.hasFuelRecord ? "L" : undefined} delta={fuelPct != null ? `${fuelPct}% of ${inv.fuelCapacity} L` : inv.hasFuelRecord ? undefined : "Not set up"} />
      </div>

      <Panel
        title="Below threshold"
        meta={`${inv.alerts.length} active`}
        actions={
          canEdit ? (
            <Link to="/app/org" className="b b-sm b-gh">
              Edit thresholds
            </Link>
          ) : undefined
        }
        bodyClassName=""
      >
        {inv.alerts.length === 0 ? (
          <Empty>Nothing is below its threshold.</Empty>
        ) : (
          <div className="list">
            {inv.alerts.map((a) => (
              <div key={a.id} className="row g10" style={{ padding: "10px 14px" }}>
                <Tag tone={a.level === "critical" ? "fail" : "warn"}>{a.level ? words(a.level) : "Alert"}</Tag>
                <span className="f1 col" style={{ minWidth: 0 }}>
                  <b className="trunc">
                    {words(a.resource)} · {a.currentValue}
                  </b>
                  <span className="t3 trunc">
                    Threshold {a.threshold}
                    {a.action ? ` · ${a.action}` : ""}
                  </span>
                </span>
                {a.createdAt && <span className="mono t3">{timeAgo(a.createdAt)}</span>}
                {canEdit && (
                  <button type="button" className="b b-sm b-sec" disabled={busy === `alert:${a.id}`} onClick={() => run(`alert:${a.id}`, () => resolveFn({ data: { id: a.id } }), "Alert resolved")}>
                    Resolve
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <section className="pn">
        <div style={{ padding: "0 14px" }}>
          <Tabs
            label="Inventory sections"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "roster", label: "Roster", count: inv.officers.length },
              { value: "fleet", label: "Fleet", count: inv.vehicles.length },
              { value: "weapons", label: "Weapons & ammo", count: inv.weapons.length },
              { value: "equipment", label: "Equipment", count: inv.equipment.length },
              { value: "fuel", label: "Fuel" },
            ]}
          />
        </div>
        {tab === "roster" && <Roster officers={inv.officers} canEdit={canEdit} onEdit={(row) => setEditingOfficer({ row: { ...row, badge: clean(row.badge), zone: clean(row.zone), location: clean(row.location), contact: clean(row.contact) }, isNew: false })} />}
        {tab === "fleet" && (
          <Fleet
            vehicles={inv.vehicles}
            canEdit={canEdit}
            busy={busy}
            onEdit={setEditingVehicle}
            onService={(v) => saveVehicle({ ...v, status: "unavailable", condition: "Service required" }, `${v.vehicleId} marked for service`)}
          />
        )}
        {tab === "weapons" && (
          <Weapons weapons={inv.weapons} ammo={inv.ammo} canEdit={canEdit} busy={busy} onIssue={setIssuing} onReturn={(w) => setWeapon(w, "available", null, `${w.weaponId} returned to the armoury`)} />
        )}
        {tab === "equipment" && <Equipment items={inv.equipment} canEdit={canEdit} busy={busy} onMove={moveEquipment} />}
        {tab === "fuel" && <Fuel inv={inv} canEdit={canEdit} busy={busy} run={run} fuelFn={fuelFn} />}
      </section>

      {editingOfficer && canEdit && (
        <OfficerEditor
          initial={editingOfficer.row}
          isNew={editingOfficer.isNew}
          saving={busy === `officer:${editingOfficer.row.id}`}
          onClose={() => setEditingOfficer(null)}
          onSave={async (row) => {
            if (await saveOfficer(row, editingOfficer.isNew)) setEditingOfficer(null);
          }}
        />
      )}
      {editingVehicle && canEdit && (
        <VehicleEditor
          initial={editingVehicle}
          saving={busy === `vehicle:${editingVehicle.id}`}
          onClose={() => setEditingVehicle(null)}
          onSave={async (v) => {
            if (await saveVehicle(v)) setEditingVehicle(null);
          }}
        />
      )}
      {issuing && canEdit && (
        <IssueWeapon
          weapon={issuing}
          officers={inv.officers}
          saving={busy === `weapon:${issuing.id}`}
          onClose={() => setIssuing(null)}
          onIssue={async (name) => {
            if (await setWeapon(issuing, "issued", name, `${issuing.weaponId} issued to ${name}`)) setIssuing(null);
          }}
        />
      )}
    </div>
  );
}

function Roster({ officers, canEdit, onEdit }: { officers: OfficerRow[]; canEdit: boolean; onEdit: (o: OfficerRow) => void }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [armed, setArmed] = useState<"all" | "armed" | "unarmed">("all");
  const [zone, setZone] = useState("");
  const zones = useMemo(() => Array.from(new Set(officers.map((o) => clean(o.zone)).filter(Boolean))).sort(), [officers]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return officers.filter(
      (o) =>
        (!status || o.status === status) &&
        (armed === "all" || (armed === "armed") === o.armed) &&
        (!zone || clean(o.zone) === zone) &&
        (!s || [o.name, o.badge, o.zone, o.contact, o.certifications.join(" ")].join(" ").toLowerCase().includes(s)),
    );
  }, [officers, q, status, armed, zone]);

  return (
    <div className="col">
      <div className="row g8 wrap" style={{ padding: "12px 14px" }}>
        <label className="in row g8" style={{ width: 240 }}>
          <Search className="h-4 w-4 t3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search officers" aria-label="Search officers" className="f1" style={{ background: "transparent", border: 0, outline: "none", color: "inherit", minWidth: 0 }} />
        </label>
        <select className="in" style={{ width: "auto" }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          <option value="on-duty">On duty</option>
          <option value="responding">Responding</option>
          <option value="break">On break</option>
          <option value="off-duty">Off duty</option>
        </select>
        <select className="in" style={{ width: "auto" }} value={armed} onChange={(e) => setArmed(e.target.value as typeof armed)} aria-label="Armed">
          <option value="all">Armed or not</option>
          <option value="armed">Armed</option>
          <option value="unarmed">Unarmed</option>
        </select>
        {zones.length > 0 && (
          <select className="in" style={{ width: "auto" }} value={zone} onChange={(e) => setZone(e.target.value)} aria-label="Zone">
            <option value="">Any zone</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        )}
      </div>
      {rows.length === 0 ? (
        <Empty>{officers.length ? "No officers match these filters." : "No officers on the roster yet."}</Empty>
      ) : (
        <div className="scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Officer</th>
                <th>Status</th>
                <th>Armed</th>
                <th>Zone</th>
                <th>Shift</th>
                <th>Certifications</th>
                <th>Contact</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td>
                    <div className="col">
                      <b>{o.name}</b>
                      <span className="mono t3" style={{ fontSize: 11 }}>
                        {o.badge}
                      </span>
                    </div>
                  </td>
                  <td>
                    <Status tone={OFFICER_TONE[o.status] ?? "neutral"}>{words(o.status)}</Status>
                  </td>
                  <td>{o.armed ? "Yes" : "No"}</td>
                  <td className="t2">{o.zone}</td>
                  <td className="mono t2">{o.shift}</td>
                  <td className="t2">{o.certifications.length ? o.certifications.join(", ") : "—"}</td>
                  <td className="mono t2">{o.contact}</td>
                  <td>
                    {canEdit && (
                      <button type="button" className="b b-sm b-gh" onClick={() => onEdit(o)} aria-label={`Edit ${o.name}`}>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Fleet({ vehicles, canEdit, busy, onEdit, onService }: { vehicles: VehicleRow[]; canEdit: boolean; busy: string | null; onEdit: (v: VehicleRow) => void; onService: (v: VehicleRow) => void }) {
  if (vehicles.length === 0) return <Empty>No vehicles registered.</Empty>;
  return (
    <div className="scroll">
      <table className="tbl">
        <thead>
          <tr>
            <th>Vehicle</th>
            <th>Status</th>
            <th>Fuel</th>
            <th>Condition</th>
            <th>Location</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {vehicles.map((v) => (
            <tr key={v.id}>
              <td>
                <div className="col">
                  <b className="mono">{v.vehicleId}</b>
                  <span className="t3">{v.type}</span>
                </div>
              </td>
              <td>
                <Status tone={VEHICLE_TONE[v.status] ?? "neutral"}>{words(v.status)}</Status>
              </td>
              <td style={{ minWidth: 130 }}>
                <div className="row g8">
                  <div className="prog f1">
                    <i style={{ width: `${v.fuel}%`, background: v.fuel < 30 ? "var(--fail)" : v.fuel < 50 ? "var(--warn)" : "var(--ok)" }} />
                  </div>
                  <span className="mono t3" style={{ fontSize: 11 }}>
                    {v.fuel}%
                  </span>
                </div>
              </td>
              <td className="t2">{v.condition}</td>
              <td className="t2">{v.location}</td>
              <td>
                {canEdit && (
                  <span className="row g6" style={{ justifyContent: "flex-end" }}>
                    <button type="button" className="b b-sm b-gh" onClick={() => onEdit(v)}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                    {v.status !== "unavailable" && (
                      <button type="button" className="b b-sm b-gh" disabled={busy === `vehicle:${v.id}`} onClick={() => onService(v)}>
                        <Wrench className="h-3.5 w-3.5" /> Service
                      </button>
                    )}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Weapons({ weapons, ammo, canEdit, busy, onIssue, onReturn }: { weapons: WeaponRow[]; ammo: AmmoRow[]; canEdit: boolean; busy: string | null; onIssue: (w: WeaponRow) => void; onReturn: (w: WeaponRow) => void }) {
  return (
    <div className="col">
      {weapons.length === 0 ? (
        <Empty>No weapons registered.</Empty>
      ) : (
        <div className="scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Serial</th>
                <th>Type</th>
                <th>Status</th>
                <th>Issued to</th>
                <th>Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {weapons.map((w) => (
                <tr key={w.id}>
                  <td className="mono">{w.weaponId}</td>
                  <td>{w.type}</td>
                  <td>
                    <Status tone={WEAPON_TONE[w.status] ?? "neutral"}>{words(w.status)}</Status>
                  </td>
                  <td>{w.issuedTo ?? "—"}</td>
                  <td className="t2">{w.notes || "—"}</td>
                  <td>
                    {canEdit && w.status === "available" && (
                      <button type="button" className="b b-sm b-sec" disabled={busy === `weapon:${w.id}`} onClick={() => onIssue(w)}>
                        Issue
                      </button>
                    )}
                    {canEdit && w.status === "issued" && (
                      <button type="button" className="b b-sm b-gh" disabled={busy === `weapon:${w.id}`} onClick={() => onReturn(w)}>
                        Return
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="hr" />
      <div className="pn-h">
        <h3>Ammunition</h3>
        <span className="meta">{ammo.length}</span>
      </div>
      {ammo.length === 0 ? (
        <Empty>No ammunition records.</Empty>
      ) : (
        <div className="scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Type</th>
                <th>In stock</th>
                <th>Minimum</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ammo.map((a) => {
                const low = a.threshold > 0 && a.quantity <= a.threshold;
                return (
                  <tr key={a.id}>
                    <td>{a.type}</td>
                    <td className="mono">{a.quantity}</td>
                    <td className="mono t2">{a.threshold || "—"}</td>
                    <td>{low && <Tag tone="warn">Below minimum</Tag>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Equipment({ items, canEdit, busy, onMove }: { items: EquipmentRow[]; canEdit: boolean; busy: string | null; onMove: (e: EquipmentRow, d: 1 | -1) => void }) {
  if (items.length === 0) return <Empty>No equipment recorded.</Empty>;
  return (
    <div className="scroll">
      <table className="tbl">
        <thead>
          <tr>
            <th>Item</th>
            <th>Available</th>
            <th>In use</th>
            <th>Total</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((e) => (
            <tr key={e.id}>
              <td>
                <b>{e.category}</b>
              </td>
              <td className="mono">{e.available}</td>
              <td className="mono">{e.inUse}</td>
              <td className="mono t2">{e.total}</td>
              <td>
                {canEdit && (
                  <span className="row g6" style={{ justifyContent: "flex-end" }}>
                    <button type="button" className="b b-sm b-sec" disabled={e.available === 0 || busy === `equip:${e.id}`} onClick={() => onMove(e, 1)}>
                      Check out
                    </button>
                    <button type="button" className="b b-sm b-gh" disabled={e.inUse === 0 || busy === `equip:${e.id}`} onClick={() => onMove(e, -1)}>
                      Check in
                    </button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Fuel({
  inv,
  canEdit,
  busy,
  run,
  fuelFn,
}: {
  inv: Snapshot;
  canEdit: boolean;
  busy: string | null;
  run: (id: string, fn: () => Promise<unknown>, done: string) => Promise<boolean>;
  fuelFn: (args: { data: { litresAdded?: number; threshold_litres?: number; capacity_litres?: number; current_litres?: number } }) => Promise<unknown>;
}) {
  const [litres, setLitres] = useState("");
  const [threshold, setThreshold] = useState(inv.fuelThresholdLitres != null ? String(inv.fuelThresholdLitres) : "");
  const [capacity, setCapacity] = useState("");
  const pct = inv.fuelCapacity ? Math.min(100, Math.round((inv.fuelReserve / inv.fuelCapacity) * 100)) : null;
  const low = inv.fuelThresholdLitres != null && inv.fuelReserve <= inv.fuelThresholdLitres;

  if (!inv.hasFuelRecord) {
    return (
      <div className="pn-b col g12" style={{ maxWidth: 520 }}>
        <span className="t2">No fuel reserve is set up for this organisation yet.</span>
        {canEdit && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label className="fl">
                <span className="lbl">Tank capacity (L)</span>
                <input className="in mono" type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
              </label>
              <label className="fl">
                <span className="lbl">Current level (L)</span>
                <input className="in mono" type="number" min={0} value={litres} onChange={(e) => setLitres(e.target.value)} />
              </label>
            </div>
            <div className="row">
              <button
                type="button"
                className="b b-pri"
                disabled={!Number(capacity) || busy === "fuel"}
                onClick={() => run("fuel", () => fuelFn({ data: { capacity_litres: Number(capacity), current_litres: Number(litres) || 0, litresAdded: 0 } }), "Fuel reserve set up")}
              >
                Set up fuel reserve
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="pn-b grid gap-6 lg:grid-cols-2">
      <div className="col g10">
        <span className="eyebrow">Current reserve</span>
        <div className="row g8" style={{ alignItems: "baseline" }}>
          <b style={{ fontSize: 28, fontVariantNumeric: "tabular-nums" }}>{Math.round(inv.fuelReserve)} L</b>
          {inv.fuelCapacity ? <span className="t3">of {inv.fuelCapacity} L</span> : null}
          {low && <Tag tone="warn">Below threshold</Tag>}
        </div>
        {pct != null && (
          <div className="prog" style={{ height: 10, borderRadius: 5 }}>
            <i style={{ width: `${pct}%`, background: low ? "var(--warn)" : "var(--ok)" }} />
          </div>
        )}
        <span className="t3" style={{ fontSize: 12 }}>
          {inv.fuelThresholdLitres != null ? `Alert below ${inv.fuelThresholdLitres} L` : "No alert threshold set"}
          {inv.fuelUpdatedAt ? ` · updated ${new Date(inv.fuelUpdatedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}
        </span>
      </div>
      {canEdit ? (
        <div className="col g12">
          <div className="row g8" style={{ alignItems: "flex-end" }}>
            <label className="fl f1">
              <span className="lbl">Log a delivery (litres)</span>
              <input className="in mono" type="number" min={1} value={litres} onChange={(e) => setLitres(e.target.value)} />
            </label>
            <button
              type="button"
              className="b b-pri"
              disabled={!(Number(litres) > 0) || busy === "fuel"}
              onClick={async () => {
                if (await run("fuel", () => fuelFn({ data: { litresAdded: Number(litres) } }), `${Number(litres)} L logged`)) setLitres("");
              }}
            >
              Log delivery
            </button>
          </div>
          {inv.fuelCapacity != null && Number(litres) > 0 && inv.fuelReserve + Number(litres) > inv.fuelCapacity && (
            <Notice tone="warn">That's more than the tank holds. The reserve will be capped at {inv.fuelCapacity} L.</Notice>
          )}
          <div className="row g8" style={{ alignItems: "flex-end" }}>
            <label className="fl f1">
              <span className="lbl">Alert threshold (litres)</span>
              <input className="in mono" type="number" min={0} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
            </label>
            <button
              type="button"
              className="b b-sec"
              disabled={threshold === "" || Number(threshold) === inv.fuelThresholdLitres || busy === "fuel"}
              onClick={() => run("fuel", () => fuelFn({ data: { threshold_litres: Number(threshold), litresAdded: 0 } }), "Threshold saved")}
            >
              Save threshold
            </button>
          </div>
        </div>
      ) : (
        <span className="t3">Fuel deliveries and thresholds are managed by the security manager.</span>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center px-4" style={{ background: "rgba(5,7,10,.72)" }} role="dialog" aria-modal="true" aria-label={title}>
      <div className="pn w-full" style={{ maxWidth: 520, borderColor: "var(--line-2)" }}>
        <div className="pn-h">
          <h3 style={{ fontSize: 15 }}>{title}</h3>
          <button type="button" onClick={onClose} className="ibtn ml-auto" style={{ width: 28, height: 28 }} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className="pn-b">{children}</div>
      </div>
    </div>
  );
}

function Actions({ onClose, saving, disabled, label = "Save" }: { onClose: () => void; saving: boolean; disabled?: boolean; label?: string }) {
  return (
    <div className="row g8" style={{ justifyContent: "flex-end", marginTop: 14 }}>
      <button type="button" className="b b-gh" onClick={onClose}>
        Cancel
      </button>
      <button type="submit" className="b b-pri" disabled={saving || disabled}>
        {saving && <Loader2 className="h-4 w-4 animate-spin" />} {label}
      </button>
    </div>
  );
}

function OfficerEditor({ initial, isNew, saving, onClose, onSave }: { initial: OfficerRow; isNew: boolean; saving: boolean; onClose: () => void; onSave: (o: OfficerRow) => void }) {
  const [o, setO] = useState(initial);
  const [certs, setCerts] = useState(initial.certifications.join(", "));
  return (
    <Modal title={isNew ? "Add officer" : `Edit ${initial.name}`} onClose={onClose}>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ ...o, certifications: certs.split(",").map((c) => c.trim()).filter(Boolean) });
        }}
      >
        <label className="fl sm:col-span-2">
          <span className="lbl">Name</span>
          <input className="in" required value={o.name} onChange={(e) => setO({ ...o, name: e.target.value })} />
        </label>
        <label className="fl">
          <span className="lbl">Badge number</span>
          <input className="in mono" value={o.badge} onChange={(e) => setO({ ...o, badge: e.target.value })} />
        </label>
        <label className="fl">
          <span className="lbl">Status</span>
          <select className="in" value={o.status} onChange={(e) => setO({ ...o, status: e.target.value })}>
            <option value="on-duty">On duty</option>
            <option value="responding">Responding</option>
            <option value="break">On break</option>
            <option value="off-duty">Off duty</option>
          </select>
        </label>
        <label className="fl">
          <span className="lbl">Zone</span>
          <input className="in" value={o.zone} onChange={(e) => setO({ ...o, zone: e.target.value })} />
        </label>
        <label className="fl">
          <span className="lbl">Contact</span>
          <input className="in mono" value={o.contact} onChange={(e) => setO({ ...o, contact: e.target.value })} />
        </label>
        <label className="fl sm:col-span-2">
          <span className="lbl">Certifications (comma separated)</span>
          <input className="in" value={certs} onChange={(e) => setCerts(e.target.value)} />
        </label>
        <label className="row g8 sm:col-span-2" style={{ fontSize: 13 }}>
          <input type="checkbox" checked={o.armed} onChange={(e) => setO({ ...o, armed: e.target.checked })} /> Armed officer
        </label>
        <div className="sm:col-span-2">
          <Actions onClose={onClose} saving={saving} disabled={!o.name.trim()} label={isNew ? "Add officer" : "Save"} />
        </div>
      </form>
    </Modal>
  );
}

function VehicleEditor({ initial, saving, onClose, onSave }: { initial: VehicleRow; saving: boolean; onClose: () => void; onSave: (v: VehicleRow) => void }) {
  const [v, setV] = useState({ ...initial, condition: clean(initial.condition), location: clean(initial.location), zone: clean(initial.zone) });
  return (
    <Modal title={`Edit ${initial.vehicleId}`} onClose={onClose}>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(v);
        }}
      >
        <label className="fl">
          <span className="lbl">Vehicle ID</span>
          <input className="in mono" required value={v.vehicleId} onChange={(e) => setV({ ...v, vehicleId: e.target.value })} />
        </label>
        <label className="fl">
          <span className="lbl">Type</span>
          <input className="in" required value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })} />
        </label>
        <label className="fl">
          <span className="lbl">Status</span>
          <select className="in" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>
            {Array.from(new Set(["available", "deployed", "unavailable", "maintenance", v.status])).map((s) => (
              <option key={s} value={s}>
                {words(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="fl">
          <span className="lbl">Fuel (%)</span>
          <input className="in mono" type="number" min={0} max={100} value={v.fuel} onChange={(e) => setV({ ...v, fuel: Math.max(0, Math.min(100, Number(e.target.value))) })} />
        </label>
        <label className="fl">
          <span className="lbl">Condition</span>
          <input className="in" value={v.condition} onChange={(e) => setV({ ...v, condition: e.target.value })} />
        </label>
        <label className="fl">
          <span className="lbl">Location</span>
          <input className="in" value={v.location} onChange={(e) => setV({ ...v, location: e.target.value, zone: e.target.value })} />
        </label>
        <div className="sm:col-span-2">
          <Actions onClose={onClose} saving={saving} />
        </div>
      </form>
    </Modal>
  );
}

function IssueWeapon({ weapon, officers, saving, onClose, onIssue }: { weapon: WeaponRow; officers: OfficerRow[]; saving: boolean; onClose: () => void; onIssue: (name: string) => void }) {
  const sorted = useMemo(() => [...officers].sort((a, b) => Number(b.status === "on-duty") - Number(a.status === "on-duty") || a.name.localeCompare(b.name)), [officers]);
  const [name, setName] = useState("");
  return (
    <Modal title={`Issue ${weapon.weaponId}`} onClose={onClose}>
      <form
        className="col g12"
        onSubmit={(e) => {
          e.preventDefault();
          if (name) onIssue(name);
        }}
      >
        <span className="t2">{weapon.type}</span>
        <label className="fl">
          <span className="lbl">Issue to</span>
          <select className="in" required value={name} onChange={(e) => setName(e.target.value)}>
            <option value="" disabled>
              Choose an officer
            </option>
            {sorted.map((o) => (
              <option key={o.id} value={o.name}>
                {o.name}
                {clean(o.badge) ? ` · ${o.badge}` : ""} · {words(o.status)}
              </option>
            ))}
          </select>
        </label>
        <Actions onClose={onClose} saving={saving} disabled={!name} label="Issue weapon" />
      </form>
    </Modal>
  );
}
