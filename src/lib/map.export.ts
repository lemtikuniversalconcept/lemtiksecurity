import type { Corridor } from "./corridor.functions";
import type { VoyageReport } from "./voyages.functions";

// Map files for corridors and voyage tracks: KML (Google Earth, chartplotters, most navigation
// apps) and GeoJSON (QGIS, ArcGIS and other GIS tools). Built in the browser from what is
// already on screen, so nothing extra is fetched or sent anywhere.

type LL = [number, number];
type Geometry =
  | { type: "Point"; coordinates: LL }
  | { type: "LineString"; coordinates: LL[] }
  | { type: "Polygon"; coordinates: LL[][] };
export type MapFeature = { name: string; kind: string; geometry: Geometry; props: Record<string, unknown>; times?: string[]; description?: string };

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const ll = (p: LL): LL => [r6(p[0]), r6(p[1])];
const lagos = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * A polygon `halfWidthM` either side of a route, for showing a corridor's allowed band. Uses a
 * local flat projection (fine over the tens of kilometres a waterway corridor covers), mitred
 * corners capped at three times the width, and round ends.
 */
export function bufferLine(route: LL[], halfWidthM: number): LL[] {
  if (route.length < 2 || halfWidthM <= 0) return [];
  const lat0 = (route.reduce((s, p) => s + p[1], 0) / route.length) * (Math.PI / 180);
  const kx = 111_320 * Math.cos(lat0), ky = 110_540;
  const xy = route.map(([x, y]) => [x * kx, y * ky] as [number, number]);
  const back = ([x, y]: [number, number]): LL => [x / kx, y / ky];
  const norm = (a: [number, number], b: [number, number]) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l] as [number, number];
  };
  const side = (sign: 1 | -1) =>
    xy.map((p, i) => {
      const n1 = i > 0 ? norm(xy[i - 1], p) : norm(p, xy[i + 1]);
      const n2 = i < xy.length - 1 ? norm(p, xy[i + 1]) : n1;
      let nx = n1[0] + n2[0], ny = n1[1] + n2[1];
      const l = Math.hypot(nx, ny) || 1;
      nx /= l; ny /= l;
      const cos = nx * n1[0] + ny * n1[1];
      const m = Math.min(halfWidthM / Math.max(cos, 1e-6), halfWidthM * 3);
      return [p[0] + sign * nx * m, p[1] + sign * ny * m] as [number, number];
    });
  const cap = (centre: [number, number], from: [number, number], steps = 8) => {
    const a0 = Math.atan2(from[1] - centre[1], from[0] - centre[0]);
    return Array.from({ length: steps - 1 }, (_, k) => {
      const a = a0 - (Math.PI * (k + 1)) / steps;
      return [centre[0] + Math.cos(a) * halfWidthM, centre[1] + Math.sin(a) * halfWidthM] as [number, number];
    });
  };
  const left = side(1), right = side(-1).reverse();
  const ring = [...left, ...cap(xy[xy.length - 1], left[left.length - 1]), ...right, ...cap(xy[0], right[right.length - 1])];
  ring.push(ring[0]);
  return ring.map(back).map(ll);
}

function corridorFeatures(c: Corridor): MapFeature[] {
  const props = { corridor: c.name, half_width_m: c.corridor_m, curfew_start: c.curfew_start, curfew_end: c.curfew_end, max_wind_kn: c.max_wind_kn ?? 25, in_use: c.active };
  const desc = `Keep within ${c.corridor_m} m of the route. ${c.curfew_start ? `Curfew ${c.curfew_start} to ${c.curfew_end}.` : "No curfew."} Wind limit ${c.max_wind_kn ?? 25} kn.${c.notes ? ` ${c.notes}` : ""}`;
  const out: MapFeature[] = [];
  if (c.route.length >= 2) {
    const band = bufferLine(c.route, c.corridor_m);
    if (band.length) out.push({ name: `${c.name}: allowed band (±${c.corridor_m} m)`, kind: "band", geometry: { type: "Polygon", coordinates: [band] }, props, description: desc });
    out.push({ name: `${c.name}: route`, kind: "route", geometry: { type: "LineString", coordinates: c.route.map(ll) }, props, description: desc });
    out.push({ name: `${c.name}: start`, kind: "start", geometry: { type: "Point", coordinates: ll(c.route[0]) }, props: { corridor: c.name } });
    out.push({ name: `${c.name}: end`, kind: "end", geometry: { type: "Point", coordinates: ll(c.route[c.route.length - 1]) }, props: { corridor: c.name } });
  }
  return out;
}

