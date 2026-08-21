import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Loader2, FileText, Image as ImageIcon, Video, Music, ShieldAlert } from "lucide-react";
import { getForensicEvidence } from "@/lib/forensic.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/forensic/cases/$id/evidence")({
  component: EvidencePage,
});

function useAnalystLabel() {
  const [label, setLabel] = useState("Analyst");
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) setLabel(data.user.email);
    });
  }, []);
  return label;
}

function Watermark({ text }: { text: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const draw = () => {
      const { clientWidth, clientHeight } = parent;
      canvas.width = clientWidth;
      canvas.height = clientHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, clientWidth, clientHeight);
      ctx.font = "11px ui-monospace, monospace";
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.save();
      ctx.translate(clientWidth / 2, clientHeight / 2);
      ctx.rotate((-22 * Math.PI) / 180);
      for (let y = -clientHeight; y < clientHeight; y += 46) {
        for (let x = -clientWidth; x < clientWidth; x += 210) {
          ctx.fillText(text, x, y);
        }
      }
      ctx.restore();
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [text]);
  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />;
}

function WatermarkedMedia({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="relative overflow-hidden rounded-md bg-black/30">
      {children}
      <Watermark text={label} />
    </div>
  );
}

const TABS = ["case_files", "cctv", "consumer"] as const;
type Tab = (typeof TABS)[number];

function EvidencePage() {
  const { id } = Route.useParams();
  const getEvidence = useServerFn(getForensicEvidence);
  const analyst = useAnalystLabel();
  const watermarkText = `${analyst} | ${new Date().toLocaleString()} | LEMTIK FORENSIC`;
  const [tab, setTab] = useState<Tab>("case_files");

  const { data, isLoading } = useQuery({
    queryKey: ["forensic-evidence", id],
    queryFn: () => getEvidence({ data: { incident_id: id } }),
  });

  if (isLoading) {
    return <div className="flex items-center gap-2 text-sm text-[#94a3b8]"><Loader2 className="h-4 w-4 animate-spin" /> Loading evidence…</div>;
  }

  const caseFiles = ((data as any)?.case_files || []) as any[];
  const cctvSnapshots = ((data as any)?.cctv_snapshots || []) as any[];
  const consumerMedia = ((data as any)?.consumer_media || []) as any[];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 rounded-full border border-[#2d3748] bg-[#1a2234] p-1 text-xs w-fit">
        {([
          ["case_files", `Case files (${caseFiles.length})`],
          ["cctv", `CCTV snapshots (${cctvSnapshots.length})`],
          ["consumer", `Consumer media (${consumerMedia.length})`],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-full px-3 py-1.5 transition-colors ${tab === key ? "bg-[#3b82f6] text-white" : "text-[#94a3b8]"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "case_files" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {caseFiles.length === 0 && <EmptyState text="No case files attached to this incident." />}
          {caseFiles.map((item, i) => (
            <div key={i} className="rounded-lg border border-[#2d3748] bg-[#1a2234] p-3">
              <WatermarkedMedia label={watermarkText}>
                {item.kind === "image" && item.signed_url ? (
                  <img src={item.signed_url} alt={item.name} className="h-40 w-full object-cover" />
                ) : (
                  <div className="flex h-40 w-full flex-col items-center justify-center gap-2 text-[#94a3b8]">
                    <FileText className="h-8 w-8" />
                    <span className="text-[11px]">{item.kind}</span>
                  </div>
                )}
              </WatermarkedMedia>
              <div className="mt-2 truncate text-xs text-[#e2e8f0]">{item.name}</div>
              <div className="mt-0.5 text-[11px] text-[#94a3b8]">Added by {item.added_by_name} · {new Date(item.added_at).toLocaleDateString()}</div>
              {item.legal && (
                <div className="mt-1.5 flex items-center gap-1 rounded-md bg-[#ef4444]/15 px-2 py-1 text-[11px] text-[#ef4444]">
                  <ShieldAlert className="h-3 w-3" /> Legal hold — chain of custody tracked
                </div>
              )}
              {item.signed_url && (
                <a href={item.signed_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[11px] text-[#3b82f6] hover:underline">
                  Open full size
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "cctv" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cctvSnapshots.length === 0 && <EmptyState text="No CCTV telemetry correlated to this incident's time window." />}
          {cctvSnapshots.map((item, i) => (
            <div key={i} className="rounded-lg border border-[#2d3748] bg-[#1a2234] p-3">
              <WatermarkedMedia label={watermarkText}>
                {item.signed_url ? (
                  <img src={item.signed_url} className="h-40 w-full object-cover" alt={`Camera ${item.camera_id}`} />
                ) : (
                  <div className="flex h-40 w-full items-center justify-center text-[#94a3b8]"><ImageIcon className="h-8 w-8" /></div>
                )}
              </WatermarkedMedia>
              <div className="mt-2 text-xs text-[#e2e8f0]">{item.camera_id} · target {item.target_id}</div>
              <div className="mt-0.5 text-[11px] text-[#94a3b8]">
                {new Date(item.timestamp).toLocaleString()} · confidence {item.confidence != null ? `${Math.round(item.confidence * 100)}%` : "—"}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "consumer" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {consumerMedia.length === 0 && <EmptyState text="No guest-submitted media for this incident." />}
          {consumerMedia.map((item: any) => (
            <div key={item.id} className="rounded-lg border border-[#2d3748] bg-[#1a2234] p-3">
              <WatermarkedMedia label={watermarkText}>
                {item.media_type === "photo" && item.signed_url ? (
                  <img src={item.signed_url} className="h-40 w-full object-cover" alt="Guest submitted" />
                ) : item.media_type.startsWith("audio") ? (
                  <div className="flex h-40 w-full flex-col items-center justify-center gap-2 text-[#94a3b8]">
                    <Music className="h-8 w-8" />
                    {item.signed_url && <audio controls src={item.signed_url} className="w-full px-3" />}
                  </div>
                ) : item.media_type.startsWith("video") && item.signed_url ? (
                  <video controls src={item.signed_url} className="h-40 w-full object-cover" />
                ) : (
                  <div className="flex h-40 w-full items-center justify-center text-[#94a3b8]"><Video className="h-8 w-8" /></div>
                )}
              </WatermarkedMedia>
              <div className="mt-2 text-xs text-[#94a3b8]">{item.media_type} · {new Date(item.captured_at).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="col-span-full rounded-lg border border-dashed border-[#2d3748] py-10 text-center text-sm text-[#94a3b8]">{text}</div>;
}
