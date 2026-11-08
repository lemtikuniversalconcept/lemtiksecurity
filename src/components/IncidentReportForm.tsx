import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { typeMeta, type IncidentType } from "@/lib/mockData";
import { Camera, FileText, Loader2, MapPin, Mic, Square, Trash2, Video } from "lucide-react";
import { Notice, SEV_LABEL } from "@/components/nw";

type EvidenceKind = "image" | "video" | "audio" | "document";
type EvidenceItem = { path: string; kind: EvidenceKind; size: number; name: string; previewUrl?: string };
type SavedLocation = { id: string; name: string; coord_x: number | null; coord_y: number | null };

export type IncidentSubmitPayload = {
  type: IncidentType;
  severity: number;
  title?: string;
  location: string;
  zone: string;
  floor?: string;
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

const MAX_BYTES = { image: 10, video: 50, audio: 10, document: 5 } as const;
const LIMITS = { image: 5, video: 2, audio: 1, document: 3 } as const;
const COMMON_TYPES: IncidentType[] = ["intrusion", "theft", "suspicious", "medical", "fire", "vandalism"];

/** The officer's incident report, built for a phone held in one hand. */
export function IncidentReportForm({
  organisationId,
  savedLocations,
  defaultZone,
  initialDraft,
  onSubmit,
  loading,
  error,
  onClose,
  online = true,
}: {
  organisationId: string;
  savedLocations: SavedLocation[];
  defaultZone: string;
  initialDraft?: Partial<Pick<IncidentSubmitPayload, "type" | "severity" | "title" | "location" | "zone" | "description" | "coord_x" | "coord_y" | "location_id">>;
  onSubmit: (data: IncidentSubmitPayload) => void;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  online?: boolean;
}) {
  const [full, setFull] = useState(false);
  const [form, setForm] = useState({
    type: initialDraft?.type ?? ("intrusion" as IncidentType),
    severity: initialDraft?.severity ?? 3,
    title: initialDraft?.title ?? "",
    location: initialDraft?.location ?? "",
    zone: initialDraft?.zone ?? defaultZone,
    description: initialDraft?.description ?? "",
    occurred_at: "",
    coord_x: initialDraft?.coord_x as number | undefined,
    coord_y: initialDraft?.coord_y as number | undefined,
    location_id: (initialDraft?.location_id ?? "") as string,
    suspect_count: "",
    suspect_description: "",
    victim_name: "",
    victim_contact: "",
    witnesses: "",
    client_visible: true,
  });
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [gps, setGps] = useState<"idle" | "busy" | "fail">("idle");
  const [uploading, setUploading] = useState<EvidenceKind | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recTimer = useRef<number | null>(null);
  const photoIn = useRef<HTMLInputElement>(null);
  const videoIn = useRef<HTMLInputElement>(null);
  const docIn = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const count = (k: EvidenceKind) => evidence.filter((e) => e.kind === k).length;

  const captureGps = () => {
    if (!navigator.geolocation) return setGps("fail");
    setGps("busy");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        set({ coord_x: p.coords.longitude, coord_y: p.coords.latitude });
        setGps("idle");
      },
      () => setGps("fail"),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };
  // Grab a position straight away; officers rarely type coordinates.
  useEffect(() => {
    if (form.coord_x == null) captureGps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upload = async (file: File, kind: EvidenceKind) => {
    setFileError(null);
    if (!online) return setFileError("Attachments need a connection. Send the report now and add files later from the incident page.");
    if (file.size > MAX_BYTES[kind] * 1024 * 1024) return setFileError(`${file.name} is over the ${MAX_BYTES[kind]} MB limit.`);
    if (count(kind) >= LIMITS[kind]) return setFileError(`You can attach up to ${LIMITS[kind]} ${kind === "image" ? "photos" : kind === "audio" ? "voice note" : `${kind}s`}.`);
    setUploading(kind);
    const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
    const path = `${organisationId}/draft/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("incident-evidence").upload(path, file, { upsert: false, contentType: file.type });
    setUploading(null);
    if (upErr) return setFileError(`Upload failed: ${upErr.message}`);
    setEvidence((prev) => [...prev, { path, kind, size: file.size, name: file.name, previewUrl: kind === "image" ? URL.createObjectURL(file) : undefined }]);
  };

  const stopRecording = () => {
    mediaRef.current?.stop();
    setRecording(false);
    if (recTimer.current) window.clearInterval(recTimer.current);
    recTimer.current = null;
  };
  const startRecording = async () => {
    setFileError(null);
    if (count("audio") >= LIMITS.audio) return setFileError("You can attach one voice note.");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      mediaRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        await upload(new File([blob], `voice-${Date.now()}.webm`, { type: "audio/webm" }), "audio");
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
      setFileError("The microphone isn't available. Check the app's permission.");
    }
  };
  useEffect(() => () => {
    if (recTimer.current) window.clearInterval(recTimer.current);
  }, []);

  const removeEvidence = async (item: EvidenceItem) => {
    await supabase.storage.from("incident-evidence").remove([item.path]);
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    setEvidence((prev) => prev.filter((e) => e.path !== item.path));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: IncidentSubmitPayload = {
      type: form.type,
      severity: form.severity,
      title: form.title.trim() || undefined,
      location: form.location.trim() || (form.coord_y != null ? "Officer's position" : "Not given"),
      zone: form.zone,
      description: form.description.trim() || undefined,
      coord_x: form.coord_x,
      coord_y: form.coord_y,
      location_id: form.location_id || null,
      occurred_at: form.occurred_at ? new Date(form.occurred_at).toISOString() : undefined,
      client_visible: form.client_visible,
      quick_report: !full,
      evidence: evidence.map(({ path, kind, size, name }) => ({ path, kind, size, name })),
    };
    if (full) {
      payload.suspect_count = form.suspect_count ? Number(form.suspect_count) : undefined;
      payload.suspect_description = form.suspect_description.trim() || undefined;
      payload.victim_name = form.victim_name.trim() || undefined;
      payload.victim_contact = form.victim_contact.trim() || undefined;
      payload.witnesses = form.witnesses.trim() || undefined;
    }
    onSubmit(payload);
  };

  const zones = Array.from(new Set([defaultZone, ...savedLocations.map((l) => l.name)].filter(Boolean)));

  return (
    <form onSubmit={submit} className="col g12">
      <div className="fl">
        <span className="o-lbl">WHAT HAPPENED</span>
        <div className="grid grid-cols-3 gap-2">
          {COMMON_TYPES.map((t) => (
            <button key={t} type="button" className={`chip${form.type === t ? " on" : ""}`} aria-pressed={form.type === t} onClick={() => set({ type: t })} style={{ height: 40, justifyContent: "center" }}>
              {typeMeta[t]}
            </button>
          ))}
        </div>
        <select className="in" value={form.type} onChange={(e) => set({ type: e.target.value as IncidentType })} aria-label="Incident type">
          {(Object.keys(typeMeta) as IncidentType[]).map((t) => (
            <option key={t} value={t}>
              {typeMeta[t]}
            </option>
          ))}
        </select>
      </div>

      <div className="fl">
        <span className="o-lbl">HOW SERIOUS</span>
        <div className="grid grid-cols-5 gap-1">
          {[1, 2, 3, 4, 5].map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={form.severity === s}
              onClick={() => set({ severity: s })}
              className="col"
              style={{ height: 52, borderRadius: 10, alignItems: "center", justifyContent: "center", border: `1px solid ${form.severity === s ? `var(--s${s})` : "var(--line-2)"}`, background: form.severity === s ? `color-mix(in oklab, var(--s${s}) 20%, var(--ink-1))` : "var(--ink-1)", color: "var(--tx-1)" }}
            >
              <b className="mono">S{s}</b>
              <span style={{ fontSize: 10.5 }} className="t2">
                {SEV_LABEL[s as 1]}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="fl">
        <span className="o-lbl">WHERE</span>
        <div className="row g8">
          <span className="t2 f1" style={{ fontSize: 13 }}>
            {gps === "busy" ? "Getting your position…" : form.coord_y != null ? `Your position ${form.coord_y.toFixed(5)}, ${form.coord_x?.toFixed(5)}` : gps === "fail" ? "No GPS fix" : "No position yet"}
          </span>
          <button type="button" className="b b-sm b-gh" onClick={captureGps} disabled={gps === "busy"}>
            {gps === "busy" ? <Loader2 size={14} className="animate-spin" /> : <MapPin size={14} />} {form.coord_y != null ? "Update" : "Use my position"}
          </button>
        </div>
        {savedLocations.length > 0 && (
          <select
            className="in"
            value={form.location_id}
            onChange={(e) => {
              const loc = savedLocations.find((l) => l.id === e.target.value);
              set({ location_id: e.target.value, location: loc?.name ?? form.location, zone: loc?.name ?? form.zone });
            }}
            aria-label="Site"
          >
            <option value="">Site (optional)</option>
            {savedLocations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        <input className="in" value={form.location} onChange={(e) => set({ location: e.target.value })} placeholder="Landmark, e.g. Block 9 junction" aria-label="Landmark" />
        {zones.length > 1 && (
          <select className="in" value={form.zone} onChange={(e) => set({ zone: e.target.value })} aria-label="Zone">
            {zones.map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        )}
      </div>

      <div className="fl">
        <span className="o-lbl">DETAILS</span>
        <textarea className="in" rows={3} maxLength={1000} value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="What did you see? Who, how many, which way did they go?" style={{ height: "auto", paddingTop: 8 }} />
      </div>

      <div className="fl">
        <span className="o-lbl">ATTACH</span>
        <div className="grid grid-cols-4 gap-2">
          <AttachBtn icon={<Camera size={20} />} label={`Photo ${count("image")}/${LIMITS.image}`} busy={uploading === "image"} onClick={() => photoIn.current?.click()} />
          <AttachBtn icon={<Video size={20} />} label={`Video ${count("video")}/${LIMITS.video}`} busy={uploading === "video"} onClick={() => videoIn.current?.click()} />
          {recording ? (
            <button type="button" className="qa" onClick={stopRecording} style={{ height: 72, borderColor: "var(--s5)", color: "var(--s5)" }}>
              <Square size={18} /> {recSeconds}s
            </button>
          ) : (
            <AttachBtn icon={<Mic size={20} />} label={`Voice ${count("audio")}/${LIMITS.audio}`} busy={uploading === "audio"} onClick={startRecording} />
          )}
          <AttachBtn icon={<FileText size={20} />} label={`PDF ${count("document")}/${LIMITS.document}`} busy={uploading === "document"} onClick={() => docIn.current?.click()} />
        </div>
        <input ref={photoIn} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], "image")} />
        <input ref={videoIn} type="file" accept="video/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], "video")} />
        <input ref={docIn} type="file" accept=".pdf,application/pdf" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], "document")} />
        {fileError && <Notice tone="warn">{fileError}</Notice>}
        {evidence.length > 0 && (
          <div className="col g6">
            {evidence.map((e) => (
              <div key={e.path} className="o-card row g10" style={{ padding: 8 }}>
                {e.previewUrl ? <img src={e.previewUrl} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover" }} /> : <span className="tg">{e.kind}</span>}
                <span className="f1 trunc" style={{ fontSize: 13 }}>
                  {e.name}
                </span>
                <button type="button" className="ibtn" style={{ width: 30, height: 30 }} aria-label={`Remove ${e.name}`} onClick={() => removeEvidence(e)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <button type="button" className="b b-gh" onClick={() => setFull((v) => !v)} aria-expanded={full} style={{ alignSelf: "flex-start" }}>
        {full ? "Fewer details" : "Add people, time and witnesses"}
      </button>
      {full && (
        <div className="col g10">
          <label className="fl">
            <span className="lbl">Short title</span>
            <input className="in" maxLength={100} value={form.title} onChange={(e) => set({ title: e.target.value })} />
          </label>
          <label className="fl">
            <span className="lbl">When it happened (if not just now)</span>
            <input className="in mono" type="datetime-local" value={form.occurred_at} onChange={(e) => set({ occurred_at: e.target.value })} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="fl">
              <span className="lbl">Suspects</span>
              <input className="in" type="number" min={0} max={999} inputMode="numeric" value={form.suspect_count} onChange={(e) => set({ suspect_count: e.target.value })} />
            </label>
            <label className="fl">
              <span className="lbl">Victim name</span>
              <input className="in" value={form.victim_name} onChange={(e) => set({ victim_name: e.target.value })} />
            </label>
          </div>
          <label className="fl">
            <span className="lbl">Suspect description</span>
            <input className="in" value={form.suspect_description} onChange={(e) => set({ suspect_description: e.target.value })} placeholder="Clothing, build, vehicle" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="fl">
              <span className="lbl">Victim contact</span>
              <input className="in" inputMode="tel" value={form.victim_contact} onChange={(e) => set({ victim_contact: e.target.value })} />
            </label>
            <label className="fl">
              <span className="lbl">Witnesses</span>
              <input className="in" value={form.witnesses} onChange={(e) => set({ witnesses: e.target.value })} />
            </label>
          </div>
          <label className="row g8" style={{ fontSize: 13 }}>
            <input type="checkbox" checked={form.client_visible} onChange={(e) => set({ client_visible: e.target.checked })} /> Client can see this report
          </label>
        </div>
      )}

      {error && <Notice tone="fail">{error}</Notice>}
      <button type="submit" className="bigbtn" style={{ background: "var(--blue)", color: "#fff" }} disabled={loading || !!uploading || recording}>
        {loading && <Loader2 size={18} className="animate-spin" />} {online ? "Send report" : "Save report (sends when online)"}
      </button>
      <button type="button" className="b b-gh" onClick={onClose} style={{ alignSelf: "center" }}>
        Cancel
      </button>
    </form>
  );
}

function AttachBtn({ icon, label, busy, onClick }: { icon: React.ReactNode; label: string; busy: boolean; onClick: () => void }) {
  return (
    <button type="button" className="qa" onClick={onClick} disabled={busy} style={{ height: 72, fontSize: 11.5 }}>
      {busy ? <Loader2 size={20} className="animate-spin" /> : icon}
      {label}
    </button>
  );
}
