import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Camera, ChevronRight, MessageCircle, Siren } from "lucide-react";
import { getConsumerReportStatus } from "@/lib/consumer.functions";
import { getConsumerToken } from "@/lib/consumer-session";
import { GNotice, OrgBadge } from "@/components/guest/kit";

const STEPS = [
  { key: "received", label: "Security team notified" },
  { key: "acknowledged", label: "An operator has seen your report" },
  { key: "dispatched", label: "Help has been sent" },
  { key: "resolved", label: "Marked resolved" },
] as const;

const HEADLINE: Record<string, string> = {
  received: "Security has your report",
  acknowledged: "An operator is looking at your report",
  dispatched: "Help is on the way",
  resolved: "This report is resolved",
};

const ADVICE: Record<string, string> = {
  received: "Stay where you are if it is safe. Don't confront anyone.",
  acknowledged: "Stay where you are if it is safe. Don't confront anyone.",
  dispatched: "Stay where you are if it is safe. Don't confront anyone. Security staff are coming to you.",
};

export const Route = createFileRoute("/consumer/status")({
  validateSearch: (search: Record<string, unknown>) => ({
    report_id: typeof search.report_id === "string" ? search.report_id : "",
  }),
  component: StatusPage,
});

function StatusPage() {
  const { report_id } = Route.useSearch();
  const navigate = useNavigate();
  const getStatus = useServerFn(getConsumerReportStatus);
  const token = getConsumerToken();

  const { data, isError, isLoading } = useQuery({
    queryKey: ["consumer-report-status", report_id],
    queryFn: () => getStatus({ data: { token: token || "", report_id } }),
    enabled: Boolean(token && report_id),
    refetchInterval: 10_000,
  });

  const status = (data as { status?: string } | undefined)?.status ?? null;
  const reached = status ? STEPS.findIndex((s) => s.key === status) : -1;

  return (
    <div className="col f1">
      <OrgBadge />
      <div className="col g16" style={{ padding: "4px 20px 28px", gap: 16 }}>
        <div className="col g4">
          <span style={{ fontFamily: "var(--m)", fontSize: 12.5, color: "var(--g-tx3)", letterSpacing: ".06em" }}>REPORT {report_id.slice(0, 8).toUpperCase()}</span>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>
            {isLoading ? "Checking…" : status ? HEADLINE[status] ?? `Status: ${status}` : "We couldn't load the latest status"}
          </h1>
        </div>

        {isError && <GNotice tone="warn">The latest status didn't load. Your report was already sent; this page retries every 10 seconds.</GNotice>}

        <ol className="col" style={{ margin: 0, padding: 0, listStyle: "none", gap: 0 }}>
          {STEPS.map((s, i) => {
            const done = reached >= i;
            return (
              <li key={s.key} className="row g12" style={{ padding: "10px 0" }}>
                <span style={{ width: 26, height: 26, borderRadius: 13, display: "grid", placeItems: "center", fontSize: 13, fontWeight: 700, background: done ? "#1E8E50" : "#fff", color: done ? "#fff" : "var(--g-tx3)", border: done ? 0 : "1px solid var(--g-line)" }}>
                  {done ? "✓" : i + 1}
                </span>
                <b style={{ fontSize: 16, color: done ? "var(--g-ink)" : "var(--g-tx3)", fontWeight: done ? 650 : 500 }}>{s.label}</b>
              </li>
            );
          })}
        </ol>

        {status && ADVICE[status] && <GNotice tone="info">{ADVICE[status]}</GNotice>}

        <div className="col g10">
          <button type="button" className="g-btn" onClick={() => navigate({ to: "/consumer/report", search: { report_id } })}>
            <Camera size={20} /> <span className="f1 text-left">Add photos, video or audio</span> <ChevronRight size={18} />
          </button>
          <button type="button" className="g-btn" onClick={() => navigate({ to: "/consumer/ai" })}>
            <MessageCircle size={20} /> <span className="f1 text-left">Ask the assistant</span> <ChevronRight size={18} />
          </button>
          <button type="button" className="g-btn" onClick={() => navigate({ to: "/consumer/home" })} style={{ color: "#B3172C", borderColor: "#F2C4CB" }}>
            <Siren size={20} /> <span className="f1 text-left">New emergency</span> <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
