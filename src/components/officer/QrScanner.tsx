import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

/**
 * Full-screen camera scanner for checkpoint QR codes. Uses the browser's built-in barcode
 * detector where there is one (Android Chrome) and the open-source jsQR decoder elsewhere
 * (e.g. iPhone Safari). Nothing leaves the phone except the decoded text.
 */
export function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const doneRef = useRef(false);
  const resultRef = useRef(onResult);
  resultRef.current = onResult;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | null = null;
    let cancelled = false;

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This browser can't use the camera. Use GPS check-in, or open the app in Chrome or Safari.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      } catch {
        setError("Camera access was refused. Allow the camera for this app in your phone settings, then try again.");
        return;
      }
      if (cancelled || !videoRef.current) return;
      const video = videoRef.current;
      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      await video.play().catch(() => undefined);

      const Native = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
      let detector: Detector | null = null;
      if (Native) {
        try {
          detector = new Native({ formats: ["qr_code"] });
        } catch {
          detector = null;
        }
      }
      const jsQR = detector ? null : (await import("jsqr")).default;

      const tick = async () => {
        if (cancelled || doneRef.current || !video.videoWidth) return;
        try {
          let text: string | null = null;
          if (detector) {
            const found = await detector.detect(video);
            text = found[0]?.rawValue ?? null;
          } else if (jsQR && canvasRef.current) {
            const c = canvasRef.current;
            const w = Math.min(640, video.videoWidth);
            const h = Math.round((video.videoHeight / video.videoWidth) * w);
            c.width = w;
            c.height = h;
            const ctx = c.getContext("2d", { willReadFrequently: true });
            if (!ctx) return;
            ctx.drawImage(video, 0, 0, w, h);
            const img = ctx.getImageData(0, 0, w, h);
            text = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" })?.data ?? null;
          }
          if (text && !doneRef.current) {
            doneRef.current = true;
            navigator.vibrate?.(80);
            resultRef.current(text);
          }
        } catch {
          /* a bad frame; try the next one */
        }
      };
      timer = window.setInterval(() => void tick(), 250);
    })();

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 col" style={{ background: "#000" }} role="dialog" aria-modal="true" aria-label="Scan checkpoint QR code">
      <div className="row g8" style={{ padding: "14px 16px", color: "#fff" }}>
        <b className="f1">Scan the checkpoint code</b>
        <button type="button" className="ibtn" aria-label="Close scanner" onClick={onClose} style={{ background: "rgba(255,255,255,.12)", color: "#fff", border: 0 }}>
          <X size={18} />
        </button>
      </div>
      <div className="f1 relative" style={{ overflow: "hidden" }}>
        <video ref={videoRef} muted playsInline style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
        <canvas ref={canvasRef} style={{ display: "none" }} />
        <div style={{ position: "absolute", left: "50%", top: "50%", width: 240, height: 240, transform: "translate(-50%,-50%)", border: "3px solid rgba(255,255,255,.85)", borderRadius: 18, boxShadow: "0 0 0 2000px rgba(0,0,0,.45)" }} />
      </div>
      <div style={{ padding: "14px 18px 28px", color: "#fff", textAlign: "center", fontSize: 14 }}>
        {error ?? "Hold the phone steady with the code inside the square."}
      </div>
    </div>
  );
}
