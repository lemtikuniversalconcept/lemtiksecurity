import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, UploadCloud, Power, RotateCcw, RotateCw, Camera, ScanEye, X, Sparkles } from "lucide-react";
import { requireSectionAccess } from "@/lib/rbac";
import { getCameras, ingestFrame, analyzeJudgement, verifyVision, normalizeCameraList, type CCTVFrameResult } from "@/lib/cctv.functions";
import { listDevices, executeDeviceAction, parseLastCommandResult, formatRelativeTime } from "@/lib/devices.functions";
import { CameraStreamPlayer } from "@/components/dashboard/CameraStreamPlayer";
import { Confidence, Empty, Notice, Panel, Seg, Status } from "@/components/nw";

export const Route = createFileRoute("/app/sensors")({
  head: () => ({ meta: [{ title: "Cameras & sensors · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    const appAccess = context.appAccess;
    requireSectionAccess(appAccess, ["security_manager", "operator"]);
    return { appAccess };
  },
  component: CamerasAndSensors,
});

const EVENT_TYPES = [
  { value: "suspicious_loitering", label: "Suspicious loitering" },
  { value: "tailgating_elevator", label: "Tailgating at an access point" },
  { value: "perimeter_trespass", label: "Perimeter trespass" },
  { value: "unknown_event", label: "Not sure" },
];

type Layout = "2" | "3" | "1";

function CamerasAndSensors() {
  const { appAccess } = Route.useRouteContext();
  const listCamerasFn = useServerFn(getCameras);
  const listDevicesFn = useServerFn(listDevices);

  const { data: cameras = [], isLoading, isError } = useQuery({
    queryKey: ["cctv-cameras", appAccess.orgId],
    queryFn: async () => normalizeCameraList(await listCamerasFn()),
  });
  const { data: sensors = [], isLoading: sensorsLoading } = useQuery({
    queryKey: ["sensor-devices"],
    queryFn: async () => (await listDevicesFn()).filter((d) => d.type === "sensor" || d.type === "sensor_camera"),
  });

  const [layout, setLayout] = useState<Layout>("3");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [analyserOpen, setAnalyserOpen] = useState(false);

  const online = cameras.filter((c) => c.status === "online").length;
  const selectedCamera = cameras.find((c) => c.id === selectedId) ?? null;
  const shown = layout === "1" ? (selectedCamera ? [selectedCamera] : cameras.slice(0, 1)) : cameras;
  const cols = layout === "1" ? "grid-cols-1" : layout === "2" ? "md:grid-cols-2" : "md:grid-cols-2 xl:grid-cols-3";

  return (
    <div className="col g16">
      <div className="row g12 wrap">
        <div className="col">
          <h1 className="ph1">Cameras &amp; sensors</h1>
          <span className="sub">
            {isLoading
              ? "Loading cameras…"
              : `${cameras.length} camera${cameras.length === 1 ? "" : "s"} · ${online} online · ${sensors.length} sensor${sensors.length === 1 ? "" : "s"}`}
          </span>
        </div>
        <span className="flex-auto" />
        <Seg
          label="Grid layout"
          value={layout}
          onChange={setLayout}
          options={[
            { value: "2", label: "2 across" },
            { value: "3", label: "3 across" },
            { value: "1", label: "Single" },
          ]}
        />
        <button type="button" className={`b ${analyserOpen ? "b-sec" : "b-ai"}`} onClick={() => setAnalyserOpen((o) => !o)} aria-expanded={analyserOpen}>
          <ScanEye className="h-4 w-4" /> Analyse a frame
        </button>
      </div>

      <div className={`grid gap-4 ${analyserOpen ? "xl:grid-cols-[minmax(0,1fr)_400px]" : ""}`} style={{ alignItems: "start" }}>
        <div className="col g16" style={{ minWidth: 0 }}>
          {isError ? (
            <Notice tone="fail">Couldn't load the camera list from the camera service.</Notice>
          ) : isLoading ? (
            <Panel>
              <Empty>
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading cameras…
              </Empty>
            </Panel>
          ) : cameras.length === 0 ? (
            <Panel>
              <Empty>No cameras are connected for {appAccess.orgName} yet. Contact Lemtik support to connect a camera feed.</Empty>
            </Panel>
          ) : (
            <div className={`grid gap-3 ${cols}`}>
              {shown.map((camera) => (
                <CameraStreamPlayer key={camera.id} camera={camera} selected={selectedId === camera.id} onSelect={() => setSelectedId(camera.id)} tall={layout === "1"} />
              ))}
            </div>
          )}

          <SensorsPanel sensors={sensors} loading={sensorsLoading} />
        </div>

        {analyserOpen && <FrameAnalyser camera={selectedCamera} onClose={() => setAnalyserOpen(false)} />}
      </div>
    </div>
  );
}

function FrameAnalyser({ camera, onClose }: { camera: { id: string; name: string; location: string } | null; onClose: () => void }) {
  const ingestFn = useServerFn(ingestFrame);
  const analyzeFn = useServerFn(analyzeJudgement);
  const verifyFn = useServerFn(verifyVision);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [eventType, setEventType] = useState(EVENT_TYPES[0].value);
  const [note, setNote] = useState("");
  const [image, setImage] = useState<{ url: string; name: string } | null>(null);
  const [drag, setDrag] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CCTVFrameResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadFile = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setImage({ url: reader.result, name: file.name });
      setResult(null);
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const run = async () => {
    const payload = {
      camera_id: camera?.id,
      frame_data: image?.url,
      image_data_url: image?.url,
      voice_transcript: note.trim() || undefined,
      event_type: eventType,
      verify_vision: true,
      metadata: { camera_name: camera?.name ?? null, camera_location: camera?.location ?? null },
    };
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      if (image) {
        const ingested = (await ingestFn({ data: payload })) as CCTVFrameResult;
        let verified: CCTVFrameResult | null = null;
        try {
          verified = (await verifyFn({ data: { ...payload, frame_data: image.url } })) as CCTVFrameResult;
        } catch {
          /* verification is a second opinion; the ingest result still stands */
        }
        setResult(mergeResults(ingested, verified));
      } else {
        setResult((await analyzeFn({ data: payload })) as CCTVFrameResult);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "The analysis didn't run.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <aside className="col g12 side">
      <Panel
        title="Analyse a frame"
        actions={
          <button type="button" className="ibtn" style={{ width: 28, height: 28 }} aria-label="Close analyser" onClick={onClose}>
            <X size={14} />
          </button>
        }
      >
        <div className="col g12">
          <div className="t2" style={{ fontSize: 12.5 }}>
            {camera ? (
              <>
                Camera: <b>{camera.name}</b> · {camera.location}
              </>
            ) : (
              "No camera selected. Click a camera tile to attach it, or analyse a frame on its own."
            )}
          </div>
          <div
            className="card col g8"
            style={{ padding: 12, borderStyle: "dashed", borderColor: drag ? "var(--blue-ln)" : undefined, alignItems: "center", textAlign: "center" }}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              loadFile(e.dataTransfer.files?.[0] ?? null);
            }}
          >
            {image ? (
              <img src={image.url} alt={`Frame ${image.name}`} style={{ maxHeight: 180, width: "100%", objectFit: "cover", borderRadius: 8 }} />
            ) : (
              <UploadCloud className="h-6 w-6 t3" />
            )}
            <span className="t3" style={{ fontSize: 12 }}>
              {image ? image.name : "Drop a still frame here"}
            </span>
            <div className="row g8">
              <button type="button" className="b b-sm b-sec" onClick={() => fileRef.current?.click()}>
                <Camera className="h-3.5 w-3.5" /> {image ? "Replace" : "Choose image"}
              </button>
              {image && (
                <button type="button" className="b b-sm b-gh" onClick={() => setImage(null)}>
                  Remove
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => loadFile(e.target.files?.[0] ?? null)} />
          </div>
          <label className="fl">
            <span className="lbl">What are you checking for?</span>
            <select className="in" value={eventType} onChange={(e) => setEventType(e.target.value)}>
              {EVENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="fl">
            <span className="lbl">Operator note (optional)</span>
            <textarea className="in" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you heard on the radio or saw on screen" style={{ height: "auto", paddingTop: 8 }} />
          </label>
          <button type="button" className="b b-ai" onClick={() => void run()} disabled={running} style={{ justifyContent: "center" }}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {running ? "Analysing…" : image ? "Analyse frame" : "Analyse note only"}
          </button>
          {error && <Notice tone="fail">{error}</Notice>}
        </div>
      </Panel>

      {result && <AnalysisResult result={result} />}
    </aside>
  );
}

function AnalysisResult({ result }: { result: CCTVFrameResult }) {
  const pct = result.confidence == null ? null : Math.round(Math.max(0, Math.min(1, result.confidence)) * 100);
  const section = (label: string, items: string[] | undefined) =>
    items && items.length > 0 ? (
      <div className="col g6">
        <span className="eyebrow">{label}</span>
        <ul className="col g4" style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
          {items.map((x, i) => (
            <li key={`${x}-${i}`}>{x}</li>
          ))}
        </ul>
      </div>
    ) : null;
  return (
    <div className="ai col g12" style={{ padding: 14 }}>
      <div className="row g8">
        <span className="ai-h">
          <Sparkles size={13} /> Model analysis
        </span>
        <span className="flex-auto" />
        {pct != null && <Confidence value={pct} />}
      </div>
      {result.threat_summary ? <b style={{ fontSize: 14, lineHeight: 1.45 }}>{result.threat_summary}</b> : <span className="t3">The model returned no summary.</span>}
      {result.visual_explanation && (
        <p className="t2" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55 }}>
          {result.visual_explanation}
        </p>
      )}
      {section("Suggested next steps", result.recommended_actions)}
      {result.reid_matching_logs && result.reid_matching_logs.length > 0 && (
        <div className="col g6">
          <span className="eyebrow">Possible matches</span>
          {result.reid_matching_logs.map((m, i) => (
            <div key={i} className="card col g4" style={{ padding: "8px 10px", fontSize: 12 }}>
              <div className="row g8">
                <b>{m.status}</b>
                <span className="flex-auto" />
                {m.similarity != null && <span className="mono t2">{Math.round(m.similarity * 100)}% similar</span>}
              </div>
              {m.candidates && m.candidates.length > 0 && <span className="t3">{m.candidates.join(" · ")}</span>}
            </div>
          ))}
        </div>
      )}
      {section("Blind spots", result.blind_spot_predictions)}
      {section("What the model couldn't see", result.vision_gaps)}
      {section("Log", result.decision_logs)}
      <span className="t3 mono" style={{ fontSize: 11 }}>
        {result.match_status ? `Tracking: ${result.match_status} · ` : ""}
        {result.request_id ? `Request ${result.request_id}` : "No request id returned"}
      </span>
      <span className="t3" style={{ fontSize: 11.5 }}>
        A suggestion only. Confirm on camera or with an officer before acting.
      </span>
    </div>
  );
}

function mergeResults(primary: CCTVFrameResult, second: CCTVFrameResult | null): CCTVFrameResult {
  if (!second) return primary;
  const pick = <K extends keyof CCTVFrameResult>(k: K) => (second[k] != null && (!Array.isArray(second[k]) || (second[k] as unknown[]).length) ? second[k] : primary[k]);
  return {
    ...primary,
    threat_summary: pick("threat_summary"),
    confidence: pick("confidence"),
    visual_explanation: pick("visual_explanation"),
    recommended_actions: pick("recommended_actions"),
    vision_gaps: pick("vision_gaps"),
    reid_matching_logs: [...(primary.reid_matching_logs ?? []), ...(second.reid_matching_logs ?? [])],
    blind_spot_predictions: pick("blind_spot_predictions"),
  };
}

function SensorsPanel({ sensors, loading }: { sensors: Awaited<ReturnType<typeof listDevices>>; loading: boolean }) {
  const executeActionFn = useServerFn(executeDeviceAction);
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const runAction = useMutation({
    mutationFn: async (vars: { device_id: string; action_key: string; parameters?: Record<string, unknown> }) => executeActionFn({ data: vars }),
    onMutate: (vars) => setBusy(`${vars.device_id}:${vars.action_key}:${JSON.stringify(vars.parameters ?? {})}`),
    onSuccess: (result: any) => {
      if (result?.status === "success") toast.success("Command sent");
      else toast.warning(result?.error ?? "The command didn't complete", { description: result?.reason });
      qc.invalidateQueries({ queryKey: ["sensor-devices"] });
    },
    onError: (err: unknown) => toast.error("Command failed", { description: err instanceof Error ? err.message : undefined }),
    onSettled: () => setBusy(null),
  });

  const act = (device_id: string, action_key: string, parameters?: Record<string, unknown>) => runAction.mutate({ device_id, action_key, parameters });
  const isBusy = (id: string, key: string, params?: Record<string, unknown>) => busy === `${id}:${key}:${JSON.stringify(params ?? {})}`;

  const rows = useMemo(() => sensors, [sensors]);

  return (
    <Panel
      title="Sensors"
      meta={`${rows.length}`}
      actions={
        <Link to="/app/devices" className="b b-sm b-gh">
          Manage devices
        </Link>
      }
      bodyClassName=""
    >
      {loading ? (
        <Empty>
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading sensors…
        </Empty>
      ) : rows.length === 0 ? (
        <Empty>
          No sensors registered. Add one on the{" "}
          <Link to="/app/devices" className="lnk">
            Devices
          </Link>{" "}
          page with type <code>sensor</code> or <code>sensor_camera</code>.
        </Empty>
      ) : (
        <div className="scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Sensor</th>
                <th>Zone</th>
                <th>Status</th>
                <th>Last command</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const last = parseLastCommandResult(d.last_command_result);
                const ptzL = { direction: "left", degrees: 15 };
                const ptzR = { direction: "right", degrees: 15 };
                return (
                  <tr key={d.id}>
                    <td>
                      <div className="col">
                        <b>{d.name}</b>
                        <span className="t3 mono" style={{ fontSize: 11 }}>
                          {d.type}
                        </span>
                      </div>
                    </td>
                    <td className="t2">{d.zone ?? d.area ?? "—"}</td>
                    <td>
                      <Status tone={d.status === "online" ? "ok" : d.status === "offline" ? "fail" : "neutral"}>{d.status ?? "unknown"}</Status>
                    </td>
                    <td className="t2" style={{ fontSize: 12 }}>
                      {last ? (
                        <>
                          {last.action_key ?? "action"} · <span style={{ color: last.execution_result === "failed" ? "var(--fail)" : undefined }}>{last.execution_result ?? "unknown"}</span>{" "}
                          <span className="t3">{formatRelativeTime(d.last_command_at)}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <span className="row g6" style={{ justifyContent: "flex-end" }}>
                        {d.type === "sensor_camera" ? (
                          <>
                            <button type="button" className="b b-sm b-gh" disabled={isBusy(d.id, "ptz_move", ptzL)} onClick={() => act(d.id, "ptz_move", ptzL)}>
                              <RotateCcw className="h-3.5 w-3.5" /> Pan left
                            </button>
                            <button type="button" className="b b-sm b-gh" disabled={isBusy(d.id, "ptz_move", ptzR)} onClick={() => act(d.id, "ptz_move", ptzR)}>
                              <RotateCw className="h-3.5 w-3.5" /> Pan right
                            </button>
                            <button type="button" className="b b-sm b-sec" disabled={isBusy(d.id, "snapshot")} onClick={() => act(d.id, "snapshot")}>
                              <Camera className="h-3.5 w-3.5" /> Snapshot
                            </button>
                          </>
                        ) : (
                          <>
                            <button type="button" className="b b-sm b-gh" disabled={isBusy(d.id, "power_on")} onClick={() => act(d.id, "power_on")}>
                              <Power className="h-3.5 w-3.5" /> On
                            </button>
                            <button type="button" className="b b-sm b-gh" disabled={isBusy(d.id, "power_off")} onClick={() => act(d.id, "power_off")}>
                              <Power className="h-3.5 w-3.5" /> Off
                            </button>
                          </>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
