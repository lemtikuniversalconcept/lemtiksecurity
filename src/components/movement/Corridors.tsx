import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CloudLightning, Send, Copy, ExternalLink, Link2Off, Loader2, MessageCircle, Phone, Plus, QrCode, Save, Trash2, Undo2, UserPlus, Wind, X } from "lucide-react";
import { LocationPicker } from "@/components/LocationPicker";
import { Empty, Notice, Panel, Status } from "@/components/nw";
import {
  addPassengerByStaff,
  deleteCorridor,
  deleteResponder,
  getBoardingCheck,
  getHandoffContext,
  openBoarding,
  recordHandoff,
  removePassenger,
  saveCorridor,
  saveResponder,
  type Corridor,
  type Responder,
} from "@/lib/corridor.functions";
import { startVoyage, type Voyage } from "@/lib/voyages.functions";
import { RESPONDER_STATUS_LABEL, withdrawResponderLink } from "@/lib/respond.functions";
import { listLinkDirectory } from "@/lib/links.functions";
import { RouteDrawer, routeLengthM } from "./Voyages";
import { useMovementPerms } from "./perms";

type LngLat = [number, number];
const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

// ---------------------------------------------------------------- Corridors

type CForm = { id?: string; name: string; route: LngLat[]; corridor_m: number; curfew_start: string; curfew_end: string; max_wind_kn: string; active: boolean; notes: string };
const NEW_C: CForm = { name: "", route: [], corridor_m: 1000, curfew_start: "", curfew_end: "", max_wind_kn: "25", active: true, notes: "" };

