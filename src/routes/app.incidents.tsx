import { Outlet, createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { listIncidents, createIncident } from "@/lib/incidents.functions";
import { bulkUpdateStatus, bulkAssign } from "@/lib/incidentDetail.functions";
import { getActiveOrg, listLocations, listMembers } from "@/lib/orgs.functions";
import { statusMeta, typeMeta, type IncidentType, type IncidentStatus } from "@/lib/mockData";
import { useRealtimeInvalidate } from "@/lib/useRealtime";
import { orgRoom, publishRealtimeEvent } from "@/lib/realtime.events";
import { IncidentWizardForm } from "@/components/IncidentWizardForm";
import { type IncidentSubmitPayload } from "@/components/IncidentReportForm";
import * as offline from "@/lib/offlineQueue";
import { requireSectionAccess } from "@/lib/rbac";
import { Avatar, Lifecycle, PageHeader, Sev, useNow } from "@/components/nw";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, CloudUpload, Download, Loader2, Plus, RefreshCw, Search, UserCheck, WifiOff, X } from "lucide-react";

type IncidentRow = {
  id: string;
  code: string;
  type: IncidentType;
  severity: number;
  status: IncidentStatus;
  location: string;
  zone: string;
  officer: string | null;
  reported_at: string;
  updated_at?: string | null;
  reported_by: string | null;
  description: string | null;
  title: string | null;
  quick_report?: boolean | null;
  source?: string | null;
};

export const Route = createFileRoute("/app/incidents")({
  head: () => ({ meta: [{ title: "Incidents · Lemtik SOD" }] }),
  validateSearch: (search: Record<string, unknown>): { new?: boolean } =>
    search.new === true || search.new === "true" || search.new === 1 || search.new === "1" ? { new: true } : {},
  beforeLoad: async ({ context }) => {
    const appAccess = context.appAccess;
    requireSectionAccess(appAccess, ["security_manager", "operator", "client_admin"]);
    return { appAccess };
  },
  component: IncidentsPage,
});

type SortKey = "severity" | "title" | "status" | "location" | "reported_at" | "time_open" | "officer";
type Tab = "open" | "mine" | "unassigned" | "critical" | "resolved_today" | "all";

const isOpen = (i: IncidentRow) => i.status !== "resolved" && i.status !== "closed";
const titleOf = (i: IncidentRow) => i.title || typeMeta[i.type] || "Incident";

function sourceLabel(i: IncidentRow) {
  if (i.source === "consumer_pwa") return "Guest app";
  if (i.source) return i.source.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  return i.quick_report ? "Quick report" : "Logged";
}

function IncidentsPage() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { appAccess } = Route.useRouteContext();
  const isDetailRoute = pathname.startsWith("/app/incidents/") && pathname !== "/app/incidents";
  if (isDetailRoute) return <Outlet />;
  return <IncidentsList appAccess={appAccess} navigate={navigate} />;
}

