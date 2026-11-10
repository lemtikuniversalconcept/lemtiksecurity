// Search-and-rescue drift model.
//
// A Monte Carlo estimate: thousands of possible "objects" start around the last known position
// (spread by its uncertainty), then each drifts with the wind (leeway) and the water current,
// with the uncertainty in both drawn at random. The cloud of where they end up is the search
// area. It grows with time, which is why speed matters.
//
// Limits, stated on screen: wind comes from the MET Norway forecast at the last known position
// (the same wind is applied across the area); the current is what the operator enters, because
// no free current forecast covers Nigerian waters; shorelines are not modelled.

export type ObjectType = "person_in_water" | "person_with_lifejacket" | "life_raft" | "small_boat" | "disabled_powerboat" | "canoe";

/**
 * Approximate leeway (drift through the water caused by wind) as a share of wind speed, with the
 * typical angle either side of downwind. Order-of-magnitude values of the kind used in search
 * planning; a first estimate, not a substitute for the rescue centre's own tools.
 */
export const LEEWAY: Record<ObjectType, { label: string; rate: number; offsetMps: number; spread: number; divergenceDeg: number; sweepNm: number }> = {
  person_in_water: { label: "Person in the water", rate: 0.011, offsetMps: 0.07, spread: 0.3, divergenceDeg: 0, sweepNm: 0.1 },
  person_with_lifejacket: { label: "Person in a life jacket", rate: 0.015, offsetMps: 0.05, spread: 0.3, divergenceDeg: 10, sweepNm: 0.2 },
  life_raft: { label: "Life raft", rate: 0.035, offsetMps: 0.05, spread: 0.3, divergenceDeg: 25, sweepNm: 0.6 },
  small_boat: { label: "Small open boat", rate: 0.035, offsetMps: 0.04, spread: 0.3, divergenceDeg: 25, sweepNm: 1.0 },
  disabled_powerboat: { label: "Disabled powerboat", rate: 0.04, offsetMps: 0.04, spread: 0.3, divergenceDeg: 30, sweepNm: 1.2 },
  canoe: { label: "Canoe or dugout", rate: 0.03, offsetMps: 0.03, spread: 0.35, divergenceDeg: 25, sweepNm: 0.5 },
};

export type WindHour = { at: number; u: number; v: number }; // m/s, u = east, v = north (direction the wind blows TOWARD)

