import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { requireSectionAccess } from "@/lib/rbac";
import { Notice } from "@/components/nw";
import { HandoffBody } from "@/components/responder/HandoffBody";
import { getBoardHandoff, postBoardUpdate } from "@/lib/responder-board.functions";
import type { RESPONDER_STATUS } from "@/lib/respond.functions";

export const Route = createFileRoute("/app/responder_/$id")({
  head: () => ({ meta: [{ title: "Hand-off · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    requireSectionAccess(context.appAccess, ["security_manager", "operator", "client_admin"]);
    return { appAccess: context.appAccess };
  },
  component: HandoffPage,
});

function HandoffPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const viewFn = useServerFn(getBoardHandoff);
  const postFn = useServerFn(postBoardUpdate);
  const q = useQuery({ queryKey: ["board-handoff", id], queryFn: () => viewFn({ data: { id } }), refetchInterval: 20_000, retry: false });
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const post = useMutation({
    mutationFn: (status: (typeof RESPONDER_STATUS)[number] | "note") => postFn({ data: { id, status, note: status === "note" ? note.trim() : undefined } }),
    onSuccess: (_r, status) => {
      setErr(null);
      if (status === "note") setNote("");
      q.refetch();
      qc.invalidateQueries({ queryKey: ["responder-board"] });
    },
    onError: (e) => setErr((e as Error).message),
  });
  const v = q.data?.view;
  return (
    <div className="col g16" style={{ maxWidth: 820 }}>
      <Link to="/app/responder" className="row g4 t3" style={{ fontSize: 12 }}><ArrowLeft size={13} /> Responder board</Link>
      {q.isLoading ? (
        <span className="row g8 t3"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</span>
      ) : q.error ? (
        <Notice tone="fail">{(q.error as Error).message}</Notice>
      ) : !v || !v.found ? (
        <Notice tone="fail">{v?.reason === "withdrawn" ? `${v.operator || "The operator"} has withdrawn this hand-off.` : v?.reason === "expired" ? `This hand-off has expired. Contact ${v.operator || "the operator"} for an update.` : "This hand-off isn't available."}</Notice>
      ) : !q.data?.can_act ? (
        <>
          <Notice tone="blue">You can view this hand-off. Managers and operators confirm receipt and report progress.</Notice>
          <HandoffBody v={v} name="" setName={() => {}} note="" setNote={() => {}} post={() => {}} busy err={null} askName={false} footer={null} />
        </>
      ) : (
        <HandoffBody
          v={v}
          name=""
          setName={() => {}}
          note={note}
          setNote={setNote}
          post={(s) => post.mutate(s)}
          busy={post.isPending}
          err={err}
          askName={false}
          footer={<p className="t3" style={{ fontSize: 12 }}>Refreshes every 20 seconds. Each update is sent to {v.operator} with your name and organisation, and recorded on both sides.</p>}
        />
      )}
    </div>
  );
}
