import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FileSearch, History, ScanSearch } from "lucide-react";
import type { ReactNode } from "react";

const nav = [
  { to: "/forensic/cases", label: "Cases", icon: FileSearch },
  { to: "/forensic/queries", label: "My AI queries", icon: History },
];

const MODE_KEY = "lemtik_forensic_mode";
export type ForensicMode = "plain" | "technical";

export function useForensicMode(): [ForensicMode, (mode: ForensicMode) => void] {
  const [mode, setModeState] = useState<ForensicMode>("plain");
  useEffect(() => {
    const stored = window.localStorage.getItem(MODE_KEY);
    if (stored === "plain" || stored === "technical") setModeState(stored);
  }, []);
  const setMode = (next: ForensicMode) => {
    setModeState(next);
    window.localStorage.setItem(MODE_KEY, next);
  };
  return [mode, setMode];
}

export function ForensicShell({ children }: { children?: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mode, setMode] = useForensicMode();
  const caseMatch = pathname.match(/^\/forensic\/cases\/([^/]+)/);
  const activeCaseId = caseMatch && caseMatch[1] !== "new" ? caseMatch[1] : null;

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-[#e2e8f0]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1600px]">
        <aside className="hidden w-64 shrink-0 border-r border-[#2d3748] bg-[#111827] px-4 py-5 lg:block">
          <div className="flex items-center gap-2.5 px-1">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-[#3b82f6]/15 text-[#3b82f6]">
              <ScanSearch className="h-5 w-5" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-[#94a3b8]">Forensic</div>
              <div className="text-sm font-semibold text-white">Case Review</div>
            </div>
          </div>

          <nav className="mt-6 flex flex-col gap-1">
            {nav.map((item) => {
              const active = pathname === item.to || pathname.startsWith(item.to + "/");
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                    active ? "bg-[#3b82f6]/15 text-white" : "text-[#94a3b8] hover:bg-white/5 hover:text-[#e2e8f0]"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-8 rounded-lg border border-[#2d3748] bg-[#1a2234] px-3 py-2.5 text-[11px] leading-relaxed text-[#94a3b8]">
            Read-only. Nothing here can be created, edited, or deleted — this view is for case review only.
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-3 border-b border-[#2d3748] bg-[#111827] px-4 py-3 sm:px-6">
            <div className="flex items-center gap-2 text-xs text-[#94a3b8]">
              {activeCaseId ? (
                <span className="rounded-full border border-[#2d3748] bg-[#1a2234] px-2.5 py-1 font-mono text-[11px] text-[#e2e8f0]">
                  Case: {activeCaseId.slice(0, 8).toUpperCase()}
                </span>
              ) : (
                <span>Security Forensic Analyst</span>
              )}
            </div>
            <div className="flex items-center gap-1 rounded-full border border-[#2d3748] bg-[#1a2234] p-1 text-xs">
              <button
                type="button"
                onClick={() => setMode("plain")}
                className={`rounded-full px-3 py-1 transition-colors ${mode === "plain" ? "bg-[#3b82f6] text-white" : "text-[#94a3b8]"}`}
              >
                Plain
              </button>
              <button
                type="button"
                onClick={() => setMode("technical")}
                className={`rounded-full px-3 py-1 transition-colors ${mode === "technical" ? "bg-[#3b82f6] text-white" : "text-[#94a3b8]"}`}
              >
                Technical
              </button>
            </div>
          </header>
          <main className="flex-1 px-4 py-5 sm:px-6">{children ?? <Outlet />}</main>
        </div>
      </div>
    </div>
  );
}
