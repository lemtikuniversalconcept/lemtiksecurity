import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Check, Eye, Loader2, Share2, X } from "lucide-react";
import { requireFeature, requireSectionAccess } from "@/lib/rbac";
import { Empty, Notice, PageHeader, Panel, Status, type Tone } from "@/components/nw";
import { listLinkDirectory, listLinks, offerLink, respondLink, revokeLink, SCOPE_LABEL, SCOPES, type LinkEvent, type OrgLink, type Scope } from "@/lib/links.functions";

export const Route = createFileRoute("/app/links")({
  head: () => ({ meta: [{ title: "Shared access · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    requireSectionAccess(context.appAccess, ["security_manager", "operator", "client_admin"]);
    requireFeature(context.appAccess, "links");
  },
  component: LinksPage,
});

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const STATUS: Record<OrgLink["status"], [string, Tone]> = {
  pending: ["Waiting for an answer", "warn"],
  active: ["Active", "ok"],
  declined: ["Declined", "off"],
  revoked: ["Ended", "off"],
  expired: ["Expired", "off"],
};
const ACTION: Record<string, string> = { offered: "offered access", accepted: "accepted", declined: "declined", revoked: "ended the share", viewed: "opened the shared view", imported_corridor: "copied a corridor" };
const SHORT: Record<Scope, string> = { vessels: "Boats", voyages: "Voyages", alerts: "Alerts", search_rescue: "Search and rescue", corridors: "Corridors", isps: "ISPS compliance", people: "People" };
const TYPE: Record<string, string> = { authority: "Authority", responder: "Responder" };

function LinksPage() {
  const fn = useServerFn(listLinks);
  const q = useQuery({ queryKey: ["org-links"], queryFn: () => fn(), refetchInterval: 60_000 });
  const [offering, setOffering] = useState(false);

  if (q.isLoading) return <span className="row g8 t3"><Loader2 className="h-4 w-4 animate-spin" /> Loading shared access…</span>;
  if (q.error || !q.data) return <Notice tone="fail">{(q.error as Error)?.message || "Couldn't load shared access."}</Notice>;
  const { links, events, my_org, can_manage } = q.data;
  const incoming = links.filter((l) => l.direction === "incoming");
  const outgoing = links.filter((l) => l.direction === "outgoing");
  const pending = incoming.filter((l) => l.status === "pending");
  const isPartnerOrg = my_org.type === "authority" || my_org.type === "responder";

  return (
    <div className="col g16">
      <PageHeader title="Shared access" sub="Give an authority or rescue service a time-limited view of your boats, voyages and alerts, and see what others have shared with you. Every look is recorded for both sides.">
        {can_manage && !offering && <button type="button" className="b b-pri" onClick={() => setOffering(true)}><Share2 size={14} /> Share with an organisation</button>}
      </PageHeader>

      {offering && <OfferForm onDone={() => setOffering(false)} />}

      {pending.length > 0 && (
        <Panel title="Offers waiting for you" meta={`${pending.length}`}>
          <div className="col g12">{pending.map((l) => <LinkRow key={l.id} link={l} canManage={can_manage} events={events} />)}</div>
        </Panel>
      )}

      {(isPartnerOrg || incoming.length > 0) && (
        <Panel title="Shared with us">
          {incoming.filter((l) => l.status !== "pending").length === 0 ? (
            <Empty>Nothing has been shared with {my_org.name} yet. Operators share from their own Shared access page.</Empty>
          ) : (
            <div className="col g12">{incoming.filter((l) => l.status !== "pending").map((l) => <LinkRow key={l.id} link={l} canManage={can_manage} events={events} />)}</div>
          )}
        </Panel>
      )}

      <Panel title="Shared by us">
        {outgoing.length === 0 ? (
          <Empty>{my_org.name} isn't sharing anything with another organisation.</Empty>
        ) : (
          <div className="col g12">{outgoing.map((l) => <LinkRow key={l.id} link={l} canManage={can_manage} events={events} />)}</div>
        )}
      </Panel>
    </div>
  );
}

function OfferForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const dirFn = useServerFn(listLinkDirectory);
  const dir = useQuery({ queryKey: ["link-directory"], queryFn: () => dirFn() });
  const offer = useServerFn(offerLink);
  const [partner, setPartner] = useState("");
  const [scopes, setScopes] = useState<Scope[]>(["vessels", "voyages", "alerts", "search_rescue"]);
  const [purpose, setPurpose] = useState("");
  const [days, setDays] = useState(30);
  const m = useMutation({
    mutationFn: () => offer({ data: { partner_org_id: partner, scopes, purpose, days } }),
    onSuccess: () => {
      toast.success("Offer sent. They'll see it once they accept.");
      qc.invalidateQueries({ queryKey: ["org-links"] });
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggle = (s: Scope) => setScopes((v) => (v.includes(s) ? v.filter((x) => x !== s) : [...v, s]));

  return (
    <Panel title="Share with an organisation">
      <form className="col g12" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <label className="fl"><span>Organisation</span>
          <select className="in" value={partner} onChange={(e) => setPartner(e.target.value)} required>
            <option value="">{dir.isLoading ? "Loading…" : dir.data?.length ? "Choose an authority or responder" : "No authorities or responders are on the platform yet"}</option>
            {(dir.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name} · {TYPE[o.type] ?? o.type}</option>)}
          </select>
        </label>
        <fieldset className="col g6" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="t2" style={{ fontSize: 12.5, marginBottom: 4 }}>What they can see</legend>
          {SCOPES.map((s) => (
            <label key={s} className="row g8" style={{ fontSize: 13, alignItems: "flex-start" }}>
              <input type="checkbox" checked={scopes.includes(s)} onChange={() => toggle(s)} style={{ marginTop: 3 }} />
              <span><b>{SHORT[s]}</b> <span className="t3">— {SCOPE_LABEL[s].split(": ")[1] ?? SCOPE_LABEL[s]}</span></span>
            </label>
          ))}
          <span className="t3" style={{ fontSize: 12 }}>Never shared: phone numbers, emergency contacts, crew and passenger names, tracker links, evidence files.</span>
        </fieldset>
        <label className="fl"><span>Why you're sharing (they'll see this)</span>
          <textarea className="in" rows={2} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Marine police watch on the Ikorodu–CMS route during the festive period" maxLength={500} required />
        </label>
        <label className="fl" style={{ maxWidth: 240 }}><span>For how long</span>
          <select className="in" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[1, 7, 14, 30, 90, 180, 365].map((d) => <option key={d} value={d}>{d === 1 ? "1 day" : `${d} days`}</option>)}
          </select>
        </label>
        {scopes.includes("people") && <Notice tone="warn">Sharing tracked people's positions is personal data. Make sure the people tracked have agreed, or that you have another lawful basis under the Nigeria Data Protection Act.</Notice>}
        <div className="row g8">
          <button type="submit" className="b b-pri" disabled={!partner || scopes.length === 0 || purpose.trim().length < 10 || m.isPending}>{m.isPending ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />} Send offer</button>
          <button type="button" className="b b-gh" onClick={onDone}>Cancel</button>
        </div>
      </form>
    </Panel>
  );
}

function LinkRow({ link, canManage, events }: { link: OrgLink; canManage: boolean; events: LinkEvent[] }) {
  const qc = useQueryClient();
  const respond = useServerFn(respondLink);
  const revoke = useServerFn(revokeLink);
  const [showLog, setShowLog] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const done = (msg: string) => () => {
    toast.success(msg);
    qc.invalidateQueries({ queryKey: ["org-links"] });
  };
  const ans = useMutation({ mutationFn: (accept: boolean) => respond({ data: { id: link.id, accept } }), onSuccess: (_d, accept) => done(accept ? "Accepted. You can open the shared view now." : "Declined.")(), onError: (e: Error) => toast.error(e.message) });
  const end = useMutation({ mutationFn: () => revoke({ data: { id: link.id } }), onSuccess: done("Shared access ended."), onError: (e: Error) => toast.error(e.message) });
  const [label, tone] = STATUS[link.status];
  const other = link.direction === "outgoing" ? link.partner_name : link.owner_name;
  const log = events.filter((e) => e.link_id === link.id);
  const open = link.status === "active" || link.status === "pending";

  return (
    <div className="col g8" style={{ borderTop: "1px solid var(--line, rgba(127,127,127,.2))", paddingTop: 12 }}>
      <div className="row g8 wrap" style={{ alignItems: "center" }}>
        <b style={{ fontSize: 14 }}>{link.direction === "outgoing" ? `To ${other}` : `From ${other}`}</b>
        <Status tone={tone}>{label}</Status>
        <span className="f1" />
        {link.direction === "incoming" && link.status === "active" && <Link to="/app/links/$id" params={{ id: link.id }} className="b b-sm b-pri"><Eye size={14} /> Open shared view</Link>}
        {canManage && link.direction === "incoming" && link.status === "pending" && (
          <>
            <button type="button" className="b b-sm b-pri" disabled={ans.isPending} onClick={() => ans.mutate(true)}><Check size={14} /> Accept</button>
            <button type="button" className="b b-sm b-gh" disabled={ans.isPending} onClick={() => ans.mutate(false)}><X size={14} /> Decline</button>
          </>
        )}
        {canManage && open && !confirmEnd && !(link.direction === "incoming" && link.status === "pending") && <button type="button" className="b b-sm b-gh" onClick={() => setConfirmEnd(true)}>End sharing</button>}
        {confirmEnd && (
          <span className="row g6" style={{ alignItems: "center" }}>
            <span className="t2" style={{ fontSize: 12.5 }}>End now? {link.direction === "outgoing" ? `${other} loses access immediately.` : "You lose access immediately."}</span>
            <button type="button" className="b b-sm b-pri" disabled={end.isPending} onClick={() => end.mutate()}>End</button>
            <button type="button" className="b b-sm b-gh" onClick={() => setConfirmEnd(false)}>Keep</button>
          </span>
        )}
      </div>
      <div className="t2" style={{ fontSize: 13 }}>“{link.purpose}”</div>
      <div className="row g6 wrap">{link.scopes.map((s) => <span key={s} className="tg tg-blue">{SHORT[s]}</span>)}</div>
      <div className="t3" style={{ fontSize: 12 }}>
        Offered by {link.created_by_name ?? "—"} on {when(link.created_at)}
        {link.responded_at && ` · ${link.status === "declined" ? "declined" : "accepted"} by ${link.responded_by_name ?? "—"} on ${when(link.responded_at)}`}
        {link.revoked_at && ` · ended by ${link.revoked_by_name ?? "—"} on ${when(link.revoked_at)}`}
        {` · ${link.status === "expired" ? "expired" : "until"} ${when(link.expires_at)}`}
      </div>
      {log.length > 0 && (
        <div>
          <button type="button" className="b b-sm b-gh" onClick={() => setShowLog((v) => !v)}>{showLog ? "Hide" : "Show"} access record ({log.length})</button>
          {showLog && (
            <ul className="col g4" style={{ margin: "8px 0 0", padding: 0, listStyle: "none", fontSize: 12.5 }}>
              {log.map((e) => (
                <li key={e.id} className="t2"><span className="t3 mono">{when(e.created_at)}</span> · {e.actor_name ?? "Someone"} ({e.actor_org_name}) {ACTION[e.action] ?? e.action}{e.corridor ? `: ${e.corridor}` : ""}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