export function CorridorsView({ corridors }: { corridors: Corridor[] }) {
  const { canManage } = useMovementPerms();
  const [form, setForm] = useState<CForm | null>(null);
  const qc = useQueryClient();
  const save = useServerFn(saveCorridor);
  const del = useServerFn(deleteCorridor);
  const saveM = useMutation({
    mutationFn: (f: CForm) =>
      save({ data: { id: f.id, name: f.name, route: f.route, corridor_m: f.corridor_m, curfew_start: f.curfew_start || null, curfew_end: f.curfew_end || null, max_wind_kn: f.max_wind_kn ? Number(f.max_wind_kn) : null, active: f.active, notes: f.notes || null } }),
    onSuccess: () => { toast.success("Corridor saved"); setForm(null); qc.invalidateQueries({ queryKey: ["movement-corridors"] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  const delM = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => { toast.success("Corridor removed"); setForm(null); qc.invalidateQueries({ queryKey: ["movement-corridors"] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  const halfCurfew = !!form && !!form.curfew_start !== !!form.curfew_end;

  return (
    <div className="grid g16" style={{ gridTemplateColumns: form ? "minmax(0,1fr) 480px" : "minmax(0,1fr)" }}>
      <Panel title="Approved corridors" meta={corridors.length} actions={canManage ? <button type="button" className="b b-sm b-pri" onClick={() => setForm({ ...NEW_C })}><Plus size={14} /> Add corridor</button> : undefined}>
        {corridors.length === 0 ? (
          <Empty>An approved corridor is a waterway route boats must keep to, with its curfew hours and a wind limit. Voyages planned on it inherit the route, and departures are checked against its curfew and the weather.</Empty>
        ) : (
          <div className="col g4">
            {corridors.map((c) => (
              <button key={c.id} type="button" disabled={!canManage} className="row g10 w-full text-left hover:bg-ink-3" style={{ padding: "9px 8px", borderRadius: 8 }}
                onClick={() => setForm({ id: c.id, name: c.name, route: c.route, corridor_m: c.corridor_m, curfew_start: c.curfew_start ?? "", curfew_end: c.curfew_end ?? "", max_wind_kn: c.max_wind_kn != null ? String(c.max_wind_kn) : "", active: c.active, notes: c.notes ?? "" })}>
                <span className="col f1" style={{ minWidth: 0 }}>
                  <b className="trunc">{c.name}</b>
                  <span className="t3 trunc" style={{ fontSize: 12 }}>
                    {c.route.length >= 2 ? `${km(routeLengthM(c.route))} · ±${km(c.corridor_m)}` : "No route"} · {c.curfew_start ? `curfew ${c.curfew_start}–${c.curfew_end}` : "no curfew"} · wind limit {c.max_wind_kn ?? 25} kn
                  </span>
                </span>
                <Status tone={c.active ? "ok" : "off"}>{c.active ? "In use" : "Off"}</Status>
              </button>
            ))}
          </div>
        )}
      </Panel>
      {form && (
        <Panel title={form.id ? "Edit corridor" : "New corridor"} actions={<button type="button" className="ibtn" aria-label="Close" onClick={() => setForm(null)}><X size={14} /></button>}>
          <form className="col g10" onSubmit={(e) => { e.preventDefault(); if (form.name.trim() && !halfCurfew) saveM.mutate(form); }}>
            <label className="fl"><span>Name</span><input className="in" required maxLength={160} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Ikorodu – CMS ferry corridor" /></label>
            <span className="o-lbl">ROUTE</span>
            <RouteDrawer route={form.route} corridor={form.corridor_m} onChange={(route) => setForm({ ...form, route })} />
            <div className="row g8" style={{ fontSize: 12.5 }}>
              <span className="t2 f1">{form.route.length ? `${form.route.length} waypoints · ${km(routeLengthM(form.route))}` : "Click the map to trace the corridor."}</span>
              <button type="button" className="b b-sm b-gh" disabled={!form.route.length} onClick={() => setForm({ ...form, route: form.route.slice(0, -1) })}><Undo2 size={13} /> Undo</button>
            </div>
            <label className="fl"><span>Width: alert if more than {km(form.corridor_m)} off the line</span><input type="range" min={100} max={10000} step={100} value={form.corridor_m} onChange={(e) => setForm({ ...form, corridor_m: Number(e.target.value) })} /></label>
            <div className="grid g10" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
              <label className="fl"><span>Curfew from</span><input type="time" className="in" value={form.curfew_start} onChange={(e) => setForm({ ...form, curfew_start: e.target.value })} /></label>
              <label className="fl"><span>Curfew until</span><input type="time" className="in" value={form.curfew_end} onChange={(e) => setForm({ ...form, curfew_end: e.target.value })} /></label>
              <label className="fl"><span>Wind limit (kn)</span><input className="in" inputMode="numeric" value={form.max_wind_kn} onChange={(e) => setForm({ ...form, max_wind_kn: e.target.value.replace(/\D/g, "").slice(0, 2) })} /></label>
            </div>
            {halfCurfew && <Notice tone="warn">Set both curfew times, or neither.</Notice>}
            <span className="t3" style={{ fontSize: 12 }}>Lagos time. A curfew can run past midnight, e.g. 19:00 to 06:00. Departures during curfew, or with wind above the limit or thunderstorms forecast, need a written reason and alert the control room.</span>
            <label className="row g8" style={{ fontSize: 13 }}><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> In use</label>
            <label className="fl"><span>Notes</span><textarea className="in" rows={2} maxLength={2000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Authority that approved it, hazards, jetties served" /></label>
            <div className="row g8">
              <button type="submit" className="b b-pri" disabled={saveM.isPending || !form.name.trim() || halfCurfew}>{saveM.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save</button>
              {form.id && <button type="button" className="b b-gh" style={{ color: "var(--s5)" }} onClick={() => delM.mutate(form.id!)} disabled={delM.isPending}><Trash2 size={13} /> Remove</button>}
            </div>
          </form>
        </Panel>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Responders

export const RESPONDER_KIND: Record<Responder["kind"], string> = {
  marine_police: "Marine police",
  navy: "Navy",
  search_rescue: "Search and rescue",
  waterways_authority: "Waterways authority",
  medical: "Medical / ambulance",
  private_security: "Private security",
  other: "Other",
};
type RForm = { id?: string; name: string; kind: Responder["kind"]; phone: string; whatsapp: string; at: LngLat | null; notes: string; active: boolean; org: string };

export function RespondersView({ responders }: { responders: Responder[] }) {
  const { canManage } = useMovementPerms();
  const [form, setForm] = useState<RForm | null>(null);
  const qc = useQueryClient();
  const save = useServerFn(saveResponder);
  const del = useServerFn(deleteResponder);
  const dirFn = useServerFn(listLinkDirectory);
  const dir = useQuery({ queryKey: ["link-directory"], queryFn: () => dirFn(), enabled: !!form });
  const saveM = useMutation({
    mutationFn: (f: RForm) => save({ data: { id: f.id, name: f.name, kind: f.kind, phone: f.phone || null, whatsapp: f.whatsapp || null, lat: f.at?.[1] ?? null, lng: f.at?.[0] ?? null, notes: f.notes || null, active: f.active, responder_org_id: f.org || null } }),
    onSuccess: () => { toast.success("Responder saved"); setForm(null); qc.invalidateQueries({ queryKey: ["movement-responders"] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  const delM = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => { toast.success("Removed"); setForm(null); qc.invalidateQueries({ queryKey: ["movement-responders"] }); },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="grid g16" style={{ gridTemplateColumns: form ? "minmax(0,1fr) 440px" : "minmax(0,1fr)" }}>
      <Panel title="Responders" meta={responders.length} actions={canManage ? <button type="button" className="b b-sm b-pri" onClick={() => setForm({ name: "", kind: "marine_police", phone: "", whatsapp: "", at: null, notes: "", active: true, org: "" })}><Plus size={14} /> Add responder</button> : undefined}>
        {responders.length === 0 ? (
          <Empty>Add the marine police posts, navy bases, rescue teams and clinics you'd call in an emergency, with where they are. When a boat is in trouble, the nearest ones are listed first.</Empty>
        ) : (
          <div className="col g4">
            {responders.map((r) => (
              <button key={r.id} type="button" disabled={!canManage} className="row g10 w-full text-left hover:bg-ink-3" style={{ padding: "9px 8px", borderRadius: 8 }}
                onClick={() => setForm({ id: r.id, name: r.name, kind: r.kind, phone: r.phone ?? "", whatsapp: r.whatsapp ?? "", at: r.lat != null && r.lng != null ? [r.lng, r.lat] : null, notes: r.notes ?? "", active: r.active, org: r.responder_org_id ?? "" })}>
                <span className="col f1" style={{ minWidth: 0 }}>
                  <b className="trunc">{r.name}</b>
                  <span className="t3 trunc" style={{ fontSize: 12 }}>{RESPONDER_KIND[r.kind]}{r.phone ? ` · ${r.phone}` : ""}{r.lat == null ? " · no location set" : ""}{r.responder_org_id ? " · on Lemtik" : ""}</span>
                </span>
                {!r.active && <Status tone="off">Off</Status>}
              </button>
            ))}
          </div>
        )}
      </Panel>
      {form && (
        <Panel title={form.id ? "Edit responder" : "New responder"} actions={<button type="button" className="ibtn" aria-label="Close" onClick={() => setForm(null)}><X size={14} /></button>}>
          <form className="col g10" onSubmit={(e) => { e.preventDefault(); if (form.name.trim()) saveM.mutate(form); }}>
            <label className="fl"><span>Name</span><input className="in" required maxLength={160} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Marine Police, Ebute-Ero post" /></label>
            <label className="fl"><span>Type</span>
              <select className="in" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Responder["kind"] })}>
                {Object.entries(RESPONDER_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <div className="grid g10" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <label className="fl"><span>Phone</span><input className="in" maxLength={40} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="0803…" /></label>
              <label className="fl"><span>WhatsApp (if different)</span><input className="in" maxLength={40} value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} /></label>
            </div>
            <label className="fl"><span>On Lemtik as (optional)</span>
              <select className="in" value={form.org} onChange={(e) => setForm({ ...form, org: e.target.value })}>
                <option value="">Not on Lemtik: phone, WhatsApp and the responder link only</option>
                {(dir.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name} ({o.type === "authority" ? "authority" : "responder"})</option>)}
              </select>
              <span className="t3" style={{ fontSize: 11.5 }}>If they use Lemtik, every hand-off to them also lands on their responder board and their staff are alerted at once.</span>
            </label>
            <span className="o-lbl">WHERE THEY ARE BASED</span>
            <LocationPicker value={form.at} center={form.at} onChange={(c) => setForm({ ...form, at: c })} height={220} />
            <label className="fl"><span>Notes</span><textarea className="in" rows={2} maxLength={1000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Hours, boats available, who to ask for" /></label>
            <label className="row g8" style={{ fontSize: 13 }}><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Available for hand-offs</label>
            <div className="row g8">
              <button type="submit" className="b b-pri" disabled={saveM.isPending || !form.name.trim()}>{saveM.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save</button>
              {form.id && <button type="button" className="b b-gh" style={{ color: "var(--s5)" }} onClick={() => delM.mutate(form.id!)} disabled={delM.isPending}><Trash2 size={13} /> Remove</button>}
            </div>
          </form>
        </Panel>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Jetty boarding

export function BoardingPanel({ v, onStarted }: { v: Voyage; onStarted: () => void }) {
  const qc = useQueryClient();
  const checkFn = useServerFn(getBoardingCheck);
  const openFn = useServerFn(openBoarding);
  const addFn = useServerFn(addPassengerByStaff);
  const removeFn = useServerFn(removePassenger);
  const startFn = useServerFn(startVoyage);
  const q = useQuery({ queryKey: ["boarding", v.id], queryFn: () => checkFn({ data: { voyage_id: v.id } }), refetchInterval: 15_000 });
  const [count, setCount] = useState(String(v.crew.length || ""));
  const [jackets, setJackets] = useState("");
  const [reason, setReason] = useState("");
  const [paxName, setPaxName] = useState("");
  const [paxNok, setPaxNok] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const b = q.data;
  const origin = typeof window === "undefined" ? "https://app.lemtik.com.ng" : window.location.origin;
  const link = b?.boarding_token ? `${origin}/board/${b.boarding_token}` : null;

  useEffect(() => {
    if (b?.life_jackets != null && jackets === "") setJackets(String(b.life_jackets));
  }, [b?.life_jackets]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    if (!link) return setQr(null);
    import("qrcode").then((Q) => Q.default.toDataURL(link, { width: 240, margin: 1 })).then((u) => live && setQr(u)).catch(() => null);
    return () => { live = false; };
  }, [link]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["boarding", v.id] });
  const open = useMutation({ mutationFn: () => openFn({ data: { voyage_id: v.id } }), onSuccess: refresh, onError: (e) => toast.error((e as Error).message) });
  const add = useMutation({
    mutationFn: () => addFn({ data: { voyage_id: v.id, name: paxName, next_of_kin_phone: paxNok || null } }),
    onSuccess: () => { setPaxName(""); setPaxNok(""); refresh(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const remove = useMutation({ mutationFn: (id: string) => removeFn({ data: { id } }), onSuccess: refresh, onError: (e) => toast.error((e as Error).message) });

  const n = count.trim() === "" ? NaN : Number(count);
  const countOk = Number.isInteger(n) && n >= 0 && n <= 5000;
  const lj = jackets.trim() === "" ? null : Number(jackets);
  const problems: string[] = [];
  if (b && countOk) {
    if (b.capacity != null && n > b.capacity) problems.push(`${n} aboard but licensed for ${b.capacity}`);
    if (b.is_vessel && (lj == null || lj < n)) problems.push(lj == null ? "Life jackets not counted" : `Only ${lj} life jackets for ${n} people`);
  }
  if (b?.in_curfew && b.corridor) problems.push(`Curfew on ${b.corridor.name} (${b.corridor.curfew_start}–${b.corridor.curfew_end})`);
  const maxWind = b?.corridor?.max_wind_kn ?? 25;
  if (b?.weather?.thunder) problems.push("Thunderstorms forecast");
  if (b?.weather && Math.max(b.weather.wind_kn ?? 0, (b.weather.gust_kn ?? 0) * 0.8) > maxWind) problems.push(`Wind above the ${maxWind} kn limit`);
  const needReason = problems.length > 0;

  const start = useMutation({
    mutationFn: () => startFn({ data: { id: v.id, departure_count: n, life_jackets: lj, override_reason: needReason ? reason : null } }),
    onSuccess: () => { toast.success(needReason ? "Departed with an override. The control room has been alerted." : "Cleared and departed"); onStarted(); },
    onError: (e) => toast.error((e as Error).message),
  });

  if (q.isLoading || !b) return <span className="row g8 t3" style={{ fontSize: 12.5 }}><Loader2 size={13} className="animate-spin" /> Loading the boarding check…</span>;
  const paxCount = b.qr_passengers.length;

  return (
    <section className="col g10">
      <span className="o-lbl">JETTY BOARDING CHECK</span>

      <div className="card col g4" style={{ padding: "10px 12px", fontSize: 12.5 }}>
        <span className="row g6"><Wind size={13} /> <b>Weather</b>{b.weather?.thunder && <CloudLightning size={13} style={{ color: "var(--s4)" }} />}</span>
        {b.weather ? <span>{b.weather.summary}. Limit {maxWind} kn.</span> : <span className="t3">{b.weather_point ? "Forecast unavailable right now. Check conditions at the jetty." : "Add a route so the forecast can be checked at the departure point."}</span>}
        {b.weather && <span className="t3" style={{ fontSize: 11.5 }}>{b.weather.source}. Wave height isn't included: no free forecast covers Nigerian waters.</span>}
        <span className="t3">{b.corridor ? `${b.corridor.name}${b.corridor.curfew_start ? ` · curfew ${b.corridor.curfew_start}–${b.corridor.curfew_end}` : ""}` : "Not on an approved corridor"} · now {b.lagos_time} Lagos</span>
      </div>

      <div className="col g6">
        <span className="t2" style={{ fontSize: 12.5 }}>
          <b>Passenger list</b> · {paxCount} recorded{b.capacity != null ? ` of ${b.capacity} allowed` : ""}. Passengers scan the QR to add their name and next of kin; it stops accepting names when the boat is full.
        </span>
        {link ? (
          <div className="row g10 wrap" style={{ alignItems: "center" }}>
            {qr && <img src={qr} alt="QR code passengers scan to board" width={120} height={120} style={{ background: "#fff", borderRadius: 6, padding: 4 }} />}
            <a href={link} target="_blank" rel="noreferrer" className="b b-sm b-gh"><ExternalLink size={13} /> Open boarding page</a>
          </div>
        ) : (
          <button type="button" className="b b-sm b-sec" style={{ alignSelf: "flex-start" }} onClick={() => open.mutate()} disabled={open.isPending}><QrCode size={13} /> Show boarding QR</button>
        )}
        <form className="row g6" onSubmit={(e) => { e.preventDefault(); if (paxName.trim()) add.mutate(); }}>
          <input className="in f1" value={paxName} onChange={(e) => setPaxName(e.target.value)} maxLength={120} placeholder="Add a passenger by name" aria-label="Passenger name" />
          <input className="in" style={{ width: 130 }} value={paxNok} onChange={(e) => setPaxNok(e.target.value)} maxLength={40} placeholder="Next of kin phone" aria-label="Next of kin phone" />
          <button type="submit" className="ibtn" aria-label="Add passenger" disabled={add.isPending || !paxName.trim()}><UserPlus size={14} /></button>
        </form>
        {paxCount > 0 && (
          <div className="col" style={{ fontSize: 12.5, maxHeight: 150, overflow: "auto" }}>
            {b.qr_passengers.map((p, i) => (
              <span key={p.id} className="row g6">
                <span className="f1 trunc">{i + 1}. {p.name}{p.next_of_kin_phone ? <span className="t3"> · NOK {p.next_of_kin_phone}</span> : null}{p.source === "staff" ? <span className="t3"> · added by staff</span> : null}</span>
                <button type="button" className="ibtn" style={{ width: 20, height: 20 }} aria-label={`Remove ${p.name}`} onClick={() => remove.mutate(p.id)}><X size={11} /></button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="grid g10" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <label className="fl"><span>People aboard (count them)</span><input className="in" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, "").slice(0, 4))} /></label>
        {b.is_vessel && <label className="fl"><span>Life jackets aboard</span><input className="in" inputMode="numeric" value={jackets} onChange={(e) => setJackets(e.target.value.replace(/\D/g, "").slice(0, 4))} /></label>}
      </div>
      {countOk && paxCount > 0 && n !== paxCount && <Notice tone="warn">You counted {n}; the passenger list has {paxCount}.</Notice>}

      {problems.length > 0 ? (
        <Notice tone="fail">
          <span className="col g2">
            <b>Not cleared to depart</b>
            {problems.map((p) => <span key={p}>• {p}</span>)}
          </span>
        </Notice>
      ) : countOk ? (
        <Notice tone="ok">Cleared: within capacity, enough life jackets{b.corridor?.curfew_start ? ", outside curfew" : ""}{b.weather ? ", weather within limits" : ""}.</Notice>
      ) : null}
      {needReason && (
        <label className="fl"><span>Reason to depart anyway (the control room is alerted)</span><textarea className="in" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Medical evacuation authorised by the operations manager" /></label>
      )}
      <button type="button" className="b b-pri" disabled={!countOk || start.isPending || (needReason && reason.trim().length < 10)} onClick={() => start.mutate()}>
        {start.isPending ? <Loader2 size={14} className="animate-spin" /> : null} {needReason ? "Depart with override" : "Clear and start voyage"}
      </button>
    </section>
  );
}

// ---------------------------------------------------------------- Hand-off

export function HandoffPanel({ subjectId, onClose }: { subjectId: string; onClose: () => void }) {
  const ctxFn = useServerFn(getHandoffContext);
  const recordFn = useServerFn(recordHandoff);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["handoff", subjectId], queryFn: () => ctxFn({ data: { subject_id: subjectId } }), refetchInterval: 20_000 });
  const [summary, setSummary] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    if (q.data && !summary) setSummary(q.data.draft);
    if (q.data && !picked) setPicked(q.data.responders[0]?.id ?? null);
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const withdrawFn = useServerFn(withdrawResponderLink);
  const withdraw = useMutation({
    mutationFn: (handoff_id: string) => withdrawFn({ data: { handoff_id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["handoff", subjectId] });
      toast.success("Link withdrawn. It stops working now.");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const copyLink = (token: string) => {
    const url = `${window.location.origin}/respond/${token}`;
    navigator.clipboard?.writeText(url).then(() => toast.success("Responder link copied"), () => toast.message(url));
  };
  const go = useMutation({
    mutationFn: (channel: "call" | "whatsapp" | "lemtik") => recordFn({ data: { subject_id: subjectId, voyage_id: q.data?.voyage_id ?? null, responder_id: picked!, channel, summary } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["movement-alerts"] });
      qc.invalidateQueries({ queryKey: ["handoff", subjectId] });
      if (r.url) window.open(r.url, r.url.startsWith("tel:") ? "_self" : "_blank", "noopener");
      toast.success(r.url ? "Hand-off recorded" : "Sent to their responder board. They've been alerted.");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (q.isLoading || !q.data) return <span className="row g8 t3" style={{ fontSize: 12.5 }}><Loader2 size={13} className="animate-spin" /> Finding the nearest responders…</span>;
  const d = q.data;
  const r = d.responders.find((x) => x.id === picked) ?? null;

  return (
    <section className="col g10">
      <div className="row g8"><span className="o-lbl f1">HAND OFF TO A RESPONDER</span><button type="button" className="ibtn" aria-label="Close hand-off" onClick={onClose}><X size={13} /></button></div>
      {d.responders.length === 0 ? (
        <Notice tone="warn">No responders added yet. A security manager can add them under the Responders tab.</Notice>
      ) : (
        <div className="col g4">
          {d.responders.slice(0, 6).map((x) => (
            <label key={x.id} className={`row g8 card${picked === x.id ? " bg-ink-3" : ""}`} style={{ padding: "8px 10px", cursor: "pointer", fontSize: 12.5 }}>
              <input type="radio" name="responder" checked={picked === x.id} onChange={() => setPicked(x.id)} />
              <span className="col f1" style={{ minWidth: 0 }}>
                <b className="trunc">{x.name}</b>
                <span className="t3">{RESPONDER_KIND[x.kind]}{x.phone ? ` · ${x.phone}` : ""}{x.responder_org_id ? " · on Lemtik" : ""}</span>
              </span>
              <span className="mono t2">{x.distance_m != null ? km(x.distance_m) : "—"}</span>
            </label>
          ))}
        </div>
      )}
      <label className="fl">
        <span>Message to send (drafted from the record; check and edit before approving)</span>
        <textarea className="in mono" rows={8} style={{ fontSize: 12 }} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={4000} />
      </label>
      <div className="row g8 wrap">
        {r?.responder_org_id && <button type="button" className="b b-pri" disabled={go.isPending || summary.trim().length < 10} onClick={() => go.mutate("lemtik")}><Send size={14} /> Approve and send on Lemtik</button>}
        <button type="button" className={r?.responder_org_id ? "b b-sec" : "b b-pri"} disabled={!r || go.isPending || summary.trim().length < 10 || !(r.whatsapp || r.phone)} onClick={() => go.mutate("whatsapp")}><MessageCircle size={14} /> Approve and send on WhatsApp</button>
        <button type="button" className="b b-sec" disabled={!r || go.isPending || !(r.phone || r.whatsapp)} onClick={() => go.mutate("call")}><Phone size={14} /> Approve and call</button>
      </div>
      {r?.responder_org_id && <span className="t3" style={{ fontSize: 11.5 }}>{r.name} uses Lemtik. "Send on Lemtik" puts it on their responder board and alerts their staff straight away, with no call or message needed. A WhatsApp or call hand-off also appears on their board.</span>}
      <span className="t3" style={{ fontSize: 11.5 }}>WhatsApp opens on your device with the message and a responder link filled in; you press send. The link works for 24 hours without an account: the responder sees the boat's live position and track and can confirm receipt, dispatch and arrival. If you call instead, copy the link below and send it. The hand-off is logged with your name either way.</span>
      {d.previous.length > 0 && (
        <div className="col g2" style={{ fontSize: 12 }}>
          <span className="t3">Already handed off</span>
          {d.previous.map((p) => {
            const live = !p.withdrawn_at && !!p.share_token && (!p.share_expires_at || Date.parse(p.share_expires_at) > Date.now());
            const shown = p.status === "sent" && p.first_viewed_at ? "viewed" : p.status;
            return (
              <div key={p.id} className="row g8 wrap" style={{ alignItems: "center" }}>
                <span className="f1" style={{ minWidth: 0 }}>
                  {new Date(p.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · {p.responder_name} by {p.channel === "whatsapp" ? "WhatsApp" : p.channel === "lemtik" ? "Lemtik" : "phone"} · {p.approved_by_name}
                  {p.share_token ? <> · <b>{RESPONDER_STATUS_LABEL[shown] ?? shown}</b></> : null}
                </span>
                {live && (
                  <>
                    <button type="button" className="b b-sec" style={{ padding: "2px 8px", fontSize: 11.5 }} onClick={() => copyLink(p.share_token!)}><Copy size={12} /> Copy link</button>
                    <button type="button" className="b b-sec" style={{ padding: "2px 8px", fontSize: 11.5 }} disabled={withdraw.isPending} onClick={() => withdraw.mutate(p.id)}><Link2Off size={12} /> Withdraw</button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
