import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ArrowLeft, Download, Loader2, Printer, ShieldCheck } from "lucide-react";
import { requireSectionAccess } from "@/lib/rbac";
import { Empty, Notice, Panel, Status, type Tone } from "@/components/nw";
import { getCaseFile, type CaseEvidence } from "@/lib/casefile.functions";

export const Route = createFileRoute("/app/case-files/$id")({
  head: () => ({ meta: [{ title: "Case file · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    requireSectionAccess(context.appAccess, ["security_manager", "operator", "client_admin", "security_forensic_analyst"]);
  },
  component: CaseFilePage,
});

const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
const isIso = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v);
const size = (n: number | null) => (n == null ? "—" : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

const INTEGRITY: Record<CaseEvidence["integrity"], { tone: Tone; label: string; help: string }> = {
  matches_receipt: { tone: "ok", label: "Unchanged since upload", help: "Fingerprint matches the one taken when the file was uploaded." },
  changed_since_receipt: { tone: "fail", label: "Changed since upload", help: "Fingerprint differs from the one taken at upload. Treat this file as altered." },
  no_receipt_fingerprint: { tone: "warn", label: "No upload fingerprint", help: "Uploaded before fingerprinting began; integrity is proven from this case file onwards." },
  unreadable: { tone: "fail", label: "File missing", help: "The stored file could not be read when this case file was made." },
};

async function sha256(bytes: ArrayBuffer | Uint8Array) {
  const d = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function CaseFilePage() {
  const { id } = Route.useParams();
  const fn = useServerFn(getCaseFile);
  const q = useQuery({ queryKey: ["case-file", id], queryFn: () => fn({ data: { id } }), staleTime: 50 * 60_000 });
  const [qr, setQr] = useState<string | null>(null);
  const [zip, setZip] = useState<{ busy: boolean; note: string | null; tone: "ok" | "warn" | "fail" | "blue" }>({ busy: false, note: null, tone: "blue" });
  const verifyUrl = `${typeof window === "undefined" ? "https://app.lemtik.com.ng" : window.location.origin}/verify/${id}`;

  useEffect(() => {
    let live = true;
    import("qrcode").then((Q) => Q.default.toDataURL(verifyUrl, { width: 200, margin: 1 })).then((u) => live && setQr(u)).catch(() => null);
    return () => {
      live = false;
    };
  }, [verifyUrl]);

  if (q.isLoading) return <span className="row g8 t3"><Loader2 className="h-4 w-4 animate-spin" /> Loading the case file…</span>;
  if (q.error || !q.data) return <Notice tone="fail">{(q.error as Error)?.message || "Couldn't load this case file."}</Notice>;
  const { row, manifest: m, extra_files, links } = q.data;
  const back = m.kind === "incident" ? { to: "/app/incidents/$id" as const, label: "Incident" } : { to: "/app/movement/voyages/$id" as const, label: "Voyage report" };
  const problems = m.evidence.filter((e) => e.integrity === "changed_since_receipt" || e.integrity === "unreadable").length;

  async function downloadBundle() {
    setZip({ busy: true, note: "Collecting files…", tone: "blue" });
    try {
      const { zipSync, strToU8 } = await import("fflate");
      const enc = (s: string) => strToU8(s);
      const files: Record<string, Uint8Array> = { "manifest.json": enc(row.manifest_text) };
      for (const f of extra_files) files[f.file] = enc(f.content);
      const failed: string[] = [];
      for (const [i, e] of m.evidence.entries()) {
        setZip({ busy: true, note: `Downloading evidence ${i + 1} of ${m.evidence.length}…`, tone: "blue" });
        const url = links[e.file];
        if (!url) { failed.push(`${e.file}: not available`); continue; }
        const res = await fetch(url);
        if (!res.ok) { failed.push(`${e.file}: download failed`); continue; }
        const bytes = new Uint8Array(await res.arrayBuffer());
        const h = await sha256(bytes);
        if (e.sha256 && h !== e.sha256) failed.push(`${e.file}: the stored file no longer matches its fingerprint`);
        files[e.file] = bytes;
      }
      files["README.txt"] = enc(readme(row.id, row.manifest_sha256, verifyUrl, failed));
      const blob = new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: "application/zip" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `case-file-${row.reference.replace(/[^\w-]+/g, "_")}-${row.id.slice(0, 8)}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
      setZip({ busy: false, note: failed.length ? `Downloaded, with problems: ${failed.join("; ")}` : "Bundle downloaded. Every file was checked against its fingerprint.", tone: failed.length ? "warn" : "ok" });
    } catch (err) {
      setZip({ busy: false, note: (err as Error).message || "Couldn't build the bundle.", tone: "fail" });
    }
  }

  return (
    <div className="col g16 case-file">
      <style>{`@media print {
        aside, nav, header, .no-print { display: none !important; }
        body, .case-file { background: #fff !important; color: #000 !important; }
        .case-file * { color: #000 !important; border-color: #bbb !important; background: transparent !important; }
        .case-file .cf-page-break { break-before: page; }
        .case-file section, .case-file .pn { break-inside: avoid-page; }
        .case-file .tg { border: 1px solid #888 !important; }
      }`}</style>
      <div className="row g8 wrap no-print">
        <Link to={back.to} params={{ id: row.record_id }} className="b b-sm b-gh"><ArrowLeft size={14} /> {back.label}</Link>
        <span className="f1" />
        <button type="button" className="b b-sm b-sec" onClick={downloadBundle} disabled={zip.busy}>
          {zip.busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Evidence bundle (.zip)
        </button>
        <button type="button" className="b b-sm b-pri" onClick={() => window.print()}><Printer size={14} /> Print or save as PDF</button>
      </div>
      {zip.note && <div className="no-print"><Notice tone={zip.tone}>{zip.note}</Notice></div>}

      <header className="col g6" style={{ borderBottom: "1px solid var(--line-2)", paddingBottom: 14 }}>
        <span className="o-lbl">CASE FILE · {m.kind === "incident" ? "INCIDENT" : "VOYAGE"}</span>
        <h1 className="ph1" style={{ fontSize: 24, textWrap: "balance" }}>{m.title}</h1>
        <span className="t2" style={{ fontSize: 13 }}>
          {m.organisation} · Reference <b className="mono">{m.reference}</b> · Generated {when(m.generated_at)} by {m.generated_by}
        </span>
      </header>

      <Panel title="Integrity" icon={<ShieldCheck size={15} />}>
        <div className="row g16 wrap" style={{ alignItems: "flex-start" }}>
          <div className="col g8 f1" style={{ minWidth: 260, fontSize: 13 }}>
            <span>This case file is a frozen copy of the record at the time shown above. Each file carries a SHA-256 fingerprint: change one byte and the fingerprint changes completely.</span>
            <KV k="Case file ID" v={<span className="mono">{row.id}</span>} />
            <KV k="Manifest fingerprint (SHA-256)" v={<span className="mono" style={{ wordBreak: "break-all" }}>{row.manifest_sha256}</span>} />
            <KV k="Files covered" v={String(row.file_count)} />
            <span className="t3" style={{ fontSize: 12 }}>
              To check it, open <span className="mono">{verifyUrl}</span> or scan the code, then drop the bundle's files on the page. Or run <span className="mono">shasum -a 256 manifest.json</span> and compare.
            </span>
            {problems > 0 && <Notice tone="fail">{problems} evidence file{problems > 1 ? "s" : ""} failed the integrity check. See below.</Notice>}
          </div>
          {qr && <img src={qr} alt="QR code linking to the verify page for this case file" width={128} height={128} style={{ background: "#fff", borderRadius: 6, padding: 4 }} />}
        </div>
      </Panel>

      <Panel title={m.kind === "incident" ? "The incident" : "The voyage"}>
        <div className="col g6" style={{ fontSize: 13 }}>
          {Object.entries(m.record).filter(([, v]) => v !== null && v !== "").map(([k, v]) => (
            <KV key={k} k={k} v={isIso(v) ? when(v as string) : String(v)} />
          ))}
        </div>
      </Panel>

      <Panel title="Evidence" meta={m.evidence.length}>
        {m.evidence.length === 0 ? (
          <Empty>{m.kind === "voyage" ? "The voyage's evidence is its position log, listed under Data files." : "No evidence files were attached."}</Empty>
        ) : (
          <div className="col g12">
            {m.evidence.map((e, i) => {
              const st = INTEGRITY[e.integrity];
              return (
                <section key={e.file} className="col g6" style={{ borderTop: i ? "1px solid var(--line-1)" : undefined, paddingTop: i ? 12 : 0, fontSize: 13 }}>
                  <div className="row g8 wrap" style={{ alignItems: "center" }}>
                    <b>{i + 1}. {e.name}</b>
                    <span className="t3">{e.kind} · {size(e.size)}</span>
                    {e.legal_hold && <span className="tg">Legal hold</span>}
                    <span className="f1" />
                    <Status tone={st.tone}>{st.label}</Status>
                  </div>
                  <span className="t3" style={{ fontSize: 12 }}>{st.help}</span>
                  <KV k="File in bundle" v={<span className="mono">{e.file}</span>} />
                  <KV k="SHA-256 now" v={<span className="mono" style={{ wordBreak: "break-all", fontSize: 12 }}>{e.sha256 ?? "—"}</span>} />
                  {e.sha256_on_receipt && e.sha256_on_receipt !== e.sha256 && <KV k="SHA-256 at upload" v={<span className="mono" style={{ wordBreak: "break-all", fontSize: 12 }}>{e.sha256_on_receipt}</span>} />}
                  <KV k="Added" v={`${when(e.added_at)}${e.added_by ? ` by ${e.added_by}` : ""}`} />
                  {e.custody.length > 0 && (
                    <div className="col g2">
                      <span className="t3" style={{ fontSize: 12 }}>Chain of custody</span>
                      {e.custody.map((c, j) => (
                        <span key={j} style={{ fontSize: 12.5 }}>
                          <span className="mono t3">{when(c.at)}</span> · {c.action.replace(/[-_]/g, " ")}{c.by ? ` · ${c.by}` : ""}{c.note ? ` · ${c.note}` : ""}
                        </span>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </Panel>

      {m.data_files.length > 0 && (
        <Panel title="Data files" meta={m.data_files.length}>
          <div className="col g8" style={{ fontSize: 13 }}>
            {m.data_files.map((f) => (
              <div key={f.file} className="col g4">
                <b className="mono" style={{ fontSize: 12.5 }}>{f.file}</b>
                <span className="t3">{f.description} · {f.rows} rows</span>
                <KV k="SHA-256" v={<span className="mono" style={{ wordBreak: "break-all", fontSize: 12 }}>{f.sha256}</span>} />
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel title="Timeline" meta={m.timeline.length}>
        {m.timeline.length ? (
          <div className="col g4">
            {m.timeline.map((t, i) => (
              <div key={i} className="row g10" style={{ fontSize: 12.5, alignItems: "baseline" }}>
                <span className="mono t3" style={{ width: 150, flex: "none" }}>{when(t.at)}</span>
                <span className="t2" style={{ width: 120, flex: "none" }}>{t.kind.replace(/_/g, " ")}</span>
                <span className="f1">{t.text}{t.by ? <span className="t3"> · {t.by}</span> : null}</span>
              </div>
            ))}
          </div>
        ) : (
          <Empty>Nothing was logged.</Empty>
        )}
      </Panel>

      <Panel title="Certificate of the person responsible" className="cf-page-break">
        <div className="col g10" style={{ fontSize: 13 }}>
          <span className="t2">
            Courts in Nigeria generally expect a certificate under section 84 of the Evidence Act 2011 before admitting a computer-produced document. Lemtik cannot sign it for you: the person responsible for operating this system in your organisation completes it by hand. Take legal advice on the wording your case needs.
          </span>
          <span>
            I certify that this document was produced by the Lemtik security system used regularly by {m.organisation || "the organisation"} to record security incidents and movements; that the system was operating properly throughout the period covered; and that the information in it reproduces information supplied to the system in the ordinary course of those activities.
          </span>
          <div className="grid g16" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", marginTop: 8 }}>
            {["Full name", "Position", "Signature", "Date"].map((l) => (
              <div key={l} className="col g4">
                <span style={{ borderBottom: "1px solid var(--line-2)", height: 28 }} />
                <span className="t3" style={{ fontSize: 12 }}>{l}</span>
              </div>
            ))}
          </div>
        </div>
      </Panel>
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="row g10" style={{ alignItems: "baseline" }}>
      <span className="t3" style={{ width: 170, flex: "none" }}>{k}</span>
      <span className="f1" style={{ minWidth: 0 }}>{v}</span>
    </div>
  );
}

function readme(id: string, manifestSha: string, verifyUrl: string, problems: string[]) {
  return [
    "LEMTIK CASE FILE BUNDLE",
    "",
    `Case file ID: ${id}`,
    `Manifest SHA-256: ${manifestSha}`,
    "",
    "What is in here",
    "  manifest.json   The frozen case record: details, timeline, every file's SHA-256 fingerprint and chain of custody.",
    "  evidence/       The evidence files, exactly as stored.",
    "  data/           Raw data such as a voyage's position log.",
    "",
    "How to check nothing has changed",
    `  1. Open ${verifyUrl} and drop these files on the page. Each one is checked in your browser; nothing is uploaded.`,
    "  2. Or, on any computer:",
    "       macOS / Linux:  shasum -a 256 manifest.json evidence/* data/*",
    "       Windows:        certutil -hashfile manifest.json SHA256",
    "     The manifest's fingerprint must equal the one above, and each file's must equal the one listed in manifest.json.",
    "",
    problems.length ? `Problems found while building this bundle:\n${problems.map((p) => `  - ${p}`).join("\n")}` : "Every file was checked against its fingerprint while this bundle was built.",
    "",
  ].join("\n");
}
