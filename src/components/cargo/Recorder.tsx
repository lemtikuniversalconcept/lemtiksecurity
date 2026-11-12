import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, LocateFixed, Video, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Notice } from "@/components/nw";

export const CUSTODY_KIND: Record<string, string> = {
  loaded: "Loaded",
  sealed: "Sealed (new seals applied)",
  departed: "Departed",
  checkpoint: "Reached a checkpoint",
  handover: "Handed over",
  inspection: "Inspected (customs, police, client)",
  delivered: "Delivered",
  exception: "Problem (damage, shortage, stopped, seal broken)",
};
const TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "video/mp4", "video/quicktime", "video/webm", "video/3gpp"];
const MAX = 50 * 1024 * 1024;
const MAX_CLIP_S = 120;

export type RecorderInput = {
  kind: string;
  checkpoint_index: number | null;
  device_at: string;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  seals_observed: string[];
  from_party: string | null;
  to_party: string | null;
  note: string | null;
  media: { path: string; name: string }[];
};
type Attached = { file: File; status: "uploading" | "done" | "failed"; path?: string; error?: string; preview: string };

function clipSeconds(file: File) {
  return new Promise<number | null>((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(v.src);
      resolve(Number.isFinite(v.duration) ? v.duration : null);
    };
    v.onerror = () => resolve(null);
    v.src = URL.createObjectURL(file);
  });
}

/**
 * The custody record form, shared by staff in the app and drivers on their link. Files go
 * straight from the phone to private storage through a one-time upload link; the server
 * fingerprints each one when the record is saved.
 */
