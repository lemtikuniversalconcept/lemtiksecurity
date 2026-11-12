import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { LemtikMark, Notice } from "@/components/nw";
import { SharedRecordView } from "@/components/shares/SharedRecordView";
import { acknowledgeShareByToken, getShareByToken } from "@/lib/shares.functions";

/** A record shared through a link. No account needed; the link expires and can be withdrawn. */
export const Route = createFileRoute("/shared/$token")({
  head: () => ({ meta: [{ title: "Shared record · Lemtik" }, { name: "robots", content: "noindex" }, { name: "referrer", content: "no-referrer" }] }),
  component: SharedLinkPage,
});

function SharedLinkPage() {
  const { token } = Route.useParams();
  const viewFn = useServerFn(getShareByToken);
  const ackFn = useServerFn(acknowledgeShareByToken);
  const q = useQuery({ queryKey: ["shared-link", token], queryFn: () => viewFn({ data: { token } }), retry: false, refetchOnWindowFocus: false });
  const [err, setErr] = useState<string | null>(null);
  const ack = useMutation({
    mutationFn: (v: { name: string; note: string }) => ackFn({ data: { token, by_name: v.name, note: v.note || undefined } }),
    onSuccess: () => { setErr(null); q.refetch(); },
    onError: (e) => setErr((e as Error).message),
  });
  const v = q.data;
  return (
    <main style={{ minHeight: "100vh", background: "var(--bg, #0A0C10)", padding: "20px 16px" }}>
      <div className="col g16" style={{ maxWidth: 760, margin: "0 auto" }}>
        <div className="row g8" style={{ alignItems: "center" }}><LemtikMark /><span className="t3" style={{ fontSize: 12 }}>Shared record</span></div>
        {q.isLoading ? (
          <span className="row g8 t3"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</span>
        ) : !v || !v.found ? (
          <Notice tone="fail">
            {v?.reason === "revoked" ? `${v.owner || "The sender"} has withdrawn this link.` : v?.reason === "expired" ? `This link has expired. Contact ${v.owner || "the sender"} if you still need it.` : v?.reason === "pending" ? "This link isn't live yet. It's waiting for approval." : "This link isn't valid."}
          </Notice>
        ) : (
          <SharedRecordView r={v.record} needName onAck={(name, note) => (name.length < 2 ? setErr("Enter your name and unit first.") : ack.mutate({ name, note }))} ackBusy={ack.isPending} ackErr={err} />
        )}
      </div>
    </main>
  );
}