function IncidentsList({ appAccess, navigate }: { appAccess: ReturnType<typeof Route.useRouteContext>["appAccess"]; navigate: ReturnType<typeof useNavigate> }) {
  const queryClient = useQueryClient();
  const list = useServerFn(listIncidents);
  const create = useServerFn(createIncident);
  const fetchActiveOrg = useServerFn(getActiveOrg);
  const fetchLocations = useServerFn(listLocations);
  const fetchMembers = useServerFn(listMembers);
  const bulkStatusFn = useServerFn(bulkUpdateStatus);
  const bulkAssignFn = useServerFn(bulkAssign);
  const { new: openNew } = Route.useSearch();
  const now = useNow(30_000);

  const [me, setMe] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
  }, []);

  useRealtimeInvalidate("incidents", [["incidents"]]);

  const { data: incidents = [], isLoading } = useQuery({ queryKey: ["incidents"], queryFn: () => list() as Promise<IncidentRow[]> });
  const { data: activeOrg } = useQuery({ queryKey: ["active-org"], queryFn: () => fetchActiveOrg() });
  const { data: locations = [] } = useQuery({ queryKey: ["org-locations"], queryFn: () => fetchLocations() });
  const { data: members = [] } = useQuery({ queryKey: ["members"], queryFn: () => fetchMembers() });

  const [tab, setTab] = useState<Tab>("open");
  const [search, setSearch] = useState("");
  const [sevs, setSevs] = useState<Set<number>>(() => new Set([1, 2, 3, 4, 5]));
  const [filterStatus, setFilterStatus] = useState<IncidentStatus | "">("");
  const [filterType, setFilterType] = useState<IncidentType | "">("");
  const [filterZone, setFilterZone] = useState("");
  const [filterOfficer, setFilterOfficer] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("severity");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState<Partial<IncidentSubmitPayload> | null>(null);
  const [bulkOpen, setBulkOpen] = useState<"status" | "assign" | null>(null);
  const AUTO_OPEN_TAB_KEY = "lemtik-open-incident-tab";
  const canManage = appAccess.specRole !== "client_admin";

  // Start online so server and browser render the same HTML; the effect reads the real state.
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState<offline.QueuedIncident[]>([]);
  const refreshPending = () => setPending(offline.list());
  useEffect(() => {
    refreshPending();
    const goOffline = () => setOnline(false);
    const goOnline = async () => {
      setOnline(true);
      const sent = await offline.flush((p) => create({ data: p }) as Promise<unknown>);
      if (sent > 0) queryClient.invalidateQueries({ queryKey: ["incidents"] });
      refreshPending();
    };
    window.addEventListener("offline", goOffline);
    setOnline(navigator.onLine !== false);
    window.addEventListener("online", goOnline);
    const unsub = offline.subscribe(refreshPending);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
      unsub();
    };
  }, [create, queryClient]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("lemtik_incident_draft");
      if (!raw) return;
      setDraft(JSON.parse(raw) as Partial<IncidentSubmitPayload>);
      setShowNew(true);
      sessionStorage.removeItem("lemtik_incident_draft");
    } catch {
      sessionStorage.removeItem("lemtik_incident_draft");
    }
  }, []);

  useEffect(() => {
    if (!openNew) return;
    if (canManage) setShowNew(true);
    navigate({ to: "/app/incidents", search: {}, replace: true });
  }, [openNew, canManage, navigate]);

  const myName = useMemo(() => (members as any[]).find((m) => m.user_id === me)?.profile?.display_name ?? null, [members, me]);
  const isMine = (i: IncidentRow) => i.reported_by === me || (!!myName && i.officer === myName);
  const startOfToday = useMemo(() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, [now]);
  const inTab = (i: IncidentRow, t: Tab) =>
    t === "open" ? isOpen(i)
    : t === "mine" ? isMine(i)
    : t === "unassigned" ? isOpen(i) && !i.officer
    : t === "critical" ? isOpen(i) && Number(i.severity) >= 4
    : t === "resolved_today" ? !isOpen(i) && new Date(i.updated_at ?? i.reported_at).getTime() >= startOfToday
    : true;
  const tabCount = (t: Tab) => incidents.filter((i) => inTab(i, t)).length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const dir = sortDir === "asc" ? 1 : -1;
    const value = (i: IncidentRow): number | string =>
      sortKey === "time_open" ? now - new Date(i.reported_at).getTime()
      : sortKey === "reported_at" ? new Date(i.reported_at).getTime()
      : sortKey === "severity" ? Number(i.severity)
      : sortKey === "title" ? titleOf(i)
      : String((i as any)[sortKey] ?? "");
    return incidents
      .filter((i) => inTab(i, tab))
      .filter((i) => sevs.has(Math.min(5, Math.max(1, Number(i.severity)))))
      .filter((i) => !filterStatus || i.status === filterStatus)
      .filter((i) => !filterType || i.type === filterType)
      .filter((i) => !filterZone || i.zone === filterZone)
      .filter((i) => !filterOfficer || (filterOfficer === "__none" ? !i.officer : i.officer === filterOfficer))
      .filter((i) => !filterFrom || new Date(i.reported_at) >= new Date(filterFrom))
      .filter((i) => !filterTo || new Date(i.reported_at) <= new Date(`${filterTo}T23:59:59`))
      .filter((i) => !q || [i.code, i.title, i.description, i.location, i.zone, i.officer, typeMeta[i.type], statusMeta[i.status]].filter(Boolean).some((s) => String(s).toLowerCase().includes(q)))
      .sort((a, b) => {
        const av = value(a);
        const bv = value(b);
        const primary = typeof av === "number" && typeof bv === "number" ? (av - bv) * dir : String(av).localeCompare(String(bv)) * dir;
        return primary || new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidents, tab, search, sevs, filterStatus, filterType, filterZone, filterOfficer, filterFrom, filterTo, sortKey, sortDir, me, myName, now]);

  const allZones = useMemo(() => Array.from(new Set(incidents.map((i) => i.zone).filter(Boolean))).sort(), [incidents]);
  const allOfficers = useMemo(() => Array.from(new Set(incidents.map((i) => i.officer).filter(Boolean) as string[])).sort(), [incidents]);
  const last30 = incidents.filter((i) => now - new Date(i.reported_at).getTime() <= 30 * 86_400_000).length;
  const openCount = tabCount("open");
  const criticalCount = tabCount("critical");
  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);
  const allSelectedOnPage = paginated.length > 0 && paginated.every((i) => selected.has(i.id));
  const filtersActive = search || sevs.size < 5 || filterStatus || filterType || filterZone || filterOfficer || filterFrom || filterTo;

  const toggleAll = () => {
    const next = new Set(selected);
    if (allSelectedOnPage) paginated.forEach((i) => next.delete(i.id));
    else paginated.forEach((i) => next.add(i.id));
    setSelected(next);
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const toggleSev = (s: number) => {
    const next = new Set(sevs);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setSevs(next.size ? next : new Set([1, 2, 3, 4, 5]));
  };
  const sortBy = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "severity" || k === "reported_at" || k === "time_open" ? "desc" : "asc");
    }
  };
  const clearFilters = () => {
    setSearch("");
    setSevs(new Set([1, 2, 3, 4, 5]));
    setFilterStatus("");
    setFilterType("");
    setFilterZone("");
    setFilterOfficer("");
    setFilterFrom("");
    setFilterTo("");
  };

  useEffect(() => {
    setPage(1);
  }, [tab, search, sevs, filterStatus, filterType, filterZone, filterOfficer, filterFrom, filterTo, sortKey, sortDir]);

  const exportCsv = () => {
    const rows = selected.size > 0 ? filtered.filter((i) => selected.has(i.id)) : filtered;
    const headers = ["id", "code", "type", "severity", "status", "location", "zone", "officer", "reported_at"];
    const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => JSON.stringify((r as Record<string, unknown>)[h] ?? "")).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `incidents-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const createMut = useMutation({
    mutationFn: async (data: IncidentSubmitPayload) => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        offline.enqueue(data);
        refreshPending();
        return { offline: true } as const;
      }
      return create({ data });
    },
    onSuccess: (row: any, variables) => {
      queryClient.invalidateQueries({ queryKey: ["incidents"] });
      if (row?.id) {
        publishRealtimeEvent(orgRoom(appAccess.orgId), "incident:created", {
          incident_id: row.id,
          code: row.code ?? null,
          severity: row.severity ?? variables.severity ?? null,
          location: row.location ?? variables.location ?? null,
          zone: row.zone ?? variables.zone ?? null,
          created_by: me,
        });
      }
      setShowNew(false);
      if (row?.id) {
        const analysisStatus = String(row?.analysis_status ?? row?.status ?? "pending").toLowerCase();
        sessionStorage.setItem(
          `lemtik-incident-analysis:${row.id}`,
          JSON.stringify({ incident_id: row.id, analysis_status: analysisStatus, dispatch_plan_status: row?.dispatch_plan ? "ready" : "pending", created_at: new Date().toISOString() }),
        );
        sessionStorage.setItem(AUTO_OPEN_TAB_KEY, row.id);
        navigate({ to: "/app/incidents/$id", params: { id: row.id } });
      }
    },
  });

  const bulkStatusMut = useMutation({
    mutationFn: (vars: { status: IncidentStatus; note: string }) => bulkStatusFn({ data: { ids: Array.from(selected), ...vars } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["incidents"] });
      setSelected(new Set());
      setBulkOpen(null);
    },
  });
  const bulkAssignMut = useMutation({
    mutationFn: (uid: string | null) => bulkAssignFn({ data: { ids: Array.from(selected), member_user_id: uid } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["incidents"] });
      setSelected(new Set());
      setBulkOpen(null);
    },
  });

  const flushNow = async () => {
    const sent = await offline.flush((p) => create({ data: p }) as Promise<unknown>);
    if (sent > 0) queryClient.invalidateQueries({ queryKey: ["incidents"] });
    refreshPending();
  };

  const selectedCodes = incidents.filter((i) => selected.has(i.id)).map((i) => i.code);

  return (
    <>
      {(!online || pending.length > 0) && (
        <div className={`card row g10 wrap`} style={{ padding: "8px 12px", borderColor: online ? "rgba(247,208,70,.35)" : "#5C1D21", background: online ? "var(--warn-bg)" : "#2A0E10" }} role="status">
          {online ? <CloudUpload size={15} strokeWidth={1.75} className="ic warnc" /> : <WifiOff size={15} strokeWidth={1.75} className="ic" style={{ color: "#FF9A9B" }} />}
          <span className="f1" style={{ fontSize: 12.5 }}>
            {online ? `${pending.length} incident${pending.length === 1 ? "" : "s"} saved on this device, waiting to sync` : "You’re offline. New incidents are saved on this device and sync when the connection returns."}
          </span>
          {online && pending.length > 0 && (
            <button type="button" onClick={flushNow} className="b b-sm b-sec">
              <RefreshCw size={13} strokeWidth={1.75} /> Sync now
            </button>
          )}
        </div>
      )}

      <PageHeader title="Incidents" sub={`${last30} in the last 30 days · ${openCount} open · ${criticalCount} critical`}>
        <button type="button" onClick={exportCsv} className="b b-sec">
          <Download size={15} strokeWidth={1.75} className="ic" />
          Export CSV{selected.size > 0 ? ` (${selected.size})` : ""}
        </button>
        {canManage ? (
          <button type="button" onClick={() => setShowNew(true)} className="b b-pri">
            <Plus size={15} strokeWidth={1.75} className="ic" />
            Log incident
          </button>
        ) : (
          <span className="tg">View only</span>
        )}
      </PageHeader>

      <div className="tabs" role="tablist" aria-label="Incident views">
        {(
          [
            ["open", "Open"],
            ["mine", "My incidents"],
            ["unassigned", "Unassigned"],
            ["critical", "Critical"],
            ["resolved_today", "Resolved today"],
            ["all", "All"],
          ] as [Tab, string][]
        ).map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} className={`tab${tab === value ? " on" : ""}`} onClick={() => setTab(value)}>
            {label}
            {value !== "all" && <span className="c">{tabCount(value)}</span>}
          </button>
        ))}
      </div>

      <div className="row g8 wrap">
        <label className="in" style={{ width: 280, maxWidth: "100%" }}>
          <Search size={15} strokeWidth={1.75} className="ic t3" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search code, place, officer, notes" className="f1 bg-transparent outline-none" aria-label="Search incidents" />
        </label>
        <div className="row g4" role="group" aria-label="Severity">
          {[5, 4, 3, 2, 1].map((s) => (
            <button key={s} type="button" className={`chip${sevs.has(s) ? " on" : ""}`} style={{ padding: "0 6px", gap: 5 }} aria-pressed={sevs.has(s)} onClick={() => toggleSev(s)}>
              <Sev level={s} />
            </button>
          ))}
        </div>
        <ChipSelect label="Status" value={filterStatus} onChange={(v) => setFilterStatus(v as IncidentStatus | "")} options={(Object.keys(statusMeta) as IncidentStatus[]).map((s) => [s, statusMeta[s]])} />
        <ChipSelect label="Type" value={filterType} onChange={(v) => setFilterType(v as IncidentType | "")} options={(Object.keys(typeMeta) as IncidentType[]).map((t) => [t, typeMeta[t]])} />
        <ChipSelect label="Zone" value={filterZone} onChange={setFilterZone} options={allZones.map((z) => [z, z])} />
        <ChipSelect label="Assignee" value={filterOfficer} onChange={setFilterOfficer} options={[["__none", "Unassigned"], ...allOfficers.map((o) => [o, o] as [string, string])]} />
        <span className="chip" style={{ paddingRight: 4 }}>
          <span className="t3">From</span>
          <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className="bg-transparent outline-none" aria-label="Reported from" style={{ colorScheme: "dark", width: 118 }} />
          <span className="t3">to</span>
          <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className="bg-transparent outline-none" aria-label="Reported to" style={{ colorScheme: "dark", width: 118 }} />
        </span>
        <span className="flex-auto" />
        <span className="t3" style={{ fontSize: 12 }}>{filtered.length} of {incidents.length}</span>
        {filtersActive && (
          <button type="button" className="b b-sm b-gh" onClick={clearFilters}>
            Clear
          </button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="row g12 wrap" style={{ padding: "8px 12px", borderRadius: 9, background: "var(--blue-bg)", border: "1px solid var(--blue-ln)" }}>
          <b style={{ fontSize: 13 }}>{selected.size} selected</b>
          <span className="t2 trunc" style={{ fontSize: 12.5, maxWidth: 360 }}>{selectedCodes.slice(0, 6).join(", ")}{selectedCodes.length > 6 ? "…" : ""}</span>
          <span className="flex-auto" />
          {canManage && (
            <>
              <button type="button" className="b b-sm b-sec" onClick={() => setBulkOpen("assign")}>
                <UserCheck size={13} strokeWidth={1.75} /> Assign
              </button>
              <button type="button" className="b b-sm b-sec" onClick={() => setBulkOpen("status")}>
                <RefreshCw size={13} strokeWidth={1.75} /> Change status
              </button>
            </>
          )}
          <button type="button" className="b b-sm b-sec" onClick={exportCsv}>
            <Download size={13} strokeWidth={1.75} /> Export
          </button>
          <button type="button" className="b b-sm b-gh" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      <div className="pn">
        {isLoading ? (
          <div className="empty row g8 justify-center" style={{ padding: 40 }}>
            <Loader2 className="h-4 w-4 animate-spin" /> Loading incidents…
          </div>
        ) : filtered.length === 0 ? (
          <div className="col g4 items-center" style={{ padding: 40 }}>
            <b>No incidents match</b>
            <span className="empty">{filtersActive ? "Clear the filters or pick another view." : tab === "open" ? "Nothing is open right now." : "Nothing in this view."}</span>
          </div>
        ) : (
          <div className="tblw">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <CheckBox checked={allSelectedOnPage} onChange={toggleAll} label="Select all on this page" />
                  </th>
                  <Th k="severity" sortKey={sortKey} dir={sortDir} onSort={sortBy}>Sev</Th>
                  <Th k="title" sortKey={sortKey} dir={sortDir} onSort={sortBy}>Incident</Th>
                  <Th k="status" sortKey={sortKey} dir={sortDir} onSort={sortBy}>Status</Th>
                  <Th k="location" sortKey={sortKey} dir={sortDir} onSort={sortBy}>Location</Th>
                  <Th k="reported_at" sortKey={sortKey} dir={sortDir} onSort={sortBy}>Reported</Th>
                  <Th k="time_open" sortKey={sortKey} dir={sortDir} onSort={sortBy}>Open for</Th>
                  <Th k="officer" sortKey={sortKey} dir={sortDir} onSort={sortBy}>Assigned</Th>
                  <th>Source</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {paginated.map((i) => {
                  const open = isOpen(i);
                  const reported = new Date(i.reported_at);
                  const today = reported.getTime() >= startOfToday;
                  return (
                    <tr key={i.id} className={`cursor-pointer${selected.has(i.id) ? " sel" : ""}`} onClick={() => navigate({ to: "/app/incidents/$id", params: { id: i.id } })}>
                      <td style={{ width: 36 }} onClick={(e) => e.stopPropagation()}>
                        <CheckBox checked={selected.has(i.id)} onChange={() => toggleOne(i.id)} label={`Select ${i.code}`} />
                      </td>
                      <td style={{ width: 44 }}>
                        <Sev level={i.severity} />
                      </td>
                      <td>
                        <div className="col">
                          <span style={{ fontWeight: 600 }}>{titleOf(i)}</span>
                          <span className="mono t3" style={{ fontSize: 11.5 }}>{i.code}</span>
                        </div>
                      </td>
                      <td>
                        <Lifecycle status={i.status} />
                      </td>
                      <td>
                        <div className="col">
                          <span>{i.location}</span>
                          <span className="t3" style={{ fontSize: 11.5 }}>{i.zone}</span>
                        </div>
                      </td>
                      <td className="mono t2">
                        {reported.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                        {!today && <span className="t3"> · {reported.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}
                      </td>
                      <td>
                        <span className="mono" style={{ color: open ? "var(--tx-1)" : "var(--tx-3)" }}>{open ? formatDuration(now - reported.getTime()) : "Closed"}</span>
                      </td>
                      <td>
                        {i.officer ? (
                          <span className="row g6">
                            <Avatar name={i.officer} />
                            <span className="t2 trunc" style={{ maxWidth: 140 }}>{i.officer}</span>
                          </span>
                        ) : (
                          <span className="tg tg-warn">Unassigned</span>
                        )}
                      </td>
                      <td className="t2" style={{ fontSize: 12.5 }}>{sourceLabel(i)}</td>
                      <td style={{ textAlign: "right" }}>
                        <span className="b b-sm b-gh">Open</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="row g8 wrap">
          <span className="t3" style={{ fontSize: 12 }}>
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}
          </span>
          <span className="flex-auto" />
          <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="b b-sm b-sec">
            <ChevronLeft size={13} strokeWidth={1.75} /> Previous
          </button>
          <span className="mono t2" style={{ fontSize: 12 }}>{page} / {totalPages}</span>
          <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="b b-sm b-sec">
            Next <ChevronRight size={13} strokeWidth={1.75} />
          </button>
        </div>
      )}

      {showNew && activeOrg && (
        <IncidentWizardForm
          organisationId={activeOrg.id}
          savedLocations={locations.map((l) => ({ id: l.id, name: l.name, coord_x: l.coord_x as number | null, coord_y: l.coord_y as number | null }))}
          defaultZone={draft?.zone ?? locations[0]?.name ?? ""}
          initialDraft={draft ?? undefined}
          onClose={() => setShowNew(false)}
          onSubmit={(d) => createMut.mutate(d)}
          loading={createMut.isPending}
          error={createMut.error ? (createMut.error as Error).message : null}
        />
      )}

      {bulkOpen === "status" && canManage && (
        <BulkStatusDialog count={selected.size} onClose={() => setBulkOpen(null)} onSubmit={(status, note) => bulkStatusMut.mutate({ status, note })} busy={bulkStatusMut.isPending} />
      )}
      {bulkOpen === "assign" && canManage && (
        <BulkAssignDialog members={members} count={selected.size} onClose={() => setBulkOpen(null)} onSubmit={(uid) => bulkAssignMut.mutate(uid)} busy={bulkAssignMut.isPending} />
      )}
    </>
  );
}

function formatDuration(ms: number) {
  const mins = Math.max(0, Math.floor(ms / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d`;
}

