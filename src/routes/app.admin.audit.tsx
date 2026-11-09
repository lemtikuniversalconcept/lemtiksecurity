import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { listPlatformAuditLog } from "@/lib/platform.audit.functions";
import { requireSectionAccess } from "@/lib/rbac";
import { Download, FileJson, Loader2, Search } from "lucide-react";
import { Empty, Notice, PageHeader } from "@/components/nw";

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
    <div className="col g16">
      <PageHeader title="Platform audit log" sub="Every platform action across organisations. Rows can be added but never edited or deleted.">
        <button type="button" className="b b-sec" onClick={() => download("platform-audit.csv", "text/csv;charset=utf-8", csv)} disabled={!filtered.length}>
          <Download className="h-4 w-4" /> CSV
        </button>
        <button type="button" className="b b-gh" onClick={() => download("platform-audit.json", "application/json", JSON.stringify(filtered, null, 2))} disabled={!filtered.length}>
          <FileJson className="h-4 w-4" /> JSON
        </button>
      </PageHeader>

      <section className="pn">
        <div className="row g8 wrap" style={{ padding: "12px 14px" }}>
          <select className="in" style={{ width: "auto", maxWidth: 240 }} value={org} onChange={(e) => setOrg(e.target.value)} aria-label="Organisation">
            {orgs.map((o) => (
              <option key={o} value={o}>
                {o === "all" ? "Organisation: all" : o}
              </option>
            ))}
          </select>
          <label className="in row g8" style={{ width: 220 }}>
            <Search className="h-4 w-4 t3" />
            <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="Filter by person" aria-label="Filter by person" className="f1" style={{ background: "transparent", border: 0, outline: "none", color: "inherit", minWidth: 0 }} />
          </label>
          <select className="in" style={{ width: "auto", maxWidth: 240 }} value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action">
            {actions.map((a) => (
              <option key={a} value={a}>
                {a === "all" ? "Action: all" : a}
              </option>
            ))}
          </select>
          <input type="date" className="in mono" style={{ width: "auto" }} aria-label="From" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <input type="date" className="in mono" style={{ width: "auto" }} aria-label="To" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        {isLoading ? (
          <Empty>
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
          </Empty>
        ) : error ? (
          <div className="pn-b">
            <Notice tone="fail">{(error as Error).message}</Notice>
          </div>
        ) : filtered.length === 0 ? (
          <Empty>No rows match these filters.</Empty>
        ) : (
          <div className="scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Organisation</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>Resource</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row: any) => (
                  <tr key={row.id}>
                    <td className="mono t2" style={{ whiteSpace: "nowrap", fontSize: 12 }}>
                      {new Date(row.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td>{row.org_name}</td>
                    <td>{row.user_name}</td>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      {row.action}
                    </td>
                    <td className="mono t2" style={{ fontSize: 12 }}>
                      {row.resource}
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

function csvCell(value: unknown) {
  const s = String(value ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

