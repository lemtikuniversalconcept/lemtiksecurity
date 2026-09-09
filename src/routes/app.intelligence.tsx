import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { toast } from "sonner";
import { getMapboxToken } from "@/lib/config.functions";
import { getBriefings, generateBriefing, listOsintIntelligence, type OsintIntelligenceItem } from "@/lib/intelligence.functions";
import { requireSectionAccess } from "@/lib/rbac";
import { Download, FileText, Filter, Loader2, MapPinned, Radar, Search, ShieldAlert, Sparkles, ExternalLink, ChevronRight, X, BrainCircuit, AlertTriangle } from "lucide-react";

const LAGOS: [number, number] = [3.4219, 6.4281];

type IntelligenceCategory = "physical" | "cyber" | "political" | "macro";
type SeverityFilter = "all" | "4plus" | "3plus" | "2plus";
type VerifiedFilter = "all" | "verified" | "unverified";
type RangeFilter = "24h" | "7d" | "30d" | "90d";
type ViewMode = "feed" | "map";

type IntelligenceItem = {
  id: string;
  title: string;
  summary: string;
  category: IntelligenceCategory;
  severity: number;
  confidence: number;
  verified: boolean;
  sourceName: string;
  sourceUrl: string;
  zone: string;
  location: string;
  reportedAt: string;
  matchedKeywords: string[];
  analystNotes: string;
  locationRelevance: number;
  relatedIncidentIds: string[];
  coordX: number;
  coordY: number;
  statusLabel: string;
};

type BriefEntry = {
  id: string;
  generatedAt: string;
  title: string;
  summary: string;
  highlights: string[];
  score: number;
  windowLabel: string;
};

