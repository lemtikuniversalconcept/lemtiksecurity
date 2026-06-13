import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { listIncidents, createIncident } from "@/lib/incidents.functions";
import { bulkUpdateStatus, bulkAssign } from "@/lib/incidentDetail.functions";
import { getActiveOrg, listLocations, listMembers } from "@/lib/orgs.functions";
import { severityMeta, statusMeta, typeMeta, type Severity, type IncidentType, type IncidentStatus } from "@/lib/mockData";
import { SeverityBadge } from "@/components/SeverityBadge";
import { useRealtimeInvalidate } from "@/lib/useRealtime";
import { IncidentReportForm, type IncidentSubmitPayload } from "@/components/IncidentReportForm";
import * as offline from "@/lib/offlineQueue";
import { Plus, Filter, Loader2, Download, WifiOff, CloudUpload, ArrowUpDown, Search, X } from "lucide-react";

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
  reported_by: string | null;
  description: string | null;
  title: string | null;
};

export const Route = createFileRoute("/app/incidents")({
  head: () => ({ meta: [{ title: "Incidents · Lemtik SOD" }] }),
  component: Incidents,
});

type SortKey = "severity" | "reported_at" | "status" | "type" | "location" | "officer";

function Incidents() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const list = useServerFn(listIncidents);
  const create = useServerFn(createIncident);
  const fetchActiveOrg = useServerFn(getActiveOrg);
  const fetchLocations = useServerFn(listLocations);
  const fetchMembers = useServerFn(listMembers);
  const bulkStatusFn = useServerFn(bulkUpdateStatus);
  const bulkAssignFn = useServerFn(bulkAssign);

  const [me, setMe] = useState<string | null>(null);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null)); }, []);

  useRealtimeInvalidate("incidents", [["incidents"]]);

  const { data: incidents = [], isLoading } = useQuery({
    queryKey: ["incidents"],
    queryFn: () => list() as Promise<IncidentRow[]>,
  });
  const { data: activeOrg } = useQuery({ queryKey: ["active-org"], queryFn: () => fetchActiveOrg() });
  const { data: locations = [] } = useQuery({ queryKey: ["org-locations"], queryFn: () => fetchLocations() });
  const { data: members = [] } = useQuery({ queryKey: ["members"], queryFn: () => fetchMembers() });

  const [search, setSearch] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filterStatus, setFilterStatus] = useState<IncidentStatus | "">("");
  const [filterType, setFilterType] = useState<IncidentType | "">("");
  const [filterZone, setFilterZone] = useState("");
  const [filterSevMin, setFilterSevMin] = useState(1);
  const [filterSevMax, setFilterSevMax] = useState(5);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("reported_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showNew, setShowNew] = useState(false);
  const [bulkOpen, setBulkOpen] = useState<"status" | "assign" | null>(null);

  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
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
    window.addEventListener("online", goOnline);
    const unsub = offline.subscribe(refreshPending);
    return () => { window.removeEventListener("offline", goOffline); window.removeEventListener("online", goOnline); unsub(); };
  }, [create, queryClient]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return incidents
      .filter((i) => !mineOnly || i.reported_by === me || (i.officer && members.find((m: any) => m.user_id === me)?.profile?.display_name === i.officer))
      .filter((i) => !filterStatus || i.status === filterStatus)
      .filter((i) => !filterType || i.type === filterType)
      .filter((i) => !filterZone || i.zone === filterZone)
      .filter((i) => i.severity >= filterSevMin && i.severity <= filterSevMax)
      .filter((i) => !filterFrom || new Date(i.reported_at) >= new Date(filterFrom))
      .filter((i) => !filterTo || new Date(i.reported_at) <= new Date(filterTo))
      .filter((i) => {
        if (!q) return true;
        return [i.code, i.title, i.description, i.location, i.zone, i.officer, typeMeta[i.type], statusMeta[i.status]]
          .filter(Boolean).some((s) => String(s).toLowerCase().includes(q));
      })
      .sort((a, b) => {
        const dir = sortDir === "asc" ? 1 : -1;
        const av: any = (a as any)[sortKey] ?? "";
        const bv: any = (b as any)[sortKey] ?? "";
        if (sortKey === "reported_at") return (new Date(av).getTime() - new Date(bv).getTime()) * dir;
        if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
        return String(av).localeCompare(String(bv)) * dir;
      });
  }, [incidents, search, mineOnly, me, members, filterStatus, filterType, filterZone, filterSevMin, filterSevMax, filterFrom, filterTo, sortKey, sortDir]);

  const allZones = useMemo(() => Array.from(new Set(incidents.map((i) => i.zone))).sort(), [incidents]);
  const allSelectedOnPage = filtered.length > 0 && filtered.every((i) => selected.has(i.id));
  const toggleAll = () => {
    const next = new Set(selected);
    if (allSelectedOnPage) filtered.forEach((i) => next.delete(i.id));
    else filtered.forEach((i) => next.add(i.id));
    setSelected(next);
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const sortBy = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "severity" || k === "reported_at" ? "desc" : "asc"); }
  };

  const exportCsv = () => {
    const rows = (selected.size > 0 ? filtered.filter((i) => selected.has(i.id)) : filtered);
    const headers = ["id", "code", "type", "severity", "status", "location", "zone", "officer", "reported_at"];
    const csv = [headers.join(","), ...rows.map((r) =>
      headers.map((h) => JSON.stringify((r as Record<string, unknown>)[h] ?? "")).join(",")
    )].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `incidents-${new Date().toISOString().slice(0, 10)}.csv`;
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["incidents"] });
      setShowNew(false);
    },
  });

  const bulkStatusMut = useMutation({
    mutationFn: (vars: { status: IncidentStatus; note: string }) => bulkStatusFn({ data: { ids: Array.from(selected), ...vars } }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["incidents"] }); setSelected(new Set()); setBulkOpen(null); },
  });
  const bulkAssignMut = useMutation({
    mutationFn: (uid: string | null) => bulkAssignFn({ data: { ids: Array.from(selected), member_user_id: uid } }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["incidents"] }); setSelected(new Set()); setBulkOpen(null); },
  });

  const flushNow = async () => {
    const sent = await offline.flush((p) => create({ data: p }) as Promise<unknown>);
    if (sent > 0) queryClient.invalidateQueries({ queryKey: ["incidents"] });
    refreshPending();
  };

  return (
    <div className="space-y-5">
      {(!online || pending.length > 0) && (
        <div className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs ${online ? "border-medium/40 bg-medium/10 text-medium" : "border-critical/40 bg-critical/10 text-critical"}`}>
          <div className="flex items-center gap-2">
            {online ? <CloudUpload className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            {online ? `${pending.length} incident${pending.length === 1 ? "" : "s"} pending sync` : "Offline — incidents will sync when connection returns."}
          </div>
          {online && pending.length > 0 && (
            <button onClick={flushNow} className="rounded border border-current px-2 py-0.5 uppercase tracking-wider text-[10px] hover:bg-foreground/10">Sync now</button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Incidents</div>
          <h1 className="mt-1 text-2xl font-semibold">All incidents</h1>
          <p className="text-sm text-muted-foreground">Sortable, filterable, fully searchable.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-xs hover:bg-surface-2">
            <Download className="h-3.5 w-3.5" /> Export {selected.size > 0 ? `(${selected.size})` : "CSV"}
          </button>
          <button onClick={() => setShowNew(true)} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90">
            <Plus className="h-3.5 w-3.5" /> New incident
          </button>
        </div>
      </div>

      {/* Search & toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search code, location, officer, description…"
            className="w-full rounded-md border border-border bg-surface pl-7 pr-3 py-1.5 text-xs"
          />
        </div>
        <button onClick={() => setMineOnly((v) => !v)} className={`rounded-md border px-3 py-1.5 text-xs ${mineOnly ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-surface text-muted-foreground"}`}>
          My incidents
        </button>
        <button onClick={() => setShowFilters((v) => !v)} className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs ${showFilters ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-surface text-muted-foreground"}`}>
          <Filter className="h-3 w-3" /> Filters
        </button>
        <span className="ml-auto text-[11px] text-muted-foreground">{filtered.length} of {incidents.length}</span>
      </div>

      {showFilters && (
        <div className="rounded-md border border-border bg-card p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
          <Field label="Status">
            <select className="filter-input" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as any)}>
              <option value="">All</option>
              {(Object.keys(statusMeta) as IncidentStatus[]).map((s) => <option key={s} value={s}>{statusMeta[s]}</option>)}
            </select>
          </Field>
          <Field label="Type">
            <select className="filter-input" value={filterType} onChange={(e) => setFilterType(e.target.value as any)}>
              <option value="">All</option>
              {(Object.keys(typeMeta) as IncidentType[]).map((t) => <option key={t} value={t}>{typeMeta[t]}</option>)}
            </select>
          </Field>
          <Field label="Zone">
            <select className="filter-input" value={filterZone} onChange={(e) => setFilterZone(e.target.value)}>
              <option value="">All</option>
              {allZones.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </Field>
          <Field label={`Severity ${filterSevMin}–${filterSevMax}`}>
            <div className="flex gap-1">
              <select className="filter-input flex-1" value={filterSevMin} onChange={(e) => setFilterSevMin(Number(e.target.value))}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>S{n}</option>)}
              </select>
              <select className="filter-input flex-1" value={filterSevMax} onChange={(e) => setFilterSevMax(Number(e.target.value))}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>S{n}</option>)}
              </select>
            </div>
          </Field>
          <Field label="From"><input type="date" className="filter-input" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} /></Field>
          <Field label="To"><input type="date" className="filter-input" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} /></Field>
          <style>{`.filter-input{width:100%;border-radius:.25rem;border:1px solid var(--border);background:var(--surface);padding:.3rem .4rem;font-size:.75rem;}`}</style>
        </div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-xs">
          <div>{selected.size} selected</div>
          <div className="flex gap-2">
            <button onClick={() => setBulkOpen("status")} className="rounded border border-current px-2 py-0.5 uppercase tracking-wider text-[10px]">Update status</button>
            <button onClick={() => setBulkOpen("assign")} className="rounded border border-current px-2 py-0.5 uppercase tracking-wider text-[10px]">Assign</button>
            <button onClick={exportCsv} className="rounded border border-current px-2 py-0.5 uppercase tracking-wider text-[10px]">Export</button>
            <button onClick={() => setSelected(new Set())} className="rounded border border-current px-2 py-0.5 uppercase tracking-wider text-[10px]">Clear</button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {isLoading ? (
          <div className="p-10 text-center text-sm text-muted-foreground flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-sm font-medium">No incidents match</div>
            <div className="mt-1 text-xs text-muted-foreground">Adjust filters or log a new incident.</div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-3 w-8"><input type="checkbox" checked={allSelectedOnPage} onChange={toggleAll} /></th>
                <SortHeader k="severity" sortKey={sortKey} dir={sortDir} onSort={sortBy}>Sev</SortHeader>
                <th className="text-left px-3 py-3 font-medium">ID</th>
                <SortHeader k="type" sortKey={sortKey} dir={sortDir} onSort={sortBy}>Type</SortHeader>
                <SortHeader k="location" sortKey={sortKey} dir={sortDir} onSort={sortBy}>Location</SortHeader>
                <SortHeader k="officer" sortKey={sortKey} dir={sortDir} onSort={sortBy}>Officer</SortHeader>
                <SortHeader k="reported_at" sortKey={sortKey} dir={sortDir} onSort={sortBy}>Reported</SortHeader>
                <SortHeader k="status" sortKey={sortKey} dir={sortDir} onSort={sortBy}>Status</SortHeader>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((i) => {
                const meta = severityMeta[i.severity as Severity];
                return (
                  <tr
                    key={i.id}
                    onClick={() => navigate({ to: "/app/incidents/$id", params: { id: i.id } })}
                    className="hover:bg-surface/60 cursor-pointer"
                    style={{ borderLeft: `3px solid var(--${meta.token})` }}
                  >
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggleOne(i.id)} />
                    </td>
                    <td className="px-3 py-3"><SeverityBadge severity={i.severity as Severity} /></td>
                    <td className="px-3 py-3 font-mono text-xs">{i.code}</td>
                    <td className="px-3 py-3">{typeMeta[i.type]}</td>
                    <td className="px-3 py-3">
                      <div>{i.location}</div>
                      <div className="text-[11px] text-muted-foreground">{i.zone}</div>
                    </td>
                    <td className="px-3 py-3 text-xs">{i.officer ?? "—"}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{new Date(i.reported_at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td className="px-3 py-3">
                      <span className={`text-[10px] uppercase tracking-wider font-medium ${
                        i.status === "resolved" ? "text-resolved" :
                        i.status === "escalated" ? "text-critical" :
                        i.status === "responding" ? "text-high" :
                        i.status === "closed" ? "text-muted-foreground" :
                        "text-muted-foreground"
                      }`}>{statusMeta[i.status]}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showNew && activeOrg && (
        <IncidentReportForm
          organisationId={activeOrg.id}
          savedLocations={locations.map((l) => ({ id: l.id, name: l.name, coord_x: l.coord_x as number | null, coord_y: l.coord_y as number | null }))}
          defaultZone={locations[0]?.name ?? "Lekki Phase 1"}
          onClose={() => setShowNew(false)}
          onSubmit={(d) => createMut.mutate(d)}
          loading={createMut.isPending}
          error={createMut.error ? (createMut.error as Error).message : null}
        />
      )}

      {bulkOpen === "status" && (
        <BulkStatusDialog
          count={selected.size}
          onClose={() => setBulkOpen(null)}
          onSubmit={(status, note) => bulkStatusMut.mutate({ status, note })}
          busy={bulkStatusMut.isPending}
        />
      )}
      {bulkOpen === "assign" && (
        <BulkAssignDialog
          members={members}
          count={selected.size}
          onClose={() => setBulkOpen(null)}
          onSubmit={(uid) => bulkAssignMut.mutate(uid)}
          busy={bulkAssignMut.isPending}
        />
      )}
    </div>
  );
}

function SortHeader({ k, sortKey, dir, onSort, children }: { k: SortKey; sortKey: SortKey; dir: "asc" | "desc"; onSort: (k: SortKey) => void; children: React.ReactNode }) {
  const active = sortKey === k;
  return (
    <th className="text-left px-3 py-3 font-medium">
      <button onClick={() => onSort(k)} className={`inline-flex items-center gap-1 ${active ? "text-foreground" : ""}`}>
        {children} <ArrowUpDown className={`h-3 w-3 ${active ? "opacity-100" : "opacity-40"}`} />
        {active && <span className="text-[8px]">{dir.toUpperCase()}</span>}
      </button>
    </th>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}

function BulkStatusDialog({ count, onClose, onSubmit, busy }: { count: number; onClose: () => void; onSubmit: (s: IncidentStatus, n: string) => void; busy: boolean }) {
  const [status, setStatus] = useState<IncidentStatus>("acknowledged");
  const [note, setNote] = useState("");
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-5">
        <div className="flex items-start justify-between">
          <div><div className="text-[11px] uppercase tracking-wider text-muted-foreground">Bulk update</div><h3 className="mt-1 text-lg font-semibold">Update {count} incidents</h3></div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-surface"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-3 space-y-2">
          <select className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value as IncidentStatus)}>
            {(Object.keys(statusMeta) as IncidentStatus[]).map((s) => <option key={s} value={s}>{statusMeta[s]}</option>)}
          </select>
          <textarea required rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (required)" className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm resize-none" />
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border bg-surface px-3 py-2 text-xs">Cancel</button>
          <button disabled={busy || !note.trim()} onClick={() => onSubmit(status, note.trim())} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-60">
            {busy && <Loader2 className="h-3 w-3 animate-spin" />} Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function BulkAssignDialog({ members, count, onClose, onSubmit, busy }: { members: any[]; count: number; onClose: () => void; onSubmit: (uid: string | null) => void; busy: boolean }) {
  const [uid, setUid] = useState<string>("");
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-5">
        <div className="flex items-start justify-between">
          <div><div className="text-[11px] uppercase tracking-wider text-muted-foreground">Bulk assign</div><h3 className="mt-1 text-lg font-semibold">Assign {count} incidents</h3></div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-surface"><X className="h-4 w-4" /></button>
        </div>
        <select className="mt-3 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm" value={uid} onChange={(e) => setUid(e.target.value)}>
          <option value="">— Unassign —</option>
          {members.map((m: any) => <option key={m.id} value={m.user_id}>{m.profile?.display_name || "Member"} ({m.role.replace("_", " ")})</option>)}
        </select>
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border bg-surface px-3 py-2 text-xs">Cancel</button>
          <button disabled={busy} onClick={() => onSubmit(uid || null)} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-60">
            {busy && <Loader2 className="h-3 w-3 animate-spin" />} Apply
          </button>
        </div>
      </div>
    </div>
  );
}
