import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { Empty, Notice, Panel, Status, type Tone } from "@/components/nw";
import { getRegulatedOverview, listSentNotices, sendNotice } from "@/lib/isps.functions";
import { BREACH_LABEL, FACILITY_KIND, LEVEL_LABEL } from "@/lib/isps.rules";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const dateOnly = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
const levelTone = (l: number): Tone => (l >= 3 ? "fail" : l === 2 ? "warn" : "ok");
const KIND: Record<string, string> = { directive: "Directive", advisory: "Advisory", security_level: "Security level instruction" };

/** What an authority (e.g. NIMASA's ISPS Unit) sees: regulated organisations that share with it, and notices. */
export function AuthorityView({ tab }: { tab: "regulated" | "sent" }) {
  const fn = useServerFn(getRegulatedOverview);
  const q = useQuery({ queryKey: ["isps-regulated"], queryFn: () => fn(), refetchInterval: 120_000 });
  if (q.isLoading) return <span className="row g8 t3"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</span>;
  if (q.error || !q.data) return <Notice tone="fail">{(q.error as Error)?.message || "Couldn't load regulated organisations."}</Notice>;
  return tab === "regulated" ? <Regulated data={q.data} /> : <Sent data={q.data} />;
}

type Reg = Awaited<ReturnType<typeof getRegulatedOverview>>;

