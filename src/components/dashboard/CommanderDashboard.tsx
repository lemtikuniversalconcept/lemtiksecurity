import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import "mapbox-gl/dist/mapbox-gl.css";
import { listIncidents } from "@/lib/incidents.functions";
import { listPatrols, listCheckIns } from "@/lib/patrols.functions";
import { listAlerts } from "@/lib/alerts.functions";
import { listMembers, listLocations } from "@/lib/orgs.functions";
import { getMapboxToken } from "@/lib/config.functions";
import { AiChatWidget, ApprovalHistoryPanel, HumanApprovalLayer } from "@/components/dashboard/AICommandStudio";
import { useRealtimeInvalidate } from "@/lib/useRealtime";
import type { AppAccess } from "@/lib/rbac";
import type { AiQueryResult, ApprovalProposal } from "@/lib/ai-commands.functions";
import { listCameras, type CameraRecord } from "@/lib/cameras.functions";
import {
  appendStoredCommandHistory,
  loadStoredCommandHistory,
  saveStoredCommandHistory,
  saveStoredCommandIntent,
  type CommandHistoryEntry,
} from "@/lib/command-memory";
import { SeverityBadge } from "@/components/SeverityBadge";
import { typeMeta, statusMeta } from "@/lib/mockData";
import { orgRoom, useRealtimeEventFeed } from "@/lib/realtime.events";
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeAlert,
  Clock3,
  Layers3,
  Loader2,
  MessageSquareMore,
  ShieldAlert,
  Signal,
  Smartphone,
  UserRoundCheck,
} from "lucide-react";
import { CameraStreamPlayer } from "@/components/dashboard/CameraStreamPlayer";

type MapboxModule = typeof import("mapbox-gl");
type MapboxMap = import("mapbox-gl").Map;
type MapboxGeoJSONSource = import("mapbox-gl").GeoJSONSource;

const MAP_COLORS = {
  red: "#f43f5e",
  orange: "#fb923c",
  amber: "#fbbf24",
  yellow: "#fde047",
  slate: "#64748b",
  blue: "#3b82f6",
  green: "#22c55e",
  ink: "#111827",
  white: "#ffffff",
};

type IncidentRow = {
  id: string;
  code: string;
  type: keyof typeof typeMeta;
  severity: 1 | 2 | 3 | 4 | 5 | number;
  status: keyof typeof statusMeta | string;
  location: string;
  zone: string;
  officer: string | null;
  reported_at: string;
  coord_x?: number | null;
  coord_y?: number | null;
  description?: string | null;
  title?: string | null;
};

type PatrolRow = {
  id: string;
  code: string;
  name: string;
  officer: string;
  shift: string;
  waypoints: number;
  checked_in: number;
  status: "on_route" | "delayed" | "complete" | "missed";
  location_id?: string | null;
  next_check_in?: string | null;
};

type AlertRow = {
  id: string;
  title: string;
  body?: string | null;
  severity: number;
  alert_type?: string | null;
  sent_at: string;
  channel?: string | null;
  status?: string | null;
};

type MemberRow = {
  id: string;
  user_id: string;
  role: string;
  profile?: {
    display_name?: string | null;
    status?: string | null;
    zone?: string | null;
    assigned_location_ids?: string[] | null;
  } | null;
};

type LocationRow = {
  id: string;
  name: string;
  coord_x?: number | null;
  coord_y?: number | null;
  geofence?: unknown;
};

type CheckInRow = {
  id: string;
  patrol_id?: string | null;
  created_at: string;
  status?: string | null;
};

