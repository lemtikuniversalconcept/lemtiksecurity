import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { toast } from "sonner";
import { getMapboxToken } from "@/lib/config.functions";
import { getBriefings, generateBriefing, listOsintIntelligence, type BriefEntry, type OsintIntelligenceItem } from "@/lib/intelligence.functions";
import { requireSectionAccess } from "@/lib/rbac";
import { Download, ExternalLink, FileText, Loader2, Search, X } from "lucide-react";
import { Confidence, Empty, Notice, Panel, Seg, Sev, Tag, timeAgo } from "@/components/nw";

type Category = "physical" | "cyber" | "political" | "macro";
type Verification = "yes" | "partial" | "no";
type SevFilter = "all" | "4" | "2";
type VerifiedFilter = "any" | Verification;
type RangeFilter = "24h" | "7d" | "30d" | "90d";
type ViewMode = "feed" | "map";

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "physical", label: "Physical" },
  { value: "cyber", label: "Cyber" },
  { value: "political", label: "Political" },
  { value: "macro", label: "Macro" },
];
const RANGE_DAYS: Record<RangeFilter, number> = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 };
const VERIFY_LABEL: Record<Verification, string> = { yes: "Verified", partial: "Partly verified", no: "Unverified" };
const VERIFY_TONE: Record<Verification, "ok" | "warn" | undefined> = { yes: "ok", partial: "warn", no: undefined };

/** One OSINT signal, carrying only what the intelligence service actually returned. */
type Signal = {
  id: string;
  title: string;
  summary: string;
  category: Category;
  severity: number;
  confidence: number | null;
  verification: Verification;
  sourceName: string | null;
  sourceUrl: string | null;
  area: string | null;
  locationNote: string | null;
  reportedAt: string | null;
  keywords: string[];
  notes: string | null;
  status: string | null;
  coord: [number, number] | null;
};

export const Route = createFileRoute("/app/intelligence")({
  head: () => ({ meta: [{ title: "Intelligence · Lemtik SOD" }] }),
  beforeLoad: async ({ context }) => {
    const appAccess = context.appAccess;
    requireSectionAccess(appAccess, ["security_manager", "operator", "client_admin"]);
    return { appAccess };
  },
  component: IntelligencePage,
});

function IntelligencePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { appAccess } = Route.useRouteContext();
  const canManage = appAccess.specRole === "security_manager";
  const list = useServerFn(listOsintIntelligence);
  const tokenFn = useServerFn(getMapboxToken);
  const loadBriefs = useServerFn(getBriefings);
  const createBrief = useServerFn(generateBriefing);

  const [mode, setMode] = useState<ViewMode>("feed");
  const [sevFilter, setSevFilter] = useState<SevFilter>("all");
  const [categories, setCategories] = useState<Set<Category>>(() => new Set(CATEGORIES.map((c) => c.value)));
  const [range, setRange] = useState<RangeFilter>("7d");
  const [verified, setVerified] = useState<VerifiedFilter>("any");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flags, setFlags] = useState<Record<string, "relevant" | "dismissed">>({});
  const [generating, setGenerating] = useState(false);

  const days = RANGE_DAYS[range];
  const { data: raw = [], isLoading, isError: feedError } = useQuery({
    queryKey: ["intelligence-feed", appAccess.orgId, days],
    queryFn: () => list({ data: { org_id: appAccess.orgId, days } }) as Promise<OsintIntelligenceItem[]>,
    retry: 1,
  });
  const { data: tokenData } = useQuery({ queryKey: ["mapbox-token"], queryFn: () => tokenFn(), staleTime: Infinity });
  // isError separates "the intelligence service is unreachable" from "it answered with nothing".
  const { data: briefs = [], isError: briefsError, isLoading: briefsLoading } = useQuery({
    queryKey: ["intelligence-briefs", appAccess.orgId],
    queryFn: () => loadBriefs({ data: { org_id: appAccess.orgId } }) as Promise<BriefEntry[]>,
    retry: 1,
  });
  const brief = briefs[0] ?? null;

  const signals = useMemo(() => (raw as OsintIntelligenceItem[]).map(toSignal), [raw]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const minSev = sevFilter === "all" ? 1 : Number(sevFilter);
    const cutoff = Date.now() - days * 24 * 3600_000;
    return signals
      .filter((s) => s.severity >= minSev)
      .filter((s) => categories.has(s.category))
      .filter((s) => verified === "any" || s.verification === verified)
      .filter((s) => !s.reportedAt || new Date(s.reportedAt).getTime() >= cutoff)
      .filter((s) => !q || [s.title, s.summary, s.area, s.locationNote, s.sourceName, s.keywords.join(" ")].join(" ").toLowerCase().includes(q))
      .filter((s) => flags[s.id] !== "dismissed")
      .sort((a, b) => (b.reportedAt ? Date.parse(b.reportedAt) : 0) - (a.reportedAt ? Date.parse(a.reportedAt) : 0));
  }, [signals, search, sevFilter, categories, verified, days, flags]);

  const selected = filtered.find((s) => s.id === selectedId) ?? null;
  const placed = filtered.filter((s) => s.coord);
  const highSev = filtered.filter((s) => s.severity >= 4).length;
  const relevantCount = Object.values(flags).filter((f) => f === "relevant").length;

  const generate = async () => {
    setGenerating(true);
    try {
      await createBrief({
        data: {
          title: "Weekly intelligence brief",
          windowLabel: `Last ${days} days`,
          items: filtered.map((s) => ({ id: s.id, severity: s.severity, category: s.category, summary: s.summary })),
          context: { range },
          org_id: appAccess.orgId,
        },
      });
      await qc.invalidateQueries({ queryKey: ["intelligence-briefs", appAccess.orgId] });
      toast.success("New brief generated");
    } catch (e) {
      toast.error((e as Error)?.message || "Couldn't generate a brief. The intelligence service may be unreachable.");
    } finally {
      setGenerating(false);
    }
  };

  const escalate = (s: Signal) => {
    try {
      sessionStorage.setItem(
        "lemtik_incident_draft",
        JSON.stringify({
          title: s.title,
          description: `${s.summary}${s.sourceName ? `\n\nSource: ${s.sourceName}` : ""}${s.sourceUrl ? `\n${s.sourceUrl}` : ""}`,
          location: s.locationNote ?? s.area ?? "",
          zone: s.area ?? "",
          severity: Math.max(3, s.severity),
          type: s.category === "cyber" ? "cyber_incident" : s.category === "political" ? "civil_unrest" : "suspicious",
        }),
      );
    } catch {
      /* storage unavailable: the wizard opens empty */
    }
    navigate({ to: "/app/incidents" });
  };

  const toggleCategory = (c: Category) =>
    setCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  return (
    <div className="col g16">
      <div className="row g12 wrap">
        <div className="col">
          <h1 className="ph1">Intelligence</h1>
          <span className="sub">Open-source signals collected for your organisation, before they become alerts.</span>
        </div>
        <span className="flex-auto" />
        <Seg label="View" value={mode} onChange={setMode} options={[{ value: "feed", label: "Feed" }, { value: "map", label: "Map" }]} />
        {canManage && (
          <button type="button" className="b b-pri" onClick={generate} disabled={generating}>
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Generate weekly brief
          </button>
        )}
      </div>

      <section className="pn">
        <div className="row g16 wrap" style={{ padding: "14px 16px", alignItems: "center" }}>
        <Stat label={`Signals · ${range}`} value={isLoading ? "—" : filtered.length} />
        <Stat label="Severity 4+" value={isLoading ? "—" : highSev} />
        <Stat label="Verified" value={isLoading ? "—" : filtered.filter((s) => s.verification === "yes").length} />
        <Stat label="Marked relevant" value={relevantCount} hint="Kept in this browser session only" />
        <span className="flex-auto" />
        <div className="card row g10" style={{ padding: "8px 12px", minWidth: 0 }}>
          <span className="col" style={{ minWidth: 0 }}>
            <b className="trunc">{brief ? brief.title : "Weekly brief"}</b>
            <span className="t3">
              {briefsLoading
                ? "Loading…"
                : briefsError
                  ? "Couldn't reach the intelligence service"
                  : brief
                    ? `Generated ${new Date(brief.generatedAt).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })} · ${brief.windowLabel}`
                    : "No brief generated yet"}
            </span>
          </span>
          {brief?.rating && <Tag tone={brief.rating === "Red" ? "fail" : brief.rating === "Orange" ? "warn" : "ok"}>{brief.rating}</Tag>}
          {brief && (
            <button type="button" className="b b-sm b-sec" onClick={() => window.print()}>
              <Download className="h-3.5 w-3.5" /> PDF
            </button>
          )}
        </div>
        </div>
      </section>

      <div className="row g8 wrap">
        <label className="in row g8" style={{ width: 260 }}>
          <Search className="h-4 w-4 t3" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search signals" aria-label="Search signals" className="f1" style={{ background: "transparent", border: 0, outline: "none", color: "inherit", minWidth: 0 }} />
        </label>
        <Seg label="Severity" value={sevFilter} onChange={setSevFilter} options={[{ value: "all", label: "All" }, { value: "4", label: "S4+" }, { value: "2", label: "S2+" }]} />
        {CATEGORIES.map((c) => (
          <button key={c.value} type="button" className={`chip${categories.has(c.value) ? " on" : ""}`} aria-pressed={categories.has(c.value)} onClick={() => toggleCategory(c.value)}>
            {c.label}
          </button>
        ))}
        <select className="in" style={{ width: "auto" }} value={verified} onChange={(e) => setVerified(e.target.value as VerifiedFilter)} aria-label="Verification">
          <option value="any">Verification: any</option>
          <option value="yes">Verified</option>
          <option value="partial">Partly verified</option>
          <option value="no">Unverified</option>
        </select>
        <Seg label="Time window" value={range} onChange={setRange} options={(["24h", "7d", "30d", "90d"] as RangeFilter[]).map((r) => ({ value: r, label: r }))} />
      </div>

      {feedError && <Notice tone="fail">Couldn't reach the intelligence service. This is a connection problem, not an empty feed. Try again shortly.</Notice>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]" style={{ alignItems: "start" }}>
        <div className="col g8" style={{ minWidth: 0 }}>
          {mode === "map" ? (
            <SignalMap token={tokenData?.token ?? ""} signals={placed} total={filtered.length} selectedId={selectedId} onSelect={setSelectedId} />
          ) : isLoading ? (
            <Panel>
              <Empty>
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading signals…
              </Empty>
            </Panel>
          ) : filtered.length === 0 ? (
            <Panel>
              <Empty>{feedError ? "Signals couldn't be loaded." : signals.length ? "No signals match these filters." : "No signals collected in this window."}</Empty>
            </Panel>
          ) : (
            filtered.map((s) => (
              <article
                key={s.id}
                className="card col g8"
                style={{ padding: 14, borderColor: selectedId === s.id ? "var(--blue-ln)" : undefined, cursor: "pointer" }}
                onClick={() => setSelectedId(s.id)}
              >
                <div className="row g8 wrap">
                  <Sev level={s.severity} />
                  <Tag>{CATEGORIES.find((c) => c.value === s.category)?.label}</Tag>
                  <Tag tone={VERIFY_TONE[s.verification]}>{VERIFY_LABEL[s.verification]}</Tag>
                  {flags[s.id] === "relevant" && <Tag tone="blue">Relevant</Tag>}
                  <span className="flex-auto" />
                  {s.confidence != null && (
                    <span title="Classifier confidence from the intelligence service">
                      <Confidence value={s.confidence} />
                    </span>
                  )}
                </div>
                <h3 style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.4, margin: 0 }}>{s.title}</h3>
                <div className="row g8 wrap t3" style={{ fontSize: 12 }}>
                  {s.sourceName && <span>{s.sourceName}</span>}
                  {s.reportedAt && <span>· {timeAgo(s.reportedAt)}</span>}
                  {s.area && <span>· {s.area}</span>}
                  <span className="flex-auto" />
                  <button
                    type="button"
                    className="b b-sm b-gh"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFlags((f) => ({ ...f, [s.id]: "dismissed" }));
                    }}
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    className="b b-sm b-sec"
                    aria-pressed={flags[s.id] === "relevant"}
                    onClick={(e) => {
                      e.stopPropagation();
                      setFlags((f) => ({ ...f, [s.id]: "relevant" }));
                    }}
                  >
                    Relevant
                  </button>
                </div>
              </article>
            ))
          )}
        </div>

        <aside className="col g12 side">
          {selected ? (
            <Panel
              title="Signal"
              actions={
                <button type="button" className="ibtn" style={{ width: 28, height: 28 }} aria-label="Close signal" onClick={() => setSelectedId(null)}>
                  <X size={14} />
                </button>
              }
            >
              <div className="col g12">
                <div className="row g8 wrap">
                  <Sev level={selected.severity} label />
                  <Tag tone={VERIFY_TONE[selected.verification]}>{VERIFY_LABEL[selected.verification]}</Tag>
                  {selected.status && <Tag>{selected.status}</Tag>}
                </div>
                <p style={{ margin: 0, lineHeight: 1.55 }}>{selected.summary}</p>
                <dl className="kv">
                  <dt>Source</dt>
                  <dd>
                    {selected.sourceUrl ? (
                      <a href={selected.sourceUrl} target="_blank" rel="noreferrer noopener" className="lnk row g4">
                        {selected.sourceName ?? "Open source"} <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      selected.sourceName ?? "—"
                    )}
                  </dd>
                  <dt>Reported</dt>
                  <dd>{selected.reportedAt ? new Date(selected.reportedAt).toLocaleString("en-GB") : "—"}</dd>
                  <dt>Area</dt>
                  <dd>{selected.area ?? "—"}</dd>
                  <dt>Location</dt>
                  <dd>{selected.locationNote ?? "—"}</dd>
                  <dt>Confidence</dt>
                  <dd>{selected.confidence != null ? `${selected.confidence}%` : "—"}</dd>
                  <dt>Keywords</dt>
                  <dd>{selected.keywords.length ? selected.keywords.join(", ") : "—"}</dd>
                  <dt>Analyst notes</dt>
                  <dd>{selected.notes ?? "None yet"}</dd>
                </dl>
                <div className="row g8 wrap">
                  {canManage && (
                    <button type="button" className="b b-sm b-pri" onClick={() => escalate(selected)}>
                      Open as incident
                    </button>
                  )}
                  <button type="button" className="b b-sm b-sec" onClick={() => setFlags((f) => ({ ...f, [selected.id]: "relevant" }))}>
                    Mark relevant
                  </button>
                  <button type="button" className="b b-sm b-gh" onClick={() => setFlags((f) => ({ ...f, [selected.id]: "dismissed" }))}>
                    Dismiss
                  </button>
                </div>
              </div>
            </Panel>
          ) : (
            <Panel>
              <Empty>Select a signal to see its source and details.</Empty>
            </Panel>
          )}

          <Panel title="Latest brief" meta={brief?.windowLabel}>
            {briefsLoading ? (
              <Empty>Loading…</Empty>
            ) : briefsError ? (
              <Notice tone="fail">Couldn't reach the intelligence service to load the brief.</Notice>
            ) : !brief ? (
              <Empty>{canManage ? "No brief yet. Generate one to summarise the week." : "No brief has been generated yet."}</Empty>
            ) : (
              <div className="col g10">
                <div className="row g8">
                  <b className="f1">{brief.title}</b>
                  {brief.rating && <Tag tone={brief.rating === "Red" ? "fail" : brief.rating === "Orange" ? "warn" : "ok"}>{brief.rating}</Tag>}
                </div>
                <p className="t2" style={{ margin: 0 }}>
                  {brief.summary}
                </p>
                {brief.highlights.length > 0 && (
                  <ul className="col g6" style={{ margin: 0, paddingLeft: 18 }}>
                    {brief.highlights.map((h) => (
                      <li key={h} style={{ fontSize: 12.5 }}>
                        {h}
                      </li>
                    ))}
                  </ul>
                )}
                <span className="t3" style={{ fontSize: 12 }}>
                  Generated {new Date(brief.generatedAt).toLocaleString("en-GB")}
                </span>
              </div>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="col" title={hint}>
      <span className="t3" style={{ fontSize: 12 }}>
        {label}
      </span>
      <b style={{ fontSize: 20, fontVariantNumeric: "tabular-nums" }}>{value}</b>
    </div>
  );
}

