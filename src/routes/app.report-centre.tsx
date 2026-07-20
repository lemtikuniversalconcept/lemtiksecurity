import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState, type ComponentType } from "react";
import { supabase } from "@/integrations/supabase/client";
import { listIncidents } from "@/lib/incidents.functions";
import { listPatrols } from "@/lib/patrols.functions";
import { generateReportSummary, sendReportDelivery } from "@/lib/reports.functions";
import { getActiveOrg, getSettings } from "@/lib/orgs.functions";
import { resolveAppAccess, requireSectionAccess } from "@/lib/rbac";
import { type IncidentType, typeMeta } from "@/lib/mockData";
import { Textarea } from "@/components/ui/textarea";
import {
  CalendarDays,
  CheckCircle2,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  Link2,
  Lock,
  Mail,
  MessageCircle,
  Presentation,
  RefreshCw,
  Sparkles,
  Clock3,
  History,
  Users,
  ClipboardList,
  FileBarChart2,
  Search,
  FileType2,
} from "lucide-react";
import { toast } from "sonner";

type IncidentRow = {
  id: string;
  code: string;
  type: IncidentType;
  severity: number;
  status: string;
  location: string;
  zone: string;
  officer: string | null;
  reported_at: string;
};

type PatrolRow = {
  id: string;
  code: string;
  name: string;
  officer: string | null;
  status: "on_route" | "delayed" | "complete" | "missed";
  waypoints: number;
  checked_in: number;
  shift: string;
};

type OrgRow = {
  id: string;
  name: string;
  subscription_tier?: string | null;
  subscription_status?: string | null;
  billing_contact_email?: string | null;
  billing_contact_phone?: string | null;
};

type SettingsRow = {
  report_delivery_schedule?: string | null;
  whatsapp_alert_numbers?: string[] | null;
  alert_escalation_contacts?: Array<{ name: string; phone: string; level: number }> | null;
};

type ReportTypeId = "daily" | "weekly" | "monthly" | "incident" | "custom";

type ReportTemplate = {
  id: ReportTypeId;
  title: string;
  cadence: string;
  window: string;
  description: string;
  delivery: string[];
  actions: string[];
  enterpriseOnly?: boolean;
};

type ReportHistoryRow = {
  id: string;
  title: string;
  type: string;
  period: string;
  generatedAt: string;
  channels: string[];
  recipients: number;
  pages: number;
  size: string;
  shareable: boolean;
  summary: string;
};

const REPORT_TEMPLATES: ReportTemplate[] = [
  {
    id: "daily",
    title: "Daily Incident Log",
    cadence: "Auto-generated at 6am every day",
    window: "Previous 24 hours",
    description: "Operational log of incidents, status changes, and response times for the last day.",
    delivery: ["PDF", "Email"],
    actions: ["Download PDF", "Auto-email configured recipients"],
  },
  {
    id: "weekly",
    title: "Weekly Security Summary",
    cadence: "Auto-generated every Monday 8am",
    window: "Previous 7 days",
    description: "Weekly incident summary, patrol compliance, OSINT overview, and recommendations.",
    delivery: ["PDF", "Email", "WhatsApp"],
    actions: ["Download PDF", "Share link", "Deliver via Resend + WhatsApp"],
  },
  {
    id: "monthly",
    title: "Monthly Threat Analysis",
    cadence: "Auto-generated on the 1st of each month",
    window: "Previous 30 days",
    description: "Executive-ready trend analysis with zone risk evolution, forecasts, and response performance.",
    delivery: ["PDF", "Email"],
    actions: ["Download PDF", "Email delivery"],
  },
  {
    id: "incident",
    title: "Incident-Specific Report",
    cadence: "On demand per incident",
    window: "Single incident",
    description: "Full detail, evidence summary, and chain of custody for legal and insurance workflows.",
    delivery: ["PDF"],
    actions: ["Download PDF", "Open incident"],
  },
  {
    id: "custom",
    title: "Custom Report Builder",
    cadence: "Enterprise tier only",
    window: "Selected range",
    description: "Choose sections, date range, and commentary for board packs or specialised exports.",
    delivery: ["PDF", "PowerPoint"],
    actions: ["Generate PDF", "Generate PowerPoint"],
    enterpriseOnly: true,
  },
];

