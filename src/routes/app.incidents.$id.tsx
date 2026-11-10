import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  getIncidentDetail,
  recordIncidentAction,
  transitionIncidentStatus,
  reassignIncident,
  addIncidentNote,
  addIncidentEvidence,
  linkIncidents,
  createEscalation,
  acknowledgeEscalation,
  updateIncidentEvidence,
} from "@/lib/incidentDetail.functions";
import { listMembers, listLocations, findProximityMembers } from "@/lib/orgs.functions";
import { createDispatchAlert } from "@/lib/alerts.functions";
import { severityMeta, statusMeta, typeMeta, type Severity, type IncidentStatus, type IncidentType } from "@/lib/mockData";
import { useRealtimeInvalidate } from "@/lib/useRealtime";
import { orgRoom, officerRoom, publishRealtimeEvent } from "@/lib/realtime.events";
import { requireSectionAccess } from "@/lib/rbac";
import { Avatar, Confidence, Notice, Sev, elapsed, timeAgo, useNow } from "@/components/nw";
import { IncidentProposals } from "@/components/AiProposals";
import { LocationPicker } from "@/components/LocationPicker";
import { CaseFileButton } from "@/components/CaseFileButton";
import {
  ArrowLeft,
  ArrowUpRight,
  BellRing,
  Check,
  ClipboardList,
  Clock4,
  Download,
  FileText,
  History,
  Info,
  Link as LinkIcon,
  Loader2,
  MapPin,
  MessageSquare,
  Mic,
  Navigation,
  Paperclip,
  Phone,
  PhoneCall,
  Plus,
  RotateCcw,
  Send,
  Shield,
  ShieldCheck,
  Siren,
  Sparkles,
  UserCheck,
  Video as VideoIcon,
  X,
} from "lucide-react";

type IncidentTab = "response" | "overview" | "evidence" | "timeline" | "escalations" | "related";
type AnyRecord = Record<string, any>;

export const Route = createFileRoute("/app/incidents/$id")({
  head: () => ({ meta: [{ title: "Incident · Lemtik SOD" }] }),
  beforeLoad: async ({ params, context }) => {
    const access = context.appAccess;
    if (access.specRole === "field_officer") {
      const [{ data: incident }, { data: profile }] = await Promise.all([
        supabase.from("incidents").select("id, reported_by, officer").eq("id", params.id).maybeSingle(),
        supabase.from("profiles").select("display_name").eq("user_id", access.userId).maybeSingle(),
      ]);
      const reporterOwned = incident?.reported_by === access.userId;
      const officerOwned = !!profile?.display_name && incident?.officer === profile.display_name;
      if (!reporterOwned && !officerOwned) throw redirect({ to: "/officer/home" });
      return { appAccess: access };
    }
    requireSectionAccess(access, ["security_manager", "operator", "client_admin"]);
    return { appAccess: access };
  },
  component: IncidentDetailPage,
});

const STATUS_FLOW: IncidentStatus[] = ["reported", "acknowledged", "responding", "contained", "resolved"];
const ESCALATION_TARGETS = [
  { key: "police", label: "Nigeria Police", phone: "112" },
  { key: "lasema", label: "LASEMA", phone: "767" },
  { key: "nscdc", label: "NSCDC", phone: "08032003557" },
  { key: "custom", label: "Custom contact", phone: "" },
] as const;