/** Hourly wind at a point from MET Norway (free, CC BY 4.0). */
export async function windSeries(lat: number, lng: number): Promise<WindHour[]> {
  try {
    const res = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}`, {
      headers: { "User-Agent": process.env.MET_NO_USER_AGENT?.trim() || "LemtikSOD/1.0" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return [];
    const j: any = await res.json();
    return ((j?.properties?.timeseries ?? []) as any[])
      .map((t) => {
        const d = t?.data?.instant?.details ?? {};
        if (typeof d.wind_speed !== "number" || typeof d.wind_from_direction !== "number") return null;
        const toward = ((d.wind_from_direction + 180) % 360) * (Math.PI / 180);
        return { at: Date.parse(t.time), u: d.wind_speed * Math.sin(toward), v: d.wind_speed * Math.cos(toward) };
      })
      .filter(Boolean) as WindHour[];
  } catch {
    return [];
  }
}

function windAt(series: WindHour[], t: number): { u: number; v: number } {
  if (!series.length) return { u: 0, v: 0 };
  if (t <= series[0].at) return series[0];
  for (let i = 1; i < series.length; i++) {
    if (t <= series[i].at) {
      const a = series[i - 1];
      const b = series[i];
      const f = (t - a.at) / (b.at - a.at);
      return { u: a.u + (b.u - a.u) * f, v: a.v + (b.v - a.v) * f };
    }
  }
  return series[series.length - 1];
}

// Seeded random numbers so the same plan gives the same picture every time it's opened.
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}
function gauss(r: () => number) {
  const u = Math.max(r(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

const M_PER_DEG_LAT = 111_320;
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

export type DriftInput = {
  seed: number;
  objectType: ObjectType;
  lkp: { lat: number; lng: number; at: number; errorM: number };
  current: { kn: number; towardDeg: number } | null; // null = unknown
  wind: WindHour[];
  times: number[]; // epoch ms to report the area at, ascending
  particles?: number;
};

export type DriftSnapshot = {
  at: number;
  datum: [number, number]; // [lng, lat], centre of the probability cloud
  ellipse50: [number, number][];
  ellipse90: [number, number][];
  axes90: { majorM: number; minorM: number; bearingDeg: number };
  areaKm2_90: number;
  sample: [number, number][];
  hoursAdrift: number;
};

/** Runs the particle drift and returns the probability area at each requested time. */
export function simulateDrift(inp: DriftInput): DriftSnapshot[] {
  const r = rng(inp.seed);
  const L = LEEWAY[inp.objectType];
  const N = inp.particles ?? 2000;
  const cosLat = mPerDegLng(inp.lkp.lat) / M_PER_DEG_LAT;
  // Positions in metres east/north of the last known position.
  const x = new Float64Array(N);
  const y = new Float64Array(N);
  const rate = new Float64Array(N);
  const side = new Float64Array(N);
  const cu = new Float64Array(N);
  const cv = new Float64Array(N);
  const sigma0 = inp.lkp.errorM / 2; // errorM read as roughly 2-sigma
  for (let i = 0; i < N; i++) {
    x[i] = gauss(r) * sigma0;
    y[i] = gauss(r) * sigma0;
    rate[i] = Math.max(0, L.rate * (1 + gauss(r) * L.spread));
    side[i] = (r() < 0.5 ? -1 : 1) * L.divergenceDeg * (0.5 + r() * 0.5) * (Math.PI / 180);
    if (inp.current) {
      const kn = Math.max(0, inp.current.kn * (1 + gauss(r) * 0.3));
      const dir = (inp.current.towardDeg + gauss(r) * 20) * (Math.PI / 180);
      cu[i] = kn * 0.514444 * Math.sin(dir);
      cv[i] = kn * 0.514444 * Math.cos(dir);
    } else {
      // Unknown current: anything up to about half a knot, any direction.
      const kn = r() * 0.5;
      const dir = r() * 2 * Math.PI;
      cu[i] = kn * 0.514444 * Math.sin(dir);
      cv[i] = kn * 0.514444 * Math.cos(dir);
    }
  }

  const STEP = 10 * 60_000;
  let t = inp.lkp.at;
  const out: DriftSnapshot[] = [];
  for (const target of inp.times) {
    while (t < target) {
      const dt = Math.min(STEP, target - t);
      const w = windAt(inp.wind, t + dt / 2);
      const ws = Math.hypot(w.u, w.v);
      const wdir = Math.atan2(w.u, w.v);
      const dts = dt / 1000;
      for (let i = 0; i < N; i++) {
        const lee = ws > 0.1 ? rate[i] * ws + L.offsetMps : 0;
        const d = wdir + side[i];
        // Wind error: about 2 m/s and 20 degrees on the forecast.
        const jitter = 1 + gauss(r) * 0.15;
        x[i] += (lee * jitter * Math.sin(d) + cu[i]) * dts;
        y[i] += (lee * jitter * Math.cos(d) + cv[i]) * dts;
      }
      t += dt;
    }
    out.push(snapshot(x, y, inp.lkp, cosLat, target, r));
  }
  return out;
}

function snapshot(x: Float64Array, y: Float64Array, lkp: DriftInput["lkp"], cosLat: number, at: number, r: () => number): DriftSnapshot {
  const N = x.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < N; i++) {
    mx += x[i];
    my += y[i];
  }
  mx /= N;
  my /= N;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < N; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  sxx /= N;
  syy /= N;
  sxy /= N;
  // Principal axes of the cloud.
  const tr = (sxx + syy) / 2;
  const det = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy));
  const l1 = tr + det;
  const l2 = Math.max(tr - det, 1);
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy); // angle from east, counter-clockwise
  const toLngLat = (ex: number, ny: number): [number, number] => [lkp.lng + ex / (M_PER_DEG_LAT * cosLat), lkp.lat + ny / M_PER_DEG_LAT];
  const ellipse = (k: number) => {
    const pts: [number, number][] = [];
    for (let a = 0; a <= 64; a++) {
      const p = (a / 64) * 2 * Math.PI;
      const ex = k * Math.sqrt(l1) * Math.cos(p);
      const ey = k * Math.sqrt(l2) * Math.sin(p);
      pts.push(toLngLat(mx + ex * Math.cos(theta) - ey * Math.sin(theta), my + ex * Math.sin(theta) + ey * Math.cos(theta)));
    }
    return pts;
  };
  // 2-D normal: 50% inside 1.177σ, 90% inside 2.146σ.
  const k90 = 2.146;
  const sample: [number, number][] = [];
  const stride = Math.max(1, Math.floor(N / 400));
  for (let i = Math.floor(r() * stride); i < N; i += stride) sample.push(toLngLat(x[i], y[i]));
  const majorM = 2 * k90 * Math.sqrt(l1);
  const minorM = 2 * k90 * Math.sqrt(l2);
  return {
    at,
    datum: toLngLat(mx, my),
    ellipse50: ellipse(1.177),
    ellipse90: ellipse(k90),
    axes90: { majorM, minorM, bearingDeg: (((90 - (theta * 180) / Math.PI) % 180) + 180) % 180 },
    areaKm2_90: (Math.PI * (majorM / 2) * (minorM / 2)) / 1e6,
    sample,
    hoursAdrift: (at - lkp.at) / 3_600_000,
  };
}

export type SearchPattern = {
  kind: "expanding_square" | "parallel_sweep";
  spacingNm: number;
  waypoints: [number, number][];
  trackNm: number;
  coverage: string;
};

const NM = 1852;

/**
 * Expanding square from the datum when the area is small (a recent, well-fixed position);
 * otherwise parallel tracks across the 90% area, laid along its long axis.
 */
export function searchPattern(s: DriftSnapshot, spacingNm: number): SearchPattern {
  const [lng0, lat0] = s.datum;
  const cos = mPerDegLng(lat0) / M_PER_DEG_LAT;
  const toLL = (ex: number, ny: number): [number, number] => [lng0 + ex / (M_PER_DEG_LAT * cos), lat0 + ny / M_PER_DEG_LAT];
  const S = Math.max(0.05, spacingNm) * NM;
  const len = (pts: [number, number][]) => {
    let d = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = (pts[i][0] - pts[i - 1][0]) * M_PER_DEG_LAT * cos;
      const dy = (pts[i][1] - pts[i - 1][1]) * M_PER_DEG_LAT;
      d += Math.hypot(dx, dy);
    }
    return d / NM;
  };

  if (s.axes90.majorM <= 8 * S) {
    // Expanding square: legs of 1,1,2,2,3,3… spacings, turning right, until it covers the area.
    const half = s.axes90.majorM / 2;
    const pts: [number, number][] = [toLL(0, 0)];
    let ex = 0;
    let ny = 0;
    const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    for (let leg = 0; leg < 60; leg++) {
      const n = Math.floor(leg / 2) + 1;
      const [dx, dy] = dirs[leg % 4];
      ex += dx * n * S;
      ny += dy * n * S;
      pts.push(toLL(ex, ny));
      if (n * S / 2 > half + S) break;
    }
    return { kind: "expanding_square", spacingNm, waypoints: pts, trackNm: len(pts), coverage: "Starts at the datum (most likely position) and spirals outward in square legs" };
  }

  const b = (s.axes90.bearingDeg * Math.PI) / 180; // long axis, bearing from north
  const ax = Math.sin(b);
  const ay = Math.cos(b);
  const px = Math.cos(b);
  const py = -Math.sin(b);
  const halfLen = s.axes90.majorM / 2;
  const halfWid = s.axes90.minorM / 2;
  const tracks = Math.max(2, Math.ceil((2 * halfWid) / S) + 1);
  const pts: [number, number][] = [];
  for (let k = 0; k < tracks; k++) {
    const off = -halfWid + k * S;
    const sgn = k % 2 === 0 ? 1 : -1;
    pts.push(toLL(off * px - sgn * halfLen * ax, off * py - sgn * halfLen * ay));
    pts.push(toLL(off * px + sgn * halfLen * ax, off * py + sgn * halfLen * ay));
  }
  return { kind: "parallel_sweep", spacingNm, waypoints: pts, trackNm: len(pts), coverage: `${tracks} parallel tracks along the drift axis, ${spacingNm} nm apart, covering the 90% area` };
}
