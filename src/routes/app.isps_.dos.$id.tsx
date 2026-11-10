import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Copy, Loader2, Printer } from "lucide-react";
import { requireSectionAccess } from "@/lib/rbac";
import { Notice } from "@/components/nw";
import { cancelDeclaration, getDeclaration } from "@/lib/isps.functions";
import { DosDocument } from "@/components/isps/DosDocument";

export const Route = createFileRoute("/app/isps_/dos/$id")({
  head: () => ({ meta: [{ title: "Declaration of Security · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    requireSectionAccess(context.appAccess, ["security_manager", "operator", "client_admin", "security_forensic_analyst"]);
    return { appAccess: context.appAccess };
  },
  component: DosPage,
});

function DosPage() {
  const { id } = Route.useParams();
  const { appAccess } = Route.useRouteContext();
  const fn = useServerFn(getDeclaration);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["dos", id], queryFn: () => fn({ data: { id } }), refetchInterval: (query) => (query.state.data?.status === "awaiting_ship" ? 20_000 : false) });
  const cancelFn = useServerFn(cancelDeclaration);
  const [reason, setReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const cancel = useMutation({ mutationFn: () => cancelFn({ data: { id, reason } }), onSuccess: () => { toast.success("Cancelled. The ship's link no longer works."); qc.invalidateQueries({ queryKey: ["dos", id] }); qc.invalidateQueries({ queryKey: ["isps"] }); setCancelling(false); }, onError: (e: Error) => toast.error(e.message) });

  if (q.isLoading) return <span className="row g8 t3"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</span>;
  if (q.error || !q.data) return <Notice tone="fail">{(q.error as Error)?.message || "Couldn't load this declaration."}</Notice>;
  const d = q.data;
  return (
    <div className="col g16 dos-page" style={{ maxWidth: 820 }}>
      <style>{`@media print { aside, nav, header.app, .no-print { display: none !important; } body, .dos-page { background: #fff !important; color: #000 !important; } .dos-page * { color: #000 !important; background: transparent !important; border-color: #bbb !important; } }`}</style>
      <div className="row g8 wrap no-print">
        <Link to="/app/isps" className="b b-sm b-gh"><ArrowLeft size={14} /> ISPS Watch</Link>
        <span className="f1" />
        <button type="button" className="b b-sm b-pri" onClick={() => window.print()}><Printer size={14} /> Print or save as PDF</button>
      </div>
      {d.sign_url && (
        <div className="no-print">
          <Notice tone="warn">
            Waiting for the ship to sign. Send this link to the master or ship security officer:
            <span className="row g6 wrap" style={{ marginTop: 6 }}><code className="mono" style={{ wordBreak: "break-all" }}>{d.sign_url}</code><button type="button" className="b b-sm b-gh" onClick={() => navigator.clipboard.writeText(d.sign_url!).then(() => toast.success("Link copied."))}><Copy size={13} /> Copy</button></span>
          </Notice>
        </div>
      )}
      <DosDocument d={d} />
      {d.status === "awaiting_ship" && appAccess?.specRole === "security_manager" && (
        <div className="no-print col g6">
          {!cancelling ? <button type="button" className="b b-sm b-gh" style={{ alignSelf: "flex-start" }} onClick={() => setCancelling(true)}>Cancel this declaration</button> : (
            <form className="row g6 wrap" onSubmit={(e) => { e.preventDefault(); cancel.mutate(); }}>
              <input className="in" style={{ minWidth: 260 }} placeholder="Reason (e.g. ship's arrival postponed)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} required />
              <button type="submit" className="b b-sm b-pri" disabled={reason.trim().length < 3 || cancel.isPending}>Cancel declaration</button>
              <button type="button" className="b b-sm b-gh" onClick={() => setCancelling(false)}>Keep</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
