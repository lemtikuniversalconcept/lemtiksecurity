// Server-side calls to Mapbox web services. All of these sit inside Mapbox's free monthly
// allowances at Lemtik's size (Directions, Matrix and Isochrone: 100,000 a month each;
// temporary Geocoding: 100,000 a month). Each helper returns null instead of throwing, so a
// Mapbox outage or a missing token degrades a feature rather than breaking a page.

const BASE = "https://api.mapbox.com";

function token(): string | null {
  const t = (process.env.MAPBOX_SERVER_TOKEN || process.env.MAPBOX_PUBLIC_TOKEN || "").trim();
  return t || null;
}

// A token restricted to app URLs in the Mapbox dashboard checks the Referer header, which
// server requests don't send by default.
function referer(): string {
  return (process.env.APP_URL || process.env.PUBLIC_APP_URL || "https://app.lemtik.com.ng").replace(/\/+$/, "") + "/";
}

async function get<T>(path: string, params: Record<string, string | number | boolean | undefined>): Promise<T | null> {
  const t = token();
  if (!t) return null;
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  url.searchParams.set("access_token", t);
  try {
    const res = await fetch(url, { headers: { Referer: referer() }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      console.warn(`[mapbox] ${path.split("/").slice(0, 3).join("/")} -> ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    console.warn(`[mapbox] ${path.split("/").slice(0, 3).join("/")} failed`, (e as Error)?.message);
    return null;
  }
}

type LngLat = [number, number];
const pair = (p: LngLat) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;

export type Profile = "walking" | "driving" | "driving-traffic" | "cycling";

export type RouteResult = {
  geometry: { coordinates: LngLat[] };
  duration: number;
  distance: number;
  legs: Array<{ steps: Array<{ maneuver: { instruction: string }; distance: number }> }>;
};

/** Road route with turn-by-turn steps. */
export async function mapboxDirections(start: LngLat, end: LngLat, profile: Profile): Promise<RouteResult | null> {
  const r = await get<{ routes?: Array<{ geometry: { coordinates: LngLat[] }; duration: number; distance: number; legs: Array<{ steps: Array<{ maneuver: { instruction: string }; distance: number }> }> }> }>(
    `/directions/v5/mapbox/${profile}/${pair(start)};${pair(end)}`,
    { geometries: "geojson", steps: true, overview: "full" },
  );
  const route = r?.routes?.[0];
  if (!route) return null;
  return {
    geometry: { coordinates: route.geometry.coordinates },
    duration: route.duration,
    distance: route.distance,
    legs: route.legs.map((l) => ({ steps: l.steps.map((s) => ({ maneuver: { instruction: s.maneuver.instruction }, distance: s.distance })) })),
  };
}

/**
 * Travel time and road distance from each origin to one destination. Returns one entry per
 * origin, in order; an entry is null when Mapbox found no route. Up to 24 origins per call.
 */
export async function mapboxMatrixTo(origins: LngLat[], destination: LngLat, profile: Exclude<Profile, "cycling"> = "driving"): Promise<Array<{ duration: number; distance: number } | null> | null> {
  if (!origins.length) return [];
  const list = origins.slice(0, profile === "driving-traffic" ? 9 : 24);
  const coords = [...list, destination].map(pair).join(";");
  const r = await get<{ code?: string; durations?: (number | null)[][]; distances?: (number | null)[][] }>(`/directions-matrix/v1/mapbox/${profile}/${coords}`, {
    sources: list.map((_, i) => i).join(";"),
    destinations: String(list.length),
    annotations: "duration,distance",
  });
  if (!r?.durations) return null;
  return list.map((_, i) => {
    const d = r.durations?.[i]?.[0];
    const m = r.distances?.[i]?.[0];
    return d == null ? null : { duration: d, distance: m ?? 0 };
  });
}

/** Areas reachable from a point within each number of minutes (GeoJSON polygons). */
export async function mapboxIsochrone(center: LngLat, minutes: number[], profile: Exclude<Profile, "driving-traffic">) {
  return get<{ type: "FeatureCollection"; features: Array<{ type: "Feature"; properties: Record<string, string | number>; geometry: { type: string; coordinates: number[][][] } }> }>(
    `/isochrone/v1/mapbox/${profile}/${pair(center)}`,
    { contours_minutes: minutes.slice(0, 4).join(","), polygons: true, denoise: 1 },
  );
}

export type Place = { name: string; address: string; coord: LngLat };

/** Address and place search, biased towards a point and limited to Nigeria by default. */
export async function mapboxGeocode(q: string, near?: LngLat, country = "ng"): Promise<Place[] | null> {
  const r = await get<{ features?: Array<{ geometry: { coordinates: LngLat }; properties: { name?: string; full_address?: string; place_formatted?: string } }> }>(
    "/search/geocode/v6/forward",
    { q, limit: 5, country, proximity: near ? pair(near) : undefined, autocomplete: true },
  );
  if (!r?.features) return null;
  return r.features.map((f) => ({
    name: f.properties.name ?? q,
    address: f.properties.full_address ?? f.properties.place_formatted ?? "",
    coord: f.geometry.coordinates,
  }));
}

/**
 * Snap a GPS trail to the road or footpath network (Mapbox Map Matching, free up to 100,000
 * requests a month). Takes up to 100 points per call, so long trails are thinned first.
 * Returns null if Mapbox can't match the trail; the caller then shows the raw GPS line.
 */
export async function mapboxMatchTrail(points: LngLat[], profile: "driving" | "walking" | "cycling"): Promise<LngLat[] | null> {
  if (points.length < 2) return null;
  const step = Math.ceil(points.length / 100);
  const thinned = points.filter((_, i) => i % step === 0 || i === points.length - 1).slice(0, 100);
  const r = await get<{ matchings?: Array<{ geometry: { coordinates: LngLat[] }; confidence: number }> }>(
    `/matching/v5/mapbox/${profile}/${thinned.map(pair).join(";")}`,
    { geometries: "geojson", overview: "full", tidy: true },
  );
  if (!r?.matchings?.length) return null;
  return r.matchings.flatMap((m) => m.geometry.coordinates);
}
