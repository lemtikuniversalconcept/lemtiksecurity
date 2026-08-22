import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Camera, Mic, Video, CheckCircle2, Loader2, Keyboard, ShieldAlert, Send } from "lucide-react";
import { createConsumerReport, sendIntakeTurn } from "@/lib/consumer.functions";
import { uploadWithRetry } from "@/lib/consumer-media-queue";
import { getConsumerToken, getCurrentPositionSafe, setLastReportId } from "@/lib/consumer-session";

type TranscriptTurn = { speaker: "ai" | "you"; text: string };
type UploadState = { id: string; label: string; progress: number; done: boolean; failed: boolean };

const OPENING_LINE = "Stay calm, help is on the way. What's your emergency?";

// Speaking and listening are chained through promises rather than fired independently
// so listening only ever starts once the AI has actually finished talking — starting
// it eagerly let the mic pick up the AI's own voice through the speaker and transcribe
// it as if the guest had spoken, which is what caused the "looping" on phones (a
// laptop's TTS is usually quieter relative to its mic gain, so it was less visible there).
function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      resolve();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}

function getSpeechRecognition(): (new () => any) | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
}

export const Route = createFileRoute("/consumer/report")({
  validateSearch: (search: Record<string, unknown>) => ({
    report_id: typeof search.report_id === "string" ? search.report_id : undefined,
  }),
  component: ReportPage,
});

