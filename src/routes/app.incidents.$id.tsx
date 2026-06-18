import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
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
import { listMembers, listLocations } from "@/lib/orgs.functions";
import { listPatrols } from "@/lib/patrols.functions";
import { createDispatchAlert } from "@/lib/alerts.functions";
import {
  severityMeta,
  statusMeta,
  typeMeta,
  type Severity,
  type IncidentStatus,
  type IncidentType,
} from "@/lib/mockData";
import { SeverityBadge } from "@/components/SeverityBadge";
import { useRealtimeInvalidate } from "@/lib/useRealtime";
import { resolveAppAccess, requireSectionAccess } from "@/lib/rbac";
import {
  ArrowLeft,
  BrainCircuit,
  ChevronRight,
  CircleCheckBig,
  CircleX,
  Lightbulb,
  Loader2,
  Send,
  Paperclip,
  Phone,
  ShieldAlert,
  Link as LinkIcon,
  Clock,
  User,
  Image as ImageIcon,
  FileText,
  Video as VideoIcon,
  Mic,
  CheckCircle2,
  MessageSquare,
  AlertOctagon,
  MapPinned,
  Radio,
  ShieldCheck,
  Siren,
  Sparkles,
  Truck,
  Users,
  Layers3,
  ClipboardList,
  ImageUp,
  LayoutPanelTop,
  Map as MapIcon,
  Shield,
  FolderOpen,
} from "lucide-react";

type IncidentTab = "overview" | "analysis" | "activity" | "evidence" | "escalation" | "related";

export const Route = createFileRoute("/app/incidents/$id")({
  head: () => ({ meta: [{ title: "Incident · Lemtik SOD" }] }),
  beforeLoad: async ({ params }) => {
    const access = await resolveAppAccess(supabase);
    if (access.specRole === "field_officer") {
      const [{ data: incident }, { data: profile }] = await Promise.all([
        supabase
          .from("incidents")
          .select("id, reported_by, officer")
          .eq("id", params.id)
          .maybeSingle(),
        supabase.from("profiles").select("display_name").eq("user_id", access.userId).maybeSingle(),
      ]);
      const reporterOwned = incident?.reported_by === access.userId;
      const officerOwned = !!profile?.display_name && incident?.officer === profile.display_name;
      if (!reporterOwned && !officerOwned) {
        throw redirect({ to: "/officer/home" });
      }
      return { appAccess: access };
    }
    requireSectionAccess(access, ["security_manager", "operator", "client_admin"]);
    return { appAccess: access };
  },
  component: IncidentDetailPage,
});

const STATUS_FLOW: IncidentStatus[] = [
  "reported",
  "acknowledged",
  "responding",
  "contained",
  "resolved",
];
const ESCALATION_TARGETS = [
  { key: "police", label: "Nigeria Police", phone: "112" },
  { key: "lasema", label: "LASEMA", phone: "767" },
  { key: "nscdc", label: "NSCDC", phone: "08032003557" },
  { key: "custom", label: "Custom contact", phone: "" },
] as const;

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}
function fmtPrecise(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "medium" });
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

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function humanList(values: string[]) {
  const filtered = values.filter(Boolean);
  if (!filtered.length) return "";
  if (filtered.length === 1) return filtered[0];
  if (filtered.length === 2) return `${filtered[0]} and ${filtered[1]}`;
  return `${filtered.slice(0, -1).join(", ")}, and ${filtered[filtered.length - 1]}`;
}

function isMedicalIncident(incident: any) {
  const blob = `${incident.title ?? ""} ${incident.description ?? ""} ${incident.type ?? ""}`.toLowerCase();
  return /medical|injur|bleed|unconscious|collapse|heart|stab|shoot|gunshot|overdose/.test(blob);
}

