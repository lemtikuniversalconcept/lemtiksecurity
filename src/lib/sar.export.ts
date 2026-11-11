import type { SarPlan } from "./sar.functions";

// Map files for the rescue package: KML (Google Earth, most chartplotters and navigation apps)
// and GeoJSON (GIS tools). Built in the browser from the plan already on screen.

type LL = [number, number];
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const ll = (p: LL): LL => [r6(p[0]), r6(p[1])];
const lagos = (ms: number) => new Date(ms).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

function features(p: SarPlan) {
  const c = p.case;
  const f = p.snapshots[p.focus];
  const out: { name: string; kind: string; geometry: { type: string; coordinates: unknown }; props: Record<string, unknown> }[] = [];
  out.push({ name: "Last known position", kind: "lkp", geometry: { type: "Point", coordinates: ll([c.lkp_lng, c.lkp_lat]) }, props: { time: c.lkp_at, accuracy_m: c.lkp_error_m } });
  if (p.creek) out.push({ name: `Channel followed (${p.creek.source ?? "creek"})`, kind: "channel", geometry: { type: "LineString", coordinates: p.creek.route.map(ll) }, props: { width_m: p.creek.widthM } });
  for (const s of p.snapshots) {
    const tag = `${s.label} · ${lagos(s.at)}`;
    out.push({ name: `90% area · ${tag}`, kind: "area90", geometry: { type: "Polygon", coordinates: [s.ellipse90.map(ll)] }, props: { time: new Date(s.at).toISOString(), area_km2: Math.round(s.areaKm2_90 * 100) / 100 } });
    out.push({ name: `50% area · ${tag}`, kind: "area50", geometry: { type: "Polygon", coordinates: [s.ellipse50.map(ll)] }, props: { time: new Date(s.at).toISOString() } });
    out.push({ name: `Datum · ${tag}`, kind: "datum", geometry: { type: "Point", coordinates: ll(s.datum) }, props: { time: new Date(s.at).toISOString() } });
  }
  const kind = p.pattern.kind === "expanding_square" ? "Expanding square" : p.pattern.kind === "creek_sweep" ? "Creek search" : "Parallel sweep";
  out.push({ name: `Search pattern · ${kind} for ${f.label}`, kind: "pattern", geometry: { type: "LineString", coordinates: p.pattern.waypoints.map(ll) }, props: { spacing_nm: p.pattern.spacingNm, track_nm: Math.round(p.pattern.trackNm * 10) / 10 } });
  p.pattern.waypoints.forEach((w, i) => out.push({ name: `WP${String(i + 1).padStart(2, "0")}`, kind: "waypoint", geometry: { type: "Point", coordinates: ll(w) }, props: { order: i + 1 } }));
  return out;
}

export function sarGeoJSON(p: SarPlan): string {
  return JSON.stringify(
    {
      type: "FeatureCollection",
      name: p.case.title,
      properties: { generated_at: p.generated_at, organisation: p.organisation, object: p.object.label, persons: p.case.persons, note: "First estimate from the Lemtik drift model. Not a replacement for the rescue centre's own planning." },
      features: features(p).map((x) => ({ type: "Feature", properties: { name: x.name, kind: x.kind, ...x.props }, geometry: x.geometry })),
    },
    null,
    1,
  );
}

const esc = (s: string) => s.replace(/[<>&'"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[ch]!);
const coords = (pts: LL[]) => pts.map((q) => `${r6(q[0])},${r6(q[1])},0`).join(" ");

// KML colours are aabbggrr.
const STYLES = `
<Style id="lkp"><IconStyle><color>ff111111</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>
<Style id="datum"><IconStyle><color>ff4b38f2</color><Icon><href>http://maps.google.com/mapfiles/kml/shapes/target.png</href></Icon></IconStyle></Style>
<Style id="waypoint"><IconStyle><color>ffff8b4f</color><scale>0.6</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_square.png</href></Icon></IconStyle><LabelStyle><scale>0.7</scale></LabelStyle></Style>
<Style id="area90"><LineStyle><color>ff0c59e8</color><width>2</width></LineStyle><PolyStyle><color>330c59e8</color></PolyStyle></Style>
<Style id="area50"><LineStyle><color>ff4b38f2</color><width>2</width></LineStyle><PolyStyle><color>224b38f2</color></PolyStyle></Style>
<Style id="pattern"><LineStyle><color>ffff8b4f</color><width>3</width></LineStyle></Style>
<Style id="channel"><LineStyle><color>aaa6938a</color><width>2</width></LineStyle></Style>`;

export function sarKML(p: SarPlan): string {
  const f = features(p);
  const geom = (g: { type: string; coordinates: any }) =>
    g.type === "Point"
      ? `<Point><coordinates>${coords([g.coordinates])}</coordinates></Point>`
      : g.type === "LineString"
        ? `<LineString><tessellate>1</tessellate><coordinates>${coords(g.coordinates)}</coordinates></LineString>`
        : `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords(g.coordinates[0])}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
  const pm = (x: (typeof f)[number], visible = true) =>
    `<Placemark><name>${esc(x.name)}</name><visibility>${visible ? 1 : 0}</visibility><styleUrl>#${x.kind}</styleUrl>${geom(x.geometry)}</Placemark>`;
  const focusTag = p.snapshots[p.focus].label;
  const isFocus = (x: (typeof f)[number]) => x.name.includes(`· ${focusTag} ·`);
  const areas = f.filter((x) => x.kind === "area90" || x.kind === "area50" || x.kind === "datum");
  const desc = `${p.object.label}${p.case.persons != null ? `, ${p.case.persons} aboard` : ""}. Generated ${lagos(Date.parse(p.generated_at))} Lagos time by Lemtik for ${p.organisation}. First estimate from a drift model, not a replacement for the rescue centre's own planning.`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<name>${esc(p.case.title)}</name><description>${esc(desc)}</description>${STYLES}
${f.filter((x) => x.kind === "lkp" || x.kind === "channel").map((x) => pm(x)).join("\n")}
<Folder><name>Search area over time</name>${areas.map((x) => pm(x, isFocus(x))).join("\n")}</Folder>
<Folder><name>Search pattern</name>${f.filter((x) => x.kind === "pattern").map((x) => pm(x)).join("\n")}
<Folder><name>Waypoints</name>${f.filter((x) => x.kind === "waypoint").map((x) => pm(x)).join("\n")}</Folder></Folder>
</Document></kml>`;
}

export function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function sarFileName(p: SarPlan, ext: string) {
  const slug = p.case.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "search-plan";
  const d = new Date(p.generated_at);
  const stamp = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z`;
  return `${slug}-${stamp}.${ext}`;
}
