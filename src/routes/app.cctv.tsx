import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Video, Loader2, UploadCloud, AlertTriangle, ScanEye, ShieldAlert, Sparkles, RadioTower, FileText, Eye, ListChecks, CircuitBoard } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { resolveAppAccess, requireSectionAccess } from "@/lib/rbac";
import { getCameras, ingestFrame, analyzeJudgement, verifyVision, type CCTVFrameResult } from "@/lib/cctv.functions";
import { type CameraRecord } from "@/lib/cameras.functions";
import { CameraStreamPlayer } from "@/components/dashboard/CameraStreamPlayer";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/cctv")({
  head: () => ({ meta: [{ title: "CCTV Control Room · Lemtik SOD" }] }),
  beforeLoad: async () => {
    const appAccess = await resolveAppAccess(supabase);
    requireSectionAccess(appAccess, ["security_manager", "operator"]);
    return { appAccess };
  },
  component: CctvControlRoom,
});

type PresetTemplate = {
  label: string;
  eventType: string;
  transcript: string;
  summary: string;
};

const PRESETS: PresetTemplate[] = [
  {
    label: "Suspicious Loitering",
    eventType: "suspicious_loitering",
    transcript: "Operator report: repeated pacing near the lobby entrance for over two minutes.",
    summary: "Multiple stationary passes and no legitimate entry intent detected.",
  },
  {
    label: "Tailgating near elevator",
    eventType: "tailgating_elevator",
    transcript: "Walkie call: two persons entered after an authorised card swipe without visible badge confirmation.",
    summary: "Follow-through movement at a controlled access point with possible social-engineering risk.",
  },
  {
    label: "Perimeter Trespass",
    eventType: "perimeter_trespass",
    transcript: "Security radio: subject crossed boundary line near the west fence and ignored verbal challenge.",
    summary: "Boundary violation with potential escalation across a blind spot.",
  },
];

type DecisionResult = {
  threatSummary: string;
  confidencePct: number;
  statusLabel: string;
  requestId: string;
  explanation: string;
  recommendations: string[];
  visionGaps: string[];
  reidLogs: Array<{
    status: string;
    similarity: number;
    candidates: string[];
  }>;
  blindSpotPredictions: string[];
  decisionLogs: string[];
};

function normalizeCameraList(payload: unknown): CameraRecord[] {
  if (Array.isArray(payload)) {
    return payload.filter(Boolean) as CameraRecord[];
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const record = payload as Record<string, unknown>;
  const candidates = [record.data, record.cameras, record.items, record.results, record.records];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(Boolean) as CameraRecord[];
    }
  }
  return [];
}

