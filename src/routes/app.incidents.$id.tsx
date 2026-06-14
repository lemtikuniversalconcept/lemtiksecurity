import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  getIncidentDetail,
  transitionIncidentStatus,
  reassignIncident,
  addIncidentNote,
  addIncidentEvidence,
  linkIncidents,
  createEscalation,
  acknowledgeEscalation,
} from "@/lib/incidentDetail.functions";
import { listMembers, listLocations } from "@/lib/orgs.functions";
import { severityMeta, statusMeta, typeMeta, type Severity, type IncidentStatus, type IncidentType } from "@/lib/mockData";
import { SeverityBadge } from "@/components/SeverityBadge";
import { useRealtimeInvalidate } from "@/lib/useRealtime";
import {
  ArrowLeft, Loader2, Send, Paperclip, Phone, ShieldAlert, Link as LinkIcon,
  Clock, User, Image as ImageIcon, FileText, Video as VideoIcon, Mic,
  CheckCircle2, MessageSquare, AlertOctagon,
} from "lucide-react";

export const Route = createFileRoute("/app/incidents/$id")({
  head: () => ({ meta: [{ title: "Incident · Lemtik SOD" }] }),
  component: IncidentDetailPage,
});

const STATUS_FLOW: IncidentStatus[] = ["reported", "acknowledged", "responding", "contained", "resolved"];
const ESCALATION_TARGETS = [
  { key: "police", label: "Nigeria Police", phone: "112" },
  { key: "lasema", label: "LASEMA", phone: "767" },
  { key: "nscdc", label: "NSCDC", phone: "08032003557" },
  { key: "custom", label: "Custom contact", phone: "" },
] as const;

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}
function since(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function duration(fromIso: string, toIso?: string) {
  const ms = (toIso ? new Date(toIso).getTime() : Date.now()) - new Date(fromIso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function haversineMeters(a: [number, number], b: [number, number]) {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function pointFromLocationLocations(locs: any[], ids: string[] | undefined) {
  const matches = (ids ?? [])
    .map((id) => locs.find((loc) => loc.id === id))
    .filter((loc): loc is any => !!loc && loc.coord_x != null && loc.coord_y != null);
  if (!matches.length) return null;
  const lng = matches.reduce((acc, loc) => acc + Number(loc.coord_x), 0) / matches.length;
  const lat = matches.reduce((acc, loc) => acc + Number(loc.coord_y), 0) / matches.length;
  return [lng, lat] as [number, number];
}

function hashToOffset(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return [
    ((hash % 1000) / 1000 - 0.5) * 0.02,
    ((((hash / 1000) | 0) % 1000) / 1000 - 0.5) * 0.02,
  ] as [number, number];
}

function IncidentDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const get = useServerFn(getIncidentDetail);
  const transition = useServerFn(transitionIncidentStatus);
  const reassign = useServerFn(reassignIncident);
  const addNote = useServerFn(addIncidentNote);
  const addEvidence = useServerFn(addIncidentEvidence);
  const linkInc = useServerFn(linkIncidents);
  const escalate = useServerFn(createEscalation);
  const ackEsc = useServerFn(acknowledgeEscalation);
  const fetchMembers = useServerFn(listMembers);
  const fetchLocations = useServerFn(listLocations);

  useRealtimeInvalidate("incidents", [["incident", id]]);
  useRealtimeInvalidate("incident_activity", [["incident", id]]);
  useRealtimeInvalidate("incident_notes", [["incident", id]]);
  useRealtimeInvalidate("incident_escalations", [["incident", id]]);
  useRealtimeInvalidate("organisation_locations", [["locations"], ["incident", id]]);
  useRealtimeInvalidate("profiles", [["members"]]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["incident", id],
    queryFn: () => get({ data: { id } }),
  });
  const { data: members = [] } = useQuery({ queryKey: ["members"], queryFn: () => fetchMembers() });
  const { data: locations = [] } = useQuery({ queryKey: ["locations"], queryFn: () => fetchLocations() });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["incident", id] });

  if (isLoading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading incident…</div>;
  }
  if (error || !data) {
    return <div className="text-sm text-critical">Failed to load incident.</div>;
  }

  const inc = data.incident as any;
  const reportedAt = inc.reported_at;
  const firstResponse = (data.activity as any[]).find((a) => a.kind === "status_changed" && a.meta?.to === "acknowledged");
  const meta = severityMeta[inc.severity as Severity];
  const incidentPoint: [number, number] = (() => {
    if (inc.coord_x != null && inc.coord_y != null) return [Number(inc.coord_x), Number(inc.coord_y)];
    const direct = locations.find((loc: any) => loc.id === inc.location_id && loc.coord_x != null && loc.coord_y != null);
    if (direct) return [Number(direct.coord_x), Number(direct.coord_y)];
    const sameZone = locations.find((loc: any) => loc.name?.toLowerCase() === String(inc.zone ?? "").toLowerCase() && loc.coord_x != null && loc.coord_y != null);
    if (sameZone) return [Number(sameZone.coord_x), Number(sameZone.coord_y)];
    return [3.4219, 6.4281];
  })();

  const proximity = (() => {
    const candidates = members.map((m: any) => {
      const assigned = pointFromLocationLocations(locations, m.profile?.assigned_location_ids);
      const zoneMatch = locations.find((loc: any) => loc.name?.toLowerCase() === String(m.profile?.zone ?? "").toLowerCase() && loc.coord_x != null && loc.coord_y != null);
      const base = assigned ?? (zoneMatch ? [Number(zoneMatch.coord_x), Number(zoneMatch.coord_y)] as [number, number] : null);
      const fallback = base ?? [
        incidentPoint[0] + hashToOffset(`${m.user_id}:${m.profile?.display_name ?? m.user_id}`)[0],
        incidentPoint[1] + hashToOffset(`${m.user_id}:${m.profile?.display_name ?? m.user_id}`)[1],
      ] as [number, number];
      return {
        id: m.user_id,
        name: m.profile?.display_name || "Member",
        role: m.role,
        zone: m.profile?.zone || "Unassigned",
        status: m.profile?.status || "unknown",
        coordinates: fallback,
        source: base ? (assigned ? "assigned locations" : "zone match") : "derived standby grid",
        distance: haversineMeters(incidentPoint, fallback),
      };
    });
    return candidates.sort((a, b) => a.distance - b.distance).slice(0, 3);
  })();

  return (
    <div className="space-y-5">
      <button onClick={() => navigate({ to: "/app/incidents" })} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to incidents
      </button>

      <section className="grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-4">
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Live capture</div>
              <h2 className="text-sm font-semibold">Raw incident report</h2>
            </div>
            <span className="rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-[10px] uppercase tracking-wider text-primary">
              Distress log
            </span>
          </div>
          <textarea
            readOnly
            value={inc.description || inc.title || "No narrative entered yet."}
            className="mt-4 min-h-44 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm leading-relaxed text-foreground resize-none"
          />
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <MiniStat label="Reported" value={fmt(reportedAt)} />
            <MiniStat label="Status" value={statusMeta[inc.status] ?? inc.status} />
            <MiniStat label="Location" value={inc.location} />
            <MiniStat label="Zone" value={inc.zone} />
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Brain 2</div>
              <h2 className="text-sm font-semibold">Proximity Engine Matrix</h2>
            </div>
            <span className="rounded-md border border-resolved/30 bg-resolved/10 px-2 py-1 text-[10px] uppercase tracking-wider text-resolved">
              Sorted in meters
            </span>
          </div>
          <div className="mt-4 space-y-2">
            {proximity.map((officer, idx) => (
              <div key={officer.id} className={`rounded-md border px-4 py-3 ${idx === 0 ? "border-critical/40 bg-critical/10" : "border-border bg-surface"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{officer.name}</div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{officer.role.replace("_", " ")} · {officer.zone}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-mono tabular-nums">{Math.round(officer.distance)} m</div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{officer.source}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Header */}
      <div className={`rounded-lg border bg-card p-5 border-l-4`} style={{ borderLeftColor: `var(--${meta.token})` }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">{inc.code}</span>
              <SeverityBadge severity={inc.severity as Severity} />
              <span className="rounded border border-border bg-surface px-2 py-0.5 text-[10px] uppercase tracking-wider">{typeMeta[inc.type as IncidentType]}</span>
              <StatusBadge status={inc.status} />
              {!inc.client_visible && <span className="rounded border border-border bg-surface px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">Internal</span>}
            </div>
            <h1 className="text-xl font-semibold">{inc.title || typeMeta[inc.type as IncidentType]}</h1>
            <div className="text-xs text-muted-foreground">{inc.location} · {inc.zone}</div>
            {inc.description && <p className="text-sm max-w-3xl whitespace-pre-wrap">{inc.description}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs min-w-[260px]">
            <Stat label="Reported" value={fmt(reportedAt)} sub={since(reportedAt)} />
            <Stat
              label="First response"
              value={firstResponse ? duration(reportedAt, firstResponse.created_at) : "—"}
              sub={firstResponse ? "to ack" : "pending"}
            />
            <Stat label="Officer" value={inc.officer || "Unassigned"} />
            <Stat label="Visibility" value={inc.client_visible ? "Client visible" : "Internal only"} />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <AssignControl
            current={inc.officer}
            members={members}
            onAssign={(uid) => reassign({ data: { id, member_user_id: uid } }).then(invalidate)}
          />
          <StatusControl
            current={inc.status}
            onChange={(status, note) => transition({ data: { id, status, note } }).then(invalidate)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <Timeline activity={data.activity as any[]} />
          <NotesPanel
            notes={data.notes as any[]}
            onAdd={(body, client_visible) => addNote({ data: { incident_id: id, body, client_visible } }).then(invalidate)}
          />
          <EvidencePanel
            organisationId={inc.organisation_id}
            evidence={inc.evidence as any[]}
            onAdd={(items) => addEvidence({ data: { incident_id: id, items } }).then(invalidate)}
          />
        </div>

        <div className="space-y-5">
          <EscalationPanel
            escalations={data.escalations as any[]}
            onEscalate={(t, name, phone, message) => escalate({ data: { incident_id: id, target: t, contact_name: name, contact_phone: phone, message } }).then(invalidate)}
            onAck={(eid) => ackEsc({ data: { id: eid } }).then(invalidate)}
            incident={inc}
          />
          <LinkedPanel
            linked={data.linkedIncidents as any[]}
            suggested={data.suggested as any[]}
            onLink={(lid) => linkInc({ data: { incident_id: id, linked_incident_id: lid } }).then(invalidate)}
          />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-medium truncate">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: IncidentStatus }) {
  const color =
    status === "resolved" ? "text-resolved" :
    status === "escalated" ? "text-critical" :
    status === "responding" ? "text-high" :
    status === "closed" ? "text-muted-foreground" :
    "text-foreground";
  return <span className={`text-[10px] uppercase tracking-wider font-semibold ${color}`}>{statusMeta[status] ?? status}</span>;
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xs font-medium truncate">{value}</div>
    </div>
  );
}

function AssignControl({ current, members, onAssign }: {
  current: string | null;
  members: any[];
  onAssign: (uid: string | null) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs hover:bg-surface-2">
        <User className="h-3.5 w-3.5" /> {current ? `Reassign (${current})` : "Assign officer"}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-64 rounded-md border border-border bg-card p-1 shadow-lg max-h-72 overflow-y-auto">
          <button onClick={() => { onAssign(null); setOpen(false); }} className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-surface-2 text-muted-foreground">— Unassign —</button>
          {members.map((m: any) => (
            <button key={m.id} onClick={() => { onAssign(m.user_id); setOpen(false); }} className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-surface-2">
              <div>{m.profile?.display_name || "Member"}</div>
              <div className="text-[10px] text-muted-foreground capitalize">{m.role.replace("_", " ")}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusControl({ current, onChange }: {
  current: IncidentStatus;
  onChange: (s: IncidentStatus, note: string) => Promise<unknown>;
}) {
  const [pending, setPending] = useState<IncidentStatus | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const all: IncidentStatus[] = [...STATUS_FLOW, "escalated", "closed"];
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {all.map((s) => (
          <button
            key={s}
            disabled={s === current}
            onClick={() => { setPending(s); setNote(""); setErr(null); }}
            className={`rounded-md border px-2.5 py-1 text-[11px] uppercase tracking-wider ${
              s === current ? "border-primary/60 bg-primary/15 text-primary" : "border-border bg-surface text-muted-foreground hover:text-foreground"
            }`}
          >
            {statusMeta[s] ?? s}
          </button>
        ))}
      </div>
      {pending && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm px-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-5">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Transition status</div>
            <h3 className="mt-1 text-lg font-semibold">{statusMeta[current]} → {statusMeta[pending]}</h3>
            <textarea
              autoFocus rows={3} required
              value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Reason / note (required for accountability)"
              className="mt-3 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm resize-none"
            />
            {err && <div className="mt-2 text-xs text-critical">{err}</div>}
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setPending(null)} className="rounded-md border border-border bg-surface px-3 py-2 text-xs">Cancel</button>
              <button
                disabled={busy || !note.trim()}
                onClick={async () => {
                  setBusy(true); setErr(null);
                  try { await onChange(pending, note.trim()); setPending(null); }
                  catch (e) { setErr((e as Error).message); }
                  finally { setBusy(false); }
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-60"
              >
                {busy && <Loader2 className="h-3 w-3 animate-spin" />} Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Timeline({ activity }: { activity: any[] }) {
  const iconFor = (kind: string) =>
    kind === "status_changed" ? CheckCircle2 :
    kind === "assigned" ? User :
    kind === "note" || kind === "client_note" ? MessageSquare :
    kind === "evidence_added" ? Paperclip :
    kind === "escalation" ? AlertOctagon :
    kind === "link_added" ? LinkIcon :
    Clock;
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-semibold mb-3">Activity timeline</h2>
      {activity.length === 0 ? (
        <div className="text-xs text-muted-foreground">No activity yet.</div>
      ) : (
        <ol className="space-y-3">
          {activity.map((a) => {
            const Icon = iconFor(a.kind);
            return (
              <li key={a.id} className="flex gap-3">
                <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface border border-border">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm">{a.message}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {a.actor_name || "System"} · {fmt(a.created_at)} · {since(a.created_at)}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function NotesPanel({ notes, onAdd }: { notes: any[]; onAdd: (body: string, cv: boolean) => Promise<unknown> }) {
  const [body, setBody] = useState("");
  const [cv, setCv] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-semibold mb-3">Notes & communication</h2>
      <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
        {notes.length === 0 && <div className="text-xs text-muted-foreground">No notes yet.</div>}
        {notes.map((n) => (
          <div key={n.id} className={`rounded-md border px-3 py-2 ${n.client_visible ? "border-accent/40 bg-accent/5" : "border-border bg-surface"}`}>
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>{n.author_name || "Operator"} · {since(n.created_at)}</span>
              <span>{n.client_visible ? "Client visible" : "Internal"}</span>
            </div>
            <div className="mt-1 text-sm whitespace-pre-wrap">{n.body}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 space-y-2">
        <textarea
          value={body} onChange={(e) => setBody(e.target.value)} rows={2} maxLength={2000}
          placeholder="Add a note. Use @ to mention…"
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm resize-none"
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={cv} onChange={(e) => setCv(e.target.checked)} /> Client visible
          </label>
          <button
            disabled={busy || !body.trim()}
            onClick={async () => { setBusy(true); try { await onAdd(body.trim(), cv); setBody(""); setCv(false); } finally { setBusy(false); } }}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Post note
          </button>
        </div>
      </div>
    </section>
  );
}

function EvidencePanel({ organisationId, evidence, onAdd }: {
  organisationId: string;
  evidence: any[];
  onAdd: (items: { path: string; kind: any; size: number; name: string }[]) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [enlarged, setEnlarged] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    const ext = file.name.split(".").pop() || "bin";
    const path = `${organisationId}/added/${crypto.randomUUID()}.${ext}`;
    const kind: any = file.type.startsWith("image/") ? "image" :
      file.type.startsWith("video/") ? "video" :
      file.type.startsWith("audio/") ? "audio" : "document";
    const { error } = await supabase.storage.from("incident-evidence").upload(path, file, { contentType: file.type });
    if (!error) {
      await onAdd([{ path, kind, size: file.size, name: file.name }]);
    } else {
      alert(`Upload failed: ${error.message}`);
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold">Evidence ({evidence.length})</h2>
        <button onClick={() => fileRef.current?.click()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs hover:bg-surface-2">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />} Add evidence
        </button>
        <input ref={fileRef} type="file" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </div>
      {evidence.length === 0 ? (
        <div className="text-xs text-muted-foreground">No evidence attached.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {evidence.map((ev: any) => (
            <div key={ev.path} className="rounded-md border border-border bg-surface overflow-hidden">
              {ev.kind === "image" && ev.url ? (
                <button onClick={() => setEnlarged(ev.url)} className="block w-full">
                  <img src={ev.url} alt={ev.name} className="w-full h-28 object-cover" />
                </button>
              ) : ev.kind === "video" && ev.url ? (
                <video src={ev.url} controls className="w-full h-28 object-cover bg-black" />
              ) : ev.kind === "audio" && ev.url ? (
                <div className="p-2"><audio src={ev.url} controls className="w-full" /></div>
              ) : (
                <a href={ev.url ?? "#"} target="_blank" rel="noreferrer" className="flex h-28 flex-col items-center justify-center text-xs text-muted-foreground hover:text-foreground">
                  <FileText className="h-6 w-6" />
                  <span className="mt-1 truncate max-w-full px-2">{ev.name}</span>
                </a>
              )}
              <div className="px-2 py-1 text-[10px] text-muted-foreground flex items-center gap-1 truncate">
                {ev.kind === "image" ? <ImageIcon className="h-3 w-3" /> :
                 ev.kind === "video" ? <VideoIcon className="h-3 w-3" /> :
                 ev.kind === "audio" ? <Mic className="h-3 w-3" /> :
                 <FileText className="h-3 w-3" />}
                <span className="truncate">{ev.name}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {enlarged && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-4" onClick={() => setEnlarged(null)}>
          <img src={enlarged} alt="" className="max-h-full max-w-full" />
        </div>
      )}
    </section>
  );
}

function EscalationPanel({ escalations, onEscalate, onAck, incident }: {
  escalations: any[];
  onEscalate: (target: any, name: string, phone: string, message: string) => Promise<unknown>;
  onAck: (id: string) => Promise<unknown>;
  incident: any;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<typeof ESCALATION_TARGETS[number]["key"]>("police");
  const [customName, setCustomName] = useState("");
  const [customPhone, setCustomPhone] = useState("");
  const draft = useMemo(() => {
    return `URGENT — ${typeMeta[incident.type as IncidentType]} (Severity ${incident.severity})\n` +
      `Location: ${incident.location}, ${incident.zone}\n` +
      `Time: ${fmt(incident.reported_at)}\n` +
      `Officer on scene: ${incident.officer || "Unassigned"}\n` +
      `Details: ${incident.description || "—"}\n` +
      `Ref: ${incident.code}`;
  }, [incident]);
  const [message, setMessage] = useState(draft);
  const [busy, setBusy] = useState(false);

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5"><ShieldAlert className="h-3.5 w-3.5 text-critical" /> Escalation</h2>
      {!open ? (
        <button onClick={() => { setOpen(true); setMessage(draft); }} className="w-full rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical hover:bg-critical/15">
          Escalate to authorities
        </button>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-1.5">
            {ESCALATION_TARGETS.map((t) => (
              <button key={t.key} onClick={() => setTarget(t.key)} className={`rounded-md border px-2 py-1.5 text-[11px] uppercase tracking-wider ${target === t.key ? "border-primary/60 bg-primary/15 text-primary" : "border-border bg-surface text-muted-foreground"}`}>
                {t.label}
              </button>
            ))}
          </div>
          {target === "custom" && (
            <div className="grid grid-cols-2 gap-2">
              <input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="Contact name" className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs" />
              <input value={customPhone} onChange={(e) => setCustomPhone(e.target.value)} placeholder="Phone" className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs" />
            </div>
          )}
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6} className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs font-mono" />
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs">Cancel</button>
            <button
              disabled={busy || !message.trim()}
              onClick={async () => {
                setBusy(true);
                try {
                  const t = ESCALATION_TARGETS.find((x) => x.key === target)!;
                  await onEscalate(target, target === "custom" ? customName : t.label, target === "custom" ? customPhone : t.phone, message.trim());
                  setOpen(false);
                } finally { setBusy(false); }
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-critical px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
            >
              {busy && <Loader2 className="h-3 w-3 animate-spin" />} Send escalation
            </button>
          </div>
        </div>
      )}

      {escalations.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">History</div>
          {escalations.map((e) => (
            <div key={e.id} className="rounded-md border border-border bg-surface px-3 py-2 text-xs">
              <div className="flex items-center justify-between">
                <div className="font-medium uppercase tracking-wider text-[10px]">{e.target}</div>
                <div className="text-[10px] text-muted-foreground">{since(e.created_at)}</div>
              </div>
              {e.contact_name && (
                <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-1">
                  <Phone className="h-3 w-3" /> {e.contact_name} {e.contact_phone && `· ${e.contact_phone}`}
                </div>
              )}
              <div className="mt-1 flex items-center justify-between">
                <span className={`text-[10px] uppercase tracking-wider ${e.acknowledged ? "text-resolved" : "text-medium"}`}>
                  {e.acknowledged ? "Acknowledged" : "Pending response"}
                </span>
                {!e.acknowledged && (
                  <button onClick={() => onAck(e.id)} className="text-[10px] uppercase tracking-wider text-primary hover:underline">Mark acknowledged</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function LinkedPanel({ linked, suggested, onLink }: {
  linked: any[];
  suggested: any[];
  onLink: (id: string) => Promise<unknown>;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5"><LinkIcon className="h-3.5 w-3.5" /> Related incidents</h2>
      {linked.length === 0 ? (
        <div className="text-xs text-muted-foreground">No linked incidents.</div>
      ) : (
        <div className="space-y-1.5">
          {linked.map((l) => (
            <Link key={l.id} to="/app/incidents/$id" params={{ id: l.id }} className="block rounded-md border border-border bg-surface px-3 py-2 text-xs hover:bg-surface-2">
              <div className="flex items-center justify-between">
                <span className="font-mono">{l.code}</span>
                <SeverityBadge severity={l.severity as Severity} />
              </div>
              <div className="mt-1 text-muted-foreground truncate">{typeMeta[l.type as IncidentType]} · {l.location}</div>
            </Link>
          ))}
        </div>
      )}
      {suggested.length > 0 && (
        <div className="mt-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Suggested (same zone, ±24h)</div>
          <div className="space-y-1.5">
            {suggested.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-xs">
                <div className="min-w-0">
                  <div className="font-mono">{s.code}</div>
                  <div className="text-muted-foreground truncate">{typeMeta[s.type as IncidentType]} · {since(s.reported_at)}</div>
                </div>
                <button onClick={() => onLink(s.id)} className="text-[10px] uppercase tracking-wider text-primary hover:underline">Link</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
