import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { listMembers, updateMemberRole, removeMember } from "@/lib/orgs.functions";
import {
  listInvites, createInvite, resendInvite, cancelInvite, bulkInvite, setUserActive,
} from "@/lib/users.functions";
import {
  Plus, Loader2, ShieldCheck, X, Mail, Upload, Power, PowerOff, RefreshCw, ChevronRight, Users as UsersIcon, Clock3, Activity, ShieldAlert,
} from "lucide-react";

export const Route = createFileRoute("/app/users")({
  head: () => ({ meta: [{ title: "Team · Lemtik SOD" }] }),
  component: Users,
});

const ROLES = ["officer", "supervisor", "manager", "client_admin", "lemtik_admin"] as const;
type Role = (typeof ROLES)[number];

const statusTone: Record<string, string> = {
  "on-duty": "text-resolved bg-resolved/10 border-resolved/30",
  "off-duty": "text-muted-foreground bg-muted border-border",
  "break": "text-medium bg-medium/10 border-medium/30",
};

function timeAgo(iso?: string | null) {
  if (!iso) return "—";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} hr ago` : `${Math.floor(h / 24)} d ago`;
}

function roleLabel(r: string) {
  return r.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function Users() {
  const qc = useQueryClient();
  const list = useServerFn(listMembers);
  const assign = useServerFn(updateMemberRole);
  const remove = useServerFn(removeMember);
  const lInv = useServerFn(listInvites);
  const cInv = useServerFn(createInvite);
  const rInv = useServerFn(resendInvite);
  const xInv = useServerFn(cancelInvite);
  const bInv = useServerFn(bulkInvite);
  const setActive = useServerFn(setUserActive);

  const { data: members = [], isLoading, error: loadErr } = useQuery({
    queryKey: ["org-members"], queryFn: () => list(),
  });
  const { data: invites = [] } = useQuery({
    queryKey: ["org-invites"], queryFn: () => lInv(),
  });

  const [tab, setTab] = useState<"members" | "invites">("members");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("officer");
  const [bulkText, setBulkText] = useState("");
  const [bulkMode, setBulkMode] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["org-members"] });
    qc.invalidateQueries({ queryKey: ["org-invites"] });
  };

  const roleMut = useMutation({
    mutationFn: (d: { member_id: string; role: Role }) => assign({ data: d }),
    onSuccess: refresh,
  });
  const removeMut = useMutation({
    mutationFn: (member_id: string) => remove({ data: { member_id } }),
    onSuccess: refresh,
  });
  const activeMut = useMutation({
    mutationFn: (d: { user_id: string; is_active: boolean }) => setActive({ data: d }),
    onSuccess: refresh,
  });
  const inviteMut = useMutation({
    mutationFn: () => cInv({ data: { email: email.trim(), role } }),
    onSuccess: () => { setEmail(""); setInviteOpen(false); refresh(); },
  });
  const bulkMut = useMutation({
    mutationFn: () => {
      const rows = bulkText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
        const [em, ro] = l.split(",").map((s) => s.trim());
        return { email: em, role: (ro as Role) || undefined };
      });
      return bInv({ data: { rows } });
    },
    onSuccess: () => { setBulkText(""); setBulkMode(false); setInviteOpen(false); refresh(); },
  });
  const resendMut = useMutation({
    mutationFn: (id: string) => rInv({ data: { invite_id: id } }),
    onSuccess: refresh,
  });
  const cancelMut = useMutation({
    mutationFn: (id: string) => xInv({ data: { invite_id: id } }),
    onSuccess: refresh,
  });

  const visibleMembers = members.filter((m: any) => showInactive || m.profile?.is_active !== false);
  const pendingInvites = invites.filter((i: any) => i.status === "pending");
  const metrics = useMemo(() => {
    const activeMembers = members.filter((m: any) => m.profile?.is_active !== false);
    const onDuty = activeMembers.filter((m: any) => m.profile?.status === "on-duty").length;
    const supervisors = activeMembers.filter((m: any) => ["supervisor", "manager", "client_admin", "lemtik_admin"].includes(m.role)).length;
    const inactive = members.length - activeMembers.length;
    const recentlySeen = activeMembers.filter((m: any) => {
      const stamp = m.profile?.last_seen_at || m.profile?.updated_at;
      return stamp && Date.now() - new Date(stamp).getTime() <= 24 * 3600_000;
    }).length;
    const dutyRate = activeMembers.length ? Math.round((onDuty / activeMembers.length) * 100) : 0;
    return { activeMembers, onDuty, supervisors, inactive, recentlySeen, dutyRate };
  }, [members]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Users & Access</div>
          <h1 className="mt-1 text-2xl font-semibold">Team management</h1>
          <p className="text-sm text-muted-foreground">{members.length} member{members.length === 1 ? "" : "s"} · {pendingInvites.length} pending invite{pendingInvites.length === 1 ? "" : "s"}</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
          </label>
          <button
            onClick={() => setInviteOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" /> Invite user
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-border">
        {(["members", "invites"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px ${tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t === "members" ? "Members" : `Invites${pendingInvites.length ? ` (${pendingInvites.length})` : ""}`}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <Metric label="Team size" value={metrics.activeMembers.length.toString()} icon={UsersIcon} />
        <Metric label="On duty" value={metrics.onDuty.toString()} icon={Activity} tone="resolved" />
        <Metric label="Supervisor coverage" value={metrics.supervisors.toString()} icon={ShieldCheck} />
        <Metric label="Inactive" value={metrics.inactive.toString()} icon={ShieldAlert} tone="critical" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_0.9fr] gap-4">
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Live staffing</div>
              <h2 className="text-sm font-semibold">Duty coverage</h2>
            </div>
            <span className="rounded-md border border-border bg-surface px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              24h
            </span>
          </div>
          <div className="mt-4 h-28 rounded-lg border border-border bg-surface p-3">
            <div className="flex h-full items-end gap-2">
              <div className="flex-1">
                <div className="rounded-t bg-resolved/80" style={{ height: `${Math.max(18, metrics.dutyRate)}%` }} />
                <div className="mt-1 text-[10px] text-center text-muted-foreground">On duty</div>
              </div>
              <div className="flex-1">
                <div className="rounded-t bg-critical/70" style={{ height: `${Math.max(10, metrics.inactive * 12)}%` }} />
                <div className="mt-1 text-[10px] text-center text-muted-foreground">Inactive</div>
              </div>
              <div className="flex-1">
                <div className="rounded-t bg-primary/70" style={{ height: `${Math.max(18, metrics.recentlySeen * 5)}%` }} />
                <div className="mt-1 text-[10px] text-center text-muted-foreground">Seen 24h</div>
              </div>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-5 space-y-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Access health</div>
            <h3 className="text-sm font-semibold">Invitation pipeline</h3>
          </div>
          <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
            {pendingInvites.length} pending invite{pendingInvites.length === 1 ? "" : "s"} awaiting approval.
          </div>
          <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
            {metrics.supervisors} supervisory roles currently active.
          </div>
          <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
            Duty coverage: {metrics.dutyRate}% of active personnel.
          </div>
        </div>
      </div>

      {loadErr && (
        <div className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical">
          {(loadErr as Error).message}
        </div>
      )}

      {tab === "members" && (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {isLoading ? (
            <div className="p-10 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading members…
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-surface text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Member</th>
                  <th className="text-left px-4 py-3 font-medium">Role</th>
                  <th className="text-left px-4 py-3 font-medium">Zone</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Last seen</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleMembers.map((m: any) => {
                  const name = m.profile?.display_name || "Operator";
                  const isActive = m.profile?.is_active !== false;
                  return (
                    <tr key={m.id} className={`hover:bg-surface/60 ${isActive ? "" : "opacity-60"}`}>
                      <td className="px-4 py-3">
                        <Link to="/app/users/$id" params={{ id: m.user_id }} className="flex items-center gap-3 group">
                          <div className="grid h-8 w-8 place-items-center rounded-full bg-accent/20 border border-accent/40 text-[10px] font-bold text-accent">
                            {name.split(" ").map((n: string) => n[0]).slice(0, 2).join("").toUpperCase()}
                          </div>
                          <div>
                            <div className="font-medium group-hover:underline">{name}</div>
                            <div className="text-[10px] font-mono text-muted-foreground">{m.profile?.employee_id || m.user_id.slice(0, 8)}</div>
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div className="inline-flex items-center gap-2">
                          <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                          <select
                            value={m.role}
                            disabled={roleMut.isPending}
                            onChange={(e) => roleMut.mutate({ member_id: m.id, role: e.target.value as Role })}
                            className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
                          >
                            {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                          </select>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">{m.profile?.zone ?? "—"}</td>
                      <td className="px-4 py-3">
                        {!isActive ? (
                          <span className="inline-flex rounded-md border border-critical/30 bg-critical/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-critical">
                            Deactivated
                          </span>
                        ) : (
                          <span className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wider ${statusTone[m.profile?.status ?? "off-duty"] ?? statusTone["off-duty"]}`}>
                            {m.profile?.status ?? "—"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{timeAgo(m.profile?.last_seen_at || m.profile?.updated_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => activeMut.mutate({ user_id: m.user_id, is_active: !isActive })}
                            disabled={activeMut.isPending}
                            title={isActive ? "Deactivate" : "Reactivate"}
                            className={`p-1 rounded ${isActive ? "text-muted-foreground hover:text-high" : "text-resolved hover:text-resolved/80"}`}
                          >
                            {isActive ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                          </button>
                          <Link to="/app/users/$id" params={{ id: m.user_id }} className="p-1 text-muted-foreground hover:text-foreground" title="View profile">
                            <ChevronRight className="h-4 w-4" />
                          </Link>
                          <button
                            onClick={() => { if (confirm(`Remove ${name} from organisation?`)) removeMut.mutate(m.id); }}
                            disabled={removeMut.isPending}
                            className="p-1 text-muted-foreground hover:text-critical"
                            title="Remove"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {visibleMembers.length === 0 && (
                  <tr><td colSpan={6} className="p-8 text-center text-sm text-muted-foreground">No members.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "invites" && (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-surface text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Email</th>
                <th className="text-left px-4 py-3 font-medium">Role</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Expires</th>
                <th className="text-left px-4 py-3 font-medium">Sent</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {invites.map((inv: any) => {
                const expired = new Date(inv.expires_at).getTime() < Date.now();
                const effStatus = inv.status === "pending" && expired ? "expired" : inv.status;
                return (
                  <tr key={inv.id}>
                    <td className="px-4 py-3"><div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-muted-foreground" /> {inv.email}</div></td>
                    <td className="px-4 py-3 text-xs">{roleLabel(inv.role)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                        effStatus === "pending" ? "text-primary bg-primary/10 border-primary/30" :
                        effStatus === "accepted" ? "text-resolved bg-resolved/10 border-resolved/30" :
                        effStatus === "expired" ? "text-high bg-high/10 border-high/30" :
                        "text-muted-foreground bg-muted border-border"
                      }`}>{effStatus}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(inv.expires_at).toLocaleString("en-GB")}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{timeAgo(inv.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      {inv.status === "pending" && (
                        <div className="inline-flex items-center gap-1">
                          <button onClick={() => resendMut.mutate(inv.id)} disabled={resendMut.isPending} className="p-1 text-muted-foreground hover:text-primary" title="Resend">
                            <RefreshCw className="h-4 w-4" />
                          </button>
                          <button onClick={() => cancelMut.mutate(inv.id)} disabled={cancelMut.isPending} className="p-1 text-muted-foreground hover:text-critical" title="Cancel">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {invites.length === 0 && (
                <tr><td colSpan={6} className="p-8 text-center text-sm text-muted-foreground">No invites yet. Click <strong>Invite user</strong> to add someone.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {(roleMut.error || removeMut.error || activeMut.error || inviteMut.error || bulkMut.error) && (
        <div className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical">
          {((roleMut.error || removeMut.error || activeMut.error || inviteMut.error || bulkMut.error) as Error).message}
        </div>
      )}

      {/* Invite dialog */}
      {inviteOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-4" onClick={() => setInviteOpen(false)}>
          <div className="w-full max-w-lg rounded-lg border border-border bg-card p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">{bulkMode ? "Bulk invite" : "Invite a user"}</div>
                <div className="text-[11px] text-muted-foreground">Sends a magic-link email · expires in 48 hours</div>
              </div>
              <button onClick={() => setInviteOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <button onClick={() => setBulkMode(false)} className={`px-2 py-1 rounded ${!bulkMode ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Single</button>
              <button onClick={() => setBulkMode(true)} className={`px-2 py-1 rounded ${bulkMode ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Bulk CSV</button>
            </div>

            {!bulkMode ? (
              <form onSubmit={(e) => { e.preventDefault(); inviteMut.mutate(); }} className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Email address</label>
                  <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm" placeholder="name@example.com" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Role</label>
                  <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm">
                    {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                  </select>
                </div>
                <button type="submit" disabled={inviteMut.isPending || !email.trim()}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                  {inviteMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                  Send invite
                </button>
              </form>
            ) : (
              <form onSubmit={(e) => { e.preventDefault(); bulkMut.mutate(); }} className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">CSV — one per line, "email,role" (role optional)</label>
                  <textarea value={bulkText} onChange={(e) => setBulkText(e.target.value)} required rows={8}
                    placeholder={"jane@org.com,officer\njohn@org.com,supervisor"}
                    className="w-full rounded-md border border-border bg-surface px-3 py-2 text-xs font-mono" />
                </div>
                <button type="submit" disabled={bulkMut.isPending || !bulkText.trim()}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                  {bulkMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  Send invites
                </button>
                {bulkMut.data?.results && (
                  <div className="text-[11px] space-y-0.5 max-h-32 overflow-auto">
                    {bulkMut.data.results.map((r, i) => (
                      <div key={i} className={r.ok ? "text-resolved" : "text-critical"}>{r.ok ? "✓" : "✗"} {r.email}{r.error ? ` — ${r.error}` : ""}</div>
                    ))}
                  </div>
                )}
              </form>
            )}
          </div>
        </div>
      )}
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
