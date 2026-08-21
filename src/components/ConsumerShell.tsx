import { Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { getConsumerSessionMeta } from "@/lib/consumer-session";
import { drainMediaQueue } from "@/lib/consumer-media-queue";
import type { ReactNode } from "react";

export function ConsumerShell({ children }: { children?: ReactNode }) {
  const [orgName, setOrgName] = useState<string | null>(null);
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);

  useEffect(() => {
    setOrgName(getConsumerSessionMeta()?.organisationName ?? null);
    // Scoped to /consumer only — this app also serves /app and /officer, which
    // must never be intercepted by this PWA's service worker.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/consumer" }).catch(() => {});
    }
    const goOnline = () => {
      setOnline(true);
      void drainMediaQueue();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#0a0f1e] text-[#f9fafb]" style={{ fontSize: "18px" }}>
      <header className="flex items-center justify-between gap-2 border-b border-white/10 bg-black/20 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="h-4 w-4 text-red-500" />
          <span>{orgName || "Lemtik Security"}</span>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-300">
            Secured premises
          </span>
        </div>
        <span
          className={`h-2.5 w-2.5 rounded-full ${online ? "bg-emerald-500" : "bg-red-500"}`}
          aria-label={online ? "Online" : "Offline"}
        />
      </header>
      <main className="flex flex-1 flex-col">{children ?? <Outlet />}</main>
    </div>
  );
}
