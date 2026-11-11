import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { FileText, Loader2, Paperclip, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Empty, Panel } from "@/components/nw";
import { addVoyageMedia, addVoyageStatement, listVoyageRecords } from "@/lib/voyage-records.functions";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const nowLocal = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const MAX_BYTES = 200 * 1024 * 1024;

/** Statements and media for a voyage's case file. Added records can't be edited or removed. */
export function VoyageRecords({ voyageId, orgId, canAdd }: { voyageId: string; orgId: string; canAdd: boolean }) {
  const qc = useQueryClient();
  const list = useServerFn(listVoyageRecords);
  const addSt = useServerFn(addVoyageStatement);
  const addMedia = useServerFn(addVoyageMedia);
  const q = useQuery({ queryKey: ["voyage-records", voyageId], queryFn: () => list({ data: { voyage_id: voyageId } }) });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", role: "", contact: "", text: "", at: nowLocal() });
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["voyage-records", voyageId] });

  const st = useMutation({
    mutationFn: () => addSt({ data: { voyage_id: voyageId, given_by_name: f.name, given_by_role: f.role || null, given_by_contact: f.contact || null, statement: f.text, taken_at: new Date(f.at).toISOString() } }),
    onSuccess: () => {
      toast.success("Statement saved and fingerprinted");
      setF({ name: "", role: "", contact: "", text: "", at: nowLocal() });
      setOpen(false);
      refresh();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  async function upload(files: FileList) {
    for (const file of Array.from(files)) {
      if (file.size > MAX_BYTES) {
        toast.error(`${file.name} is over 200 MB`);
        continue;
      }
      setUploading(file.name);
      const ext = (file.name.split(".").pop() || "bin").replace(/[^\w]/g, "").slice(0, 8) || "bin";
      const path = `${orgId}/voyages/${voyageId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("incident-evidence").upload(path, file, { contentType: file.type || "application/octet-stream" });
      if (error) {
        toast.error(`Upload failed: ${error.message}`);
        continue;
      }
      try {
        const taken = file.lastModified ? new Date(file.lastModified).toISOString() : null;
        await addMedia({ data: { voyage_id: voyageId, path, file_name: file.name.slice(0, 200), mime: file.type || "application/octet-stream", caption: caption.trim() || null, taken_at: taken && Date.parse(taken) <= Date.now() ? taken : null } });
        toast.success(`${file.name} added and fingerprinted`);
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
    setUploading(null);
    setCaption("");
    if (fileRef.current) fileRef.current.value = "";
    refresh();
  }

  const rows = q.data ?? [];
  return (
    <Panel
      title="Statements and media"
      icon={<FileText size={15} className="ic" />}
      meta={rows.length || undefined}
      className="no-print"
      actions={
        canAdd ? (
          <>
            <button type="button" className="b b-sm b-sec" onClick={() => setOpen((o) => !o)}><Plus size={13} /> Statement</button>
            <button type="button" className="b b-sm b-sec" disabled={!!uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />} {uploading ? "Uploading…" : "Photo, video or document"}
            </button>
            <input ref={fileRef} type="file" multiple hidden onChange={(e) => e.target.files?.length && upload(e.target.files)} />
          </>
        ) : null
      }
    >
      <div className="col g10">
        <span className="t3" style={{ fontSize: 12 }}>
          Everything here goes into the voyage's next case file. Each item is fingerprinted when it's added and can't be changed or deleted afterwards, so it holds up as evidence.
        </span>
        {canAdd && (
          <label className="fl" style={{ maxWidth: 420 }}>
            <span>Caption for the next file (optional)</span>
            <input className="in" value={caption} maxLength={500} onChange={(e) => setCaption(e.target.value)} placeholder="e.g. Damage to the hull, taken at the jetty" />
          </label>
        )}
        {open && canAdd && (
          <form
            className="col g10"
            style={{ border: "1px solid var(--line-2)", borderRadius: 9, padding: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              st.mutate();
            }}
          >
            <div className="grid g10" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
              <label className="fl"><span>Given by</span><input className="in" required maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Full name" /></label>
              <label className="fl"><span>Role</span><input className="in" maxLength={80} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} placeholder="Captain, passenger, jetty officer" /></label>
              <label className="fl"><span>Contact (optional)</span><input className="in" maxLength={120} value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} placeholder="Phone or address" /></label>
              <label className="fl"><span>Taken at</span><input type="datetime-local" className="in" required value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} /></label>
            </div>
            <label className="fl"><span>Statement, in their own words</span><textarea className="in" rows={6} required minLength={10} maxLength={20000} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></label>
            <span className="t3" style={{ fontSize: 12 }}>Read it back to the person before saving. Once saved it can't be edited; to correct it, add a further statement.</span>
            <div className="row g8">
              <button type="submit" className="b b-sm b-pri" disabled={st.isPending || f.name.trim().length < 1 || f.text.trim().length < 10}>{st.isPending ? <Loader2 size={13} className="animate-spin" /> : null} Save statement</button>
              <button type="button" className="b b-sm b-gh" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </form>
        )}
        {q.isLoading ? (
          <Empty>Loading…</Empty>
        ) : rows.length === 0 ? (
          <Empty>No statements or media yet.</Empty>
        ) : (
          <div className="col g8">
            {rows.map((r) => (
              <div key={r.id} className="col g2" style={{ fontSize: 13, borderTop: "1px solid var(--line-1)", paddingTop: 8 }}>
                {r.kind === "statement" ? (
                  <>
                    <b>Statement · {r.given_by_name}{r.given_by_role ? <span className="t3"> · {r.given_by_role}</span> : null}</b>
                    <span style={{ whiteSpace: "pre-wrap" }}>{r.statement && r.statement.length > 400 ? `${r.statement.slice(0, 400)}…` : r.statement}</span>
                  </>
                ) : (
                  <>
                    <b>{r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline">{r.file_name}</a> : r.file_name}</b>
                    {r.caption && <span>{r.caption}</span>}
                  </>
                )}
                <span className="t3" style={{ fontSize: 11.5 }}>
                  {r.kind === "statement" ? "Taken" : "Taken or added"} {when(r.taken_at)} · recorded by {r.recorded_by_name ?? "—"} · SHA-256 <span className="mono">{r.sha256.slice(0, 16)}…</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
