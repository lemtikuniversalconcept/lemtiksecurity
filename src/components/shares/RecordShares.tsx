import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Loader2, Share2, X } from "lucide-react";
import { Empty, Status, type Tone } from "@/components/nw";
import { listLinkDirectory } from "@/lib/links.functions";
import { approveShare, createShare, declineShare, listSharesForRecord, revokeShare, SHARE_SCOPE_LABEL, SHARE_SCOPES, type ShareKind, type ShareListItem, type ShareState } from "@/lib/shares.functions";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
export const SHARE_STATE: Record<ShareState, { tone: Tone; label: string }> = {
  pending_approval: { tone: "warn", label: "Waiting for a manager" },
  active: { tone: "ok", label: "Live" },
  declined: { tone: "off", label: "Declined" },
  revoked: { tone: "off", label: "Withdrawn" },
  expired: { tone: "off", label: "Expired" },
};
const HOURS = [
  { v: 6, l: "6 hours" },
  { v: 24, l: "24 hours" },
  { v: 72, l: "3 days" },
  { v: 168, l: "7 days" },
  { v: 720, l: "30 days" },
];
const ACTION: Record<string, string> = { requested: "Asked to share", approved: "Approved", declined: "Declined", viewed: "Opened", acknowledged: "Acknowledged", revoked: "Withdrawn" };

export async function copyText(t: string) {
  try {
    await navigator.clipboard.writeText(t);
    toast.success("Link copied");
  } catch {
    toast.message(t);
  }
}

/** Share button for a record's page: opens the share form and the record's share history. */
export function ShareButton({ kind, id, className = "b b-sm b-sec" }: { kind: ShareKind; id: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Share this with an authority, a responder or someone outside Lemtik, for a set time">
        <Share2 size={14} /> Share
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label="Share" className="no-print" style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(5,7,10,.55)", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "6vh 16px", overflowY: "auto" }} onClick={(e) => e.target === e.currentTarget && setOpen(false)} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
          <div className="card col g12" style={{ width: "min(640px, 100%)", padding: 16, background: "var(--ink-1)" }}>
            <div className="row g8" style={{ alignItems: "center" }}>
              <Share2 size={16} />
              <b className="f1" style={{ fontSize: 15 }}>Share</b>
              <button type="button" className="b b-sm b-gh" onClick={() => setOpen(false)} aria-label="Close"><X size={14} /></button>
            </div>
            <RecordShares kind={kind} id={id} />
          </div>
        </div>
      )}
    </>
  );
}

/** The share form and history for one record. */
export function RecordShares({ kind, id }: { kind: ShareKind; id: string }) {
  const listFn = useServerFn(listSharesForRecord);
  const q = useQuery({ queryKey: ["record-shares", kind, id], queryFn: () => listFn({ data: { record_kind: kind, record_id: id } }) });
  const role = q.data?.role;
  const canShare = role === "manager" || role === "supervisor";
  const rows = q.data?.shares ?? [];
  return (
    <div className="col g12">
      {q.error ? <span className="t3" style={{ fontSize: 13 }}>{(q.error as Error).message}</span> : null}
      {canShare && <ShareForm kind={kind} id={id} isManager={role === "manager"} />}
      {!q.isLoading && !canShare && !q.error && <span className="t3" style={{ fontSize: 13 }}>Only managers and operators can share records.</span>}
      <div className="col g6">
        <b style={{ fontSize: 13 }}>Shared so far</b>
        {q.isLoading ? <Empty>Loading…</Empty> : rows.length === 0 ? <Empty>Not shared with anyone yet.</Empty> : rows.map((s) => <ShareRowView key={s.id} s={s} role={role ?? null} />)}
      </div>
    </div>
  );
}

