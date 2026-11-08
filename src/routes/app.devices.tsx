import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Plus, PlugZap, X } from "lucide-react";
import { Empty, PageHeader, Panel, Status } from "@/components/nw";
import { requireSectionAccess } from "@/lib/rbac";
import {
  listDevices,
  registerDevice,
  checkDeviceConnectivity,
  parseLastCommandResult,
  formatRelativeTime,
  KNOWN_DEVICE_TYPES,
  type DeviceRecord,
  type ConnectionType,
} from "@/lib/devices.functions";

export const Route = createFileRoute("/app/devices")({
  head: () => ({ meta: [{ title: "Devices · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    requireSectionAccess(context.appAccess, ["security_manager"]);
  },
  component: DevicesPage,
});

type FormState = {
  name: string;
  type: string;
  connection_type: ConnectionType;
  base_url: string;
  auth_type: "bearer_token" | "api_key" | "";
  token: string;
  broker_url: string;
  mqtt_username: string;
  mqtt_password: string;
  gateway_websocket_url: string;
  bridge_key: string;
  supported_actions: string;
  zone: string;
  floor: string;
  lat: string;
  lng: string;
};

const emptyForm: FormState = {
  name: "",
  type: "sensor_camera",
  connection_type: "REST_API",
  base_url: "",
  auth_type: "api_key",
  token: "",
  broker_url: "",
  mqtt_username: "",
  mqtt_password: "",
  gateway_websocket_url: "",
  bridge_key: "",
  supported_actions: "ptz_move, snapshot, activate, deactivate, get_status",
  zone: "",
  floor: "",
  lat: "",
  lng: "",
};

function parseOptionalNumber(raw: string, parser: (v: string) => number): number | null {
  if (raw.trim() === "") return null;
  const value = parser(raw);
  return Number.isFinite(value) ? value : null;
}

function buildConnectionConfig(form: FormState): Record<string, unknown> {
  if (form.connection_type === "REST_API") {
    return {
      base_url: form.base_url,
      auth_type: form.auth_type || "api_key",
      credentials: form.auth_type === "bearer_token" ? { token: form.token } : { api_key: form.token },
    };
  }
  if (form.connection_type === "MQTT") {
    return {
      broker_url: form.broker_url,
      topic_prefix: "lemtik",
      credentials: { username: form.mqtt_username, password: form.mqtt_password },
    };
  }
  return {
    gateway_websocket_url: form.gateway_websocket_url,
    bridge_key: form.bridge_key,
  };
}

function DevicesPage() {
  const listDevicesFn = useServerFn(listDevices);
  const registerDeviceFn = useServerFn(registerDevice);
  const checkFn = useServerFn(checkDeviceConnectivity);
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [checking, setChecking] = useState<string | null>(null);
  const [checkResults, setCheckResults] = useState<Record<string, { reachable: boolean; error?: string }>>({});

  const { data: devices = [], isLoading } = useQuery({
    queryKey: ["autonomous-devices"],
    queryFn: () => listDevicesFn(),
  });

  const registerMut = useMutation({
    mutationFn: () =>
      registerDeviceFn({
        data: {
          name: form.name,
          type: form.type,
          connection_type: form.connection_type,
          connection_config: buildConnectionConfig(form),
          supported_actions: form.supported_actions.split(",").map((s) => s.trim()).filter(Boolean),
          zone: form.zone || null,
          floor: parseOptionalNumber(form.floor, (v) => Number.parseInt(v, 10)),
          lat: parseOptionalNumber(form.lat, Number.parseFloat),
          lng: parseOptionalNumber(form.lng, Number.parseFloat),
        },
      }),
    onSuccess: () => {
      toast.success("Device registered");
      setForm(emptyForm);
      setShowForm(false);
      qc.invalidateQueries({ queryKey: ["autonomous-devices"] });
    },
    onError: (err: unknown) => {
      toast.error("Failed to register device", { description: err instanceof Error ? err.message : "Unknown error." });
    },
  });

  const runCheck = async (deviceId: string) => {
    setChecking(deviceId);
    try {
      const result = await checkFn({ data: { device_id: deviceId } });
      const connectivity = (result as any)?.connectivity;
      setCheckResults((prev) => ({
        ...prev,
        [deviceId]: { reachable: Boolean(connectivity?.reachable), error: connectivity?.error },
      }));
    } catch (err) {
      toast.error("Connectivity check failed", { description: err instanceof Error ? err.message : "Unknown error." });
    } finally {
      setChecking(null);
    }
  };

  const [showForm, setShowForm] = useState(false);
  const set = (patch: Partial<FormState>) => setForm((p) => ({ ...p, ...patch }));

  return (
    <div className="col g16">
      <PageHeader
        title="Devices"
        sub={
          isLoading
            ? "Loading devices…"
            : `${devices.length} registered · gates, doors, locks, cameras and sensors the system can act on, within the limits set in Organisation settings`
        }
      >
        <button type="button" className="b b-pri" onClick={() => setShowForm((o) => !o)} aria-expanded={showForm}>
          <Plus className="h-4 w-4" /> Register device
        </button>
      </PageHeader>

      {showForm && (
        <Panel
          title="Register a device"
          actions={
            <button type="button" className="ibtn" style={{ width: 28, height: 28 }} aria-label="Close form" onClick={() => setShowForm(false)}>
              <X size={14} />
            </button>
          }
        >
          <div className="col g12">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <TextField label="Name" value={form.name} onChange={(v) => set({ name: v })} placeholder="Lobby PTZ camera" />
              <label className="fl">
                <span className="lbl">Type</span>
                <input list="device-types" className="in mono" value={form.type} onChange={(e) => set({ type: e.target.value })} />
                <datalist id="device-types">
                  {KNOWN_DEVICE_TYPES.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </label>
              <label className="fl">
                <span className="lbl">Connection</span>
                <select className="in" value={form.connection_type} onChange={(e) => set({ connection_type: e.target.value as ConnectionType })}>
                  <option value="REST_API">REST API</option>
                  <option value="MQTT">MQTT</option>
                  <option value="HARDWARE_BRIDGE">Hardware bridge</option>
                </select>
              </label>
              <TextField label="Zone / area" value={form.zone} onChange={(v) => set({ zone: v })} placeholder="Lobby" />
              <TextField label="Floor" value={form.floor} onChange={(v) => set({ floor: v })} placeholder="3" mono />
              <div className="grid grid-cols-2 gap-3">
                <TextField label="Latitude" value={form.lat} onChange={(v) => set({ lat: v })} mono />
                <TextField label="Longitude" value={form.lng} onChange={(v) => set({ lng: v })} mono />
              </div>
            </div>
            <p className="t3" style={{ fontSize: 12, margin: 0 }}>
              Zone, floor and coordinates let the system tell whether a device is on an incident's path. Leave any of them blank if you don't know.
            </p>

            <div className="hr" />
            <span className="eyebrow">Connection details</span>
            <div className="grid gap-3 sm:grid-cols-2">
              {form.connection_type === "REST_API" && (
                <>
                  <TextField label="Base URL" value={form.base_url} onChange={(v) => set({ base_url: v })} placeholder="https://camera.example.com/api" className="sm:col-span-2" mono />
                  <label className="fl">
                    <span className="lbl">Auth</span>
                    <select className="in" value={form.auth_type} onChange={(e) => set({ auth_type: e.target.value as FormState["auth_type"] })}>
                      <option value="api_key">API key</option>
                      <option value="bearer_token">Bearer token</option>
                    </select>
                  </label>
                  <TextField label={form.auth_type === "bearer_token" ? "Bearer token" : "API key"} value={form.token} onChange={(v) => set({ token: v })} secret />
                </>
              )}
              {form.connection_type === "MQTT" && (
                <>
                  <TextField label="Broker URL" value={form.broker_url} onChange={(v) => set({ broker_url: v })} placeholder="mqtt://broker.example.com:1883" className="sm:col-span-2" mono />
                  <TextField label="Username" value={form.mqtt_username} onChange={(v) => set({ mqtt_username: v })} />
                  <TextField label="Password" value={form.mqtt_password} onChange={(v) => set({ mqtt_password: v })} secret />
                </>
              )}
              {form.connection_type === "HARDWARE_BRIDGE" && (
                <>
                  <TextField label="Gateway WebSocket URL" value={form.gateway_websocket_url} onChange={(v) => set({ gateway_websocket_url: v })} placeholder="ws://gateway.local:9000/bridge" className="sm:col-span-2" mono />
                  <TextField label="Bridge key" value={form.bridge_key} onChange={(v) => set({ bridge_key: v })} secret />
                </>
              )}
              <TextField label="Supported actions (comma separated)" value={form.supported_actions} onChange={(v) => set({ supported_actions: v })} className="sm:col-span-2" mono />
            </div>
            <div className="row g8" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="b b-gh" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button type="button" className="b b-pri" onClick={() => registerMut.mutate()} disabled={!form.name.trim() || registerMut.isPending}>
                {registerMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Register device
              </button>
            </div>
          </div>
        </Panel>
      )}

      <Panel title="Registered devices" meta={`${devices.length}`} bodyClassName="">
        {isLoading ? (
          <Empty>
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading devices…
          </Empty>
        ) : devices.length === 0 ? (
          <Empty>No devices registered yet.</Empty>
        ) : (
          <div className="scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>Connection</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th>Last command</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {devices.map((device: DeviceRecord) => {
                  const check = checkResults[device.id];
                  const last = parseLastCommandResult(device.last_command_result);
                  const where = [
                    device.zone ? device.zone : null,
                    typeof device.floor === "number" ? `Floor ${device.floor}` : null,
                    typeof device.lat === "number" && typeof device.lng === "number" ? `${device.lat.toFixed(4)}, ${device.lng.toFixed(4)}` : null,
                  ].filter(Boolean);
                  return (
                    <tr key={device.id}>
                      <td>
                        <div className="col">
                          <b>{device.name}</b>
                          <span className="mono t3" style={{ fontSize: 11 }}>
                            {device.type}
                            {(device.supported_actions ?? []).length ? ` · ${(device.supported_actions ?? []).join(", ")}` : ""}
                          </span>
                        </div>
                      </td>
                      <td className="t2">{CONNECTION_LABEL[device.connection_type] ?? device.connection_type}</td>
                      <td className="t2">{where.length ? where.join(" · ") : <span title="Without a location the device can't be matched to an incident's path">Not set</span>}</td>
                      <td>
                        {check ? (
                          <span title={check.error}>
                            <Status tone={check.reachable ? "ok" : "fail"}>{check.reachable ? "Reachable" : "Unreachable"}</Status>
                          </span>
                        ) : (
                          <Status tone={device.status === "online" ? "ok" : device.status === "offline" ? "fail" : "neutral"}>{device.status ?? "Not tested"}</Status>
                        )}
                      </td>
                      <td className="t2" style={{ fontSize: 12 }}>
                        {last ? (
                          <>
                            {last.action_key ?? "action"} · <span style={{ color: last.execution_result === "failed" ? "var(--fail)" : undefined }}>{last.execution_result ?? "unknown"}</span>{" "}
                            <span className="t3">{formatRelativeTime(device.last_command_at)}</span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <button type="button" className="b b-sm b-gh" onClick={() => runCheck(device.id)} disabled={checking === device.id}>
                          {checking === device.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />} Test
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

const CONNECTION_LABEL: Record<string, string> = { REST_API: "REST API", MQTT: "MQTT", HARDWARE_BRIDGE: "Hardware bridge" };

function TextField({
  label,
  value,
  onChange,
  placeholder,
  className = "",
  mono = false,
  secret = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  mono?: boolean;
  secret?: boolean;
}) {
  return (
    <label className={`fl ${className}`}>
      <span className="lbl">{label}</span>
      <input
        className={`in${mono ? " mono" : ""}`}
        type={secret ? "password" : "text"}
        autoComplete={secret ? "new-password" : "off"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}
