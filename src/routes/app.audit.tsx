import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listAuditLog } from "@/lib/audit.functions";
import { useRealtimeInvalidate } from "@/lib/useRealtime";
import { History, Loader2 } from "lucide-react";

export const Route = createFileRoute("/app/audit")({
  head: () => ({ meta: [{ title: "Audit log · Lemtik SOD" }] }),
  component: Audit,
});

const actionTone: Record<string, string> = {
  create: "text-resolved bg-resolved/10 border-resolved/30",
  check_in: "text-primary bg-primary/10 border-primary/30",
  status_change: "text-medium bg-medium/10 border-medium/30",
  assign_role: "text-accent bg-accent/10 border-accent/40",
};

function Audit() {
  const list = useServerFn(listAuditLog);
  useRealtimeInvalidate("audit_log", [["audit_log"]]);
  const { data = [], isLoading, error } = useQuery({ queryKey: ["audit_log"], queryFn: () => list() });

  return (
    <div className="space-y-5">
      <div>
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Compliance</div>
        <h1 className="mt-1 text-2xl font-semibold">Audit trail</h1>
        <p className="text-sm text-muted-foreground">Immutable log of operational actions · visible to managers & supervisors.</p>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading audit log…
        </div>
      ) : error ? (
        <div className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical">
          {(error as Error).message} — only managers and supervisors can view the audit trail.
        </div>
      ) : data.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center">
          <History className="h-6 w-6 text-muted-foreground mx-auto" />
          <div className="mt-3 text-sm font-medium">No activity yet</div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-surface text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Time</th>
                <th className="text-left px-4 py-3 font-medium">Entity</th>
                <th className="text-left px-4 py-3 font-medium">Action</th>
                <th className="text-left px-4 py-3 font-medium">Actor</th>
                <th className="text-left px-4 py-3 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((r) => (
                <tr key={r.id} className="hover:bg-surface/60">
                  <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                    {new Date(r.created_at).toLocaleString("en-GB")}
                  </td>
                  <td className="px-4 py-3 text-xs">{r.entity}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wider ${actionTone[r.action] ?? "border-border bg-surface text-muted-foreground"}`}>
                      {r.action.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[10px] font-mono text-muted-foreground">
                    {r.actor_id ? r.actor_id.slice(0, 8) : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {r.details ? <code className="font-mono text-[10px]">{JSON.stringify(r.details)}</code> : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