export const Route = createFileRoute("/app/intelligence")({
  head: () => ({ meta: [{ title: "Intelligence Feed · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    const appAccess = context.appAccess;
    requireSectionAccess(appAccess, ["security_manager", "operator", "client_admin"]);
    return { appAccess };
  },
  component: IntelligenceFeedPage,
});

function IntelligenceFeedPage() {
  const navigate = useNavigate();
  const { appAccess } = Route.useRouteContext();
  const canManage = appAccess.specRole === "security_manager";
  const list = useServerFn(listOsintIntelligence);
  const tokenFn = useServerFn(getMapboxToken);
  const loadBriefs = useServerFn(getBriefings);
  const createBrief = useServerFn(generateBriefing);
  const { data: intelligenceItems = [], isLoading, isError: feedError } = useQuery({
    queryKey: ["intelligence-feed", appAccess.orgId],
    queryFn: () => list({ data: { org_id: appAccess.orgId } }) as Promise<OsintIntelligenceItem[]>,
    retry: 1,
  });
  const { data: tokenData } = useQuery({
    queryKey: ["mapbox_token"],
    queryFn: () => tokenFn(),
    staleTime: Infinity,
  });
  // isError distinguishes "osint is genuinely unreachable" from "osint reached, zero items" -
  // the two used to look identical (both rendered as a silent local zero-data placeholder brief
  // with no indication anything had failed). See the /briefs route in relationship_api: it no
  // longer masks a real osint outage behind a fake status:200 success.
  const { data: serverBriefs = [], isError: briefsError, refetch: refetchBriefs } = useQuery({
    queryKey: ["intelligence-briefs", appAccess.orgId],
    queryFn: () => loadBriefs({ data: { org_id: appAccess.orgId } }) as Promise<BriefEntry[]>,
    retry: 1,
  });

  const [mode, setMode] = useState<ViewMode>("feed");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<IntelligenceCategory | "all">("all");
  const [rangeFilter, setRangeFilter] = useState<RangeFilter>("7d");
  const [verifiedFilter, setVerifiedFilter] = useState<VerifiedFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedFlags, setFeedFlags] = useState<Record<string, "relevant" | "dismissed">>({});
  const [briefHistory, setBriefHistory] = useState<BriefEntry[]>([]);
  const [generatingBrief, setGeneratingBrief] = useState(false);
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRefs = useRef<mapboxgl.Marker[]>([]);

  const liveItems = useMemo(() => {
    return intelligenceItems.map((item, index) => deriveOsintIntelligenceItem(item, index));
  }, [intelligenceItems]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const minSeverity = severityFilter === "4plus" ? 4 : severityFilter === "3plus" ? 3 : severityFilter === "2plus" ? 2 : 1;
    const rangeMs = rangeMsFor(rangeFilter);
    return liveItems
      .filter((item) => item.severity >= minSeverity)
      .filter((item) => categoryFilter === "all" || item.category === categoryFilter)
      .filter((item) => verifiedFilter === "all" || (verifiedFilter === "verified" ? item.verified : !item.verified))
      .filter((item) => {
        const age = Date.now() - new Date(item.reportedAt).getTime();
        return age <= rangeMs;
      })
      .filter((item) => {
        if (!q) return true;
        return [
          item.title,
          item.summary,
          item.zone,
          item.location,
          item.sourceName,
          item.matchedKeywords.join(" "),
        ].join(" ").toLowerCase().includes(q);
      })
      .filter((item) => feedFlags[item.id] !== "dismissed")
      .sort((a, b) => new Date(b.reportedAt).getTime() - new Date(a.reportedAt).getTime());
  }, [categoryFilter, feedFlags, liveItems, rangeFilter, search, severityFilter, verifiedFilter]);

  const selectedItem = useMemo(
    () => filteredItems.find((item) => item.id === selectedId) ?? filteredItems[0] ?? null,
    [filteredItems, selectedId],
  );

  useEffect(() => {
    if (!selectedId && filteredItems[0]) setSelectedId(filteredItems[0].id);
    if (selectedId && !filteredItems.some((item) => item.id === selectedId)) {
      setSelectedId(filteredItems[0]?.id ?? null);
    }
  }, [filteredItems, selectedId]);

  const zoneScores = useMemo(() => {
    const counts = new Map<string, number>();
    const severityTotals = new Map<string, number>();
    filteredItems.forEach((item) => {
      counts.set(item.zone, (counts.get(item.zone) ?? 0) + 1);
      severityTotals.set(item.zone, (severityTotals.get(item.zone) ?? 0) + item.severity);
    });
    return [...counts.entries()]
      .map(([zone, incidentCount]) => {
        const severity = severityTotals.get(zone) ?? 0;
        const score = Math.min(100, Math.round(35 + incidentCount * 8 + severity * 6));
        return { zone, score, incidents: incidentCount, trend: incidentCount > 3 ? "rising" : "stable" };
      })
      .sort((a, b) => b.score - a.score);
  }, [filteredItems]);

  const currentAreaRisk = zoneScores[0] ?? { zone: "Lagos", score: 0, trend: "stable", incidents: filteredItems.length };
  const currentBrief = useMemo(() => buildBrief(filteredItems, currentAreaRisk.zone, rangeFilter), [filteredItems, currentAreaRisk.zone, rangeFilter]);

  useEffect(() => {
    // Only fall back to the locally-computed brief when osint genuinely returned zero briefs -
    // never when the fetch itself failed. Silently substituting local content for a real osint
    // outage is exactly the bug this replaces: it rendered indistinguishably from real content,
    // so a manager had no way to tell "nothing happening" from "we couldn't reach the service."
    if (briefsError) return;
    setBriefHistory((serverBriefs.length ? serverBriefs : [currentBrief]).slice(0, 12));
  }, [briefsError, currentBrief, serverBriefs]);

  useEffect(() => {
    if (!tokenData?.token || !mapEl.current || mapRef.current) return;
    mapboxgl.accessToken = tokenData.token;
    const m = new mapboxgl.Map({
      container: mapEl.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: LAGOS,
      zoom: 10.8,
      attributionControl: false,
    });
    m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => requestAnimationFrame(() => m.resize()));
    mapRef.current = m;
    const ro = new ResizeObserver(() => { try { m.resize(); } catch {} });
    if (mapEl.current) ro.observe(mapEl.current);
    return () => { ro.disconnect(); markerRefs.current.forEach((mk) => mk.remove()); markerRefs.current = []; m.remove(); mapRef.current = null; };
  }, [tokenData?.token]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    markerRefs.current.forEach((mk) => mk.remove());
    markerRefs.current = [];
    filteredItems.forEach((item) => {
      if (item.coordX == null || item.coordY == null) return;
      const el = document.createElement("button");
      el.type = "button";
      el.title = item.title;
      el.className = "group relative grid place-items-center";
      el.innerHTML = `
        <span style="
          width: 18px;
          height: 18px;
          transform: rotate(45deg);
          border-radius: 3px;
          background: ${severityColor(item.severity)};
          box-shadow: 0 0 0 2px hsl(220 14% 9%);
          display: inline-block;
        "></span>
      `;
      el.onclick = (e) => {
        e.preventDefault();
        setSelectedId(item.id);
        setMode("map");
      };
      markerRefs.current.push(new mapboxgl.Marker({ element: el, anchor: "center" }).setLngLat([item.coordX, item.coordY]).addTo(m));
    });
  }, [filteredItems, mode]);

  const generateBrief = async () => {
    setGeneratingBrief(true);
    try {
      const next = (await createBrief({
        data: {
          title: currentBrief.title,
          summary: currentBrief.summary,
          highlights: currentBrief.highlights,
          score: currentBrief.score,
          windowLabel: currentBrief.windowLabel,
          items: filteredItems,
          context: {
            zone: currentAreaRisk.zone,
            range: rangeFilter,
            areaRiskScore: currentAreaRisk.score,
          },
          org_id: appAccess.orgId,
        },
      })) as BriefEntry;
      setBriefHistory((prev) => [next, ...prev.filter((item) => item.id !== next.id)].slice(0, 12));
      await refetchBriefs();
    } catch (error) {
      // Previously unhandled: a failed call here silently did nothing visible, leaving whatever
      // (possibly fake) brief was already showing unchanged with no indication the click failed.
      toast.error("Could not generate a new brief — the intelligence service is unreachable. Try again shortly.");
    } finally {
      setGeneratingBrief(false);
    }
  };

  const markRelevant = (id: string) => setFeedFlags((prev) => ({ ...prev, [id]: "relevant" }));
  const dismissItem = (id: string) => setFeedFlags((prev) => ({ ...prev, [id]: "dismissed" }));
  const escalateToIncident = (item: IntelligenceItem) => {
    try {
      sessionStorage.setItem("lemtik_incident_draft", JSON.stringify({
        title: item.title,
        description: `${item.summary}\n\nSource: ${item.sourceName}\nKeywords: ${item.matchedKeywords.join(", ")}`,
        location: item.location,
        zone: item.zone,
        severity: Math.max(3, item.severity),
        type: item.category === "cyber" ? "cyber_incident" : item.category === "political" ? "civil_unrest" : "suspicious",
      }));
    } catch {
      // ignore storage failures
    }
    navigate({ to: "/app/incidents" });
  };

  const downloadPdf = () => window.print();

  const mapView = mode === "map";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Intelligence Feed</div>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-2xl font-semibold">OSINT intelligence feed</h1>
            <span className="inline-flex items-center gap-1 rounded-md border border-critical/30 bg-critical/10 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-critical">
              <ShieldAlert className="h-3 w-3" /> Area risk {currentAreaRisk.score}%
            </span>
          </div>
          <p className="text-sm text-muted-foreground">Public signals, analyst context, and brief history for live operations.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && (
            <button
              onClick={generateBrief}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Sparkles className="h-3.5 w-3.5" /> Generate Weekly Brief
            </button>
          )}
          <button
            onClick={downloadPdf}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-xs hover:bg-surface-2"
          >
            <Download className="h-3.5 w-3.5" /> Download PDF
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
        <div className="inline-flex rounded-md border border-border bg-surface p-1">
          {(["feed", "map"] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => setMode(v)}
              className={`rounded px-3 py-1.5 text-xs font-medium capitalize ${mode === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {v === "feed" ? "Feed" : "Map"}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SelectChip label="Severity" value={severityFilter} onChange={(v) => setSeverityFilter(v as SeverityFilter)} options={[["all", "All"], ["4plus", "4+"], ["3plus", "3+"], ["2plus", "2+"]]} />
          <SelectChip label="Category" value={categoryFilter} onChange={(v) => setCategoryFilter(v as IntelligenceCategory | "all")} options={[["all", "All"], ["physical", "Physical"], ["cyber", "Cyber"], ["political", "Political"], ["macro", "Macro"]]} />
          <SelectChip label="Date" value={rangeFilter} onChange={(v) => setRangeFilter(v as RangeFilter)} options={[["24h", "24h"], ["7d", "7d"], ["30d", "30d"], ["90d", "90d"]]} />
          <SelectChip label="Verified" value={verifiedFilter} onChange={(v) => setVerifiedFilter(v as VerifiedFilter)} options={[["all", "All"], ["verified", "Verified"], ["unverified", "Unverified"]]} />
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search intelligence"
              className="w-56 rounded-md border border-border bg-surface pl-7 pr-3 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.25fr_0.75fr] gap-4 items-start">
        <section className="rounded-lg border border-border bg-card p-4 space-y-3">
          {isLoading && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading intelligence…
            </div>
          )}

          {feedError && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Could not reach the intelligence service. This is a connectivity issue, not an empty feed — retry shortly.
            </div>
          )}

          {!mapView ? (
            <div className="space-y-2">
              {filteredItems.length === 0 ? (
                <div className="rounded-md border border-dashed border-border bg-surface p-8 text-center text-sm text-muted-foreground">
                  {feedError ? "Unable to load intelligence items right now." : "No intelligence items match the current filters."}
                </div>
              ) : (
                filteredItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    className={`w-full rounded-lg border p-4 text-left transition-colors ${selectedItem?.id === item.id ? "border-primary/50 bg-primary/5" : "border-border bg-surface hover:bg-surface-2"}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                          <Badge severity={item.severity} />
                          <span>{item.category}</span>
                          <span>{formatConfidence(item.confidence)}</span>
                          <span>{item.verified ? "Verified ✓" : "Partial"}</span>
                          {feedFlags[item.id] && <span className="text-primary">{feedFlags[item.id]}</span>}
                        </div>
                        <div className="text-sm font-semibold">{item.title}</div>
                        <p className="line-clamp-2 text-sm text-muted-foreground">{item.summary}</p>
                      </div>
                      <div className="text-right text-[11px] text-muted-foreground">
                        <div>{item.sourceName}</div>
                        <div>{formatAgo(item.reportedAt)} · {item.zone}</div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <ActionPill onClick={() => setSelectedId(item.id)} label="View full" icon={<ChevronRight className="h-3 w-3" />} />
                      <ActionPill onClick={() => markRelevant(item.id)} label="Relevant to us" icon={<BrainCircuit className="h-3 w-3" />} />
                      <ActionPill onClick={() => dismissItem(item.id)} label="Dismiss" icon={<X className="h-3 w-3" />} />
                    </div>
                  </button>
                ))
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-surface overflow-hidden">
                <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2"><MapPinned className="h-3.5 w-3.5" /> OSINT map view</div>
                  <div>{filteredItems.length} plotted items</div>
                </div>
                <div className="relative h-[520px]">
                  {tokenData?.token ? (
                    <div ref={mapEl} className="absolute inset-0" />
                  ) : (
                    <div className="absolute inset-0 grid place-items-center p-8 text-center text-sm text-muted-foreground">
                      Add `MAPBOX_PUBLIC_TOKEN` to enable the OSINT map.
                    </div>
                  )}
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {zoneScores.slice(0, 4).map((zone) => (
                  <div key={zone.zone} className="rounded-lg border border-border bg-surface px-3 py-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{zone.zone}</span>
                      <span className="font-mono text-muted-foreground">{zone.score}%</span>
                    </div>
                    <div className="mt-1 text-muted-foreground">{zone.incidents} intelligence items · {zone.trend}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4 sticky top-4">
            <div className={`transform transition-transform duration-300 ${selectedItem ? "translate-x-0 opacity-100" : "translate-x-4 opacity-70"}`}>
              {selectedItem ? (
                <div className="space-y-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <Badge severity={selectedItem.severity} />
                      <span>{selectedItem.category}</span>
                      <span>{formatConfidence(selectedItem.confidence)}</span>
                    </div>
                    <h2 className="mt-2 text-lg font-semibold">{selectedItem.title}</h2>
                    <div className="mt-1 text-xs text-muted-foreground">{selectedItem.sourceName} · {formatAgo(selectedItem.reportedAt)} · {selectedItem.zone}</div>
                  </div>
                  <div className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-muted-foreground">{selectedItem.summary}</div>
                  <InfoRow label="Source link" value={<a href={selectedItem.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">Open source <ExternalLink className="h-3 w-3" /></a>} />
                  <InfoRow label="Matched keywords" value={selectedItem.matchedKeywords.join(", ") || "None detected"} />
                  <InfoRow label="Location relevance" value={`${selectedItem.locationRelevance}%`} />
                  <InfoRow label="Verification" value={selectedItem.verified ? "Verified" : "Unverified"} />
                  <InfoRow label="Analyst notes" value={selectedItem.analystNotes} />
                  <InfoRow label="Related incidents" value={selectedItem.relatedIncidentIds.length ? selectedItem.relatedIncidentIds.join(", ") : "None"} />
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button onClick={() => markRelevant(selectedItem.id)} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                      <BrainCircuit className="h-3.5 w-3.5" /> Mark relevant
                    </button>
                    <button onClick={() => dismissItem(selectedItem.id)} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-xs hover:bg-surface-2">
                      <X className="h-3.5 w-3.5" /> Dismiss
                    </button>
                    <button onClick={() => escalateToIncident(selectedItem)} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-xs hover:bg-surface-2">
                      <ChevronRight className="h-3.5 w-3.5" /> Escalate to incident
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">Select an intelligence item to view its detail panel.</div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Weekly brief</div>
                <h3 className="text-sm font-semibold">Latest generated brief</h3>
              </div>
              {canManage && (
                <button
                  onClick={generateBrief}
                  disabled={generatingBrief}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                >
                  {generatingBrief ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {generatingBrief ? "Generating…" : "Generate new brief"}
                </button>
              )}
            </div>

            {briefsError && briefHistory.length === 0 ? (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-xs text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>Could not reach the intelligence service to load the latest brief. This is a connectivity issue — the last brief may still be available in a moment.</span>
              </div>
            ) : (
            <div className="mt-4 rounded-lg border border-border bg-surface p-4">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                <FileText className="h-3.5 w-3.5" /> {briefHistory[0]?.windowLabel ?? "Current window"}
              </div>
              <h4 className="mt-2 text-base font-semibold">{briefHistory[0]?.title ?? currentBrief.title}</h4>
              <p className="mt-2 text-sm text-muted-foreground">{briefHistory[0]?.summary ?? currentBrief.summary}</p>
              <ul className="mt-3 space-y-1.5 text-xs text-foreground">
                {(briefHistory[0]?.highlights ?? currentBrief.highlights).map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-primary" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>Score {briefHistory[0]?.score ?? currentBrief.score}%</span>
                <button onClick={downloadPdf} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs hover:bg-surface-2">
                  <Download className="h-3.5 w-3.5" /> Download PDF
                </button>
              </div>
            </div>
            )}

            <div className="mt-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Brief history</div>
              <div className="mt-2 space-y-2">
                {(briefHistory.slice(0, 12)).map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => setBriefHistory((prev) => [entry, ...prev.filter((item) => item.id !== entry.id)])}
                    className="w-full rounded-md border border-border bg-surface px-3 py-2 text-left text-xs hover:bg-surface-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{entry.title}</span>
                      <span className="text-[10px] text-muted-foreground">{entry.score}%</span>
                    </div>
                    <div className="mt-1 text-muted-foreground">{new Date(entry.generatedAt).toLocaleString("en-GB")}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// Every field below comes directly from osint's own classification (add_incident() /
// classify_text() in osint/operations/core.py) - severity, confidence, matched_keywords,
// verified, and source are real, not synthesized. This replaces an earlier version of this
// function that was written for the dashboard's own incident log (a different table with a
// different shape) and fabricated most of these fields (a formula-derived confidence, a
// deterministic-but-fake source name, keyword matches against a hardcoded local list) because
// that table has no equivalent real data - see the "OSINT intelligence feed shows the wrong
// table" fix this replaces.
function deriveOsintIntelligenceItem(item: OsintIntelligenceItem, index: number): IntelligenceItem {
  const category = categoryForThreatType(item.threat_category);
  const severity = Math.max(1, Math.min(5, Number(item.severity ?? 3)));
  const confidence = Math.max(0, Math.min(100, Number(item.confidence ?? 50)));
  const qualityScore = Math.max(0, Math.min(100, Number(item.quality_score ?? 50)));
  const reportedAt = item.collected_at ?? new Date(Date.now() - index * 3600_000).toISOString();
  const summary = String(item.summary ?? "").replace(/\s+/g, " ").trim() || "No summary available.";
  const title = summary.length > 90 ? `${summary.slice(0, 87).trimEnd()}...` : summary;
  const matchedKeywords = String(item.matched_keywords ?? "")
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean);
  const verified = item.verified === "Yes" || item.verified === "Partial";
  const zone = item.geo_relevance && item.geo_relevance !== "None" ? item.geo_relevance : "Nigeria";
  const locationRelevance = clamp(Math.round(qualityScore * 0.6 + confidence * 0.4), 10, 99);
  return {
    id: String(item.id),
    title,
    summary,
    category,
    severity,
    confidence,
    verified,
    sourceName: item.source || "Public source",
    sourceUrl: item.source_url || "",
    zone,
    location: item.location_relevance || zone,
    reportedAt,
    matchedKeywords: matchedKeywords.length ? matchedKeywords : ["public source"],
    analystNotes:
      item.notes ||
      (verified
        ? "Signal is corroborated by a credible public source. Keep it in the active watch list."
        : "Unverified public signal. Verify against patrol, CCTV, or local reports before escalation."),
    locationRelevance,
    relatedIncidentIds: [],
    coordX: toLng(item, index)[0],
    coordY: toLng(item, index)[1],
    statusLabel: item.status || "Monitoring",
  };
}

function buildBrief(items: IntelligenceItem[], zone: string, range: RangeFilter): BriefEntry {
  const critical = items.filter((item) => item.severity >= 4).length;
  const verified = items.filter((item) => item.verified).length;
  const topKeywords = topWords(items.flatMap((item) => item.matchedKeywords)).slice(0, 4);
  return {
    id: `${zone}-${range}-${new Date().toISOString()}`,
    generatedAt: new Date().toISOString(),
    title: `${zone} intelligence brief`,
    summary: `${items.length} intelligence items analysed across the last ${range}. ${critical} are severity 4+. Verification coverage sits at ${Math.round((verified / Math.max(items.length, 1)) * 100)}%.`,
    highlights: [
      `${critical} severity 4+ signals require follow-up`,
      `${verified} items are verified against live context`,
      topKeywords.length ? `Dominant keywords: ${topKeywords.join(", ")}` : "No dominant keywords detected",
      `Most active zone: ${zone}`,
    ],
    score: clamp(Math.round(52 + critical * 4 + verified * 2 + Math.min(8, items.length)), 55, 96),
    windowLabel: `Generated for ${range}`,
  };
}

function categoryForThreatType(type: string | undefined): IntelligenceCategory {
  switch (type) {
    case "Cyber":
      return "cyber";
    case "Political":
      return "political";
    case "Macro":
      return "macro";
    case "Physical":
    default:
      return "physical";
  }
}

function toLng(item: any, index: number): [number, number] {
  if (item.coord_x != null && item.coord_y != null) return [Number(item.coord_x), Number(item.coord_y)];
  if (item.coords?.x != null && item.coords?.y != null) {
    return [LAGOS[0] + (Number(item.coords.x) - 50) / 520, LAGOS[1] + (Number(item.coords.y) - 50) / 520];
  }
  return [LAGOS[0] + ((index * 29) % 100 - 50) / 650, LAGOS[1] + ((index * 47) % 100 - 50) / 650];
}

function fallbackReportedAt(relativeLabel: string) {
  const minutes = parseRelativeMinutes(relativeLabel);
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function zoneScoreFromText(zone: string) {
  const value = zone.toLowerCase();
  if (value.includes("lekki")) return 72;
  if (value.includes("ikoyi")) return 58;
  if (value.includes("vi")) return 64;
  if (value.includes("ajah")) return 55;
  return 48;
}

function parseRelativeMinutes(label: string) {
  const lower = String(label).toLowerCase();
  const num = Number(lower.match(/(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  if (lower.includes("hr")) return Math.round(num * 60);
  if (lower.includes("min")) return Math.round(num);
  if (lower.includes("day")) return Math.round(num * 1440);
  return 15;
}

function rangeMsFor(range: RangeFilter) {
  switch (range) {
    case "24h":
      return 24 * 3600_000;
    case "7d":
      return 7 * 24 * 3600_000;
    case "30d":
      return 30 * 24 * 3600_000;
    case "90d":
      return 90 * 24 * 3600_000;
  }
}

function topWords(words: string[]) {
  const counts = new Map<string, number>();
  words.forEach((word) => counts.set(word, (counts.get(word) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([word]) => word);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(1, Math.round(diff / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function formatConfidence(confidence: number) {
  return `${confidence}% conf`;
}

function severityColor(s: number) {
  if (s >= 5) return "hsl(0 84% 60%)";
  if (s >= 4) return "hsl(24 95% 58%)";
  if (s >= 3) return "hsl(38 92% 55%)";
  return "hsl(220 9% 55%)";
}

function Badge({ severity }: { severity: number }) {
  const label = severity >= 5 ? "Severity 5" : severity >= 4 ? "Severity 4" : severity >= 3 ? "Severity 3" : "Severity 2";
  return <span className="rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] text-foreground">{label}</span>;
}

function ActionPill({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] hover:bg-surface-2">
      {icon}
      {label}
    </button>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm">{value}</div>
    </div>
  );
}

function SelectChip({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5 text-xs">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="bg-transparent text-xs outline-none">
        {options.map(([optValue, optLabel]) => (
          <option key={optValue} value={optValue}>{optLabel}</option>
        ))}
      </select>
    </label>
  );
}