function ReportPage() {
  const { report_id: existingReportId } = Route.useSearch();
  const navigate = useNavigate();
  const createReport = useServerFn(createConsumerReport);
  const sendTurn = useServerFn(sendIntakeTurn);
  const token = getConsumerToken();

  const [reportId, setReportId] = useState<string | null>(existingReportId || null);
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [listening, setListening] = useState(false);
  const [awaitingReply, setAwaitingReply] = useState(false);
  const [conversationDone, setConversationDone] = useState(Boolean(existingReportId));
  // Once true, stays true: switches the guest to typing and the AI to on-screen-only
  // text, so neither side's voice can be overheard by whatever is threatening them.
  const [dangerMode, setDangerMode] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const recognitionRef = useRef<any>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunkIndexRef = useRef(0);
  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);

  const listenOnce = (): Promise<string | null> =>
    new Promise((resolve) => {
      const Recognition = getSpeechRecognition();
      if (!Recognition) {
        resolve(null);
        return;
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // already stopped
        }
      }
      const recognition = new Recognition();
      recognition.lang = "en-NG";
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      let settled = false;
      const finish = (text: string | null) => {
        if (settled) return;
        settled = true;
        recognitionRef.current = null;
        setListening(false);
        resolve(text);
      };
      recognition.onresult = (event: any) => finish(event.results?.[0]?.[0]?.transcript || null);
      recognition.onerror = () => finish(null);
      recognition.onend = () => finish(null);
      recognitionRef.current = recognition;
      setListening(true);
      recognition.start();
    });

  const runTurn = async (guestText: string) => {
    if (!reportId || !token || awaitingReply) return;
    setTranscript((prev) => [...prev, { speaker: "you", text: guestText }]);
    historyRef.current = [...historyRef.current, { role: "user", content: guestText }];
    setAwaitingReply(true);
    try {
      const result = await sendTurn({
        data: { token, report_id: reportId, transcript: guestText, conversation_history: historyRef.current },
      });
      const dangerNow = dangerMode || result.danger_detected;
      if (result.danger_detected) setDangerMode(true);

      const spoken = [result.spoken_response, result.follow_up_question].filter(Boolean).join(" ");
      setTranscript((prev) => [...prev, { speaker: "ai", text: spoken }]);
      historyRef.current = [...historyRef.current, { role: "assistant", content: spoken }];

      if (!result.follow_up_question) {
        setConversationDone(true);
      }

      if (dangerNow) {
        // No audible AI voice, no mic — everything from here is silent and on-screen.
        return;
      }
      await speak(spoken);
      if (result.follow_up_question) {
        const nextAnswer = await listenOnce();
        if (nextAnswer) void runTurn(nextAnswer);
      }
    } finally {
      setAwaitingReply(false);
    }
  };

  // The three things happening the instant this screen mounts: create the incident,
  // capture GPS (best-effort — an emergency report must never block on location), and
  // start talking to the guest.
  useEffect(() => {
    if (existingReportId) return;
    let cancelled = false;
    (async () => {
      const position = await getCurrentPositionSafe();
      const result = await createReport({
        data: { token: token || "", lat: position.lat, lng: position.lng },
      });
      if (cancelled) return;
      setReportId(result.report_id);
      setLastReportId(result.report_id);
      setTranscript([{ speaker: "ai", text: OPENING_LINE }]);
      historyRef.current = [{ role: "assistant", content: OPENING_LINE }];
      await speak(OPENING_LINE);
      if (cancelled) return;
      const firstAnswer = await listenOnce();
      if (firstAnswer && !cancelled) void runTurn(firstAnswer);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitTyped = () => {
    const text = textInput.trim();
    if (!text) return;
    setTextInput("");
    void runTurn(text);
  };

  const addUpload = (id: string, label: string) => setUploads((prev) => [...prev, { id, label, progress: 0, done: false, failed: false }]);
  const markUpload = (id: string, patch: Partial<UploadState>) =>
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));

  const handlePhoto = async (file: File) => {
    if (!reportId || !token) return;
    const id = `photo-${Date.now()}`;
    addUpload(id, "Photo");
    const result = await uploadWithRetry({ reportId, token, mediaType: "photo", chunkIndex: null, blob: file, filename: file.name });
    markUpload(id, { progress: 100, done: result.ok, failed: !result.ok });
  };

  const toggleRecording = async (kind: "audio" | "video") => {
    if (!reportId || !token) return;
    if (recorderRef.current && recorderRef.current.state === "recording") {
      recorderRef.current.stop();
      recorderRef.current = null;
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia(kind === "audio" ? { audio: true } : { audio: true, video: true });
      const recorder = new MediaRecorder(stream, { mimeType: kind === "audio" ? "audio/webm" : "video/webm" });
      chunkIndexRef.current = 0;
      const id = `${kind}-${Date.now()}`;
      addUpload(id, kind === "audio" ? "Audio" : "Video");
      recorder.ondataavailable = async (event) => {
        if (event.data.size === 0) return;
        const index = chunkIndexRef.current++;
        const result = await uploadWithRetry({
          reportId,
          token,
          mediaType: kind === "audio" ? "audio_chunk" : "video_chunk",
          chunkIndex: index,
          blob: event.data,
          filename: `${kind}_${index}.webm`,
        });
        markUpload(id, { progress: Math.min(95, (index + 1) * 15), failed: !result.ok && !("queued" in result && result.queued) });
      };
      recorder.onstop = () => {
        markUpload(id, { progress: 100, done: true });
        stream.getTracks().forEach((track) => track.stop());
      };
      recorderRef.current = recorder;
      recorder.start(3000);
    } catch {
      // Camera/mic permission denied or unavailable — silently no-op, the guest can still submit text/photos.
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-4 px-4 py-6">
      <div className="flex items-center gap-2 rounded-xl bg-red-600/15 px-4 py-3 text-sm font-medium text-red-300">
        <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
        Emergency — sending now
      </div>

      {dangerMode && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          Switched to silent mode — type instead of speaking. Security has been notified.
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
        {transcript.map((turn, i) => (
          <div key={i} className={turn.speaker === "ai" ? "text-slate-300" : "text-white"}>
            <span className="text-xs uppercase tracking-wider text-slate-500">{turn.speaker === "ai" ? "AI" : "You"}: </span>
            {turn.text}
          </div>
        ))}
        {awaitingReply && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> …
          </div>
        )}

        {!conversationDone && reportId && !awaitingReply && (
          dangerMode ? (
            <div className="mt-1 flex items-center gap-2">
              <input
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitTyped()}
                placeholder="Type here…"
                autoFocus
                className="flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
              />
              <button type="button" onClick={submitTyped} disabled={!textInput.trim()} className="rounded-lg bg-amber-600 p-2 text-white disabled:opacity-40">
                <Send className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="mt-1 flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  const text = await listenOnce();
                  if (text) void runTurn(text);
                }}
                disabled={listening}
                className="flex items-center justify-center gap-2 self-start rounded-lg border border-white/15 px-3 py-2 text-xs disabled:opacity-50"
              >
                <Mic className="h-3.5 w-3.5" /> {listening ? "Listening…" : "Tap to answer"}
              </button>
              <button
                type="button"
                onClick={() => setDangerMode(true)}
                className="flex items-center justify-center gap-1.5 self-start rounded-lg border border-white/10 px-2.5 py-2 text-[11px] text-slate-400"
              >
                <Keyboard className="h-3 w-3" /> Type instead
              </button>
            </div>
          )
        )}
      </div>

      <div className="flex gap-2">
        <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-white/15 py-3 text-xs">
          <Camera className="h-4 w-4" /> Photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handlePhoto(file);
              e.target.value = "";
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => void toggleRecording("video")}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/15 py-3 text-xs"
        >
          <Video className="h-4 w-4" /> Video
        </button>
        <button
          type="button"
          onClick={() => void toggleRecording("audio")}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/15 py-3 text-xs"
        >
          <Mic className="h-4 w-4" /> Audio
        </button>
      </div>

      {uploads.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {uploads.map((u) => (
            <div key={u.id} className="flex items-center gap-2 text-xs text-slate-400">
              <span className="w-14">{u.label}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                <div className={`h-full ${u.failed ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${u.progress}%` }} />
              </div>
              {u.done ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        disabled={!reportId}
        onClick={() => reportId && navigate({ to: "/consumer/status", search: { report_id: reportId } })}
        className="mt-auto w-full rounded-xl bg-emerald-600 px-4 py-4 text-sm font-semibold text-white disabled:opacity-40"
      >
        I'm done / add more
      </button>
    </div>
  );
}
