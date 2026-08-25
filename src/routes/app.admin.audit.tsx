import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { listPlatformAuditLog } from "@/lib/platform.audit.functions";
import { requireSectionAccess } from "@/lib/rbac";
import { Download, FileJson, Loader2, Search, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/app/admin/audit")({
  head: () => ({ meta: [{ title: "Platform audit · Lemtik Admin" }] }),
  beforeLoad: async ({ context }) => {
    const access = context.appAccess;
    requireSectionAccess(access, ["lemtik_admin"]);
    return { appAccess: access };
  },
  component: PlatformAudit,
});

function PlatformAudit() {
  const loadAudit = useServerFn(listPlatformAuditLog);
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["platform-audit-log"],
    queryFn: () => loadAudit(),
  });
  const [org, setOrg] = useState("all");
  const [user, setUser] = useState("");
  const [action, setAction] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const orgs = useMemo(() => ["all", ...new Set(data.map((r: any) => r.org_name))], [data]);
  const actions = useMemo(() => ["all", ...new Set(data.map((r: any) => r.action))], [data]);
  const users = useMemo(() => [...new Set(data.map((r: any) => r.user_name))], [data]);

  const filtered = useMemo(() => {
    return data.filter((r: any) => {
      const matchesOrg = org === "all" || r.org_name === org;
      const matchesUser = !user || r.user_name.toLowerCase().includes(user.toLowerCase());
      const matchesAction = action === "all" || r.action === action;
      const ts = new Date(r.created_at).getTime();
      const afterFrom = !dateFrom || ts >= new Date(dateFrom).getTime();
      const beforeTo = !dateTo || ts <= new Date(dateTo).getTime() + 86_399_999;
      return matchesOrg && matchesUser && matchesAction && afterFrom && beforeTo;
    });
  }, [data, org, user, action, dateFrom, dateTo]);

  const csv = useMemo(() => {
    const header = ["Timestamp", "Org", "User", "Action", "Resource", "IP address"];
    const rows = filtered.map((r: any) => [
      r.created_at,
      r.org_name,
      r.user_name,
      r.action,
      r.resource,
      r.ip_address ?? "",
    ]);
    return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  }, [filtered]);

  const download = (name: string, type: string, body: string) => {
    const blob = new Blob([body], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-white/10 bg-white/5 p-5">
        <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Admin Console</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Platform audit log</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-300">
          Complete immutable platform action log. Entries are append-only through the existing audit table and exported directly from live records.
        </p>
      </section>

      <div className="rounded-3xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Filters</div>
            <h2 className="text-lg font-semibold">Organisation, user, action, date range</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => download("platform-audit.csv", "text/csv;charset=utf-8", csv)} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs hover:bg-surface-2">
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
            <button onClick={() => download("platform-audit.json", "application/json", JSON.stringify(filtered, null, 2))} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs hover:bg-surface-2">
              <FileJson className="h-3.5 w-3.5" /> JSON
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-4">
          <Select value={org} onChange={setOrg} options={orgs} />
          <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="Filter by user" className="bg-transparent text-sm outline-none" />
          </div>
          <Select value={action} onChange={setAction} options={actions} />
          <div className="grid grid-cols-2 gap-2">
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-md border border-border bg-surface px-3 py-2 text-sm" />
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-md border border-border bg-surface px-3 py-2 text-sm" />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-3xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading platform audit log…
        </div>
      ) : error ? (
        <div className="rounded-md border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical">{(error as Error).message}</div>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-border bg-card">
          <table className="min-w-full text-sm">
            <thead className="bg-surface text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              <tr>
                <Th>Timestamp</Th>
                <Th>Org</Th>
                <Th>User</Th>
                <Th>Action</Th>
                <Th>Resource</Th>
                <Th>IP address</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((row: any) => (
                <tr key={row.id}>
                  <Td>{new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(row.created_at))}</Td>
                  <Td>{row.org_name}</Td>
                  <Td>{row.user_name}</Td>
                  <Td>{row.action}</Td>
                  <Td className="font-mono text-xs">{row.resource}</Td>
                  <Td className="font-mono text-xs text-muted-foreground">{row.ip_address ?? "—"}</Td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <Td colSpan={6}>
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

      <div className="rounded-3xl border border-border bg-card p-5 text-sm text-muted-foreground">
        <div className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 h-4 w-4 text-critical" />
          <div>
            <div className="font-medium text-foreground">Append-only guarantee</div>
            <div>The platform audit log is read-only in the UI and backed by the existing append-only audit table. No edit or delete actions are exposed here.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function csvCell(value: unknown) {
  const s = String(value ?? "");
  return `"${s.replace(/"/g, '""')}"`;
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

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 text-left font-medium">{children}</th>;
}

function Td({ children, colSpan }: { children: React.ReactNode; colSpan?: number }) {
  return <td colSpan={colSpan} className="px-4 py-3">{children}</td>;
}
