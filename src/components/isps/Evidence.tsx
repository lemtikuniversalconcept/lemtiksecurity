import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FileText, Loader2, Paperclip, Pencil, Plus, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Empty, Notice, Panel, Status, type Tone } from "@/components/nw";
import {
  archiveTraining,
  drillEvidenceUploadUrl,
  EVIDENCE_MAX_BYTES,
  EVIDENCE_TYPES,
  getDrillEvidence,
  listTraining,
  saveDrillEvidence,
  saveTraining,
  trainingUploadUrl,
  type Attendee,
  type TrainingRecord,
} from "@/lib/isps-evidence.functions";
import { ROLE_SUGGESTIONS, TRAINING_WARN_DAYS, type TrainingState } from "@/lib/isps.rules";

const dateOnly = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const size = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const lagosToday = () => new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
const TYPES = EVIDENCE_TYPES as readonly string[];

type Uploaded = { key: string; name: string; status: "uploading" | "done" | "failed"; path?: string; error?: string };

/** Uploads files straight to the private evidence bucket through signed links from the server. */
function useUploads(getUrl: (f: { name: string; type: string; size: number }) => Promise<{ path: string; token: string }>, max: number) {
  const [files, setFiles] = useState<Uploaded[]>([]);
  async function attach(list: FileList | null) {
    if (!list) return;
    let count = files.length;
    for (const file of Array.from(list)) {
      if (count >= max) { toast.error(`Up to ${max} file${max === 1 ? "" : "s"} here.`); break; }
      if (!TYPES.includes(file.type)) { toast.error(`${file.name}: use a photo (JPG, PNG, WebP, HEIC) or a PDF.`); continue; }
      if (file.size > EVIDENCE_MAX_BYTES) { toast.error(`${file.name} is over 25 MB.`); continue; }
      count++;
      const key = `${file.name}-${crypto.randomUUID()}`;
      setFiles((v) => [...v, { key, name: file.name, status: "uploading" }]);
      try {
        const { path, token } = await getUrl({ name: file.name, type: file.type, size: file.size });
        const { error } = await supabase.storage.from("isps-evidence").uploadToSignedUrl(path, token, file, { contentType: file.type });
        if (error) throw error;
        setFiles((v) => v.map((x) => (x.key === key ? { ...x, status: "done", path } : x)));
      } catch (e) {
        setFiles((v) => v.map((x) => (x.key === key ? { ...x, status: "failed", error: (e as Error).message || "Upload failed" } : x)));
      }
    }
  }
  return {
    files,
    attach,
    remove: (key: string) => setFiles((v) => v.filter((x) => x.key !== key)),
    reset: () => setFiles([]),
    busy: files.some((f) => f.status === "uploading"),
    done: files.filter((f) => f.status === "done" && f.path).map((f) => ({ path: f.path!, name: f.name })),
  };
}

