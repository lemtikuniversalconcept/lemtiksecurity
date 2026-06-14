import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPatrols, createPatrol, checkInWaypoint, updatePatrolStatus } from "@/lib/patrols.functions";
import { useRealtimeInvalidate } from "@/lib/useRealtime";
import { Radar, QrCode, Plus, X, Loader2, CheckCircle2, Archive, Activity, ShieldAlert, Clock3 } from "lucide-react";

export const Route = createFileRoute("/app/patrols")({
  head: () => ({ meta: [{ title: "Patrols · Lemtik SOD" }] }),
  component: Patrols,
});

const statusTone: Record<string, string> = {
  on_route: "text-resolved bg-resolved/10 border-resolved/30",
  delayed: "text-high bg-high/10 border-high/30",
  missed: "text-critical bg-critical/10 border-critical/30",
  complete: "text-muted-foreground bg-muted border-border",
};

const STATUSES = ["on_route", "delayed", "missed", "complete"] as const;
type PatrolStatus = (typeof STATUSES)[number];

function Patrols() {
  const list = useServerFn(listPatrols);
  const create = useServerFn(createPatrol);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [show, setShow] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  useRealtimeInvalidate("patrols", [["patrols"]]);

  const { data: allPatrols = [], isLoading } = useQuery({ queryKey: ["patrols"], queryFn: () => list() });
  const patrols = (allPatrols as any[]).filter((p) => showArchived ? !!p.archived_at : !p.archived_at);
  const dashboard = useMemo(() => {
    const total = patrols.length;
    const complete = patrols.filter((p) => p.status === "complete").length;
    const delayed = patrols.filter((p) => p.status === "delayed").length;
    const missed = patrols.filter((p) => p.status === "missed").length;
    const progressAvg = total
      ? Math.round(patrols.reduce((acc, p) => acc + Math.round((p.checked_in / Math.max(p.waypoints, 1)) * 100), 0) / total)
      : 0;
    const nextDue = patrols
      .map((p) => p.next_check_in ?? "—")
      .filter((x) => x !== "—")
      .slice(0, 3);
    return { total, complete, delayed, missed, progressAvg, nextDue };
  }, [patrols]);
  const mut = useMutation({
    mutationFn: (data: { code: string; name: string; officer: string; shift: string; waypoints: number }) =>
      create({ data }),
    onSuccess: (row: any) => { qc.invalidateQueries({ queryKey: ["patrols"] }); setShow(false); if (row?.id) navigate({ to: "/app/patrols/$id", params: { id: row.id } }); },
  });

  const active = null as any;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Patrol Management</div>
          <h1 className="mt-1 text-2xl font-semibold">Active patrol routes</h1>
          <p className="text-sm text-muted-foreground">Live waypoint check-ins · missed alerts auto-escalate.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowArchived((v) => !v)} className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs ${showArchived ? "border-primary/40 bg-primary/10" : "border-border bg-surface hover:bg-surface-2"}`}>
            <Archive className="h-3.5 w-3.5" /> {showArchived ? "Showing archived" : "Show archived"}
          </button>
          <button onClick={() => setShow(true)} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90">
            <Plus className="h-3.5 w-3.5" /> New route
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <Metric label="Routes visible" value={dashboard.total.toString()} icon={Radar} />
        <Metric label="Avg waypoint progress" value={`${dashboard.progressAvg}%`} icon={Activity} />
        <Metric label="Delayed / missed" value={`${dashboard.delayed + dashboard.missed}`} icon={ShieldAlert} tone="critical" />
        <Metric label="Complete routes" value={dashboard.complete.toString()} icon={Clock3} tone="resolved" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-4">
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Route health</div>
              <h2 className="text-sm font-semibold">Patrol execution snapshot</h2>
            </div>
            <span className="rounded-md border border-border bg-surface px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              Live
            </span>
          </div>
          <div className="mt-4 h-28 rounded-lg border border-border bg-surface p-3">
            <div className="flex h-full items-end gap-2">
              {patrols.slice(0, 8).map((p) => {
                const pct = Math.round((p.checked_in / Math.max(p.waypoints, 1)) * 100);
                return (
                  <div key={p.id} className="flex-1 flex flex-col items-center justify-end gap-1">
                    <div
                      className="w-full rounded-t bg-gradient-to-t from-resolved via-primary to-critical/80"
                      style={{ height: `${Math.max(10, pct)}%` }}
                      title={`${p.name}: ${pct}%`}
                    />
                    <div className="text-[10px] font-mono text-muted-foreground truncate w-full text-center">{p.code}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-5 space-y-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Operational alerts</div>
            <h3 className="text-sm font-semibold">Patrol exceptions</h3>
          </div>
          {dashboard.missed > 0 ? (
            <div className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical">
              {dashboard.missed} patrol route{dashboard.missed === 1 ? "" : "s"} are currently marked missed.
            </div>
          ) : (
            <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
              No missed patrols in the current view.
            </div>
          )}
          <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
            Next check-ins: {dashboard.nextDue.length ? dashboard.nextDue.join(" · ") : "No upcoming check-in data."}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading patrols…
        </div>
      ) : patrols.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center">
          <Radar className="h-6 w-6 text-muted-foreground mx-auto" />
          <div className="mt-3 text-sm font-medium">No patrol routes yet</div>
          <div className="mt-1 text-xs text-muted-foreground">Schedule the first patrol to start tracking check-ins.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {patrols.map((p) => {
            const pct = Math.round((p.checked_in / Math.max(p.waypoints, 1)) * 100);
            return (
              <Link
                key={p.id}
                to="/app/patrols/$id"
                params={{ id: p.id }}
                className="block text-left rounded-lg border border-border bg-card p-5 space-y-4 hover:border-primary/50 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-[10px] font-mono text-muted-foreground">{p.code}</div>
                    <div className="text-base font-semibold mt-0.5">{p.name}</div>
                    <div className="text-xs text-muted-foreground mt-1">{p.officer} · {p.shift}</div>
                  </div>
                  <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wider ${statusTone[p.status] ?? statusTone.on_route}`}>
                    <Radar className="h-3 w-3" /> {p.status.replace("_", " ")}
                  </span>
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-muted-foreground">Waypoints</span>
                    <span className="font-mono">{p.checked_in}/{p.waypoints}</span>
                  </div>
                  <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: p.status === "missed" ? "var(--critical)" : p.status === "delayed" ? "var(--high)" : "var(--resolved)",
                      }}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Next check-in</span>
                  <span className="font-mono">{p.next_check_in ?? "—"}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {show && <NewPatrolDialog onClose={() => setShow(false)} onSubmit={(d) => mut.mutate(d)} loading={mut.isPending} error={mut.error?.message ?? null} />}
      {active && <PatrolDetailDialog patrol={active} onClose={() => {}} />}
    </div>
  );
}

