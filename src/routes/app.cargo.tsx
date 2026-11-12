import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { FileText, Loader2, Package, Plus, Trash2 } from "lucide-react";
import { requireFeature, requireSectionAccess } from "@/lib/rbac";
import { Empty, Notice, PageHeader, Panel, Status, type Tone } from "@/components/nw";
import { LocationPicker } from "@/components/LocationPicker";
import { createConsignment, listConsignments, type Consignment } from "@/lib/cargo.functions";
import { listMovementSubjects } from "@/lib/movement.functions";

export const Route = createFileRoute("/app/cargo")({
  head: () => ({ meta: [{ title: "Cargo custody · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    requireSectionAccess(context.appAccess, ["security_manager", "operator", "client_admin", "field_officer", "security_forensic_analyst"]);
    requireFeature(context.appAccess, "cargo");
  },
  component: CargoPage,
});

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const STATUS: Record<Consignment["status"], [string, Tone]> = { planned: ["Planned", "blue"], in_transit: ["In transit", "ok"], delivered: ["Delivered", "off"], cancelled: ["Cancelled", "off"] };

function CargoPage() {
  const fn = useServerFn(listConsignments);
  const q = useQuery({ queryKey: ["cargo"], queryFn: () => fn(), refetchInterval: 60_000 });
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<"open" | "all">("open");

  if (q.isLoading) return <span className="row g8 t3"><Loader2 className="h-4 w-4 animate-spin" /> Loading consignments…</span>;
  if (q.error || !q.data) return <Notice tone="fail">{(q.error as Error)?.message || "Couldn't load consignments."}</Notice>;
  const list = q.data.consignments.filter((c) => filter === "all" || c.status === "planned" || c.status === "in_transit");
  const now = Date.now();

  return (
    <div className="col g16">
      <PageHeader title="Cargo custody" sub="An unbroken record of who had the cargo, where, and what the seals looked like, from loading to delivery, with photos and video clips at each step.">
        <Link to="/app/custody-report" className="b b-sec"><FileText size={14} /> Exceptions report</Link>
        {q.data.can_create && !creating && <button type="button" className="b b-pri" onClick={() => setCreating(true)}><Plus size={14} /> New consignment</button>}
      </PageHeader>
      {creating && <CreateForm onDone={() => setCreating(false)} />}
      <div className="row g6">
        <button type="button" className={`b b-sm ${filter === "open" ? "b-pri" : "b-gh"}`} onClick={() => setFilter("open")}>Open</button>
        <button type="button" className={`b b-sm ${filter === "all" ? "b-pri" : "b-gh"}`} onClick={() => setFilter("all")}>All</button>
      </div>
      <Panel>
        {list.length === 0 ? <Empty>{filter === "open" ? "No open consignments." : "No consignments yet."}</Empty> : (
          <div className="col g8" style={{ fontSize: 13 }}>
            {list.map((c) => {
              const quietH = c.status === "in_transit" ? (now - Date.parse(c.last_event_at ?? c.created_at)) / 3_600_000 : 0;
              return (
                <Link key={c.id} to="/app/cargo/$id" params={{ id: c.id }} className="row g8 wrap" style={{ alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--line, rgba(127,127,127,.2))", color: "inherit", textDecoration: "none" }}>
                  <Package size={15} className="t3" />
                  <b className="mono">{c.reference}</b>
                  <Status tone={STATUS[c.status][1]}>{STATUS[c.status][0]}</Status>
                  {c.has_exception && <Status tone="fail">Exception</Status>}
                  {quietH > c.max_gap_hours && <Status tone="warn">No record for {Math.round(quietH)} h</Status>}
                  <span>{c.description}</span>
                  <span className="t3">{c.origin} → {c.destination}</span>
                  <span className="f1" />
                  <span className="t3" style={{ fontSize: 12 }}>{c.last_event_at ? `last record ${when(c.last_event_at)}` : `added ${when(c.created_at)}`}</span>
                </Link>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}

type Cp = { name: string; lat: number; lng: number; radius_m: number };

function CreateForm({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate();
  const create = useServerFn(createConsignment);
  const subjFn = useServerFn(listMovementSubjects);
  const subjects = useQuery({ queryKey: ["movement-subjects"], queryFn: () => subjFn() });
  const [f, setF] = useState({ reference: "", description: "", quantity: "", containers: "", seals: "", origin: "", destination: "", consignee: "", carrier: "", subject_id: "", max_gap_hours: 6 });
  const [cps, setCps] = useState<Cp[]>([]);
  const [cpName, setCpName] = useState("");
  const [cpAt, setCpAt] = useState<[number, number] | null>(null);
  const [cpRadius, setCpRadius] = useState(500);
  const split = (s: string) => s.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
  const m = useMutation({
    mutationFn: () =>
      create({
        data: {
          reference: f.reference || null, description: f.description, quantity: f.quantity || null, container_numbers: split(f.containers), seal_numbers: split(f.seals),
          origin: f.origin, destination: f.destination, consignee: f.consignee || null, carrier: f.carrier || null, subject_id: f.subject_id || null, checkpoints: cps, max_gap_hours: f.max_gap_hours,
        },
      }),
    onSuccess: (r) => { toast.success("Consignment added."); navigate({ to: "/app/cargo/$id", params: { id: r.id } }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: k === "max_gap_hours" ? Number(e.target.value) : e.target.value });
  const trackable = (subjects.data ?? []).filter((s) => s.kind !== "person");

  return (
    <Panel title="New consignment">
      <form className="col g12" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <div className="grid g10" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <label className="fl"><span>Cargo</span><input className="in" value={f.description} onChange={set("description")} maxLength={500} placeholder="e.g. 2 × 40 ft containers, frozen fish" required /></label>
          <label className="fl"><span>Quantity</span><input className="in" value={f.quantity} onChange={set("quantity")} maxLength={120} placeholder="e.g. 1,200 cartons, 48 t" /></label>
          <label className="fl"><span>Your reference (optional)</span><input className="in mono" value={f.reference} onChange={set("reference")} maxLength={60} placeholder="Bill of lading or waybill no." /></label>
          <label className="fl"><span>From</span><input className="in" value={f.origin} onChange={set("origin")} maxLength={200} placeholder="e.g. Tin Can Island Port, Lagos" required /></label>
          <label className="fl"><span>To</span><input className="in" value={f.destination} onChange={set("destination")} maxLength={200} placeholder="e.g. Client warehouse, Agbara" required /></label>
          <label className="fl"><span>Consignee</span><input className="in" value={f.consignee} onChange={set("consignee")} maxLength={200} /></label>
          <label className="fl"><span>Carrier (haulier, boat operator)</span><input className="in" value={f.carrier} onChange={set("carrier")} maxLength={200} /></label>
          <label className="fl"><span>Container numbers</span><input className="in mono" value={f.containers} onChange={set("containers")} placeholder="MSCU1234567, …" /></label>
          <label className="fl"><span>Seal numbers on the cargo</span><input className="in mono" value={f.seals} onChange={set("seals")} placeholder="NG123456, …" /></label>
          <label className="fl"><span>Tracked vehicle or boat (optional)</span>
            <select className="in" value={f.subject_id} onChange={set("subject_id")}><option value="">None</option>{trackable.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </label>
          <label className="fl"><span>Alert if nothing is recorded for</span>
            <select className="in" value={f.max_gap_hours} onChange={set("max_gap_hours")}>{[1, 2, 3, 4, 6, 8, 12, 24, 48, 72].map((h) => <option key={h} value={h}>{h} hour{h === 1 ? "" : "s"}</option>)}</select>
          </label>
        </div>

        <fieldset className="col g8" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="t2" style={{ fontSize: 12.5, marginBottom: 4 }}>Checkpoints on the way (optional): records made more than the set distance away are flagged</legend>
          {cps.map((c, i) => (
            <div key={i} className="row g8" style={{ fontSize: 13, alignItems: "center" }}>
              <span className="t3">{i + 1}.</span><b>{c.name}</b><span className="t3 mono">{c.lat.toFixed(4)}, {c.lng.toFixed(4)} · within {c.radius_m} m</span>
              <button type="button" className="b b-sm b-gh" aria-label="Remove checkpoint" onClick={() => setCps(cps.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
            </div>
          ))}
          <div className="grid g8" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr)" }}>
            <div className="col g8">
              <input className="in" placeholder="Checkpoint name, e.g. Mile 2 weighbridge" value={cpName} onChange={(e) => setCpName(e.target.value)} maxLength={120} />
              <select className="in" value={cpRadius} onChange={(e) => setCpRadius(Number(e.target.value))}>{[100, 250, 500, 1000, 2000, 5000].map((r) => <option key={r} value={r}>within {r} m</option>)}</select>
              <button type="button" className="b b-sm b-gh" disabled={!cpName.trim() || !cpAt} onClick={() => { setCps([...cps, { name: cpName.trim(), lng: cpAt![0], lat: cpAt![1], radius_m: cpRadius }]); setCpName(""); setCpAt(null); }}><Plus size={13} /> Add checkpoint</button>
              <span className="t3" style={{ fontSize: 12 }}>Click the map to place it.</span>
            </div>
            <LocationPicker value={cpAt} onChange={setCpAt} height={200} />
          </div>
        </fieldset>

        <div className="row g8">
          <button type="submit" className="b b-pri" disabled={m.isPending || f.description.trim().length < 2 || !f.origin.trim() || !f.destination.trim()}>{m.isPending && <Loader2 size={14} className="animate-spin" />} Add consignment</button>
          <button type="button" className="b b-gh" onClick={onDone}>Cancel</button>
        </div>
      </form>
    </Panel>
  );
}
