import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Anchor, Check, Copy, FileSignature, FileText, Loader2, Plus, ShieldAlert } from "lucide-react";
import { requireFeature, requireSectionAccess } from "@/lib/rbac";
import { Empty, Notice, PageHeader, Panel, Status, type Tone } from "@/components/nw";
import {
  acknowledgeNotice,
  createDeclaration,
  getIspsOverview,
  listReceivedNotices,
  markNoticeRead,
  recordBreach,
  recordDrill,
  saveFacility,
  setSecurityLevel,
  updateBreach,
  type Facility,
  type ReceivedNotice,
} from "@/lib/isps.functions";
import { BREACH_LABEL, FACILITY_KIND, LEVEL_LABEL } from "@/lib/isps.rules";
import { AuthorityView } from "@/components/isps/Authority";
import { BroadcastsPanel, MyIspsAcks } from "@/components/isps/Broadcasts";

export const Route = createFileRoute("/app/isps")({
  head: () => ({ meta: [{ title: "ISPS Watch · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    requireSectionAccess(context.appAccess, ["security_manager", "operator", "client_admin", "security_forensic_analyst"]);
    requireFeature(context.appAccess, "isps");
  },
  component: IspsPage,
});

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const dateOnly = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
const levelTone = (l: number): Tone => (l >= 3 ? "fail" : l === 2 ? "warn" : "ok");
const today = () => new Date().toISOString().slice(0, 10);
const localNow = (offsetH = 0) => {
  const d = new Date(Date.now() + offsetH * 3_600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const iso = (local: string) => new Date(local).toISOString();

type Tab = "facilities" | "notices" | "drills" | "declarations" | "breaches" | "regulated" | "sent";

function IspsPage() {
  const fn = useServerFn(getIspsOverview);
  const q = useQuery({ queryKey: ["isps"], queryFn: () => fn() });
  const nFn = useServerFn(listReceivedNotices);
  const notices = useQuery({ queryKey: ["isps-notices"], queryFn: () => nFn(), refetchInterval: 60_000 });
  const isAuthority = q.data?.org.type === "authority";
  const [tab, setTab] = useState<Tab>("facilities");
  useEffect(() => {
    if (isAuthority) setTab("regulated");
  }, [isAuthority]);

  if (q.isLoading) return <span className="row g8 t3"><Loader2 className="h-4 w-4 animate-spin" /> Loading ISPS Watch…</span>;
  if (q.error || !q.data) return <Notice tone="fail">{(q.error as Error)?.message || "Couldn't load ISPS Watch. If this is new, the database update may not be applied yet."}</Notice>;
  const d = q.data;
  const unacked = (notices.data ?? []).filter((n) => !n.acknowledged_at).length;
  const tabs: [Tab, string][] = isAuthority
    ? [["regulated", "Regulated organisations"], ["sent", "Notices sent"]]
    : [["facilities", "Facilities and levels"], ["notices", `Notices${unacked ? ` (${unacked})` : ""}`], ["drills", "Drills and exercises"], ["declarations", "Declarations of Security"], ["breaches", "Breach register"]];

  return (
    <div className="col g16">
      <PageHeader
        title="ISPS Watch"
        sub={isAuthority ? "Security levels, drills, declarations and breaches at the organisations that share ISPS records with you, and formal notices with read receipts." : "Your ISPS Code records in one place: security levels, drills and exercises, Declarations of Security and the breach register, plus notices from the authority."}
           >
        {!isAuthority && <Link to="/app/isps-report" className="b b-sec b-sm"><FileText size={13} /> Compliance report</Link>}
      </PageHeader>
      {!isAuthority && <MyIspsAcks />}
      {!isAuthority && unacked > 0 && tab !== "notices" && (
        <Notice tone="fail">{unacked} notice{unacked === 1 ? "" : "s"} from the authority waiting for acknowledgement. <button type="button" className="b b-sm b-gh" onClick={() => setTab("notices")}>Read now</button></Notice>
      )}
      <div className="row g6 wrap" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`b b-sm ${tab === k ? "b-pri" : "b-gh"}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {isAuthority ? (
        <AuthorityView tab={tab === "sent" ? "sent" : "regulated"} />
      ) : (
        <>
          {tab === "facilities" && (
            <>
              <Facilities data={d} />
              <BroadcastsPanel />
            </>
          )}
          {tab === "notices" && <Notices notices={notices.data ?? []} loading={notices.isLoading} facilities={d.facilities} canManage={d.can_manage} />}
          {tab === "drills" && <Drills data={d} />}
          {tab === "declarations" && <Declarations data={d} />}
          {tab === "breaches" && <Breaches data={d} />}
        </>
      )}
    </div>
  );
}

type Overview = Awaited<ReturnType<typeof getIspsOverview>>;
const facName = (d: Overview, id: string) => d.facilities.find((f) => f.id === id)?.name ?? "—";

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["isps"] });
    qc.invalidateQueries({ queryKey: ["isps-notices"] });
  };
}

// ───────────────────────────── Facilities ─────────────────────────────

function Facilities({ data }: { data: Overview }) {
  const [editing, setEditing] = useState<Facility | "new" | null>(null);
  const [levelFor, setLevelFor] = useState<Facility | null>(null);
  return (
    <div className="col g16">
      {data.can_manage && !editing && <button type="button" className="b b-pri" style={{ alignSelf: "flex-start" }} onClick={() => setEditing("new")}><Plus size={14} /> Add a facility or ship</button>}
      {editing && <FacilityForm facility={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      {levelFor && <LevelForm facilities={[levelFor]} onDone={() => setLevelFor(null)} />}
      {data.facilities.length === 0 ? (
        <Panel><Empty>No facilities yet. Add your port facility, terminal, jetty or ship to start keeping ISPS records.</Empty></Panel>
      ) : (
        data.facilities.map((f) => (
          <Panel key={f.id} title={<span className="row g8" style={{ alignItems: "center" }}><Anchor size={15} /> {f.name}</span>} meta={`${FACILITY_KIND[f.kind] ?? f.kind}${f.identifier ? ` · ${f.identifier}` : ""}`}
            actions={data.can_manage ? <div className="row g6"><button type="button" className="b b-sm b-gh" onClick={() => setLevelFor(f)}>Change level</button><button type="button" className="b b-sm b-gh" onClick={() => setEditing(f)}>Edit</button></div> : undefined}>
            <div className="col g10" style={{ fontSize: 13 }}>
              <div className="row g8 wrap" style={{ alignItems: "center" }}>
                <Status tone={levelTone(f.security_level)}>{LEVEL_LABEL[f.security_level]}</Status>
                <span className="t3">since {when(f.level_set_at)}{f.level_set_by_name ? ` · ${f.level_set_by_name}` : ""}{f.level_reason ? ` · “${f.level_reason}”` : ""}</span>
              </div>
              <div className="grid g8" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                <KV k="Security officer" v={f.security_officer_name ? `${f.security_officer_name}${f.security_officer_phone ? ` · ${f.security_officer_phone}` : ""}` : "—"} />
                <KV k="Plan approved" v={`${dateOnly(f.plan_approved_on)}${f.plan_expires_on ? ` · until ${dateOnly(f.plan_expires_on)}` : ""}`} />
                <KV k="Last drill" v={dateOnly(f.last_drill_on)} />
                <KV k="Last exercise" v={dateOnly(f.last_exercise_on)} />
                <KV k="Open breaches" v={String(f.open_breaches)} />
              </div>
              {f.flags.length === 0 ? <Notice tone="ok">Records up to date.</Notice> : (
                <div className="col g4">{f.flags.map((x, i) => <Status key={i} tone={x.tone}>{x.text}</Status>)}</div>
              )}
            </div>
          </Panel>
        ))
      )}
      {data.level_changes.length > 0 && (
        <Panel title="Security level history">
          <div className="col g6" style={{ fontSize: 13 }}>
            {data.level_changes.map((c) => (
              <div key={c.id} className="row g8 wrap">
                <span className="t3 mono" style={{ fontSize: 12 }}>{when(c.created_at)}</span>
                <b>{facName(data, c.facility_id)}</b>
                <span>Level {c.from_level} → <Status tone={levelTone(c.to_level)}>{c.to_level}</Status></span>
                <span className="t2">“{c.reason}” · {c.changed_by_name ?? "—"}{c.notice_id ? " · on an authority notice" : ""}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}
      <p className="t3" style={{ fontSize: 12 }}>Checks follow the ISPS Code Part B guidance: a drill at least every three months, and an exercise every calendar year with no more than 18 months between. They are reminders for the security officer, not a legal opinion.</p>
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="col"><span className="t3" style={{ fontSize: 11.5 }}>{k}</span><span>{v}</span></div>;
}

function FacilityForm({ facility, onDone }: { facility: Facility | null; onDone: () => void }) {
  const refresh = useRefresh();
  const save = useServerFn(saveFacility);
  const [f, setF] = useState({
    name: facility?.name ?? "", kind: facility?.kind ?? "port_facility", identifier: facility?.identifier ?? "", security_officer_name: facility?.security_officer_name ?? "",
    security_officer_phone: facility?.security_officer_phone ?? "", plan_approved_on: facility?.plan_approved_on ?? "", plan_expires_on: facility?.plan_expires_on ?? "", notes: facility?.notes ?? "",
  });
  const m = useMutation({
    mutationFn: () => save({ data: { id: facility?.id ?? null, ...f, kind: f.kind as any, plan_approved_on: f.plan_approved_on || null, plan_expires_on: f.plan_expires_on || null } }),
    onSuccess: () => { toast.success("Saved."); refresh(); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Panel title={facility ? `Edit ${facility.name}` : "Add a facility or ship"}>
      <form className="grid g10" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }} onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <label className="fl"><span>Name</span><input className="in" value={f.name} onChange={set("name")} required maxLength={160} /></label>
        <label className="fl"><span>Type</span><select className="in" value={f.kind} onChange={set("kind")}>{Object.entries(FACILITY_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="fl"><span>{f.kind === "ship" ? "IMO number" : "IMO facility number (GISIS)"}</span><input className="in" value={f.identifier} onChange={set("identifier")} maxLength={60} /></label>
        <label className="fl"><span>{f.kind === "ship" ? "Ship security officer" : "Port facility security officer"}</span><input className="in" value={f.security_officer_name} onChange={set("security_officer_name")} maxLength={120} /></label>
        <label className="fl"><span>Officer's phone</span><input className="in" value={f.security_officer_phone} onChange={set("security_officer_phone")} maxLength={40} /></label>
        <label className="fl"><span>Security plan approved on</span><input type="date" className="in" value={f.plan_approved_on} onChange={set("plan_approved_on")} /></label>
        <label className="fl"><span>Approval valid until</span><input type="date" className="in" value={f.plan_expires_on} onChange={set("plan_expires_on")} /></label>
        <label className="fl" style={{ gridColumn: "1 / -1" }}><span>Notes</span><textarea className="in" rows={2} value={f.notes} onChange={set("notes")} maxLength={2000} /></label>
        <div className="row g8" style={{ gridColumn: "1 / -1" }}>
          <button type="submit" className="b b-pri" disabled={m.isPending || !f.name.trim()}>{m.isPending && <Loader2 size={14} className="animate-spin" />} Save</button>
          <button type="button" className="b b-gh" onClick={onDone}>Cancel</button>
        </div>
      </form>
    </Panel>
  );
}

function LevelForm({ facilities, initialLevel, initialReason, noticeId, onDone }: { facilities: Facility[]; initialLevel?: number; initialReason?: string; noticeId?: string; onDone: () => void }) {
  const refresh = useRefresh();
  const fn = useServerFn(setSecurityLevel);
  const [level, setLevel] = useState(initialLevel ?? facilities[0]?.security_level ?? 1);
  const [reason, setReason] = useState(initialReason ?? "");
  const m = useMutation({
    mutationFn: () => fn({ data: { facility_ids: facilities.map((f) => f.id), level, reason, notice_id: noticeId ?? null } }),
    onSuccess: (r) => { toast.success(r.changed ? `Security level ${level} set.` : "Already at that level."); refresh(); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Panel title={`Change security level · ${facilities.map((f) => f.name).join(", ")}`}>
      <form className="col g10" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <div className="row g6 wrap" role="radiogroup">
          {[1, 2, 3].map((l) => <button key={l} type="button" role="radio" aria-checked={level === l} className={`b b-sm ${level === l ? "b-pri" : "b-gh"}`} onClick={() => setLevel(l)}>{LEVEL_LABEL[l]}</button>)}
        </div>
        <label className="fl"><span>Reason (recorded and shown in the history)</span><input className="in" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Directed by the Designated Authority" required /></label>
        {level >= 2 && <span className="t3" style={{ fontSize: 12 }}>Raising to level {level} also alerts everyone in your organisation in the app.</span>}
        <div className="row g8">
          <button type="submit" className="b b-pri" disabled={m.isPending || reason.trim().length < 3}>{m.isPending && <Loader2 size={14} className="animate-spin" />} Set level {level}</button>
          <button type="button" className="b b-gh" onClick={onDone}>Cancel</button>
        </div>
      </form>
    </Panel>
  );
}

// ───────────────────────────── Notices received ─────────────────────────────

function Notices({ notices, loading, facilities, canManage }: { notices: ReceivedNotice[]; loading: boolean; facilities: Facility[]; canManage: boolean }) {
  if (loading) return <span className="row g8 t3"><Loader2 className="h-4 w-4 animate-spin" /> Loading notices…</span>;
  if (!notices.length) return <Panel><Empty>No notices from an authority. Authorities can send you notices once you share access with them.</Empty></Panel>;
  return <div className="col g12">{notices.map((n) => <NoticeCard key={n.id} n={n} facilities={facilities} canManage={canManage} />)}</div>;
}

const NOTICE_KIND: Record<string, [string, Tone]> = { directive: ["Directive", "fail"], advisory: ["Advisory", "blue"], security_level: ["Security level instruction", "fail"] };

function NoticeCard({ n, facilities, canManage }: { n: ReceivedNotice; facilities: Facility[]; canManage: boolean }) {
  const refresh = useRefresh();
  const readFn = useServerFn(markNoticeRead);
  const ackFn = useServerFn(acknowledgeNotice);
  const [open, setOpen] = useState(!n.acknowledged_at);
  const [response, setResponse] = useState("");
  const [raising, setRaising] = useState(false);
  useEffect(() => {
    if (open && !n.first_read_at) readFn({ data: { id: n.id } }).then(refresh).catch(() => undefined);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const ack = useMutation({ mutationFn: () => ackFn({ data: { id: n.id, response: response || null } }), onSuccess: () => { toast.success("Acknowledged. The authority can see this."); refresh(); }, onError: (e: Error) => toast.error(e.message) });
  const below = n.required_level ? facilities.filter((f) => f.security_level < n.required_level!) : [];
  const [label, tone] = NOTICE_KIND[n.kind];
  return (
    <Panel title={<span className="row g8 wrap" style={{ alignItems: "center" }}><Status tone={tone}>{label}</Status> {n.title}</span>} meta={`${n.reference} · ${n.from_org}`}
      actions={<button type="button" className="b b-sm b-gh" onClick={() => setOpen((v) => !v)}>{open ? "Hide" : "Read"}</button>}>
      <div className="col g10" style={{ fontSize: 13 }}>
        <span className="t3">Issued {when(n.issued_at)} by {n.issued_by_name ?? "—"}{n.respond_by ? ` · respond by ${when(n.respond_by)}` : ""}</span>
        {open && <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{n.body}</div>}
        {open && n.required_level && (
          below.length ? (
            <Notice tone="fail">
              Set security level {n.required_level}. Below that now: {below.map((f) => f.name).join(", ")}.
              {canManage && !raising && <> <button type="button" className="b b-sm b-pri" onClick={() => setRaising(true)}>Raise to level {n.required_level}</button></>}
            </Notice>
          ) : facilities.length ? <Notice tone="ok">All your facilities are at level {n.required_level} or higher.</Notice> : null
        )}
        {raising && <LevelForm facilities={below} initialLevel={n.required_level!} initialReason={`Authority notice ${n.reference}`} noticeId={n.id} onDone={() => setRaising(false)} />}
        {n.acknowledged_at ? (
          <Status tone="ok">Acknowledged {when(n.acknowledged_at)} by {n.acknowledged_by_name}{n.response ? ` · “${n.response}”` : ""}</Status>
        ) : open ? (
          <div className="col g6">
            <textarea className="in" rows={2} placeholder="Optional reply to the authority (e.g. what you've done)" value={response} onChange={(e) => setResponse(e.target.value)} maxLength={4000} />
            <button type="button" className="b b-pri" style={{ alignSelf: "flex-start" }} disabled={ack.isPending} onClick={() => ack.mutate()}><Check size={14} /> Acknowledge</button>
            <span className="t3" style={{ fontSize: 12 }}>The authority sees when your organisation first opened this notice, and who acknowledged it.</span>
          </div>
        ) : null}
        <span className="t3 mono" style={{ fontSize: 11 }}>SHA-256 {n.body_sha256}</span>
      </div>
    </Panel>
  );
}

// ───────────────────────────── Drills ─────────────────────────────

function Drills({ data }: { data: Overview }) {
  const refresh = useRefresh();
  const fn = useServerFn(recordDrill);
  const [show, setShow] = useState(false);
  const [f, setF] = useState({ facility_id: data.facilities[0]?.id ?? "", kind: "drill" as "drill" | "exercise", scenario: "", held_on: today(), participants: "", findings: "", corrective_actions: "" });
  const m = useMutation({
    mutationFn: () => fn({ data: { ...f, participants: f.participants ? Number(f.participants) : null, findings: f.findings || null, corrective_actions: f.corrective_actions || null } }),
    onSuccess: () => { toast.success("Recorded."); refresh(); setShow(false); setF({ ...f, scenario: "", findings: "", corrective_actions: "", participants: "" }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  if (!data.facilities.length) return <Panel><Empty>Add a facility first.</Empty></Panel>;
  return (
    <div className="col g16">
      {data.can_record && !show && <button type="button" className="b b-pri" style={{ alignSelf: "flex-start" }} onClick={() => setShow(true)}><Plus size={14} /> Record a drill or exercise</button>}
      {show && (
        <Panel title="Record a drill or exercise">
          <form className="grid g10" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }} onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
            <label className="fl"><span>Facility</span><select className="in" value={f.facility_id} onChange={set("facility_id")}>{data.facilities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label className="fl"><span>Type</span><select className="in" value={f.kind} onChange={set("kind")}><option value="drill">Drill (one part of the plan)</option><option value="exercise">Exercise (full plan, may involve authorities)</option></select></label>
            <label className="fl"><span>Held on</span><input type="date" className="in" value={f.held_on} max={today()} onChange={set("held_on")} required /></label>
            <label className="fl"><span>People taking part</span><input className="in" inputMode="numeric" value={f.participants} onChange={(e) => setF({ ...f, participants: e.target.value.replace(/\D/g, "").slice(0, 5) })} /></label>
            <label className="fl" style={{ gridColumn: "1 / -1" }}><span>Scenario</span><input className="in" value={f.scenario} onChange={set("scenario")} maxLength={300} placeholder="e.g. Unauthorised boat approaching the jetty at night" required /></label>
            <label className="fl" style={{ gridColumn: "1 / -1" }}><span>What was found</span><textarea className="in" rows={2} value={f.findings} onChange={set("findings")} maxLength={4000} /></label>
            <label className="fl" style={{ gridColumn: "1 / -1" }}><span>Corrective actions</span><textarea className="in" rows={2} value={f.corrective_actions} onChange={set("corrective_actions")} maxLength={4000} /></label>
            <div className="row g8" style={{ gridColumn: "1 / -1" }}>
              <button type="submit" className="b b-pri" disabled={m.isPending || f.scenario.trim().length < 3}>{m.isPending && <Loader2 size={14} className="animate-spin" />} Record</button>
              <button type="button" className="b b-gh" onClick={() => setShow(false)}>Cancel</button>
            </div>
          </form>
        </Panel>
      )}
      <Panel title="Drills and exercises">
        {data.drills.length === 0 ? <Empty>None recorded.</Empty> : (
          <div className="col g10" style={{ fontSize: 13 }}>
            {data.drills.map((x) => (
              <div key={x.id} className="col g4" style={{ borderTop: "1px solid var(--line, rgba(127,127,127,.2))", paddingTop: 8 }}>
                <div className="row g8 wrap"><Status tone={x.kind === "exercise" ? "blue" : "neutral"}>{x.kind === "exercise" ? "Exercise" : "Drill"}</Status><b>{x.scenario}</b><span className="t3">{facName(data, x.facility_id)} · {dateOnly(x.held_on)}{x.participants != null ? ` · ${x.participants} people` : ""} · recorded by {x.recorded_by_name ?? "—"}</span></div>
                {x.findings && <span className="t2"><b>Found:</b> {x.findings}</span>}
                {x.corrective_actions && <span className="t2"><b>Actions:</b> {x.corrective_actions}</span>}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

// ───────────────────────────── Declarations ─────────────────────────────

function Declarations({ data }: { data: Overview }) {
  const refresh = useRefresh();
  const fn = useServerFn(createDeclaration);
  const [show, setShow] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const first = data.facilities.find((x) => x.kind !== "ship") ?? data.facilities[0];
  const [f, setF] = useState({ facility_id: first?.id ?? "", ship_name: "", ship_imo: "", ship_flag: "", security_level: first?.security_level ?? 1, activities: "", measures: "", valid_from: localNow(), valid_to: localNow(24), port_signatory_title: "Port Facility Security Officer" });
  const m = useMutation({
    mutationFn: () => fn({ data: { ...f, ship_imo: f.ship_imo || null, ship_flag: f.ship_flag || null, valid_from: iso(f.valid_from), valid_to: iso(f.valid_to) } }),
    onSuccess: (r) => { toast.success("Declaration signed for the facility. Send the link to the ship."); setLink(r.sign_url); refresh(); setShow(false); },
    onError: (e: Error) => toast.error(e.message),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: k === "security_level" ? Number(e.target.value) : e.target.value });
  if (!data.facilities.length) return <Panel><Empty>Add a facility first.</Empty></Panel>;
  const STATUS: Record<string, [string, Tone]> = { awaiting_ship: ["Waiting for the ship to sign", "warn"], signed: ["Signed by both", "ok"], cancelled: ["Cancelled", "off"] };
  return (
    <div className="col g16">
      {link && (
        <Notice tone="ok">
          Send this link to the ship's master or security officer. They read the declaration and sign on their phone, no account needed:
          <span className="row g6 wrap" style={{ marginTop: 6 }}><code className="mono" style={{ wordBreak: "break-all" }}>{link}</code><button type="button" className="b b-sm b-gh" onClick={() => navigator.clipboard.writeText(link).then(() => toast.success("Link copied."))}><Copy size={13} /> Copy</button></span>
        </Notice>
      )}
      {data.can_record && !show && <button type="button" className="b b-pri" style={{ alignSelf: "flex-start" }} onClick={() => setShow(true)}><FileSignature size={14} /> New Declaration of Security</button>}
      {show && (
        <Panel title="New Declaration of Security">
          <form className="grid g10" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }} onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
            <label className="fl"><span>Facility</span><select className="in" value={f.facility_id} onChange={(e) => { const x = data.facilities.find((y) => y.id === e.target.value); setF({ ...f, facility_id: e.target.value, security_level: x?.security_level ?? f.security_level }); }}>{data.facilities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label className="fl"><span>Security level</span><select className="in" value={f.security_level} onChange={set("security_level")}>{[1, 2, 3].map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}</select></label>
            <label className="fl"><span>Ship name</span><input className="in" value={f.ship_name} onChange={set("ship_name")} maxLength={160} required /></label>
            <label className="fl"><span>IMO number</span><input className="in" value={f.ship_imo} onChange={set("ship_imo")} maxLength={20} /></label>
            <label className="fl"><span>Flag</span><input className="in" value={f.ship_flag} onChange={set("ship_flag")} maxLength={60} /></label>
            <label className="fl"><span>Valid from</span><input type="datetime-local" className="in" value={f.valid_from} onChange={set("valid_from")} required /></label>
            <label className="fl"><span>Valid until</span><input type="datetime-local" className="in" value={f.valid_to} onChange={set("valid_to")} required /></label>
            <label className="fl"><span>Your title</span><input className="in" value={f.port_signatory_title} onChange={set("port_signatory_title")} maxLength={120} required /></label>
            <label className="fl" style={{ gridColumn: "1 / -1" }}><span>Activities covered</span><input className="in" value={f.activities} onChange={set("activities")} maxLength={1000} placeholder="e.g. Berthing at Jetty 2, discharge of 300 t bagged cement, crew change" required /></label>
            <label className="fl" style={{ gridColumn: "1 / -1" }}><span>Security measures agreed, and who does each</span><textarea className="in" rows={5} value={f.measures} onChange={set("measures")} maxLength={4000} required
              placeholder={"Access to the ship: ship controls gangway, ID check of all visitors\nRestricted areas: port facility guards the quay apron\nCargo handling: port facility seals checked before loading\nStores delivery: ship checks against order list\nMonitoring: port CCTV on berth, ship deck watch\nCommunications: VHF 12, PFSO phone …"} /></label>
            <span className="t3" style={{ fontSize: 12, gridColumn: "1 / -1" }}>Saving signs the declaration for the facility in your name. The content is fingerprinted, and the ship signs exactly this text.</span>
            <div className="row g8" style={{ gridColumn: "1 / -1" }}>
              <button type="submit" className="b b-pri" disabled={m.isPending || !f.ship_name.trim() || f.activities.trim().length < 3 || f.measures.trim().length < 3}>{m.isPending && <Loader2 size={14} className="animate-spin" />} Sign and create link for the ship</button>
              <button type="button" className="b b-gh" onClick={() => setShow(false)}>Cancel</button>
            </div>
          </form>
        </Panel>
      )}
      <Panel title="Declarations of Security">
        {data.declarations.length === 0 ? <Empty>None yet.</Empty> : (
          <div className="col g8" style={{ fontSize: 13 }}>
            {data.declarations.map((x) => (
              <div key={x.id} className="row g8 wrap" style={{ alignItems: "center" }}>
                <Status tone={STATUS[x.status][1]}>{STATUS[x.status][0]}</Status>
                <b>{x.ship_name}</b>
                <span className="t3">{x.reference} · {facName(data, x.facility_id)} · level {x.security_level} · {when(x.valid_from)} to {when(x.valid_to)}</span>
                <span className="f1" />
                <Link to="/app/isps/dos/$id" params={{ id: x.id }} className="b b-sm b-gh">Open</Link>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

// ───────────────────────────── Breaches ─────────────────────────────

function Breaches({ data }: { data: Overview }) {
  const refresh = useRefresh();
  const fn = useServerFn(recordBreach);
  const upd = useServerFn(updateBreach);
  const [show, setShow] = useState(false);
  const [reportFor, setReportFor] = useState<string | null>(null);
  const [reportTo, setReportTo] = useState("");
  const [f, setF] = useState({ facility_id: data.facilities[0]?.id ?? "", occurred_at: localNow(), category: "unauthorised_access", description: "", action_taken: "" });
  const m = useMutation({
    mutationFn: () => fn({ data: { ...f, category: f.category as any, occurred_at: iso(f.occurred_at), action_taken: f.action_taken || null } }),
    onSuccess: () => { toast.success("Recorded in the breach register."); refresh(); setShow(false); setF({ ...f, description: "", action_taken: "" }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const u = useMutation({ mutationFn: (v: { id: string; reported_to?: string; close?: boolean }) => upd({ data: v }), onSuccess: () => { refresh(); setReportFor(null); setReportTo(""); }, onError: (e: Error) => toast.error(e.message) });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  if (!data.facilities.length) return <Panel><Empty>Add a facility first.</Empty></Panel>;
  return (
    <div className="col g16">
      {data.can_record && !show && <button type="button" className="b b-pri" style={{ alignSelf: "flex-start" }} onClick={() => setShow(true)}><ShieldAlert size={14} /> Record a breach or security incident</button>}
      {show && (
        <Panel title="Record a breach or security incident">
          <form className="grid g10" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }} onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
            <label className="fl"><span>Facility</span><select className="in" value={f.facility_id} onChange={set("facility_id")}>{data.facilities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label className="fl"><span>When</span><input type="datetime-local" className="in" value={f.occurred_at} max={localNow()} onChange={set("occurred_at")} required /></label>
            <label className="fl"><span>What kind</span><select className="in" value={f.category} onChange={set("category")}>{Object.entries(BREACH_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="fl" style={{ gridColumn: "1 / -1" }}><span>What happened</span><textarea className="in" rows={3} value={f.description} onChange={set("description")} maxLength={4000} required /></label>
            <label className="fl" style={{ gridColumn: "1 / -1" }}><span>Action taken</span><textarea className="in" rows={2} value={f.action_taken} onChange={set("action_taken")} maxLength={4000} /></label>
            <span className="t3" style={{ fontSize: 12, gridColumn: "1 / -1" }}>The facility's current security level is recorded with the breach.</span>
            <div className="row g8" style={{ gridColumn: "1 / -1" }}>
              <button type="submit" className="b b-pri" disabled={m.isPending || f.description.trim().length < 3}>{m.isPending && <Loader2 size={14} className="animate-spin" />} Record</button>
              <button type="button" className="b b-gh" onClick={() => setShow(false)}>Cancel</button>
            </div>
          </form>
        </Panel>
      )}
      <Panel title="Breach register">
        {data.breaches.length === 0 ? <Empty>No breaches recorded.</Empty> : (
          <div className="col g10" style={{ fontSize: 13 }}>
            {data.breaches.map((b) => (
              <div key={b.id} className="col g4" style={{ borderTop: "1px solid var(--line, rgba(127,127,127,.2))", paddingTop: 8 }}>
                <div className="row g8 wrap" style={{ alignItems: "center" }}>
                  <Status tone={b.status === "open" ? "fail" : "off"}>{b.status === "open" ? "Open" : "Closed"}</Status>
                  <b>{BREACH_LABEL[b.category] ?? b.category}</b>
                  <span className="t3">{facName(data, b.facility_id)} · {when(b.occurred_at)}{b.security_level ? ` · at level ${b.security_level}` : ""} · {b.recorded_by_name ?? "—"}</span>
                  <span className="f1" />
                  {b.reported_to_authority ? <Status tone="ok">Reported to {b.reported_to} {dateOnly(b.reported_at)}</Status> : <Status tone="warn">Not reported to the authority</Status>}
                </div>
                <span className="t2">{b.description}</span>
                {b.action_taken && <span className="t2"><b>Action:</b> {b.action_taken}</span>}
                {data.can_record && (
                  <div className="row g6 wrap">
                    {!b.reported_to_authority && reportFor !== b.id && <button type="button" className="b b-sm b-gh" onClick={() => setReportFor(b.id)}>Mark as reported</button>}
                    {reportFor === b.id && (
                      <form className="row g6 wrap" onSubmit={(e) => { e.preventDefault(); u.mutate({ id: b.id, reported_to: reportTo }); }}>
                        <input className="in" style={{ minWidth: 240 }} placeholder="Reported to (e.g. NIMASA ISPS Unit, by phone)" value={reportTo} onChange={(e) => setReportTo(e.target.value)} maxLength={200} required />
                        <button type="submit" className="b b-sm b-pri" disabled={reportTo.trim().length < 2 || u.isPending}>Save</button>
                        <button type="button" className="b b-sm b-gh" onClick={() => setReportFor(null)}>Cancel</button>
                      </form>
                    )}
                    {b.status === "open" && <button type="button" className="b b-sm b-gh" disabled={u.isPending} onClick={() => u.mutate({ id: b.id, close: true })}>Close</button>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