export function CustodyRecorder({
  kinds,
  checkpoints,
  sealCount,
  getUploadUrl,
  onSubmit,
  onDone,
  extra,
}: {
  kinds: string[];
  checkpoints: string[];
  sealCount: number;
  getUploadUrl: (f: { name: string; type: string; size: number }) => Promise<{ path: string; token: string }>;
  onSubmit: (input: RecorderInput) => Promise<{ seals_ok: boolean | null; off_checkpoint_m: number | null; seq: number; skipped?: string[] }>;
  onDone?: () => void;
  extra?: React.ReactNode;
}) {
  const [kind, setKind] = useState(kinds[0]);
  const [cp, setCp] = useState<string>("");
  const [seals, setSeals] = useState("");
  const [fromParty, setFrom] = useState("");
  const [toParty, setTo] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<Attached[]>([]);
  const [pos, setPos] = useState<{ lat: number; lng: number; acc: number } | null>(null);
  const [posState, setPosState] = useState<"idle" | "finding" | "denied" | "ok">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const photoRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLInputElement | null>(null);

  const locate = () => {
    if (!("geolocation" in navigator)) return setPosState("denied");
    setPosState("finding");
    navigator.geolocation.getCurrentPosition(
      (p) => { setPos({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }); setPosState("ok"); },
      () => setPosState("denied"),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 },
    );
  };
  useEffect(locate, []);
  useEffect(() => () => files.forEach((f) => URL.revokeObjectURL(f.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  async function attach(list: FileList | null) {
    if (!list) return;
    for (const file of Array.from(list)) {
      if (files.length >= 4) { setError("Up to 4 photos or clips per record."); break; }
      if (!TYPES.includes(file.type)) { setError(`${file.name}: use a photo (JPG, PNG, HEIC) or a video (MP4, MOV, WebM, 3GP).`); continue; }
      if (file.size > MAX) { setError(`${file.name} is over 50 MB. Record a shorter clip.`); continue; }
      if (file.type.startsWith("video/")) {
        const s = await clipSeconds(file);
        if (s != null && s > MAX_CLIP_S) { setError(`${file.name} is ${Math.round(s)} s long. Keep clips under 2 minutes.`); continue; }
      }
      const item: Attached = { file, status: "uploading", preview: URL.createObjectURL(file) };
      setFiles((v) => [...v, item]);
      try {
        const { path, token } = await getUploadUrl({ name: file.name, type: file.type, size: file.size });
        const { error: upErr } = await supabase.storage.from("custody-media").uploadToSignedUrl(path, token, file, { contentType: file.type });
        if (upErr) throw upErr;
        setFiles((v) => v.map((x) => (x.preview === item.preview ? { ...x, status: "done", path } : x)));
      } catch (e) {
        setFiles((v) => v.map((x) => (x.preview === item.preview ? { ...x, status: "failed", error: (e as Error).message || "Upload failed" } : x)));
      }
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (files.some((f) => f.status === "uploading")) return setError("Wait for the files to finish uploading.");
    setBusy(true);
    try {
      const r = await onSubmit({
        kind,
        checkpoint_index: kind === "checkpoint" && cp !== "" ? Number(cp) : null,
        device_at: new Date().toISOString(),
        lat: pos?.lat ?? null,
        lng: pos?.lng ?? null,
        accuracy_m: pos?.acc ?? null,
        seals_observed: seals.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean),
        from_party: fromParty.trim() || null,
        to_party: toParty.trim() || null,
        note: note.trim() || null,
        media: files.filter((f) => f.status === "done" && f.path).map((f) => ({ path: f.path!, name: f.file.name })),
      });
      setResult(
        `Record ${r.seq} saved.` +
          (r.seals_ok === false ? " The seals don't match the ones on record. The operator has been alerted." : r.seals_ok ? " Seals match." : "") +
          (r.off_checkpoint_m ? ` You were ${r.off_checkpoint_m} m from the checkpoint.` : "") +
          (r.skipped?.length ? ` ${r.skipped.join(", ")} ${r.skipped.length === 1 ? "was" : "were"} never recorded. The operator has been alerted.` : ""),
      );
      setSeals(""); setFrom(""); setTo(""); setNote(""); setFiles([]); setCp("");
      onDone?.();
    } catch (err) {
      setError((err as Error).message || "Couldn't save the record.");
    } finally {
      setBusy(false);
    }
  }

  const needsSeals = sealCount > 0 && kind !== "sealed";
  return (
    <form className="col g10" onSubmit={submit}>
      {extra}
      <label className="fl"><span>What happened</span>
        <select className="in" value={kind} onChange={(e) => setKind(e.target.value)}>{kinds.map((k) => <option key={k} value={k}>{CUSTODY_KIND[k]}</option>)}</select>
      </label>
      {kind === "checkpoint" && checkpoints.length > 0 && (
        <label className="fl"><span>Which checkpoint</span>
          <select className="in" value={cp} onChange={(e) => setCp(e.target.value)} required><option value="">Choose</option>{checkpoints.map((c, i) => <option key={i} value={i}>{c}</option>)}</select>
        </label>
      )}
      <label className="fl"><span>{kind === "sealed" ? "New seal numbers (comma between each)" : needsSeals ? `Seal numbers you can see (${sealCount} on record)` : "Seal numbers you can see (optional)"}</span>
        <input className="in mono" value={seals} onChange={(e) => setSeals(e.target.value)} placeholder="e.g. NG123456, NG123457" autoCapitalize="characters" />
      </label>
      {(kind === "handover" || kind === "delivered" || kind === "loaded") && (
        <div className="grid g10" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <label className="fl"><span>Handed over by</span><input className="in" value={fromParty} onChange={(e) => setFrom(e.target.value)} maxLength={160} placeholder="Name and company" /></label>
          <label className="fl"><span>Received by</span><input className="in" value={toParty} onChange={(e) => setTo(e.target.value)} maxLength={160} placeholder="Name and company" /></label>
        </div>
      )}
      <label className="fl"><span>{kind === "exception" ? "What's wrong" : "Note (optional)"}</span><textarea className="in" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} required={kind === "exception"} /></label>

      <div className="col g6">
        <div className="row g6 wrap">
          <button type="button" className="b b-sm b-gh" onClick={() => photoRef.current?.click()} disabled={files.length >= 4}><Camera size={14} /> Photo</button>
          <button type="button" className="b b-sm b-gh" onClick={() => videoRef.current?.click()} disabled={files.length >= 4}><Video size={14} /> Video clip</button>
          <input ref={photoRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { attach(e.target.files); e.target.value = ""; }} />
          <input ref={videoRef} type="file" accept="video/*" capture="environment" hidden onChange={(e) => { attach(e.target.files); e.target.value = ""; }} />
          <span className="t3" style={{ fontSize: 12, alignSelf: "center" }}>Up to 4 · clips under 2 min, 50 MB</span>
        </div>
        {files.length > 0 && (
          <div className="row g8 wrap">
            {files.map((f) => (
              <div key={f.preview} className="col g4" style={{ width: 112 }}>
                <div style={{ position: "relative", width: 112, height: 84, borderRadius: 6, overflow: "hidden", background: "rgba(127,127,127,.15)" }}>
                  {f.file.type.startsWith("video/") ? <video src={f.preview} muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <img src={f.preview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                  <button type="button" aria-label="Remove" onClick={() => setFiles((v) => v.filter((x) => x.preview !== f.preview))} style={{ position: "absolute", top: 2, right: 2, background: "rgba(0,0,0,.6)", color: "#fff", border: 0, borderRadius: 10, width: 20, height: 20, display: "grid", placeItems: "center" }}><X size={12} /></button>
                </div>
                <span className="t3" style={{ fontSize: 11 }}>{f.status === "uploading" ? "Uploading…" : f.status === "failed" ? `Failed: ${f.error}` : "Ready"}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="row g8 wrap t3" style={{ fontSize: 12, alignItems: "center" }}>
        <LocateFixed size={13} />
        {posState === "ok" && pos ? `Location found (±${pos.acc} m)` : posState === "finding" ? "Finding your location…" : posState === "denied" ? "Location not available. Allow location for this site so the record shows where it was made." : "Location not taken yet"}
        <button type="button" className="b b-sm b-gh" onClick={locate}>Refresh</button>
      </div>

      {error && <Notice tone="fail">{error}</Notice>}
      {result && <Notice tone={result.includes("don't match") || result.includes("never recorded") ? "fail" : "ok"}>{result}</Notice>}
      <button type="submit" className="b b-pri" disabled={busy || files.some((f) => f.status === "uploading")}>{busy && <Loader2 size={14} className="animate-spin" />} Save custody record</button>
      <span className="t3" style={{ fontSize: 12 }}>The time, your location and a fingerprint of each file are saved with the record. Records can't be edited afterwards.</span>
    </form>
  );
}
