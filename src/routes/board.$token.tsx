import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { CheckCircle2, Loader2, Ship } from "lucide-react";
import { LemtikMark, Notice } from "@/components/nw";
import { boardPassenger, getBoardingInfo } from "@/lib/corridor.functions";

/**
 * Passenger boarding page, opened by scanning the QR at the jetty. Each passenger leaves their
 * name and a next-of-kin number, so the operator knows exactly who is aboard if anything goes
 * wrong. It refuses names once the boat is at its licensed capacity.
 */
export const Route = createFileRoute("/board/$token")({
  head: () => ({ meta: [{ title: "Boarding · Lemtik" }, { name: "robots", content: "noindex" }, { name: "theme-color", content: "#0A0C10" }] }),
  component: Boarding,
});

function Boarding() {
  const { token } = Route.useParams();
  const infoFn = useServerFn(getBoardingInfo);
  const boardFn = useServerFn(boardPassenger);
  const q = useQuery({ queryKey: ["board", token], queryFn: () => infoFn({ data: { token } }), retry: false });
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [nok, setNok] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const i = q.data;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await boardFn({ data: { token, name, phone: phone || null, next_of_kin_phone: nok } });
      setDone(r.number);
    } catch (err) {
      setError((err as Error).message || "Couldn't record you. Tell the jetty staff your name.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ minHeight: "100dvh", background: "var(--ink-0, #0A0C10)", color: "var(--tx-1)", padding: "24px 16px 40px" }}>
      <div className="col g16" style={{ maxWidth: 440, margin: "0 auto" }}>
        <div className="row g10" style={{ alignItems: "center" }}>
          <LemtikMark size={26} />
          <b style={{ fontSize: 15 }}>Boarding</b>
        </div>
        {q.isLoading ? (
          <span className="row g8 t3"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</span>
        ) : q.error || !i ? (
          <Notice tone="fail">Couldn't load this page. Ask the jetty staff.</Notice>
        ) : !i.found ? (
          <Notice tone="fail">This boarding code isn't valid. Ask the jetty staff.</Notice>
        ) : done != null ? (
          <section className="pn">
            <div className="pn-b col g8" style={{ alignItems: "center", textAlign: "center", padding: 24 }}>
              <CheckCircle2 size={36} style={{ color: "var(--ok, #2BD576)" }} />
              <b style={{ fontSize: 17 }}>You're on the passenger list</b>
              <span className="t2">Passenger {done} on {i.boat}. Wear your life jacket for the whole trip.</span>
            </div>
          </section>
        ) : (
          <>
            <section className="pn">
              <div className="pn-b col g4" style={{ fontSize: 13.5 }}>
                <span className="row g8"><Ship size={16} /> <b>{i.boat}</b></span>
                <span>{i.voyage}</span>
                <span className="t3">{i.operator}{i.planned_departure ? ` · departs ${new Date(i.planned_departure).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}</span>
              </div>
            </section>
            {!i.open ? (
              <Notice tone="warn">Boarding for this trip has closed. Speak to the jetty staff.</Notice>
            ) : i.full ? (
              <Notice tone="fail">This boat is full. Please don't board; speak to the jetty staff about the next one.</Notice>
            ) : (
              <form className="col g12" onSubmit={submit}>
                <span className="t2" style={{ fontSize: 13.5 }}>Add your name before you board. If anything happens on the water, the operator knows who was aboard and who to call.</span>
                <label className="fl"><span>Your full name</span><input className="in" required minLength={2} maxLength={120} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></label>
                <label className="fl"><span>Your phone (optional)</span><input className="in" type="tel" maxLength={40} autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
                <label className="fl"><span>Next of kin phone</span><input className="in" type="tel" required minLength={7} maxLength={40} value={nok} onChange={(e) => setNok(e.target.value)} placeholder="Someone to call in an emergency" /></label>
                {error && <Notice tone="fail">{error}</Notice>}
                <button type="submit" className="b b-pri" style={{ height: 44 }} disabled={busy || name.trim().length < 2 || nok.trim().length < 7}>
                  {busy ? <Loader2 size={15} className="animate-spin" /> : null} Add me to the passenger list
                </button>
                <span className="t3" style={{ fontSize: 12 }}>Your details are seen only by the boat operator's safety team and used only for this trip's safety.</span>
              </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}
