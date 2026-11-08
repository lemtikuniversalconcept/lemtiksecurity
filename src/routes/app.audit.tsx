import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { listOrgAuditLog } from "@/lib/audit.functions";
import { useRealtimeInvalidate } from "@/lib/useRealtime";
import { requireSectionAccess } from "@/lib/rbac";
import { Download, FileJson, FileText, Loader2, Search } from "lucide-react";
import { Empty, Kpi, Notice, PageHeader } from "@/components/nw";

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
  useRealtimeInvalidate("audit_log", [["org-audit-log"]]);
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

  const label = (prefix: string, v: string) => (v === "all" || v === "" ? `${prefix}: all` : v);

  return (
    <div className="col g16">
      <PageHeader title="Audit log" sub="Every action in this organisation, in order. Rows can be added but never edited or deleted.">
        <button type="button" className="b b-sec" onClick={exportCsv} disabled={!filtered.length}>
          <Download className="h-4 w-4" /> CSV
        </button>
        <button type="button" className="b b-gh" onClick={exportJson} disabled={!filtered.length}>
          <FileJson className="h-4 w-4" /> JSON
        </button>
        <button type="button" className="b b-gh" onClick={exportPdf}>
          <FileText className="h-4 w-4" /> Print
        </button>
      </PageHeader>

      <div className="kpis">
        <Kpi label="Rows shown" value={summary.total} unit={rows.length !== summary.total ? `of ${rows.length}` : undefined} />
        <Kpi label="Automated actions" value={summary.autonomous} />
        <Kpi label="Access changes" value={summary.access} />
        <Kpi label="Reports and config" value={summary.report + summary.config} />
      </div>

      <section className="pn">
        <div className="row g8 wrap" style={{ padding: "12px 14px" }}>
          <label className="in row g8" style={{ width: 240 }}>
            <Search className="h-4 w-4 t3" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search details" aria-label="Search details" className="f1" style={{ background: "transparent", border: 0, outline: "none", color: "inherit", minWidth: 0 }} />
          </label>
          <FilterSelect value={userFilter} onChange={setUserFilter} options={users.map((u) => (u === "all" ? "" : u))} render={(v) => label("Person", v)} aria="Person" />
          <FilterSelect value={roleFilter} onChange={setRoleFilter} options={roles} render={(v) => label("Role", v)} aria="Role" />
          <FilterSelect value={actionFilter} onChange={setActionFilter} options={actions} render={(v) => (v === "all" ? "Action: all" : formatAction(v))} aria="Action" />
          <FilterSelect value={resourceFilter} onChange={setResourceFilter} options={resources} render={(v) => label("Resource", v)} aria="Resource" />
          <FilterSelect value={severityFilter} onChange={setSeverityFilter} options={["all", "5", "4", "3", "2", "1"]} render={(v) => (v === "all" ? "Severity: all" : `Severity ${v}`)} aria="Severity" />
          <input type="date" className="in mono" style={{ width: "auto" }} aria-label="From" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <input type="date" className="in mono" style={{ width: "auto" }} aria-label="To" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        {isLoading ? (
          <Empty>
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading audit log…
          </Empty>
        ) : error ? (
          <div className="pn-b">
            <Notice tone="fail">{(error as Error).message}</Notice>
          </div>
        ) : filtered.length === 0 ? (
          <Empty>{rows.length ? "No rows match these filters." : "Nothing has been recorded yet."}</Empty>
        ) : (
          <div className="scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>Resource</th>
                  <th>Details</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row: any) => (
                  <tr key={row.id} style={{ verticalAlign: "top" }}>
                    <td className="mono t2" style={{ whiteSpace: "nowrap", fontSize: 12 }}>
                      {new Date(row.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </td>
                    <td>
                      <div className="col">
                        <b>{row.user_name ?? "System"}</b>
                        <span className="t3" style={{ fontSize: 11.5 }}>
                          {row.role ?? (row.actor_id ? "" : "automated")}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="col g4">
                        <span>{formatAction(row.action)}</span>
                        <span className="row g4 wrap">
                          {(row.flags ?? []).map((f: string) => (
                            <span key={f} className={`tg${f === "autonomous" ? " tg-ai" : f === "access" ? " tg-warn" : ""}`}>
                              {FLAG_LABEL[f] ?? f}
                            </span>
                          ))}
                          {Number(row.severity) >= 4 && <span className="tg tg-fail">Severity {row.severity}</span>}
                        </span>
                      </div>
                    </td>
                    <td className="mono t2" style={{ fontSize: 12 }}>
                      {row.resource}
                    </td>
                    <td style={{ maxWidth: 420 }}>
                      <details>
                        <summary className="t2" style={{ cursor: "pointer", fontSize: 12 }}>
                          {summariseDetails(row.details)}
                        </summary>
                        <pre className="mono t2" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 11, margin: "6px 0 0" }}>
                          {JSON.stringify(row.details ?? {}, null, 2)}
                        </pre>
                      </details>
                    </td>
                    <td className="mono t3" style={{ fontSize: 12 }}>
                      {row.ip_address ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

const FLAG_LABEL: Record<string, string> = { autonomous: "Automated", access: "Access", report: "Report", config: "Config" };

function summariseDetails(details: unknown) {
  if (!details || typeof details !== "object") return "No details";
  const keys = Object.keys(details as Record<string, unknown>);
  if (!keys.length) return "No details";
  return keys.slice(0, 3).join(", ") + (keys.length > 3 ? ` +${keys.length - 3}` : "");
}

function FilterSelect({ value, onChange, options, render, aria }: { value: string; onChange: (v: string) => void; options: string[]; render: (v: string) => string; aria: string }) {
  return (
    <select className="in" style={{ width: "auto", maxWidth: 220 }} value={value} onChange={(e) => onChange(e.target.value)} aria-label={aria}>
      {options.map((o) => (
        <option key={o || "all"} value={o}>
          {render(o)}
        </option>
      ))}
    </select>
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

