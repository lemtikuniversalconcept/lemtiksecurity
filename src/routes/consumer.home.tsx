import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { MessageCircle, ClipboardList } from "lucide-react";
import { getLastReportId } from "@/lib/consumer-session";

const HOLD_DURATION_MS = 2000;

export const Route = createFileRoute("/consumer/home")({
  component: HomePage,
});

function HomePage() {
  const navigate = useNavigate();
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef(0);

  const cancelHold = () => {
    setHolding(false);
    setProgress(0);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
  };

  const tick = () => {
    const elapsed = Date.now() - startRef.current;
    setProgress(Math.min(1, elapsed / HOLD_DURATION_MS));
    if (elapsed < HOLD_DURATION_MS) {
      rafRef.current = window.requestAnimationFrame(tick);
    }
  };

  const startHold = () => {
    setHolding(true);
    startRef.current = Date.now();
    rafRef.current = window.requestAnimationFrame(tick);
    timerRef.current = window.setTimeout(() => {
      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate([80, 40, 80]);
      navigate({ to: "/consumer/report" });
    }, HOLD_DURATION_MS);
  };

  const lastReportId = getLastReportId();

  return (
    <div className="flex flex-1 flex-col items-center justify-between px-6 py-10">
      <div />
      <div className="flex flex-col items-center gap-6">
        <button
          type="button"
          onPointerDown={startHold}
          onPointerUp={cancelHold}
          onPointerLeave={cancelHold}
          onContextMenu={(e) => e.preventDefault()}
          className="relative grid h-56 w-56 select-none place-items-center rounded-full bg-red-600 text-white shadow-[0_0_60px_-10px_rgba(220,38,38,0.6)] active:scale-[0.98]"
          style={{ touchAction: "none" }}
        >
          <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100" aria-hidden>
            <circle
              cx="50"
              cy="50"
              r="46"
              fill="none"
              stroke="rgba(255,255,255,0.85)"
              strokeWidth="4"
              strokeDasharray={2 * Math.PI * 46}
              strokeDashoffset={2 * Math.PI * 46 * (1 - progress)}
              style={{ transition: holding ? "none" : "stroke-dashoffset 150ms ease-out" }}
            />
          </svg>
          <div className="text-center">
            <div className="text-3xl font-bold tracking-tight">SOS</div>
            <div className="mt-1 text-xs font-medium uppercase tracking-widest text-red-100">Emergency</div>
          </div>
        </button>
        <p className="text-sm text-slate-400">Hold for 2 seconds to activate</p>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-2">
        <button
          type="button"
          onClick={() => navigate({ to: "/consumer/ai" })}
          className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm hover:bg-white/10"
        >
          <MessageCircle className="h-4 w-4 text-slate-300" />
          Ask a question or get help
        </button>
        {lastReportId && (
          <button
            type="button"
            onClick={() => navigate({ to: "/consumer/status", search: { report_id: lastReportId } })}
            className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm hover:bg-white/10"
          >
            <ClipboardList className="h-4 w-4 text-slate-300" />
            Check my report status
          </button>
        )}
      </div>
    </div>
  );
}
