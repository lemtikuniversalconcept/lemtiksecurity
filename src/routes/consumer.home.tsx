import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ChevronRight, ClipboardList, MessageCircle } from "lucide-react";
import { getLastReportId } from "@/lib/consumer-session";
import { OrgBadge } from "@/components/guest/kit";

const HOLD_MS = 2000;

export const Route = createFileRoute("/consumer/home")({
  component: HomePage,
});

function HomePage() {
  const navigate = useNavigate();
  const [progress, setProgress] = useState(0);
  const [lastReportId, setLastReport] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const raf = useRef<number | null>(null);
  const start = useRef(0);

  useEffect(() => setLastReport(getLastReportId()), []);

  const cancel = () => {
    setProgress(0);
    if (timer.current) window.clearTimeout(timer.current);
    if (raf.current) window.cancelAnimationFrame(raf.current);
  };
  const tick = () => {
    const p = Math.min(1, (Date.now() - start.current) / HOLD_MS);
    setProgress(p);
    if (p < 1) raf.current = window.requestAnimationFrame(tick);
  };
  const begin = () => {
    start.current = Date.now();
    raf.current = window.requestAnimationFrame(tick);
    timer.current = window.setTimeout(() => {
      navigator.vibrate?.([80, 40, 80]);
      navigate({ to: "/consumer/report", search: { report_id: undefined } });
    }, HOLD_MS);
  };
  useEffect(() => () => cancel(), []);

  return (
    <div className="col f1">
      <OrgBadge />
      <div className="col f1" style={{ padding: "8px 20px 28px", alignItems: "center", gap: 18 }}>
        <p style={{ margin: "12px 0 0", fontSize: 17, fontWeight: 600, textAlign: "center" }}>If you are in danger or need urgent help</p>
        <button
          type="button"
          aria-label="Hold for 2 seconds to call security"
          onPointerDown={begin}
          onPointerUp={cancel}
          onPointerLeave={cancel}
          onPointerCancel={cancel}
          onKeyDown={(e) => (e.key === " " || e.key === "Enter") && !e.repeat && begin()}
          onKeyUp={cancel}
          onContextMenu={(e) => e.preventDefault()}
          style={{ width: 220, height: 220, borderRadius: 110, border: 0, padding: 8, background: `conic-gradient(#fff ${progress * 360}deg, transparent 0) border-box, #D9233A`, boxShadow: "0 18px 40px -12px rgba(217,35,58,.55)", touchAction: "none", userSelect: "none", color: "#fff" }}
        >
          <span className="col" style={{ width: "100%", height: "100%", borderRadius: "50%", background: "#D9233A", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <b style={{ fontSize: 44, letterSpacing: ".04em" }}>SOS</b>
            <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: ".12em" }}>{progress > 0 ? "KEEP HOLDING" : "HOLD 2 SECONDS"}</span>
          </span>
        </button>
        <p style={{ margin: 0, color: "var(--g-tx2)", fontSize: 15, textAlign: "center", maxWidth: 320, lineHeight: 1.5 }}>
          Security is alerted straight away. You can then speak or type in your language.
        </p>
        <div className="col g10" style={{ width: "100%", marginTop: "auto" }}>
          <button type="button" className="g-btn" onClick={() => navigate({ to: "/consumer/ai" })}>
            <MessageCircle size={20} /> <span className="f1 text-left">Ask a question or get help</span> <ChevronRight size={18} />
          </button>
          {lastReportId && (
            <button type="button" className="g-btn" onClick={() => navigate({ to: "/consumer/status", search: { report_id: lastReportId } })}>
              <ClipboardList size={20} /> <span className="f1 text-left">Check my report</span> <ChevronRight size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
