import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { LemtikMark, Notice } from "@/components/nw";
import { HandoffBody } from "@/components/responder/HandoffBody";
import { getResponderView, postResponderUpdate, RESPONDER_STATUS } from "@/lib/respond.functions";

/** Responder page: opened from the hand-off message. No account needed; the link expires and can be withdrawn. */
export const Route = createFileRoute("/respond/$token")({
  head: () => ({ meta: [{ title: "Emergency hand-off · Lemtik" }, { name: "robots", content: "noindex" }, { name: "theme-color", content: "#0A0C10" }] }),
  component: RespondPage,
});

const NAME_KEY = "lemtik.respond.name";

function RespondPage() {
  const { token } = Route.useParams();
  const viewFn = useServerFn(getResponderView);
  const postFn = useServerFn(postResponderUpdate);
  const q = useQuery({ queryKey: ["respond", token], queryFn: () => viewFn({ data: { token } }), refetchInterval: 20_000, retry: false });
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    try { setName(localStorage.getItem(NAME_KEY) ?? ""); } catch { /* storage unavailable */ }
  }, []);
  const saveName = (v: string) => {
    setName(v);
    try { localStorage.setItem(NAME_KEY, v); } catch { /* storage unavailable */ }
  };
  const post = useMutation({
    mutationFn: (status: (typeof RESPONDER_STATUS)[number] | "note") => postFn({ data: { token, status, by_name: name.trim(), note: status === "note" ? note.trim() : undefined } }),
    onSuccess: (_r, status) => {
      setErr(null);
      if (status === "note") setNote("");
      q.refetch();
    },
    onError: (e) => setErr((e as Error).message),
  });

  const v = q.data;
  return (
    <main style={{ minHeight: "100vh", background: "var(--bg, #0A0C10)", padding: "20px 16px" }}>
      <div className="col g16" style={{ maxWidth: 720, margin: "0 auto" }}>
        <div className="row g8" style={{ alignItems: "center" }}><LemtikMark /><span className="t3" style={{ fontSize: 12 }}>Emergency hand-off</span></div>
        {q.isLoading ? (
          <span className="row g8 t3"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</span>
        ) : !v || !v.found ? (
          <Notice tone="fail">
            {v?.reason === "withdrawn" ? `${v.operator || "The operator"} has withdrawn this link.` : v?.reason === "expired" ? `This link has expired. Contact ${v.operator || "the operator"} for an update.` : "This link isn't valid."}
          </Notice>
        ) : (
          <HandoffBody v={v} name={name} setName={saveName} note={note} setNote={setNote} post={(s) => { if (name.trim().length < 2) { setErr("Enter your name and unit first."); return; } post.mutate(s); }} busy={post.isPending} err={err} />
        )}
      </div>
    </main>
  );
}

