import { createFileRoute, useNavigate, useRouterState, Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Search, Sparkles } from "lucide-react";
import { listIncidents } from "@/lib/incidents.functions";

export const Route = createFileRoute("/forensic/cases")({
  component: CasesRoute,
});

const SEVERITY_COLOR: Record<number, string> = {
  1: "bg-[color-mix(in_oklab,var(--ok)_16%,transparent)] text-[var(--ok)]",
  2: "bg-[color-mix(in_oklab,var(--ok)_16%,transparent)] text-[var(--ok)]",
  3: "bg-[color-mix(in_oklab,var(--warn)_16%,transparent)] text-[var(--warn)]",
  4: "bg-[color-mix(in_oklab,var(--s5)_16%,transparent)] text-[var(--s5)]",
  5: "bg-[color-mix(in_oklab,var(--s5)_16%,transparent)] text-[var(--s5)]",
};

function CasesRoute() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isDetailRoute = pathname.startsWith("/forensic/cases/") && pathname !== "/forensic/cases";
  if (isDetailRoute) return <Outlet />;
  return <CasesList />;
}

const PAGE_SIZE = 25;

function CasesList() {
  const navigate = useNavigate();
  const list = useServerFn(listIncidents);
  const { data: incidents = [], isLoading } = useQuery({ queryKey: ["forensic-cases"], queryFn: () => list() });

  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (incidents as any[]).filter((i) => {
      if (severityFilter && String(i.severity) !== severityFilter) return false;
      if (statusFilter && i.status !== statusFilter) return false;
      if (!q) return true;
      return [i.code, i.type, i.location, i.zone, i.title].some((v) => String(v || "").toLowerCase().includes(q));
    });
  }, [incidents, search, severityFilter, statusFilter]);

  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const statuses = useMemo(() => Array.from(new Set((incidents as any[]).map((i) => i.status))).sort(), [incidents]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-[var(--tx-1)]">Cases</h1>
        <p className="text-sm text-[var(--tx-3)]">Read-only case review. Select a case to open its timeline, evidence, and AI assistant.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--tx-3)]" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search by ID, type, location…"
            className="w-full rounded-lg border border-[var(--line-2)] bg-[var(--ink-2)] py-2 pl-9 pr-3 text-sm text-[var(--tx-1)] placeholder:text-[var(--tx-3)] focus:border-[var(--blue)] focus:outline-none"
          />
        </div>
        <select
          value={severityFilter}
          onChange={(e) => { setSeverityFilter(e.target.value); setPage(0); }}
          className="rounded-lg border border-[var(--line-2)] bg-[var(--ink-2)] px-3 py-2 text-sm text-[var(--tx-1)]"
        >
          <option value="">All severities</option>
          {[1, 2, 3, 4, 5].map((s) => <option key={s} value={s}>Severity {s}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
          className="rounded-lg border border-[var(--line-2)] bg-[var(--ink-2)] px-3 py-2 text-sm text-[var(--tx-1)]"
        >
          <option value="">All statuses</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--line-2)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--ink-1)] text-[10px] uppercase tracking-wider text-[var(--tx-3)]">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Code</th>
              <th className="px-4 py-3 text-left font-medium">Type</th>
              <th className="px-4 py-3 text-left font-medium">Reported</th>
              <th className="px-4 py-3 text-left font-medium">Location</th>
              <th className="px-4 py-3 text-left font-medium">Severity</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Evidence</th>
              <th className="px-4 py-3 text-left font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line-2)] bg-[var(--ink-2)]">
            {pageRows.map((incident: any) => (
              <tr
                key={incident.id}
                onClick={() => navigate({ to: "/forensic/cases/$id", params: { id: incident.id } })}
                className="cursor-pointer hover:bg-white/5"
              >
                <td className="px-4 py-3 font-mono text-xs text-[var(--tx-1)]">{incident.code}</td>
                <td className="px-4 py-3 text-[var(--tx-1)]">{incident.type}</td>
                <td className="px-4 py-3 text-xs text-[var(--tx-3)]">{new Date(incident.reported_at).toLocaleString()}</td>
                <td className="px-4 py-3 text-xs text-[var(--tx-3)]">{[incident.zone, incident.location].filter(Boolean).join(" · ")}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SEVERITY_COLOR[incident.severity] || "bg-white/10 text-[var(--tx-3)]"}`}>
                    {incident.severity}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-[var(--tx-3)]">{incident.status}</td>
                <td className="px-4 py-3 text-xs text-[var(--tx-3)]">{(incident.evidence?.length as number) || 0}</td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate({ to: "/forensic/cases/$id/ai", params: { id: incident.id } });
                    }}
                    className="flex items-center gap-1.5 rounded-full border border-[var(--blue-ln)] bg-[var(--blue-bg)] px-2.5 py-1 text-[11px] font-medium text-[var(--blue)] hover:bg-[var(--blue-bg)]"
                  >
                    <Sparkles className="h-3 w-3" /> Ask AI
                  </button>
                </td>
              </tr>
            ))}
            {!isLoading && pageRows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-[var(--tx-3)]">No cases match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs text-[var(--tx-3)]">
          <span>{filtered.length} cases</span>
          <div className="flex gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded-md border border-[var(--line-2)] px-3 py-1.5 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              disabled={(page + 1) * PAGE_SIZE >= filtered.length}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border border-[var(--line-2)] px-3 py-1.5 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
