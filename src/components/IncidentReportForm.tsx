import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { severityMeta, typeMeta, type IncidentType, type Severity } from "@/lib/mockData";
import {
  Camera, Video, Mic, FileText, MapPin, Loader2, X, Trash2, Square, Zap,
} from "lucide-react";

type EvidenceKind = "image" | "video" | "audio" | "document";
type EvidenceItem = { path: string; kind: EvidenceKind; size: number; name: string; previewUrl?: string };

type SavedLocation = { id: string; name: string; coord_x: number | null; coord_y: number | null };

export type IncidentSubmitPayload = {
  type: IncidentType;
  severity: number;
  title?: string;
  location: string;
  zone: string;
  description?: string;
  coord_x?: number;
  coord_y?: number;
  location_id?: string | null;
  occurred_at?: string;
  suspect_count?: number;
  suspect_description?: string;
  victim_name?: string;
  victim_contact?: string;
  witnesses?: string;
  client_visible?: boolean;
  quick_report?: boolean;
  evidence?: { path: string; kind: EvidenceKind; size: number; name: string }[];
};

const MAX = {
  image: 10 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  audio: 10 * 1024 * 1024,
  document: 5 * 1024 * 1024,
} as const;

const LIMITS = { image: 5, video: 2, audio: 1, document: 3 } as const;