function ShareForm({ kind, id, isManager }: { kind: ShareKind; id: string; isManager: boolean }) {
  const qc = useQueryClient();
  const dirFn = useServerFn(listLinkDirectory);
  const createFn = useServerFn(createShare);
  const dir = useQuery({ queryKey: ["link-directory"], queryFn: () => dirFn() });
  const [to, setTo] = useState<"org" | "link">("org");
  const [partner, setPartner] = useState("");
  const [label, setLabel] = useState("");
  const [contact, setContact] = useState("");
  const [scopes, setScopes] = useState<string[]>(["location"]);
  const [purpose, setPurpose] = useState("");
  const [hours, setHours] = useState(72);
  const [made, setMade] = useState<string | null>(null);
  const orgs = dir.data ?? [];
  const m = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          record_kind: kind,
          record_id: id,
          partner_org_id: to === "org" ? partner : null,
          recipient_label: to === "link" ? label : null,
          recipient_contact: to === "link" ? contact || null : null,
          scopes: scopes as any,
          purpose,
          hours,
        },
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["record-shares", kind, id] });
      qc.invalidateQueries({ queryKey: ["outgoing-shares"] });
      setPurpose("");
      setLabel("");
      setContact("");
      if (r.status === "pending_approval") toast.success("Sent to a manager for approval");
      else toast.success(to === "org" ? "Shared. They've been told in Lemtik." : "Link ready. Send it to them yourself.");
      setMade(r.link);
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const ready = purpose.trim().length >= 3 && (to === "org" ? !!partner : label.trim().length >= 2);
  return (
    <form
      className="col g10"
      style={{ border: "1px solid var(--line-2)", borderRadius: 9, padding: 12 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) m.mutate();
      }}
    >
      <div className="row g8 wrap">
        <button type="button" className={`b b-sm ${to === "org" ? "b-pri" : "b-sec"}`} onClick={() => setTo("org")} aria-pressed={to === "org"}>An authority or responder on Lemtik</button>
        <button type="button" className={`b b-sm ${to === "link" ? "b-pri" : "b-sec"}`} onClick={() => setTo("link")} aria-pressed={to === "link"}>Anyone, with a link</button>
      </div>
      {to === "org" ? (
        <label className="fl">
          <span>Share with</span>
          <select className="in" value={partner} onChange={(e) => setPartner(e.target.value)} required>
            <option value="">{dir.isLoading ? "Loading…" : orgs.length ? "Choose an organisation" : "No authorities or responders on Lemtik yet"}</option>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.type === "authority" ? "authority" : "responder"})</option>)}
          </select>
        </label>
      ) : (
        <div className="grid g10" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <label className="fl"><span>Who it's for</span><input className="in" value={label} maxLength={160} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Insp. Bello, Marine Police Ikoyi" /></label>
          <label className="fl"><span>Their phone or email (optional, for your records)</span><input className="in" value={contact} maxLength={160} onChange={(e) => setContact(e.target.value)} /></label>
        </div>
      )}
      <fieldset className="col g6" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontSize: 12.5, marginBottom: 4 }}>What they can see</legend>
        {SHARE_SCOPES.map((sc) => (
          <label key={sc} className="row g8" style={{ fontSize: 13, alignItems: "flex-start" }}>
            <input type="checkbox" checked={sc === "summary" || scopes.includes(sc)} disabled={sc === "summary"} onChange={(e) => setScopes(e.target.checked ? [...scopes, sc] : scopes.filter((x) => x !== sc))} style={{ marginTop: 3 }} />
            <span>{SHARE_SCOPE_LABEL[sc]}{sc === "track" && kind === "incident" ? <span className="t3"> (not used for incidents)</span> : null}</span>
          </label>
        ))}
      </fieldset>
      <div className="grid g10" style={{ gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr)" }}>
        <label className="fl"><span>Why you're sharing it</span><input className="in" value={purpose} maxLength={500} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. For the police report; they need the location and photos" required /></label>
        <label className="fl">
          <span>Available for</span>
          <select className="in" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {HOURS.map((h) => <option key={h.v} value={h.v}>{h.l}</option>)}
          </select>
        </label>
      </div>
      <span className="t3" style={{ fontSize: 12 }}>
        {isManager ? "It goes live as soon as you share it." : "A manager has to approve it before it goes live."} You can withdraw it at any time, and every time it's opened is logged.
        {to === "link" ? " Anyone with the link can open it until it expires, so send it only to the person named." : ""}
      </span>
      <button type="submit" className="b b-sm b-pri" style={{ alignSelf: "flex-start" }} disabled={!ready || m.isPending}>
        {m.isPending ? <Loader2 size={13} className="animate-spin" /> : <Share2 size={13} />} {isManager ? "Share" : "Ask a manager to approve"}
      </button>
      {made && (
        <div className="row g8" style={{ alignItems: "center", fontSize: 12.5 }}>
          <span className="mono trunc f1">{made}</span>
          <button type="button" className="b b-sm b-sec" onClick={() => copyText(made)}><Copy size={13} /> Copy link</button>
        </div>
      )}
    </form>
  );
}

