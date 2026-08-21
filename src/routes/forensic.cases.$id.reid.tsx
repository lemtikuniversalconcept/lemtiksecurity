import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Loader2, ScanFace, ArrowRight } from "lucide-react";
import { getForensicCase } from "@/lib/forensic.functions";

export const Route = createFileRoute("/forensic/cases/$id/reid")({
  component: ReidPage,
});

function ReidPage() {
  const { id } = Route.useParams();
  const getCase = useServerFn(getForensicCase);
  const { data, isLoading } = useQuery({
    queryKey: ["forensic-case", id],
    queryFn: () => getCase({ data: { incident_id: id } }),
  });
  const [selected, setSelected] = useState<string | null>(null);

  const targets = useMemo(() => {
    const rows = ((data as any)?.reid_telemetry || []) as any[];
    const byTarget = new Map<string, any[]>();
    for (const row of rows) {
      if (!byTarget.has(row.target_id)) byTarget.set(row.target_id, []);
      byTarget.get(row.target_id)!.push(row);
    }
    return Array.from(byTarget.entries()).map(([targetId, events]) => {
      const sorted = [...events].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      const cameras = Array.from(new Set(sorted.map((e) => e.camera_id)));
      const confidences = sorted.map((e) => e.reid_confidence).filter((c) => typeof c === "number");
      const avgConfidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null;
      return { targetId, events: sorted, cameras, avgConfidence };
    });
  }, [data]);

  if (isLoading) {
    return <div className="flex items-center gap-2 text-sm text-[#94a3b8]"><Loader2 className="h-4 w-4 animate-spin" /> Loading Re-ID telemetry…</div>;
  }

  if (targets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[#2d3748] py-14 text-center text-sm text-[#94a3b8]">
        <ScanFace className="mx-auto mb-2 h-6 w-6 opacity-60" />
        No cross-camera Re-ID telemetry correlates to this incident's time and location.
        <div className="mt-1 text-xs">
          Telemetry is matched by organisation and a ±2 hour window around when the incident was reported — this
          isn't a confirmed per-incident link, since the telemetry feed has no incident reference of its own.
        </div>
      </div>
    );
  }

  const activeTarget = targets.find((t) => t.targetId === selected) || targets[0];

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
        Targets below were seen on camera within ±2 hours of this incident, in the same organisation — a proximity
        signal, not a verified link to this specific case.
      </div>

      <div className="rounded-lg border border-[#2d3748] bg-[#1a2234] p-4">
        <h2 className="text-[11px] uppercase tracking-wider text-[#94a3b8]">Camera-to-camera path — {activeTarget.targetId}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {activeTarget.cameras.map((cam, i) => (
            <div key={cam} className="flex items-center gap-2">
              <span className="rounded-md border border-[#2d3748] bg-black/20 px-2.5 py-1.5 text-xs text-[#e2e8f0]">{cam}</span>
              {i < activeTarget.cameras.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-[#94a3b8]" />}
            </div>
          ))}
        </div>
        <div className="mt-3 space-y-1.5">
          {activeTarget.events.map((e: any, i: number) => (
            <div key={i} className="flex items-center justify-between text-xs text-[#94a3b8]">
              <span>{e.camera_id}</span>
              <span>{new Date(e.timestamp).toLocaleString()}</span>
              <span>{e.reid_confidence != null ? `${Math.round(e.reid_confidence * 100)}% confidence` : "—"}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#2d3748]">
        <table className="w-full text-sm">
          <thead className="bg-[#111827] text-[10px] uppercase tracking-wider text-[#94a3b8]">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Target</th>
              <th className="px-4 py-3 text-left font-medium">First seen</th>
              <th className="px-4 py-3 text-left font-medium">Last seen</th>
              <th className="px-4 py-3 text-left font-medium">Cameras</th>
              <th className="px-4 py-3 text-left font-medium">Avg. confidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2d3748] bg-[#1a2234]">
            {targets.map((t) => (
              <tr
                key={t.targetId}
                onClick={() => setSelected(t.targetId)}
                className={`cursor-pointer hover:bg-white/5 ${t.targetId === activeTarget.targetId ? "bg-white/5" : ""}`}
              >
                <td className="px-4 py-3 font-mono text-xs text-[#e2e8f0]">{t.targetId}</td>
                <td className="px-4 py-3 text-xs text-[#94a3b8]">{t.events[0]?.camera_id} · {new Date(t.events[0]?.timestamp).toLocaleTimeString()}</td>
                <td className="px-4 py-3 text-xs text-[#94a3b8]">
                  {t.events[t.events.length - 1]?.camera_id} · {new Date(t.events[t.events.length - 1]?.timestamp).toLocaleTimeString()}
                </td>
                <td className="px-4 py-3 text-xs text-[#94a3b8]">{t.cameras.length}</td>
                <td className="px-4 py-3 text-xs text-[#94a3b8]">{t.avgConfidence != null ? `${Math.round(t.avgConfidence * 100)}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