function voyageFeatures(r: VoyageReport): MapFeature[] {
  const v = r.voyage;
  const boat = r.subject?.name ?? "Boat";
  const out: MapFeature[] = [];
  const route = (v.route ?? []) as LL[];
  if (route.length >= 2) {
    if (v.corridor_m) {
      const band = bufferLine(route, v.corridor_m);
      if (band.length) out.push({ name: `Allowed band (±${v.corridor_m} m)`, kind: "band", geometry: { type: "Polygon", coordinates: [band] }, props: { half_width_m: v.corridor_m } });
    }
    out.push({ name: "Planned route", kind: "route", geometry: { type: "LineString", coordinates: route.map(ll) }, props: { planned_departure: v.planned_departure, planned_arrival: v.planned_arrival } });
  }
  if (r.track.length >= 2) {
    out.push({
      name: `Recorded track: ${boat}`,
      kind: "track",
      geometry: { type: "LineString", coordinates: r.track.map(ll) },
      props: { boat, departed_at: v.departed_at, arrived_at: v.arrived_at, positions: r.stats.positions, distance_m: r.stats.distance_m },
      times: r.track_at.length === r.track.length ? r.track_at : undefined,
    });
  }
  if (r.track.length) {
    out.push({ name: `Departed${v.departed_at ? ` ${lagos(v.departed_at)}` : ""}`, kind: "start", geometry: { type: "Point", coordinates: ll(r.track[0]) }, props: { time: v.departed_at, people_aboard: v.departure_count } });
    out.push({ name: v.arrived_at ? `Arrived ${lagos(v.arrived_at)}` : "Last position", kind: "end", geometry: { type: "Point", coordinates: ll(r.track[r.track.length - 1]) }, props: { time: v.arrived_at ?? r.track_at[r.track_at.length - 1] ?? null, people_aboard: v.arrival_count } });
  }
  for (const a of r.alerts) {
    if (a.lat == null || a.lng == null) continue;
    out.push({ name: `${lagos(a.created_at)} · ${a.message}`.slice(0, 160), kind: a.severity >= 4 ? "alert_high" : "alert", geometry: { type: "Point", coordinates: ll([a.lng, a.lat]) }, props: { kind: a.kind, severity: a.severity, time: a.created_at, acknowledged_at: a.acknowledged_at } });
  }
  return out;
}

function geojson(name: string, meta: Record<string, unknown>, features: MapFeature[]) {
  return JSON.stringify(
    {
      type: "FeatureCollection",
      name,
      properties: meta,
      features: features.map((f) => ({ type: "Feature", properties: { name: f.name, kind: f.kind, ...f.props, ...(f.times ? { times: f.times } : {}) }, geometry: f.geometry })),
    },
    null,
    1,
  );
}

