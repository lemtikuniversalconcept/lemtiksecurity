import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { listMembers, listLocations, updateMemberRole, removeMember } from "@/lib/orgs.functions";
import { listInvites, createInvite, resendInvite, cancelInvite, bulkInvite, setUserActive } from "@/lib/users.functions";
import { requireSectionAccess, roleLabel as rbacRoleLabel, normalizeRole, type OrgKind } from "@/lib/rbac";
import { Plus, Loader2, X, Mail, Upload, RefreshCw, Copy, Search, ChevronRight } from "lucide-react";
import { Avatar, Empty, Notice, PageHeader, Panel, Status, Tabs, Tag, timeAgo, type Tone } from "@/components/nw";

export const Route = createFileRoute("/app/users")({
  head: () => ({ meta: [{ title: "Team · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    const appAccess = context.appAccess;
    requireSectionAccess(appAccess, ["security_manager", "client_admin"]);
    return { appAccess };
  },
  component: Users,
});

const ROLES = ["officer", "supervisor", "manager", "client_admin", "security_forensic_analyst"] as const;
type Role = (typeof ROLES)[number];
const ROLE_LABEL: Record<string, string> = {
  officer: "Officer",
  supervisor: "Supervisor",
  manager: "Security manager",
  client_admin: "Client admin",
  security_forensic_analyst: "Forensic analyst",
  lemtik_admin: "Lemtik admin",
};
const roleLabel = (r: string, kind?: OrgKind) =>
  kind && kind !== "land" && r !== "lemtik_admin" ? rbacRoleLabel(normalizeRole(r), kind) : ROLE_LABEL[r] ?? r.replace(/_/g, " ");
const DUTY: Record<string, { tone: Tone; label: string }> = {
  "on-duty": { tone: "ok", label: "On duty" },
  break: { tone: "warn", label: "On break" },
  "off-duty": { tone: "off", label: "Off duty" },
};

/** A random initial password, generated in the browser so the manager can see and share it. */
function randomPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}`;
}

function Users() {
  const { appAccess } = Route.useRouteContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isDetailRoute = pathname.startsWith("/app/users/") && pathname !== "/app/users";
  if (isDetailRoute) return <Outlet />;
  return <UsersList appAccess={appAccess} />;
}

// app.users.$id is a nested child route of this one, so without rendering <Outlet /> somewhere,
// navigating to /app/users/$id updates the URL but the child has nowhere to mount. Splitting the
// list into its own component keeps that branch above every hook the list uses.
function UsersList({ appAccess }: { appAccess: ReturnType<typeof Route.useRouteContext>["appAccess"] }) {
  const qc = useQueryClient();
  const list = useServerFn(listMembers);
  const listLoc = useServerFn(listLocations);
  const assign = useServerFn(updateMemberRole);
  const remove = useServerFn(removeMember);
  const lInv = useServerFn(listInvites);
  const rInv = useServerFn(resendInvite);
  const xInv = useServerFn(cancelInvite);
  const setActive = useServerFn(setUserActive);

  const { data: members = [], isLoading, error: loadErr } = useQuery({ queryKey: ["org-members"], queryFn: () => list() });
  const { data: invites = [] } = useQuery({ queryKey: ["org-invites"], queryFn: () => lInv() });
  const { data: locations = [] } = useQuery({ queryKey: ["org-locations"], queryFn: () => listLoc() });

  const [tab, setTab] = useState<"members" | "invites">("members");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [duty, setDuty] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["org-members"] });
    qc.invalidateQueries({ queryKey: ["org-invites"] });
  };
  const onError = (e: Error) => toast.error(e.message || "That didn't save.");

  const roleMut = useMutation({ mutationFn: (d: { member_id: string; role: Role }) => assign({ data: d }), onSuccess: () => (toast.success("Role updated"), refresh()), onError });
  const removeMut = useMutation({ mutationFn: (member_id: string) => remove({ data: { member_id } }), onSuccess: () => (toast.success("Removed from the organisation"), setRemoving(null), refresh()), onError });
  const activeMut = useMutation({
    mutationFn: (d: { user_id: string; is_active: boolean }) => setActive({ data: d }),
    onSuccess: (_r, v) => (toast.success(v.is_active ? "Reactivated" : "Deactivated"), refresh()),
    onError,
  });
  const resendMut = useMutation({ mutationFn: (id: string) => rInv({ data: { invite_id: id } }), onSuccess: (r: any) => (r?.delivery_warning ? toast.warning(`Invite renewed, but the email wasn't sent: ${r.delivery_warning}`) : toast.success("Invite resent"), refresh()), onError });
  const cancelMut = useMutation({ mutationFn: (id: string) => xInv({ data: { invite_id: id } }), onSuccess: () => (toast.success("Invite cancelled"), refresh()), onError });

  const pendingInvites = (invites as any[]).filter((i) => i.status === "pending");
  const active = (members as any[]).filter((m) => m.profile?.is_active !== false);
  const onDuty = active.filter((m) => m.profile?.status === "on-duty").length;
  const supervisorsOn = active.filter((m) => ["supervisor", "manager"].includes(m.role) && m.profile?.status === "on-duty").length;
  const rows = (members as any[]).filter((m) => {
    if (!showInactive && m.profile?.is_active === false) return false;
    if (roleFilter !== "all" && m.role !== roleFilter) return false;
    if (duty && (m.profile?.status ?? "off-duty") !== duty) return false;
    const q = search.trim().toLowerCase();
    return !q || [m.profile?.display_name, m.email, m.profile?.phone, m.profile?.employee_id].filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
  });
  const canEditRoles = appAccess.dbRole === "manager";
  const editableRoles: Role[] = ["officer", "supervisor", "security_forensic_analyst"];
  const canEditMemberRole = (m: any) => canEditRoles && m.user_id !== appAccess.userId && m.role !== "client_admin";

  return (
    <div className="col g16">
      <PageHeader title="Team" sub={`${active.length} people · ${onDuty} on duty now · ${supervisorsOn} supervisor${supervisorsOn === 1 ? "" : "s"} on shift`}>
        <button type="button" className="b b-pri" onClick={() => setInviteOpen(true)}>
          <Plus className="h-4 w-4" /> Invite
        </button>
      </PageHeader>

      <Tabs
        label="Team views"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "members", label: "People", count: active.length },
          { value: "invites", label: "Invites", count: pendingInvites.length },
        ]}
      />

      {loadErr && <Notice tone="fail">{(loadErr as Error).message}</Notice>}

      {tab === "members" && (
        <section className="pn">
          <div className="row g8 wrap" style={{ padding: "12px 14px" }}>
            <label className="in row g8" style={{ width: 260 }}>
              <Search className="h-4 w-4 t3" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or email" aria-label="Search people" className="f1" style={{ background: "transparent", border: 0, outline: "none", color: "inherit", minWidth: 0 }} />
            </label>
            <select className="in" style={{ width: "auto" }} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Role">
              <option value="all">Role: all</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r, appAccess.orgKind)}
                </option>
              ))}
            </select>
            {Object.entries(DUTY).map(([k, v]) => (
              <button key={k} type="button" className={`chip${duty === k ? " on" : ""}`} aria-pressed={duty === k} onClick={() => setDuty((d) => (d === k ? null : k))}>
                {v.label}
              </button>
            ))}
            <span className="flex-auto" />
            <button type="button" className="b b-sm b-gh" aria-pressed={showInactive} onClick={() => setShowInactive((v) => !v)}>
              {showInactive ? "Hide deactivated" : "Show deactivated"}
            </button>
          </div>
          {isLoading ? (
            <Empty>
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading people…
            </Empty>
          ) : rows.length === 0 ? (
            <Empty>{(members as any[]).length ? "Nobody matches these filters." : "No one has joined yet. Invite your team to get started."}</Empty>
          ) : (
            <div className="scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Phone</th>
                    <th>Last seen</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m: any) => {
                    const name = m.profile?.display_name || m.email || "Unnamed";
                    const isActive = m.profile?.is_active !== false;
                    const st = DUTY[m.profile?.status ?? "off-duty"] ?? DUTY["off-duty"];
                    const seen = m.profile?.last_seen_at || null;
                    return (
                      <tr key={m.id} style={{ opacity: isActive ? 1 : 0.6 }}>
                        <td>
                          <Link to="/app/users/$id" params={{ id: m.user_id }} className="row g10">
                            <Avatar name={name} size="lg" own={m.user_id === appAccess.userId} />
                            <span className="col">
                              <b>{name}</b>
                              <span className="t3">{m.email ?? m.profile?.employee_id ?? ""}</span>
                            </span>
                          </Link>
                        </td>
                        <td>
                          {canEditMemberRole(m) ? (
                            <select className="in" style={{ width: "auto", height: 30 }} value={m.role} disabled={roleMut.isPending} aria-label={`Role for ${name}`} onChange={(e) => roleMut.mutate({ member_id: m.id, role: e.target.value as Role })}>
                              {Array.from(new Set([...editableRoles, m.role])).map((r) => (
                                <option key={r} value={r}>
                                  {roleLabel(r, appAccess.orgKind)}
                                </option>
                              ))}
                            </select>
                          ) : (
                            roleLabel(m.role, appAccess.orgKind)
                          )}
                        </td>
                        <td>{isActive ? <Status tone={st.tone}>{st.label}</Status> : <Tag>Deactivated</Tag>}</td>
                        <td className="mono t2">{m.profile?.phone ?? "—"}</td>
                        <td className="mono t2">{seen ? timeAgo(seen) : "—"}</td>
                        <td>
                          <span className="row g6" style={{ justifyContent: "flex-end" }}>
                            {m.user_id !== appAccess.userId && (
                              <>
                                <button type="button" className="b b-sm b-gh" disabled={activeMut.isPending} onClick={() => activeMut.mutate({ user_id: m.user_id, is_active: !isActive })}>
                                  {isActive ? "Deactivate" : "Reactivate"}
                                </button>
                                <button type="button" className="b b-sm b-gh" onClick={() => setRemoving({ id: m.id, name })}>
                                  Remove
                                </button>
                              </>
                            )}
                            <Link to="/app/users/$id" params={{ id: m.user_id }} className="ibtn" style={{ width: 28, height: 28 }} aria-label={`Open ${name}`}>
                              <ChevronRight size={14} />
                            </Link>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === "invites" && (
        <Panel title="Invites" meta={`${pendingInvites.length} pending`} bodyClassName="">
          {(invites as any[]).length === 0 ? (
            <Empty>No invites yet.</Empty>
          ) : (
            <div className="scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Sent</th>
                    <th>Expires</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(invites as any[]).map((inv) => {
                    const expired = new Date(inv.expires_at).getTime() < Date.now();
                    const eff = inv.status === "pending" && expired ? "expired" : inv.status;
                    const tone: Tone = eff === "pending" ? "blue" : eff === "accepted" ? "ok" : eff === "expired" ? "warn" : "off";
                    return (
                      <tr key={inv.id}>
                        <td className="mono">{inv.email}</td>
                        <td>{roleLabel(inv.role, appAccess.orgKind)}</td>
                        <td>
                          <Status tone={tone}>{eff}</Status>
                        </td>
                        <td className="t2">{timeAgo(inv.created_at)}</td>
                        <td className="t2">{new Date(inv.expires_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</td>
                        <td>
                          {inv.status === "pending" && (
                            <span className="row g6" style={{ justifyContent: "flex-end" }}>
                              <button type="button" className="b b-sm b-gh" disabled={resendMut.isPending} onClick={() => resendMut.mutate(inv.id)}>
                                <RefreshCw className="h-3.5 w-3.5" /> Resend
                              </button>
                              <button type="button" className="b b-sm b-gh" disabled={cancelMut.isPending} onClick={() => cancelMut.mutate(inv.id)}>
                                Cancel
                              </button>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {inviteOpen && <InviteDialog orgKind={appAccess.orgKind} locations={locations as any[]} onClose={() => setInviteOpen(false)} onDone={refresh} />}

      {removing && (
        <Modal title={`Remove ${removing.name}?`} onClose={() => setRemoving(null)}>
          <div className="col g12">
            <p className="t2" style={{ margin: 0 }}>
              They lose access to this organisation straight away. Their past reports and check-ins stay in the record.
            </p>
            <div className="row g8" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="b b-gh" onClick={() => setRemoving(null)}>
                Keep
              </button>
              <button type="button" className="b b-red" disabled={removeMut.isPending} onClick={() => removeMut.mutate(removing.id)}>
                {removeMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Remove
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children, width = 480 }: { title: string; onClose: () => void; children: React.ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center px-4" style={{ background: "rgba(5,7,10,.72)" }} role="dialog" aria-modal="true" aria-label={title}>
      <div className="pn w-full" style={{ maxWidth: width, borderColor: "var(--line-2)", maxHeight: "90vh", overflow: "auto" }}>
        <div className="pn-h">
          <h3 style={{ fontSize: 15 }}>{title}</h3>
          <button type="button" onClick={onClose} className="ibtn ml-auto" style={{ width: 28, height: 28 }} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className="pn-b">{children}</div>
      </div>
    </div>
  );
}

function CopyLine({ value }: { value: string }) {
  return (
    <span className="row g8">
      <code className="mono" style={{ fontSize: 13, padding: "4px 8px", background: "var(--ink-2)", borderRadius: 6, border: "1px solid var(--line-2)" }}>
        {value}
      </code>
      <button
        type="button"
        className="ibtn"
        style={{ width: 28, height: 28 }}
        aria-label="Copy password"
        onClick={() =>
          navigator.clipboard.writeText(value).then(
            () => toast.success("Copied"),
            () => toast.error("Couldn't copy. Select it and copy by hand."),
          )
        }
      >
        <Copy size={13} />
      </button>
    </span>
  );
}

function InviteDialog({ locations, onClose, onDone, orgKind }: { locations: any[]; onClose: () => void; onDone: () => void; orgKind?: import("@/lib/rbac").OrgKind }) {
  const cInv = useServerFn(createInvite);
  const bInv = useServerFn(bulkInvite);
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("officer");
  const [assigned, setAssigned] = useState<string[]>([]);
  const [password, setPassword] = useState(() => randomPassword());
  const [bulkText, setBulkText] = useState("");
  const [done, setDone] = useState<null | { kind: "single"; email: string; existing: boolean; warning: string | null; password: string } | { kind: "bulk"; results: Array<{ email: string; ok: boolean; error?: string; existing_account?: boolean; password?: string | null }> }>(null);

  const single = useMutation({
    mutationFn: () => cInv({ data: { email: email.trim(), role, assigned_location_ids: assigned, password } }),
    onSuccess: (r: any) => {
      setDone({ kind: "single", email: email.trim(), existing: !!r?.existing_account, warning: r?.delivery_warning ?? null, password });
      onDone();
    },
    onError: (e: Error) => toast.error(e.message || "The invite didn't go through."),
  });
  const bulk = useMutation({
    mutationFn: () => {
      const rows = bulkText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [em, ro] = l.split(",").map((s) => s.trim());
          return { email: em, role: (ROLES as readonly string[]).includes(ro) ? (ro as Role) : undefined };
        });
      return bInv({ data: { rows } });
    },
    onSuccess: (r: any) => {
      setDone({ kind: "bulk", results: r?.results ?? [] });
      onDone();
    },
    onError: (e: Error) => toast.error(e.message || "The invites didn't go through."),
  });

  if (done?.kind === "single") {
    return (
      <Modal title="Invite sent" onClose={onClose}>
        <div className="col g12">
          {done.existing ? (
            <Notice tone="blue">{done.email} already has a Lemtik login. They'll join with their existing password; nothing about their account was changed.</Notice>
          ) : (
            <>
              <span className="t2">
                A login was created for <b>{done.email}</b>. Share this initial password with them privately. It isn't shown again.
              </span>
              <CopyLine value={done.password} />
            </>
          )}
          {done.warning && <Notice tone="warn">The invitation email wasn't sent: {done.warning}</Notice>}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="b b-pri" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  if (done?.kind === "bulk") {
    return (
      <Modal title="Invites processed" onClose={onClose} width={620}>
        <div className="col g12">
          <span className="t2">Share each new password privately. They aren't shown again.</span>
          <div className="scroll" style={{ maxHeight: 360 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Result</th>
                  <th>Initial password</th>
                </tr>
              </thead>
              <tbody>
                {done.results.map((r) => (
                  <tr key={r.email}>
                    <td className="mono">{r.email}</td>
                    <td>{!r.ok ? <Tag tone="fail">{r.error ?? "Failed"}</Tag> : r.existing_account ? <Tag tone="blue">Existing login</Tag> : r.error ? <Tag tone="warn">Email not sent</Tag> : <Tag tone="ok">Invited</Tag>}</td>
                    <td>{r.password ? <CopyLine value={r.password} /> : <span className="t3">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="b b-pri" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Invite people" onClose={onClose} width={540}>
      <div className="col g12">
        <div className="seg" role="group" aria-label="Invite mode" style={{ alignSelf: "flex-start" }}>
          <button type="button" className={mode === "single" ? "on" : undefined} onClick={() => setMode("single")}>
            One person
          </button>
          <button type="button" className={mode === "bulk" ? "on" : undefined} onClick={() => setMode("bulk")}>
            Several (CSV)
          </button>
        </div>
        {mode === "single" ? (
          <form
            className="col g12"
            onSubmit={(e) => {
              e.preventDefault();
              single.mutate();
            }}
          >
            <label className="fl">
              <span className="lbl">Email</span>
              <input className="in" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
            </label>
            <label className="fl">
              <span className="lbl">Role</span>
              <select className="in" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r, orgKind)}
                  </option>
                ))}
              </select>
            </label>
            {locations.length > 0 && (
              <div className="fl">
                <span className="lbl">Locations they cover</span>
                <div className="row g6 wrap">
                  {locations.map((l) => (
                    <button key={l.id} type="button" className={`chip${assigned.includes(l.id) ? " on" : ""}`} aria-pressed={assigned.includes(l.id)} onClick={() => setAssigned((a) => (a.includes(l.id) ? a.filter((x) => x !== l.id) : [...a, l.id]))}>
                      {l.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <label className="fl">
              <span className="lbl">Initial password (used only if they don't already have a login)</span>
              <span className="row g8">
                <input className="in mono f1" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" className="b b-sm b-gh" onClick={() => setPassword(randomPassword())}>
                  New
                </button>
              </span>
            </label>
            <div className="row g8" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="b b-gh" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="b b-pri" disabled={single.isPending || !email.trim() || password.length < 8}>
                {single.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Send invite
              </button>
            </div>
          </form>
        ) : (
          <form
            className="col g12"
            onSubmit={(e) => {
              e.preventDefault();
              bulk.mutate();
            }}
          >
            <label className="fl">
              <span className="lbl">One per line: email, role (role optional, defaults to officer)</span>
              <textarea className="in mono" required rows={8} value={bulkText} onChange={(e) => setBulkText(e.target.value)} placeholder={"jane@example.com,officer\njohn@example.com,supervisor"} style={{ height: "auto", paddingTop: 8 }} />
            </label>
            <span className="t3" style={{ fontSize: 12 }}>
              Each new login gets its own random password, shown once on the next screen.
            </span>
            <div className="row g8" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="b b-gh" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="b b-pri" disabled={bulk.isPending || !bulkText.trim()}>
                {bulk.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Send invites
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
