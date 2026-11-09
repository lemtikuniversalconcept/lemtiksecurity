import { Outlet } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { drainMediaQueue } from "@/lib/consumer-media-queue";

/** The guest app: light, large, calm. White-labelled per property through the session. */
export function ConsumerShell({ children }: { children?: ReactNode }) {
  // Start online so server and browser render the same HTML; the effect reads the real state.
  const [online, setOnline] = useState(true);

  useEffect(() => {
    // Scoped to /consumer only: this app also serves /app and /officer, which must never be
    // intercepted by this PWA's service worker.
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/consumer" }).catch(() => {});
    // Drain on mount too: a guest who reopens the app after signal is already back never fires 'online'.
    if (typeof navigator === "undefined" || navigator.onLine) void drainMediaQueue();
    const on = () => {
      setOnline(true);
      void drainMediaQueue();
    };
    const off = () => setOnline(false);
    setOnline(navigator.onLine !== false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  return (
    <div className="gst" style={{ background: "var(--g-bg)", color: "var(--g-ink)", minHeight: "100dvh" }}>
      <div className="col" style={{ maxWidth: 480, margin: "0 auto", minHeight: "100dvh", background: "var(--g-bg)" }}>
        {!online && (
          <div role="status" style={{ background: "#FDE8EA", color: "#9B1C2C", padding: "8px 16px", fontSize: 13.5, fontWeight: 600, textAlign: "center" }}>
            No signal. Anything you send waits and goes when signal returns.
          </div>
        )}
        <main className="col f1">{children ?? <Outlet />}</main>
      </div>
    </div>
  );
}
