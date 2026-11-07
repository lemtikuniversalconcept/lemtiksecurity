import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { LemtikMark } from "@/components/nw";
import { EstateMapArt } from "@/components/illustrations/EstateMapArt";

/** Split sign-in layout shared by the auth pages: form on the left, estate map art on the right. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-wrap" style={{ background: "var(--ink-0)" }}>
      <main className="flex min-w-0 flex-col px-6 py-8 sm:px-14 sm:py-10" style={{ flex: "1 1 480px" }}>
        <Link to="/" className="row g10 t1 self-start" aria-label="Lemtik home">
          <LemtikMark size={30} />
          <b style={{ fontStretch: "122%", letterSpacing: ".14em", fontSize: 15 }}>LEMTIK</b>
        </Link>
        <div className="col g20 w-full" style={{ margin: "auto 0", maxWidth: 380, paddingBlock: 32 }}>
          {children}
        </div>
        <div className="row g12 wrap t3" style={{ fontSize: 12 }}>
          <a href="https://lemtik.com.ng/status" className="row g6 hover:text-tx-1">
            <span className="dot d-ok" />
            System status
          </a>
          <span aria-hidden="true">·</span>
          <a href="https://lemtik.com.ng/privacy" className="hover:text-tx-1">Privacy</a>
          <span aria-hidden="true">·</span>
          <a href="https://lemtik.com.ng/terms" className="hover:text-tx-1">Terms</a>
          <span className="flex-auto" />
          <a href="https://lemtik.com.ng" className="hover:text-tx-1">lemtik.com.ng</a>
        </div>
      </main>
      <aside
        className="relative overflow-hidden max-[720px]:hidden"
        style={{ flex: "1 1 560px", minHeight: 420, borderLeft: "1px solid var(--line-1)" }}
      >
        <div className="map" style={{ position: "absolute", inset: 0, border: 0, borderRadius: 0, opacity: 0.85 }}>
          <EstateMapArt />
        </div>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg,rgba(10,12,16,.1),rgba(10,12,16,.85) 78%)" }} />
        <div className="col g12" style={{ position: "absolute", left: 48, right: 48, bottom: 48 }}>
          <span className="eyebrow" style={{ color: "var(--blue-hi)" }}>
            Before · during · after
          </span>
          <p style={{ fontSize: 30, fontWeight: 600, fontStretch: "112%", lineHeight: 1.18, letterSpacing: "-.015em", maxWidth: 560 }}>
            Turn the chaos of an incident into actionable intelligence.
          </p>
          <p className="t2" style={{ fontSize: 14, maxWidth: 480 }}>
            One picture of every officer, patrol, camera and report — with AI that proposes, and people who decide.
          </p>
        </div>
      </aside>
    </div>
  );
}
