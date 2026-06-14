import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { listIncidents, assignIncidentToMe, updateIncidentStatus } from "@/lib/incidents.functions";
import { listPatrols } from "@/lib/patrols.functions";
import { listLocations } from "@/lib/orgs.functions";
import { getMapboxToken } from "@/lib/config.functions";
import { supabase } from "@/integrations/supabase/client";
import { severityMeta, typeMeta, statusMeta, type Severity, type IncidentType, type IncidentStatus } from "@/lib/mockData";
import { SeverityBadge } from "@/components/SeverityBadge";
import {
  MapPin, Loader2, Layers, Flame, Pin, Radar, ChevronRight, Wifi, WifiOff,
  UserPlus, ExternalLink, ChevronsUpDown,
} from "lucide-react";

export const Route = createFileRoute("/app/map")({
  head: () => ({ meta: [{ title: "Live Map · Lemtik SOD" }] }),
  component: LiveMap,
});

const LAGOS: [number, number] = [3.4219, 6.4281];

type Mode = "pins" | "heatmap";
type Window = "24h" | "7d" | "30d" | "90d";
const WINDOWS: { value: Window; label: string; ms: number }[] = [
  { value: "24h", label: "24h", ms: 86_400_000 },
  { value: "7d", label: "7d", ms: 7 * 86_400_000 },
  { value: "30d", label: "30d", ms: 30 * 86_400_000 },
  { value: "90d", label: "90d", ms: 90 * 86_400_000 },
];
const TYPE_OPTS: (IncidentType | "all")[] = ["all", "intrusion", "theft", "medical", "fire", "suspicious", "civil_unrest", "other"];

// Severity → CSS color (resolves design tokens to literal colors for mapbox paint)
function severityColor(s: number): string {
  const map: Record<number, string> = {
    5: "hsl(0 84% 60%)",      // critical / red
    4: "hsl(24 95% 58%)",     // high / orange
    3: "hsl(38 92% 55%)",     // medium / amber
    2: "hsl(48 96% 60%)",     // low / yellow
    1: "hsl(220 9% 55%)",     // info / grey
  };
  return map[s] ?? map[3];
}

