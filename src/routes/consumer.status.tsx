import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Camera, MessageCircle, MapPin } from "lucide-react";
import { getConsumerReportStatus } from "@/lib/consumer.functions";
import { getConsumerToken } from "@/lib/consumer-session";

const STATUS_LABELS: Record<string, string> = {
  received: "Security team notified",
  acknowledged: "An operator has seen your report",
  dispatched: "Help has been dispatched",
  resolved: "Marked resolved",
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

  const { data } = useQuery({
    queryKey: ["consumer-report-status", report_id],
    queryFn: () => getStatus({ data: { token: token || "", report_id } }),
    enabled: Boolean(token && report_id),
    refetchInterval: 10_000,
  });

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-emerald-500/15 text-emerald-400">
          <CheckCircle2 className="h-7 w-7" />
        </div>
        <h1 className="text-lg font-semibold">Report received</h1>
        <p className="text-xs text-slate-500">ID: {report_id.slice(0, 8).toUpperCase()}</p>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-center text-sm">
        Status: {data ? STATUS_LABELS[data.status] || data.status : "Loading…"}
      </div>

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
        Stay where you are if it is safe. Do not confront the situation. Officers are on their way.
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => navigate({ to: "/consumer/report", search: { report_id } })}
          className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm hover:bg-white/10"
        >
          <MapPin className="h-4 w-4 text-slate-300" /> Update my location
        </button>
        <button
          type="button"
          onClick={() => navigate({ to: "/consumer/report", search: { report_id } })}
          className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm hover:bg-white/10"
        >
          <Camera className="h-4 w-4 text-slate-300" /> Send more photos
        </button>
        <button
          type="button"
          onClick={() => navigate({ to: "/consumer/ai" })}
          className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm hover:bg-white/10"
        >
          <MessageCircle className="h-4 w-4 text-slate-300" /> Talk to AI assistant
        </button>
      </div>
    </div>
  );
}
