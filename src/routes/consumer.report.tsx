import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Camera, Mic, Video, CheckCircle2, Loader2, Keyboard, Send } from "lucide-react";
import { GNotice, GUEST_LANGUAGES, useGuestLanguage } from "@/components/guest/kit";
import { createConsumerReport, sendIntakeTurn } from "@/lib/consumer.functions";
import { uploadWithRetry } from "@/lib/consumer-media-queue";
import { getConsumerToken, getCurrentPositionSafe, setLastReportId } from "@/lib/consumer-session";

type TranscriptTurn = { speaker: "ai" | "you"; text: string };
type UploadState = { id: string; label: string; progress: number; done: boolean; failed: boolean };

// Said only after the report has actually reached security.
const OPENING_LINE = "Security has been told. What is happening?";

// speechLang drives the browser's own speech recognition/synthesis (Web Speech API) —
// its actual accuracy for anything but English depends entirely on the guest's browser
// and device, which we cannot verify here; "Type instead" always works regardless of
// language or recognition quality. aiName is what tells the AI which language to reply
// in (rewritten_description sent to operators always stays English regardless).
// Pidgin has no reliable, widely-supported speech-recognition language code of its own —
// it stays on en-NG recognition (Pidgin is English-based, so this degrades reasonably)
// while still getting a Pidgin-language spoken reply.
const LANGUAGES = GUEST_LANGUAGES as readonly { code: string; label: string; speechLang: string; aiName?: string }[];