function SignalMap({ token, signals, total, selectedId, onSelect }: { token: string; signals: Signal[]; total: number; selectedId: string | null; onSelect: (id: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<mapboxgl.Marker[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!token || !el.current || mapRef.current) return;
    mapboxgl.accessToken = token;
    const first = signals[0]?.coord;
    const m = new mapboxgl.Map({ container: el.current, style: "mapbox://styles/mapbox/dark-v11", center: first ?? [3.4219, 6.4281], zoom: first ? 11 : 9, attributionControl: true });
    m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => {
      requestAnimationFrame(() => m.resize());
      setReady(true);
    });
    mapRef.current = m;
    return () => {
      markers.current.forEach((mk) => mk.remove());
      markers.current = [];
      m.remove();
      mapRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current = [];
    for (const s of signals) {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("aria-label", `S${s.severity}: ${s.title}`);
      const on = s.id === selectedId;
      b.style.cssText = `width:${on ? 20 : 16}px;height:${on ? 20 : 16}px;transform:rotate(45deg);border-radius:3px;background:var(--s${Math.min(5, Math.max(1, s.severity))});box-shadow:0 0 0 2px #0A0C10${on ? ",0 0 0 5px rgba(122,155,255,.5)" : ""};padding:0;border:0;cursor:pointer`;
      b.onclick = (e) => {
        e.stopPropagation();
        onSelect(s.id);
      };
      markers.current.push(new mapboxgl.Marker({ element: b }).setLngLat(s.coord!).addTo(m));
    }
  }, [signals, ready, selectedId, onSelect]);

  if (!token) {
    return (
      <div className="map" style={{ minHeight: 420 }}>
        <Empty>The map needs a Mapbox token.</Empty>
      </div>
    );
  }
  return (
    <div className="map" style={{ minHeight: 560 }}>
      <div ref={el} style={{ position: "absolute", inset: 0 }} />
      <div className="glass" style={{ position: "absolute", left: 10, bottom: 10, padding: "6px 10px", fontSize: 12 }}>
        {signals.length} of {total} signal{total === 1 ? "" : "s"} have a map position
      </div>
    </div>
  );
}