export function IncidentReportForm({
  organisationId,
  savedLocations,
  defaultZone,
  onSubmit,
  loading,
  error,
  onClose,
}: {
  organisationId: string;
  savedLocations: SavedLocation[];
  defaultZone: string;
  onSubmit: (data: IncidentSubmitPayload) => void;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"quick" | "full">("quick");
  const [form, setForm] = useState({
    type: "intrusion" as IncidentType,
    severity: 3,
    title: "",
    location: "",
    zone: defaultZone,
    description: "",
    occurred_at: new Date().toISOString().slice(0, 16),
    coord_x: undefined as number | undefined,
    coord_y: undefined as number | undefined,
    location_id: "" as string,
    suspect_count: "" as string,
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
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recTimer = useRef<number | null>(null);
  const [recSeconds, setRecSeconds] = useState(0);

  const photoIn = useRef<HTMLInputElement>(null);
  const videoIn = useRef<HTMLInputElement>(null);
  const docIn = useRef<HTMLInputElement>(null);

  const counts: Record<EvidenceKind, number> = {
    image: evidence.filter((e) => e.kind === "image").length,
    video: evidence.filter((e) => e.kind === "video").length,
    audio: evidence.filter((e) => e.kind === "audio").length,
    document: evidence.filter((e) => e.kind === "document").length,
  };

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
      alert(`${file.name} exceeds ${MAX[kind] / 1024 / 1024}MB limit.`);
      return;
    }
    if (counts[kind] >= LIMITS[kind]) {
      alert(`Maximum ${LIMITS[kind]} ${kind} file(s).`);
      return;
    }
    setUploadingKind(kind);
    const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
    const path = `${organisationId}/draft/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("incident-evidence")
      .upload(path, file, { upsert: false, contentType: file.type });
    setUploadingKind(null);
    if (upErr) {
      alert(`Upload failed: ${upErr.message}`);
      return;
    }
    const previewUrl = kind === "image" ? URL.createObjectURL(file) : undefined;
    setEvidence((prev) => [...prev, { path, kind, size: file.size, name: file.name, previewUrl }]);
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
          if (s >= 119) { stopRecording(); return 120; }
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
    if (recTimer.current) { clearInterval(recTimer.current); recTimer.current = null; }
  };

  useEffect(() => () => { if (recTimer.current) clearInterval(recTimer.current); }, []);

  const removeEvidence = async (item: EvidenceItem) => {
    await supabase.storage.from("incident-evidence").remove([item.path]);
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    setEvidence((prev) => prev.filter((e) => e.path !== item.path));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: IncidentSubmitPayload = {
      type: form.type,
      severity: form.severity,
      title: form.title || undefined,
      location: form.location.trim() || "Unspecified",
      zone: form.zone,
      description: form.description || undefined,
      coord_x: form.coord_x,
      coord_y: form.coord_y,
      location_id: form.location_id || null,
      occurred_at: form.occurred_at ? new Date(form.occurred_at).toISOString() : undefined,
      client_visible: form.client_visible,
      quick_report: mode === "quick",
      evidence: evidence.map(({ path, kind, size, name }) => ({ path, kind, size, name })),
    };
    if (mode === "full") {
      payload.suspect_count = form.suspect_count ? Number(form.suspect_count) : undefined;
      payload.suspect_description = form.suspect_description || undefined;
      payload.victim_name = form.victim_name || undefined;
      payload.victim_contact = form.victim_contact || undefined;
      payload.witnesses = form.witnesses || undefined;
    }
    onSubmit(payload);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm overflow-y-auto">
      <div className="min-h-full flex items-start justify-center p-4 sm:p-6">
        <div className="w-full max-w-2xl rounded-lg border border-border bg-card shadow-2xl my-4">
          <div className="flex items-start justify-between p-5 border-b border-border sticky top-0 bg-card z-10 rounded-t-lg">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Log incident</div>
              <h2 className="mt-1 text-lg font-semibold">{mode === "quick" ? "Quick report" : "Full report"}</h2>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex rounded-md border border-border bg-surface p-0.5">
                <button
                  type="button"
                  onClick={() => setMode("quick")}
                  className={`px-2.5 py-1 text-[11px] uppercase tracking-wider rounded ${mode === "quick" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                >
                  <Zap className="inline h-3 w-3 mr-1" />Quick
                </button>
                <button
                  type="button"
                  onClick={() => setMode("full")}
                  className={`px-2.5 py-1 text-[11px] uppercase tracking-wider rounded ${mode === "full" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                >
                  Full
                </button>
              </div>
              <button onClick={onClose} className="rounded-md p-1 hover:bg-surface"><X className="h-4 w-4" /></button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {/* Severity selector */}
            <div>
              <Label>Severity</Label>
              <div className="grid grid-cols-5 gap-1.5 mt-1">
                {([1, 2, 3, 4, 5] as Severity[]).map((s) => {
                  const meta = severityMeta[s];
                  const active = form.severity === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setForm({ ...form, severity: s })}
                      className={`rounded-md border px-2 py-2 text-left transition-colors ${
                        active ? `border-${meta.token} bg-${meta.token}/15` : "border-border bg-surface hover:bg-surface-2"
                      }`}
                    >
                      <div className={`text-xs font-semibold text-${meta.token}`}>S{s} · {meta.label}</div>
                      <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">{meta.sublabel}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type</Label>
                <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as IncidentType })}>
                  {(Object.keys(typeMeta) as IncidentType[]).map((t) => <option key={t} value={t}>{typeMeta[t]}</option>)}
                </select>
              </div>
              <div>
                <Label>Zone</Label>
                <select className="input" value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })}>
                  {Array.from(new Set([defaultZone, ...savedLocations.map((l) => l.name), "Lekki Phase 1", "VI Waterfront", "Ikoyi Heights", "Ajah Estate"])).map((z) => <option key={z}>{z}</option>)}
                </select>
              </div>
            </div>

            <div>
              <Label>Title <span className="text-muted-foreground">({form.title.length}/100)</span></Label>
              <input className="input" maxLength={100} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Short summary" />
            </div>

            <div>
              <Label>Description <span className="text-muted-foreground">({form.description.length}/1000)</span></Label>
              <textarea className="input resize-none" rows={3} maxLength={1000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What happened?" />
            </div>

            {/* Location */}
            <div className="rounded-md border border-border bg-surface p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Location</div>
                <button type="button" onClick={captureGps} disabled={gpsLoading} className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                  {gpsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <MapPin className="h-3 w-3" />}
                  Detect GPS
                </button>
              </div>
              {form.coord_y !== undefined && (
                <div className="text-[11px] font-mono text-muted-foreground">
                  {form.coord_y.toFixed(5)}, {form.coord_x?.toFixed(5)}
                </div>
              )}
              {savedLocations.length > 0 && (
                <select className="input" value={form.location_id} onChange={(e) => {
                  const loc = savedLocations.find((l) => l.id === e.target.value);
                  setForm({
                    ...form,
                    location_id: e.target.value,
                    location: loc?.name ?? form.location,
                    coord_x: loc?.coord_x ?? form.coord_x ?? undefined,
                    coord_y: loc?.coord_y ?? form.coord_y ?? undefined,
                  });
                }}>
                  <option value="">— Saved location (optional) —</option>
                  {savedLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              )}
              <input
                required
                className="input"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="Address or landmark"
              />
            </div>

            {mode === "full" && (
              <>
                <div>
                  <Label>Time of incident</Label>
                  <input type="datetime-local" className="input" value={form.occurred_at} onChange={(e) => setForm({ ...form, occurred_at: e.target.value })} />
                </div>

                <fieldset className="rounded-md border border-border bg-surface p-3 space-y-2">
                  <legend className="text-[11px] uppercase tracking-wider text-muted-foreground px-1">People involved</legend>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>Suspects</Label>
                      <input type="number" min={0} max={999} className="input" value={form.suspect_count} onChange={(e) => setForm({ ...form, suspect_count: e.target.value })} />
                    </div>
                    <div>
                      <Label>Victim name</Label>
                      <input className="input" value={form.victim_name} onChange={(e) => setForm({ ...form, victim_name: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <Label>Suspect description</Label>
                    <textarea rows={2} className="input resize-none" value={form.suspect_description} onChange={(e) => setForm({ ...form, suspect_description: e.target.value })} placeholder="Gender, clothing, vehicle…" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>Victim contact</Label>
                      <input className="input" value={form.victim_contact} onChange={(e) => setForm({ ...form, victim_contact: e.target.value })} />
                    </div>
                    <div>
                      <Label>Witnesses</Label>
                      <input className="input" value={form.witnesses} onChange={(e) => setForm({ ...form, witnesses: e.target.value })} />
                    </div>
                  </div>
                </fieldset>

                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={form.client_visible} onChange={(e) => setForm({ ...form, client_visible: e.target.checked })} />
                  Visible to client
                </label>
              </>
            )}

            {/* Evidence */}
            <fieldset className="rounded-md border border-border bg-surface p-3 space-y-2">
              <legend className="text-[11px] uppercase tracking-wider text-muted-foreground px-1">Evidence</legend>
              <div className="flex flex-wrap gap-2">
                <EvBtn icon={Camera} label={`Photo (${counts.image}/${LIMITS.image})`} onClick={() => photoIn.current?.click()} loading={uploadingKind === "image"} />
                <EvBtn icon={Video} label={`Video (${counts.video}/${LIMITS.video})`} onClick={() => videoIn.current?.click()} loading={uploadingKind === "video"} />
                <EvBtn icon={FileText} label={`Doc (${counts.document}/${LIMITS.document})`} onClick={() => docIn.current?.click()} loading={uploadingKind === "document"} />
                {recording ? (
                  <button type="button" onClick={stopRecording} className="inline-flex items-center gap-1.5 rounded-md bg-critical/15 border border-critical/40 text-critical px-3 py-1.5 text-xs">
                    <Square className="h-3 w-3" /> Stop ({recSeconds}s)
                  </button>
                ) : (
                  <EvBtn icon={Mic} label={`Voice (${counts.audio}/${LIMITS.audio})`} onClick={startRecording} loading={uploadingKind === "audio"} />
                )}
              </div>

              <input ref={photoIn} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0], "image")} />
              <input ref={videoIn} type="file" accept="video/*" hidden onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0], "video")} />
              <input ref={docIn} type="file" accept=".pdf,application/pdf" hidden onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0], "document")} />

              {evidence.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {evidence.map((e) => (
                    <li key={e.path} className="flex items-center gap-2 text-xs rounded border border-border bg-card px-2 py-1.5">
                      {e.previewUrl
                        ? <img src={e.previewUrl} alt="" className="h-8 w-8 rounded object-cover" />
                        : <div className="h-8 w-8 rounded bg-surface-2 grid place-items-center text-[10px] uppercase text-muted-foreground">{e.kind[0]}</div>}
                      <div className="flex-1 min-w-0">
                        <div className="truncate">{e.name}</div>
                        <div className="text-[10px] text-muted-foreground">{(e.size / 1024).toFixed(0)} KB</div>
                      </div>
                      <button type="button" onClick={() => removeEvidence(e)} className="text-muted-foreground hover:text-critical">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>

            {error && <div className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical">{error}</div>}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="rounded-md border border-border bg-surface px-3 py-2 text-xs hover:bg-surface-2">Cancel</button>
              <button type="submit" disabled={loading || !!uploadingKind} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
                {loading && <Loader2 className="h-3 w-3 animate-spin" />} Submit incident
              </button>
            </div>
          </form>

          <style>{`
            .input { width:100%; border-radius:.375rem; border:1px solid var(--border); background:var(--card); padding:.45rem .6rem; font-size:.8125rem; color:var(--foreground); }
            .input:focus { outline:none; box-shadow:0 0 0 1px var(--ring); }
          `}</style>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{children}</div>;
}

function EvBtn({ icon: Icon, label, onClick, loading }: { icon: typeof Camera; label: string; onClick: () => void; loading: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={loading} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:bg-surface-2 disabled:opacity-50">
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />} {label}
    </button>
  );
}