// Speaking and listening are chained through promises rather than fired independently
// so listening only ever starts once the AI has actually finished talking — starting
// it eagerly let the mic pick up the AI's own voice through the speaker and transcribe
// it as if the guest had spoken, which is what caused the "looping" on phones (a
// laptop's TTS is usually quieter relative to its mic gain, so it was less visible there).
function speak(text: string, speechLang: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      resolve();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.lang = speechLang;
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
  const { language: chosen, choose: setLanguage } = useGuestLanguage();
  const language = chosen.code;
  const [sendState, setSendState] = useState<"sending" | "sent" | "failed">(existingReportId ? "sent" : "sending");
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [assistantError, setAssistantError] = useState(false);
  const [recordingKind, setRecordingKind] = useState<"audio" | "video" | null>(null);
  const languageRef = useRef(language);
  useEffect(() => {
    languageRef.current = language;
  }, [language]);
  const recognitionRef = useRef<any>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunkIndexRef = useRef(0);
  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);

  const currentLanguage = () => LANGUAGES.find((l) => l.code === languageRef.current) || LANGUAGES[0];

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
      recognition.lang = currentLanguage().speechLang;
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
        data: {
          token,
          report_id: reportId,
          transcript: guestText,
          conversation_history: historyRef.current,
          language: currentLanguage().aiName,
        },
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
      await speak(spoken, currentLanguage().speechLang);
      if (result.follow_up_question) {
        const nextAnswer = await listenOnce();
        if (nextAnswer) void runTurn(nextAnswer);
      }
    } catch {
      // Security already has the report; only the assistant failed.
      setAssistantError(true);
      setDangerMode(true);
    } finally {
      setAwaitingReply(false);
    }
  };

  // The three things happening the instant this screen mounts: create the incident,
  // capture GPS (best-effort — an emergency report must never block on location), and
  // start talking to the guest.
  const sendReport = async (isCancelled: () => boolean = () => false) => {
    setSendState("sending");
    try {
      const position = await getCurrentPositionSafe();
      const result = await createReport({ data: { token: token || "", lat: position.lat, lng: position.lng } });
      if (isCancelled()) return;
      setReportId(result.report_id);
      setLastReportId(result.report_id);
      setSendState("sent");
      setSentAt(Date.now());
      setTranscript([{ speaker: "ai", text: OPENING_LINE }]);
      historyRef.current = [{ role: "assistant", content: OPENING_LINE }];
      await speak(OPENING_LINE, currentLanguage().speechLang);
      if (isCancelled()) return;
      const firstAnswer = await listenOnce();
      if (firstAnswer && !isCancelled()) void runTurn(firstAnswer);
    } catch {
      if (!isCancelled()) setSendState("failed");
    }
  };

  // The instant this screen opens: send the alert (location is best effort and never blocks it).
  useEffect(() => {
    if (existingReportId) return;
    let cancelled = false;
    void sendReport(() => cancelled);
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
      setRecordingKind(null);
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
      setRecordingKind(kind);
    } catch {
      addUpload(`${kind}-denied-${Date.now()}`, kind === "audio" ? "Audio (no microphone access)" : "Video (no camera access)");
    }
  };

  const banner =
    sendState === "sending"
      ? { bg: "#FFF6DB", fg: "#7A5A00", title: "Sending your alert…", sub: "Hold on. This takes a few seconds." }
      : sendState === "failed"
        ? { bg: "#FDE8EA", fg: "#9B1C2C", title: "Your alert did not go through", sub: "Try again below. If you can, call the front desk or a staff member now." }
        : { bg: "#D9233A", fg: "#fff", title: "Security has been told", sub: sentAt ? `Alert sent ${new Date(sentAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Your report is open." };

  const media = (kind: "audio" | "video", label: string, Icon: typeof Mic) => (
    <button type="button" className="g-btn" onClick={() => void toggleRecording(kind)} disabled={!reportId} style={{ justifyContent: "center", flexDirection: "column", gap: 4, minHeight: 64, fontSize: 13.5, borderColor: recordingKind === kind ? "#D9233A" : undefined, color: recordingKind === kind ? "#D9233A" : undefined, opacity: reportId ? 1 : 0.5 }}>
      <Icon size={20} /> {recordingKind === kind ? "Stop" : label}
    </button>
  );

  return (
    <div className="col f1">
      <div className="col g4" style={{ background: banner.bg, color: banner.fg, padding: "18px 18px 16px" }}>
        <span className="row g8" style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".08em" }}>
          {sendState === "sending" ? <Loader2 size={14} className="animate-spin" /> : null} EMERGENCY
        </span>
        <b style={{ fontSize: 21, lineHeight: 1.25 }}>{banner.title}</b>
        <span style={{ fontSize: 14, opacity: 0.92 }}>{banner.sub}</span>
        {sendState === "failed" && (
          <button type="button" onClick={() => void sendReport()} style={{ marginTop: 8, height: 48, borderRadius: 12, border: 0, background: "#9B1C2C", color: "#fff", fontWeight: 700, fontSize: 16 }}>
            Try again
          </button>
        )}
      </div>

      <div className="col g10" style={{ padding: "14px 16px 20px", flex: 1 }}>
        <div className="row g6 wrap" role="group" aria-label="Language">
          {LANGUAGES.map((l) => (
            <button key={l.code} type="button" aria-pressed={language === l.code} onClick={() => setLanguage(l.code)} style={{ height: 32, padding: "0 11px", borderRadius: 16, fontSize: 13, fontWeight: 600, border: `1px solid ${language === l.code ? "var(--g-brand)" : "var(--g-line)"}`, background: language === l.code ? "var(--g-brand)" : "#fff", color: language === l.code ? "#fff" : "var(--g-ink)" }}>
              {l.label}
            </button>
          ))}
        </div>

        {dangerMode && (
          <GNotice tone={assistantError ? "warn" : "info"}>
            {assistantError ? "The assistant isn't answering right now, but security already has your alert. You can still add photos, video or audio below, or try typing again." : "Silent mode: type instead of speaking. Replies appear only on screen."}
          </GNotice>
        )}

        <div className="col g8" aria-live="polite">
          {transcript.map((turn, i) => (
            <div key={i} className="bub" style={{ alignSelf: turn.speaker === "you" ? "flex-end" : "flex-start", background: turn.speaker === "you" ? "var(--g-brand)" : "#fff", color: turn.speaker === "you" ? "#fff" : "var(--g-ink)", border: turn.speaker === "you" ? 0 : "1px solid var(--g-line)" }}>
              {turn.text}
            </div>
          ))}
          {awaitingReply && (
            <div className="bub" style={{ background: "#fff", border: "1px solid var(--g-line)", color: "var(--g-tx3)" }}>
              <Loader2 size={14} className="mr-1 inline animate-spin" /> …
            </div>
          )}
        </div>

        {!conversationDone && reportId && !awaitingReply && (
          dangerMode ? (
            <div className="row g8">
              <input value={textInput} onChange={(e) => setTextInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitTyped()} placeholder="Type here" autoFocus aria-label="Type a message" style={{ flex: 1, height: 52, borderRadius: 14, border: "1px solid var(--g-line)", background: "#fff", padding: "0 14px", fontSize: 16, color: "var(--g-ink)" }} />
              <button type="button" onClick={submitTyped} disabled={!textInput.trim()} aria-label="Send" style={{ width: 52, height: 52, borderRadius: 14, border: 0, background: "var(--g-brand)", color: "#fff", display: "grid", placeItems: "center", opacity: textInput.trim() ? 1 : 0.45 }}>
                <Send size={20} />
              </button>
            </div>
          ) : (
            <div className="row g8">
              <button
                type="button"
                className="g-btn"
                onClick={async () => {
                  const text = await listenOnce();
                  if (text) void runTurn(text);
                }}
                disabled={listening}
                style={{ justifyContent: "center" }}
              >
                <Mic size={20} /> {listening ? "Listening… speak normally" : "Tap and speak"}
              </button>
              <button type="button" className="g-btn" onClick={() => setDangerMode(true)} style={{ width: "auto", justifyContent: "center" }}>
                <Keyboard size={20} /> Type
              </button>
            </div>
          )
        )}

        <div className="grid grid-cols-3 gap-2">
          <label className="g-btn" style={{ justifyContent: "center", flexDirection: "column", gap: 4, minHeight: 64, fontSize: 13.5, cursor: reportId ? "pointer" : "not-allowed", opacity: reportId ? 1 : 0.5 }}>
            <Camera size={20} /> Photo
            <input type="file" accept="image/*" capture="environment" className="hidden" disabled={!reportId} onChange={(e) => { const f = e.target.files?.[0]; if (f) void handlePhoto(f); e.target.value = ""; }} />
          </label>
          {media("video", "Video", Video)}
          {media("audio", "Audio", Mic)}
        </div>

        {uploads.length > 0 && (
          <div className="col g6">
            {uploads.map((u) => (
              <div key={u.id} className="row g8" style={{ fontSize: 13.5, color: "var(--g-tx2)" }}>
                <span style={{ width: 120 }} className="trunc">{u.label}</span>
                <div className="f1" style={{ height: 6, borderRadius: 3, background: "var(--g-line)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${u.progress}%`, background: u.failed ? "#C98A00" : "#1E8E50" }} />
                </div>
                {u.failed ? <span>waiting</span> : u.done ? <CheckCircle2 size={16} color="#1E8E50" /> : <Loader2 size={16} className="animate-spin" />}
              </div>
            ))}
          </div>
        )}

        <button type="button" disabled={!reportId} onClick={() => reportId && navigate({ to: "/consumer/status", search: { report_id: reportId } })} style={{ marginTop: "auto", height: 54, borderRadius: 14, border: "1px solid var(--g-line)", background: "#fff", color: "var(--g-ink)", fontSize: 16, fontWeight: 700, opacity: reportId ? 1 : 0.45 }}>
          I'm done for now
        </button>
      </div>
    </div>
  );
}
