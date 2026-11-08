import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";
import { Download, Home, Lock, Sparkles } from "lucide-react";
import { usePwaInstall } from "@/hooks/use-pwa-install";

export const Route = createFileRoute("/officer/")({
  component: OfficerInstallIntro,
});

function OfficerInstallIntro() {
  const { canInstall, isInstalled, promptInstall } = usePwaInstall();
  const [installStatus, setInstallStatus] = useState<string | null>(null);

  const handleInstall = async () => {
    const outcome = await promptInstall();
    if (outcome === "accepted") {
      setInstallStatus("Installed. Open the app from your home screen for offline patrol access.");
      return;
    }
    if (outcome === "dismissed") {
      setInstallStatus("Install prompt dismissed. You can still open the browser menu and add it later.");
    }
  };

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-3xl border border-cyan-300/20 bg-gradient-to-br from-cyan-300/20 via-white/5 to-transparent p-5 shadow-[0_24px_80px_rgba(8,17,31,0.45)]">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/50 to-transparent" />
        <div className="text-[11px] uppercase tracking-[0.24em] text-cyan-200/80">Install first</div>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">Install Lemtik Officer App</h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-300">
          Add the app to your home screen for offline patrol access, faster dispatches, and a cleaner mobile workflow.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            onClick={handleInstall}
            disabled={!canInstall}
            className="inline-flex items-center gap-2 rounded-2xl bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {canInstall ? "Install now" : isInstalled ? "Already installed" : "Install prompt unavailable"}
          </button>
          <Link
            to="/login"
            search={{ redirect: undefined }}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-white"
          >
            <Home className="h-4 w-4" />
            Continue in browser
          </Link>
        </div>
        {installStatus && (
          <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-slate-200">
            {installStatus}
          </div>
        )}
        {!canInstall && !isInstalled && (
          <div className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
            If your browser does not show an install prompt, open the browser menu and choose Add to Home Screen.
          </div>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Card
          icon={<Sparkles className="h-4 w-4" />}
          title="Offline-ready"
          body="Patrol check-ins, incident reports, and shift viewing stay usable when the connection is unstable."
        />
        <Card
          icon={<Lock className="h-4 w-4" />}
          title="Permissions"
          body="Location, notifications, camera, and microphone requests are explained before they are needed."
        />
        <Card
          icon={<Download className="h-4 w-4" />}
          title="2G / 3G aware"
          body="Critical actions are kept light so the app remains responsive on common Nigerian network conditions."
        />
      </section>
    </div>
  );
}

function Card({ title, body, icon }: { title: string; body: string; icon: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-cyan-200">{icon}</span>
        {title}
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-300">{body}</p>
    </div>
  );
}
