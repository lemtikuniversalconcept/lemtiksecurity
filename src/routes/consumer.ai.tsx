import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Send, Loader2 } from "lucide-react";
import { queryConsumerAi } from "@/lib/consumer.functions";
import { getConsumerToken } from "@/lib/consumer-session";

type Message = { role: "user" | "assistant"; content: string };

export const Route = createFileRoute("/consumer/ai")({
  component: AssistantPage,
});

function AssistantPage() {
  const ask = useServerFn(queryConsumerAi);
  const token = getConsumerToken();
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Hi, I'm here to help. Ask me anything about this venue, or how to get assistance." },
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
      setMessages((prev) => [...prev, { role: "assistant", content: "Sorry, I couldn't reach the assistant. Please try again." }]);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-6">
        {messages.map((m, i) => (
          <div key={i} className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${m.role === "user" ? "ml-auto bg-red-600 text-white" : "bg-white/10 text-slate-100"}`}>
            {m.content}
          </div>
        ))}
        {pending && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
          </div>
        )}
      </div>
      <form
        className="flex items-center gap-2 border-t border-white/10 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message…"
          className="flex-1 rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-red-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!input.trim() || pending}
          className="grid h-10 w-10 place-items-center rounded-full bg-red-600 text-white disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