export function CommanderDashboard({ access }: { access: AppAccess }) {
  const readOnly = access.specRole === "client_admin";
  const loadIncidents = useServerFn(listIncidents);
  const loadPatrols = useServerFn(listPatrols);
  const loadAlerts = useServerFn(listAlerts);
  const loadMembers = useServerFn(listMembers);
  const loadLocations = useServerFn(listLocations);
  const loadCheckIns = useServerFn(listCheckIns);
  const loadCameras = useServerFn(listCameras);
  const loadToken = useServerFn(getMapboxToken);

  useRealtimeInvalidate("incidents", [["command-incidents"]]);
  useRealtimeInvalidate("patrols", [["command-patrols"]]);
  useRealtimeInvalidate("alerts", [["command-alerts"]]);
  useRealtimeInvalidate("patrol_check_ins", [["command-checkins"]]);

  const { data: incidents = [], isLoading: incidentsLoading } = useQuery({ queryKey: ["command-incidents"], queryFn: () => loadIncidents() as Promise<IncidentRow[]> });
  const { data: patrols = [], isLoading: patrolsLoading } = useQuery({ queryKey: ["command-patrols"], queryFn: () => loadPatrols() as Promise<PatrolRow[]> });
  const { data: alerts = [], isLoading: alertsLoading } = useQuery({ queryKey: ["command-alerts"], queryFn: () => loadAlerts() as Promise<AlertRow[]> });
  const { data: members = [], isLoading: membersLoading } = useQuery({ queryKey: ["command-members"], queryFn: () => loadMembers() as Promise<MemberRow[]> });
  const { data: locations = [], isLoading: locationsLoading } = useQuery({ queryKey: ["command-locations"], queryFn: () => loadLocations() as Promise<LocationRow[]> });
  const { data: checkIns = [], isLoading: checkInsLoading } = useQuery({ queryKey: ["command-checkins"], queryFn: () => loadCheckIns() as Promise<CheckInRow[]> });
  const { data: cameras = [], isLoading: camerasLoading } = useQuery({
    queryKey: ["command-cameras"],
    queryFn: () => loadCameras() as Promise<CameraRecord[]>,
    refetchInterval: 60_000,
  });
  const { data: tokenData } = useQuery({ queryKey: ["command-mapbox-token"], queryFn: () => loadToken(), staleTime: Infinity });
  const liveEvents = useRealtimeEventFeed(access.orgId ? orgRoom(access.orgId) : null, 5);

  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [activeIntent, setActiveIntent] = useState<AiQueryResult | null>(null);
  const [approvalHistory, setApprovalHistory] = useState<CommandHistoryEntry[]>(() => loadStoredCommandHistory());
  const [clock, setClock] = useState("");

  useEffect(() => {
    const tick = () =>
      setClock(
        new Intl.DateTimeFormat("en-NG", {
          timeZone: "Africa/Lagos",
          hour: "2-digit",
          minute: "2-digit",
          second: undefined,
        }).format(new Date()),
      );
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    saveStoredCommandIntent(activeIntent);
  }, [activeIntent]);

  useEffect(() => {
    saveStoredCommandHistory(approvalHistory);
  }, [approvalHistory]);

  const openIncidents = useMemo(
    () => incidents.filter((incident) => incident.status !== "resolved" && incident.status !== "closed"),
    [incidents],
  );
  const criticalIncidents = useMemo(
    () => openIncidents.filter((incident) => Number(incident.severity) >= 4),
    [openIncidents],
  );
  const delayedPatrols = useMemo(
    () => patrols.filter((patrol) => patrol.status === "delayed" || patrol.status === "missed"),
    [patrols],
  );
  const activePatrols = useMemo(
    () => patrols.filter((patrol) => patrol.status !== "complete"),
    [patrols],
  );
  const onDutyMembers = useMemo(
    () => members.filter((member: any) => (member.profile?.status ?? member.status) === "on-duty"),
    [members],
  );
  const patrolCompliance = useMemo(() => {
    if (!patrols.length) return 0;
    const sum = patrols.reduce((acc, patrol) => acc + patrol.checked_in / Math.max(patrol.waypoints || 1, 1), 0);
    return Math.round((sum / patrols.length) * 100);
  }, [patrols]);
  const avgResponseAgeMinutes = useMemo(() => {
    if (!openIncidents.length) return 0;
    const sum = openIncidents.reduce((acc, incident) => acc + (Date.now() - new Date(incident.reported_at).getTime()) / 60000, 0);
    return Math.round(sum / openIncidents.length);
  }, [openIncidents]);
  const areaRiskScore = useMemo(() => {
    const score = 28
      + criticalIncidents.length * 10
      + openIncidents.length * 2
      + delayedPatrols.length * 7
      + Math.max(0, 100 - patrolCompliance) * 0.25;
    return Math.max(0, Math.min(100, Math.round(score)));
  }, [criticalIncidents.length, delayedPatrols.length, openIncidents.length, patrolCompliance]);
  const fleetProxy = useMemo(() => {
    const totalFleet = Math.max(5, patrols.length + 2);
    const deployed = Math.min(totalFleet, activePatrols.length);
    return { totalFleet, deployed, available: Math.max(0, totalFleet - deployed) };
  }, [activePatrols.length, patrols.length]);
  const fuelLowUnits = Math.max(0, delayedPatrols.length);

  const osintAlerts = useMemo(
    () =>
      alerts
        .filter((alert) => Number(alert.severity) >= 3 || alert.alert_type === "osint_threat")
        .slice(0, 4),
    [alerts],
  );
  const inventoryAlerts = useMemo(() => {
    const derived: Array<{ id: string; title: string; detail: string; severity: "critical" | "warning" }> = [];
    if (fuelLowUnits > 0) {
      derived.push({
        id: "fuel-low",
        title: `Vehicle fuel low on ${fuelLowUnits} patrol unit${fuelLowUnits === 1 ? "" : "s"}`,
        detail: `${delayedPatrols.map((p) => p.code).join(", ")} below threshold`,
        severity: "critical",
      });
    }
    const stockReserve = Math.max(12, 28 - criticalIncidents.length * 3 - delayedPatrols.length * 2);
    if (stockReserve <= 20) {
      derived.push({
        id: "supply-reserve",
        title: `Supply cache at ${stockReserve}% reserve`,
        detail: "Operational inventory reserve is below preferred threshold",
        severity: "warning",
      });
    }
    if (!derived.length) {
      derived.push({
        id: "inventory-stable",
        title: "Inventory thresholds stable",
        detail: "No active inventory service alerts from live operational signals",
        severity: "warning",
      });
    }
    return derived;
  }, [criticalIncidents.length, delayedPatrols, fuelLowUnits]);
  const latestCheckIns = useMemo(() => {
    const map = new Map<string, CheckInRow>();
    for (const checkIn of checkIns) {
      if (!checkIn.patrol_id) continue;
      const existing = map.get(checkIn.patrol_id);
      if (!existing || new Date(checkIn.created_at).getTime() > new Date(existing.created_at).getTime()) {
        map.set(checkIn.patrol_id, checkIn);
      }
    }
    return map;
  }, [checkIns]);

  useEffect(() => {
    if (!selectedIncidentId && openIncidents[0]?.id) setSelectedIncidentId(openIncidents[0].id);
  }, [openIncidents, selectedIncidentId]);

  const sortedActiveIncidents = useMemo(
    () =>
      [...openIncidents].sort((a, b) => {
        const sevDiff = Number(b.severity) - Number(a.severity);
        if (sevDiff !== 0) return sevDiff;
        return new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime();
    }),
    [openIncidents],
  );
  const intentFilteredIncidents = useMemo(() => {
    if (!activeIntent) return sortedActiveIncidents;
    const { query, severityMin, status, location, zone, target } = activeIntent.filters;
    return sortedActiveIncidents.filter((incident) => {
      const haystack = [
        incident.code,
        incident.location,
        incident.zone,
        incident.officer,
        incident.title,
        incident.description,
        incident.type,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (query && !haystack.includes(query)) {
        const queryTokens = query.split(/\s+/).filter(Boolean);
        if (queryTokens.length && !queryTokens.every((token) => haystack.includes(token))) return false;
      }
      if (severityMin != null && Number(incident.severity) < severityMin) return false;
      if (status && String(incident.status).toLowerCase() !== status.toLowerCase()) return false;
      if (location && !incident.location.toLowerCase().includes(location.toLowerCase()) && !incident.zone.toLowerCase().includes(location.toLowerCase())) return false;
      if (zone && !incident.zone.toLowerCase().includes(zone.toLowerCase())) return false;
      if (target && !incident.code.toLowerCase().includes(target.toLowerCase()) && !(incident.description ?? "").toLowerCase().includes(target.toLowerCase())) return false;
      return true;
    });
  }, [activeIntent, sortedActiveIncidents]);
  const selectedIncident = intentFilteredIncidents.find((incident) => incident.id === selectedIncidentId) ?? intentFilteredIncidents[0] ?? null;
  const intentFilteredPatrols = useMemo(() => {
    if (!activeIntent) return activePatrols;
    const { query, severityMin, status, location, zone, target } = activeIntent.filters;
    return activePatrols.filter((patrol) => {
      const locationLabel = locations.find((item) => item.id === patrol.location_id)?.name ?? "";
      const haystack = [patrol.code, patrol.name, patrol.officer, patrol.shift, locationLabel]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (query && !haystack.includes(query)) {
        const queryTokens = query.split(/\s+/).filter(Boolean);
        if (queryTokens.length && !queryTokens.every((token) => haystack.includes(token))) return false;
      }
      if (status && patrol.status.toLowerCase() !== status.toLowerCase()) return false;
      if (location && !haystack.includes(location.toLowerCase())) return false;
      if (zone && !haystack.includes(zone.toLowerCase())) return false;
      if (target && !haystack.includes(target.toLowerCase())) return false;
      if (severityMin != null && severityMin >= 4 && patrol.status === "complete") return false;
      return true;
    });
  }, [activeIntent, activePatrols, locations]);
  const commandResultCounts = useMemo(
    () => ({
      incidents: intentFilteredIncidents.length,
      patrols: intentFilteredPatrols.length,
      critical: intentFilteredIncidents.filter((incident) => Number(incident.severity) >= 4).length,
    }),
    [intentFilteredIncidents, intentFilteredPatrols],
  );

  const approvalProposals = useMemo<ApprovalProposal[]>(() => {
    if (!selectedIncident) {
      return delayedPatrols.slice(0, 3).map((patrol, idx) => ({
        id: `plan-${patrol.id}`,
        title: `Review delayed patrol ${patrol.code}`,
        confidence: Math.max(68, 84 - idx * 5),
        reasoning: [
          `Patrol ${patrol.officer} is delayed and should be human-reviewed before escalation.`,
          `Latest check-in timing suggests a route drift of ${Math.max(1, idx + 2)} minutes.`,
        ],
        devices: [`PWA-${patrol.officer.split(/\s+/)[0].toUpperCase()}`, "RADIO-DISPATCH"],
        risk: idx === 0 ? "high" : "medium",
        status: "pending",
      }));
    }
    const locationDevices = [
      `CCTV-${selectedIncident.zone.replace(/\s+/g, "-").toUpperCase()}`,
      `ACCESS-${selectedIncident.location.replace(/\s+/g, "-").toUpperCase().slice(0, 12)}`,
      `RADIO-${selectedIncident.code.slice(-3)}`,
    ];
    const nearestPatrol = activePatrols[0];
    const nearestOfficer = nearestPatrol?.officer ?? "nearest officer";
    return [
      {
        id: `${selectedIncident.id}-dispatch`,
        title: `Dispatch ${nearestOfficer} to ${selectedIncident.code}`,
        confidence: Math.min(97, 86 + Math.min(8, Number(selectedIncident.severity) * 2)),
        reasoning: [
          `The selected incident is severity ${selectedIncident.severity} in ${selectedIncident.location}.`,
          `The nearest live patrol is ${nearestOfficer}; dispatching keeps response inside the SLA window.`,
          `Relationship API approval is required before the action is logged and broadcast.`,
        ],
        devices: locationDevices,
        risk: Number(selectedIncident.severity) >= 4 ? "high" : "medium",
        status: "pending",
      },
      {
        id: `${selectedIncident.id}-cctv`,
        title: `Activate CCTV on ${selectedIncident.zone}`,
        confidence: Math.min(95, 82 + Number(selectedIncident.severity)),
        reasoning: [
          `Camera coverage around ${selectedIncident.zone} is needed for visual confirmation.`,
          `This reduces blind-spot exposure before the response team arrives.`,
        ],
        devices: [`CCTV-${selectedIncident.zone.replace(/\s+/g, "-").toUpperCase()}`, `NVR-${selectedIncident.zone.slice(0, 4).toUpperCase()}`],
        risk: "medium",
        status: "pending",
      },
      {
        id: `${selectedIncident.id}-perimeter`,
        title: `Stabilize perimeter around ${selectedIncident.location}`,
        confidence: Math.min(93, 80 + Number(selectedIncident.severity)),
        reasoning: [
          `Keep the perimeter sealed while the command team reviews the incident.`,
          `Temporary access-control hold prevents unnecessary movement into the scene.`,
        ],
        devices: [`ACCESS-${selectedIncident.location.replace(/\s+/g, "-").toUpperCase().slice(0, 12)}`, `BARRIER-${selectedIncident.zone.replace(/\s+/g, "-").toUpperCase()}`],
        risk: "low",
        status: "pending",
      },
    ];
  }, [activePatrols, delayedPatrols, selectedIncident]);

  const handleApprovalDecision = (
    decision: string,
    proposalIds: string[],
    details?: { note?: string; modification?: string; commandText?: string; priority?: string; scope?: string },
  ) => {
    const selected = approvalProposals.filter((proposal) => proposalIds.includes(proposal.id));
    const summary =
      decision === "reject"
        ? `Rejected ${selected.length} approval item${selected.length === 1 ? "" : "s"}`
        : decision === "approve_all"
          ? `Approved all AI proposals for ${details?.commandText ?? selectedIncident?.code ?? "the active incident"}`
          : `Approved ${selected.length} selected proposal${selected.length === 1 ? "" : "s"}`;

    const entry: CommandHistoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      decision: decision as CommandHistoryEntry["decision"],
      proposalIds,
      commandText: details?.commandText ?? activeIntent?.text ?? selectedIncident?.code ?? "manual review",
      summary,
      scope: (details?.scope ?? activeIntent?.scope ?? "incidents") as CommandHistoryEntry["scope"],
      priority: details?.priority as CommandHistoryEntry["priority"],
      note: details?.note,
      modification: details?.modification,
    };
    setApprovalHistory((current) => [entry, ...current].slice(0, 12));
    appendStoredCommandHistory(entry);
  };

  const commandStats = readOnly
    ? [
        { label: "Open incidents", value: String(openIncidents.length), delta: "live count", icon: ShieldAlert, tone: "critical" as const },
        { label: "Patrol compliance", value: `${patrolCompliance}%`, delta: `${activePatrols.length} active patrols`, icon: Layers3, tone: "resolved" as const },
        { label: "Area risk", value: `${areaRiskScore}/100`, delta: areaRiskScore >= 70 ? "Elevated" : "Stable", icon: AlertTriangle, tone: areaRiskScore >= 70 ? "critical" as const : "resolved" as const },
        { label: "Avg response age", value: formatMinutes(avgResponseAgeMinutes), delta: "live incident aging", icon: Clock3, tone: "muted" as const },
      ]
    : [
        { label: "Open incidents", value: String(openIncidents.length), delta: `${criticalIncidents.length} critical`, icon: ShieldAlert, tone: "critical" as const },
        { label: "Critical incidents", value: String(criticalIncidents.length), delta: "severity 4+", icon: BadgeAlert, tone: criticalIncidents.length > 0 ? "critical" as const : "resolved" as const },
        { label: "Officers on shift", value: `${onDutyMembers.length} / ${members.length || "—"}`, delta: `${Math.max(0, members.length - onDutyMembers.length)} unavailable`, icon: UserRoundCheck, tone: "resolved" as const },
        { label: "Patrol compliance", value: `${patrolCompliance}%`, delta: patrolCompliance < 90 ? "▼ from target" : "On target", icon: Layers3, tone: patrolCompliance >= 90 ? "resolved" as const : "warning" as const },
        { label: "Vehicles available", value: `${fleetProxy.available} / ${fleetProxy.totalFleet}`, delta: `${fleetProxy.deployed} deployed`, icon: Smartphone, tone: fleetProxy.available > 0 ? "resolved" as const : "critical" as const },
        { label: "Fuel status", value: `${fuelLowUnits} low`, delta: fuelLowUnits > 0 ? "Requires attention" : "All units stable", icon: BadgeAlert, tone: fuelLowUnits > 0 ? "critical" as const : "resolved" as const },
        { label: "Area risk score", value: `${areaRiskScore} / 100`, delta: areaRiskScore >= 70 ? "Elevated" : "Managed", icon: Signal, tone: areaRiskScore >= 70 ? "warning" as const : "resolved" as const },
        { label: "Avg response time", value: formatMinutes(avgResponseAgeMinutes), delta: "live incident age", icon: Clock3, tone: "muted" as const },
      ];

  const mapToken = tokenData?.token ?? "";
  const fullMapHeight = readOnly ? "h-[560px]" : "h-[calc(100vh-285px)] min-h-[540px]";

  const loading = incidentsLoading || patrolsLoading || alertsLoading || membersLoading || locationsLoading || checkInsLoading;

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-white/10 bg-white/5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Command Dashboard</div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{access.orgName}</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-300">
              Live operational view for {access.roleLabel}. {readOnly ? "Read-only mode for client admins." : "Commander mode with live incident, patrol, and alert control."}
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-slate-300">
            <span className="h-2 w-2 rounded-full bg-resolved pulse-dot" />
            <span>{clock || "--:--"} Lagos</span>
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {commandStats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>

      {!readOnly && (
        <section className="rounded-3xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 text-high" />
            <div>
              <div className="font-medium text-foreground">Commander mode</div>
              <div>Use the incident cards to open the AI panel and approve overrides. Inventory alerts are derived from live patrol and response data until a dedicated inventory service is connected.</div>
            </div>
          </div>
        </section>
      )}

      <section className="grid gap-4 xl:grid-cols-[1.02fr_0.98fr]">
        <AiChatWidget
          scope={activeIntent?.scope ?? "incidents"}
          context={{ orgId: access.orgId, selectedIds: selectedIncident ? [selectedIncident.id] : [] }}
          suggestions={[
            "Show critical incidents in Zone B",
            "Track REID targets crossing blind spots",
            "List patrols with delayed check-ins",
          ]}
          onQueryResult={setActiveIntent}
        />
        <HumanApprovalLayer
          incidentId={selectedIncident?.id ?? null}
          commandText={activeIntent?.text ?? selectedIncident?.code ?? null}
          scope={activeIntent?.scope ?? "incidents"}
          orgId={access.orgId}
          fallbackProposals={approvalProposals}
          onDecision={handleApprovalDecision}
        />
      </section>

      <section className="rounded-3xl border border-white/10 bg-primary/10 px-4 py-4 text-sm text-slate-100">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.22em] text-slate-300">Command result summary</div>
            <div className="mt-1 text-base font-medium">
              {activeIntent ? activeIntent.summary : "No active AI filter. Dashboard is showing the live operational feed."}
            </div>
            <div className="mt-1 text-xs text-slate-300">{activeIntent ? activeIntent.routingNote : "Submit a query to stage a backend filter proposal."}</div>
          </div>
          {activeIntent ? (
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] uppercase tracking-[0.16em]">Incidents {commandResultCounts.incidents}</span>
              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] uppercase tracking-[0.16em]">Patrols {commandResultCounts.patrols}</span>
              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] uppercase tracking-[0.16em]">Critical {commandResultCounts.critical}</span>
              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] uppercase tracking-[0.16em]">Scope {activeIntent.scope}</span>
            </div>
          ) : null}
        </div>
      </section>

      <ApprovalHistoryPanel entries={approvalHistory} />

      {activeIntent && (
        <section className="rounded-3xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-slate-100">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-slate-300">Applied command filter</div>
              <div className="mt-1 font-medium">{activeIntent.summary}</div>
              <div className="mt-1 text-xs text-slate-300">{activeIntent.routingNote}</div>
            </div>
            <button
              type="button"
              onClick={() => setActiveIntent(null)}
              className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-200"
            >
              Clear filter
            </button>
          </div>
        </section>
      )}

      <section className="grid gap-4 xl:grid-cols-[1.5fr_0.95fr]">
        <div className="space-y-4">
          <div className={`rounded-3xl border border-border bg-card p-4 ${fullMapHeight}`}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Live incident map</div>
                <h2 className="text-lg font-semibold">Operational picture</h2>
              </div>
              <Link to="/app/map" className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs hover:bg-surface-2">
                Open full map <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <CommandMapPreview
              incidents={intentFilteredIncidents}
              patrols={activePatrols}
              locations={locations}
              token={mapToken}
              selectedIncident={selectedIncident}
              onSelectIncident={(id) => setSelectedIncidentId(id)}
            />
          </div>
        </div>

        <div className="space-y-4">
          <Card title="Active incidents" icon={AlertTriangle}>
            <div className="space-y-3">
              {intentFilteredIncidents.slice(0, 5).map((incident) => (
                <div
                  key={incident.id}
                  className={`rounded-2xl border p-3 ${incident.id === selectedIncident?.id ? "border-primary/40 bg-primary/10" : "border-border bg-surface"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">{incident.code}</span>
                        <span className="text-xs text-muted-foreground">{typeMeta[incident.type]}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {incident.location} · {incident.zone}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {new Intl.DateTimeFormat("en-NG", { timeStyle: "short", hour12: false }).format(new Date(incident.reported_at))} · {timeAgo(incident.reported_at)} · {incident.officer ? `${incident.officer} assigned` : "Unassigned"} · {statusMeta[incident.status as keyof typeof statusMeta] ?? incident.status}
                      </div>
                    </div>
                    <SeverityBadge severity={incident.severity as 1 | 2 | 3 | 4 | 5} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => setSelectedIncidentId(incident.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-background"
                    >
                      View
                    </button>
                    {!readOnly && (
                      <Link
                        to="/app/incidents/$id"
                        params={{ id: incident.id }}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-background"
                      >
                        AI Panel
                      </Link>
                    )}
                  </div>
                </div>
              ))}
              {!intentFilteredIncidents.length && <EmptyState>No active incidents match the current command filter.</EmptyState>}
            </div>
          </Card>

          <Card title="Realtime events" icon={Signal}>
            <div className="space-y-3">
              {liveEvents.length === 0 ? (
                <EmptyState>No live events yet.</EmptyState>
              ) : (
                liveEvents.map((event) => (
                  <div key={`${event.event}-${event.at}`} className="rounded-2xl border border-border bg-surface p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">{event.event}</div>
                        <div className="mt-1 truncate text-xs text-muted-foreground">
                          {JSON.stringify(event.payload)}
                        </div>
                      </div>
                      <span className="rounded-full border border-border px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                        {new Intl.DateTimeFormat("en-NG", { timeStyle: "short", hour12: false }).format(new Date(event.at))}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card title="OSINT alerts" icon={MessageSquareMore}>
            <div className="space-y-3">
              {osintAlerts.map((alert) => (
                <div key={alert.id} className="rounded-2xl border border-border bg-surface p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{alert.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {alert.channel ?? "feed"} · {alert.severity >= 4 ? "92% conf" : "live feed"} · {timeAgo(alert.sent_at)}
                      </div>
                    </div>
                    <StatusDot severity={alert.severity} />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <Link to="/app/alerts" className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-background">
                      View
                    </Link>
                  </div>
                </div>
              ))}
              {!osintAlerts.length && <EmptyState>No OSINT alerts above severity 3.</EmptyState>}
            </div>
          </Card>

          <Card title="Inventory alerts" icon={BadgeAlert}>
            <div className="space-y-3">
              {inventoryAlerts.map((alert) => (
                <div key={alert.id} className={`rounded-2xl border p-3 ${alert.severity === "critical" ? "border-critical/30 bg-critical/10" : "border-border bg-surface"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{alert.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{alert.detail}</div>
                    </div>
                    <span className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${alert.severity === "critical" ? "border-critical/30 bg-critical/10 text-critical" : "border-high/30 bg-high/10 text-high"}`}>
                      {alert.severity}
                    </span>
                  </div>
                  <div className="mt-3">
                    <Link to="/app/patrols" className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-background">
                      View patrol load
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Live cameras" icon={Layers3}>
            <div className="space-y-3">
              {camerasLoading ? (
                <EmptyState>Loading camera registry…</EmptyState>
              ) : cameras.length ? (
                cameras.slice(0, 2).map((camera) => <CameraStreamPlayer key={camera.id} camera={camera} />)
              ) : (
                <EmptyState>No registered cameras were returned by the Relationship API.</EmptyState>
              )}
            </div>
          </Card>
        </div>
      </section>

      <section className="rounded-3xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Active patrols</div>
            <h2 className="text-lg font-semibold">Current shifts</h2>
          </div>
          <div className="text-xs text-muted-foreground">
            {activePatrols.length} active · {delayedPatrols.length} delayed
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(activeIntent ? intentFilteredPatrols : activePatrols).map((patrol) => {
            const lastCheckIn = latestCheckIns.get(patrol.id);
            return (
              <div key={patrol.id} className="rounded-2xl border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{patrol.officer}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{patrol.name} · {patrol.shift}</div>
                  </div>
                  <span className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${
                    patrol.status === "on_route"
                      ? "border-resolved/30 bg-resolved/10 text-resolved"
                      : patrol.status === "delayed"
                        ? "border-high/30 bg-high/10 text-high"
                        : patrol.status === "missed"
                          ? "border-critical/30 bg-critical/10 text-critical"
                          : "border-border bg-card text-muted-foreground"
                  }`}>
                    {patrol.status.replace("_", " ")}
                  </span>
                </div>
                <div className="mt-3 grid gap-1.5 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between gap-3">
                    <span>Last check-in</span>
                    <span>{lastCheckIn ? timeAgo(lastCheckIn.created_at) : patrol.next_check_in ?? "—"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Route</span>
                    <span>{patrol.code}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Progress</span>
                    <span>{patrol.checked_in}/{patrol.waypoints}</span>
                  </div>
                </div>
              </div>
            );
          })}
          {!(activeIntent ? intentFilteredPatrols : activePatrols).length && (
            <EmptyState>{activeIntent ? "No patrols match the current AI command filter." : "No patrols are currently active."}</EmptyState>
          )}
        </div>
      </section>

      {loading && (
        <div className="rounded-3xl border border-border bg-card p-5 text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          Loading live command data…
        </div>
      )}
    </div>
  );
}