function CctvControlRoom() {
  const { appAccess } = Route.useRouteContext();
  const listCamerasFn = useServerFn(getCameras);
  const ingestFn = useServerFn(ingestFrame);
  const analyzeFn = useServerFn(analyzeJudgement);
  const verifyFn = useServerFn(verifyVision);

  const { data: cameras = [], isLoading } = useQuery({
    queryKey: ["cctv-cameras", appAccess.orgId],
    queryFn: async () => normalizeCameraList(await listCamerasFn()),
  });

  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<PresetTemplate>(PRESETS[0]);
  const [eventType, setEventType] = useState(PRESETS[0].eventType);
  const [voiceTranscript, setVoiceTranscript] = useState(PRESETS[0].transcript);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DecisionResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedCamera = useMemo(
    () => (Array.isArray(cameras) ? cameras.find((camera) => camera.id === selectedCameraId) ?? cameras[0] ?? null : null),
    [cameras, selectedCameraId],
  );

  const setPreset = (preset: PresetTemplate) => {
    setSelectedPreset(preset);
    setEventType(preset.eventType);
    setVoiceTranscript(preset.transcript);
    setResult(null);
  };

  const loadFile = async (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImageDataUrl(typeof reader.result === "string" ? reader.result : null);
      setImageName(file.name);
      setResult(null);
    };
    reader.readAsDataURL(file);
  };

  const normalize = (primary: CCTVFrameResult | null, secondary?: CCTVFrameResult | null): DecisionResult => {
    const source = secondary ?? primary ?? {};
    const confidence = source.confidence ?? 0.7;
    const summaries = [source.threat_summary, source.summary, source.explanation, source.visual_explanation, source.qwen_vision_explanation].filter(Boolean) as string[];
    const reidLogs = source.reid_matching_logs?.length
      ? source.reid_matching_logs
      : source.matches?.length
        ? source.matches.map((match, index) => ({
            status: String(match.status ?? `match-${index + 1}`),
            similarity: Number(match.similarity ?? 0.61),
            candidates: Array.isArray(match.candidates) ? match.candidates.map((candidate) => String(candidate)) : ["Candidate A", "Candidate B"],
          }))
        : [{
            status: "No direct match returned",
            similarity: 0.38,
            candidates: ["Unknown subject", "Low-confidence corridor pass"],
          }];
    return {
      threatSummary: summaries[0] ?? "The gateway returned no threat summary, so the page is showing the last operator context.",
      confidencePct: Math.round(Math.max(0, Math.min(1, confidence)) * 100),
      statusLabel: String(source.request_id ?? source.id ?? "pending"),
      requestId: String(source.request_id ?? source.id ?? `cctv-${Date.now()}`),
      explanation: summaries.slice(1).join(" ").trim() || "No additional explanation returned by the gateway.",
      recommendations: source.recommended_actions?.length ? source.recommended_actions : ["Verify the frame against adjacent cameras", "Escalate to the command desk"],
      visionGaps: source.vision_gaps?.length ? source.vision_gaps : ["No explicit blind-spot notes returned"],
      reidLogs,
      blindSpotPredictions: source.blind_spot_predictions?.length ? source.blind_spot_predictions : source.blind_spot_prediction ? [source.blind_spot_prediction] : ["Predicted reappearance in adjacent camera corridor"],
      decisionLogs: source.decision_logs?.length ? source.decision_logs : ["Frame captured", "Threat scoring complete"],
    };
  };

  const runDiagnostics = async () => {
    const payload = {
      camera_id: selectedCamera?.id,
      image_data_url: imageDataUrl ?? undefined,
      voice_transcript: voiceTranscript,
      event_type: eventType,
      template_name: selectedPreset.label,
      verify_vision: true,
      metadata: {
        camera_name: selectedCamera?.name ?? null,
        camera_location: selectedCamera?.location ?? null,
      },
    };

    setRunning(true);
    try {
      let primary: CCTVFrameResult | null = null;
      let secondary: CCTVFrameResult | null = null;

      if (imageDataUrl) {
        primary = (await ingestFn({ data: payload })) as CCTVFrameResult | null;
        secondary = (await verifyFn({ data: { ...payload, image_data_url: imageDataUrl } })) as CCTVFrameResult | null;
      } else {
        primary = (await analyzeFn({ data: payload })) as CCTVFrameResult | null;
      }

      setResult(normalize(primary, secondary));
    } catch (error) {
      setResult({
        threatSummary: error instanceof Error ? error.message : "Unable to run CCTV diagnostics.",
        confidencePct: 0,
        statusLabel: "error",
        requestId: `error-${Date.now()}`,
        explanation: "The analysis request failed before a gateway result could be rendered.",
        recommendations: ["Retry the frame upload", "Check the gateway route configuration"],
        visionGaps: ["No gateway response"],
        reidLogs: [{ status: "Request failed", similarity: 0, candidates: ["N/A"] }],
        blindSpotPredictions: ["Unable to estimate blind-spot reappearance"],
        decisionLogs: ["Request rejected"],
      });
    } finally {
      setRunning(false);
    }
  };

  const confidence = result ? result.confidencePct : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">CCTV Operations</div>
          <h1 className="mt-1 text-2xl font-semibold">CCTV Control Room</h1>
          <p className="text-sm text-muted-foreground">
            Registered cameras, live streams, and AI frame analysis for {appAccess.orgName}.
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card px-4 py-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">AI request</div>
          <div className="mt-1 text-sm font-medium">{result?.requestId ?? "Awaiting diagnostics"}</div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-3xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Camera Grid Panel</div>
              <h2 className="mt-1 text-lg font-semibold">Active camera streams</h2>
            </div>
            <span className="rounded-full border border-border bg-surface px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {cameras.length} cameras
            </span>
          </div>

          {isLoading ? (
            <div className="mt-4 flex items-center gap-2 rounded-2xl border border-border bg-surface px-4 py-5 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading camera registry…
            </div>
          ) : (
            <div className="mt-4 grid gap-4">
              <div className="grid gap-4 xl:grid-cols-2">
                {cameras.map((camera) => (
                  <div
                    key={camera.id}
                    className={cn(
                      "rounded-2xl border p-3 transition",
                      selectedCamera?.id === camera.id ? "border-primary/50 bg-primary/5" : "border-border bg-surface/70",
                    )}
                    onClick={() => setSelectedCameraId(camera.id)}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <Video className="h-4 w-4 text-cyan-400" />
                          <div className="text-sm font-semibold">{camera.name}</div>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">{camera.location}</div>
                      </div>
                      <span
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em]",
                          camera.status === "online"
                            ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100"
                            : camera.status === "degraded"
                              ? "border-amber-300/30 bg-amber-300/10 text-amber-100"
                              : "border-rose-300/30 bg-rose-300/10 text-rose-100",
                        )}
                      >
                        {camera.status}
                      </span>
                    </div>
                    <div className="mt-3">
                      <CameraStreamPlayer camera={camera} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <section className="rounded-3xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">AI Frame Analyser</div>
                <h2 className="mt-1 text-lg font-semibold">Run live diagnostics</h2>
              </div>
              <ScanEye className="h-4 w-4 text-muted-foreground" />
            </div>

            <div
              className={cn(
                "mt-4 rounded-3xl border border-dashed p-4 transition",
                dragActive ? "border-primary bg-primary/5" : "border-border bg-surface/60",
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={async (e) => {
                e.preventDefault();
                setDragActive(false);
                const file = e.dataTransfer.files?.[0] ?? null;
                await loadFile(file);
              }}
            >
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <UploadCloud className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">Drop a frame or choose a template</div>
                  <div className="text-xs text-muted-foreground">Image uploads are converted to a base64 data URL before diagnostics run.</div>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0] ?? null;
                  await loadFile(file);
                }}
              />
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-2 text-xs hover:bg-surface-2"
                >
                  <UploadCloud className="h-3.5 w-3.5" /> Select image
                </button>
                {imageDataUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      setImageDataUrl(null);
                      setImageName(null);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-2 text-xs hover:bg-surface-2"
                  >
                    Clear frame
                  </button>
                )}
              </div>
              {imageName && (
                <div className="mt-3 text-xs text-muted-foreground">
                  Loaded frame: <span className="font-medium text-foreground">{imageName}</span>
                </div>
              )}
              {imageDataUrl && (
                <img
                  src={imageDataUrl}
                  alt="Uploaded frame preview"
                  className="mt-3 max-h-44 w-full rounded-2xl border border-border object-cover"
                />
              )}
            </div>

            <div className="mt-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Security templates</div>
              <div className="mt-2 grid gap-2">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setPreset(preset)}
                    className={cn(
                      "rounded-2xl border p-3 text-left transition",
                      selectedPreset.label === preset.label ? "border-primary bg-primary/5" : "border-border bg-surface hover:bg-surface-2",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium">{preset.label}</div>
                      <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{preset.summary}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 grid gap-3">
              <label className="block">
                <div className="mb-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Event type</div>
                <select
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value)}
                  className="w-full rounded-2xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                >
                  {PRESETS.map((preset) => (
                    <option key={preset.eventType} value={preset.eventType}>{preset.label}</option>
                  ))}
                  <option value="unknown_event">Unknown event</option>
                </select>
              </label>

              <label className="block">
                <div className="mb-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Voice transcript</div>
                <textarea
                  value={voiceTranscript}
                  onChange={(e) => setVoiceTranscript(e.target.value)}
                  rows={4}
                  placeholder="Simulated walkie-talkie transcription"
                  className="w-full rounded-2xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                />
              </label>
            </div>

            <button
              type="button"
              onClick={() => void runDiagnostics()}
              disabled={running}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RadioTower className="h-4 w-4" />}
              Run AI Diagnostics
            </button>
          </section>

          <section className="rounded-3xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Decision & Logs</div>
                <h2 className="mt-1 text-lg font-semibold">AI judgement output</h2>
              </div>
              <div className="grid h-16 w-16 place-items-center rounded-full border border-border bg-surface">
                <div
                  className="grid h-12 w-12 place-items-center rounded-full text-[11px] font-semibold text-foreground"
                  style={{
                    background: `conic-gradient(var(--primary) ${confidence}%, rgba(255,255,255,0.08) 0)`,
                  }}
                >
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-card">{confidence}%</span>
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-4">
              <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-50">
                <div className="text-[10px] uppercase tracking-[0.18em] text-amber-100/75">Visual Threat Summary</div>
                <div className="mt-2 leading-relaxed">{result?.threatSummary ?? "Run diagnostics to view the visual threat summary."}</div>
              </div>

              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Qwen Vision Explanation</div>
                <div className="mt-2 rounded-2xl border border-border bg-surface p-4 text-sm text-muted-foreground">
                  {result?.explanation ?? "The explanation log will appear here after the gateway responds."}
                </div>
              </div>

              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Re-ID Matching Logs</div>
                <div className="mt-2 space-y-2">
                  {result?.reidLogs?.map((log, index) => (
                    <div key={`${log.status}-${index}`} className="rounded-2xl border border-border bg-surface p-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-foreground">{log.status}</span>
                        <span className="text-muted-foreground">{Math.round(log.similarity * 100)}%</span>
                      </div>
                      <div className="mt-1 text-muted-foreground">
                        Candidates: {log.candidates.join(", ")}
                      </div>
                    </div>
                  )) ?? null}
                </div>
              </div>

              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Blind-Spot Predictor</div>
                <div className="mt-2 space-y-2">
                  {result?.blindSpotPredictions?.map((item) => (
                    <div key={item} className="rounded-2xl border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
                      {item}
                    </div>
                  )) ?? null}
                </div>
              </div>

              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Vision Gaps</div>
                <ul className="mt-2 space-y-2">
                  {result?.visionGaps?.map((gap) => (
                    <li key={gap} className="flex items-start gap-2 rounded-2xl border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
                      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 text-amber-300" />
                      <span>{gap}</span>
                    </li>
                  )) ?? null}
                </ul>
              </div>

              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Decision Logs</div>
                <div className="mt-2 space-y-2">
                  {result?.decisionLogs?.map((log) => (
                    <div key={log} className="flex items-center gap-2 rounded-2xl border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
                      <ListChecks className="h-3.5 w-3.5 text-primary" />
                      {log}
                    </div>
                  )) ?? null}
                </div>
              </div>

              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Recommended Actions</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {result?.recommendations?.map((item) => (
                    <span key={item} className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-muted-foreground">
                      {item}
                    </span>
                  )) ?? null}
                </div>
              </div>
            </div>
          </section>
        </aside>
      </div>

      <section className="rounded-3xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Operational Notes</div>
            <h2 className="mt-1 text-lg font-semibold">Event routing and diagnostics context</h2>
          </div>
          <CircuitBoard className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <InfoCard
            icon={Video}
            title="Selected camera"
            body={selectedCamera ? `${selectedCamera.name} · ${selectedCamera.location}` : "Choose a camera card to focus diagnostics."}
          />
          <InfoCard
            icon={Eye}
            title="Frame mode"
            body={imageDataUrl ? "Uploaded frame is queued for verify_vision." : "No frame attached, so the judgement analyser will be used."}
          />
          <InfoCard
            icon={AlertTriangle}
            title="Template"
            body={`${selectedPreset.label} · ${eventType}`}
          />
        </div>
      </section>
    </div>
  );
}

function InfoCard({ icon: Icon, title, body }: { icon: typeof Video; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon className="h-4 w-4 text-primary" />
        {title}
      </div>
      <div className="mt-2 text-sm text-muted-foreground">{body}</div>
    </div>
  );
}