const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB");
function duration(fromIso: string, toIso?: string) {
  const m = Math.floor(((toIso ? new Date(toIso).getTime() : Date.now()) - new Date(fromIso).getTime()) / 60000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
function firstString(...values: unknown[]) {
  for (const v of values) if (typeof v === "string" && v.trim()) return v.trim();
  return "";
}
function listFromValue(value: unknown) {
  if (Array.isArray(value)) return value.filter((i): i is string => typeof i === "string" && !!i.trim());
  if (typeof value === "string" && value.trim()) return value.split(",").map((i) => i.trim()).filter(Boolean);
  return [];
}
const isRecord = (v: unknown): v is AnyRecord => !!v && typeof v === "object" && !Array.isArray(v);
function firstRecordArray(...values: unknown[]) {
  for (const v of values) if (Array.isArray(v)) {
    const r = v.filter(isRecord);
    if (r.length) return r as AnyRecord[];
  }
  return [] as AnyRecord[];
}
function percentOrNull(value: unknown) {
  const n = Number(value);
  if (value == null || value === "" || !Number.isFinite(n)) return null;
  return n <= 1 ? Math.round(n * 100) : Math.round(n);
}

function IncidentDetailPage() {
  const { id } = Route.useParams();
  const canCaseFile = Route.useRouteContext().appAccess?.specRole !== "field_officer";
  const { appAccess } = Route.useRouteContext();
  const qc = useQueryClient();
  const now = useNow(1000);
  const readOnly = appAccess.specRole === "client_admin";
  const [tab, setTab] = useState<IncidentTab>("response");
  const [pendingStatus, setPendingStatus] = useState<IncidentStatus | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const get = useServerFn(getIncidentDetail);
  const transition = useServerFn(transitionIncidentStatus);
  const reassign = useServerFn(reassignIncident);
  const addNote = useServerFn(addIncidentNote);
  const addEvidence = useServerFn(addIncidentEvidence);
  const linkInc = useServerFn(linkIncidents);
  const escalate = useServerFn(createEscalation);
  const ackEsc = useServerFn(acknowledgeEscalation);
  const recordAction = useServerFn(recordIncidentAction);
  const dispatchAlert = useServerFn(createDispatchAlert);
  const patchEvidence = useServerFn(updateIncidentEvidence);
  const fetchMembers = useServerFn(listMembers);
  const fetchLocations = useServerFn(listLocations);
  const fetchProximity = useServerFn(findProximityMembers);

  useRealtimeInvalidate("incidents", [["incident", id]]);
  useRealtimeInvalidate("incident_activity", [["incident", id]]);
  useRealtimeInvalidate("incident_notes", [["incident", id]]);
  useRealtimeInvalidate("incident_escalations", [["incident", id]]);
  useRealtimeInvalidate("organisation_locations", [["locations"], ["incident", id]]);
  useRealtimeInvalidate("profiles", [["members"]]);

  const { data, isLoading, error } = useQuery({ queryKey: ["incident", id], queryFn: () => get({ data: { id } }) });
  const { data: members = [] } = useQuery({ queryKey: ["members"], queryFn: () => fetchMembers() });
  const { data: locations = [] } = useQuery({ queryKey: ["locations"], queryFn: () => fetchLocations() });
  const reportedBy = data?.incident?.reported_by ?? null;
  const { data: reporterProfile } = useQuery({
    queryKey: ["incident-reporter", reportedBy],
    queryFn: async () => {
      if (!reportedBy) return null;
      const { data } = await supabase.from("profiles").select("display_name").eq("user_id", reportedBy).maybeSingle();
      return data ?? null;
    },
    enabled: !!reportedBy,
  });

  // Opening a guest-triggered incident is what clears it from the priority bar's guest SOS alert.
  useEffect(() => {
    const incident = data?.incident as { source?: string; acknowledged_at?: string | null } | undefined;
    if (!incident || incident.source !== "consumer_pwa" || incident.acknowledged_at) return;
    void supabase.from("incidents" as any).update({ acknowledged_at: new Date().toISOString() }).eq("id", id);
  }, [data?.incident, id]);

  useEffect(() => {
    if (sessionStorage.getItem("lemtik-open-incident-tab") !== id) return;
    setTab("response");
    sessionStorage.removeItem("lemtik-open-incident-tab");
  }, [id]);

  useEffect(() => {
    const channel = supabase
      .channel(`incident-live:${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "incidents", filter: `id=eq.${id}` }, (payload) => {
        const next = payload.new as AnyRecord;
        qc.setQueryData(["incident", id], (old: any) => (old ? { ...old, incident: { ...(old.incident ?? {}), ...next } } : old));
        if ((payload.old as AnyRecord | null)?.status !== next.status) void qc.invalidateQueries({ queryKey: ["incident", id] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, qc]);

  const inc = data?.incident as any | undefined;

  // Only a real position: the incident's own, its saved location's, or a same-named zone's.
  const incidentPoint = useMemo<[number, number] | null>(() => {
    if (!inc) return null;
    if (inc.coord_x != null && inc.coord_y != null) return [Number(inc.coord_x), Number(inc.coord_y)];
    const loc = (locations as any[]).find(
      (l) => (l.id === inc.location_id || l.name?.toLowerCase() === String(inc.zone ?? "").toLowerCase()) && l.coord_x != null && l.coord_y != null,
    );
    return loc ? [Number(loc.coord_x), Number(loc.coord_y)] : null;
  }, [inc, locations]);

  const { data: proximity = [] } = useQuery({
    queryKey: ["incident-proximity", id, incidentPoint?.[0], incidentPoint?.[1]],
    queryFn: () =>
      fetchProximity({ data: { coord_x: incidentPoint![0], coord_y: incidentPoint![1], incident_id: id, org_id: appAccess.orgId, limit: 6 } }) as Promise<
        Array<{ id: string; user_id: string; name: string; role: string; zone: string; status: string; distance: number }>
      >,
    enabled: !!inc && !!incidentPoint,
  });

  const [decisionNote, setDecisionNote] = useState("");
  const [editingDecision, setEditingDecision] = useState(false);
  const [recordingDecision, setRecordingDecision] = useState(false);

  if (isLoading) {
    return (
      <div className="row g8 t2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading incident…
      </div>
    );
  }
  if (error || !data || !inc) return <Notice tone="fail">Couldn’t load this incident.</Notice>;

  const invalidate = () => qc.invalidateQueries({ queryKey: ["incident", id] });
  const evidenceItems = Array.isArray(inc.evidence) ? inc.evidence : [];
  const activityRows = data.activity as any[];
  const escalationRows = data.escalations as any[];
  const linkedIncidents = data.linkedIncidents as any[];
  const suggestedRows = data.suggested as any[];
  const analysis = isRecord(inc.analysis) ? inc.analysis : {};
  const plan = isRecord(inc.dispatch_plan) ? inc.dispatch_plan : {};
  const agent = isRecord(inc.agent_output) ? inc.agent_output : {};
  const ai = { ...analysis, ...plan, ...agent, ...(isRecord(analysis.historical_context) ? analysis.historical_context : {}), ...(isRecord(agent.historical_context) ? agent.historical_context : {}) };
  const hasAi = Object.keys(analysis).length + Object.keys(plan).length + Object.keys(agent).length > 0;
  const aiSummary = firstString(ai.situation_summary, ai.context_summary, ai.intelligence_summary, ai.summary, ai.historical_summary, ai.pattern_summary);
  const aiConfidence = percentOrNull(ai.confidence ?? ai.recommendation_confidence ?? ai.analysis_confidence);
  const aiThreat = firstString(ai.threat_level, ai.threatLevel, ai.threat_assessment, ai.risk_level);
  const aiSuspectStatus = firstString(ai.suspect_status, ai.suspectStatus);
  const aiZoneScore = percentOrNull(ai.area_risk_score ?? ai.zone_score ?? ai.risk_score);
  const aiTrend = firstString(ai.trend, ai.pattern_trend, ai.zone_trend, ai.risk_trend);
  const analysisPending = !hasAi && ["reported", "acknowledged"].includes(String(inc.status));
  const reporterLabel = reporterProfile?.display_name || (reportedBy ? "Unknown member" : "System");
  const statusTimes = new Map<string, string>();
  for (const a of [...activityRows].reverse()) if (a.kind === "status_changed" && a.meta?.to && !statusTimes.has(a.meta.to)) statusTimes.set(a.meta.to, a.created_at);
  statusTimes.set("reported", inc.reported_at);
  const open = inc.status !== "resolved" && inc.status !== "closed";
  const currentIdx = inc.status === "escalated" ? 2 : STATUS_FLOW.indexOf(inc.status);
  const nextStatus = currentIdx >= 0 && currentIdx < STATUS_FLOW.length - 1 ? STATUS_FLOW[currentIdx + 1] : null;
  const title = inc.title || typeMeta[inc.type as IncidentType];

  const payloadOfficers = firstRecordArray(
    analysis.recommended_officers, analysis.recommended_responders, analysis.dispatch_recommendations,
    plan.recommended_officers, plan.recommended_responders, plan.dispatch_recommendations,
    agent.recommended_officers, agent.recommended_responders, agent.dispatch_recommendations,
  );
  const responders = (payloadOfficers.length ? payloadOfficers : (proximity as AnyRecord[])).map((o, idx) => {
    const near = payloadOfficers.length ? (proximity as AnyRecord[]).find((p) => p.id === o.id || p.user_id === o.user_id || p.name === o.name) : o;
    const distance = Number(o.distance ?? o.distance_m ?? o.distance_meters ?? near?.distance);
    return {
      id: firstString(o.user_id, o.id, o.officer_id, o.member_user_id, near?.user_id, near?.id) || `${inc.id}-officer-${idx}`,
      name: firstString(o.name, o.display_name, o.officer_name, o.full_name, near?.name) || `Officer ${idx + 1}`,
      zone: firstString(o.zone, o.location_zone, near?.zone),
      distance: Number.isFinite(distance) ? distance : null,
      eta: firstString(o.eta, o.eta_display, o.eta_text, near?.eta),
      byRoad: (o.distance_kind ?? near?.distance_kind) === "road",
      route: firstString(o.route, o.dispatch_route, o.route_summary),
      equipment: listFromValue(o.equipment),
      instructions: firstString(o.instructions, o.guidance, o.note),
      fromAi: payloadOfficers.length > 0,
    };
  });
  const assignedName = inc.officer as string | null;

  const payloadActions = firstRecordArray(
    analysis.autonomous_actions, analysis.infrastructure_actions, analysis.action_recommendations,
    plan.autonomous_actions, plan.infrastructure_actions, plan.action_recommendations,
    agent.autonomous_actions, agent.infrastructure_actions, agent.action_recommendations,
  );
  const latestAction = new Map<string, any>();
  for (const row of activityRows) {
    if (!["autonomous_action", "override_action"].includes(row.kind)) continue;
    const key = row.meta?.action_id || row.meta?.id || row.meta?.key;
    if (key && !latestAction.has(String(key))) latestAction.set(String(key), row);
  }
  const siteActions = payloadActions.map((a, idx) => {
    const actionId = firstString(a.id, a.action_id) || `${inc.id}-action-${idx}`;
    return {
      id: actionId,
      label: firstString(a.label, a.title, a.name) || `Action ${idx + 1}`,
      auto: a.auto_execute === true || a.auto === true || a.kind === "auto" || a.execution_mode === "auto",
      blocked: a.blocked === true || a.state === "blocked" || a.status === "blocked",
      detail: firstString(a.detail, a.description, a.reason, a.summary),
      approval: firstString(a.approval, a.approval_level, a.required_approval),
      risk: firstString(a.risk, a.risk_level),
      confidence: percentOrNull(a.confidence),
      last: latestAction.get(actionId) ?? null,
    };
  });
  const payloadVehicles = firstRecordArray(analysis.vehicle_recommendations, analysis.recommended_vehicles, plan.vehicle_recommendations, plan.recommended_vehicles, agent.vehicle_recommendations, agent.recommended_vehicles);

  const runDispatchAction = async (action: "dispatch_ping" | "dispatch_route", officer: { id: string; name: string; distance: number | null }, message: string) => {
    try {
      await recordAction({ data: { incident_id: id, kind: action, message, meta: { officer_id: officer.id, officer_name: officer.name, distance_m: officer.distance == null ? null : Math.round(officer.distance) } } });
      await dispatchAlert({
        data: {
          incident_id: id,
          recipient_user_id: officer.id,
          title: action === "dispatch_ping" ? `Dispatch ping · ${inc.code}` : `Route sent · ${inc.code}`,
          body: `${message} ${action === "dispatch_route" ? "Open the navigation view for turn-by-turn guidance." : "Open the incident card for details and instructions."}`,
          action: action === "dispatch_route" ? "Open navigation" : "Acknowledge dispatch",
          alert_type: action === "dispatch_route" ? "incident_route" : "incident_assigned",
          severity: Math.max(Number(inc.severity) || 1, 3),
        },
      });
      publishRealtimeEvent(officerRoom(officer.id), action === "dispatch_ping" ? "officer:ping" : "officer:dispatch", { incident_id: id, incident_code: inc.code, action, message, officer_id: officer.id, officer_name: officer.name, severity: inc.severity });
      publishRealtimeEvent(orgRoom(appAccess.orgId), action === "dispatch_ping" ? "officer:pinged" : "incident:updated", { incident_id: id, officer_id: officer.id, officer_name: officer.name, action, severity: inc.severity });
      toast.success(action === "dispatch_ping" ? `Pinged ${officer.name}` : `Route sent to ${officer.name}`);
      await invalidate();
    } catch (err) {
      toast.error("Couldn’t reach that officer", { description: err instanceof Error ? err.message : undefined });
    }
  };

  const assignTo = (uid: string | null) =>
    reassign({ data: { id, member_user_id: uid } })
      .then(() => {
        publishRealtimeEvent(orgRoom(appAccess.orgId), "incident:assigned", { incident_id: id, incident_code: inc.code, member_user_id: uid });
        toast.success(uid ? "Assigned" : "Unassigned");
        return invalidate();
      })
      .catch((err) => toast.error("Couldn’t change the assignment", { description: err instanceof Error ? err.message : undefined }));

  const recordOperatorDecision = async (decision: "accepted" | "edited", note?: string) => {
    setRecordingDecision(true);
    try {
      await recordAction({
        data: {
          incident_id: id,
          kind: "operator_decision",
          message: decision === "accepted" ? `Operator accepted the AI recommendation as-is (${responders.length} officer${responders.length === 1 ? "" : "s"}).` : `Operator changed the AI recommendation: ${note}`,
          meta: { decision, note: note ?? null, recommended_officer_ids: responders.map((o) => o.id), recommended_officer_count: responders.length },
        },
      });
      await invalidate();
      setEditingDecision(false);
      setDecisionNote("");
    } finally {
      setRecordingDecision(false);
    }
  };

  const decideSiteAction = async (action: (typeof siteActions)[number], state: "approved" | "denied" | "reverted") => {
    await recordAction({
      data: { incident_id: id, kind: "autonomous_action", message: `${action.label} ${state}`, meta: { action_id: action.id, state, action: action.label, source: state === "reverted" ? "manual-override" : "master-agent" } },
    });
    await invalidate();
  };

  const quickEscalate = (target: "police" | "lasema", label: string, phone: string) =>
    escalate({ data: { incident_id: id, target, contact_name: label, contact_phone: phone, message: `Escalation for ${inc.code} at ${inc.location}.` } })
      .then(() => {
        toast.success(`Logged escalation to ${label}`);
        return invalidate();
      })
      .catch((err) => toast.error("Couldn’t log the escalation", { description: err instanceof Error ? err.message : undefined }));

  const tabs: { value: IncidentTab; label: string; count?: number }[] = [
    { value: "response", label: "Response" },
    { value: "overview", label: "Overview" },
    { value: "evidence", label: "Evidence", count: evidenceItems.length },
    { value: "timeline", label: "Timeline", count: activityRows.length },
    { value: "escalations", label: "Escalations", count: escalationRows.length },
    { value: "related", label: "Related", count: linkedIncidents.length + suggestedRows.length },
  ];

  return (
    <div className="col g12">
      <div className="row g8 t3" style={{ fontSize: 12 }}>
        <Link to="/app/incidents" className="row g4 t3 hover:text-tx-1">
          <ArrowLeft size={13} strokeWidth={1.75} /> Incidents
        </Link>
        <span>/</span>
        <span className="mono">{inc.code}</span>
        <span className="f1" />
        {canCaseFile && <CaseFileButton kind="incident" id={id} />}
      </div>

      <div className="row g16 wrap" style={{ alignItems: "center" }}>
        <div className="col g6 min-w-0">
          <div className="row g10 wrap">
            <Sev level={inc.severity} label />
            <h1 className="ph1" style={{ fontSize: 22 }}>{title}</h1>
            <span className="mono t3" style={{ fontSize: 13 }}>{inc.code}</span>
            {!inc.client_visible && <span className="tg">Internal</span>}
          </div>
          <div className="row g12 wrap t2" style={{ fontSize: 12.5 }}>
            <span className="row g4"><MapPin size={13} strokeWidth={1.75} /> {[inc.location, inc.zone, inc.floor].filter(Boolean).join(" · ")}</span>
            <span className="row g4"><UserCheck size={13} strokeWidth={1.75} /> Reported by {reporterLabel}</span>
            <span className="row g4"><Clock4 size={13} strokeWidth={1.75} /> {fmt(inc.reported_at)}</span>
          </div>
        </div>
        <span className="flex-auto" />
        <div className="col" style={{ alignItems: "flex-end" }}>
          <span className="t3" style={{ fontSize: 11.5 }}>{open ? "Open for" : "Closed after"}</span>
          <span className="mono" style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.02em", color: open && Number(inc.severity) >= 4 ? "#FF8E90" : "var(--tx-1)" }}>
            {open ? elapsed(inc.reported_at, now) : duration(inc.reported_at, statusTimes.get(inc.status) ?? inc.updated_at)}
          </span>
        </div>
        <div className="vr" />
        <div className="col g4">
          <span className="t3" style={{ fontSize: 11.5 }}>Assigned</span>
          <span className="row g4">
            {assignedName ? <span title={assignedName}><Avatar name={assignedName} own /></span> : <span className="tg tg-warn">Nobody</span>}
            {!readOnly && (
              <span className="relative">
                <button type="button" className="ibtn" style={{ width: 24, height: 24, borderRadius: "50%" }} aria-label="Change assignment" aria-expanded={assignOpen} onClick={() => setAssignOpen((o) => !o)}>
                  <Plus size={13} strokeWidth={1.75} />
                </button>
                {assignOpen && (
                  <div className="pn absolute right-0 z-30 mt-1 w-64 overflow-y-auto shadow-2xl" style={{ maxHeight: 300, background: "var(--ink-2)", borderColor: "var(--line-2)" }}>
                    <button type="button" className="w-full px-3 py-2 text-left t3 hover:bg-ink-3" onClick={() => { setAssignOpen(false); void assignTo(null); }}>
                      Unassign
                    </button>
                    {(members as any[]).map((m) => (
                      <button key={m.id} type="button" className="row g8 w-full px-3 py-2 text-left hover:bg-ink-3" onClick={() => { setAssignOpen(false); void assignTo(m.user_id); }}>
                        <Avatar name={m.profile?.display_name} />
                        <span className="f1 trunc">{m.profile?.display_name || "Member"}</span>
                        <span className="t3 capitalize" style={{ fontSize: 11 }}>{String(m.role).replace("_", " ")}</span>
                      </button>
                    ))}
                  </div>
                )}
              </span>
            )}
          </span>
        </div>
        {!readOnly && (
          <>
            <button type="button" className="b b-sec" onClick={() => setTab("escalations")}>
              <ArrowUpRight size={15} strokeWidth={1.75} /> Escalate
            </button>
            {nextStatus && (
              <button type="button" className="b b-pri" onClick={() => setPendingStatus(nextStatus)}>
                Mark {statusMeta[nextStatus].toLowerCase()}
              </button>
            )}
            <label className="relative">
              <span className="sr-only">Set any status</span>
              <select className="in" style={{ height: 32, width: "auto" }} value="" onChange={(e) => e.target.value && setPendingStatus(e.target.value as IncidentStatus)}>
                <option value="">More…</option>
                {([...STATUS_FLOW, "escalated", "closed"] as IncidentStatus[]).filter((s) => s !== inc.status).map((s) => (
                  <option key={s} value={s}>Set to {statusMeta[s]}</option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>

      <div className="row g8 wrap" aria-label="Incident lifecycle">
        {STATUS_FLOW.map((s, idx) => {
          const done = inc.status === "resolved" || inc.status === "closed" ? true : idx < currentIdx;
          const current = idx === currentIdx && open;
          const at = statusTimes.get(s);
          return (
            <span key={s} className="row g8">
              {idx > 0 && <span style={{ width: 32, height: 2, background: done || current ? "var(--ok)" : "var(--line-2)", display: "block" }} />}
              <span className="row g8">
                {done ? (
                  <span className="grid place-items-center" style={{ width: 18, height: 18, borderRadius: "50%", background: "var(--ok)", color: "#06140C" }}><Check size={12} strokeWidth={2.5} /></span>
                ) : current ? (
                  <span className="grid place-items-center" style={{ width: 18, height: 18, borderRadius: "50%", border: "2px solid var(--blue-hi)" }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--blue-hi)", display: "block" }} /></span>
                ) : (
                  <span style={{ width: 18, height: 18, borderRadius: "50%", border: "1.5px solid var(--line-3)", display: "block" }} />
                )}
                <span className="col">
                  <span style={{ fontSize: 12.5, fontWeight: current ? 600 : 500, color: current ? "var(--tx-1)" : done ? "var(--tx-2)" : "var(--tx-3)" }}>{statusMeta[s]}</span>
                  {at && (done || current) && <span className="mono t3" style={{ fontSize: 11 }}>{current && s !== "reported" ? "since " : ""}{fmtTime(at)}</span>}
                </span>
              </span>
            </span>
          );
        })}
        {inc.status === "escalated" && <span className="tg tg-fail">Escalated</span>}
      </div>

      <div className="tabs" role="tablist" aria-label="Incident sections">
        {tabs.map((t) => (
          <button key={t.value} type="button" role="tab" aria-selected={tab === t.value} className={`tab${tab === t.value ? " on" : ""}`} onClick={() => setTab(t.value)}>
            {t.value === "response" && <Sparkles size={14} strokeWidth={1.75} />}
            {t.label}
            {t.count !== undefined && <span className="c">{t.count}</span>}
          </button>
        ))}
      </div>

      {tab === "response" && (
        <div className="flex flex-wrap items-start" style={{ gap: 12 }}>
          <div className="col g12" style={{ flex: "1 1 280px", minWidth: 0, maxWidth: "100%" }}>
            {incidentPoint ? <LocationPicker value={incidentPoint} center={incidentPoint} height={220} readOnly /> : <div className="card empty" style={{ padding: 14 }}>No position recorded for this incident, so it isn’t on the map and nearby officers can’t be ranked by distance.</div>}
            <section className="pn">
              <div className="pn-h"><Info size={15} strokeWidth={1.75} className="ic" /><h3>Situation</h3></div>
              <div className="pn-b">
                <dl className="kv" style={{ margin: 0 }}>
                  <dt>Suspects</dt><dd>{[inc.suspect_count ? `${inc.suspect_count}` : null, inc.suspect_description].filter(Boolean).join(" · ") || <span className="t3">Not recorded</span>}</dd>
                  {aiSuspectStatus && (<><dt>Suspect status</dt><dd>{aiSuspectStatus} <span className="tg tg-ai">AI</span></dd></>)}
                  {aiThreat && (<><dt>Threat</dt><dd>{aiThreat} <span className="tg tg-ai">AI</span></dd></>)}
                  <dt>Victims</dt><dd>{[inc.victim_name, inc.victim_contact].filter(Boolean).join(" · ") || <span className="t3">None recorded</span>}</dd>
                  <dt>Witnesses</dt><dd>{inc.witnesses || <span className="t3">None recorded</span>}</dd>
                  {aiZoneScore != null && (<><dt>Zone risk</dt><dd>{aiZoneScore}/100{aiTrend ? ` · ${aiTrend}` : ""} <span className="tg tg-ai">AI</span></dd></>)}
                  <dt>Reported by</dt><dd>{reporterLabel}</dd>
                  <dt>Visibility</dt><dd>{inc.client_visible ? "Client can see it" : "Internal only"}</dd>
                </dl>
              </div>
            </section>
            <section className="pn">
              <div className="pn-h">
                <Paperclip size={15} strokeWidth={1.75} className="ic" /><h3>Evidence</h3><span className="meta">{evidenceItems.length}</span>
                <span className="flex-auto" />
                <button type="button" className="b b-sm b-gh" onClick={() => setTab("evidence")}>{evidenceItems.length ? "View all" : "Add"}</button>
              </div>
              <div className="pn-b">
                {evidenceItems.length === 0 ? (
                  <div className="empty">No evidence attached yet.</div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
                    {evidenceItems.slice(0, 4).map((ev: any) => <EvidenceThumb key={ev.path} ev={ev} />)}
                  </div>
                )}
              </div>
            </section>
          </div>

          <div className="col g12" style={{ flex: "999 1 520px", minWidth: 0 }}>
            {hasAi && aiSummary ? (
              <section className="ai" style={{ padding: "12px 14px" }}>
                <div className="row g8 wrap">
                  <span className="ai-h"><Sparkles size={15} strokeWidth={1.75} /> Situation summary</span>
                  <span className="flex-auto" />
                  <Confidence value={aiConfidence} />
                </div>
                <p style={{ marginTop: 8, fontSize: 14, lineHeight: 1.55 }}>{aiSummary}</p>
                {(aiThreat || listFromValue(ai.tags).length > 0) && (
                  <div className="row g8 wrap" style={{ marginTop: 10 }}>
                    {aiThreat && <span className="tg">Threat · {aiThreat}</span>}
                    {listFromValue(ai.tags).map((t) => <span key={t} className="tg">{t}</span>)}
                  </div>
                )}
              </section>
            ) : (
              <section className="card row g10" style={{ padding: "12px 14px" }}>
                {analysisPending ? <Loader2 className="h-4 w-4 animate-spin t3" /> : <Sparkles size={15} strokeWidth={1.75} className="ic t3" />}
                <span className="t2" style={{ fontSize: 12.5 }}>
                  {analysisPending ? "AI analysis is running — the summary and dispatch plan appear here when they arrive." : "No AI summary for this incident."}
                </span>
              </section>
            )}

            <section className="pn">
              <div className="pn-h">
                <Navigation size={15} strokeWidth={1.75} className="ic" />
                <h3>Dispatch</h3>
                <span className="meta">{responders.length ? (responders[0].fromAi ? "AI recommendation" : `${responders[0].eta ? "Nearest by driving time" : "Nearest by distance"} · ${responders.length}`) : "No responders ranked"}</span>
              </div>
              <div className="pn-b col g8">
                {assignedName && !responders.some((r) => r.name === assignedName) && (
                  <div className="ai done row g10" style={{ padding: "10px 12px" }}>
                    <Avatar name={assignedName} size="lg" own />
                    <b className="f1" style={{ fontSize: 13.5 }}>{assignedName}</b>
                    <span className="tg tg-ok"><Check size={12} strokeWidth={2.4} /> Assigned</span>
                  </div>
                )}
                {responders.length === 0 ? (
                  <div className="empty">{incidentPoint ? "No officers with a known position are near this incident." : "Add a position to the incident to rank officers by distance."}</div>
                ) : (
                  responders.map((o, idx) => {
                    const isAssigned = assignedName === o.name;
                    return (
                      <div key={o.id} className={`${isAssigned ? "ai done" : o.fromAi ? "ai" : "card"} col g8`} style={{ padding: "10px 12px" }}>
                        <div className="row g10">
                          <span className="mono t3" style={{ fontSize: 12 }}>#{idx + 1}</span>
                          <Avatar name={o.name} size="lg" own />
                          <div className="f1 col">
                            <div className="row g8 wrap">
                              <b style={{ fontSize: 13.5 }}>{o.name}</b>
                              {isAssigned ? <span className="tg tg-ok"><Check size={12} strokeWidth={2.4} /> Assigned</span> : o.fromAi ? <span className="tg tg-ai"><Sparkles size={12} strokeWidth={1.75} /> Proposed</span> : null}
                            </div>
                            <div className="row g12 wrap t2" style={{ fontSize: 12 }}>
                              {o.zone && <span className="row g4"><MapPin size={12} strokeWidth={1.75} /> {o.zone}</span>}
                              {o.distance != null && <span>{o.distance >= 1000 ? `${(o.distance / 1000).toFixed(1)} km` : `${Math.round(o.distance)} m`} {o.byRoad ? "by road" : "away"}</span>}
                            </div>
                          </div>
                          {o.eta && (
                            <div className="col" style={{ alignItems: "flex-end" }}>
                              <span className="t3" style={{ fontSize: 11 }}>ETA</span>
                              <span className="mono" style={{ fontSize: 16, fontWeight: 600 }}>{o.eta}</span>
                            </div>
                          )}
                        </div>
                        {(o.instructions || o.route) && <div className="t2" style={{ fontSize: 12.5, paddingLeft: 66 }}>{[o.instructions, o.route && `Route: ${o.route}`].filter(Boolean).join(" ")}</div>}
                        {!readOnly && (
                          <div className="row g6 wrap" style={{ paddingLeft: 66 }}>
                            {o.equipment.map((e) => <span key={e} className="tg">{e}</span>)}
                            <span className="flex-auto" />
                            <button type="button" className="b b-sm b-sec" onClick={() => runDispatchAction("dispatch_ping", o, `Pinged ${o.name} for incident ${inc.code}`)}><BellRing size={13} strokeWidth={1.75} /> Ping</button>
                            <button type="button" className="b b-sm b-sec" onClick={() => runDispatchAction("dispatch_route", o, `Sent route instructions to ${o.name} for incident ${inc.code}`)}><Navigation size={13} strokeWidth={1.75} /> Send route</button>
                            {!isAssigned && <button type="button" className="b b-sm b-pri" onClick={() => void assignTo(o.id)}><UserCheck size={13} strokeWidth={1.75} /> Assign</button>}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
                {payloadVehicles.length > 0 && (
                  <div className="col g6">
                    <span className="eyebrow">Vehicles in the AI plan</span>
                    {payloadVehicles.map((v, idx) => (
                      <div key={firstString(v.id, v.vehicle_id) || idx} className="ai row g10 wrap" style={{ padding: "8px 12px" }}>
                        <b className="f1">{firstString(v.code, v.vehicle_code, v.name) || `Vehicle ${idx + 1}`}</b>
                        {firstString(v.driver, v.assigned_to) && <span className="t2">{firstString(v.driver, v.assigned_to)}</span>}
                        {percentOrNull(v.fuel ?? v.fuel_level) != null && <span className="tg">Fuel {percentOrNull(v.fuel ?? v.fuel_level)}%</span>}
                        {firstString(v.eta, v.eta_display) && <span className="tg">ETA {firstString(v.eta, v.eta_display)}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {!readOnly && responders.length > 0 && responders[0].fromAi && (
                  <div className="col g8" style={{ borderTop: "1px solid var(--line-1)", paddingTop: 10 }}>
                    <span className="t3" style={{ fontSize: 12 }}>Your decision on this recommendation is logged permanently against the incident.</span>
                    <div className="row g8 wrap">
                      <button type="button" className="b b-sm b-pri" disabled={recordingDecision} onClick={() => recordOperatorDecision("accepted")}><Check size={13} strokeWidth={1.75} /> Accept as is</button>
                      <button type="button" className="b b-sm b-sec" disabled={recordingDecision} onClick={() => setEditingDecision((c) => !c)}><ClipboardList size={13} strokeWidth={1.75} /> Log a change</button>
                    </div>
                    {editingDecision && (
                      <div className="col g8">
                        <textarea className="in" rows={3} value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} placeholder="What are you changing from the AI’s recommendation, and why?" />
                        <button type="button" className="b b-sm b-pri self-start" disabled={recordingDecision || !decisionNote.trim()} onClick={() => recordOperatorDecision("edited", decisionNote.trim())}><Send size={13} strokeWidth={1.75} /> Save decision</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>

            <section className="pn">
              <div className="pn-h"><ShieldCheck size={15} strokeWidth={1.75} className="ic" /><h3>Site actions</h3><span className="meta">From the AI plan · every decision is logged</span></div>
              <div className="pn-b col g8">
                {siteActions.length === 0 && (
                  <div className="empty">
                    No site actions proposed for this incident. Connected devices are managed in <Link to="/app/devices" className="lnk">Devices</Link>.
                  </div>
                )}
                {siteActions.map((a) => {
                  const state = a.last?.meta?.state as string | undefined;
                  if (a.blocked) {
                    return (
                      <div key={a.id} className="card row g10" style={{ padding: "10px 12px", borderColor: "#4A2427", background: "#160E10" }}>
                        <span className="tg tg-fail" style={{ fontWeight: 600 }}>BLOCKED</span>
                        <span className="f1 col">
                          <b style={{ fontSize: 13, textDecoration: "line-through", color: "var(--tx-2)" }}>{a.label}</b>
                          {a.detail && <span style={{ fontSize: 12, color: "#FF9A9B" }}>{a.detail}</span>}
                        </span>
                      </div>
                    );
                  }
                  if (a.auto) {
                    return (
                      <div key={a.id} className="card row g10" style={{ padding: "10px 12px" }}>
                        <span className="tg tg-warn" style={{ fontWeight: 600 }}>AUTO</span>
                        <span className="f1 col">
                          <b style={{ fontSize: 13 }}>{a.label}</b>
                          <span className="t3" style={{ fontSize: 12 }}>{state === "reverted" ? `Reverted ${timeAgo(a.last.created_at)}` : a.last ? `${state ?? "Recorded"} · ${timeAgo(a.last.created_at)}` : "Automatic in the plan · no execution recorded yet"}</span>
                        </span>
                        {!readOnly && state !== "reverted" && <button type="button" className="b b-sm b-gh" onClick={() => decideSiteAction(a, "reverted")}><RotateCcw size={13} strokeWidth={1.75} /> Revert</button>}
                      </div>
                    );
                  }
                  const decided = state === "approved" || state === "denied";
                  return (
                    <div key={a.id} className={`ai${decided ? " done" : ""} row g10`} style={{ padding: "10px 12px" }}>
                      <span className={`tg ${decided ? (state === "approved" ? "tg-ok" : "tg-fail") : "tg-ai"}`} style={{ fontWeight: 600 }}>{decided ? state.toUpperCase() : "APPROVAL"}</span>
                      <span className="f1 col">
                        <b style={{ fontSize: 13 }}>{a.label}</b>
                        {a.detail && <span className="t2" style={{ fontSize: 12 }}>{a.detail}</span>}
                        <span className="t3" style={{ fontSize: 11.5, marginTop: 2 }}>
                          {decided ? `${a.last.actor_name ?? "Someone"} · ${fmtTime(a.last.created_at)}` : [a.risk && `Risk ${a.risk.toLowerCase()}`, a.approval].filter(Boolean).join(" · ") || "Needs a person to decide"}
                        </span>
                      </span>
                      {a.confidence != null && !decided && <Confidence value={a.confidence} />}
                      {!readOnly && !decided && (
                        <>
                          <button type="button" className="b b-sm b-gh" onClick={() => decideSiteAction(a, "denied")}>Deny</button>
                          <button type="button" className="b b-sm b-pri" onClick={() => decideSiteAction(a, "approved")}><Check size={13} strokeWidth={1.75} /> Approve</button>
                        </>
                      )}
                    </div>
                  );
                })}
                {open && <IncidentProposals incident={inc} orgId={appAccess.orgId} readOnly={readOnly} actor={appAccess.displayName || appAccess.email || "You"} />}
              </div>
            </section>

            {!readOnly && (
              <section className="pn">
                <div className="pn-h"><ArrowUpRight size={15} strokeWidth={1.75} className="ic" /><h3>Escalate</h3><span className="meta">Calls from your phone; each one is logged here</span></div>
                <div className="pn-b">
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(220px,100%),1fr))", gap: 8 }}>
                    <a href="tel:199" className="b b-lg b-red" onClick={() => void quickEscalate("police", "Nigeria Police", "199")}><PhoneCall size={16} strokeWidth={1.75} /> Nigeria Police · 199</a>
                    <a href="tel:767" className="b b-lg b-sec" onClick={() => void quickEscalate("lasema", "LASAMBUS / LASEMA", "767")}><Siren size={16} strokeWidth={1.75} /> LASAMBUS · 767</a>
                    <button type="button" className="b b-lg b-sec" onClick={() => setTab("escalations")}><Shield size={16} strokeWidth={1.75} /> Other contact…</button>
                  </div>
                </div>
              </section>
            )}
          </div>

          <div className="col g12" style={{ flex: "1 1 300px", minWidth: 0, maxWidth: "100%" }}>
            <TimelinePanel activity={activityRows} limit={12} onMore={() => setTab("timeline")} />
            <NotesPanel notes={data.notes as any[]} onAdd={(body, cv) => addNote({ data: { incident_id: id, body, client_visible: cv } }).then(invalidate)} />
          </div>
        </div>
      )}

      {tab === "overview" && (
        <div className="flex flex-wrap items-start" style={{ gap: 12 }}>
          <div className="col g12" style={{ flex: "2 1 480px", minWidth: 0 }}>
            <section className="pn">
              <div className="pn-h"><FileText size={15} strokeWidth={1.75} className="ic" /><h3>What happened</h3></div>
              <div className="pn-b"><p className="whitespace-pre-wrap" style={{ fontSize: 13.5, lineHeight: 1.6 }}>{inc.description || <span className="t3">No description entered.</span>}</p></div>
            </section>
            <section className="pn">
              <div className="pn-h"><Info size={15} strokeWidth={1.75} className="ic" /><h3>Details</h3></div>
              <div className="pn-b">
                <dl className="kv" style={{ margin: 0 }}>
                  <dt>Type</dt><dd>{typeMeta[inc.type as IncidentType]}</dd>
                  <dt>Severity</dt><dd><Sev level={inc.severity} label /> <span className="t3">{severityMeta[inc.severity as Severity]?.sublabel}</span></dd>
                  <dt>Location</dt><dd>{[inc.location, inc.zone, inc.floor].filter(Boolean).join(" · ")}</dd>
                  <dt>Position</dt><dd className="mono">{incidentPoint ? `${incidentPoint[1].toFixed(5)}, ${incidentPoint[0].toFixed(5)}` : "Not recorded"}</dd>
                  <dt>Reported</dt><dd>{fmt(inc.reported_at)} · {reporterLabel}</dd>
                  <dt>First acknowledged</dt><dd>{statusTimes.get("acknowledged") ? `${duration(inc.reported_at, statusTimes.get("acknowledged"))} after reporting` : "Not yet"}</dd>
                  <dt>Suspects</dt><dd>{[inc.suspect_count, inc.suspect_description].filter(Boolean).join(" · ") || "—"}</dd>
                  <dt>Victim</dt><dd>{[inc.victim_name, inc.victim_contact].filter(Boolean).join(" · ") || "—"}</dd>
                  <dt>Witnesses</dt><dd>{inc.witnesses || "—"}</dd>
                </dl>
              </div>
            </section>
          </div>
          <div className="col g12" style={{ flex: "1 1 320px", minWidth: 0 }}>
            <NotesPanel notes={data.notes as any[]} onAdd={(body, cv) => addNote({ data: { incident_id: id, body, client_visible: cv } }).then(invalidate)} />
          </div>
        </div>
      )}

      {tab === "evidence" && (
        <EvidencePanel
          organisationId={inc.organisation_id}
          evidence={evidenceItems}
          readOnly={readOnly}
          onAdd={(items) => addEvidence({ data: { incident_id: id, items } }).then(invalidate)}
          onToggleLegal={(path, legal) => patchEvidence({ data: { incident_id: id, path, legal, note: legal ? "Marked for chain of custody" : "Legal flag cleared" } }).then(invalidate)}
        />
      )}

      {tab === "timeline" && <TimelinePanel activity={activityRows} />}

      {tab === "escalations" && (
        <EscalationPanel
          escalations={escalationRows}
          incident={inc}
          readOnly={readOnly}
          onEscalate={(t, name, phone, message) => escalate({ data: { incident_id: id, target: t, contact_name: name, contact_phone: phone, message } }).then(invalidate)}
          onAck={(eid) => ackEsc({ data: { id: eid } }).then(invalidate)}
        />
      )}

      {tab === "related" && <LinkedPanel linked={linkedIncidents} suggested={suggestedRows} readOnly={readOnly} onLink={(lid) => linkInc({ data: { incident_id: id, linked_incident_id: lid } }).then(invalidate)} />}

      {pendingStatus && (
        <StatusDialog
          from={inc.status}
          to={pendingStatus}
          onClose={() => setPendingStatus(null)}
          onConfirm={(note) =>
            transition({ data: { id, status: pendingStatus, note } }).then(() => {
              publishRealtimeEvent(orgRoom(appAccess.orgId), "incident:updated", { incident_id: id, incident_code: inc.code, status: pendingStatus, note });
              setPendingStatus(null);
              return invalidate();
            })
          }
        />
      )}
    </div>
  );
}

function EvidenceThumb({ ev }: { ev: any }) {
  if (ev.kind === "image" && ev.url) {
    return (
      <a href={ev.url} target="_blank" rel="noreferrer" className="card overflow-hidden" style={{ height: 84, position: "relative" }}>
        <img src={ev.url} alt={ev.name} className="h-full w-full object-cover" />
      </a>
    );
  }
  const Icon = ev.kind === "audio" ? Mic : ev.kind === "video" ? VideoIcon : FileText;
  return (
    <a href={ev.url ?? undefined} target="_blank" rel="noreferrer" className="card col g6" style={{ height: 84, padding: 10, justifyContent: "center" }}>
      <span className="row g6" style={{ fontSize: 12, fontWeight: 600 }}><Icon size={14} strokeWidth={1.75} /> <span className="trunc">{ev.name}</span></span>
      <span className="mono t3" style={{ fontSize: 11 }}>{ev.kind}{ev.size ? ` · ${Math.round(ev.size / 1024)} KB` : ""}</span>
    </a>
  );
}

function StatusDialog({ from, to, onClose, onConfirm }: { from: IncidentStatus; to: IncidentStatus; onClose: () => void; onConfirm: (note: string) => Promise<unknown> }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center px-4" style={{ background: "rgba(5,7,10,.72)" }} role="dialog" aria-modal="true" aria-label="Change status">
      <div className="pn w-full" style={{ maxWidth: 440, borderColor: "var(--line-2)" }}>
        <div className="pn-h">
          <div className="col">
            <span className="eyebrow">Change status</span>
            <h3 style={{ fontSize: 15 }}>{statusMeta[from]} → {statusMeta[to]}</h3>
          </div>
          <button type="button" onClick={onClose} className="ibtn ml-auto" style={{ width: 28, height: 28 }} aria-label="Close"><X size={14} strokeWidth={1.75} /></button>
        </div>
        <div className="pn-b col g12">
          <label className="fl">
            <span className="lbl">Note (required, kept in the audit trail)</span>
            <textarea autoFocus rows={3} value={note} onChange={(e) => setNote(e.target.value)} className="in" />
          </label>
          {err && <Notice tone="fail">{err}</Notice>}
          <div className="row g8 justify-end">
            <button type="button" onClick={onClose} className="b b-gh">Cancel</button>
            <button
              type="button"
              className="b b-pri"
              disabled={busy || !note.trim()}
              onClick={async () => {
                setBusy(true);
                setErr(null);
                try {
                  await onConfirm(note.trim());
                } catch (e) {
                  setErr((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Confirm
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function dotColor(kind: string) {
  if (kind === "ai_recommendation" || kind === "autonomous_action") return "var(--ai)";
  if (kind === "status_changed") return "var(--ok)";
  if (kind === "escalation") return "var(--s5)";
  if (kind === "dispatch_ping" || kind === "dispatch_route" || kind === "assigned" || kind === "operator_decision") return "var(--blue-hi)";
  if (kind === "override_action") return "var(--warn)";
  return "var(--tx-3)";
}

function TimelinePanel({ activity, limit, onMore }: { activity: any[]; limit?: number; onMore?: () => void }) {
  const rows = limit ? activity.slice(0, limit) : activity;
  return (
    <section className="pn">
      <div className="pn-h">
        <History size={15} strokeWidth={1.75} className="ic" />
        <h3>Live timeline</h3>
        <span className="meta">Append-only</span>
        <span className="flex-auto" />
        <span className="row g6 t3" style={{ fontSize: 11.5 }}><span className="pulse" /> live</span>
      </div>
      {activity.length === 0 ? (
        <div className="empty" style={{ padding: 12 }}>No activity yet.</div>
      ) : (
        <ol className="list" style={{ listStyle: "none", margin: 0, padding: "0 12px" }}>
          {rows.map((a) => (
            <li key={a.id} className="row g10" style={{ alignItems: "flex-start", padding: "8px 0" }}>
              <span className="mono t3" style={{ fontSize: 11, width: 56, flex: "none", paddingTop: 1 }}>{fmtTime(a.created_at)}</span>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor(a.kind), marginTop: 5, flex: "none" }} />
              <span className="f1" style={{ fontSize: 12.5 }}>
                <b style={{ fontWeight: 600 }}>{a.actor_name || "System"}</b> <span className="t2">{a.message}</span>
                {limit === undefined && <div className="t3" style={{ fontSize: 12, marginTop: 2 }}>{fmt(a.created_at)}</div>}
              </span>
            </li>
          ))}
        </ol>
      )}
      {onMore && activity.length > rows.length && (
        <button type="button" className="b b-sm b-gh m-2 self-start" onClick={onMore}>All {activity.length} entries</button>
      )}
    </section>
  );
}

function NotesPanel({ notes, onAdd }: { notes: any[]; onAdd: (body: string, cv: boolean) => Promise<unknown> }) {
  const [body, setBody] = useState("");
  const [cv, setCv] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await onAdd(body.trim(), cv);
      setBody("");
      setCv(false);
    } catch (err) {
      toast.error("Couldn’t post the note", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="pn">
      <div className="pn-h"><MessageSquare size={15} strokeWidth={1.75} className="ic" /><h3>Notes</h3><span className="meta">{notes.length}</span></div>
      <div className="pn-b col g8">
        <div className="col g8 overflow-y-auto" style={{ maxHeight: 360 }}>
          {notes.length === 0 && <div className="empty">No notes yet.</div>}
          {notes.map((n) => (
            <div key={n.id} className="row g8" style={{ alignItems: "flex-start" }}>
              <Avatar name={n.author_name || "Operator"} />
              <div className="f1">
                <div style={{ fontSize: 12.5 }}>
                  <b>{n.author_name || "Operator"}</b> <span className="mono t3" style={{ fontSize: 11 }}>{timeAgo(n.created_at)}</span>
                  {n.client_visible && <span className="tg tg-blue ml-2">Client can see</span>}
                </div>
                <div className="t2 whitespace-pre-wrap" style={{ fontSize: 12.5 }}>{n.body}</div>
              </div>
            </div>
          ))}
        </div>
        <label className="in" style={{ height: "auto", alignItems: "flex-end", paddingTop: 6, paddingBottom: 6 }}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
            }}
            rows={2}
            maxLength={2000}
            placeholder="Add a note"
            aria-label="New note"
            className="f1 bg-transparent outline-none resize-none"
          />
          <button type="button" className="ibtn" style={{ width: 30, height: 30 }} disabled={busy || !body.trim()} onClick={() => void submit()} aria-label="Post note">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send size={14} strokeWidth={1.75} />}
          </button>
        </label>
        <label className="row g8 t2" style={{ fontSize: 12 }}>
          <input type="checkbox" checked={cv} onChange={(e) => setCv(e.target.checked)} /> Visible to the client admin
        </label>
      </div>
    </section>
  );
}

function EvidencePanel({
  organisationId,
  evidence,
  readOnly,
  onAdd,
  onToggleLegal,
}: {
  organisationId: string;
  evidence: any[];
  readOnly: boolean;
  onAdd: (items: { path: string; kind: any; size: number; name: string }[]) => Promise<unknown>;
  onToggleLegal: (path: string, legal: boolean) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = async (file: File) => {
    setBusy(true);
    const ext = file.name.split(".").pop() || "bin";
    const path = `${organisationId}/added/${crypto.randomUUID()}.${ext}`;
    const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : "document";
    const { error } = await supabase.storage.from("incident-evidence").upload(path, file, { contentType: file.type });
    if (error) toast.error("Upload failed", { description: error.message });
    else await onAdd([{ path, kind, size: file.size, name: file.name }]);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };
  return (
    <section className="pn">
      <div className="pn-h">
        <Paperclip size={15} strokeWidth={1.75} className="ic" />
        <h3>Evidence</h3>
        <span className="meta">{evidence.length} file(s) · {evidence.filter((e) => e.legal).length} flagged as legal evidence</span>
        <span className="flex-auto" />
        {!readOnly && (
          <button type="button" className="b b-sm b-sec" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus size={13} strokeWidth={1.75} />} Add evidence
          </button>
        )}
        <input ref={fileRef} type="file" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </div>
      <div className="pn-b">
        {evidence.length === 0 ? (
          <div className="empty">No evidence attached.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(300px,100%),1fr))", gap: 12 }}>
            {evidence.map((ev: any) => {
              const custody = Array.isArray(ev.chain_of_custody) ? ev.chain_of_custody : [{ at: ev.added_at, actor_name: ev.added_by_name, action: "added" }];
              return (
                <div key={ev.path} className="card overflow-hidden col">
                  {ev.kind === "image" && ev.url ? (
                    <img src={ev.url} alt={ev.name} className="w-full object-cover" style={{ height: 170 }} />
                  ) : ev.kind === "video" && ev.url ? (
                    <video src={ev.url} controls className="w-full bg-black" style={{ height: 170 }} />
                  ) : ev.kind === "audio" && ev.url ? (
                    <div className="p-3"><audio src={ev.url} controls className="w-full" /></div>
                  ) : null}
                  <div className="col g8" style={{ padding: 12 }}>
                    <div className="row g8">
                      <b className="f1 trunc">{ev.name}</b>
                      {ev.legal ? <span className="tg tg-fail">Legal evidence</span> : <span className="tg">Standard</span>}
                    </div>
                    <span className="mono t3" style={{ fontSize: 11 }}>{ev.kind}{ev.size ? ` · ${Math.round(ev.size / 1024)} KB` : ""} · {ev.added_by_name || "System"}{ev.added_at ? ` · ${fmt(ev.added_at)}` : ""}</span>
                    <div className="col g4">
                      <span className="eyebrow">Chain of custody</span>
                      {custody.map((c: any, i: number) => (
                        <span key={i} className="row g8 t2" style={{ fontSize: 12 }}>
                          <span className="f1 trunc capitalize">{c.action} · {c.actor_name || "System"}</span>
                          <span className="mono t3" style={{ fontSize: 11 }}>{c.at ? timeAgo(c.at) : "—"}</span>
                        </span>
                      ))}
                    </div>
                    <div className="row g8 wrap">
                      {ev.url && <a href={ev.url} target="_blank" rel="noreferrer" className="b b-sm b-sec"><Download size={13} strokeWidth={1.75} /> Download</a>}
                      {!readOnly && (
                        <button type="button" className="b b-sm b-gh" onClick={() => void onToggleLegal(ev.path, !ev.legal)}>
                          <Shield size={13} strokeWidth={1.75} /> {ev.legal ? "Clear legal flag" : "Flag as legal evidence"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function EscalationPanel({
  escalations,
  incident,
  readOnly,
  onEscalate,
  onAck,
}: {
  escalations: any[];
  incident: any;
  readOnly: boolean;
  onEscalate: (target: any, name: string, phone: string, message: string) => Promise<unknown>;
  onAck: (id: string) => Promise<unknown>;
}) {
  const draft = useMemo(
    () =>
      `URGENT — ${typeMeta[incident.type as IncidentType]} (Severity ${incident.severity})\nLocation: ${incident.location}, ${incident.zone}\nTime: ${fmt(incident.reported_at)}\nOfficer on scene: ${incident.officer || "Unassigned"}\nDetails: ${incident.description || "—"}\nRef: ${incident.code}`,
    [incident],
  );
  const [target, setTarget] = useState<(typeof ESCALATION_TARGETS)[number]["key"]>("police");
  const [customName, setCustomName] = useState("");
  const [customPhone, setCustomPhone] = useState("");
  const [message, setMessage] = useState(draft);
  const [busy, setBusy] = useState(false);
  const acked = escalations.filter((e) => e.acknowledged && e.acknowledged_at);
  const avgAck = acked.length ? Math.round(acked.reduce((acc, e) => acc + (new Date(e.acknowledged_at).getTime() - new Date(e.created_at).getTime()), 0) / acked.length / 60000) : null;
  return (
    <div className="flex flex-wrap items-start" style={{ gap: 12 }}>
      {!readOnly && (
        <section className="pn" style={{ flex: "1 1 380px", minWidth: 0 }}>
          <div className="pn-h"><ArrowUpRight size={15} strokeWidth={1.75} className="ic" /><h3>New escalation</h3></div>
          <div className="pn-b col g12">
            <div className="seg" role="group" aria-label="Contact">
              {ESCALATION_TARGETS.map((t) => (
                <button key={t.key} type="button" className={target === t.key ? "on" : undefined} aria-pressed={target === t.key} onClick={() => setTarget(t.key)}>{t.label}</button>
              ))}
            </div>
            {target === "custom" && (
              <div className="row g8">
                <input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="Contact name" className="in" aria-label="Contact name" />
                <input value={customPhone} onChange={(e) => setCustomPhone(e.target.value)} placeholder="Phone" className="in" aria-label="Phone" />
              </div>
            )}
            <label className="fl">
              <span className="lbl">Message</span>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={7} className="in mono" style={{ fontSize: 12 }} />
            </label>
            <div className="row g8">
              <span className="t3 f1" style={{ fontSize: 12 }}>Logs the escalation on this incident. Call or message the contact yourself.</span>
              <button
                type="button"
                className="b b-red"
                disabled={busy || !message.trim()}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const t = ESCALATION_TARGETS.find((x) => x.key === target)!;
                    await onEscalate(target, target === "custom" ? customName : t.label, target === "custom" ? customPhone : t.phone, message.trim());
                    toast.success("Escalation logged");
                    setMessage(draft);
                  } catch (err) {
                    toast.error("Couldn’t log the escalation", { description: err instanceof Error ? err.message : undefined });
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Log escalation
              </button>
            </div>
          </div>
        </section>
      )}
      <section className="pn" style={{ flex: "1 1 380px", minWidth: 0 }}>
        <div className="pn-h"><History size={15} strokeWidth={1.75} className="ic" /><h3>History</h3><span className="meta">{escalations.length} · {acked.length} acknowledged{avgAck != null ? ` · avg ${avgAck}m to acknowledge` : ""}</span></div>
        {escalations.length === 0 ? (
          <div className="empty" style={{ padding: 12 }}>No escalations yet.</div>
        ) : (
          <div className="list">
            {escalations.map((e) => (
              <div key={e.id} className="row g10 wrap" style={{ padding: "10px 12px" }}>
                <div className="f1 col">
                  <b style={{ fontSize: 13 }} className="capitalize">{e.contact_name || e.target}</b>
                  <span className="t3 row g6" style={{ fontSize: 12 }}>{e.contact_phone && (<><Phone size={12} strokeWidth={1.75} /> {e.contact_phone} ·</>)} {timeAgo(e.created_at)}</span>
                </div>
                {e.acknowledged ? <span className="tg tg-ok">Acknowledged</span> : <span className="tg tg-warn">Waiting</span>}
                {!e.acknowledged && !readOnly && <button type="button" className="b b-sm b-gh" onClick={() => void onAck(e.id)}>Mark acknowledged</button>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function LinkedPanel({ linked, suggested, readOnly, onLink }: { linked: any[]; suggested: any[]; readOnly: boolean; onLink: (id: string) => Promise<unknown> }) {
  const row = (l: any, action?: ReactNode) => (
    <div key={l.id} className="row g10" style={{ padding: "10px 12px" }}>
      <Sev level={l.severity} />
      <Link to="/app/incidents/$id" params={{ id: l.id }} className="f1 col min-w-0 hover:text-tx-1">
        <span className="trunc" style={{ fontWeight: 600 }}>{l.title || typeMeta[l.type as IncidentType]}</span>
        <span className="mono t3" style={{ fontSize: 11.5 }}>{l.code} · {l.location} · {timeAgo(l.reported_at)}</span>
      </Link>
      {action}
    </div>
  );
  return (
    <div className="flex flex-wrap items-start" style={{ gap: 12 }}>
      <section className="pn" style={{ flex: "1 1 380px", minWidth: 0 }}>
        <div className="pn-h"><LinkIcon size={15} strokeWidth={1.75} className="ic" /><h3>Linked incidents</h3><span className="meta">{linked.length}</span></div>
        {linked.length === 0 ? <div className="empty" style={{ padding: 12 }}>Nothing linked yet.</div> : <div className="list">{linked.map((l) => row(l))}</div>}
      </section>
      <section className="pn" style={{ flex: "1 1 380px", minWidth: 0 }}>
        <div className="pn-h"><Siren size={15} strokeWidth={1.75} className="ic" /><h3>Same zone, within 24 hours</h3><span className="meta">{suggested.length}</span></div>
        {suggested.length === 0 ? (
          <div className="empty" style={{ padding: 12 }}>No other incidents in this zone around that time.</div>
        ) : (
          <div className="list">{suggested.map((s) => row(s, !readOnly && <button type="button" className="b b-sm b-sec" onClick={() => void onLink(s.id)}><LinkIcon size={13} strokeWidth={1.75} /> Link</button>))}</div>
        )}
      </section>
    </div>
  );
}