export function ShareRowView({ s, role, showRecord = false }: { s: ShareListItem; role: string | null; showRecord?: boolean }) {
  const qc = useQueryClient();
  const approveFn = useServerFn(approveShare);
  const declineFn = useServerFn(declineShare);
  const revokeFn = useServerFn(revokeShare);
  const [open, setOpen] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["record-shares", s.record_kind, s.record_id] });
    qc.invalidateQueries({ queryKey: ["outgoing-shares"] });
  };
  const approve = useMutation({ mutationFn: () => approveFn({ data: { id: s.id } }), onSuccess: () => { toast.success("Approved. It's live now."); refresh(); }, onError: (e) => toast.error((e as Error).message) });
  const decline = useMutation({ mutationFn: () => declineFn({ data: { id: s.id, reason } }), onSuccess: () => { toast.success("Declined"); setDeclining(false); refresh(); }, onError: (e) => toast.error((e as Error).message) });
  const revoke = useMutation({ mutationFn: () => revokeFn({ data: { id: s.id } }), onSuccess: () => { toast.success("Withdrawn. The share stopped working."); refresh(); }, onError: (e) => toast.error((e as Error).message) });
  const st = SHARE_STATE[s.status];
  const live = s.status === "active" || s.status === "pending_approval";
  return (
    <div className="col g6" style={{ borderTop: "1px solid var(--line-1)", paddingTop: 8, fontSize: 13 }}>
      <div className="row g8 wrap" style={{ alignItems: "center" }}>
        <button type="button" className="col f1 text-left" style={{ minWidth: 0 }} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <b className="trunc">{showRecord ? `${s.record_label} → ` : ""}{s.partner_name ?? s.recipient_label}{s.partner_org_id ? "" : " (link)"}</b>
          <span className="t3" style={{ fontSize: 12 }}>
            {s.purpose} · by {s.requested_by_name ?? "—"} {when(s.created_at)} · {s.status === "active" ? `until ${when(s.expires_at)}` : s.status === "expired" ? `ended ${when(s.expires_at)}` : ""}
          </span>
          <span className="t3" style={{ fontSize: 12 }}>
            {s.view_count ? `Opened ${s.view_count} time${s.view_count === 1 ? "" : "s"}, first ${when(s.first_viewed_at)}` : s.status === "active" ? "Not opened yet" : ""}
            {s.acknowledged_at ? ` · Acknowledged by ${s.acknowledged_by_name} ${when(s.acknowledged_at)}` : ""}
          </span>
        </button>
        <Status tone={s.acknowledged_at && s.status === "active" ? "ok" : st.tone}>{s.acknowledged_at && s.status === "active" ? "Acknowledged" : st.label}</Status>
      </div>
      {s.ack_note && <span style={{ fontSize: 12.5 }}>Their note: “{s.ack_note}”</span>}
      {s.decline_reason && <span className="t3" style={{ fontSize: 12.5 }}>Declined by {s.approved_by_name}: {s.decline_reason}</span>}
      <div className="row g6 wrap">
        {s.link && <button type="button" className="b b-sm b-sec" onClick={() => copyText(s.link!)}><Copy size={13} /> Copy link</button>}
        {s.status === "pending_approval" && role === "manager" && (
          <>
            <button type="button" className="b b-sm b-pri" disabled={approve.isPending} onClick={() => approve.mutate()}>{approve.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Approve</button>
            <button type="button" className="b b-sm b-sec" onClick={() => setDeclining((d) => !d)}>Decline</button>
          </>
        )}
        {live && (role === "manager" || role === "supervisor") && (
          <button type="button" className="b b-sm b-gh" disabled={revoke.isPending} onClick={() => revoke.mutate()}>{revoke.isPending ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />} Withdraw</button>
        )}
      </div>
      {declining && (
        <div className="row g8 wrap" style={{ alignItems: "flex-end" }}>
          <label className="fl f1"><span>Reason (the operator sees it)</span><input className="in" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></label>
          <button type="button" className="b b-sm b-sec" disabled={reason.trim().length < 3 || decline.isPending} onClick={() => decline.mutate()}>Decline</button>
        </div>
      )}
      {open && s.events.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table className="tbl w-full" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
            <thead><tr><th className="text-left">When</th><th className="text-left">What</th><th className="text-left">Who</th></tr></thead>
            <tbody>
              {s.events.map((e, i) => (
                <tr key={i}>
                  <td>{when(e.created_at)}</td>
                  <td>{ACTION[e.action] ?? e.action}{e.via === "link" ? " (link)" : ""}</td>
                  <td>{e.actor_name ?? (e.via === "link" ? "Someone with the link" : "—")}{e.actor_org_name ? <span className="t3"> · {e.actor_org_name}</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
