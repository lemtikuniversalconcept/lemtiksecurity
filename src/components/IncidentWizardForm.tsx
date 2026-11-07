import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { severityMeta, typeMeta, type IncidentType, type Severity } from "@/lib/mockData";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CreditCard,
  Ellipsis,
  Eye,
  FileText,
  Flame,
  Footprints,
  Hand,
  HeartPulse,
  ListChecks,
  Loader2,
  LocateFixed,
  Mic,
  OctagonAlert,
  ShieldAlert,
  Square,
  Trash2,
  TriangleAlert,
  Upload,
  UserX,
  Users,
  Video,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react";
import type { IncidentSubmitPayload } from "@/components/IncidentReportForm";
import { LocationPicker, useMapboxToken } from "@/components/LocationPicker";
import { Sev } from "@/components/nw";

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

const STEPS = [
  { title: "Basics", hint: "Type, severity, what happened" },
  { title: "Location", hint: "Map pin, block, floor" },
  { title: "People", hint: "Suspects, victims, witnesses" },
  { title: "Evidence", hint: "Photos, video, voice notes" },
  { title: "Review", hint: "Confirm and submit" },
] as const;

const TYPE_ICON: Record<IncidentType, LucideIcon> = {
  intrusion: Footprints,
  theft: Hand,
  robbery: OctagonAlert,
  armed_attack: ShieldAlert,
  kidnapping: UserX,
  medical: HeartPulse,
  fire: Flame,
  suspicious: Eye,
  civil_unrest: Users,
  vandalism: TriangleAlert,
  fraud_scam: CreditCard,
  cyber_incident: WifiOff,
  other: Ellipsis,
};

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
  initialDraft?: Partial<Pick<IncidentSubmitPayload, "type" | "severity" | "title" | "location" | "zone" | "floor" | "description" | "coord_x" | "coord_y" | "location_id">>;
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
    floor: initialDraft?.floor ?? "",
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
  const { data: tokenData } = useMapboxToken();

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const captureGps = () => {
    if (!navigator.geolocation) {
      toast.error("This browser can’t share its location.");
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({ ...f, coord_x: Number(pos.coords.longitude.toFixed(6)), coord_y: Number(pos.coords.latitude.toFixed(6)) }));
        setGpsLoading(false);
      },
      () => {
        setGpsLoading(false);
        toast.error("Couldn’t get your location. Check the browser’s location permission.");
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const uploadFile = async (file: File, kind: EvidenceKind) => {
    if (file.size > MAX[kind]) {
      toast.error(`${file.name} is over the ${Math.round(MAX[kind] / 1024 / 1024)} MB limit.`);
      return;
    }
    if (counts[kind] >= LIMITS[kind]) {
      toast.error(`You can add up to ${LIMITS[kind]} ${kind === "image" ? "photos" : kind === "audio" ? "voice note" : `${kind}s`}.`);
      return;
    }
    setUploadingKind(kind);
    const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
    const path = `${organisationId}/draft/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("incident-evidence").upload(path, file, { upsert: false, contentType: file.type });
    setUploadingKind(null);
    if (upErr) {
      toast.error("Upload failed", { description: upErr.message });
      return;
    }
    const previewUrl = kind === "image" ? URL.createObjectURL(file) : undefined;
    setEvidence((prev) => [...prev, { path, kind, size: file.size, name: file.name, previewUrl }]);
  };

  const removeEvidence = async (item: EvidenceItem) => {
    setEvidence((prev) => prev.filter((e) => e.path !== item.path));
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    const { error: rmErr } = await supabase.storage.from("incident-evidence").remove([item.path]);
    if (rmErr) console.warn("[incident-wizard] draft evidence not removed from storage", rmErr);
  };

  const addFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (file.type.startsWith("image/")) await uploadFile(file, "image");
      else if (file.type.startsWith("video/")) await uploadFile(file, "video");
      else if (file.type.startsWith("audio/")) await uploadFile(file, "audio");
      else await uploadFile(file, "document");
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

  const startRecording = async () => {
    if (counts.audio >= LIMITS.audio) {
      toast.error("You can add one voice note.");
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
        await uploadFile(new File([blob], `voice-${Date.now()}.webm`, { type: "audio/webm" }), "audio");
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
      toast.error("Microphone access was denied.");
    }
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

  const coord: [number, number] | null = form.coord_x != null && form.coord_y != null ? [Number(form.coord_x), Number(form.coord_y)] : null;
  const zoneOptions = Array.from(new Set([defaultZone, ...savedLocations.map((l) => l.name)].filter(Boolean)));

  const payload = useMemo<IncidentSubmitPayload>(
    () => ({
      type: form.type,
      severity: form.severity,
      title: form.title || undefined,
      location: form.location.trim() || form.addressFallback.trim() || "Unspecified",
      zone: form.zone.trim() || "Unspecified",
      floor: form.indoor && form.floor ? form.floor.trim() : undefined,
      description: form.description.trim() || undefined,
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
    }),
    [evidence, form],
  );

  const sevLabel = severityMeta[form.severity as Severity];
  const last = step === STEPS.length - 1;

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <>
            <div className="fl">
              <span className="lbl" id="wiz-type">Incident type</span>
              <div role="radiogroup" aria-labelledby="wiz-type" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(118px,100%),1fr))", gap: 8 }}>
                {(Object.keys(typeMeta) as IncidentType[]).map((type) => {
                  const active = form.type === type;
                  const Icon = TYPE_ICON[type] ?? Ellipsis;
                  return (
                    <button
                      key={type}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setForm((f) => ({ ...f, type }))}
                      className="card col g6 text-left"
                      style={{ padding: 12, alignItems: "flex-start", ...(active ? { borderColor: "var(--blue-hi)", background: "var(--blue-bg)", boxShadow: "0 0 0 1px var(--blue-hi) inset" } : {}) }}
                    >
                      <Icon size={18} strokeWidth={1.75} className="ic" style={{ color: active ? "var(--blue-hi)" : "var(--tx-2)" }} />
                      <span style={{ fontSize: 13, fontWeight: 550 }}>{typeMeta[type]}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="fl">
              <span className="lbl" id="wiz-sev">Severity</span>
              <div role="radiogroup" aria-labelledby="wiz-sev" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(104px,100%),1fr))", gap: 8 }}>
                {([5, 4, 3, 2, 1] as Severity[]).map((s) => {
                  const active = form.severity === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setForm((f) => ({ ...f, severity: s }))}
                      className="card col g4 text-left"
                      style={{ padding: "10px 12px", alignItems: "flex-start", ...(active ? { boxShadow: `0 0 0 2px var(--s${s}) inset`, borderColor: "transparent" } : {}) }}
                    >
                      <Sev level={s} label />
                      <span className="t3" style={{ fontSize: 12 }}>{severityMeta[s].sublabel}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="fl">
              <label htmlFor="wiz-title">Title</label>
              <input id="wiz-title" className="in" maxLength={100} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Short summary, e.g. Smoke from generator room" />
            </div>
            <div className="fl">
              <label htmlFor="wiz-desc">
                Description <span className="t3">· {form.description.length}/1000</span>
              </label>
              <textarea
                id="wiz-desc"
                className="in"
                rows={5}
                maxLength={1000}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value.slice(0, 1000) }))}
                placeholder="What happened, what was seen, and any immediate risks."
              />
            </div>
          </>
        );
      case 1:
        return (
          <>
            <div className="fl">
              <label htmlFor="wiz-saved">Saved location</label>
              <select id="wiz-saved" className="in" value={form.location_id} onChange={(e) => pickSavedLocation(e.target.value)}>
                <option value="">Not one of our saved locations</option>
                {savedLocations.map((loc) => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
              </select>
            </div>
            <div className="fl">
              <span className="lbl">Exact position</span>
              <LocationPicker value={coord} center={coord} onChange={([lng, lat]) => setForm((f) => ({ ...f, coord_x: lng, coord_y: lat }))} />
              {tokenData && !tokenData.token && (
                <span className="t3" style={{ fontSize: 12 }}>The map isn’t available on this deployment — use your current GPS position or a saved location.</span>
              )}
              <div className="row g8 wrap">
                <button type="button" onClick={captureGps} disabled={gpsLoading} className="b b-sec">
                  {gpsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LocateFixed size={14} strokeWidth={1.75} />}
                  Use my current position
                </button>
                {coord ? (
                  <>
                    <span className="mono t2" style={{ fontSize: 12 }}>{coord[1].toFixed(5)}, {coord[0].toFixed(5)}</span>
                    <button type="button" className="b b-sm b-gh" onClick={() => setForm((f) => ({ ...f, coord_x: undefined, coord_y: undefined }))}>
                      Clear
                    </button>
                  </>
                ) : (
                  <span className="t3" style={{ fontSize: 12 }}>No position yet — the incident will be listed but not mapped.</span>
                )}
              </div>
            </div>
            <div className="row g12 wrap">
              <div className="fl" style={{ flex: "1 1 220px" }}>
                <label htmlFor="wiz-address">Address or landmark</label>
                <input id="wiz-address" className="in" value={form.addressFallback} onChange={(e) => setForm((f) => ({ ...f, addressFallback: e.target.value, location: e.target.value }))} placeholder="e.g. Block 12, Flat 3B" />
              </div>
              <div className="fl" style={{ flex: "1 1 180px" }}>
                <label htmlFor="wiz-zone">Zone</label>
                <input id="wiz-zone" className="in" list="wiz-zones" value={form.zone} onChange={(e) => setForm((f) => ({ ...f, zone: e.target.value }))} placeholder="e.g. Gate C" />
                <datalist id="wiz-zones">
                  {zoneOptions.map((z) => (
                    <option key={z} value={z} />
                  ))}
                </datalist>
              </div>
            </div>
            <div className="row g12 wrap" style={{ alignItems: "flex-end" }}>
              <label className="row g8" style={{ fontSize: 13 }}>
                <input type="checkbox" checked={form.indoor} onChange={(e) => setForm((f) => ({ ...f, indoor: e.target.checked }))} />
                Indoors
              </label>
              <div className="fl" style={{ flex: "1 1 200px" }}>
                <label htmlFor="wiz-floor">Floor or wing</label>
                <input id="wiz-floor" className="in" value={form.floor} onChange={(e) => setForm((f) => ({ ...f, floor: e.target.value }))} placeholder="e.g. Floor 3, NW wing" disabled={!form.indoor} />
              </div>
            </div>
          </>
        );
      case 2:
        return (
          <>
            <div className="row g12 wrap">
              <div className="fl" style={{ flex: "1 1 160px" }}>
                <label htmlFor="wiz-suspects">Number of suspects</label>
                <input id="wiz-suspects" type="number" min={0} max={999} className="in" value={form.suspect_count} onChange={(e) => setForm((f) => ({ ...f, suspect_count: e.target.value }))} />
              </div>
              <div className="fl" style={{ flex: "2 1 240px" }}>
                <label htmlFor="wiz-victim">Victim name</label>
                <input id="wiz-victim" className="in" value={form.victim_name} onChange={(e) => setForm((f) => ({ ...f, victim_name: e.target.value }))} />
              </div>
            </div>
            <div className="fl">
              <label htmlFor="wiz-suspect-desc">Suspect description</label>
              <textarea id="wiz-suspect-desc" className="in" rows={4} value={form.suspect_description} onChange={(e) => setForm((f) => ({ ...f, suspect_description: e.target.value }))} placeholder="Appearance, clothing, vehicle, direction of travel, distinguishing marks" />
            </div>
            <div className="row g12 wrap">
              <div className="fl" style={{ flex: "1 1 220px" }}>
                <label htmlFor="wiz-contact">Victim contact</label>
                <input id="wiz-contact" className="in" value={form.victim_contact} onChange={(e) => setForm((f) => ({ ...f, victim_contact: e.target.value }))} />
              </div>
              <div className="fl" style={{ flex: "1 1 220px" }}>
                <label htmlFor="wiz-witnesses">Witnesses</label>
                <input id="wiz-witnesses" className="in" value={form.witnesses} onChange={(e) => setForm((f) => ({ ...f, witnesses: e.target.value }))} />
              </div>
            </div>
          </>
        );
      case 3:
        return (
          <>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files.length > 0) void addFiles(e.dataTransfer.files);
              }}
              className="card col g12"
              style={{ padding: 16, borderStyle: "dashed", borderColor: "var(--line-3)" }}
            >
              <div className="row g8 wrap">
                <EvBtn icon={Camera} label={`Photos ${counts.image}/${LIMITS.image}`} onClick={() => photoIn.current?.click()} loading={uploadingKind === "image"} />
                <EvBtn icon={Video} label={`Videos ${counts.video}/${LIMITS.video}`} onClick={() => videoIn.current?.click()} loading={uploadingKind === "video"} />
                {recording ? (
                  <button type="button" onClick={stopRecording} className="b b-red">
                    <Square size={13} strokeWidth={2} /> Stop recording · {recSeconds}s
                  </button>
                ) : (
                  <EvBtn icon={Mic} label={`Voice note ${counts.audio}/${LIMITS.audio}`} onClick={startRecording} loading={uploadingKind === "audio"} />
                )}
                <EvBtn icon={FileText} label={`Documents ${counts.document}/${LIMITS.document}`} onClick={() => docIn.current?.click()} loading={uploadingKind === "document"} />
              </div>
              <span className="row g6 t3" style={{ fontSize: 12 }}>
                <Upload size={13} strokeWidth={1.75} /> Or drop files here. Up to 5 photos, 2 videos, 1 voice note and 3 documents.
              </span>
            </div>
            <input ref={photoIn} type="file" accept="image/*" hidden multiple onChange={(e) => e.target.files?.[0] && addFiles(e.target.files)} />
            <input ref={videoIn} type="file" accept="video/*" hidden multiple onChange={(e) => e.target.files?.[0] && addFiles(e.target.files)} />
            <input ref={docIn} type="file" accept=".pdf,application/pdf,.doc,.docx,.txt" hidden multiple onChange={(e) => e.target.files?.[0] && addFiles(e.target.files)} />
            {evidence.length === 0 ? (
              <div className="empty">No evidence added yet. You can also add it later from the incident.</div>
            ) : (
              <div className="pn list">
                {evidence.map((item) => (
                  <div key={item.path} className="row g10" style={{ padding: "8px 12px" }}>
                    {item.previewUrl ? (
                      <img src={item.previewUrl} alt="" className="h-10 w-10 rounded object-cover" />
                    ) : (
                      <span className="av av-lg" style={{ borderRadius: 8 }}>{item.kind === "audio" ? <Mic size={14} strokeWidth={1.75} /> : item.kind === "video" ? <Video size={14} strokeWidth={1.75} /> : <FileText size={14} strokeWidth={1.75} />}</span>
                    )}
                    <div className="f1">
                      <div className="trunc" style={{ fontWeight: 550 }}>{item.name}</div>
                      <div className="t3 mono" style={{ fontSize: 11 }}>{(item.size / 1024).toFixed(0)} KB · {item.kind}</div>
                    </div>
                    <button type="button" onClick={() => void removeEvidence(item)} className="ibtn" style={{ width: 30, height: 30 }} aria-label={`Remove ${item.name}`}>
                      <Trash2 size={14} strokeWidth={1.75} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        );
      default:
        return (
          <>
            <dl className="kv card" style={{ margin: 0, padding: "12px 14px", gap: "8px 18px" }}>
              <dt>Type</dt>
              <dd>{typeMeta[form.type]}</dd>
              <dt>Severity</dt>
              <dd><Sev level={form.severity} label /></dd>
              <dt>Title</dt>
              <dd>{form.title || <span className="t3">Untitled</span>}</dd>
              <dt>Location</dt>
              <dd>{form.addressFallback || form.location || <span className="t3">Unspecified</span>}</dd>
              <dt>Zone</dt>
              <dd>{form.zone || <span className="t3">Unspecified</span>}</dd>
              <dt>Floor</dt>
              <dd>{form.indoor && form.floor ? form.floor : <span className="t3">Not set</span>}</dd>
              <dt>Position</dt>
              <dd className="mono">{coord ? `${coord[1].toFixed(5)}, ${coord[0].toFixed(5)}` : <span className="t3">Not mapped</span>}</dd>
              <dt>People</dt>
              <dd>{form.suspect_count || 0} suspect(s){form.victim_name ? ` · victim ${form.victim_name}` : ""}</dd>
              <dt>Evidence</dt>
              <dd>{evidence.length} file(s)</dd>
            </dl>
            {form.description && (
              <div className="card" style={{ padding: "12px 14px" }}>
                <span className="eyebrow">Description</span>
                <p className="mt-1 whitespace-pre-wrap" style={{ fontSize: 13, lineHeight: 1.55 }}>{form.description}</p>
              </div>
            )}
            <label className="row g8" style={{ fontSize: 13 }}>
              <input type="checkbox" checked={form.client_visible} onChange={(e) => setForm((f) => ({ ...f, client_visible: e.target.checked }))} />
              Visible to the client admin
            </label>
          </>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: "var(--ink-0)" }} role="dialog" aria-modal="true" aria-label="Log incident">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (last) onSubmit(payload);
          else setStep((s) => Math.min(STEPS.length - 1, s + 1));
        }}
        className="mx-auto flex w-full flex-wrap items-start"
        style={{ maxWidth: 1360, padding: 16, gap: 20 }}
      >
        <div className="col g12" style={{ flex: "1 1 240px", minWidth: 0, maxWidth: "100%" }}>
          <button type="button" onClick={onClose} className="row g4 t3 hover:text-tx-1 self-start" style={{ fontSize: 12 }}>
            <ArrowLeft size={13} strokeWidth={1.75} /> Incidents
          </button>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Log incident</h2>
          <ol className="col" style={{ listStyle: "none", margin: 0, padding: 0, gap: 2 }}>
            {STEPS.map((s, idx) => {
              const current = idx === step;
              const done = idx < step;
              return (
                <li key={s.title}>
                  <button type="button" onClick={() => setStep(idx)} className="row g10 w-full text-left" style={{ padding: "10px 12px", borderRadius: 8, background: current ? "var(--ink-2)" : undefined }} aria-current={current ? "step" : undefined}>
                    <span
                      className="grid place-items-center"
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        fontSize: 12,
                        fontWeight: current ? 700 : 500,
                        ...(current ? { background: "var(--blue)", color: "#fff" } : done ? { background: "var(--ok-bg)", color: "#7DE0AA" } : { border: "1.5px solid var(--line-3)", color: "var(--tx-3)" }),
                      }}
                    >
                      {idx + 1}
                    </span>
                    <span className="col">
                      <b style={{ fontSize: 13, fontWeight: current ? 600 : 500, color: current ? "var(--tx-1)" : "var(--tx-3)" }}>{s.title}</b>
                      <span className="t3" style={{ fontSize: 12 }}>{s.hint}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="card t3" style={{ padding: "10px 12px", fontSize: 12 }}>
            On submit, Lemtik saves the incident, starts AI analysis and opens the response view.
          </div>
        </div>

        <div className="col g16" style={{ flex: "999 1 520px", minWidth: 0 }}>
          <div className="row g8">
            <div className="f1">
              <span className="eyebrow">Step {step + 1} of {STEPS.length}</span>
              <h1 className="ph1" style={{ marginTop: 4 }}>
                {["What happened?", "Where is it?", "Who was involved?", "Add evidence", "Check and submit"][step]}
              </h1>
            </div>
            <button type="button" onClick={onClose} className="ibtn" aria-label="Close without saving">
              <X size={16} strokeWidth={1.75} />
            </button>
          </div>
          {renderStep()}
          {error && (
            <div className="tg tg-fail" role="alert" style={{ height: "auto", padding: "8px 10px", fontSize: 12.5, whiteSpace: "normal" }}>
              {error}
            </div>
          )}
          <div className="row g8 sticky bottom-0" style={{ borderTop: "1px solid var(--line-1)", paddingTop: 14, paddingBottom: 8, background: "var(--ink-0)" }}>
            {step === 0 ? (
              <button type="button" onClick={onClose} className="b b-gh">Cancel</button>
            ) : (
              <button type="button" onClick={() => setStep((s) => Math.max(0, s - 1))} className="b b-gh">
                <ArrowLeft size={15} strokeWidth={1.75} /> Back
              </button>
            )}
            <span className="flex-auto" />
            {uploadingKind && (
              <span className="row g6 t3" style={{ fontSize: 12 }}>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…
              </span>
            )}
            <button type="submit" disabled={loading || !!uploadingKind} className="b b-pri b-lg">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {last ? "Submit incident" : `Continue to ${STEPS[step + 1].title.toLowerCase()}`}
              {!last && <ArrowRight size={15} strokeWidth={1.75} />}
            </button>
          </div>
        </div>

        <aside className="col g12 max-[900px]:hidden" style={{ flex: "1 1 300px", minWidth: 0, maxWidth: "100%" }}>
          <section className="pn">
            <div className="pn-h">
              <ListChecks size={15} strokeWidth={1.75} className="ic" />
              <h3>Live summary</h3>
            </div>
            <div className="pn-b">
              <dl className="kv" style={{ margin: 0 }}>
                <dt>Type</dt>
                <dd>{typeMeta[form.type]}</dd>
                <dt>Severity</dt>
                <dd><Sev level={form.severity} label /></dd>
                <dt>Location</dt>
                <dd>{form.addressFallback || form.location || <span className="t3">Not set</span>}</dd>
                <dt>Zone</dt>
                <dd>{form.zone || <span className="t3">Not set</span>}</dd>
                <dt>Position</dt>
                <dd className="mono">{coord ? `${coord[1].toFixed(4)}, ${coord[0].toFixed(4)}` : <span className="t3">Not mapped</span>}</dd>
                <dt>Suspects</dt>
                <dd>{form.suspect_count || "0"}</dd>
                <dt>Evidence</dt>
                <dd>{evidence.length} file(s)</dd>
              </dl>
            </div>
          </section>
          <div className="card t3" style={{ padding: "10px 12px", fontSize: 12 }}>
            {sevLabel ? `S${form.severity} · ${sevLabel.sublabel}. ` : ""}Severity sets alert routing; you can change it on the incident later.
          </div>
        </aside>
      </form>
    </div>
  );
}

function EvBtn({ icon: Icon, label, onClick, loading }: { icon: LucideIcon; label: string; onClick: () => void; loading: boolean }): ReactNode {
  return (
    <button type="button" onClick={onClick} disabled={loading} className="b b-sec">
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon size={14} strokeWidth={1.75} />}
      {label}
    </button>
  );
}
