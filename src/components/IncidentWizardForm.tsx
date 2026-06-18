import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import { supabase } from "@/integrations/supabase/client";
import { severityMeta, typeMeta, type IncidentType, type Severity } from "@/lib/mockData";
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  CloudUpload,
  FileText,
  Grip,
  Loader2,
  MapPin,
  Mic,
  Move,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Video,
  X,
  Zap,
} from "lucide-react";
import type { IncidentSubmitPayload } from "@/components/IncidentReportForm";

type SavedLocation = { id: string; name: string; coord_x: number | null; coord_y: number | null };
type EvidenceKind = "image" | "video" | "audio" | "document";
type EvidenceItem = { path: string; kind: EvidenceKind; size: number; name: string; previewUrl?: string };

const MAX: Record<EvidenceKind, number> = {
  image: 10 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  audio: 10 * 1024 * 1024,
  document: 5 * 1024 * 1024,
};
const LIMITS: Record<EvidenceKind, number> = { image: 5, video: 2, audio: 1, document: 3 };

const STEP_TITLES = ["Basic Info", "Location", "People", "Evidence", "Review"] as const;

export function IncidentWizardForm({
  organisationId,
  savedLocations,
  defaultZone,
  initialDraft,
  onSubmit,
  loading,
  error,
  onClose,
}: {
  organisationId: string;
  savedLocations: SavedLocation[];
  defaultZone: string;
  initialDraft?: Partial<Pick<IncidentSubmitPayload, "type" | "severity" | "title" | "location" | "zone" | "description" | "coord_x" | "coord_y" | "location_id">>;
  onSubmit: (data: IncidentSubmitPayload) => void;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    type: initialDraft?.type ?? ("intrusion" as IncidentType),
    severity: initialDraft?.severity ?? 3,
    title: initialDraft?.title ?? "",
    zone: initialDraft?.zone ?? defaultZone,
    location: initialDraft?.location ?? "",
    addressFallback: initialDraft?.location ?? "",
    floor: "",
    indoor: false,
    description: initialDraft?.description ?? "",
    coord_x: initialDraft?.coord_x as number | undefined,
    coord_y: initialDraft?.coord_y as number | undefined,
    location_id: initialDraft?.location_id ?? "",
    suspect_count: "",
    suspect_description: "",
    victim_name: "",
    victim_contact: "",
    witnesses: "",
    client_visible: true,
  });
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [uploadingKind, setUploadingKind] = useState<EvidenceKind | null>(null);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recTimer = useRef<number | null>(null);
  const photoIn = useRef<HTMLInputElement>(null);
  const videoIn = useRef<HTMLInputElement>(null);
  const docIn = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const counts: Record<EvidenceKind, number> = {
    image: evidence.filter((e) => e.kind === "image").length,
    video: evidence.filter((e) => e.kind === "video").length,
    audio: evidence.filter((e) => e.kind === "audio").length,
    document: evidence.filter((e) => e.kind === "document").length,
  };

  useEffect(
    () => () => {
      if (recTimer.current) window.clearInterval(recTimer.current);
    },
    [],
  );

  const captureGps = () => {
    if (!navigator.geolocation) return;
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({
          ...f,
          coord_x: pos.coords.longitude,
          coord_y: pos.coords.latitude,
        }));
        setGpsLoading(false);
      },
      () => setGpsLoading(false),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const uploadFile = async (file: File, kind: EvidenceKind) => {
    if (file.size > MAX[kind]) {
      alert(`${file.name} exceeds ${Math.round(MAX[kind] / 1024 / 1024)}MB limit.`);
      return;
    }
    if (counts[kind] >= LIMITS[kind]) {
      alert(`Maximum ${LIMITS[kind]} ${kind} file(s).`);
      return;
    }
    setUploadingKind(kind);
    const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
    const path = `${organisationId}/draft/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("incident-evidence").upload(path, file, {
      upsert: false,
      contentType: file.type,
    });
    setUploadingKind(null);
    if (upErr) {
      alert(`Upload failed: ${upErr.message}`);
      return;
    }
    const previewUrl = kind === "image" ? URL.createObjectURL(file) : undefined;
    setEvidence((prev) => [...prev, { path, kind, size: file.size, name: file.name, previewUrl }]);
  };

  const addDroppedFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (file.type.startsWith("image/")) await uploadFile(file, "image");
      else if (file.type.startsWith("video/")) await uploadFile(file, "video");
      else if (file.type.startsWith("audio/")) await uploadFile(file, "audio");
      else await uploadFile(file, "document");
    }
  };

  const startRecording = async () => {
    if (counts.audio >= LIMITS.audio) {
      alert("Maximum 1 voice note.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      mediaRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: "audio/webm" });
        await uploadFile(file, "audio");
      };
      rec.start();
      setRecording(true);
      setRecSeconds(0);
      recTimer.current = window.setInterval(() => {
        setRecSeconds((s) => {
          if (s >= 119) {
            stopRecording();
            return 120;
          }
          return s + 1;
        });
      }, 1000);
    } catch {
      alert("Microphone access denied.");
    }
  };

  const stopRecording = () => {
    mediaRef.current?.stop();
    setRecording(false);
    if (recTimer.current) {
      window.clearInterval(recTimer.current);
      recTimer.current = null;
    }
  };

  const dropPosToCoords = (ev: MouseEvent<HTMLDivElement>) => {
    const rect = (ev.currentTarget as HTMLDivElement).getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height));
    setForm((f) => ({
      ...f,
      coord_x: Number((3.2 + x * 0.5).toFixed(6)),
      coord_y: Number((6.55 - y * 0.2).toFixed(6)),
    }));
  };

  const pickSavedLocation = (id: string) => {
    const loc = savedLocations.find((l) => l.id === id);
    setForm((f) => ({
      ...f,
      location_id: id,
      location: loc?.name ?? f.location,
      addressFallback: loc?.name ?? f.addressFallback,
      coord_x: loc?.coord_x ?? f.coord_x,
      coord_y: loc?.coord_y ?? f.coord_y,
    }));
  };

  const updateDescription = (next: string) => setForm((f) => ({ ...f, description: next.slice(0, 1000) }));

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <div className="space-y-4">
            <Field label="Incident type">
              <div className="grid gap-2 sm:grid-cols-2">
                {(Object.keys(typeMeta) as IncidentType[]).map((type) => {
                  const active = form.type === type;
                  const icon = type === "medical" ? "⚕" : type === "fire" ? "🔥" : type === "intrusion" ? "🛑" : type === "robbery" ? "💥" : "•";
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, type }))}
                      className={`flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${
                        active ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface hover:bg-surface-2"
                      }`}
                    >
                      <span className="text-base">{icon}</span>
                      <div>
                        <div className="text-sm font-medium">{typeMeta[type]}</div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Select incident class</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field label="Severity">
              <div className="grid grid-cols-5 gap-2">
                {([1, 2, 3, 4, 5] as Severity[]).map((severity) => {
                  const meta = severityMeta[severity];
                  const active = form.severity === severity;
                  return (
                    <button
                      key={severity}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, severity }))}
                      className={`rounded-xl border px-3 py-3 text-left ${
                        active ? `border-${meta.token} bg-${meta.token}/15` : "border-border bg-surface"
                      }`}
                    >
                      <div className={`text-sm font-semibold text-${meta.token}`}>S{severity}</div>
                      <div className="text-xs">{meta.label}</div>
                      <div className="text-[10px] text-muted-foreground">{meta.sublabel}</div>
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field label="Title">
              <input
                className="input"
                maxLength={100}
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Short description"
              />
            </Field>

            <Field label={`Description (${form.description.length}/1000)`}>
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <ToolbarButton
                    label="Bold"
                    onClick={() => insertFormatting(descRef, "**", "**", updateDescription)}
                  />
                  <ToolbarButton
                    label="Italic"
                    onClick={() => insertFormatting(descRef, "_", "_", updateDescription)}
                  />
                  <ToolbarButton
                    label="Bullets"
                    onClick={() => insertFormatting(descRef, "- ", "", updateDescription)}
                  />
                </div>
                <textarea
                  ref={descRef}
                  className="input min-h-36 resize-none"
                  maxLength={1000}
                  value={form.description}
                  onChange={(e) => updateDescription(e.target.value)}
                  placeholder="Describe what happened, what was seen, and any immediate risks."
                />
                <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
                  Rich text is captured as structured plain text for reliable incident processing and review.
                </div>
              </div>
            </Field>
          </div>
        );
      case 1:
        return (
          <div className="space-y-4">
            <Field label="Saved location">
              <select className="input" value={form.location_id} onChange={(e) => pickSavedLocation(e.target.value)}>
                <option value="">Use manual location</option>
                {savedLocations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="GPS / Manual pin">
              <div className="grid gap-4 lg:grid-cols-[1fr_0.75fr]">
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={captureGps}
                    disabled={gpsLoading}
                    className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2 disabled:opacity-60"
                  >
                    {gpsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                    Detect GPS
                  </button>

                  <div
                    ref={dropRef}
                    onClick={dropPosToCoords}
                    className="relative h-56 overflow-hidden rounded-2xl border border-border bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.14),transparent_25%),linear-gradient(180deg,rgba(255,255,255,0.05),transparent)]"
                  >
                    <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:20px_20px]" />
                    <div className="absolute left-4 top-4 rounded-full border border-border bg-card px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                      Click to drop pin
                    </div>
                    {form.coord_x != null && form.coord_y != null ? (
                      <div
                        className="absolute -translate-x-1/2 -translate-y-1/2"
                        style={{
                          left: `${((Number(form.coord_x) - 3.2) / 0.5) * 100}%`,
                          top: `${((6.55 - Number(form.coord_y)) / 0.2) * 100}%`,
                        }}
                      >
                        <div className="grid h-10 w-10 place-items-center rounded-full border border-critical/60 bg-critical/15 text-critical">
                          <MapPin className="h-5 w-5" />
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-3">
                  <Field label="Indoor?">
                    <label className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                      <input type="checkbox" checked={form.indoor} onChange={(e) => setForm((f) => ({ ...f, indoor: e.target.checked }))} />
                      Indoor location
                    </label>
                  </Field>
                  <Field label="Floor / zone">
                    <input
                      className="input"
                      value={form.floor}
                      onChange={(e) => setForm((f) => ({ ...f, floor: e.target.value }))}
                      placeholder="e.g. Floor 3, NW Wing"
                      disabled={!form.indoor}
                    />
                  </Field>
                  <Field label="Address fallback">
                    <input
                      className="input"
                      value={form.addressFallback}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, addressFallback: e.target.value, location: e.target.value }))
                      }
                      placeholder="Street address or landmark"
                    />
                  </Field>
                  <div className="rounded-xl border border-border bg-surface p-3 text-xs text-muted-foreground">
                    {form.coord_x != null && form.coord_y != null ? (
                      <>
                        Selected coordinates: <span className="font-mono text-foreground">{Number(form.coord_y).toFixed(5)}, {Number(form.coord_x).toFixed(5)}</span>
                      </>
                    ) : (
                      "No coordinates selected yet."
                    )}
                  </div>
                </div>
              </div>
            </Field>

            <Field label="Zone">
              <select className="input" value={form.zone} onChange={(e) => setForm((f) => ({ ...f, zone: e.target.value }))}>
                {Array.from(
                  new Set([
                    defaultZone,
                    ...savedLocations.map((loc) => loc.name),
                    "Lekki Phase 1",
                    "VI Waterfront",
                    "Ikoyi Heights",
                    "Ajah Estate",
                  ]),
                ).map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        );
      case 2:
        return (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Number of suspects">
                <input type="number" min={0} max={999} className="input" value={form.suspect_count} onChange={(e) => setForm((f) => ({ ...f, suspect_count: e.target.value }))} />
              </Field>
              <Field label="Victim name">
                <input className="input" value={form.victim_name} onChange={(e) => setForm((f) => ({ ...f, victim_name: e.target.value }))} />
              </Field>
            </div>
            <Field label="Suspect description">
              <textarea
                className="input min-h-28 resize-none"
                value={form.suspect_description}
                onChange={(e) => setForm((f) => ({ ...f, suspect_description: e.target.value }))}
                placeholder="Appearance, clothing, vehicle, direction of travel, distinguishing marks..."
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Victim contact">
                <input className="input" value={form.victim_contact} onChange={(e) => setForm((f) => ({ ...f, victim_contact: e.target.value }))} />
              </Field>
              <Field label="Witnesses">
                <input className="input" value={form.witnesses} onChange={(e) => setForm((f) => ({ ...f, witnesses: e.target.value }))} />
              </Field>
            </div>
          </div>
        );
      case 3:
        return (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-surface p-3 text-xs text-muted-foreground">
              Drag and drop files below or use the action buttons. Limits: 5 photos, 2 videos, 1 voice note, 3 documents.
            </div>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files.length > 0) void addDroppedFiles(e.dataTransfer.files);
              }}
              className="rounded-2xl border border-dashed border-border bg-surface/60 p-4"
            >
              <div className="flex flex-wrap gap-2">
                <EvBtn icon={Camera} label={`Photos (${counts.image}/${LIMITS.image})`} onClick={() => photoIn.current?.click()} loading={uploadingKind === "image"} />
                <EvBtn icon={Video} label={`Videos (${counts.video}/${LIMITS.video})`} onClick={() => videoIn.current?.click()} loading={uploadingKind === "video"} />
                {recording ? (
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="inline-flex items-center gap-2 rounded-xl border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical"
                  >
                    <Square className="h-3.5 w-3.5" />
                    Stop ({recSeconds}s)
                  </button>
                ) : (
                  <EvBtn icon={Mic} label={`Voice note (${counts.audio}/${LIMITS.audio})`} onClick={startRecording} loading={uploadingKind === "audio"} />
                )}
                <EvBtn icon={FileText} label={`Documents (${counts.document}/${LIMITS.document})`} onClick={() => docIn.current?.click()} loading={uploadingKind === "document"} />
              </div>
              <div className="mt-3 flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                <CloudUpload className="h-3.5 w-3.5" />
                Drop files here for automatic upload and classification
              </div>
            </div>

            <input ref={photoIn} type="file" accept="image/*" hidden multiple onChange={(e) => e.target.files?.[0] && addDroppedFiles(e.target.files)} />
            <input ref={videoIn} type="file" accept="video/*" hidden multiple onChange={(e) => e.target.files?.[0] && addDroppedFiles(e.target.files)} />
            <input ref={docIn} type="file" accept=".pdf,application/pdf,.doc,.docx,.txt" hidden multiple onChange={(e) => e.target.files?.[0] && addDroppedFiles(e.target.files)} />

            <div className="grid gap-2">
              {evidence.length === 0 ? (
                <div className="rounded-xl border border-border bg-surface p-4 text-sm text-muted-foreground">No evidence added yet.</div>
              ) : (
                evidence.map((item) => (
                  <div key={item.path} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2">
                    {item.previewUrl ? (
                      <img src={item.previewUrl} alt="" className="h-10 w-10 rounded object-cover" />
                    ) : (
                      <div className="grid h-10 w-10 place-items-center rounded bg-card text-[10px] uppercase text-muted-foreground">
                        {item.kind[0]}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{item.name}</div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {(item.size / 1024).toFixed(0)} KB · {item.kind}
                      </div>
                    </div>
                    <button type="button" onClick={() => removeEvidence(item)} className="rounded-md border border-border bg-card p-2 text-muted-foreground hover:text-critical">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        );
      default:
        return (
          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-surface p-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Review</div>
              <h3 className="mt-1 text-lg font-semibold">Confirm incident before submission</h3>
              <p className="mt-1 text-sm text-muted-foreground">Submitting saves the incident and takes you straight to the AI analysis view.</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <SummaryCard label="Type" value={typeMeta[form.type]} />
              <SummaryCard label="Severity" value={`S${form.severity} · ${severityMeta[form.severity].label}`} />
              <SummaryCard label="Title" value={form.title || "Untitled"} />
              <SummaryCard label="Location" value={form.addressFallback || form.location || "Unspecified"} />
              <SummaryCard label="Zone" value={form.zone} />
              <SummaryCard label="Coordinates" value={form.coord_x != null && form.coord_y != null ? `${Number(form.coord_y).toFixed(5)}, ${Number(form.coord_x).toFixed(5)}` : "None"} />
              <SummaryCard label="People" value={`${form.suspect_count || 0} suspect(s)`} />
              <SummaryCard label="Evidence" value={`${evidence.length} item(s)`} />
            </div>
            {form.indoor && form.floor && (
              <SummaryCard label="Floor / indoor note" value={form.floor} wide />
            )}
            {form.description && (
              <div className="rounded-2xl border border-border bg-surface p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Description preview</div>
                <div className="mt-2 whitespace-pre-wrap text-sm leading-6">{form.description}</div>
              </div>
            )}
            <div className="rounded-2xl border border-border bg-surface p-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-2 text-foreground">
                <CheckCircle2 className="h-4 w-4 text-resolved" />
                Ready to submit and trigger AI analysis
              </div>
              <div className="mt-2">The incident payload includes people, location, severity, and evidence attachments already uploaded to storage.</div>
            </div>
          </div>
        );
    }
  };

  const payload = useMemo<IncidentSubmitPayload>(() => {
    const descriptionParts = [
      form.indoor && form.floor ? `Indoor floor / zone: ${form.floor}` : "",
      form.description.trim(),
    ].filter(Boolean);
    return {
      type: form.type,
      severity: form.severity,
      title: form.title || undefined,
      location: form.location.trim() || form.addressFallback.trim() || "Unspecified",
      zone: form.zone,
      description: descriptionParts.join("\n\n").slice(0, 1000) || undefined,
      coord_x: form.coord_x,
      coord_y: form.coord_y,
      location_id: form.location_id || null,
      occurred_at: new Date().toISOString(),
      client_visible: form.client_visible,
      quick_report: false,
      suspect_count: form.suspect_count ? Number(form.suspect_count) : undefined,
      suspect_description: form.suspect_description || undefined,
      victim_name: form.victim_name || undefined,
      victim_contact: form.victim_contact || undefined,
      witnesses: form.witnesses || undefined,
      evidence: evidence.map(({ path, kind, size, name }) => ({ path, kind, size, name })),
    };
  }, [evidence, form]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 backdrop-blur-sm">
      <div className="min-h-full p-4 sm:p-6">
        <div className="mx-auto my-4 w-full max-w-5xl overflow-hidden rounded-3xl border border-border bg-card shadow-2xl">
          <div className="border-b border-border/70 bg-gradient-to-r from-primary/10 via-transparent to-resolved/10 px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Log incident</div>
                <h2 className="mt-1 text-xl font-semibold">Step-by-step incident intake</h2>
                <p className="mt-1 text-sm text-muted-foreground">Create the report, attach evidence, and hand it directly into the AI command flow.</p>
              </div>
              <button onClick={onClose} className="rounded-full border border-border bg-surface p-2 text-muted-foreground hover:bg-surface-2">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {STEP_TITLES.map((title, idx) => (
                <button
                  key={title}
                  type="button"
                  onClick={() => setStep(idx)}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] uppercase tracking-wider ${
                    step === idx ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface text-muted-foreground"
                  }`}
                >
                  <span className="grid h-5 w-5 place-items-center rounded-full border border-current/20 text-[10px]">{idx + 1}</span>
                  {title}
                </button>
              ))}
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit(payload);
            }}
            className="grid gap-6 px-5 py-5 lg:grid-cols-[1.2fr_0.8fr]"
          >
            <div className="space-y-5">
              {renderStep()}

              {error && <div className="rounded-xl border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical">{error}</div>}

              <div className="flex items-center justify-between gap-2 border-t border-border/70 pt-4">
                <button
                  type="button"
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                  disabled={step === 0}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-xs disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" /> Back
                </button>

                <div className="flex items-center gap-2">
                  {step < STEP_TITLES.length - 1 ? (
                    <button
                      type="button"
                      onClick={() => setStep((s) => Math.min(STEP_TITLES.length - 1, s + 1))}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-medium text-primary-foreground"
                    >
                      Next <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={loading || !!uploadingKind}
                      className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-medium text-primary-foreground disabled:opacity-60"
                    >
                      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      Submit & Get AI Analysis
                    </button>
                  )}
                </div>
              </div>
            </div>

            <aside className="space-y-4">
              <div className="rounded-2xl border border-border bg-surface p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Live summary</div>
                <div className="mt-3 space-y-2">
                  <PreviewLine label="Type" value={typeMeta[form.type]} />
                  <PreviewLine label="Severity" value={`S${form.severity} · ${severityMeta[form.severity].label}`} />
                  <PreviewLine label="Location" value={form.addressFallback || form.location || "Unspecified"} />
                  <PreviewLine label="Zone" value={form.zone} />
                  <PreviewLine label="Suspects" value={form.suspect_count || "0"} />
                  <PreviewLine label="Evidence" value={`${evidence.length} file(s)`} />
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-surface p-4">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  <Move className="h-3.5 w-3.5" /> Location intelligence
                </div>
                <div className="mt-3 rounded-xl border border-border bg-card p-3 text-xs text-muted-foreground">
                  {form.coord_x != null && form.coord_y != null ? (
                    <>
                      Coordinates: <span className="font-mono text-foreground">{Number(form.coord_y).toFixed(5)}, {Number(form.coord_x).toFixed(5)}</span>
                    </>
                  ) : (
                    "Drop a pin or detect GPS to seed the incident location."
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-surface p-4">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  <Grip className="h-3.5 w-3.5" /> Evidence status
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <MiniChip label="Photos" value={`${counts.image}/5`} />
                  <MiniChip label="Videos" value={`${counts.video}/2`} />
                  <MiniChip label="Voice" value={`${counts.audio}/1`} />
                  <MiniChip label="Docs" value={`${counts.document}/3`} />
                </div>
              </div>
            </aside>
          </form>
        </div>
      </div>
    </div>
  );
}

function insertFormatting(
  ref: RefObject<HTMLTextAreaElement>,
  prefix: string,
  suffix: string,
  update: (value: string) => void,
) {
  const el = ref.current;
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const selected = el.value.slice(start, end) || "text";
  const next = `${el.value.slice(0, start)}${prefix}${selected}${suffix}${el.value.slice(end)}`;
  update(next);
  queueMicrotask(() => {
    el.focus();
    const pos = start + prefix.length + selected.length + suffix.length;
    el.setSelectionRange(pos, pos);
  });
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}

function ToolbarButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] uppercase tracking-wider hover:bg-surface-2"
    >
      <Sparkles className="h-3 w-3" /> {label}
    </button>
  );
}

function EvBtn({
  icon: Icon,
  label,
  onClick,
  loading,
}: {
  icon: typeof Camera;
  label: string;
  onClick: () => void;
  loading: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs hover:bg-surface-2 disabled:opacity-50"
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}

function SummaryCard({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`rounded-2xl border border-border bg-surface px-3 py-3 ${wide ? "md:col-span-2" : ""}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}

function PreviewLine({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

function MiniChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}
