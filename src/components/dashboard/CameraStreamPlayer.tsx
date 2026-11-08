import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, PlayCircle, RotateCw } from "lucide-react";
import { startCameraStream, type CameraRecord } from "@/lib/cameras.functions";

const STATUS: Record<CameraRecord["status"], { dot: string; label: string }> = {
  online: { dot: "d-ok", label: "Online" },
  degraded: { dot: "d-warn", label: "Degraded" },
  offline: { dot: "d-fail", label: "Offline" },
};

/** One camera tile. The stream only starts when someone asks for it; nothing plays until then. */
export function CameraStreamPlayer({ camera, selected = false, onSelect, tall = false }: { camera: CameraRecord; selected?: boolean; onSelect?: () => void; tall?: boolean }) {
  const startStream = useServerFn(startCameraStream);
  const [loading, setLoading] = useState(false);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const status = STATUS[camera.status] ?? STATUS.offline;

  const handleStart = async () => {
    setLoading(true);
    setStreamError(null);
    try {
      const result = (await startStream({ data: { camera_id: camera.id } })) as { stream_url?: string | null } | null;
      const nextUrl = result?.stream_url ?? null;
      if (!nextUrl) setStreamError("No stream address came back for this camera.");
      setStreamUrl(nextUrl);
    } catch (error) {
      setStreamError(error instanceof Error ? error.message : "Couldn't start the stream.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card col" style={{ overflow: "hidden", borderColor: selected ? "var(--blue-ln)" : undefined }} onClick={onSelect}>
      <div className="relative" style={{ aspectRatio: tall ? "16 / 8" : "16 / 9", background: "#05070A" }}>
        {streamUrl ? (
          <video key={streamUrl} src={streamUrl} controls autoPlay playsInline muted className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 col g8" style={{ alignItems: "center", justifyContent: "center", padding: 12, textAlign: "center" }}>
            {camera.status === "offline" ? (
              <span className="t3" style={{ fontSize: 12 }}>
                {camera.lastSeenAt ? `No signal since ${new Date(camera.lastSeenAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "No signal"}
              </span>
            ) : null}
            <button
              type="button"
              className="b b-sm b-sec"
              onClick={(e) => {
                e.stopPropagation();
                void handleStart();
              }}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : camera.status === "offline" ? <RotateCw className="h-3.5 w-3.5" /> : <PlayCircle className="h-3.5 w-3.5" />}
              {loading ? "Starting…" : camera.status === "offline" ? "Try to connect" : "Start stream"}
            </button>
            {streamError && (
              <span style={{ fontSize: 12, color: "var(--fail)" }} role="alert">
                {streamError}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="row g8" style={{ padding: "8px 10px" }}>
        <b className="trunc" style={{ fontSize: 13 }}>
          {camera.name}
        </b>
        <span className="t3 trunc f1" style={{ fontSize: 12 }}>
          {camera.location}
        </span>
        <span className="st">
          <span className={`dot ${status.dot}`} />
          {status.label}
        </span>
        {streamUrl && (
          <button
            type="button"
            className="ibtn"
            style={{ width: 26, height: 26 }}
            aria-label="Restart stream"
            onClick={(e) => {
              e.stopPropagation();
              void handleStart();
            }}
          >
            <RotateCw size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
