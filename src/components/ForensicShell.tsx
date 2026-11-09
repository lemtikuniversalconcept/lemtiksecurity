import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FileSearch, History } from "lucide-react";
import { LemtikMark, Seg } from "@/components/nw";
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
    <div style={{ minHeight: "100vh", background: "var(--ink-0)", color: "var(--tx-1)" }}>
      {/* Case pages render their own printable case file; the dark shell is suppressed on paper. */}
      <style>{`
        @media print {
          .forensic-no-print { display: none !important; }
          body { background: #fff !important; }
        }
      `}</style>
      <div className="mx-auto flex min-h-screen w-full max-w-[1600px]">
        <aside className="forensic-no-print hidden w-60 shrink-0 lg:flex" style={{ flexDirection: "column", gap: 18, padding: "18px 12px", borderRight: "1px solid var(--line-1)", background: "var(--ink-1)" }}>
          <div className="row g10" style={{ padding: "0 6px" }}>
            <LemtikMark size={28} />
            <span className="col">
              <b style={{ fontSize: 14 }}>Lemtik</b>
              <span className="t3" style={{ fontSize: 11.5 }}>Forensic review</span>
            </span>
          </div>
          <nav className="nav col g4" aria-label="Forensic">
            {nav.map((item) => {
              const active = pathname === item.to || pathname.startsWith(item.to + "/");
              const Icon = item.icon;
              return (
                <Link key={item.to} to={item.to} className={`row g10${active ? " on" : ""}`} aria-current={active ? "page" : undefined} style={{ padding: "8px 10px", borderRadius: 8, background: active ? "var(--ink-3)" : undefined, color: active ? "var(--tx-1)" : "var(--tx-2)", fontSize: 13.5 }}>
                  <Icon className="h-4 w-4" /> {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="card t3" style={{ padding: "10px 12px", fontSize: 12, lineHeight: 1.5, marginTop: "auto" }}>
            Case records are read-only here. You can add analyst notes; they're kept on the case timeline with your name.
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="forensic-no-print row g12" style={{ padding: "10px 20px", borderBottom: "1px solid var(--line-1)", background: "var(--ink-1)", position: "sticky", top: 0, zIndex: 20 }}>
            {activeCaseId ? <span className="tg mono">Case {activeCaseId.slice(0, 8).toUpperCase()}</span> : <span className="t3" style={{ fontSize: 13 }}>Security forensic analyst</span>}
            <span className="flex-auto" />
            <span className="t3" style={{ fontSize: 12 }}>Explanations</span>
            <Seg label="Explanation style" value={mode} onChange={setMode} options={[{ value: "plain", label: "Plain" }, { value: "technical", label: "Technical" }]} />
          </header>
          <main className="flex-1" style={{ padding: "20px 24px" }}>{children ?? <Outlet />}</main>
        </div>
      </div>
    </div>
  );
}
