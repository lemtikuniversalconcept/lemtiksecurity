import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { requireSectionAccess } from "@/lib/rbac";
import { Notice } from "@/components/nw";
import { SharedRecordView } from "@/components/shares/SharedRecordView";
import { acknowledgeSharedRecord, getSharedRecord } from "@/lib/shares.functions";

export const Route = createFileRoute("/app/shared/$id")({
  head: () => ({ meta: [{ title: "Shared record · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    requireSectionAccess(context.appAccess, ["security_manager", "operator", "client_admin"]);
    return { appAccess: context.appAccess };
  },
  component: SharedRecordPage,
});

function SharedRecordPage() {
  const { id } = Route.useParams();
  const viewFn = useServerFn(getSharedRecord);
  const ackFn = useServerFn(acknowledgeSharedRecord);
  const q = useQuery({ queryKey: ["shared-record", id], queryFn: () => viewFn({ data: { id } }), retry: false, refetchOnWindowFocus: false });
  const [err, setErr] = useState<string | null>(null);
  const ack = useMutation({
    mutationFn: (note: string) => ackFn({ data: { id, note: note || undefined } }),
    onSuccess: () => { setErr(null); q.refetch(); },
    onError: (e) => setErr((e as Error).message),
  });
  const v = q.data;
  return (
    <div className="col g12" style={{ maxWidth: 820 }}>
      <Link to="/app/links" className="row g4 t3" style={{ fontSize: 12 }}><ArrowLeft size={13} /> Shared access</Link>
      {q.isLoading ? (
        <span className="row g8 t3"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</span>
      ) : q.error ? (
        <Notice tone="fail">{(q.error as Error).message}</Notice>
      ) : !v || !v.found ? (
        <Notice tone="fail">{v?.reason === "revoked" ? `${v.owner || "The sender"} has withdrawn this share.` : v?.reason === "expired" ? `This share has expired. Contact ${v.owner || "the sender"} if you still need it.` : "This share isn't available."}</Notice>
      ) : (
        <SharedRecordView r={v.record} needName={false} onAck={(_n, note) => ack.mutate(note)} ackBusy={ack.isPending} ackErr={err} />
      )}
    </div>
  );
}
