import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Send, Loader2 } from "lucide-react";
import { queryConsumerAi } from "@/lib/consumer.functions";
import { getConsumerToken } from "@/lib/consumer-session";
import { OrgBadge } from "@/components/guest/kit";

type Message = { role: "user" | "assistant"; content: string };

export const Route = createFileRoute("/consumer/ai")({
  component: AssistantPage,
});

function AssistantPage() {
  const ask = useServerFn(queryConsumerAi);
  const token = getConsumerToken();
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Hello. Ask me about this property or how to get help. If you're in danger, press SOS at the top." },
  ]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);

  const send = async () => {
    const query = input.trim();
    if (!query || !token || pending) return;
    setInput("");
    const history = messages.slice(-8);
    setMessages((prev) => [...prev, { role: "user", content: query }]);
    setPending(true);
    try {
      const result = await ask({ data: { token, query, conversation_history: history } });
      setMessages((prev) => [...prev, { role: "assistant", content: result.response }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "The assistant isn't reachable right now. Please try again, or press SOS if you need help urgently." }]);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="col f1">
      <OrgBadge
        right={
          <Link to="/consumer/home" style={{ height: 36, padding: "0 14px", borderRadius: 18, background: "#D9233A", color: "#fff", fontWeight: 700, fontSize: 14, display: "inline-flex", alignItems: "center" }}>
            SOS
          </Link>
        }
      />
      <div className="col g8 f1" style={{ padding: "4px 16px 12px", overflowY: "auto" }} aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className="bub" style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", background: m.role === "user" ? "var(--g-brand)" : "#fff", color: m.role === "user" ? "#fff" : "var(--g-ink)", border: m.role === "user" ? 0 : "1px solid var(--g-line)", whiteSpace: "pre-wrap" }}>
            {m.content}
          </div>
        ))}
        {pending && (
          <div className="bub" style={{ background: "#fff", border: "1px solid var(--g-line)", color: "var(--g-tx3)" }}>
            <Loader2 size={14} className="mr-1 inline animate-spin" /> Thinking… the first reply can take up to 20 seconds
          </div>
        )}
      </div>
      <p style={{ margin: "0 16px 8px", fontSize: 12.5, color: "var(--g-tx3)" }}>An AI assistant answers here. For an emergency, use SOS.</p>
      <form
        className="row g8"
        style={{ padding: "8px 16px 16px", borderTop: "1px solid var(--g-line)", background: "var(--g-bg)" }}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type a message" aria-label="Type a message" style={{ flex: 1, height: 52, borderRadius: 14, border: "1px solid var(--g-line)", background: "#fff", padding: "0 14px", fontSize: 16, color: "var(--g-ink)" }} />
        <button type="submit" disabled={!input.trim() || pending} aria-label="Send" style={{ width: 52, height: 52, borderRadius: 14, border: 0, background: "var(--g-brand)", color: "#fff", display: "grid", placeItems: "center", opacity: !input.trim() || pending ? 0.45 : 1 }}>
          <Send size={20} />
        </button>
      </form>
    </div>
  );
}
