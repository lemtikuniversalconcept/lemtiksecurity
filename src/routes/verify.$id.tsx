import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { CheckCircle2, FileQuestion, Loader2, ShieldCheck, Upload, XCircle } from "lucide-react";
import { LemtikMark, Notice } from "@/components/nw";
import { verifyCaseFile } from "@/lib/casefile.functions";

/**
 * Public check for a Lemtik case file. Anyone with the case file ID (printed on the case file
 * and in its QR code) can confirm it's genuine. Files dropped here are fingerprinted in the
 * browser; nothing is uploaded.
 */
export const Route = createFileRoute("/verify/$id")({
  head: () => ({ meta: [{ title: "Verify a case file · Lemtik" }, { name: "robots", content: "noindex" }] }),
  component: VerifyPage,
});

type Checked = { name: string; sha256: string; match: string | null };

async function sha256(file: File) {
  const d = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function VerifyPage() {
  const { id } = Route.useParams();
  const fn = useServerFn(verifyCaseFile);
  const valid = /^[0-9a-f-]{36}$/i.test(id);
  const q = useQuery({ queryKey: ["verify", id], queryFn: () => fn({ data: { id } }), enabled: valid, retry: false });
  const [checked, setChecked] = useState<Checked[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const r = q.data;

  async function check(list: FileList | null) {
    if (!list?.length || !r?.found) return;
    setBusy(true);
    const out: Checked[] = [];
    for (const f of Array.from(list)) {
      const h = await sha256(f);
      const match = h === r.manifest_sha256 ? "Case manifest" : (r.files.find((x) => x.sha256 === h)?.label ?? null);
      out.push({ name: f.name, sha256: h, match });
    }
    setChecked((prev) => [...out, ...prev]);
    setBusy(false);
  }

  return (
    <main style={{ minHeight: "100dvh", background: "var(--ink-0, #0A0C10)", color: "var(--tx-1)", padding: "28px 16px 48px" }}>
      <div className="col g16" style={{ maxWidth: 680, margin: "0 auto" }}>
        <div className="row g10" style={{ alignItems: "center" }}>
          <LemtikMark size={28} />
          <b style={{ fontSize: 15, letterSpacing: ".02em" }}>Lemtik case file check</b>
        </div>

        {!valid ? (
          <Notice tone="fail">This isn't a valid case file ID. Check the ID printed on the case file.</Notice>
        ) : q.isLoading ? (
          <span className="row g8 t3"><Loader2 className="h-4 w-4 animate-spin" /> Looking up the case file…</span>
        ) : q.error ? (
          <Notice tone="fail">Couldn't reach Lemtik. Try again in a moment.</Notice>
        ) : !r?.found ? (
          <Notice tone="fail">
            <XCircle size={14} /> No case file with this ID was issued by Lemtik. The document may not be genuine.
          </Notice>
        ) : (
          <>
            <section className="pn">
              <div className="pn-b col g8" style={{ fontSize: 13.5 }}>
                <span className="row g8" style={{ color: "var(--ok, #2BD576)", fontWeight: 600 }}><ShieldCheck size={16} /> Genuine Lemtik case file</span>
                <Row k="Issued to" v={r.organisation || "—"} />
                <Row k="Type" v={r.kind === "incident" ? "Incident" : "Voyage"} />
                <Row k="Reference" v={r.reference} />
                <Row k="Generated" v={new Date(r.generated_at).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "medium" })} />
                <Row k="Manifest SHA-256" v={<span className="mono" style={{ wordBreak: "break-all", fontSize: 12 }}>{r.manifest_sha256}</span>} />
                <Row k="Files covered" v={String(r.files.length)} />
              </div>
            </section>

            <label
              className="col g8"
              style={{ alignItems: "center", textAlign: "center", padding: "28px 16px", borderRadius: 12, border: `1.5px dashed ${over ? "var(--blue, #4F8BFF)" : "var(--line-2, #333)"}`, cursor: "pointer" }}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); check(e.dataTransfer.files); }}
            >
              {busy ? <Loader2 size={22} className="animate-spin" /> : <Upload size={22} />}
              <b>Drop files from the bundle here, or choose them</b>
              <span className="t3" style={{ fontSize: 12.5 }}>manifest.json, evidence files or the position log. Each is checked on this device; nothing is uploaded.</span>
              <input type="file" multiple className="sr-only" onChange={(e) => { check(e.target.files); e.target.value = ""; }} />
            </label>

            {checked.length > 0 && (
              <section className="col g6">
                {checked.map((c, i) => (
                  <div key={`${c.sha256}-${i}`} className="card row g10" style={{ padding: "10px 12px", alignItems: "flex-start" }}>
                    {c.match ? <CheckCircle2 size={18} style={{ color: "var(--ok, #2BD576)", flex: "none" }} /> : <FileQuestion size={18} style={{ color: "var(--s5, #F2384B)", flex: "none" }} />}
                    <span className="col f1" style={{ minWidth: 0, fontSize: 13 }}>
                      <b className="trunc">{c.name}</b>
                      <span>{c.match ? `Matches: ${c.match}. Unchanged since the case file was made.` : "Not part of this case file, or changed since it was made."}</span>
                      <span className="mono t3" style={{ fontSize: 11, wordBreak: "break-all" }}>{c.sha256}</span>
                    </span>
                  </div>
                ))}
              </section>
            )}
            <span className="t3" style={{ fontSize: 12 }}>
              A match proves the file is byte-for-byte identical to the one fingerprinted when the case file was generated. It does not by itself prove what the file shows; that's for the people relying on it to weigh.
            </span>
          </>
        )}
      </div>
    </main>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="row g10" style={{ alignItems: "baseline" }}>
      <span className="t3" style={{ width: 140, flex: "none" }}>{k}</span>
      <span className="f1" style={{ minWidth: 0 }}>{v}</span>
    </div>
  );
}
