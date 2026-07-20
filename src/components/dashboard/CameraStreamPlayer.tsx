import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, PlayCircle, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { startCameraStream, type CameraRecord } from "@/lib/cameras.functions";

type CameraStreamPlayerProps = {
  camera: CameraRecord;
  className?: string;
};

export function CameraStreamPlayer({ camera, className }: CameraStreamPlayerProps) {
  const startStream = useServerFn(startCameraStream);
  const [loading, setLoading] = useState(false);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  const statusTone = useMemo(() => {
    if (camera.status === "online") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-100";
    if (camera.status === "degraded") return "border-amber-300/30 bg-amber-300/10 text-amber-100";
    return "border-rose-300/30 bg-rose-300/10 text-rose-100";
  }, [camera.status]);

  const handleStart = async () => {
    setLoading(true);
    setStreamError(null);
    try {
      const result = await startStream({ data: { camera_id: camera.id } }) as { stream_url?: string | null; status?: string } | null;
      const nextUrl = result?.stream_url ?? null;
      if (!nextUrl) {
        setStreamError("Stream is not available from the Relationship API.");
      }
      setStreamUrl(nextUrl);
    } catch (error) {
      setStreamError(error instanceof Error ? error.message : "Unable to start camera stream.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={cn("rounded-2xl border border-white/10 bg-black/20 p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Video className="h-4 w-4 text-cyan-300" />
            {camera.name}
          </div>
          <div className="mt-1 text-xs text-slate-400">{camera.location}</div>
        </div>
        <span className={cn("rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em]", statusTone)}>
          {camera.status}
        </span>
      </div>

      <button
        type="button"
        onClick={() => void handleStart()}
        disabled={loading}
        className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
        {loading ? "Starting stream..." : streamUrl ? "Restart stream" : "Start stream"}
      </button>

      {streamError && (
        <div className="mt-3 rounded-xl border border-rose-300/20 bg-rose-300/10 px-3 py-2 text-xs text-rose-100">
          {streamError}
        </div>
      )}

      {streamUrl ? (
        <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-black">
          <video
            key={streamUrl}
            src={streamUrl}
            controls
            autoPlay
            playsInline
            muted
            className="h-48 w-full object-cover"
          />
        </div>
      ) : (
        <div className="mt-3 rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-xs text-slate-400">
          Stream will appear here after the Relationship API returns a live feed URL.
        </div>
      )}
    </div>
  );
}