function UploadList({ u }: { u: ReturnType<typeof useUploads> }) {
  if (!u.files.length) return null;
  return (
    <div className="col g4" style={{ fontSize: 12 }}>
      {u.files.map((f) => (
        <div key={f.key} className="row g6" style={{ alignItems: "center" }}>
          {f.status === "uploading" ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />}
          <span className="f1" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
          {f.status === "failed" && <span style={{ color: "var(--fail)" }}>{f.error}</span>}
          {f.status === "done" && <span className="t3">Uploaded</span>}
          <button type="button" className="b b-sm b-gh" aria-label={`Remove ${f.name}`} onClick={() => u.remove(f.key)}><X size={12} /></button>
        </div>
      ))}
    </div>
  );
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="no-print" style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(5,7,10,.55)", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "6vh 16px", overflowY: "auto" }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card col g12" style={{ width: "min(720px, 100%)", padding: 16, background: "var(--ink-1)" }}>
        <div className="row g8" style={{ alignItems: "center" }}>
          <b className="f1" style={{ fontSize: 15 }}>{title}</b>
          <button type="button" className="b b-sm b-gh" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ───────────────────────────── Drill evidence ─────────────────────────────

/** Button that opens a drill's evidence; shows what's attached so far. */
export function DrillEvidenceButton({ drillId, files, attended, hasLessons }: { drillId: string; files: number; attended: number; hasLessons: boolean }) {
  const [open, setOpen] = useState(false);
  const bits = [files ? `${files} file${files === 1 ? "" : "s"}` : null, attended ? `${attended} attended` : null, hasLessons ? "lessons" : null].filter(Boolean);
  return (
    <>
      <button type="button" className="b b-sm b-gh" onClick={() => setOpen(true)}>
        <Paperclip size={12} /> Evidence{bits.length ? ` · ${bits.join(" · ")}` : ""}
      </button>
      {open && <DrillEvidenceDialog drillId={drillId} onClose={() => setOpen(false)} />}
    </>
  );
}

export function DrillEvidenceDialog({ drillId, onClose }: { drillId: string; onClose: () => void }) {
  const fn = useServerFn(getDrillEvidence);
  const q = useQuery({ queryKey: ["isps-drill-evidence", drillId], queryFn: () => fn({ data: { drill_id: drillId } }) });
  const [editing, setEditing] = useState(false);
  const d = q.data;
  return (
    <Dialog title={d ? `${d.kind === "exercise" ? "Exercise" : "Drill"} evidence · ${d.facility}` : "Drill evidence"} onClose={onClose}>
      {q.isLoading && <span className="row g8 t3"><Loader2 size={14} className="animate-spin" /> Loading…</span>}
      {q.error && <Notice tone="fail">{(q.error as Error).message}</Notice>}
      {d && (
        <div className="col g12" style={{ fontSize: 13 }}>
          <div className="col g4">
            <b>{d.scenario}</b>
            <span className="t3">{dateOnly(d.held_on)}{d.participants != null ? ` · ${d.participants} people` : ""} · recorded by {d.recorded_by_name ?? "—"}{d.evidence_updated_at ? ` · evidence last updated ${when(d.evidence_updated_at)}` : ""}</span>
            {d.findings && <span className="t2"><b>Found:</b> {d.findings}</span>}
            {d.corrective_actions && <span className="t2"><b>Actions:</b> {d.corrective_actions}</span>}
          </div>
          {editing ? (
            <EvidenceForm drill={d} onDone={() => setEditing(false)} />
          ) : (
            <>
              <section className="col g6">
                <b style={{ fontSize: 12 }} className="t2">Lessons learned</b>
                {d.lessons_learned ? <p className="t2" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{d.lessons_learned}</p> : <span className="t3">Not written yet.</span>}
              </section>
              <section className="col g6">
                <b style={{ fontSize: 12 }} className="t2">Attendance ({d.attendance.length})</b>
                {d.attendance.length ? (
                  <ol style={{ margin: 0, paddingLeft: 18, columns: d.attendance.length > 8 ? 2 : 1 }}>
                    {d.attendance.map((a, i) => <li key={i}>{a.name}{a.role ? <span className="t3"> · {a.role}</span> : null}</li>)}
                  </ol>
                ) : <span className="t3">No attendance list.</span>}
              </section>
              <section className="col g6">
                <b style={{ fontSize: 12 }} className="t2">Photos and documents ({d.evidence.length})</b>
                {d.evidence.length ? (
                  <div className="grid g8" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
                    {d.evidence.map((f) => (
                      <a key={f.path} href={f.url ?? undefined} target="_blank" rel="noreferrer" className="card col g4" style={{ padding: 8, textDecoration: "none", color: "inherit" }} title={`SHA-256 ${f.sha256}`}>
                        {f.type.startsWith("image/") && f.url && f.type !== "image/heic"
                          ? <img src={f.url} alt={f.name} loading="lazy" style={{ width: "100%", height: 100, objectFit: "cover", borderRadius: 4 }} />
                          : <div className="row" style={{ height: 100, alignItems: "center", justifyContent: "center" }}><FileText size={28} /></div>}
                        <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                        <span className="t3" style={{ fontSize: 11 }}>{size(f.size)} · {f.added_by_name ?? "—"} · <code>{f.sha256.slice(0, 10)}</code></span>
                      </a>
                    ))}
                  </div>
                ) : <span className="t3">Nothing attached.</span>}
                {d.evidence.length > 0 && <span className="t3" style={{ fontSize: 11 }}>Each file was fingerprinted (SHA-256) when attached. Links open for one hour.</span>}
              </section>
              {d.can_edit && <button type="button" className="b b-pri" style={{ alignSelf: "flex-start" }} onClick={() => setEditing(true)}><Pencil size={14} /> Add evidence</button>}
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}

function EvidenceForm({ drill, onDone }: { drill: { id: string; lessons_learned: string | null; attendance: Attendee[]; evidence: unknown[] }; onDone: () => void }) {
  const qc = useQueryClient();
  const upFn = useServerFn(drillEvidenceUploadUrl);
  const saveFn = useServerFn(saveDrillEvidence);
  const u = useUploads((f) => upFn({ data: { drill_id: drill.id, ...f, type: f.type as (typeof EVIDENCE_TYPES)[number] } }), 20 - drill.evidence.length);
  const [lessons, setLessons] = useState(drill.lessons_learned ?? "");
  const [people, setPeople] = useState(drill.attendance.map((a) => (a.role ? `${a.name}, ${a.role}` : a.name)).join("\n"));
  const attendance = people.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const [name, ...rest] = l.split(/\s*[,;\t]\s*/);
    return { name: name.slice(0, 160), role: rest.join(", ").slice(0, 120) || null };
  });
  const m = useMutation({
    mutationFn: () => saveFn({ data: { drill_id: drill.id, lessons_learned: lessons.trim() || null, attendance, add_files: u.done } }),
    onSuccess: (r) => {
      toast.success(r.added ? `Saved, with ${r.added} new file${r.added === 1 ? "" : "s"}.` : "Saved.");
      qc.invalidateQueries({ queryKey: ["isps-drill-evidence", drill.id] });
      qc.invalidateQueries({ queryKey: ["isps"] });
      u.reset();
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <form className="col g10" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <label className="fl"><span>Lessons learned</span><textarea className="in" rows={4} value={lessons} onChange={(e) => setLessons(e.target.value)} maxLength={4000} placeholder="What worked, what didn't, and what changes in the plan or training as a result" /></label>
      <label className="fl">
        <span>Attendance: one person per line, as “Name, role”</span>
        <textarea className="in" rows={6} value={people} onChange={(e) => setPeople(e.target.value)} placeholder={"Adaeze Okafor, PFSO\nTunde Bello, Security guard"} />
        <span className="t3" style={{ fontSize: 11 }}>{attendance.length} {attendance.length === 1 ? "person" : "people"}. You can paste a column from a spreadsheet.</span>
      </label>
      <div className="col g6">
        <span style={{ fontSize: 12 }} className="t2">Photos and documents (sign-in sheet, photos, the drill report as PDF)</span>
        <label className="b b-gh" style={{ alignSelf: "flex-start", cursor: "pointer" }}>
          <Plus size={14} /> Attach files
          <input type="file" multiple accept={TYPES.join(",")} style={{ display: "none" }} onChange={(e) => { u.attach(e.target.files); e.target.value = ""; }} />
        </label>
        <UploadList u={u} />
        <span className="t3" style={{ fontSize: 11 }}>Up to 25 MB each, 20 per drill. Files can be added later but not removed, so the record stays complete.</span>
      </div>
      <div className="row g8">
        <button type="submit" className="b b-pri" disabled={m.isPending || u.busy}>{m.isPending && <Loader2 size={14} className="animate-spin" />} Save</button>
        <button type="button" className="b b-gh" onClick={onDone}>Cancel</button>
        {u.busy && <span className="t3" style={{ fontSize: 12 }}>Waiting for uploads to finish…</span>}
      </div>
    </form>
  );
}

// ───────────────────────────── Training records ─────────────────────────────

export const TRAINING_STATE: Record<TrainingState, [string, Tone]> = {
  valid: ["Valid", "ok"],
  expiring: ["Expiring soon", "warn"],
  expired: ["Expired", "fail"],
  no_expiry: ["No expiry", "neutral"],
};

export function TrainingTab({ facilities, orgId = null }: { facilities: { id: string; name: string }[]; orgId?: string | null }) {
  const fn = useServerFn(listTraining);
  const q = useQuery({ queryKey: ["isps-training", orgId], queryFn: () => fn({ data: { org_id: orgId } }) });
  const [editing, setEditing] = useState<TrainingRecord | "new" | null>(null);
  const [filter, setFilter] = useState<"all" | "attention">("all");
  if (q.isLoading) return <span className="row g8 t3"><Loader2 size={14} className="animate-spin" /> Loading…</span>;
  if (q.error || !q.data) return <Notice tone="fail">{(q.error as Error)?.message || "Couldn't load training records."}</Notice>;
  const rows = q.data.records;
  const expired = rows.filter((r) => r.state === "expired").length;
  const expiring = rows.filter((r) => r.state === "expiring").length;
  const people = new Set(rows.map((r) => r.person_name.toLowerCase())).size;
  const shown = filter === "attention" ? rows.filter((r) => r.state === "expired" || r.state === "expiring") : rows;
  return (
    <div className="col g16">
      {(expired > 0 || expiring > 0) && (
        <Notice tone={expired ? "fail" : "warn"}>
          {expired > 0 && `${expired} certificate${expired === 1 ? " has" : "s have"} expired. `}
          {expiring > 0 && `${expiring} expire${expiring === 1 ? "s" : ""} in the next ${TRAINING_WARN_DAYS} days.`}
        </Notice>
      )}
      <div className="row g8 wrap" style={{ alignItems: "center" }}>
        {q.data.can_edit && !editing && <button type="button" className="b b-pri" onClick={() => setEditing("new")}><Plus size={14} /> Add a training record</button>}
        <span className="f1" />
        <span className="t3" style={{ fontSize: 12 }}>{people} {people === 1 ? "person" : "people"} · {rows.length} record{rows.length === 1 ? "" : "s"}</span>
        <select className="in" style={{ width: "auto" }} value={filter} onChange={(e) => setFilter(e.target.value as "all" | "attention")} aria-label="Show">
          <option value="all">All records</option>
          <option value="attention">Expired or expiring</option>
        </select>
      </div>
      {editing && <TrainingForm record={editing === "new" ? null : editing} facilities={facilities} onDone={() => setEditing(null)} />}
      <Panel title="Training and certificates">
        {shown.length === 0 ? <Empty>{rows.length ? "Nothing expired or expiring." : "No training recorded. Add the PFSO's certificate first, then security staff."}</Empty> : (
          <div style={{ overflowX: "auto" }}>
            <table className="w-full" style={{ fontSize: 13, borderCollapse: "collapse" }}>
              <thead><tr className="t3" style={{ fontSize: 11, textAlign: "left" }}><th style={{ padding: "6px 8px" }}>Person</th><th style={{ padding: "6px 8px" }}>Course</th><th style={{ padding: "6px 8px" }}>Completed</th><th style={{ padding: "6px 8px" }}>Expires</th><th style={{ padding: "6px 8px" }}>Certificate</th><th /></tr></thead>
              <tbody>
                {shown.map((r) => {
                  const [label, tone] = TRAINING_STATE[r.state];
                  return (
                    <tr key={r.id} style={{ borderTop: "1px solid var(--line, rgba(127,127,127,.2))", verticalAlign: "top" }}>
                      <td style={{ padding: "8px" }}><b>{r.person_name}</b><div className="t3" style={{ fontSize: 12 }}>{r.person_role}{r.facility ? ` · ${r.facility}` : ""}</div></td>
                      <td style={{ padding: "8px" }}>{r.course}<div className="t3" style={{ fontSize: 12 }}>{[r.provider, r.certificate_no ? `No. ${r.certificate_no}` : null].filter(Boolean).join(" · ")}</div></td>
                      <td style={{ padding: "8px", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{dateOnly(r.completed_on)}</td>
                      <td style={{ padding: "8px", whiteSpace: "nowrap" }}>
                        <Status tone={tone}>{label}</Status>
                        <div className="t3" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{r.expires_on ? `${dateOnly(r.expires_on)}${r.days_left != null ? (r.days_left < 0 ? ` · ${-r.days_left} days ago` : ` · ${r.days_left} days`) : ""}` : ""}</div>
                      </td>
                      <td style={{ padding: "8px" }}>{r.certificate?.url ? <a href={r.certificate.url} target="_blank" rel="noreferrer" title={`SHA-256 ${r.certificate.sha256}`}><Paperclip size={12} /> View</a> : <span className="t3">—</span>}</td>
                      <td style={{ padding: "8px", textAlign: "right" }}>{q.data.can_edit && <button type="button" className="b b-sm b-gh" onClick={() => setEditing(r)} aria-label={`Edit ${r.person_name}'s ${r.course}`}><Pencil size={12} /></button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <p className="t3" style={{ fontSize: 12 }}>The ISPS Code (Part A section 18) requires the Port Facility Security Officer and staff with security duties to have the knowledge and training for their duties. Record each course or certificate with its expiry, if it has one. A record turns amber {TRAINING_WARN_DAYS} days before it expires.</p>
    </div>
  );
}

function TrainingForm({ record, facilities, onDone }: { record: TrainingRecord | null; facilities: { id: string; name: string }[]; onDone: () => void }) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveTraining);
  const archFn = useServerFn(archiveTraining);
  const upFn = useServerFn(trainingUploadUrl);
  const u = useUploads((f) => upFn({ data: { ...f, type: f.type as (typeof EVIDENCE_TYPES)[number] } }), 1);
  const [removeCert, setRemoveCert] = useState(false);
  const [f, setF] = useState({
    facility_id: record?.facility_id ?? "",
    person_name: record?.person_name ?? "",
    person_role: record?.person_role ?? "",
    course: record?.course ?? "",
    provider: record?.provider ?? "",
    certificate_no: record?.certificate_no ?? "",
    completed_on: record?.completed_on ?? "",
    expires_on: record?.expires_on ?? "",
    notes: record?.notes ?? "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const done = () => { qc.invalidateQueries({ queryKey: ["isps-training"] }); onDone(); };
  const m = useMutation({
    mutationFn: () => saveFn({
      data: {
        id: record?.id ?? null,
        facility_id: f.facility_id || null,
        person_name: f.person_name,
        person_role: f.person_role,
        course: f.course,
        provider: f.provider || null,
        certificate_no: f.certificate_no || null,
        completed_on: f.completed_on,
        expires_on: f.expires_on || null,
        notes: f.notes || null,
        ...(u.done[0] ? { certificate: u.done[0] } : removeCert ? { certificate: null } : {}),
      },
    }),
    onSuccess: () => { toast.success("Saved."); done(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const arch = useMutation({
    mutationFn: () => archFn({ data: { id: record!.id } }),
    onSuccess: () => { toast.success("Removed from the list. The audit log keeps it."); done(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const ok = f.person_name.trim().length >= 2 && f.person_role.trim().length >= 2 && f.course.trim().length >= 2 && !!f.completed_on && (!f.expires_on || f.expires_on >= f.completed_on);
  return (
    <Panel title={record ? `Edit ${record.person_name}'s record` : "Add a training record"}>
      <form className="grid g10" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }} onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <label className="fl"><span>Person</span><input className="in" value={f.person_name} onChange={set("person_name")} maxLength={160} required /></label>
        <label className="fl"><span>Role</span><input className="in" list="isps-roles" value={f.person_role} onChange={set("person_role")} maxLength={120} required /><datalist id="isps-roles">{ROLE_SUGGESTIONS.map((r) => <option key={r} value={r} />)}</datalist></label>
        <label className="fl"><span>Facility</span><select className="in" value={f.facility_id} onChange={set("facility_id")}><option value="">All facilities / not tied to one</option>{facilities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label className="fl" style={{ gridColumn: "1 / -1" }}><span>Course or certificate</span><input className="in" value={f.course} onChange={set("course")} maxLength={200} placeholder="e.g. Port Facility Security Officer (IMO Model Course 3.21)" required /></label>
        <label className="fl"><span>Provider</span><input className="in" value={f.provider} onChange={set("provider")} maxLength={200} /></label>
        <label className="fl"><span>Certificate number</span><input className="in" value={f.certificate_no} onChange={set("certificate_no")} maxLength={120} /></label>
        <label className="fl"><span>Completed on</span><input type="date" className="in" value={f.completed_on} max={lagosToday()} onChange={set("completed_on")} required /></label>
        <label className="fl"><span>Expires on (if it does)</span><input type="date" className="in" value={f.expires_on} min={f.completed_on || undefined} onChange={set("expires_on")} /></label>
        <label className="fl" style={{ gridColumn: "1 / -1" }}><span>Notes</span><textarea className="in" rows={2} value={f.notes} onChange={set("notes")} maxLength={2000} /></label>
        <div className="col g6" style={{ gridColumn: "1 / -1" }}>
          <span style={{ fontSize: 12 }} className="t2">Certificate (photo or PDF)</span>
          {record?.certificate && !removeCert && !u.done.length && (
            <span className="row g6" style={{ fontSize: 12, alignItems: "center" }}>
              <Paperclip size={12} /> {record.certificate.url ? <a href={record.certificate.url} target="_blank" rel="noreferrer">{record.certificate.name}</a> : record.certificate.name}
              <button type="button" className="b b-sm b-gh" onClick={() => setRemoveCert(true)}>Remove</button>
            </span>
          )}
          {!u.files.length && (
            <label className="b b-gh" style={{ alignSelf: "flex-start", cursor: "pointer" }}>
              <Plus size={14} /> {record?.certificate && !removeCert ? "Replace" : "Attach"}
              <input type="file" accept={TYPES.join(",")} style={{ display: "none" }} onChange={(e) => { u.attach(e.target.files); e.target.value = ""; }} />
            </label>
          )}
          <UploadList u={u} />
        </div>
        <div className="row g8" style={{ gridColumn: "1 / -1" }}>
          <button type="submit" className="b b-pri" disabled={!ok || m.isPending || u.busy}>{m.isPending && <Loader2 size={14} className="animate-spin" />} Save</button>
          <button type="button" className="b b-gh" onClick={onDone}>Cancel</button>
          <span className="f1" />
          {record && <button type="button" className="b b-gh" disabled={arch.isPending} onClick={() => arch.mutate()}><Trash2 size={14} /> Remove</button>}
        </div>
      </form>
    </Panel>
  );
}
