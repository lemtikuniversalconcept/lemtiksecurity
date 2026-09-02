import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Cpu, Loader2, Plus, Wifi, WifiOff, PlugZap, History } from "lucide-react";
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
import { cn } from "@/lib/utils";

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
};

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
        },
      }),
    onSuccess: () => {
      toast.success("Device registered");
      setForm(emptyForm);
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

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Cpu className="h-5 w-5 text-primary" />
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Smart Infrastructure</div>
          <h1 className="text-2xl font-semibold">Devices</h1>
          <p className="text-sm text-muted-foreground">
            Register any REST, MQTT, or hardware-bridged device — gates, doors, elevators, locks, cameras, sensors — and it's immediately
            gated by the Autonomous Controller's Safety Constraints Engine. Approval requirements and the low-tier allowlist are set on{" "}
            <a href="/app/org" className="text-primary underline underline-offset-2">Organisation → Autonomy &amp; Devices</a>.
          </p>
        </div>
      </div>

      <section className="rounded-lg border border-border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Register a device</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <TextField label="Name" value={form.name} onChange={(v) => setForm((p) => ({ ...p, name: v }))} placeholder="Lobby PTZ Camera" />
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Type</label>
            <input
              list="device-types"
              value={form.type}
              onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <datalist id="device-types">
              {KNOWN_DEVICE_TYPES.map((t) => <option key={t} value={t} />)}
            </datalist>
          </div>
          <SelectField
            label="Connection type"
            value={form.connection_type}
            onChange={(v) => setForm((p) => ({ ...p, connection_type: v as ConnectionType }))}
            options={[["REST_API", "REST API"], ["MQTT", "MQTT"], ["HARDWARE_BRIDGE", "Hardware Bridge"]]}
          />
          <TextField label="Zone / area" value={form.zone} onChange={(v) => setForm((p) => ({ ...p, zone: v }))} placeholder="Lobby" />

          {form.connection_type === "REST_API" && (
            <>
              <TextField label="Base URL" value={form.base_url} onChange={(v) => setForm((p) => ({ ...p, base_url: v }))} placeholder="https://camera.example.com/api" className="sm:col-span-2" />
              <SelectField label="Auth type" value={form.auth_type} onChange={(v) => setForm((p) => ({ ...p, auth_type: v as FormState["auth_type"] }))} options={[["api_key", "API key"], ["bearer_token", "Bearer token"]]} />
              <TextField label={form.auth_type === "bearer_token" ? "Bearer token" : "API key"} value={form.token} onChange={(v) => setForm((p) => ({ ...p, token: v }))} />
            </>
          )}
          {form.connection_type === "MQTT" && (
            <>
              <TextField label="Broker URL" value={form.broker_url} onChange={(v) => setForm((p) => ({ ...p, broker_url: v }))} placeholder="mqtt://broker.example.com:1883" className="sm:col-span-2" />
              <TextField label="Username" value={form.mqtt_username} onChange={(v) => setForm((p) => ({ ...p, mqtt_username: v }))} />
              <TextField label="Password" value={form.mqtt_password} onChange={(v) => setForm((p) => ({ ...p, mqtt_password: v }))} />
            </>
          )}
          {form.connection_type === "HARDWARE_BRIDGE" && (
            <>
              <TextField label="Gateway WebSocket URL" value={form.gateway_websocket_url} onChange={(v) => setForm((p) => ({ ...p, gateway_websocket_url: v }))} placeholder="ws://gateway.local:9000/bridge" className="sm:col-span-2" />
              <TextField label="Bridge key" value={form.bridge_key} onChange={(v) => setForm((p) => ({ ...p, bridge_key: v }))} />
            </>
          )}

          <TextField
            label="Supported actions (comma separated)"
            value={form.supported_actions}
            onChange={(v) => setForm((p) => ({ ...p, supported_actions: v }))}
            className="sm:col-span-2"
          />
        </div>
        <button
          type="button"
          onClick={() => registerMut.mutate()}
          disabled={!form.name || registerMut.isPending}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {registerMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Register device
        </button>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Registered devices</h2>
        {isLoading ? (
          <div className="text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading…</div>
        ) : devices.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">No devices registered yet.</div>
        ) : (
          <div className="space-y-2">
            {devices.map((device: DeviceRecord) => {
              const check = checkResults[device.id];
              const lastCommand = parseLastCommandResult(device.last_command_result);
              return (
                <div key={device.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3">
                  <div>
                    <div className="text-sm font-medium">{device.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {device.type} · {device.connection_type} · {(device.supported_actions ?? []).join(", ") || "no actions"}
                    </div>
                    {lastCommand && (
                      <div className="mt-1 flex items-center gap-1.5 text-xs">
                        <History className="h-3 w-3 text-muted-foreground" />
                        <span className={lastCommand.execution_result === "success" ? "text-resolved" : lastCommand.execution_result === "failed" ? "text-critical" : "text-muted-foreground"}>
                          {lastCommand.action_key ?? "action"}
                          {lastCommand.parameters && Object.keys(lastCommand.parameters).length > 0 ? ` (${Object.entries(lastCommand.parameters).map(([k, v]) => `${k}=${v}`).join(", ")})` : ""}
                          {" · "}{lastCommand.execution_result ?? "unknown"}
                        </span>
                        <span className="text-muted-foreground">
                          {formatRelativeTime(device.last_command_at)}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {check && (
                      <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide", check.reachable ? "bg-resolved/15 text-resolved" : "bg-critical/15 text-critical")} title={check.error}>
                        {check.reachable ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                        {check.reachable ? "Reachable" : "Unreachable"}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => runCheck(device.id)}
                      disabled={checking === device.id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium hover:border-primary/50 disabled:opacity-60"
                    >
                      {checking === device.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
                      Test connectivity
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function TextField({ label, value, onChange, placeholder, className = "" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </div>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}