function LiveMap() {
  const qc = useQueryClient();
  const listInc = useServerFn(listIncidents);
  const listPat = useServerFn(listPatrols);
  const listLoc = useServerFn(listLocations);
  const getToken = useServerFn(getMapboxToken);
  const assignFn = useServerFn(assignIncidentToMe);
  const statusFn = useServerFn(updateIncidentStatus);

  const { data: incidents = [], isLoading } = useQuery({ queryKey: ["incidents"], queryFn: () => listInc() });
  const { data: patrols = [] } = useQuery({ queryKey: ["patrols"], queryFn: () => listPat() });
  const { data: locations = [] } = useQuery({ queryKey: ["locations"], queryFn: () => listLoc() });
  const { data: tokenData } = useQuery({ queryKey: ["mapbox_token"], queryFn: () => getToken(), staleTime: Infinity });

  // ---- UI state ----
  const [mode, setMode] = useState<Mode>("pins");
  const [win, setWin] = useState<Window>("7d");
  const [typeFilter, setTypeFilter] = useState<IncidentType | "all">("all");
  const [showPatrols, setShowPatrols] = useState(true);
  const [showZones, setShowZones] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [conn, setConn] = useState<"live" | "reconnecting">("live");

  // ---- Realtime + connection banner ----
  useEffect(() => {
    let retry = 0;
    const channel = supabase
      .channel("incidents-map")
      .on("postgres_changes", { event: "*", schema: "public", table: "incidents" }, () => {
        qc.invalidateQueries({ queryKey: ["incidents"] });
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") { setConn("live"); retry = 0; }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setConn("reconnecting");
          retry = Math.min(retry + 1, 6);
          setTimeout(() => channel.subscribe(), Math.min(1000 * 2 ** retry, 30_000));
        }
      });
    return () => { supabase.removeChannel(channel); };
  }, [qc]);

  // ---- Filtered incidents ----
  const now = Date.now();
  const winMs = WINDOWS.find((w) => w.value === win)!.ms;
  const filtered = useMemo(() => {
    return incidents.filter((i) => {
      const age = now - new Date(i.reported_at).getTime();
      if (age > winMs) return false;
      if (typeFilter !== "all" && i.type !== typeFilter) return false;
      return true;
    });
  }, [incidents, now, winMs, typeFilter]);

  // ---- Build GeoJSON ----
  const geojson = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: filtered.map((i, idx) => {
      const lng = i.coord_x != null ? Number(i.coord_x) : LAGOS[0] + ((idx * 37) % 100 - 50) / 800;
      const lat = i.coord_y != null ? Number(i.coord_y) : LAGOS[1] + ((idx * 53) % 100 - 50) / 800;
      const sev = i.status === "resolved" ? 1 : i.severity;
      return {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [lng, lat] },
        properties: {
          id: i.id, sev, severity: i.severity, status: i.status,
          critical: i.severity >= 4 && i.status !== "resolved" ? 1 : 0,
        },
      };
    }),
  }), [filtered]);

  const sel = useMemo(
    () => filtered.find((i) => i.id === selected) ?? filtered[0] ?? null,
    [filtered, selected],
  );
  const tacticalResponse = useMemo(() => {
    const target = sel ? `${sel.location}, ${sel.zone}` : "No active target";
    const priority = sel ? `Severity ${sel.severity} · ${statusMeta[sel.status as IncidentStatus]}` : "Awaiting live incident feed";
    const instruction = sel
      ? `Dispatch nearest patrol to ${target}. Lock perimeter, confirm camera sweep, and move the incident to responding within 90 seconds.`
      : "Watch the live feed and approve the next override when a critical signal is selected.";
    return { target, priority, instruction };
  }, [sel]);

  // ---- Map ----
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!tokenData?.token || !mapContainer.current || mapRef.current) return;
    mapboxgl.accessToken = tokenData.token;
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: LAGOS,
      zoom: 11,
      attributionControl: false,
    });
    map.on("error", (e) => {
      // Surface tile/style failures rather than silently showing a grey canvas
      // eslint-disable-next-line no-console
      console.error("[mapbox]", e?.error?.message ?? e);
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;


    map.on("load", () => {
      loadedRef.current = true;
      // Fix container sizing race in flex/grid layouts
      requestAnimationFrame(() => map.resize());
      // Incidents source (clustered)
      map.addSource("incidents", {
        type: "geojson", data: geojson, cluster: true,
        clusterMaxZoom: 14, clusterRadius: 50,
        clusterProperties: { maxSev: ["max", ["get", "sev"]] },
      });
      // Cluster bubbles
      map.addLayer({
        id: "clusters", type: "circle", source: "incidents", filter: ["has", "point_count"],
        paint: {
          "circle-color": [
            "step", ["get", "maxSev"],
            "hsl(220 9% 55%)", 2,
            "hsl(48 96% 60%)", 3,
            "hsl(38 92% 55%)", 4,
            "hsl(24 95% 58%)", 5,
            "hsl(0 84% 60%)",
          ],
          "circle-radius": ["step", ["get", "point_count"], 16, 5, 22, 20, 30],
          "circle-stroke-width": 2, "circle-stroke-color": "hsl(220 13% 9%)",
          "circle-opacity": 0.9,
        },
      });
      map.addLayer({
        id: "cluster-count", type: "symbol", source: "incidents", filter: ["has", "point_count"],
        layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12, "text-font": ["DIN Pro Medium", "Arial Unicode MS Bold"] },
        paint: { "text-color": "#fff" },
      });
      // Single points
      map.addLayer({
        id: "unclustered", type: "circle", source: "incidents", filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": [
            "match", ["get", "sev"],
            5, "hsl(0 84% 60%)", 4, "hsl(24 95% 58%)", 3, "hsl(38 92% 55%)",
            2, "hsl(48 96% 60%)", "hsl(220 9% 55%)",
          ],
          "circle-radius": ["case", ["==", ["get", "critical"], 1], 9, 7],
          "circle-stroke-width": 2, "circle-stroke-color": "hsl(220 13% 9%)",
        },
      });
      // Heatmap layer (toggled)
      map.addLayer({
        id: "incidents-heat", type: "heatmap", source: "incidents",
        layout: { visibility: "none" },
        paint: {
          "heatmap-weight": ["interpolate", ["linear"], ["get", "sev"], 1, 0.2, 5, 1],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 9, 1, 15, 3],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 9, 18, 15, 40],
          "heatmap-opacity": 0.75,
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(0,0,0,0)",
            0.2, "hsl(220 100% 60% / 0.4)",
            0.4, "hsl(48 96% 60% / 0.6)",
            0.7, "hsl(24 95% 58% / 0.8)",
            1, "hsl(0 84% 60% / 0.95)",
          ],
        },
      });

      // Zones (geofences) source
      map.addSource("zones", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "zones-fill", type: "fill", source: "zones",
        paint: { "fill-color": "hsl(217 91% 60%)", "fill-opacity": 0.12 },
      });
      map.addLayer({
        id: "zones-line", type: "line", source: "zones",
        paint: { "line-color": "hsl(217 91% 60%)", "line-width": 1.5, "line-dasharray": [2, 2] },
      });

      // Patrol source
      map.addSource("patrols", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "patrols-pts", type: "circle", source: "patrols",
        paint: {
          "circle-color": [
            "match", ["get", "status"],
            "complete", "hsl(142 71% 45%)",
            "missed", "hsl(0 84% 60%)",
            "delayed", "hsl(24 95% 58%)",
            "hsl(217 91% 60%)",
          ],
          "circle-radius": 6, "circle-stroke-width": 2, "circle-stroke-color": "hsl(220 13% 9%)",
        },
      });

      // Click handlers
      map.on("click", "unclustered", (e) => {
        const f = e.features?.[0]; if (!f) return;
        const id = (f.properties as any).id as string;
        const [lng, lat] = (f.geometry as any).coordinates as [number, number];
        setSelected(id);
        map.flyTo({ center: [lng, lat], zoom: 14, duration: 700 });
      });
      map.on("click", "clusters", (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
        const clusterId = features[0]?.properties?.cluster_id;
        const src = map.getSource("incidents") as mapboxgl.GeoJSONSource;
          src.getClusterExpansionZoom(clusterId, (err, zoom) => {
            if (err || zoom == null) return;
            const coords = (features[0].geometry as any).coordinates as [number, number];
            map.easeTo({ center: coords, zoom });
          });
      });
      map.on("mouseenter", "unclustered", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "unclustered", () => { map.getCanvas().style.cursor = ""; });
      map.on("mouseenter", "clusters", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "clusters", () => { map.getCanvas().style.cursor = ""; });
    });

    // Resize when container changes size (sidebar collapse, viewport change)
    const ro = new ResizeObserver(() => { try { map.resize(); } catch {} });
    if (mapContainer.current) ro.observe(mapContainer.current);

    return () => {
      ro.disconnect();
      loadedRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, [tokenData?.token]);

  // Update incidents data
  useEffect(() => {
    const map = mapRef.current; if (!map || !loadedRef.current) return;
    const src = map.getSource("incidents") as mapboxgl.GeoJSONSource | undefined;
    src?.setData(geojson);
  }, [geojson]);

  // Toggle pins vs heatmap
  useEffect(() => {
    const map = mapRef.current; if (!map || !loadedRef.current) return;
    const pinVis = mode === "pins" ? "visible" : "none";
    const heatVis = mode === "heatmap" ? "visible" : "none";
    ["clusters", "cluster-count", "unclustered"].forEach((id) => map.setLayoutProperty(id, "visibility", pinVis));
    map.setLayoutProperty("incidents-heat", "visibility", heatVis);
  }, [mode]);

  // Zones overlay
  useEffect(() => {
    const map = mapRef.current; if (!map || !loadedRef.current) return;
    const features = (showZones ? locations : [])
      .filter((l) => l.geofence)
      .map((l) => ({ type: "Feature" as const, geometry: l.geofence as any, properties: { name: l.name } }));
    const src = map.getSource("zones") as mapboxgl.GeoJSONSource | undefined;
    src?.setData({ type: "FeatureCollection", features });
  }, [locations, showZones]);

  // Patrol overlay
  useEffect(() => {
    const map = mapRef.current; if (!map || !loadedRef.current) return;
    const features = (showPatrols ? patrols : []).map((p, idx) => {
      // Place at associated location coord if any, else around lagos
      const loc = locations.find((l) => l.id === p.location_id);
      const lng = loc?.coord_x != null ? Number(loc.coord_x) : LAGOS[0] + ((idx * 41) % 100 - 50) / 600;
      const lat = loc?.coord_y != null ? Number(loc.coord_y) : LAGOS[1] + ((idx * 67) % 100 - 50) / 600;
      return {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [lng, lat] },
        properties: { code: p.code, status: p.status, officer: p.officer },
      };
    });
    const src = map.getSource("patrols") as mapboxgl.GeoJSONSource | undefined;
    src?.setData({ type: "FeatureCollection", features });
  }, [patrols, locations, showPatrols]);

  // Mutations
  const assignMut = useMutation({
    mutationFn: (id: string) => assignFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["incidents"] }),
  });
  const statusMut = useMutation({
    mutationFn: (v: { id: string; status: IncidentStatus }) => statusFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["incidents"] }),
  });

  const tokenMissing = tokenData && !tokenData.token;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Live Incident Map</div>
          <h1 className="mt-1 text-2xl font-semibold">Lagos operations</h1>
          <p className="text-sm text-muted-foreground">
            {filtered.length} of {incidents.length} incident{incidents.length === 1 ? "" : "s"} · last {WINDOWS.find((w) => w.value === win)?.label}
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[11px]">
          {conn === "live" ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-low/30 bg-low/10 px-2 py-1 text-low">
              <Wifi className="h-3 w-3" /> Live
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-high/40 bg-high/10 px-2 py-1 text-high">
              <WifiOff className="h-3 w-3" /> Live updates paused — reconnecting…
            </span>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
        <SegBtn active={mode === "pins"} onClick={() => setMode("pins")} icon={Pin}>Pins</SegBtn>
        <SegBtn active={mode === "heatmap"} onClick={() => setMode("heatmap")} icon={Flame}>Heatmap</SegBtn>
        <div className="h-5 w-px bg-border mx-1" />
        <div className="flex items-center gap-1">
          {WINDOWS.map((w) => (
            <button key={w.value} onClick={() => setWin(w.value)}
              className={`rounded px-2 py-1 text-[11px] font-medium uppercase tracking-wider ${win === w.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {w.label}
            </button>
          ))}
        </div>
        <div className="h-5 w-px bg-border mx-1" />
        <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>Type</span>
          <div className="relative">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as IncidentType | "all")}
              className="appearance-none rounded border border-border bg-surface pr-6 pl-2 py-1 text-[11px] text-foreground"
            >
              {TYPE_OPTS.map((t) => (
                <option key={t} value={t}>{t === "all" ? "All types" : typeMeta[t as IncidentType]}</option>
              ))}
            </select>
            <ChevronsUpDown className="pointer-events-none absolute right-1 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          </div>
        </label>
        <div className="h-5 w-px bg-border mx-1" />
        <ToggleBtn active={showPatrols} onClick={() => setShowPatrols((v) => !v)} icon={Radar}>Patrols</ToggleBtn>
        <ToggleBtn active={showZones} onClick={() => setShowZones((v) => !v)} icon={Layers}>Zones</ToggleBtn>
      </div>

      {/* Map + Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-3">
        <div className="relative overflow-hidden rounded-lg border border-border bg-surface h-[calc(100vh-260px)] min-h-[480px]">
          {/* Always mount the container so the ref is present before the map init effect runs */}
          <div ref={mapContainer} className="absolute inset-0" style={{ width: "100%", height: "100%" }} />
          {tokenMissing && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center bg-surface z-10">
              <div>
                <div className="text-sm font-medium text-critical">Mapbox token missing</div>
                <p className="mt-2 text-xs text-muted-foreground">Add MAPBOX_PUBLIC_TOKEN in project secrets.</p>
              </div>
            </div>
          )}
          {!tokenData && (
            <div className="absolute inset-0 grid place-items-center bg-surface z-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}


          {!tokenMissing && (
            <div className="absolute bottom-4 left-4 z-10 flex items-center gap-3 rounded-md border border-border bg-background/90 backdrop-blur px-3 py-2 text-[11px]">
              {([5, 4, 3, 2, 1] as const).map((s) => (
                <span key={s} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: severityColor(s) }} />
                  S{s}
                </span>
              ))}
            </div>
          )}
          <div className="absolute top-4 left-4 z-10 rounded-md border border-critical/30 bg-background/90 backdrop-blur px-3 py-2 text-[11px] shadow-lg">
            <div className="flex items-center gap-2 font-medium text-foreground">
              <span className="h-2 w-2 rounded-full bg-critical animate-pulse" />
              Target lock
            </div>
            <div className="mt-1 font-mono text-muted-foreground">{tacticalResponse.target}</div>
          </div>
        </div>

        {/* Slide-in panel (always rendered on lg, slides in on mobile via translate) */}
        <aside
          className={`rounded-lg border border-border bg-card p-5 transition-all ${sel ? "" : "opacity-70"}`}
        >
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading incidents…
            </div>
          ) : sel ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-critical/30 bg-critical/10 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">AI Dynamic Tactical Response</div>
                    <div className="text-sm font-semibold text-foreground">{tacticalResponse.priority}</div>
                  </div>
                  <span className="rounded-md border border-critical/30 bg-background/80 px-2 py-1 text-[10px] uppercase tracking-wider text-critical">
                    Live
                  </span>
                </div>
                <div className="mt-3 rounded-md border border-border bg-card px-3 py-2 text-xs leading-relaxed text-foreground">
                  {tacticalResponse.instruction}
                </div>
                <button
                  onClick={() => {
                    assignMut.mutate(sel.id);
                    statusMut.mutate({ id: sel.id, status: "responding" });
                  }}
                  className="mt-3 inline-flex w-full items-center justify-center rounded-md bg-critical px-3 py-2 text-xs font-medium text-white hover:opacity-90"
                >
                  Approve & Execute Overrides
                </button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <SeverityBadge severity={sel.severity as Severity} />
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  {statusMeta[sel.status as IncidentStatus]}
                </span>
              </div>
              <div>
                <div className="text-xs font-mono text-muted-foreground">{sel.code}</div>
                <div className="mt-1 text-base font-semibold">{typeMeta[sel.type as IncidentType]}</div>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3" /> {sel.location} · {sel.zone}
                </div>
              </div>
              <p className="text-sm text-foreground/90 leading-relaxed line-clamp-4">
                {sel.description ?? "No description on file."}
              </p>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <Field label="Reported" value={new Date(sel.reported_at).toLocaleString("en-GB")} />
                <Field label="Since" value={timeAgo(sel.reported_at)} />
                <Field label="Assigned" value={sel.officer ?? "Unassigned"} />
                <Field label="Status" value={statusMeta[sel.status as IncidentStatus]} />
              </div>

              <div className="space-y-1.5 pt-1">
                <Link
                  to="/app/incidents"
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium hover:bg-surface-2"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> View full incident
                </Link>
                <button
                  onClick={() => assignMut.mutate(sel.id)}
                  disabled={assignMut.isPending}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                >
                  {assignMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                  Assign to me
                </button>
                <div className="relative">
                  <select
                    value={sel.status}
                    onChange={(e) => statusMut.mutate({ id: sel.id, status: e.target.value as IncidentStatus })}
                    className="w-full appearance-none rounded-md border border-border bg-surface px-3 py-2 pr-8 text-xs font-medium hover:bg-surface-2"
                  >
                    {(Object.keys(statusMeta) as IncidentStatus[]).map((s) => (
                      <option key={s} value={s}>Change status: {statusMeta[s]}</option>
                    ))}
                  </select>
                  <ChevronRight className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 rotate-90 text-muted-foreground" />
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              No incidents in this window. Adjust the time range or filters, or log a new incident.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function SegBtn({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: any; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-medium ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
      <Icon className="h-3.5 w-3.5" /> {children}
    </button>
  );
}
function ToggleBtn({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: any; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] font-medium ${active ? "border-primary/40 bg-primary/10 text-foreground" : "border-border bg-surface text-muted-foreground hover:text-foreground"}`}>
      <Icon className="h-3.5 w-3.5" /> {children}
    </button>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-foreground truncate">{value}</div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  const m = s / 60; if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60; if (h < 24) return `${Math.floor(h)}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
