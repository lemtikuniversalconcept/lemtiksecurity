import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Send, Loader2, Sparkles } from "lucide-react";
import { queryForensicAi } from "@/lib/forensic.functions";
import { useForensicMode } from "@/components/ForensicShell";

export const Route = createFileRoute("/forensic/cases/$id/ai")({
  component: AiPage,
});

type Message = { role: "user" | "assistant"; content: string; sources?: { type: string; id: string; timestamp: string | null }[]; ai?: boolean; model?: string | null; failed?: boolean };

const STARTERS = [
  "Summarise what happened in this case",
  "Who was the first officer on scene?",
  "What autonomous actions were taken and were they approved?",
  "Walk me through the Re-ID timeline",
];

function AiPage() {
  const { id } = Route.useParams();
  const [mode] = useForensicMode();
  const ask = useServerFn(queryForensicAi);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);

  const send = async (query: string) => {
    if (!query.trim() || pending) return;
    setInput("");
    const history = messages.slice(-8).map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content: query }]);
    setPending(true);
    try {
      const result = await ask({ data: { incident_id: id, query, mode, conversation_history: history } });
      setMessages((prev) => [...prev, { role: "assistant", content: result.response, sources: result.sources, ai: !!result.ai_generated, model: result.model }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "The assistant is unavailable right now. Please try again.", failed: true }]);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-[50vh] flex-col gap-3">
      {messages.length === 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm text-[var(--tx-3)]">
            <Sparkles className="h-4 w-4 text-[var(--blue)]" /> Ask about this case — answers are grounded only in this case's own data.
          </div>
          <div className="flex flex-wrap gap-2">
            {STARTERS.map((s) => (
              <button
                key={s}
                onClick={() => void send(s)}
                className="rounded-full border border-[var(--line-2)] bg-[var(--ink-2)] px-3 py-1.5 text-xs text-[var(--tx-1)] hover:border-[var(--blue)]"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-3">
        {messages.map((m, i) => (
          <div key={i} className={`max-w-[75%] rounded-xl px-4 py-2.5 text-sm ${m.role === "user" ? "ml-auto bg-[var(--blue)] text-white" : m.ai ? "ai" : "bg-[var(--ink-2)] text-[var(--tx-1)]"}`}>
            {m.role === "assistant" && !m.failed && (
              <div className={m.ai ? "ai-h" : "text-[11px] text-[var(--tx-3)]"} style={{ marginBottom: 4 }}>
                {m.ai ? <><Sparkles className="h-3 w-3" /> AI answer</> : "Assembled from the case record"}
              </div>
            )}
            <span style={{ whiteSpace: "pre-wrap" }}>{m.content}</span>
            {m.sources && m.sources.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {m.sources.map((s, si) => (
                  <span key={si} className="rounded-md bg-black/25 px-1.5 py-0.5 font-mono text-[10px] text-[var(--tx-3)]">
                    [{s.type}{s.id ? `, ${s.id}` : ""}{s.timestamp ? `, ${new Date(s.timestamp).toLocaleTimeString()}` : ""}]
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {pending && <div className="flex items-center gap-2 text-xs text-[var(--tx-3)]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking… (can take up to 20s on the first message)</div>}
      </div>

      <form
        className="flex items-center gap-2 border-t border-[var(--line-2)] pt-3"
        onSubmit={(e) => { e.preventDefault(); void send(input); }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question about this case…"
          className="flex-1 rounded-full border border-[var(--line-2)] bg-[var(--ink-2)] px-4 py-2.5 text-sm text-[var(--tx-1)] placeholder:text-[var(--tx-3)] focus:border-[var(--blue)] focus:outline-none"
        />
        <button
          type="submit"
          disabled={!input.trim() || pending}
          className="grid h-10 w-10 place-items-center rounded-full bg-[var(--blue)] text-white disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