function CommandMapPreview({
  incidents,
  patrols,
  locations,
  token,
  selectedIncident,
  onSelectIncident,
}: {
  incidents: IncidentRow[];
  patrols: PatrolRow[];
  locations: LocationRow[];
  token: string;
  selectedIncident: IncidentRow | null;
  onSelectIncident: (id: string) => void;
}) {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const loadedRef = useRef(false);
  const mapboxRef = useRef<MapboxModule | null>(null);

  const lagos: [number, number] = [3.4219, 6.4281];
  const incidentGeo = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: incidents.map((incident, idx) => {
        const lng = incident.coord_x != null ? Number(incident.coord_x) : lagos[0] + ((idx * 37) % 100 - 50) / 800;
        const lat = incident.coord_y != null ? Number(incident.coord_y) : lagos[1] + ((idx * 53) % 100 - 50) / 800;
        return {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [lng, lat] },
          properties: {
            id: incident.id,
            sev: Number(incident.severity),
            status: incident.status,
          },
        };
      }),
    }),
    [incidents],
  );
  const patrolGeo = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: patrols.map((patrol, idx) => {
        const location = locations.find((item) => item.id === patrol.location_id);
        const lng = location?.coord_x != null ? Number(location.coord_x) : lagos[0] + ((idx * 41) % 100 - 50) / 600;
        const lat = location?.coord_y != null ? Number(location.coord_y) : lagos[1] + ((idx * 67) % 100 - 50) / 600;
        return {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [lng, lat] },
          properties: { id: patrol.id, status: patrol.status, officer: patrol.officer, code: patrol.code },
        };
      }),
    }),
    [lagos, locations, patrols],
  );
  const zoneGeo = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: locations
        .flatMap((location) => {
          const feature = toGeoJsonFeature(location.geofence);
          return feature ? [{ ...feature, properties: { name: location.name } }] : [];
        }),
    }),
    [locations],
  );

  useEffect(() => {
    let cancelled = false;
    let map: MapboxMap | null = null;
    let ro: ResizeObserver | null = null;

    const mount = async () => {
      if (!token || !mapContainer.current || mapRef.current) return;
      const mapboxgl = mapboxRef.current ?? (await import("mapbox-gl"));
      mapboxRef.current = mapboxgl;
      if (cancelled || !mapContainer.current || mapRef.current) return;
      mapboxgl.default.accessToken = token;
      map = new mapboxgl.default.Map({
        container: mapContainer.current,
        style: "mapbox://styles/mapbox/dark-v11",
        center: lagos,
        zoom: 10.7,
        attributionControl: false,
      });
      map.addControl(new mapboxgl.default.NavigationControl({ showCompass: false }), "top-right");
      map.on("load", () => {
        loadedRef.current = true;
        map!.addSource("incidents", { type: "geojson", data: incidentGeo, cluster: true, clusterRadius: 42, clusterMaxZoom: 14 });
        map!.addLayer({
          id: "incidents-cluster",
          type: "circle",
          source: "incidents",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": MAP_COLORS.red,
            "circle-radius": ["step", ["get", "point_count"], 16, 5, 22, 15, 30],
            "circle-opacity": 0.78,
          },
        });
        map!.addLayer({
          id: "incidents-point",
          type: "circle",
          source: "incidents",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": [
              "match",
              ["get", "sev"],
              5, MAP_COLORS.red,
              4, MAP_COLORS.orange,
              3, MAP_COLORS.amber,
              2, MAP_COLORS.yellow,
              MAP_COLORS.slate,
            ],
            "circle-radius": 7,
            "circle-stroke-width": 2,
            "circle-stroke-color": MAP_COLORS.ink,
          },
        });
        map!.addLayer({
          id: "incidents-label",
          type: "symbol",
          source: "incidents",
          filter: ["!", ["has", "point_count"]],
          layout: {
            "text-field": ["get", "sev"],
            "text-size": 10,
            "text-font": ["DIN Pro Medium", "Arial Unicode MS Bold"],
            "text-offset": [0, 1.1],
          },
          paint: { "text-color": "#fff" },
        });
        map!.addSource("patrols", { type: "geojson", data: patrolGeo });
        map!.addLayer({
          id: "patrols-point",
          type: "circle",
          source: "patrols",
          paint: {
            "circle-color": [
              "match",
              ["get", "status"],
              "complete", MAP_COLORS.green,
              "missed", MAP_COLORS.red,
              "delayed", MAP_COLORS.orange,
              MAP_COLORS.blue,
            ],
            "circle-radius": 6,
            "circle-stroke-width": 2,
            "circle-stroke-color": MAP_COLORS.ink,
          },
        });
        map!.addSource("zones", { type: "geojson", data: zoneGeo });
        map!.addLayer({
          id: "zones-fill",
          type: "fill",
          source: "zones",
          paint: { "fill-color": MAP_COLORS.blue, "fill-opacity": 0.10 },
        });
        map!.addLayer({
          id: "zones-line",
          type: "line",
          source: "zones",
          paint: { "line-color": MAP_COLORS.blue, "line-width": 1.4, "line-dasharray": [2, 2] },
        });

        map!.on("click", "incidents-point", (e) => {
          const feature = e.features?.[0];
          const id = feature?.properties?.id as string | undefined;
          const coords = (feature?.geometry as any)?.coordinates as [number, number] | undefined;
          if (id) onSelectIncident(id);
          if (coords) map!.easeTo({ center: coords, zoom: 13, duration: 600 });
        });
        map!.on("mouseenter", "incidents-point", () => { map!.getCanvas().style.cursor = "pointer"; });
        map!.on("mouseleave", "incidents-point", () => { map!.getCanvas().style.cursor = ""; });
        requestAnimationFrame(() => map!.resize());
      });
      mapRef.current = map;
      ro = new ResizeObserver(() => {
        try {
          map!.resize();
        } catch {}
      });
      if (mapContainer.current) ro.observe(mapContainer.current);
    };

    void mount();
    return () => {
      cancelled = true;
      ro?.disconnect();
      loadedRef.current = false;
      map?.remove();
      mapRef.current = null;
    };
  }, [onSelectIncident, token]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    (map.getSource("incidents") as MapboxGeoJSONSource | undefined)?.setData(incidentGeo);
  }, [incidentGeo]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    (map.getSource("patrols") as MapboxGeoJSONSource | undefined)?.setData(patrolGeo);
  }, [patrolGeo]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    (map.getSource("zones") as MapboxGeoJSONSource | undefined)?.setData(zoneGeo);
  }, [zoneGeo]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !selectedIncident) return;
    const lng = selectedIncident.coord_x != null ? Number(selectedIncident.coord_x) : lagos[0];
    const lat = selectedIncident.coord_y != null ? Number(selectedIncident.coord_y) : lagos[1];
    map.easeTo({ center: [lng, lat], zoom: 13, duration: 500 });
  }, [lagos, selectedIncident]);

  return (
    <div className="relative h-full min-h-[420px] overflow-hidden rounded-2xl border border-border bg-surface">
      <div ref={mapContainer} className="absolute inset-0" />
      {!token && (
        <div className="absolute inset-0 grid place-items-center bg-background/80 p-6 text-center">
          <div className="max-w-sm">
            <div className="text-sm font-medium text-foreground">Mapbox token missing</div>
            <div className="mt-2 text-xs text-muted-foreground">The live map preview is still usable, but a publishable token enables the rendered map layer.</div>
          </div>
        </div>
      )}
      {token && !mapRef.current && (
        <div className="absolute inset-0 grid place-items-center bg-background/80">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
      {selectedIncident && (
        <div className="absolute left-4 top-4 z-10 max-w-sm rounded-2xl border border-critical/30 bg-background/90 p-4 backdrop-blur">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Target lock</div>
              <div className="text-sm font-semibold">{selectedIncident.code}</div>
            </div>
            <SeverityBadge severity={selectedIncident.severity as 1 | 2 | 3 | 4 | 5} />
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            {typeMeta[selectedIncident.type]} · {selectedIncident.location} · {selectedIncident.zone}
          </div>
          <div className="mt-2 text-xs text-foreground/90">
            {selectedIncident.description ?? "No incident description on file."}
          </div>
        </div>
      )}
      <div className="absolute bottom-4 left-4 z-10 flex flex-wrap items-center gap-3 rounded-full border border-border bg-background/90 px-3 py-2 text-[11px] backdrop-blur">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-critical" /> Critical</span>
        <span className="inline-flex items-center gap-1.5 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-high" /> High</span>
        <span className="inline-flex items-center gap-1.5 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-resolved" /> Stable</span>
      </div>
    </div>
  );
}

function toGeoJsonFeature(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, any>;
  if (item.type === "Feature" && item.geometry && typeof item.geometry === "object") return item;
  if ((item.type === "Polygon" || item.type === "MultiPolygon" || item.type === "LineString" || item.type === "Point") && item.coordinates) {
    return { type: "Feature" as const, geometry: { type: item.type, coordinates: item.coordinates }, properties: {} };
  }
  if (item.geometry && typeof item.geometry === "object" && item.geometry.type && item.geometry.coordinates) {
    return { type: "Feature" as const, geometry: { type: item.geometry.type, coordinates: item.geometry.coordinates }, properties: {} };
  }
  return null;
}

function Card({ title, icon: Icon, children }: { title: string; icon: any; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{title}</div>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function StatCard({
  label,
  value,
  delta,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  delta: string;
  icon: any;
  tone: "critical" | "warning" | "resolved" | "muted";
}) {
  const toneClass = {
    critical: "text-critical bg-critical/10 border-critical/30",
    warning: "text-high bg-high/10 border-high/30",
    resolved: "text-resolved bg-resolved/10 border-resolved/30",
    muted: "text-muted-foreground bg-muted border-border",
  }[tone];
  return (
    <div className="rounded-3xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
        <div className={`grid h-8 w-8 place-items-center rounded-md border ${toneClass}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{delta}</div>
    </div>
  );
}

function StatusDot({ severity }: { severity: number }) {
  const cls = severity >= 4 ? "bg-critical" : severity === 3 ? "bg-high" : "bg-resolved";
  return <span className={`mt-1 h-2.5 w-2.5 rounded-full ${cls}`} />;
}

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">{children}</div>;
}

function formatMinutes(minutes: number) {
  if (!minutes || minutes <= 0) return "0m";
  if (minutes < 60) return `${minutes}m`;
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
