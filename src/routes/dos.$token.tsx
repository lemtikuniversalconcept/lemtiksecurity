import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { LemtikMark, Notice } from "@/components/nw";
import { getDeclarationForShip, signDeclarationAsShip } from "@/lib/isps.functions";
import { DosDocument } from "@/components/isps/DosDocument";

/** Public page for the ship's master or security officer to read and sign a Declaration of Security. */
export const Route = createFileRoute("/dos/$token")({
  head: () => ({ meta: [{ title: "Declaration of Security · Lemtik" }, { name: "robots", content: "noindex" }] }),
  component: ShipSign,
});

const TITLES = ["Master", "Ship Security Officer", "Chief Officer (for the Master)"] as const;

function ShipSign() {
  const { token } = Route.useParams();
  const infoFn = useServerFn(getDeclarationForShip);
  const signFn = useServerFn(signDeclarationAsShip);
  const q = useQuery({ queryKey: ["dos-ship", token], queryFn: () => infoFn({ data: { token } }), retry: false });
  const [name, setName] = useState("");
  const [title, setTitle] = useState<(typeof TITLES)[number]>("Master");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sign(e: React.FormEvent) {
    e.preventDefault();
    if (!q.data?.found) return;
    setBusy(true);
    setError(null);
    try {
      await signFn({ data: { token, name, title, content_sha256: q.data.declaration.content_sha256 } });
      await q.refetch();
    } catch (err) {
      setError((err as Error).message || "Couldn't record the signature.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg, #0A0C10)", padding: "24px 16px" }}>
      <div className="col g16" style={{ maxWidth: 760, margin: "0 auto" }}>
        <div className="row g8" style={{ alignItems: "center" }}><LemtikMark /><span className="t3" style={{ fontSize: 12 }}>Lemtik SOD</span></div>
        {q.isLoading ? <span className="row g8 t3"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</span>
          : !q.data?.found ? <Notice tone="fail">This link isn't valid. Ask the port facility security officer for a new one.</Notice>
          : (
            <>
              <DosDocument d={q.data.declaration} />
              {q.data.declaration.status === "signed" ? (
                <Notice tone="ok"><CheckCircle2 size={14} style={{ verticalAlign: "-2px" }} /> Signed for the ship. You can print this page (or save it as PDF) for the ship's records.</Notice>
              ) : Date.parse(q.data.declaration.valid_to) <= Date.now() ? (
                <Notice tone="fail">The period of this declaration has ended. Ask the port facility for a new one.</Notice>
              ) : (
                <form className="pn col g10" style={{ padding: 16 }} onSubmit={sign}>
                  <b>Sign for the ship</b>
                  <label className="fl"><span>Your full name</span><input className="in" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name" required /></label>
                  <label className="fl"><span>Signing as</span><select className="in" value={title} onChange={(e) => setTitle(e.target.value as any)}>{TITLES.map((t) => <option key={t}>{t}</option>)}</select></label>
                  <label className="row g8" style={{ fontSize: 13, alignItems: "flex-start" }}><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 3 }} /> I have read this declaration and agree, on behalf of {q.data.declaration.ship_name}, to the security measures and responsibilities set out above.</label>
                  {error && <Notice tone="fail">{error}</Notice>}
                  <button type="submit" className="b b-pri" disabled={busy || !agree || name.trim().length < 2}>{busy && <Loader2 size={14} className="animate-spin" />} Sign declaration</button>
                  <span className="t3" style={{ fontSize: 12 }}>Your name, role and the time are recorded with the declaration. Nothing else about you is collected.</span>
                </form>
              )}
            </>
          )}
      </div>
    </main>
  );
}