function isArmedIncident(incident: any) {
  const blob = `${incident.title ?? ""} ${incident.description ?? ""} ${incident.type ?? ""}`.toLowerCase();
  return /armed|weapon|gun|knife|firearm|machete|hostage|gunshot/.test(blob);
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
  const [activeTab, setActiveTab] = useState<IncidentTab>("overview");
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
  const fetchPatrols = useServerFn(listPatrols);

  useRealtimeInvalidate("incidents", [["incident", id]]);
  useRealtimeInvalidate("incident_activity", [["incident", id]]);
  useRealtimeInvalidate("incident_notes", [["incident", id]]);
  useRealtimeInvalidate("incident_escalations", [["incident", id]]);
  useRealtimeInvalidate("organisation_locations", [["locations"], ["incident", id]]);
  useRealtimeInvalidate("profiles", [["members"]]);
  useRealtimeInvalidate("patrols", [["patrols"]]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["incident", id],
    queryFn: () => get({ data: { id } }),
  });
  const { data: members = [] } = useQuery({ queryKey: ["members"], queryFn: () => fetchMembers() });
  const { data: locations = [] } = useQuery({
    queryKey: ["locations"],
    queryFn: () => fetchLocations(),
  });
  const { data: patrols = [] } = useQuery({
    queryKey: ["patrols"],
    queryFn: () => fetchPatrols(),
  });
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

  useEffect(() => {
    const pending = typeof window !== "undefined" ? sessionStorage.getItem("lemtik-open-incident-tab") : null;
    if (pending !== id) return;
    setActiveTab("analysis");
    sessionStorage.removeItem("lemtik-open-incident-tab");
  }, [id]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["incident", id] });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading incident…
      </div>
    );
  }
  if (error || !data) {
    return <div className="text-sm text-critical">Failed to load incident.</div>;
  }

  const inc = data.incident as any;
  const evidenceItems = Array.isArray(inc.evidence) ? inc.evidence : [];
  const reportedAt = inc.reported_at;
  const firstResponse = (data.activity as any[]).find(
    (a) => a.kind === "status_changed" && a.meta?.to === "acknowledged",
  );
  const incidentPoint: [number, number] = (() => {
    if (inc.coord_x != null && inc.coord_y != null)
      return [Number(inc.coord_x), Number(inc.coord_y)];
    const direct = locations.find(
      (loc: any) => loc.id === inc.location_id && loc.coord_x != null && loc.coord_y != null,
    );
    if (direct) return [Number(direct.coord_x), Number(direct.coord_y)];
    const sameZone = locations.find(
      (loc: any) =>
        loc.name?.toLowerCase() === String(inc.zone ?? "").toLowerCase() &&
        loc.coord_x != null &&
        loc.coord_y != null,
    );
    if (sameZone) return [Number(sameZone.coord_x), Number(sameZone.coord_y)];
    return [3.4219, 6.4281];
  })();

  const proximity = (() => {
    const candidates = members.map((m: any) => {
      const assigned = pointFromLocationLocations(locations, m.profile?.assigned_location_ids);
      const zoneMatch = locations.find(
        (loc: any) =>
          loc.name?.toLowerCase() === String(m.profile?.zone ?? "").toLowerCase() &&
          loc.coord_x != null &&
          loc.coord_y != null,
      );
      const base =
        assigned ??
        (zoneMatch
          ? ([Number(zoneMatch.coord_x), Number(zoneMatch.coord_y)] as [number, number])
          : null);
      const fallback =
        base ??
        ([
          incidentPoint[0] +
            hashToOffset(`${m.user_id}:${m.profile?.display_name ?? m.user_id}`)[0],
          incidentPoint[1] +
            hashToOffset(`${m.user_id}:${m.profile?.display_name ?? m.user_id}`)[1],
        ] as [number, number]);
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

  const activityRows = data.activity as any[];
  const escalationRows = data.escalations as any[];
  const linkedIncidents = data.linkedIncidents as any[];
  const suggestedRows = data.suggested as any[];
  const patrolRows = patrols as any[];
  const responseAgeMinutes = Math.max(1, Math.round((Date.now() - new Date(reportedAt).getTime()) / 60000));
  const severityScore = Number(inc.severity) || 1;
  const osintCount = suggestedRows.length;
  const reporterLabel = reporterProfile?.display_name || (reportedBy ? "Front Desk" : "System");
  const armed = isArmedIncident(inc);
  const medical = isMedicalIncident(inc);
  const responsePenalty = firstResponse ? 0 : 6;
  const confidence = clamp(
    Math.round(70 + severityScore * 4 + osintCount * 3 + Math.min(8, proximity.length * 2) - responsePenalty),
    78,
    97,
  );
  const threatLevel =
    severityScore >= 5 || armed
      ? "Critical"
      : severityScore >= 4 || escalationRows.length > 0
        ? "High"
        : severityScore >= 3 || osintCount > 1
          ? "Elevated"
          : "Guarded";
  const suspectStatus = armed ? "Potentially armed" : severityScore >= 4 ? "Unconfirmed suspect" : "Not confirmed";
  const historicalContext = (() => {
    const nearby = suggestedRows.slice(0, 3);
    const labels = nearby.map((item: any) => `${typeMeta[item.type as IncidentType]} · ${since(item.reported_at)}`);
    return {
      zoneScore: clamp(45 + osintCount * 8 + severityScore * 5 + escalationRows.length * 7, 0, 100),
      trend: osintCount >= 3 ? "rising" : osintCount === 2 ? "steady" : "contained",
      summary: nearby.length
        ? `The same zone has ${nearby.length} related signal${nearby.length === 1 ? "" : "s"} in the last 24 hours: ${humanList(labels)}.`
        : `No matching 24-hour zone pattern detected. Recent activity remains incident-specific.`,
    };
  })();

  const recommendedOfficers = proximity.map((officer, idx) => {
    const routeSegments = [
      inc.zone,
      inc.location,
      officer.zone,
      idx === 0 ? "fastest responder path" : "secondary coverage lane",
    ].filter(Boolean);
    const etaMinutes = Math.max(1, Math.round(officer.distance / 95));
    return {
      ...officer,
      eta: `${Math.floor(etaMinutes / 60) ? `${Math.floor(etaMinutes / 60)}h ` : ""}${etaMinutes % 60 || etaMinutes}m`,
      route: humanList(routeSegments),
      equipment: officer.role === "manager" ? ["Radio", "First Aid Kit", "Handcuffs"] : ["Radio", "Torch"],
      instructions:
        idx === 0
          ? "Move first, secure the perimeter, confirm victim safety, and report state changes every 60 seconds."
          : "Stage nearby, preserve an exit lane, and stay available for relief or containment support.",
    };
  });

  const vehicleRecommendations = patrolRows
    .filter((patrol: any) => patrol.status !== "complete")
    .slice(0, 3)
    .map((patrol: any, idx: number) => {
      const fuelLevel = clamp(
        78 - Number(patrol.checked_in ?? 0) * 6 - (patrol.status === "delayed" ? 18 : 0) - idx * 5,
        12,
        100,
      );
      const etaMinutes = clamp(
        Math.round((Number(patrol.waypoints ?? 1) - Number(patrol.checked_in ?? 0)) * 2.5 + idx * 3),
        4,
        38,
      );
      return {
        id: patrol.id,
        code: patrol.code,
        name: patrol.name,
        driver: patrol.officer || "Unassigned",
        fuel: fuelLevel,
        eta: `${etaMinutes}m`,
        capacity: `${Math.max(Number(patrol.waypoints ?? 0), 1)} seats`,
        status: patrol.status,
      };
    });

  const autonomousActions = [
    {
      id: "cctv-nw-wing",
      label: `Activate CCTV ${inc.zone || "coverage"}`,
      kind: "auto",
      detail: `Auto-executing coverage sweep for ${inc.location}.`,
      impact: "Improves visual confirmation and response routing.",
      state: severityScore >= 4 ? "executing" : "queued",
      meta: { zone: inc.zone, location: inc.location },
    },
    {
      id: "elevator-hold",
      label: "Hold Elevator B at Ground Floor",
      kind: "approval",
      detail: "Cuts the likely escape route by holding the nearest vertical corridor.",
      impact: "Saves time and reduces suspect movement options.",
      state: escalationRows.length > 0 ? "pending" : "recommended",
      approval: "Supervisor",
      risk: "Low",
      savings: "~45 seconds",
      meta: { zone: inc.zone, location: inc.location },
    },
  ] as const;

  const activeOverrides = (() => {
    const latestByAction = new Map<string, any>();
    for (const row of activityRows) {
      if (!["autonomous_action", "override_action"].includes(row.kind)) continue;
      const actionId = row.meta?.action_id || row.meta?.id || row.meta?.key || row.message;
      if (!actionId) continue;
      latestByAction.set(String(actionId), row);
    }
    return autonomousActions
      .map((action) => {
        const latest = latestByAction.get(action.id);
        if (latest) {
          return {
            ...action,
            status: latest.meta?.state === "denied" ? "Denied" : latest.meta?.state === "approved" ? "Active" : latest.meta?.state === "executing" ? "Executing" : "Recorded",
            updatedAt: latest.created_at,
            actor: latest.actor_name,
          };
        }
        if (action.kind === "auto") {
          return { ...action, status: "Executing", updatedAt: reportedAt, actor: "Master Agent" };
        }
        return { ...action, status: action.state === "pending" ? "Awaiting approval" : "Recommended", updatedAt: null, actor: null };
      })
      .filter((item) => item.status === "Executing" || item.status === "Active" || item.status === "Awaiting approval");
  })();
  const allRelated = [...linkedIncidents, ...suggestedRows]
    .filter((item: any, idx, arr) => arr.findIndex((candidate: any) => candidate.id === item.id) === idx)
    .filter((item: any) => item.id !== inc.id);
  const mapPoints = [
    { id: inc.id, label: inc.code, lng: Number(inc.coord_x ?? incidentPoint[0]), lat: Number(inc.coord_y ?? incidentPoint[1]), severity: Number(inc.severity) },
    ...allRelated
      .filter((item: any) => item.coord_x != null && item.coord_y != null)
      .map((item: any) => ({
        id: item.id,
        label: item.code,
        lng: Number(item.coord_x),
        lat: Number(item.coord_y),
        severity: Number(item.severity ?? 1),
      })),
  ];

  const autoApproveHandler = async (action: (typeof autonomousActions)[number], approved: boolean) => {
    if (approved) {
      await recordAction({
        data: {
          incident_id: id,
          kind: "autonomous_action",
          message: `${action.label} approved`,
          meta: { action_id: action.id, state: "approved", action: action.label, source: "master-agent" },
        },
      });
    } else {
      await recordAction({
        data: {
          incident_id: id,
          kind: "autonomous_action",
          message: `${action.label} denied`,
          meta: { action_id: action.id, state: "denied", action: action.label, source: "master-agent" },
        },
      });
    }
    await invalidate();
  };

  const runDispatchAction = async (action: string, officer: any, message: string) => {
    await recordAction({
      data: {
        incident_id: id,
        kind: action,
        message,
        meta: { officer_id: officer.id, officer_name: officer.name, distance_m: Math.round(officer.distance) },
      },
    });
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
    await invalidate();
  };

  const incidentTitle = inc.title || typeMeta[inc.type as IncidentType];
  const timeOpen = duration(reportedAt);

  return (
    <div className="space-y-5">
      <button
        onClick={() => navigate({ to: "/app/incidents" })}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to incidents
      </button>

      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="border-b border-border/70 bg-gradient-to-r from-primary/10 via-transparent to-resolved/10 px-5 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                <BrainCircuit className="h-3.5 w-3.5 text-primary" />
                Unified incident detail
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{inc.code}</span>
                <SeverityBadge severity={inc.severity as Severity} />
                <span className="rounded border border-border bg-surface px-2 py-0.5 text-[10px] uppercase tracking-wider">
                  {typeMeta[inc.type as IncidentType]}
                </span>
                <StatusBadge status={inc.status} />
                {!inc.client_visible && (
                  <span className="rounded border border-border bg-surface px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    Internal
                  </span>
                )}
              </div>
              <h1 className="text-xl font-semibold">{incidentTitle}</h1>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>Assigned to: {inc.officer || "Unassigned"}</span>
                <span>Reported by: {reporterLabel}</span>
                <span>Reported {fmt(reportedAt)}</span>
                <span>{since(reportedAt)} since reported</span>
                <span>Total time open: {timeOpen}</span>
              </div>
            </div>
            <div className="grid gap-2 text-right">
              <div className="rounded-lg border border-border bg-surface px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Confidence score
                </div>
                <div className="text-2xl font-semibold tabular-nums">{confidence}%</div>
              </div>
              <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
                <div className="text-[10px] uppercase tracking-wider">Threat level</div>
                <div className="mt-1 text-sm font-medium text-foreground">{threatLevel}</div>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric icon={LayoutPanelTop} label="Status" value={statusMeta[inc.status] ?? inc.status} tone="resolved" />
            <Metric
              icon={ShieldAlert}
              label="Threat assessment"
              value={threatLevel}
              tone={armed ? "critical" : severityScore >= 4 ? "warning" : "resolved"}
            />
            <Metric
              icon={Radio}
              label="Response age"
              value={`${responseAgeMinutes}m`}
              tone={firstResponse ? "resolved" : "warning"}
            />
            <Metric
              icon={Sparkles}
              label="Area risk"
              value={`${historicalContext.zoneScore}/100`}
              tone={historicalContext.zoneScore >= 70 ? "critical" : historicalContext.zoneScore >= 45 ? "warning" : "resolved"}
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2 border-t border-border/60 pt-4">
            {([
              ["overview", "Overview", ClipboardList],
              ["analysis", "AI Analysis", BrainCircuit],
              ["activity", "Activity Log", Clock],
              ["evidence", "Evidence", FolderOpen],
              ["escalation", "Escalation History", Shield],
              ["related", "Related Incidents", Layers3],
            ] as const).map(([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] uppercase tracking-wider transition ${
                  activeTab === key
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-surface text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="px-5 py-5">
          {activeTab === "overview" && (
            <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-4">
                <div className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Location</div>
                      <h2 className="text-sm font-semibold">{inc.location}</h2>
                    </div>
                    <MapIcon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
                    <MiniStat label="Zone" value={inc.zone} />
                    <MiniStat label="Reported" value={fmt(reportedAt)} />
                    <MiniStat label="Time since reported" value={since(reportedAt)} />
                    <MiniStat label="Time open" value={timeOpen} />
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-surface p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Full description</div>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground">
                    {inc.description || inc.title || "No narrative entered yet."}
                  </p>
                </div>

                <div className="rounded-xl border border-border bg-surface p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Persons involved</div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <MiniStat label="Suspect" value={inc.suspect_description || "Not specified"} />
                    <MiniStat label="Victim" value={inc.victim_name || "Not specified"} />
                    <MiniStat label="Witnesses" value={inc.witnesses || "Not specified"} />
                    <MiniStat label="Contact" value={inc.victim_contact || "Not specified"} />
                  </div>
                </div>

                <NotesPanel
                  notes={data.notes as any[]}
                  onAdd={(body, client_visible) =>
                    addNote({ data: { incident_id: id, body, client_visible } }).then(invalidate)
                  }
                />
              </div>

              <div className="space-y-4">
                <div className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Current state</div>
                      <h3 className="text-sm font-semibold">Status and assignment controls</h3>
                    </div>
                    <LayoutPanelTop className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
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
                  <div className="mt-4 grid gap-2 text-xs md:grid-cols-2">
                    <MiniStat label="Assigned officer" value={inc.officer || "Unassigned"} />
                    <MiniStat label="Reported by" value={reporterLabel} />
                    <MiniStat label="First response" value={firstResponse ? duration(reportedAt, firstResponse.created_at) : "—"} />
                    <MiniStat label="Visibility" value={inc.client_visible ? "Client visible" : "Internal only"} />
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Priority ranking</div>
                      <h3 className="text-sm font-semibold">Nearest responders</h3>
                    </div>
                    <Users className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="mt-3 space-y-2">
                    {recommendedOfficers.map((officer, idx) => (
                      <div key={officer.id} className={`rounded-lg border p-3 ${idx === 0 ? "border-critical/40 bg-critical/10" : "border-border bg-card"}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium">{officer.name}</div>
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              {officer.role.replace("_", " ")} · {officer.zone} · {Math.round(officer.distance)}m away
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-mono tabular-nums">{officer.eta}</div>
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">ETA</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "analysis" && (
            <div className="grid gap-4 xl:grid-cols-[1.25fr_0.95fr]">
              <div className="space-y-4">
                <div className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Situation summary</div>
                      <h3 className="text-sm font-semibold">Plain-English incident synthesis</h3>
                    </div>
                    <span className="rounded-md border border-resolved/30 bg-resolved/10 px-2 py-1 text-[10px] uppercase tracking-wider text-resolved">
                      Historical context included
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-foreground">
                    {`This is a ${severityMeta[inc.severity as Severity]?.label ?? `severity ${inc.severity}`} ${typeMeta[inc.type as IncidentType].toLowerCase()} incident at ${inc.location}. ${inc.officer ? `Officer ${inc.officer} is already attached.` : "No officer is formally assigned yet."} ${osintCount > 0 ? `The area has ${osintCount} nearby signal${osintCount === 1 ? "" : "s"} and the pattern is ${historicalContext.trend}.` : "No direct matching zone pattern is visible in the last 24 hours."}`}
                  </p>
                  <div className="mt-4 grid gap-2 md:grid-cols-3">
                    <MiniStat label="Threat level" value={threatLevel} />
                    <MiniStat label="Suspect status" value={suspectStatus} />
                    <MiniStat label="Armed status" value={armed ? "Potentially armed" : "No weapon signal"} />
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Dispatch section</div>
                      <h3 className="text-sm font-semibold">Recommended responders</h3>
                    </div>
                    <span className="rounded-md border border-border bg-card px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                      Proximity finder
                    </span>
                  </div>
                  <div className="mt-4 space-y-3">
                    {recommendedOfficers.map((officer, idx) => (
                      <div key={officer.id} className={`rounded-xl border p-4 ${idx === 0 ? "border-critical/40 bg-critical/10" : "border-border bg-card"}`}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-semibold">{officer.name}</div>
                              {idx === 0 && (
                                <span className="rounded-full border border-critical/40 bg-critical/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-critical">
                                  Primary
                                </span>
                              )}
                            </div>
                            <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                              {officer.role.replace("_", " ")} · {officer.zone} · {Math.round(officer.distance)}m away
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-mono tabular-nums">{officer.eta}</div>
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">ETA</div>
                          </div>
                        </div>
                        <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
                          <div className="rounded-lg border border-border bg-surface px-3 py-2">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Route</div>
                            <div className="mt-1">{officer.route}</div>
                          </div>
                          <div className="rounded-lg border border-border bg-surface px-3 py-2">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Equipment</div>
                            <div className="mt-1">{humanList(officer.equipment)}</div>
                          </div>
                        </div>
                        <div className="mt-3 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
                          {officer.instructions}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            onClick={() => runDispatchAction("dispatch_ping", officer, `Pinged ${officer.name} for incident ${inc.code}`)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-[11px] uppercase tracking-wider hover:bg-surface-2"
                          >
                            <Radio className="h-3.5 w-3.5" /> Ping
                          </button>
                          <button
                            onClick={() => runDispatchAction("dispatch_route", officer, `Sent route instructions to ${officer.name} for incident ${inc.code}`)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-[11px] uppercase tracking-wider hover:bg-surface-2"
                          >
                            <MapPinned className="h-3.5 w-3.5" /> Send route
                          </button>
                          <button
                            onClick={() => reassign({ data: { id, member_user_id: officer.id } }).then(invalidate)}
                            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[11px] uppercase tracking-wider text-primary-foreground hover:opacity-95"
                          >
                            <Users className="h-3.5 w-3.5" /> Assign
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {vehicleRecommendations.length > 0 && (
                  <div className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Vehicle recommendations</div>
                        <h4 className="text-sm font-semibold">Available patrol units</h4>
                      </div>
                      <Truck className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {vehicleRecommendations.map((vehicle) => (
                        <div key={vehicle.id} className="rounded-lg border border-border bg-surface px-3 py-2 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-medium">{vehicle.code}</div>
                            <span className="rounded border border-border bg-card px-2 py-0.5 text-[10px] uppercase tracking-wider">
                              {vehicle.status}
                            </span>
                          </div>
                          <div className="mt-1 text-muted-foreground">Driver: {vehicle.driver}</div>
                          <div className="mt-1 grid grid-cols-3 gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                            <span>Fuel {vehicle.fuel}%</span>
                            <span>ETA {vehicle.eta}</span>
                            <span>{vehicle.capacity}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Autonomous actions</div>
                      <h3 className="text-sm font-semibold">Infrastructure response suggestions</h3>
                    </div>
                    <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="mt-4 space-y-3">
                    {autonomousActions.map((action) => {
                      const isAuto = action.kind === "auto";
                      return (
                        <div key={action.id} className="rounded-xl border border-border bg-card p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-sm font-semibold">{action.label}</div>
                                <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                                  {isAuto ? "AUTO" : "Needs approval"}
                                </span>
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">{action.detail}</div>
                            </div>
                            <div className="text-right text-xs text-muted-foreground">
                              {isAuto ? (
                                <div className="rounded-full border border-resolved/40 bg-resolved/10 px-2 py-1 text-[10px] uppercase tracking-wider text-resolved">
                                  EXECUTING...
                                </div>
                              ) : (
                                <>
                                  <div className="text-[10px] uppercase tracking-wider">Approval</div>
                                  <div className="mt-1">{action.approval}</div>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="mt-3 grid gap-2 md:grid-cols-2">
                            <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
                              <div className="text-[10px] uppercase tracking-wider">Impact</div>
                              <div className="mt-1 text-foreground">{action.impact}</div>
                            </div>
                            <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
                              <div className="text-[10px] uppercase tracking-wider">Status</div>
                              <div className="mt-1 text-foreground">
                                {isAuto ? "Running from the automation queue" : `${action.risk} risk · ${action.savings} saved`}
                              </div>
                            </div>
                          </div>
                          {!isAuto && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                onClick={() => autoApproveHandler(action, true)}
                                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[11px] uppercase tracking-wider text-primary-foreground"
                              >
                                <CircleCheckBig className="h-3.5 w-3.5" /> Approve
                              </button>
                              <button
                                onClick={() => autoApproveHandler(action, false)}
                                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-[11px] uppercase tracking-wider hover:bg-surface-2"
                              >
                                <CircleX className="h-3.5 w-3.5" /> Deny
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Intelligence section</div>
                      <h3 className="text-sm font-semibold">Area intelligence and pattern context</h3>
                    </div>
                    <Sparkles className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="mt-3 rounded-lg border border-border bg-card px-3 py-2 text-sm leading-6">
                    {historicalContext.summary}
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <MiniStat label="Area risk score" value={`${historicalContext.zoneScore}/100`} />
                    <MiniStat label="Trend" value={historicalContext.trend} />
                  </div>
                  <div className="mt-3 space-y-2">
                    {suggestedRows.length === 0 ? (
                      <div className="text-xs text-muted-foreground">No adjacent intelligence items were found for this zone.</div>
                    ) : (
                      suggestedRows.slice(0, 4).map((item: any) => (
                        <div key={item.id} className="rounded-lg border border-border bg-card px-3 py-2">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-medium">{typeMeta[item.type as IncidentType]}</div>
                              <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                                {item.location} · {item.zone}
                              </div>
                            </div>
                            <div className="text-right text-xs text-muted-foreground">
                              <div>{since(item.reported_at)}</div>
                              <div className="mt-1">Severity {item.severity}</div>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {medical && (
                  <div className="rounded-xl border border-critical/40 bg-critical/10 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.18em] text-critical/80">Medical alert</div>
                        <h3 className="text-sm font-semibold text-foreground">First aid and ambulance readiness required</h3>
                      </div>
                      <Siren className="h-4 w-4 text-critical" />
                    </div>
                    <div className="mt-3 text-sm leading-6">
                      First aid indicators are present in the incident details. Keep a certified responder close,
                      clear the route, and contact LASAMBUS at <span className="font-semibold">767</span> if escalation is required.
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      <MiniStat label="Recommended responder" value={recommendedOfficers[0]?.name ?? "Nearest available officer"} />
                      <MiniStat label="Emergency line" value="LASAMBUS 767" />
                    </div>
                  </div>
                )}

                <div className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Escalation options</div>
                      <h3 className="text-sm font-semibold">Pre-filled emergency contacts</h3>
                    </div>
                    <AlertOctagon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="mt-3 grid gap-2">
                    {[
                      { target: "police" as const, label: "Call Nigeria Police 199", phone: "199" },
                      { target: "lasema" as const, label: "Call LASAMBUS 767", phone: "767" },
                    ].map((item) => (
                      <button
                        key={item.target}
                        onClick={() =>
                          escalate({
                            data: {
                              incident_id: id,
                              target: item.target,
                              contact_name: item.label,
                              contact_phone: item.phone,
                              message: `Urgent escalation requested from AI command panel for ${inc.code} at ${inc.location}.`,
                            },
                          }).then(invalidate)
                        }
                        className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-left text-sm hover:bg-surface-2"
                      >
                        <span>{item.label}</span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </button>
                    ))}
                    <button
                      onClick={() =>
                        escalate({
                          data: {
                            incident_id: id,
                            target: "custom",
                            contact_name: "Security Manager",
                            contact_phone: "",
                            message: `Please review incident ${inc.code} in ${inc.location}. AI Command Panel requested manager escalation.`,
                          },
                        }).then(invalidate)
                      }
                      className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-left text-sm hover:bg-surface-2"
                    >
                      <span>Escalate to Security Manager</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Active overrides status</div>
                      <h3 className="text-sm font-semibold">Currently active autonomous actions</h3>
                    </div>
                    <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="mt-3 space-y-2">
                    {activeOverrides.length === 0 ? (
                      <div className="text-xs text-muted-foreground">No autonomous overrides are currently active.</div>
                    ) : (
                      activeOverrides.map((action) => (
                        <div key={action.id} className="rounded-lg border border-border bg-card px-3 py-2">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-medium">{action.label}</div>
                              <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                                {action.status} · {action.actor ?? "Master Agent"}
                              </div>
                            </div>
                            <div className="text-right text-[10px] uppercase tracking-wider text-muted-foreground">
                              {action.updatedAt ? since(action.updatedAt) : "Live"}
                            </div>
                          </div>
                          <div className="mt-2 flex justify-end">
                            <button
                              onClick={() =>
                                recordAction({
                                  data: {
                                    incident_id: id,
                                    kind: "autonomous_action",
                                    message: `${action.label} reverted manually`,
                                    meta: {
                                      action_id: action.id,
                                      state: "reverted",
                                      action: action.label,
                                      source: "manual-override",
                                    },
                                  },
                                }).then(invalidate)
                              }
                              className="text-[10px] uppercase tracking-wider text-primary hover:underline"
                            >
                              Revert override
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "activity" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-surface p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Activity log</div>
                    <h3 className="text-sm font-semibold">Immutable audit trail</h3>
                  </div>
                  <Clock className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  This log is append-only. Entries can be observed, exported, and reviewed, but not edited or deleted.
                </p>
              </div>
              <Timeline activity={activityRows} />
            </div>
          )}

          {activeTab === "evidence" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-surface p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Evidence</div>
                    <h3 className="text-sm font-semibold">Upload, custody, and legal handling</h3>
                  </div>
                  <ImageUp className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  <MiniStat label="Files attached" value={`${evidenceItems.length}`} />
                  <MiniStat label="Legal flags" value={`${evidenceItems.filter((item: any) => item.legal).length}`} />
                  <MiniStat label="Custody entries" value={`${evidenceItems.reduce((count: number, item: any) => count + (Array.isArray(item.chain_of_custody) ? item.chain_of_custody.length : 0), 0)}`} />
                </div>
              </div>
              <EvidencePanel
                organisationId={inc.organisation_id}
                evidence={evidenceItems}
                onAdd={(items) => addEvidence({ data: { incident_id: id, items } }).then(invalidate)}
                onToggleLegal={(path, legal) =>
                  patchEvidence({ data: { incident_id: id, path, legal, note: legal ? "Marked for chain of custody" : "Legal flag cleared" } }).then(invalidate)
                }
              />
            </div>
          )}

          {activeTab === "escalation" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-surface p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Escalation history</div>
                    <h3 className="text-sm font-semibold">Who was contacted, when, and what happened</h3>
                  </div>
                  <AlertOctagon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  <MiniStat label="Escalations" value={`${escalationRows.length}`} />
                  <MiniStat label="Acknowledged" value={`${escalationRows.filter((row: any) => row.acknowledged).length}`} />
                  <MiniStat
                    label="Avg response"
                    value={
                      escalationRows.some((row: any) => row.acknowledged && row.acknowledged_at)
                        ? `${Math.round(
                            escalationRows
                              .filter((row: any) => row.acknowledged && row.acknowledged_at)
                              .reduce((acc: number, row: any) => acc + (new Date(row.acknowledged_at).getTime() - new Date(row.created_at).getTime()), 0) /
                              escalationRows.filter((row: any) => row.acknowledged && row.acknowledged_at).length /
                              60000,
                          )}m`
                        : "—"
                    }
                  />
                </div>
              </div>
              <EscalationPanel
                escalations={data.escalations as any[]}
                onEscalate={(t, name, phone, message) =>
                  escalate({
                    data: {
                      incident_id: id,
                      target: t,
                      contact_name: name,
                      contact_phone: phone,
                      message,
                    },
                  }).then(invalidate)
                }
                onAck={(eid) => ackEsc({ data: { id: eid } }).then(invalidate)}
                incident={inc}
              />
            </div>
          )}

          {activeTab === "related" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-surface p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Related incidents map</div>
                    <h3 className="text-sm font-semibold">System-suggested and manually linked incidents</h3>
                  </div>
                  <Layers3 className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  This preview clusters all known related incidents around the active case using available incident coordinates.
                </p>
              </div>
              <RelatedMapPreview points={mapPoints} base={incidentPoint} />
              <LinkedPanel
                linked={linkedIncidents}
                suggested={suggestedRows}
                onLink={(lid) =>
                  linkInc({ data: { incident_id: id, linked_incident_id: lid } }).then(invalidate)
                }
              />
            </div>
          )}
        </div>
      </section>
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
    status === "resolved"
      ? "text-resolved"
      : status === "escalated"
        ? "text-critical"
        : status === "responding"
          ? "text-high"
          : status === "closed"
            ? "text-muted-foreground"
            : "text-foreground";
  return (
    <span className={`text-[10px] uppercase tracking-wider font-semibold ${color}`}>
      {statusMeta[status] ?? status}
    </span>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xs font-medium truncate">{value}</div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "resolved",
  icon: Icon,
}: {
  label: string;
  value: string;
  tone?: "resolved" | "warning" | "critical";
  icon?: any;
}) {
  const toneClass =
    tone === "critical"
      ? "border-critical/30 bg-critical/10 text-critical"
      : tone === "warning"
        ? "border-high/30 bg-high/10 text-high"
        : "border-border bg-surface text-foreground";
  return (
    <div className={`rounded-xl border px-3 py-3 ${toneClass}`}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
        {label}
      </div>
      <div className="mt-1 text-sm font-medium leading-5">{value}</div>
    </div>
  );
}

function AssignControl({
  current,
  members,
  onAssign,
}: {
  current: string | null;
  members: any[];
  onAssign: (uid: string | null) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs hover:bg-surface-2"
      >
        <User className="h-3.5 w-3.5" /> {current ? `Reassign (${current})` : "Assign officer"}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-64 rounded-md border border-border bg-card p-1 shadow-lg max-h-72 overflow-y-auto">
          <button
            onClick={() => {
              onAssign(null);
              setOpen(false);
            }}
            className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-surface-2 text-muted-foreground"
          >
            — Unassign —
          </button>
          {members.map((m: any) => (
            <button
              key={m.id}
              onClick={() => {
                onAssign(m.user_id);
                setOpen(false);
              }}
              className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-surface-2"
            >
              <div>{m.profile?.display_name || "Member"}</div>
              <div className="text-[10px] text-muted-foreground capitalize">
                {m.role.replace("_", " ")}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusControl({
  current,
  onChange,
}: {
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
            onClick={() => {
              setPending(s);
              setNote("");
              setErr(null);
            }}
            className={`rounded-md border px-2.5 py-1 text-[11px] uppercase tracking-wider ${
              s === current
                ? "border-primary/60 bg-primary/15 text-primary"
                : "border-border bg-surface text-muted-foreground hover:text-foreground"
            }`}
          >
            {statusMeta[s] ?? s}
          </button>
        ))}
      </div>
      {pending && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm px-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-5">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Transition status
            </div>
            <h3 className="mt-1 text-lg font-semibold">
              {statusMeta[current]} → {statusMeta[pending]}
            </h3>
            <textarea
              autoFocus
              rows={3}
              required
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Reason / note (required for accountability)"
              className="mt-3 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm resize-none"
            />
            {err && <div className="mt-2 text-xs text-critical">{err}</div>}
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setPending(null)}
                className="rounded-md border border-border bg-surface px-3 py-2 text-xs"
              >
                Cancel
              </button>
              <button
                disabled={busy || !note.trim()}
                onClick={async () => {
                  setBusy(true);
                  setErr(null);
                  try {
                    await onChange(pending, note.trim());
                    setPending(null);
                  } catch (e) {
                    setErr((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
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
    kind === "status_changed"
      ? CheckCircle2
      : kind === "assigned"
        ? User
        : kind === "dispatch_ping"
          ? Radio
          : kind === "dispatch_route"
            ? MapPinned
            : kind === "autonomous_action"
              ? ShieldCheck
        : kind === "note" || kind === "client_note"
          ? MessageSquare
        : kind === "evidence_added"
          ? Paperclip
        : kind === "escalation"
              ? AlertOctagon
              : kind === "link_added"
                ? LinkIcon
                : Clock;
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

function NotesPanel({
  notes,
  onAdd,
}: {
  notes: any[];
  onAdd: (body: string, cv: boolean) => Promise<unknown>;
}) {
  const [body, setBody] = useState("");
  const [cv, setCv] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-semibold mb-3">Notes & communication</h2>
      <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
        {notes.length === 0 && <div className="text-xs text-muted-foreground">No notes yet.</div>}
        {notes.map((n) => (
          <div
            key={n.id}
            className={`rounded-md border px-3 py-2 ${n.client_visible ? "border-accent/40 bg-accent/5" : "border-border bg-surface"}`}
          >
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>
                {n.author_name || "Operator"} · {since(n.created_at)}
              </span>
              <span>{n.client_visible ? "Client visible" : "Internal"}</span>
            </div>
            <div className="mt-1 text-sm whitespace-pre-wrap">{n.body}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 space-y-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Add a note. Use @ to mention…"
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm resize-none"
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={cv} onChange={(e) => setCv(e.target.checked)} /> Client
            visible
          </label>
          <button
            disabled={busy || !body.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await onAdd(body.trim(), cv);
                setBody("");
                setCv(false);
              } finally {
                setBusy(false);
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}{" "}
            Post note
          </button>
        </div>
      </div>
    </section>
  );
}

function EvidencePanel({
  organisationId,
  evidence,
  onAdd,
  onToggleLegal,
}: {
  organisationId: string;
  evidence: any[];
  onAdd: (items: { path: string; kind: any; size: number; name: string }[]) => Promise<unknown>;
  onToggleLegal?: (path: string, legal: boolean) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [enlarged, setEnlarged] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    const ext = file.name.split(".").pop() || "bin";
    const path = `${organisationId}/added/${crypto.randomUUID()}.${ext}`;
    const kind: any = file.type.startsWith("image/")
      ? "image"
      : file.type.startsWith("video/")
        ? "video"
        : file.type.startsWith("audio/")
          ? "audio"
          : "document";
    const { error } = await supabase.storage
      .from("incident-evidence")
      .upload(path, file, { contentType: file.type });
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
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs hover:bg-surface-2"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}{" "}
          Add evidence
        </button>
        <input
          ref={fileRef}
          type="file"
          hidden
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
      </div>
      {evidence.length === 0 ? (
        <div className="text-xs text-muted-foreground">No evidence attached.</div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {evidence.map((ev: any) => (
            <div key={ev.path} className="rounded-xl border border-border bg-surface overflow-hidden">
              <div className="border-b border-border/70 bg-card px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{ev.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <span>{ev.kind}</span>
                      <span>{ev.size ? `${Math.round(ev.size / 1024)} KB` : "—"}</span>
                      <span>{ev.added_by_name || "System"}</span>
                    </div>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${ev.legal ? "border-critical/40 bg-critical/10 text-critical" : "border-border bg-surface text-muted-foreground"}`}>
                    {ev.legal ? "Legal evidence" : "Standard"}
                  </span>
                </div>
              </div>

              {ev.kind === "image" && ev.url ? (
                <button onClick={() => setEnlarged(ev.url)} className="block w-full">
                  <img src={ev.url} alt={ev.name} className="w-full h-44 object-cover" />
                </button>
              ) : ev.kind === "video" && ev.url ? (
                <video src={ev.url} controls className="w-full h-44 object-cover bg-black" />
              ) : ev.kind === "audio" && ev.url ? (
                <div className="p-3">
                  <audio src={ev.url} controls className="w-full" />
                </div>
              ) : (
                <a
                  href={ev.url ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-44 flex-col items-center justify-center text-xs text-muted-foreground hover:text-foreground"
                >
                  <FileText className="h-6 w-6" />
                  <span className="mt-1 truncate max-w-full px-2">{ev.name}</span>
                </a>
              )}

              <div className="space-y-2 px-3 py-3 text-xs">
                <div className="grid gap-2 md:grid-cols-2">
                  <div className="rounded-lg border border-border bg-card px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Uploaded</div>
                    <div className="mt-1">{ev.added_at ? fmtPrecise(ev.added_at) : "—"}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-card px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Chain of custody</div>
                    <div className="mt-1">{Array.isArray(ev.chain_of_custody) ? `${ev.chain_of_custody.length} event(s)` : "1 event"}</div>
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-card px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Custody trail</div>
                  <div className="mt-2 space-y-2">
                    {(Array.isArray(ev.chain_of_custody) ? ev.chain_of_custody : [{ at: ev.added_at, actor_name: ev.added_by_name, action: "added" }]).map((entry: any, idx: number) => (
                      <div key={`${ev.path}-${idx}`} className="flex items-start justify-between gap-3 rounded-md border border-border bg-surface px-2 py-1.5">
                        <div className="min-w-0">
                          <div className="truncate text-[11px] font-medium uppercase tracking-wider">{entry.action}</div>
                          <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{entry.actor_name || "System"}</div>
                        </div>
                        <div className="text-right text-[10px] text-muted-foreground">{entry.at ? since(entry.at) : "—"}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {ev.url && (
                    <a
                      href={ev.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-[11px] uppercase tracking-wider hover:bg-surface-2"
                    >
                      <FileText className="h-3.5 w-3.5" /> Download
                    </a>
                  )}
                  {onToggleLegal && (
                    <button
                      onClick={() => onToggleLegal(ev.path, !ev.legal)}
                      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] uppercase tracking-wider ${ev.legal ? "border border-border bg-card hover:bg-surface-2" : "bg-primary text-primary-foreground"}`}
                    >
                      <Shield className="h-3.5 w-3.5" />
                      {ev.legal ? "Clear legal flag" : "Flag legal evidence"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {enlarged && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-4"
          onClick={() => setEnlarged(null)}
        >
          <img src={enlarged} alt="" className="max-h-full max-w-full" />
        </div>
      )}
    </section>
  );
}

function EscalationPanel({
  escalations,
  onEscalate,
  onAck,
  incident,
}: {
  escalations: any[];
  onEscalate: (target: any, name: string, phone: string, message: string) => Promise<unknown>;
  onAck: (id: string) => Promise<unknown>;
  incident: any;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<(typeof ESCALATION_TARGETS)[number]["key"]>("police");
  const [customName, setCustomName] = useState("");
  const [customPhone, setCustomPhone] = useState("");
  const draft = useMemo(() => {
    return (
      `URGENT — ${typeMeta[incident.type as IncidentType]} (Severity ${incident.severity})\n` +
      `Location: ${incident.location}, ${incident.zone}\n` +
      `Time: ${fmt(incident.reported_at)}\n` +
      `Officer on scene: ${incident.officer || "Unassigned"}\n` +
      `Details: ${incident.description || "—"}\n` +
      `Ref: ${incident.code}`
    );
  }, [incident]);
  const [message, setMessage] = useState(draft);
  const [busy, setBusy] = useState(false);

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
        <ShieldAlert className="h-3.5 w-3.5 text-critical" /> Escalation
      </h2>
      {!open ? (
        <button
          onClick={() => {
            setOpen(true);
            setMessage(draft);
          }}
          className="w-full rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical hover:bg-critical/15"
        >
          Escalate to authorities
        </button>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-1.5">
            {ESCALATION_TARGETS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTarget(t.key)}
                className={`rounded-md border px-2 py-1.5 text-[11px] uppercase tracking-wider ${target === t.key ? "border-primary/60 bg-primary/15 text-primary" : "border-border bg-surface text-muted-foreground"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {target === "custom" && (
            <div className="grid grid-cols-2 gap-2">
              <input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Contact name"
                className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs"
              />
              <input
                value={customPhone}
                onChange={(e) => setCustomPhone(e.target.value)}
                placeholder="Phone"
                className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs"
              />
            </div>
          )}
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
            className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs font-mono"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setOpen(false)}
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs"
            >
              Cancel
            </button>
            <button
              disabled={busy || !message.trim()}
              onClick={async () => {
                setBusy(true);
                try {
                  const t = ESCALATION_TARGETS.find((x) => x.key === target)!;
                  await onEscalate(
                    target,
                    target === "custom" ? customName : t.label,
                    target === "custom" ? customPhone : t.phone,
                    message.trim(),
                  );
                  setOpen(false);
                } finally {
                  setBusy(false);
                }
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
            <div
              key={e.id}
              className="rounded-md border border-border bg-surface px-3 py-2 text-xs"
            >
              <div className="flex items-center justify-between">
                <div className="font-medium uppercase tracking-wider text-[10px]">{e.target}</div>
                <div className="text-[10px] text-muted-foreground">{since(e.created_at)}</div>
              </div>
              {e.contact_name && (
                <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-1">
                  <Phone className="h-3 w-3" /> {e.contact_name}{" "}
                  {e.contact_phone && `· ${e.contact_phone}`}
                </div>
              )}
              <div className="mt-1 flex items-center justify-between">
                <span
                  className={`text-[10px] uppercase tracking-wider ${e.acknowledged ? "text-resolved" : "text-medium"}`}
                >
                  {e.acknowledged ? "Acknowledged" : "Pending response"}
                </span>
                {!e.acknowledged && (
                  <button
                    onClick={() => onAck(e.id)}
                    className="text-[10px] uppercase tracking-wider text-primary hover:underline"
                  >
                    Mark acknowledged
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function LinkedPanel({
  linked,
  suggested,
  onLink,
}: {
  linked: any[];
  suggested: any[];
  onLink: (id: string) => Promise<unknown>;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
        <LinkIcon className="h-3.5 w-3.5" /> Related incidents
      </h2>
      {linked.length === 0 ? (
        <div className="text-xs text-muted-foreground">No linked incidents.</div>
      ) : (
        <div className="space-y-1.5">
          {linked.map((l) => (
            <Link
              key={l.id}
              to="/app/incidents/$id"
              params={{ id: l.id }}
              className="block rounded-md border border-border bg-surface px-3 py-2 text-xs hover:bg-surface-2"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono">{l.code}</span>
                <SeverityBadge severity={l.severity as Severity} />
              </div>
              <div className="mt-1 text-muted-foreground truncate">
                {typeMeta[l.type as IncidentType]} · {l.location}
              </div>
            </Link>
          ))}
        </div>
      )}
      {suggested.length > 0 && (
        <div className="mt-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
            Suggested (same zone, ±24h)
          </div>
          <div className="space-y-1.5">
            {suggested.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <div className="font-mono">{s.code}</div>
                  <div className="text-muted-foreground truncate">
                    {typeMeta[s.type as IncidentType]} · {since(s.reported_at)}
                  </div>
                </div>
                <button
                  onClick={() => onLink(s.id)}
                  className="text-[10px] uppercase tracking-wider text-primary hover:underline"
                >
                  Link
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function RelatedMapPreview({
  points,
  base,
}: {
  points: { id: string; label: string; lng: number; lat: number; severity: number }[];
  base: [number, number];
}) {
  const candidates = points.length ? points : [{ id: "base", label: "Current incident", lng: base[0], lat: base[1], severity: 5 }];
  const lngs = candidates.map((p) => p.lng);
  const lats = candidates.map((p) => p.lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const scale = (value: number, min: number, max: number) => {
    if (max === min) return 50;
    return 8 + ((value - min) / (max - min)) * 84;
  };

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Map preview</div>
          <h2 className="text-sm font-semibold">Related incident cluster</h2>
        </div>
        <MapIcon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface">
        <svg viewBox="0 0 100 100" className="h-72 w-full">
          <defs>
            <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.6" />
            </pattern>
          </defs>
          <rect width="100" height="100" fill="url(#grid)" />
          {candidates.map((point) => {
            const x = scale(point.lng, minLng, maxLng);
            const y = 100 - scale(point.lat, minLat, maxLat);
            const isBase = point.id === "base";
            const tone =
              point.severity >= 5 ? "#ef4444" : point.severity >= 4 ? "#f97316" : point.severity >= 3 ? "#f59e0b" : "#22c55e";
            return (
              <g key={point.id}>
                <circle cx={x} cy={y} r={isBase ? 3.8 : 3.2} fill={tone} opacity={isBase ? 1 : 0.85} />
                <circle cx={x} cy={y} r={isBase ? 8 : 6} fill={tone} opacity="0.16" />
                <text x={x + 3} y={y - 3} fontSize="4" fill="rgba(255,255,255,0.82)">
                  {point.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {candidates.map((point) => (
          <div key={point.id} className="rounded-lg border border-border bg-surface px-3 py-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono">{point.label}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Severity {point.severity}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