function Th({ k, sortKey, dir, onSort, children }: { k: SortKey; sortKey: SortKey; dir: "asc" | "desc"; onSort: (k: SortKey) => void; children: ReactNode }) {
  const active = sortKey === k;
  return (
    <th aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}>
      <button type="button" onClick={() => onSort(k)} className={`row g4 ${active ? "t1" : ""}`}>
        {children}
        {active && (dir === "asc" ? <ArrowUp size={11} strokeWidth={2} /> : <ArrowDown size={11} strokeWidth={2} />)}
      </button>
    </th>
  );
}

function CheckBox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label} onClick={onChange} className={`chk${checked ? " on" : ""}`}>
      {checked && <Check size={11} strokeWidth={3} />}
    </button>
  );
}

/** A chip that opens the native select underneath it — keyboard and screen-reader friendly. */
function ChipSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  const current = options.find(([v]) => v === value)?.[1];
  return (
    <label className={`chip relative${value ? " on" : ""}`}>
      {label}: {current ?? "any"}
      <ChevronDown size={13} strokeWidth={1.75} className="ic" />
      <select value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label={label}>
        <option value="">Any</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
}

function Dialog({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center px-4" style={{ background: "rgba(5,7,10,.72)" }} role="dialog" aria-modal="true" aria-label={title}>
      <div className="pn w-full" style={{ maxWidth: 440, borderColor: "var(--line-2)" }}>
        <div className="pn-h">
          <div className="col">
            <span className="eyebrow">{eyebrow}</span>
            <h3 style={{ fontSize: 15 }}>{title}</h3>
          </div>
          <button type="button" onClick={onClose} className="ibtn ml-auto" style={{ width: 28, height: 28 }} aria-label="Close">
            <X size={14} strokeWidth={1.75} />
          </button>
        </div>
        <div className="pn-b col g12">{children}</div>
      </div>
    </div>
  );
}

