import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldHalf, Radar, Map, Bell, BarChart3, ArrowRight, Activity } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lemtik Security — Lagos Urban Intelligence Platform" },
      { name: "description", content: "Centralised incident reporting, patrol tracking, and threat intelligence for Lagos estates, hotels, and enterprises." },
      { property: "og:title", content: "Lemtik Security — Lagos Urban Intelligence Platform" },
      { property: "og:description", content: "Replace WhatsApp groups and spreadsheets with a single command and control surface." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-md bg-primary/15 border border-primary/40">
              <ShieldHalf className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight">LEMTIK SECURITY</div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Lagos Operations</div>
            </div>
          </div>
          <Link
            to="/app"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Open dashboard <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 grid-bg opacity-50" />
        <div className="absolute inset-0" style={{ background: "var(--gradient-radar)" }} />
        <div className="relative mx-auto max-w-6xl px-6 py-24 lg:py-32">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] uppercase tracking-wider text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary pulse-dot" />
            Now piloting in Lekki Phase 1
          </div>
          <h1 className="mt-6 max-w-3xl text-4xl lg:text-6xl font-semibold tracking-tight leading-[1.05]">
            Lagos urban security,<br />running on one screen.
          </h1>
          <p className="mt-6 max-w-2xl text-base lg:text-lg text-muted-foreground leading-relaxed">
            Lemtik replaces WhatsApp groups, paper logs, and verbal handovers with a single command and control surface for estate, corporate, and hospitality security teams.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/app" className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              See it live <ArrowRight className="h-4 w-4" />
            </Link>
            <a href="#modules" className="inline-flex items-center rounded-md border border-border bg-surface px-4 py-2.5 text-sm hover:bg-surface-2">
              How it works
            </a>
          </div>

          <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-px bg-border rounded-lg overflow-hidden border border-border max-w-3xl">
            {[
              { v: "4m 12s", l: "Avg response" },
              { v: "94%", l: "Patrol compliance" },
              { v: "0", l: "Ghost guards" },
              { v: "24/7", l: "Live ops" },
            ].map((s) => (
              <div key={s.l} className="bg-card p-4">
                <div className="text-2xl font-semibold tracking-tight">{s.v}</div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground mt-1">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="modules" className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">The Platform</div>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">Six modules, one operating picture.</h2>
          <div className="mt-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { i: Map, t: "Live Incident Map", d: "Spatial awareness across every zone. Pins colour-coded by severity, real-time updates, heatmap overlays." },
              { i: Activity, t: "Incident Reporting", d: "Structured forms, evidence attachments, full lifecycle from reported through resolved or escalated." },
              { i: Radar, t: "Patrol Management", d: "QR & GPS check-ins kill ghost guarding. Missed waypoints auto-alert supervisors in 10 minutes." },
              { i: Bell, t: "Tiered Alerts", d: "In-app, SMS, WhatsApp, email. Severity 5 auto-drafts the message to LASEMA and police." },
              { i: BarChart3, t: "Intelligence Reports", d: "Daily, weekly, monthly briefs — branded and board-ready. Zone risk scoring built in." },
              { i: ShieldHalf, t: "Role-based Access", d: "Field officer, supervisor, manager, client admin. Multi-location, multi-client, fully audited." },
            ].map((m) => (
              <div key={m.t} className="rounded-lg border border-border bg-card p-5">
                <div className="grid h-9 w-9 place-items-center rounded-md bg-primary/10 border border-primary/30 text-primary">
                  <m.i className="h-4 w-4" />
                </div>
                <div className="mt-4 text-base font-semibold">{m.t}</div>
                <div className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{m.d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-8 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <div>© {new Date().getFullYear()} Lemtik Security · Lagos, Nigeria</div>
          <div className="font-mono">SOD v1.0 · Build-ready spec</div>
        </div>
      </footer>
    </div>
  );
}