function Regulated({ data }: { data: Reg }) {
  const [openOrg, setOpenOrg] = useState<string | null>(null);
  const isps = data.organisations.filter((o) => o.shares_isps);
  const facilities = isps.flatMap((o) => o.facilities);
  const byLevel = [1, 2, 3].map((l) => facilities.filter((f) => f.security_level === l).length);
  const unreported = data.breaches.filter((b) => !b.reported_to_authority).length;
  if (!data.organisations.length) return <Panel><Empty>No organisation shares access with you yet. Operators share from their Shared access page; ask them to include "ISPS compliance".</Empty></Panel>;
  return (
    <div className="col g16">
      <div className="grid g12" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        <Stat k="Organisations sharing ISPS records" v={`${isps.length}`} sub={data.organisations.length > isps.length ? `${data.organisations.length - isps.length} more share other data only` : undefined} />
        <Stat k="Facilities" v={`${facilities.length}`} sub={`L1 ${byLevel[0]} · L2 ${byLevel[1]} · L3 ${byLevel[2]}`} />
        <Stat k="Facilities with overdue records" v={`${facilities.filter((f) => f.flags.some((x) => x.tone === "fail")).length}`} tone={facilities.some((f) => f.flags.some((x) => x.tone === "fail")) ? "fail" : "ok"} />
        <Stat k="Breaches, last 90 days" v={`${data.breaches.length}`} sub={unreported ? `${unreported} not reported to you` : "all reported"} tone={unreported ? "fail" : undefined} />
      </div>

      <Panel title="Organisations">
        <div className="col g8" style={{ fontSize: 13 }}>
          {data.organisations.map((o) => (
            <div key={o.id} className="col g6" style={{ borderTop: "1px solid var(--line, rgba(127,127,127,.2))", paddingTop: 8 }}>
              <div className="row g8 wrap" style={{ alignItems: "center" }}>
                <b>{o.name}</b>
                {o.shares_isps ? (
                  <>
                    {o.max_level > 0 && <Status tone={levelTone(o.max_level)}>Highest level {o.max_level}</Status>}
                    <span className="t3">{o.facilities.length} facilit{o.facilities.length === 1 ? "y" : "ies"} · {o.declarations_90d} signed declarations in 90 days</span>
                    {o.failing > 0 && <Status tone="fail">{o.failing} overdue item{o.failing === 1 ? "" : "s"}</Status>}
                  </>
                ) : <span className="t3">Doesn't share ISPS records with you</span>}
                <span className="f1" />
                {o.shares_isps && <Link to="/app/isps-report" search={{ org: o.id }} className="b b-sm b-gh">Compliance report</Link>}
                <span className="t3" style={{ fontSize: 12 }}>access until {dateOnly(o.expires_at)}</span>
                <Link to="/app/links/$id" params={{ id: o.link_id }} className="b b-sm b-gh">Shared view</Link>
                {o.shares_isps && o.facilities.length > 0 && <button type="button" className="b b-sm b-gh" onClick={() => setOpenOrg(openOrg === o.id ? null : o.id)}>{openOrg === o.id ? "Hide" : "Facilities"}</button>}
              </div>
              {openOrg === o.id && o.facilities.map((f) => (
                <div key={f.id} className="col g4" style={{ paddingLeft: 12 }}>
                  <div className="row g8 wrap"><Status tone={levelTone(f.security_level)}>{LEVEL_LABEL[f.security_level]}</Status><b>{f.name}</b><span className="t3">{FACILITY_KIND[f.kind] ?? f.kind}{f.identifier ? ` · ${f.identifier}` : ""} · officer {f.security_officer_name ?? "not named"} · last drill {dateOnly(f.last_drill_on)} · last exercise {dateOnly(f.last_exercise_on)}</span></div>
                  {f.flags.length > 0 && <div className="row g6 wrap">{f.flags.map((x, i) => <Status key={i} tone={x.tone}>{x.text}</Status>)}</div>}
                </div>
              ))}
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Breaches, last 90 days">
        {data.breaches.length === 0 ? <Empty>None recorded by the organisations sharing with you.</Empty> : (
          <div className="col g6" style={{ fontSize: 13 }}>
            {data.breaches.map((b) => (
              <div key={b.id} className="row g8 wrap">
                <Status tone={b.status === "open" ? "fail" : "off"}>{b.status === "open" ? "Open" : "Closed"}</Status>
                <b>{BREACH_LABEL[b.category] ?? b.category}</b>
                <span className="t2">{b.organisation} · {b.facility} · {when(b.occurred_at)}</span>
                <span className="f1" />
                {b.reported_to_authority ? <span className="t3">reported {dateOnly(b.reported_at)}</span> : <Status tone="warn">Not reported</Status>}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Stat({ k, v, sub, tone }: { k: string; v: string; sub?: string; tone?: Tone }) {
  return (
    <div className="pn" style={{ padding: 12 }}>
      <div className="t3" style={{ fontSize: 12 }}>{k}</div>
      <div style={{ fontSize: 24, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{v}</div>
      {sub && <div className={tone === "fail" ? "" : "t3"} style={{ fontSize: 12, color: tone === "fail" ? "var(--fail, #F2384B)" : undefined }}>{sub}</div>}
    </div>
  );
}

function Sent({ data }: { data: Reg }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listSentNotices);
  const sent = useQuery({ queryKey: ["isps-sent"], queryFn: () => listFn(), refetchInterval: 60_000 });
  const sendFn = useServerFn(sendNotice);
  const [show, setShow] = useState(false);
  const [f, setF] = useState({ kind: "advisory" as "directive" | "advisory" | "security_level", title: "", body: "", required_level: 2, respond_by: "", org_ids: [] as string[] });
  const m = useMutation({
    mutationFn: () => sendFn({ data: { kind: f.kind, title: f.title, body: f.body, required_level: f.kind === "security_level" ? f.required_level : null, respond_by: f.respond_by ? new Date(f.respond_by).toISOString() : null, org_ids: f.org_ids } }),
    onSuccess: (r) => { toast.success(`Notice ${r.reference} delivered to ${r.recipients} organisation${r.recipients === 1 ? "" : "s"}.`); qc.invalidateQueries({ queryKey: ["isps-sent"] }); setShow(false); setF({ ...f, title: "", body: "", org_ids: [] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggle = (id: string) => setF((v) => ({ ...v, org_ids: v.org_ids.includes(id) ? v.org_ids.filter((x) => x !== id) : [...v.org_ids, id] }));
  return (
    <div className="col g16">
      {data.can_send && !show && <button type="button" className="b b-pri" style={{ alignSelf: "flex-start" }} onClick={() => setShow(true)}><Send size={14} /> Issue a notice</button>}
      {show && (
        <Panel title="Issue a notice">
          <form className="col g10" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
            <div className="row g6 wrap" role="radiogroup">
              {(["advisory", "directive", "security_level"] as const).map((k) => <button key={k} type="button" role="radio" aria-checked={f.kind === k} className={`b b-sm ${f.kind === k ? "b-pri" : "b-gh"}`} onClick={() => setF({ ...f, kind: k })}>{KIND[k]}</button>)}
            </div>
            {f.kind === "security_level" && (
              <label className="fl" style={{ maxWidth: 260 }}><span>Level to set</span><select className="in" value={f.required_level} onChange={(e) => setF({ ...f, required_level: Number(e.target.value) })}>{[1, 2, 3].map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}</select></label>
            )}
            <label className="fl"><span>Title</span><input className="in" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={200} required /></label>
            <label className="fl"><span>Notice</span><textarea className="in" rows={6} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} maxLength={8000} required /></label>
            <label className="fl" style={{ maxWidth: 260 }}><span>Acknowledge by (optional)</span><input type="datetime-local" className="in" value={f.respond_by} onChange={(e) => setF({ ...f, respond_by: e.target.value })} /></label>
            <fieldset className="col g6" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="t2" style={{ fontSize: 12.5, marginBottom: 4 }}>Send to</legend>
              <label className="row g8" style={{ fontSize: 13 }}><input type="checkbox" checked={f.org_ids.length === data.organisations.length && data.organisations.length > 0} onChange={(e) => setF({ ...f, org_ids: e.target.checked ? data.organisations.map((o) => o.id) : [] })} /> All ({data.organisations.length})</label>
              {data.organisations.map((o) => <label key={o.id} className="row g8" style={{ fontSize: 13 }}><input type="checkbox" checked={f.org_ids.includes(o.id)} onChange={() => toggle(o.id)} /> {o.name}</label>)}
            </fieldset>
            <span className="t3" style={{ fontSize: 12 }}>Each organisation gets an in-app alert. You'll see when they first open it and who acknowledges it. No SMS or email is sent.</span>
            <div className="row g8">
              <button type="submit" className="b b-pri" disabled={m.isPending || !f.org_ids.length || f.title.trim().length < 3 || f.body.trim().length < 3}>{m.isPending && <Loader2 size={14} className="animate-spin" />} Issue to {f.org_ids.length}</button>
              <button type="button" className="b b-gh" onClick={() => setShow(false)}>Cancel</button>
            </div>
          </form>
        </Panel>
      )}
      {sent.isLoading ? <span className="row g8 t3"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</span> : !(sent.data ?? []).length ? <Panel><Empty>No notices issued yet.</Empty></Panel> : (
        (sent.data ?? []).map((n) => {
          const acked = n.recipients.filter((r) => r.acknowledged_at).length;
          const read = n.recipients.filter((r) => r.first_read_at).length;
          return (
            <Panel key={n.id} title={<span className="row g8 wrap" style={{ alignItems: "center" }}><Status tone={n.kind === "advisory" ? "blue" : "fail"}>{KIND[n.kind]}{n.required_level ? ` · level ${n.required_level}` : ""}</Status> {n.title}</span>} meta={`${n.reference} · ${when(n.issued_at)}`}>
              <div className="col g8" style={{ fontSize: 13 }}>
                <span className="t2">{read}/{n.recipients.length} opened · {acked}/{n.recipients.length} acknowledged{n.respond_by ? ` · due ${when(n.respond_by)}` : ""} · issued by {n.issued_by_name ?? "—"}</span>
                <div className="col g4">
                  {n.recipients.map((r, i) => (
                    <div key={i} className="row g8 wrap">
                      <b>{r.org}</b>
                      {r.acknowledged_at ? <Status tone="ok">Acknowledged {when(r.acknowledged_at)} · {r.acknowledged_by_name}</Status> : r.first_read_at ? <Status tone="warn">Opened {when(r.first_read_at)} by {r.first_read_by_name}, not acknowledged</Status> : <Status tone={n.respond_by && Date.parse(n.respond_by) < Date.now() ? "fail" : "off"}>Delivered {when(r.delivered_at)}, not opened</Status>}
                      {r.response && <span className="t2">“{r.response}”</span>}
                    </div>
                  ))}
                </div>
                <span className="t3 mono" style={{ fontSize: 11 }}>SHA-256 {n.body_sha256}</span>
              </div>
            </Panel>
          );
        })
      )}
    </div>
  );
}
