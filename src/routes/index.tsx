import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { FundingBanner } from "@/components/FundingBanner";
import { FundingPopup } from "@/components/FundingPopup";
import { LemtikMark } from "@/components/nw";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lemtik Security" },
      { name: "description", content: "Incident reporting, patrol check-ins and alerts for estate, hotel and corporate security teams in Lagos." },
      { property: "og:title", content: "Lemtik Security" },
      { property: "og:description", content: "Replace WhatsApp groups and paper logs with one shared picture of what's happening on site." },
    ],
  }),
  component: Landing,
});

const MODULES = [
  { t: "Live map", d: "Incidents, officers and patrol routes on one map, from the positions they actually report." },
  { t: "Incident reporting", d: "Structured reports with photos, video and voice notes, tracked from reported to resolved or escalated." },
  { t: "Patrols", d: "GPS check-ins at each stop, with late and out-of-zone check-ins shown to supervisors." },
  { t: "Alerts and dispatch", d: "In-app alerts and dispatches to officers. SMS, WhatsApp and email go out where those channels are configured." },
  { t: "Escalation records", d: "Log escalations to police, LASEMA or NSCDC on the incident, with the brief you sent and who sent it." },
  { t: "Reports and audit", d: "Printable daily, weekly and monthly reports from live records, and an append-only audit log." },
];

function Landing() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--ink-0)", color: "var(--tx-1)" }}>
      <FundingBanner />
      <FundingPopup />
      <header style={{ borderBottom: "1px solid var(--line-1)" }}>
        <div className="row g12" style={{ maxWidth: 1120, margin: "0 auto", padding: "14px 24px" }}>
          <LemtikMark size={28} />
          <b style={{ letterSpacing: ".04em" }}>LEMTIK</b>
          <span className="flex-auto" />
          <Link to="/login" search={{ redirect: undefined }} className="b b-pri">
            Sign in <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <section style={{ maxWidth: 1120, margin: "0 auto", padding: "88px 24px 64px" }}>
        <span className="tg tg-blue">Onboarding pilot partners in Lagos</span>
        <h1 style={{ fontSize: "clamp(36px, 6vw, 60px)", fontWeight: 700, lineHeight: 1.05, letterSpacing: "-.02em", margin: "20px 0 0", maxWidth: 820, textWrap: "balance" as never }}>
          Your security team, on one screen.
        </h1>
        <p className="t2" style={{ fontSize: 18, lineHeight: 1.55, maxWidth: 640, margin: "20px 0 0" }}>
          Lemtik replaces WhatsApp groups, paper logs and verbal handovers with one shared picture for estate, hotel and corporate security teams: what's happening, who's on it, and what happened next.
        </p>
        <div className="row g10 wrap" style={{ marginTop: 28 }}>
          <Link to="/login" search={{ redirect: undefined }} className="b b-pri b-lg">
            Sign in <ArrowRight className="h-4 w-4" />
          </Link>
          <a href="#modules" className="b b-sec b-lg">
            What it does
          </a>
        </div>
      </section>

      <section id="modules" style={{ borderTop: "1px solid var(--line-1)" }}>
        <div style={{ maxWidth: 1120, margin: "0 auto", padding: "56px 24px 72px" }}>
          <h2 style={{ fontSize: 26, fontWeight: 650, margin: 0 }}>What's in it</h2>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3" style={{ marginTop: 24 }}>
            {MODULES.map((m) => (
              <div key={m.t} className="pn" style={{ padding: 18, gap: 8 }}>
                <b style={{ fontSize: 15.5 }}>{m.t}</b>
                <span className="t2" style={{ fontSize: 14, lineHeight: 1.55 }}>
                  {m.d}
                </span>
              </div>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-2" style={{ marginTop: 24 }}>
            <Link to="/officer" className="card row g12" style={{ padding: 18 }}>
              <span className="col f1">
                <b>Officer app</b>
                <span className="t2" style={{ fontSize: 13.5 }}>For officers on patrol. Install it on your phone.</span>
              </span>
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/consumer/activate" search={{ token: undefined, reason: undefined }} className="card row g12" style={{ padding: 18 }}>
              <span className="col f1">
                <b>Guest emergency help</b>
                <span className="t2" style={{ fontSize: 13.5 }}>For hotel and estate guests with a code from reception.</span>
              </span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <footer style={{ borderTop: "1px solid var(--line-1)" }}>
        <div className="row g12 wrap t3" style={{ maxWidth: 1120, margin: "0 auto", padding: "20px 24px", fontSize: 12.5 }}>
          <span>© {new Date().getFullYear()} Lemtik Security · Lagos, Nigeria</span>
          <span className="flex-auto" />
          <a href="https://lemtik.com.ng" className="lnk">
            lemtik.com.ng
          </a>
        </div>
      </footer>
    </div>
  );
}