function toSignal(item: OsintIntelligenceItem): Signal {
  const summary = String(item.summary ?? "").replace(/\s+/g, " ").trim() || "No summary provided.";
  const v = String(item.verified ?? "").toLowerCase();
  const anyItem = item as OsintIntelligenceItem & { coord_x?: number | null; coord_y?: number | null };
  const coord: [number, number] | null =
    anyItem.coord_x != null && anyItem.coord_y != null && Number.isFinite(Number(anyItem.coord_x)) && Number.isFinite(Number(anyItem.coord_y))
      ? [Number(anyItem.coord_x), Number(anyItem.coord_y)]
      : null;
  const area = item.geo_relevance && item.geo_relevance !== "None" ? item.geo_relevance : null;
  return {
    id: String(item.id),
    title: summary.length > 140 ? `${summary.slice(0, 137).trimEnd()}…` : summary,
    summary,
    category: categoryOf(item.threat_category),
    severity: Math.max(1, Math.min(5, Number(item.severity ?? 1))),
    confidence: item.confidence == null ? null : Math.max(0, Math.min(100, Number(item.confidence))),
    verification: v === "yes" ? "yes" : v === "partial" ? "partial" : "no",
    sourceName: item.source || null,
    sourceUrl: item.source_url && /^https?:\/\//i.test(item.source_url) ? item.source_url : null,
    area,
    locationNote: item.location_relevance && item.location_relevance !== "None" ? item.location_relevance : null,
    reportedAt: item.collected_at ?? null,
    keywords: String(item.matched_keywords ?? "")
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean),
    notes: item.notes || null,
    status: item.status || null,
    coord,
  };
}

function categoryOf(type: string | undefined): Category {
  switch (type) {
    case "Cyber":
      return "cyber";
    case "Political":
      return "political";
    case "Macro":
      return "macro";
    default:
      return "physical";
  }
}