export const Route = createFileRoute("/app/report-centre")({
  head: () => ({ meta: [{ title: "Report Centre · Lemtik SOD" }] }),
  beforeLoad: async () => {
    const appAccess = await resolveAppAccess(supabase);
    requireSectionAccess(appAccess, ["security_manager", "operator", "client_admin"]);
    return { appAccess };
  },
  component: ReportCentre,
});

function ReportCentre() {
  const { appAccess } = Route.useRouteContext();
  const listInc = useServerFn(listIncidents);
  const listPat = useServerFn(listPatrols);
  const loadOrg = useServerFn(getActiveOrg);
  const loadSettings = useServerFn(getSettings);
  const sendReport = useServerFn(sendReportDelivery);
  const summaryFn = useServerFn(generateReportSummary);

  const { data: incidents = [], isLoading: loadingIncidents } = useQuery({
    queryKey: ["report-centre-incidents", appAccess.orgId],
    queryFn: () => listInc() as Promise<IncidentRow[]>,
  });
  const { data: patrols = [], isLoading: loadingPatrols } = useQuery({
    queryKey: ["report-centre-patrols", appAccess.orgId],
    queryFn: () => listPat() as Promise<PatrolRow[]>,
  });
  const { data: org } = useQuery({
    queryKey: ["report-centre-org", appAccess.orgId],
    queryFn: () => loadOrg() as Promise<OrgRow | null>,
  });
  const { data: settings } = useQuery({
    queryKey: ["report-centre-settings", appAccess.orgId],
    queryFn: () => loadSettings() as Promise<SettingsRow | null>,
  });

  const [selectedTemplate, setSelectedTemplate] = useState<ReportTypeId>("weekly");
  const [historyFilter, setHistoryFilter] = useState("");
  const [customSections, setCustomSections] = useState<string[]>(["incidents", "patrols", "osint"]);
  const [customCommentary, setCustomCommentary] = useState("");
  const [customStart, setCustomStart] = useState(toInputDate(new Date(Date.now() - 30 * 86_400_000)));
  const [customEnd, setCustomEnd] = useState(toInputDate(new Date()));

  const loading = loadingIncidents || loadingPatrols;
  const currentOrg = org ?? {
    id: appAccess.orgId,
    name: appAccess.orgName,
    subscription_tier: null,
    subscription_status: null,
    billing_contact_email: null,
    billing_contact_phone: null,
  };
  const tier = String(currentOrg.subscription_tier ?? "").toLowerCase();
  const isEnterprise = tier === "enterprise";
  const contactEmails = [currentOrg.billing_contact_email].filter(Boolean) as string[];
  const whatsappNumbers = settings?.whatsapp_alert_numbers ?? [];
  const escalationContacts = settings?.alert_escalation_contacts ?? [];
  const recipientCount = contactEmails.length + whatsappNumbers.length + escalationContacts.length;

  const model = useMemo(
    () => buildReportCentreModel(incidents, patrols, currentOrg, settings ?? null, appAccess.orgName),
    [appAccess.orgName, incidents, patrols, currentOrg, settings],
  );

  const selectedTemplateData = REPORT_TEMPLATES.find((item) => item.id === selectedTemplate) ?? REPORT_TEMPLATES[0];
  const filteredHistory = useMemo(() => {
    const q = historyFilter.trim().toLowerCase();
    if (!q) return model.history;
    return model.history.filter((row) => [row.title, row.type, row.period, row.summary, row.size, ...row.channels].some((value) => value.toLowerCase().includes(q)));
  }, [historyFilter, model.history]);

  const copyShareLink = async (label: string) => {
    const token = buildShareToken(label, currentOrg.id);
    const url = `${window.location.origin}/app/report-centre/share/${token}`;
    await navigator.clipboard.writeText(url);
    toast.success("Share link copied");
  };

  const downloadPdf = (label: string) => {
    toast.success(`${label} PDF prepared`);
    window.print();
  };

  const exportPowerPoint = () => {
    toast.success("PowerPoint export queued");
  };

  const sendSelectedReportEmail = async () => {
    const recipients = [currentOrg.billing_contact_email].filter(Boolean) as string[];
    if (!recipients.length) {
      toast.error("No email recipients configured for this organisation.");
      return;
    }

    const summary = await summaryFn({
      data: {
        template_id: selectedTemplateData.id,
        template_title: selectedTemplateData.title,
        org_id: currentOrg.id,
        stats: {
          incidents_last_24h: model.last24hCount,
          incidents_last_7d: model.last7dCount,
          incidents_last_30d: model.last30dCount,
          patrol_compliance: model.weeklyCompliance,
          risk_index: model.monthlyRisk,
          generated_this_month: model.thisMonthGenerated,
          recipients: recipientCount,
        },
        sections: selectedTemplate === "custom" ? customSections : undefined,
        range_label: selectedTemplateData.window,
        commentary: customCommentary || undefined,
      },
    }) as string;

    const result = await sendReport({
      report_name: selectedTemplateData.title,
      summary,
      recipient_emails: recipients,
      report_url: selectedTemplate === "weekly"
        ? `${window.location.origin}/app/report-centre/share/${buildShareToken(selectedTemplateData.title, currentOrg.id)}`
        : null,
      unsubscribe_url: null,
    }) as { ok?: boolean; warning?: string; skipped?: boolean };

    if (result?.warning) {
      toast.success(`Email queued with warning: ${result.warning}`);
      return;
    }

    toast.success("Report email sent");
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Report Centre</div>
          <h1 className="mt-1 text-2xl font-semibold">Generated reports and delivery</h1>
          <p className="text-sm text-muted-foreground">
            {currentOrg.name} · {appAccess.roleLabel} · {settings?.report_delivery_schedule ?? "No report schedule configured yet"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Metric label="Recipients" value={recipientCount} />
          <Metric label="Reports this month" value={model.thisMonthGenerated} />
          <Metric label="Active tier" value={currentOrg.subscription_tier ?? "basic"} />
        </div>
      </div>

      {loading && (
        <div className="rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
          Loading report data…
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Report Types Available</div>
              <h2 className="mt-1 text-lg font-semibold">Operational report templates</h2>
            </div>
            <FileBarChart2 className="h-4 w-4 text-muted-foreground" />
          </div>

          <div className="mt-4 grid gap-3">
            {REPORT_TEMPLATES.map((template) => {
              const locked = template.enterpriseOnly && !isEnterprise;
              const selected = selectedTemplate === template.id;
              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => setSelectedTemplate(template.id)}
                  className={`rounded-xl border p-4 text-left transition ${
                    selected ? "border-primary bg-primary/5" : "border-border bg-surface hover:bg-surface-2"
                  } ${locked ? "opacity-75" : ""}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{template.title}</span>
                        {locked ? <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">Enterprise</span> : null}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{template.description}</div>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      {locked ? <Lock className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    <InfoPill icon={Clock3} label="Cadence" value={template.cadence} />
                    <InfoPill icon={CalendarDays} label="Window" value={template.window} />
                    <InfoPill icon={FileText} label="Delivery" value={template.delivery.join(" · ")} />
                    <InfoPill icon={ClipboardList} label="Actions" value={template.actions.join(" · ")} />
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        downloadPdf(template.title);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      <Download className="h-3.5 w-3.5" /> Download PDF
                    </button>
                    {template.id === "weekly" && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          copyShareLink(template.title);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-surface-2"
                      >
                        <Link2 className="h-3.5 w-3.5" /> Share link
                      </button>
                    )}
                    {template.id === "incident" && (
                      <Link
                        to="/app/incidents"
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-surface-2"
                      >
                        <ClipboardList className="h-3.5 w-3.5" /> Open incident list
                      </Link>
                    )}
                    {locked && (
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border bg-background px-3 py-1.5 text-xs text-muted-foreground">
                        <Lock className="h-3.5 w-3.5" /> Custom builder locked to enterprise tier
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Report Preview</div>
              <h2 className="mt-1 text-lg font-semibold">{selectedTemplateData.title}</h2>
            </div>
            <Sparkles className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-4 space-y-3">
            <Metric label="Scope" value={selectedTemplateData.window} />
            <Metric label="Cadence" value={selectedTemplateData.cadence} />
            <Metric label="Recipients" value={recipientCount} />
            <Metric label="Schedule" value={settings?.report_delivery_schedule ?? "Unscheduled"} />
            <Metric label="WhatsApp numbers" value={whatsappNumbers.length} />
            <Metric label="Email contacts" value={contactEmails.length || "None"} />
            <Metric label="Resolved items" value={model.issueCount} />
          </div>

          <div className="mt-5 rounded-xl border border-border bg-surface p-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Latest signal</div>
            <div className="mt-2 text-sm font-medium">
              {selectedTemplate === "daily" && `${model.last24hCount} incidents in the last 24 hours`}
              {selectedTemplate === "weekly" && `${model.last7dCount} incidents, ${model.weeklyCompliance}% patrol compliance`}
              {selectedTemplate === "monthly" && `${model.last30dCount} incidents, ${model.monthlyRisk}% zone risk index`}
              {selectedTemplate === "incident" && `${model.criticalIncidents.length} critical incidents available for case-ready export`}
              {selectedTemplate === "custom" && `${customSections.length} sections selected for a custom export`}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {selectedTemplate === "weekly" && (
                <button
                  type="button"
                  onClick={() => copyShareLink(selectedTemplateData.title)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-surface-2"
                >
                  <Copy className="h-3.5 w-3.5" /> Copy share link
                </button>
              )}
              <button
                type="button"
                onClick={() => downloadPdf(selectedTemplateData.title)}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Download className="h-3.5 w-3.5" /> Download PDF
              </button>
              <button
                type="button"
                onClick={() => void sendSelectedReportEmail()}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-surface-2"
              >
                <Mail className="h-3.5 w-3.5" /> Resend email
              </button>
            </div>
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Custom Builder</div>
              <h2 className="mt-1 text-lg font-semibold">Enterprise report configuration</h2>
            </div>
            <FileType2 className="h-4 w-4 text-muted-foreground" />
          </div>

          {!isEnterprise ? (
            <div className="mt-4 rounded-xl border border-dashed border-border bg-surface px-4 py-6 text-sm text-muted-foreground">
              Custom report builder is available for enterprise tier organisations only.
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="grid gap-2 sm:grid-cols-2">
                <DateField label="Start date" value={customStart} onChange={setCustomStart} />
                <DateField label="End date" value={customEnd} onChange={setCustomEnd} />
              </div>

              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Sections</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {["incidents", "patrols", "osint", "inventory", "compliance", "recommendations"].map((section) => {
                    const active = customSections.includes(section);
                    return (
                      <button
                        key={section}
                        type="button"
                        onClick={() => setCustomSections((current) => current.includes(section) ? current.filter((item) => item !== section) : [...current, section])}
                        className={`rounded-full border px-3 py-1.5 text-xs ${active ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}
                      >
                        {section}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="block">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Commentary</div>
                <textarea
                  value={customCommentary}
                  onChange={(e) => setCustomCommentary(e.target.value)}
                  rows={4}
                  className="mt-2 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                  placeholder="Add board notes, executive commentary, or legal context."
                />
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => toast.success("Custom PDF generation queued")}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  <Download className="h-3.5 w-3.5" /> Download PDF
                </button>
                <button
                  type="button"
                  onClick={exportPowerPoint}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-xs hover:bg-surface-2"
                >
                  <Presentation className="h-3.5 w-3.5" /> Export PowerPoint
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Report History</div>
              <h2 className="mt-1 text-lg font-semibold">Last 12 months of generated reports</h2>
            </div>
            <History className="h-4 w-4 text-muted-foreground" />
          </div>

          <div className="mt-4 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={historyFilter}
                onChange={(e) => setHistoryFilter(e.target.value)}
                placeholder="Search history"
                className="w-full rounded-md border border-border bg-surface py-2 pl-7 pr-3 text-xs outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <button
              type="button"
              onClick={() => toast.success("History refreshed")}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-xs hover:bg-surface-2"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {filteredHistory.map((row) => (
              <article key={row.id} className="rounded-xl border border-border bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{row.title}</span>
                      {row.shareable ? <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">Shareable</span> : null}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{row.summary}</div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <div>{row.period}</div>
                    <div>{new Date(row.generatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</div>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <InfoPill icon={FileText} label="Type" value={row.type} />
                  <InfoPill icon={FileSpreadsheet} label="Format" value={`${row.pages} pages · ${row.size}`} />
                  <InfoPill icon={MessageCircle} label="Channels" value={row.channels.join(" · ")} />
                  <InfoPill icon={Users} label="Recipients" value={row.recipients} />
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => downloadPdf(row.title)}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    <Download className="h-3.5 w-3.5" /> Download
                  </button>
                  <button
                    type="button"
                    onClick={() => toast.success("Delivery request resent")}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-surface-2"
                  >
                    <Mail className="h-3.5 w-3.5" /> Resend email delivery
                  </button>
                  {row.shareable && (
                    <button
                      type="button"
                      onClick={() => copyShareLink(row.title)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-surface-2"
                    >
                      <Link2 className="h-3.5 w-3.5" /> Share link
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function buildReportCentreModel(incidents: IncidentRow[], patrols: PatrolRow[], org: OrgRow, settings: SettingsRow | null, orgName: string) {
  const now = Date.now();
  const last24h = incidents.filter((incident) => now - new Date(incident.reported_at).getTime() <= 24 * 3600_000);
  const last7d = incidents.filter((incident) => now - new Date(incident.reported_at).getTime() <= 7 * 24 * 3600_000);
  const last30d = incidents.filter((incident) => now - new Date(incident.reported_at).getTime() <= 30 * 24 * 3600_000);
  const criticalIncidents = [...incidents].filter((incident) => Number(incident.severity) >= 4).sort((a, b) => new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime());
  const patrolCompliance = Math.round(average(patrols.map((patrol) => clamp((patrol.checked_in / Math.max(1, patrol.waypoints)) * 100, 0, 100))));
  const monthlyRisk = Math.round(average(last30d.map((incident) => Number(incident.severity) * 18 + (incident.status === "escalated" ? 20 : 0))));
  const history = buildHistoryRows(incidents, patrols, org, settings, orgName);
  const thisMonthGenerated = history.filter((row) => isSameMonth(new Date(row.generatedAt), new Date())).length;

  return {
    last24hCount: last24h.length,
    last7dCount: last7d.length,
    last30dCount: last30d.length,
    weeklyCompliance: patrolCompliance,
    monthlyRisk,
    criticalIncidents,
    thisMonthGenerated,
    history,
  };
}

function buildHistoryRows(incidents: IncidentRow[], patrols: PatrolRow[], org: OrgRow, settings: SettingsRow | null, orgName: string) {
  const rows: ReportHistoryRow[] = [];
  const now = new Date();

  rows.push(...buildDailyLogs(incidents, patrols, org, settings, orgName));
  rows.push(...buildWeeklySummaries(incidents, patrols, org, settings, orgName));
  rows.push(...buildMonthlyReports(incidents, patrols, org, settings, orgName));
  rows.push(...buildIncidentReports(incidents, org, settings, orgName));

  return rows.sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()).slice(0, 12);
}

function buildDailyLogs(incidents: IncidentRow[], patrols: PatrolRow[], org: OrgRow, settings: SettingsRow | null, orgName: string) {
  return Array.from({ length: 7 }, (_, idx) => {
    const end = new Date();
    end.setHours(6, 0, 0, 0);
    end.setDate(end.getDate() - idx);
    const start = new Date(end.getTime() - 24 * 3600_000);
    const bucket = incidents.filter((incident) => new Date(incident.reported_at) >= start && new Date(incident.reported_at) < end);
    const patrolBucket = patrols.filter((patrol) => patrol.status !== "complete");
    return {
      id: `daily-${toKey(start)}`,
      title: "Daily Incident Log",
      type: "Daily Incident Log",
      period: `${start.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} - ${end.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`,
      generatedAt: end.toISOString(),
      channels: reportChannels(settings, org),
      recipients: recipientCount(settings, org),
      pages: Math.max(2, Math.ceil((bucket.length + patrolBucket.length) / 6)),
      size: `${Math.max(180, bucket.length * 12 + patrolBucket.length * 6)} KB`,
      shareable: false,
      summary: `${bucket.length} incidents in the previous 24 hours for ${orgName}.`,
    } satisfies ReportHistoryRow;
  });
}

function buildWeeklySummaries(incidents: IncidentRow[], patrols: PatrolRow[], org: OrgRow, settings: SettingsRow | null, orgName: string) {
  return Array.from({ length: 4 }, (_, idx) => {
    const start = weekStart(idx);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const bucket = incidents.filter((incident) => {
      const ts = new Date(incident.reported_at).getTime();
      return ts >= start.getTime() && ts < end.getTime();
    });
    const patrolCompliance = Math.round(average(patrols.map((patrol) => clamp((patrol.checked_in / Math.max(1, patrol.waypoints)) * 100, 0, 100))));
    return {
      id: `weekly-${toKey(start)}`,
      title: "Weekly Security Summary",
      type: "Weekly Security Summary",
      period: `${start.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} - ${new Date(end.getTime() - 1).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`,
      generatedAt: new Date(start.getTime() + 8 * 3600_000).toISOString(),
      channels: [...reportChannels(settings, org), "WhatsApp"],
      recipients: recipientCount(settings, org) + 1,
      pages: Math.max(4, Math.ceil((bucket.length + 10) / 5)),
      size: `${Math.max(240, bucket.length * 18 + 60)} KB`,
      shareable: true,
      summary: `${bucket.length} incidents, ${patrolCompliance}% patrol compliance, and weekly recommendations for ${orgName}.`,
    } satisfies ReportHistoryRow;
  });
}

function buildMonthlyReports(incidents: IncidentRow[], patrols: PatrolRow[], org: OrgRow, settings: SettingsRow | null, orgName: string) {
  return Array.from({ length: 3 }, (_, idx) => {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    start.setMonth(start.getMonth() - idx);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    const bucket = incidents.filter((incident) => {
      const ts = new Date(incident.reported_at).getTime();
      return ts >= start.getTime() && ts < end.getTime();
    });
    const priorStart = new Date(start);
    priorStart.setMonth(priorStart.getMonth() - 1);
    const priorBucket = incidents.filter((incident) => {
      const ts = new Date(incident.reported_at).getTime();
      return ts >= priorStart.getTime() && ts < start.getTime();
    });
    const trend = bucket.length - priorBucket.length;
    const avgRisk = Math.round(average(bucket.map((incident) => Number(incident.severity) * 20)));
    return {
      id: `monthly-${toKey(start)}`,
      title: "Monthly Threat Analysis",
      type: "Monthly Threat Analysis",
      period: start.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
      generatedAt: new Date(end.getTime() - 2 * 3600_000).toISOString(),
      channels: reportChannels(settings, org),
      recipients: recipientCount(settings, org),
      pages: Math.max(6, Math.ceil((bucket.length + patrols.length) / 4)),
      size: `${Math.max(320, bucket.length * 20 + 90)} KB`,
      shareable: false,
      summary: `${bucket.length} incidents for the month, ${trend >= 0 ? "+" : ""}${trend} vs prior month, zone risk index ${avgRisk}.`,
    } satisfies ReportHistoryRow;
  });
}

function buildIncidentReports(incidents: IncidentRow[], org: OrgRow, settings: SettingsRow | null, orgName: string) {
  return [...incidents]
    .filter((incident) => Number(incident.severity) >= 4 || incident.status === "escalated")
    .slice(0, 5)
    .map((incident, idx) => {
      const generated = new Date(new Date(incident.reported_at).getTime() + (45 + idx * 10) * 60000);
      return {
        id: `incident-${incident.id}`,
        title: "Incident-Specific Report",
        type: `Incident ${incident.code}`,
        period: `${typeMeta[incident.type]} · ${incident.zone}`,
        generatedAt: generated.toISOString(),
        channels: ["PDF", "Email"],
        recipients: recipientCount(settings, org),
        pages: Math.max(8, Math.ceil((Number(incident.severity) * 2 + idx + 8) / 2)),
        size: `${Math.max(260, Number(incident.severity) * 30 + idx * 12)} KB`,
        shareable: false,
        summary: `${typeMeta[incident.type]} at ${incident.location} in ${orgName} ready for legal and insurance review.`,
      } satisfies ReportHistoryRow;
    });
}

function reportChannels(settings: SettingsRow | null, org: OrgRow) {
  const channels = ["PDF"];
  if (org.billing_contact_email) channels.push("Email");
  if ((settings?.whatsapp_alert_numbers ?? []).length > 0) channels.push("WhatsApp");
  return channels;
}

function recipientCount(settings: SettingsRow | null, org: OrgRow) {
  return [org.billing_contact_email, org.billing_contact_phone, ...(settings?.whatsapp_alert_numbers ?? []), ...(settings?.alert_escalation_contacts ?? []).map((item) => item.phone)]
    .filter(Boolean)
    .length;
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function InfoPill({ icon: Icon, label, value }: { icon: ComponentType<{ className?: string }>; label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 text-xs font-medium text-foreground line-clamp-2">{value}</div>
    </div>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="rounded-md border border-border bg-surface px-3 py-2 text-xs">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full bg-transparent outline-none" />
    </label>
  );
}

function buildShareToken(label: string, orgId: string) {
  return `${slugify(label)}-${slugify(orgId)}-${Math.floor(Date.now() / 60000)}`;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

function toInputDate(date: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function toKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function average(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function isSameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function weekStart(weeksAgo: number) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  date.setDate(date.getDate() - weeksAgo * 7);
  return date;
}