function BulkStatusDialog({ count, onClose, onSubmit, busy }: { count: number; onClose: () => void; onSubmit: (s: IncidentStatus, n: string) => void; busy: boolean }) {
  const [status, setStatus] = useState<IncidentStatus>("acknowledged");
  const [note, setNote] = useState("");
  return (
    <Dialog eyebrow="Change status" title={`Update ${count} incident${count === 1 ? "" : "s"}`} onClose={onClose}>
      <label className="fl">
        <span className="lbl">New status</span>
        <select className="in" value={status} onChange={(e) => setStatus(e.target.value as IncidentStatus)}>
          {(Object.keys(statusMeta) as IncidentStatus[]).map((s) => (
            <option key={s} value={s}>{statusMeta[s]}</option>
          ))}
        </select>
      </label>
      <label className="fl">
        <span className="lbl">Reason (kept in the audit log)</span>
        <textarea required rows={3} value={note} onChange={(e) => setNote(e.target.value)} className="in" />
      </label>
      <div className="row g8 justify-end">
        <button type="button" onClick={onClose} className="b b-gh">Cancel</button>
        <button type="button" disabled={busy || !note.trim()} onClick={() => onSubmit(status, note.trim())} className="b b-pri">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Apply
        </button>
      </div>
    </Dialog>
  );
}

function BulkAssignDialog({ members, count, onClose, onSubmit, busy }: { members: any[]; count: number; onClose: () => void; onSubmit: (uid: string | null) => void; busy: boolean }) {
  const [uid, setUid] = useState<string>("");
  return (
    <Dialog eyebrow="Assign" title={`Assign ${count} incident${count === 1 ? "" : "s"}`} onClose={onClose}>
      <label className="fl">
        <span className="lbl">Assign to</span>
        <select className="in" value={uid} onChange={(e) => setUid(e.target.value)}>
          <option value="">Nobody (unassign)</option>
          {members.map((m: any) => (
            <option key={m.id} value={m.user_id}>{m.profile?.display_name || "Member"} · {m.role.replace("_", " ")}</option>
          ))}
        </select>
      </label>
      <div className="row g8 justify-end">
        <button type="button" onClick={onClose} className="b b-gh">Cancel</button>
        <button type="button" disabled={busy} onClick={() => onSubmit(uid || null)} className="b b-pri">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Apply
        </button>
      </div>
    </Dialog>
  );
}
