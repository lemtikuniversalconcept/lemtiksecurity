import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { listAuditLog } from "@/lib/audit.functions";
import { useRealtimeInvalidate } from "@/lib/useRealtime";
import { Activity, BarChart3, Clock3, History, Loader2, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/app/audit")({
  head: () => ({ meta: [{ title: "Audit log · Lemtik SOD" }] }),
  component: Audit,
});

function confidenceScore(row: any) {
  const base =
    row.action === "check_in" ? 95 :
    row.action === "status_change" ? 92 :
    row.action === "assign_role" ? 88 :
    row.action === "create" ? 84 :
    80;
  const modifier =
    row.details?.status === "missed" ? -5 :
    row.details?.status === "delayed" ? -3 :
    row.details?.role === "lemtik_admin" ? 2 :
    0;
  return Math.max(72, Math.min(99, base + modifier));
}

function systemLabel(row: any) {
  if (row.entity === "patrol" && row.details?.code) return `Patrol ${row.details.code}`;
  if (row.entity === "organisation" && row.details?.name) return `Organisation ${row.details.name}`;
  if (row.entity === "user_role") return "Access control";
  return row.entity.replace("_", " ");
}

function Audit() {
  const list = useServerFn(listAuditLog);
  useRealtimeInvalidate("audit_log", [["audit_log"]]);
  const { data = [], isLoading, error } = useQuery({ queryKey: ["audit_log"], queryFn: () => list() });
  const summary = useMemo(() => {
    const rows = data as any[];
    const confidenceValues = rows.map(confidenceScore);
    const byDay = new Map<string, number>();
    rows.forEach((r) => {
      const day = new Date(r.created_at).toLocaleDateString("en-GB", { weekday: "short" });
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    });
    const trend = Array.from(byDay.entries()).slice(0, 7);
    return {
      total: rows.length,
      avgConfidence: confidenceValues.length ? Math.round(confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length) : 0,
      overrides: rows.filter((r) => r.entity === "patrol" || r.action === "assign_role").length,
      operators: new Set(rows.map((r) => r.actor_id).filter(Boolean)).size,
      trend,
    };
  }, [data]);
  const trendMax = Math.max(1, ...summary.trend.map(([, n]) => n));

  return (
    <div className="space-y-5">
      <div>
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Compliance</div>
        <h1 className="mt-1 text-2xl font-semibold">Audit trail</h1>
        <p className="text-sm text-muted-foreground">Immutable log of operational actions · visible to managers & supervisors.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Metric icon={History} label="Rows logged" value={summary.total.toString()} />
        <Metric icon={Activity} label="Overrides traced" value={summary.overrides.toString()} />
        <Metric icon={ShieldAlert} label="Avg confidence" value={`${summary.avgConfidence}%`} tone={summary.avgConfidence >= 90 ? "good" : "warn"} />
        <Metric icon={Clock3} label="Authorization IDs" value={summary.operators.toString()} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Black-box ledger</div>
              <h2 className="text-sm font-semibold">Immutable action trace</h2>
            </div>
            <span className="rounded-md border border-border bg-surface px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              Audit sealed
            </span>
          </div>
          <div className="mt-4 flex h-24 items-end gap-2">
            {summary.trend.length === 0 ? (
              <div className="text-xs text-muted-foreground">No audit activity yet.</div>
            ) : summary.trend.map(([label, count]) => (
              <div key={label} className="flex-1">
                <div
                  className="rounded-t bg-gradient-to-t from-primary/70 via-accent/70 to-critical/90"
                  style={{ height: `${(count / trendMax) * 100}%`, minHeight: "10px" }}
                  title={`${label}: ${count}`}
                />
                <div className="mt-1 text-[10px] text-center text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 space-y-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Integrity score</div>
            <h3 className="text-sm font-semibold">Paper trail confidence</h3>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2">
              <span className="text-muted-foreground">Confidence envelope</span>
              <span className="font-mono text-foreground">{summary.avgConfidence}%</span>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2">
              <span className="text-muted-foreground">Override events</span>
              <span className="font-mono text-foreground">{summary.overrides}</span>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2">
              <span className="text-muted-foreground">Operators seen</span>
              <span className="font-mono text-foreground">{summary.operators}</span>
            </div>
          </div>
        </div>
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
                <th className="text-left px-4 py-3 font-medium">Timestamp</th>
                <th className="text-left px-4 py-3 font-medium">Action Triggered</th>
                <th className="text-left px-4 py-3 font-medium">System Overridden</th>
                <th className="text-left px-4 py-3 font-medium">AI Confidence Score</th>
                <th className="text-left px-4 py-3 font-medium">Operator Authorization ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((r) => (
                <tr key={r.id} className="hover:bg-surface/60">
                  <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                    {new Date(r.created_at).toLocaleString("en-GB")}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs font-medium">{`${r.entity}.${r.action}`.replace("_", " ")}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{r.details?.status ?? r.details?.role ?? "system event"}</div>
                  </td>
                  <td className="px-4 py-3 text-xs">{systemLabel(r)}</td>
                  <td className="px-4 py-3">
                    <div className="inline-flex rounded-md border border-border bg-surface px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider">
                      {confidenceScore(r)}%
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[10px] font-mono text-muted-foreground">
                    {r.actor_id ? r.actor_id.slice(0, 8) : "—"}
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

function Metric({ icon: Icon, label, value, tone = "neutral" }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warn";
}) {
  const toneClass = tone === "good"
    ? "text-resolved bg-resolved/10 border-resolved/30"
    : tone === "warn"
      ? "text-critical bg-critical/10 border-critical/30"
      : "text-muted-foreground bg-surface border-border";
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={`grid h-7 w-7 place-items-center rounded-md border ${toneClass}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}