const esc = (s: string) => s.replace(/[<>&'"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[ch]!);
const coords = (pts: LL[]) => pts.map((q) => `${r6(q[0])},${r6(q[1])},0`).join(" ");
// KML colours are aabbggrr.
const STYLES = `
<Style id="band"><LineStyle><color>ff2bd576</color><width>1.5</width></LineStyle><PolyStyle><color>332bd576</color></PolyStyle></Style>
<Style id="route"><LineStyle><color>ffa6938a</color><width>3</width></LineStyle></Style>
<Style id="track"><LineStyle><color>ffff8b4f</color><width>3</width></LineStyle><IconStyle><scale>0</scale></IconStyle></Style>
<Style id="start"><IconStyle><color>ff2bd576</color><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>
<Style id="end"><IconStyle><color>ff111111</color><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>
<Style id="alert"><IconStyle><color>ff24a5f5</color><Icon><href>http://maps.google.com/mapfiles/kml/shapes/caution.png</href></Icon></IconStyle><LabelStyle><scale>0.7</scale></LabelStyle></Style>
<Style id="alert_high"><IconStyle><color>ff4b38f2</color><Icon><href>http://maps.google.com/mapfiles/kml/shapes/caution.png</href></Icon></IconStyle><LabelStyle><scale>0.7</scale></LabelStyle></Style>`;

function placemark(f: MapFeature) {
  const g = f.geometry;
  const desc = f.description ? `<description>${esc(f.description)}</description>` : "";
  // A timed track becomes a gx:Track, so Google Earth can play it back with its time slider.
  if (f.times && g.type === "LineString") {
    return `<Placemark><name>${esc(f.name)}</name>${desc}<styleUrl>#${f.kind}</styleUrl><gx:Track><altitudeMode>clampToGround</altitudeMode>${f.times.map((t) => `<when>${t}</when>`).join("")}${g.coordinates.map((c) => `<gx:coord>${r6(c[0])} ${r6(c[1])} 0</gx:coord>`).join("")}</gx:Track></Placemark>`;
  }
  const body =
    g.type === "Point"
      ? `<Point><coordinates>${coords([g.coordinates])}</coordinates></Point>`
      : g.type === "LineString"
        ? `<LineString><tessellate>1</tessellate><coordinates>${coords(g.coordinates)}</coordinates></LineString>`
        : `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords(g.coordinates[0])}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
  const when = typeof f.props.time === "string" ? `<TimeStamp><when>${f.props.time}</when></TimeStamp>` : "";
  return `<Placemark><name>${esc(f.name)}</name>${desc}${when}<styleUrl>#${f.kind}</styleUrl>${body}</Placemark>`;
}

function kml(name: string, desc: string, folders: { name: string; features: MapFeature[] }[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document>
<name>${esc(name)}</name><description>${esc(desc)}</description>${STYLES}
${folders.filter((f) => f.features.length).map((f) => `<Folder><name>${esc(f.name)}</name>\n${f.features.map(placemark).join("\n")}\n</Folder>`).join("\n")}
</Document></kml>`;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "map";
const stamp = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
};

/** One corridor, or every corridor in one file. */
export function corridorsExport(list: Corridor[], org: string, format: "kml" | "geojson") {
  const title = list.length === 1 ? list[0].name : `${org || "Lemtik"} corridors`;
  const desc = `Approved corridors exported from Lemtik${org ? ` for ${org}` : ""} on ${lagos(new Date().toISOString())} Lagos time. The shaded band is the area boats must keep to.`;
  const name = `${slug(title)}-${stamp()}.${format === "kml" ? "kml" : "geojson"}`;
  if (format === "geojson") return { name, type: "application/geo+json", body: geojson(title, { organisation: org, exported_at: new Date().toISOString(), note: desc }, list.flatMap(corridorFeatures)) };
  return { name, type: "application/vnd.google-earth.kml+xml", body: kml(title, desc, list.map((c) => ({ name: c.name, features: corridorFeatures(c) }))) };
}

/** A voyage's planned route, allowed band, recorded track (timed) and where alerts were raised. */
export function voyageExport(r: VoyageReport, format: "kml" | "geojson") {
  const f = voyageFeatures(r);
  const title = `${r.voyage.name}${r.subject ? ` · ${r.subject.name}` : ""}`;
  const desc = `Voyage exported from Lemtik for ${r.organisation} on ${lagos(r.generated_at)} Lagos time. ${r.stats.positions} positions recorded${r.stats.distance_m ? `, ${(r.stats.distance_m / 1000).toFixed(1)} km travelled` : ""}.`;
  const name = `${slug(title)}-${stamp()}.${format === "kml" ? "kml" : "geojson"}`;
  if (format === "geojson") return { name, type: "application/geo+json", body: geojson(title, { organisation: r.organisation, boat: r.subject?.name ?? null, mmsi: r.subject?.mmsi ?? null, exported_at: r.generated_at, note: desc }, f) };
  return {
    name,
    type: "application/vnd.google-earth.kml+xml",
    body: kml(title, desc, [
      { name: "Plan", features: f.filter((x) => x.kind === "band" || x.kind === "route") },
      { name: "What happened", features: f.filter((x) => x.kind === "track" || x.kind === "start" || x.kind === "end") },
      { name: "Alerts", features: f.filter((x) => x.kind.startsWith("alert")) },
    ]),
  };
}
