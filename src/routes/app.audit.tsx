import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { listOrgAuditLog } from "@/lib/audit.functions";
import { useRealtimeInvalidate } from "@/lib/useRealtime";
import { requireSectionAccess } from "@/lib/rbac";
import {
  Activity,
  BadgeAlert,
  Download,
  FileJson,
  FileText,
  Filter,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Users,
  UserCog,
  Settings2,
} from "lucide-react";

export const Route = createFileRoute("/app/audit")({
  head: () => ({ meta: [{ title: "Audit log · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    requireSectionAccess(context.appAccess, [
      "security_manager",
      "client_admin",
    ]);
  },
  component: Audit,
});

function Audit() {
  const load = useServerFn(listOrgAuditLog);
  useRealtimeInvalidate("audit_log", [["audit_log"]]);
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["org-audit-log"],
    queryFn: () => load(),
  });

  const [userFilter, setUserFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [resourceFilter, setResourceFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");

  const rows = useMemo(() => data as any[], [data]);
  const users = useMemo(() => ["all", ...new Set(rows.map((r) => r.user_name).filter(Boolean))], [rows]);
  const roles = useMemo(() => ["all", ...new Set(rows.map((r) => r.role).filter(Boolean))], [rows]);
  const actions = useMemo(() => ["all", ...new Set(rows.map((r) => r.action).filter(Boolean))], [rows]);
  const resources = useMemo(() => ["all", ...new Set(rows.map((r) => r.entity).filter(Boolean))], [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const ts = new Date(row.created_at).getTime();
      const matchesUser = userFilter === "" || row.user_name === userFilter;
      const matchesRole = roleFilter === "all" || row.role === roleFilter;
      const matchesAction = actionFilter === "all" || row.action === actionFilter;
      const matchesResource = resourceFilter === "all" || row.entity === resourceFilter;
      const matchesSeverity = severityFilter === "all" || String(row.severity ?? "") === severityFilter;
      const after = !dateFrom || ts >= new Date(dateFrom).getTime();
      const before = !dateTo || ts <= new Date(dateTo).getTime() + 86_399_999;
      const matchesSearch = !q || String(row.search_text ?? "").includes(q);
      return matchesUser && matchesRole && matchesAction && matchesResource && matchesSeverity && after && before && matchesSearch;
    });
  }, [rows, userFilter, roleFilter, actionFilter, resourceFilter, severityFilter, dateFrom, dateTo, search]);

  const summary = useMemo(() => {
    const total = filtered.length;
    const byFlag = {
      autonomous: filtered.filter((r) => (r.flags ?? []).includes("autonomous")).length,
      access: filtered.filter((r) => (r.flags ?? []).includes("access")).length,
      report: filtered.filter((r) => (r.flags ?? []).includes("report")).length,
      config: filtered.filter((r) => (r.flags ?? []).includes("config")).length,
    };
    return { total, ...byFlag };
  }, [filtered]);

  const csv = useMemo(() => {
    const header = ["Timestamp", "User", "Role", "Action type", "Resource affected", "Details", "IP address"];
    const body = filtered.map((row) => [
      row.created_at,
      row.user_name,
      row.role,
      row.action,
      row.resource,
      JSON.stringify(row.details ?? {}),
      row.ip_address ?? "",
    ]);
    return [header, ...body].map((line) => line.map(csvCell).join(",")).join("\n");
  }, [filtered]);

  const exportJson = () => download("audit-log.json", "application/json", JSON.stringify(filtered, null, 2));
  const exportCsv = () => download("audit-log.csv", "text/csv;charset=utf-8", csv);
  const exportPdf = () => {
    if (typeof window !== "undefined") window.print();
  };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-white/10 bg-white/5 p-5 print:border-0 print:bg-transparent">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Organisation audit</div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Immutable audit log</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-300">
              Read-only organisation history. Every row is append-only and includes user, role, action type, affected resource, details, and IP address where available.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <button onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs hover:bg-surface-2">
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
            <button onClick={exportJson} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs hover:bg-surface-2">
              <FileJson className="h-3.5 w-3.5" /> JSON
            </button>
            <button onClick={exportPdf} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs hover:bg-surface-2">
              <FileText className="h-3.5 w-3.5" /> PDF
            </button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <Metric label="Rows visible" value={summary.total.toString()} icon={Activity} />
        <Metric label="Autonomous" value={summary.autonomous.toString()} icon={ShieldAlert} tone="critical" />
        <Metric label="Access control" value={summary.access.toString()} icon={UserCog} tone="warn" />
        <Metric label="Reports/config" value={(summary.report + summary.config).toString()} icon={ShieldCheck} tone="good" />
      </div>

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Filters</div>
            <h2 className="text-lg font-semibold">User, role, action, resource, severity, date, search</h2>
          </div>
          <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Filter className="h-3.5 w-3.5" /> Search is full text over the audit payload
          </div>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-4">
          <Select value={userFilter} onChange={setUserFilter} options={users} />
          <Select value={roleFilter} onChange={setRoleFilter} options={roles} />
          <Select value={actionFilter} onChange={setActionFilter} options={actions} />
          <Select value={resourceFilter} onChange={setResourceFilter} options={resources} />
          <Select value={severityFilter} onChange={setSeverityFilter} options={["all", "5", "4", "3", "2", "1"]} />
          <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search details" className="bg-transparent text-sm outline-none" />
          </div>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-md border border-border bg-surface px-3 py-2 text-sm" />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-md border border-border bg-surface px-3 py-2 text-sm" />
        </div>
      </section>

      {isLoading ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading audit log…
        </div>
      ) : error ? (
        <div className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical">
          {(error as Error).message}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-surface text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <Th>Timestamp</Th>
                <Th>User</Th>
                <Th>Role</Th>
                <Th>Action type</Th>
                <Th>Resource affected</Th>
                <Th>Details</Th>
                <Th>IP address</Th>
                <Th>Flags</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((row: any) => (
                <tr key={row.id} className="hover:bg-surface/60">
                  <Td>{new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(row.created_at))}</Td>
                  <Td>
                    <div className="font-medium">{row.user_name}</div>
                    <div className="text-[10px] text-muted-foreground">{row.actor_id ? row.actor_id.slice(0, 8) : "system"}</div>
                  </Td>
                  <Td className="text-xs uppercase tracking-wider text-muted-foreground">{row.role}</Td>
                  <Td>
                    <div className="font-medium">{formatAction(row.action)}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Severity {row.severity ?? 1}</div>
                  </Td>
                  <Td className="font-mono text-xs">{row.resource}</Td>
                  <Td className="max-w-[26rem] text-xs text-muted-foreground">
                    <pre className="whitespace-pre-wrap break-words font-mono text-[10px] leading-5">{JSON.stringify(row.details ?? {}, null, 2)}</pre>
                  </Td>
                  <Td className="font-mono text-xs text-muted-foreground">{row.ip_address ?? "—"}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1.5">
                      {(row.flags ?? []).length === 0 ? (
                        <span className="text-[10px] text-muted-foreground">None</span>
                      ) : row.flags.map((flag: string) => <FlagBadge key={flag} flag={flag} />)}
                    </div>
                  </Td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <Td colSpan={8}>
                    <div className="py-10 text-center text-sm text-muted-foreground">
                      No audit rows matched the current filters.
                    </div>
                  </Td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground print:hidden">
        <div className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 h-4 w-4 text-critical" />
          <div>
            <div className="font-medium text-foreground">Append-only guarantee</div>
            <div>No edit or delete actions are exposed here. Rows are read from the live audit table and filtered client-side only.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatAction(action: string) {
  return action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function csvCell(value: unknown) {
  const s = String(value ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

function download(name: string, type: string, body: string) {
  const blob = new Blob([body], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
      {options.map((opt) => (
        <option key={opt} value={opt}>{opt}</option>
      ))}
    </select>
  );
}

function FlagBadge({ flag }: { flag: string }) {
  const meta =
    flag === "autonomous"
      ? { label: "Autonomous", tone: "critical" as const, icon: ShieldAlert }
      : flag === "access"
        ? { label: "Access control", tone: "warn" as const, icon: UserCog }
        : flag === "report"
          ? { label: "Report downloaded", tone: "good" as const, icon: FileText }
          : { label: "Config changed", tone: "neutral" as const, icon: Settings2 };
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wider ${
      meta.tone === "critical"
        ? "border-critical/30 bg-critical/10 text-critical"
        : meta.tone === "warn"
          ? "border-high/30 bg-high/10 text-high"
          : meta.tone === "good"
            ? "border-resolved/30 bg-resolved/10 text-resolved"
            : "border-border bg-surface text-muted-foreground"
    }`}>
      <meta.icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

function Metric({ label, value, icon: Icon, tone = "neutral" }: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "neutral" | "good" | "warn" | "critical";
}) {
  const toneClass =
    tone === "good"
      ? "text-resolved bg-resolved/10 border-resolved/30"
      : tone === "warn"
        ? "text-high bg-high/10 border-high/30"
        : tone === "critical"
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

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 text-left font-medium">{children}</th>;
}

function Td({ children, colSpan }: { children: React.ReactNode; colSpan?: number }) {
  return <td colSpan={colSpan} className="px-4 py-3 align-top">{children}</td>;
}