function Metric({ label, value, icon: Icon, tone = "muted" }: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "muted" | "critical" | "resolved";
}) {
  const toneClass = tone === "critical"
    ? "text-critical bg-critical/10 border-critical/30"
    : tone === "resolved"
      ? "text-resolved bg-resolved/10 border-resolved/30"
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

function PatrolDetailDialog({ patrol, onClose }: { patrol: any; onClose: () => void }) {
  const qc = useQueryClient();
  const checkIn = useServerFn(checkInWaypoint);
  const setStatus = useServerFn(updatePatrolStatus);

  const checkMut = useMutation({
    mutationFn: () => checkIn({ data: { id: patrol.id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["patrols"] }),
  });
  const statusMut = useMutation({
    mutationFn: (s: PatrolStatus) => setStatus({ data: { id: patrol.id, status: s } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["patrols"] }),
  });

  const pct = Math.round((patrol.checked_in / Math.max(patrol.waypoints, 1)) * 100);
  const done = patrol.checked_in >= patrol.waypoints;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card p-6 space-y-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[10px] font-mono text-muted-foreground">{patrol.code}</div>
            <h2 className="text-lg font-semibold mt-0.5">{patrol.name}</h2>
            <div className="text-xs text-muted-foreground mt-1">{patrol.officer} · {patrol.shift}</div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-surface"><X className="h-4 w-4" /></button>
        </div>

        <div>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-muted-foreground">Waypoint progress</span>
            <span className="font-mono">{patrol.checked_in}/{patrol.waypoints} ({pct}%)</span>
          </div>
          <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: "var(--resolved)" }} />
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Status</div>
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => statusMut.mutate(s)}
                disabled={statusMut.isPending || patrol.status === s}
                className={`rounded-md border px-2.5 py-1 text-xs ${patrol.status === s ? statusTone[s] : "border-border bg-surface hover:bg-surface-2"} disabled:opacity-60`}
              >
                {s.replace("_", " ")}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => checkMut.mutate()}
            disabled={checkMut.isPending || done}
            className="flex-1 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 inline-flex items-center justify-center gap-1.5"
          >
            {checkMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {done ? "All waypoints complete" : "Check in next waypoint"}
          </button>
          <button className="rounded-md border border-border bg-surface px-3 py-2 text-xs hover:bg-surface-2 inline-flex items-center gap-1.5">
            <QrCode className="h-3.5 w-3.5" /> QR
          </button>
        </div>

        {(checkMut.error || statusMut.error) && (
          <div className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical">
            {(checkMut.error as Error)?.message ?? (statusMut.error as Error)?.message}
          </div>
        )}
      </div>
    </div>
  );
}

function NewPatrolDialog({ onClose, onSubmit, loading, error }: {
  onClose: () => void;
  onSubmit: (d: { code: string; name: string; officer: string; shift: string; waypoints: number }) => void;
  loading: boolean; error: string | null;
}) {
  const [f, setF] = useState({ code: "PT-06", name: "", officer: "", shift: "18:00 – 06:00", waypoints: 6 });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold">New patrol route</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-surface"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit(f); }} className="mt-4 grid grid-cols-2 gap-3">
          <FieldEl label="Code"><input required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} className="inp" /></FieldEl>
          <FieldEl label="Waypoints"><input type="number" required min={1} max={50} value={f.waypoints} onChange={(e) => setF({ ...f, waypoints: Number(e.target.value) })} className="inp" /></FieldEl>
          <div className="col-span-2"><FieldEl label="Name"><input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="inp" placeholder="Phase 1 Perimeter Loop" /></FieldEl></div>
          <FieldEl label="Officer"><input required value={f.officer} onChange={(e) => setF({ ...f, officer: e.target.value })} className="inp" /></FieldEl>
          <FieldEl label="Shift"><input required value={f.shift} onChange={(e) => setF({ ...f, shift: e.target.value })} className="inp" /></FieldEl>
          {error && <div className="col-span-2 rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical">{error}</div>}
          <div className="col-span-2 flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md border border-border bg-surface px-3 py-2 text-xs">Cancel</button>
            <button disabled={loading} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-60">
              {loading && <Loader2 className="h-3 w-3 animate-spin" />} Create
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;border-radius:.375rem;border:1px solid var(--border);background:var(--surface);padding:.45rem .6rem;font-size:.8125rem;color:var(--foreground)}.inp:focus{outline:none;box-shadow:0 0 0 1px var(--ring)}`}</style>
      </div>
    </div>
  );
}

function FieldEl({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>{children}</label>;
}
