import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Camera, Mic, Video, CheckCircle2, Loader2 } from "lucide-react";
import { createConsumerReport, updateConsumerReport } from "@/lib/consumer.functions";
import { uploadWithRetry } from "@/lib/consumer-media-queue";
import { getConsumerToken, getCurrentPositionSafe, setLastReportId } from "@/lib/consumer-session";

const QUESTIONS = [
  "Where are you right now?",
  "What is happening?",
  "Are you safe, or in immediate danger?",
];

type TranscriptTurn = { speaker: "ai" | "you"; text: string };
type UploadState = { id: string; label: string; progress: number; done: boolean; failed: boolean };

function speak(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  window.speechSynthesis.speak(utterance);
}

// The Web Speech API's SpeechRecognition constructor isn't in TS's lib.dom.d.ts yet;
// treat it as an untyped constructor rather than pulling in a third-party ambient types package.
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
  const updateReport = useServerFn(updateConsumerReport);
  const token = getConsumerToken();

  const [reportId, setReportId] = useState<string | null>(existingReportId || null);
  const [locationText, setLocationText] = useState("");
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [questionIndex, setQuestionIndex] = useState(existingReportId ? QUESTIONS.length : 0);
  const [listening, setListening] = useState(false);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const recognitionRef = useRef<InstanceType<NonNullable<ReturnType<typeof getSpeechRecognition>>> | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunkIndexRef = useRef(0);

  // The three things the spec calls out as happening the instant this screen
  // mounts: create the report, capture GPS, and start speaking to the guest.
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
      speak("Help is on the way. Where are you right now?");
      setTranscript([{ speaker: "ai", text: QUESTIONS[0] }]);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitAnswer = async (text: string) => {
    if (!reportId) return;
    setTranscript((prev) => [...prev, { speaker: "you", text }]);
    const field = questionIndex === 0 ? { location_text: text } : { description: text };
    await updateReport({ data: { token: token || "", report_id: reportId, ai_transcription: text, ...field } });
    if (questionIndex === 0) setLocationText(text);
    const next = questionIndex + 1;
    setQuestionIndex(next);
    if (next < QUESTIONS.length) {
      speak(QUESTIONS[next]);
      setTranscript((prev) => [...prev, { speaker: "ai", text: QUESTIONS[next] }]);
    }
  };

  const startListening = () => {
    const Recognition = getSpeechRecognition();
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.lang = "en-NG";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event: any) => {
      const text = event.results[0]?.[0]?.transcript;
      if (text) void submitAnswer(text);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
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

      <div>
        <label className="text-xs uppercase tracking-wider text-slate-500">Location</label>
        <input
          value={locationText}
          onChange={(e) => setLocationText(e.target.value)}
          onBlur={() => reportId && token && void updateReport({ data: { token, report_id: reportId, location_text: locationText } })}
          placeholder="Detected, or type your location"
          className="mt-1 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-red-500 focus:outline-none"
        />
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
        {transcript.map((turn, i) => (
          <div key={i} className={turn.speaker === "ai" ? "text-slate-300" : "text-white"}>
            <span className="text-xs uppercase tracking-wider text-slate-500">{turn.speaker === "ai" ? "AI" : "You"}: </span>
            {turn.text}
          </div>
        ))}
        {questionIndex < QUESTIONS.length && reportId && (
          <button
            type="button"
            onClick={startListening}
            disabled={listening}
            className="mt-1 flex items-center justify-center gap-2 self-start rounded-lg border border-white/15 px-3 py-2 text-xs disabled:opacity-50"
          >
            <Mic className="h-3.5 w-3.5" /> {listening ? "Listening…" : "Tap to answer"}
          </button>
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
