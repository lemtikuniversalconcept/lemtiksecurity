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
  kind: "expanding_square" | "parallel_sweep" | "creek_sweep";
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

// ---------------------------------------------------------------- Creek mode
//
// In a creek or river the object can't spread sideways much: it moves up or down the channel
// with the river flow or the tide, wind pushes it only along the channel, and some of it
// catches in mangrove roots or on the bank and stops. The channel is a known line (a voyage
// route or corridor), so the result is a stretch of channel rather than an ellipse.

export type CreekFlow = "toward_end" | "toward_start" | "tidal";
export type CreekInput = DriftInput & { channel: [number, number][]; widthM: number; flow: CreekFlow };

const TIDE_MS = 12.42 * 3_600_000; // semi-diurnal tide
const SNAG_PER_HOUR = 0.05; // share that catches on the bank each hour

type Chain = { xy: [number, number][]; cum: number[]; total: number; lng0: number; lat0: number; cos: number };

function chain(route: [number, number][], lat0: number, lng0: number): Chain {
  const cos = mPerDegLng(lat0) / M_PER_DEG_LAT;
  const xy = route.map(([lng, lat]) => [(lng - lng0) * M_PER_DEG_LAT * cos, (lat - lat0) * M_PER_DEG_LAT] as [number, number]);
  const cum = [0];
  for (let i = 1; i < xy.length; i++) cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  return { xy, cum, total: cum[cum.length - 1], lng0, lat0, cos };
}

/** Distance along the chain of the point closest to (x, y), and how far off the line it is. */
function project(c: Chain, x: number, y: number) {
  let best = { s: 0, d: Infinity };
  for (let i = 1; i < c.xy.length; i++) {
    const [ax, ay] = c.xy[i - 1];
    const [bx, by] = c.xy[i];
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0;
    const d = Math.hypot(ax + t * dx - x, ay + t * dy - y);
    if (d < best.d) best = { s: c.cum[i - 1] + t * Math.sqrt(L2), d };
  }
  return best;
}

/** Point and unit tangent at distance s along the chain. */
function at(c: Chain, s: number) {
  const v = Math.max(0, Math.min(c.total, s));
  let i = 1;
  while (i < c.cum.length - 1 && c.cum[i] < v) i++;
  const [ax, ay] = c.xy[i - 1];
  const [bx, by] = c.xy[i];
  const L = c.cum[i] - c.cum[i - 1] || 1;
  const t = (v - c.cum[i - 1]) / L;
  return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, tx: (bx - ax) / L, ty: (by - ay) / L };
}

const toLL = (c: Chain, x: number, y: number): [number, number] => [c.lng0 + x / (M_PER_DEG_LAT * c.cos), c.lat0 + y / M_PER_DEG_LAT];

/** Centre line from s1 to s2, offset sideways by `off` metres (positive = left of the direction of travel along the chain). */
function stretch(c: Chain, s1: number, s2: number, off = 0, maxPts = 80): [number, number][] {
  const a = Math.max(0, Math.min(s1, s2));
  const b = Math.min(c.total, Math.max(s1, s2));
  const ss = [a, ...c.cum.filter((v) => v > a && v < b), b];
  const step = Math.max(1, Math.ceil(ss.length / maxPts));
  const pick = ss.filter((_, i) => i % step === 0 || i === ss.length - 1);
  return pick.map((s) => {
    const p = at(c, s);
    return toLL(c, p.x - p.ty * off, p.y + p.tx * off);
  });
}

function band(c: Chain, s1: number, s2: number, halfW: number): [number, number][] {
  const minLen = Math.max(halfW, 20);
  if (Math.abs(s2 - s1) < minLen) {
    const m = (s1 + s2) / 2;
    s1 = m - minLen / 2;
    s2 = m + minLen / 2;
  }
  const left = stretch(c, s1, s2, halfW);
  const right = stretch(c, s1, s2, -halfW).reverse();
  return [...left, ...right, left[0]];
}

export type CreekSnapshot = DriftSnapshot & { creek: { fromM: number; toM: number; snaggedPct: number; atEnd: boolean } };

/** Drift confined to a channel. Distances in the result are along the channel from its start. */
export function simulateCreekDrift(inp: CreekInput): CreekSnapshot[] {
  const r = rng(inp.seed);
  const L = LEEWAY[inp.objectType];
  const N = inp.particles ?? 2000;
  const c = chain(inp.channel, inp.lkp.lat, inp.lkp.lng);
  const s0 = project(c, 0, 0).s;
  const halfW = inp.widthM / 2;
  const s = new Float64Array(N);
  const amp = new Float64Array(N);
  const phase = new Float64Array(N);
  const rate = new Float64Array(N);
  const snag = new Uint8Array(N);
  const sigma0 = inp.lkp.errorM / 2;
  for (let i = 0; i < N; i++) {
    s[i] = s0 + gauss(r) * sigma0;
    rate[i] = Math.max(0, L.rate * (1 + gauss(r) * L.spread));
    const kn = inp.current ? Math.max(0, inp.current.kn * (1 + gauss(r) * 0.3)) : 0.2 + r() * 0.8;
    amp[i] = kn * 0.514444;
    phase[i] = r() * 2 * Math.PI; // tide state unknown unless the operator says which way it flows
  }
  const dirSign = inp.flow === "toward_end" ? 1 : inp.flow === "toward_start" ? -1 : 0;

  const STEP = 5 * 60_000;
  let t = inp.lkp.at;
  const out: CreekSnapshot[] = [];
  for (const target of inp.times) {
    while (t < target) {
      const dt = Math.min(STEP, target - t);
      const dts = dt / 1000;
      const w = windAt(inp.wind, t + dt / 2);
      const ws = Math.hypot(w.u, w.v);
      const snagP = 1 - Math.pow(1 - SNAG_PER_HOUR, dt / 3_600_000);
      const tideF = (t + dt / 2 - inp.lkp.at) / TIDE_MS;
      for (let i = 0; i < N; i++) {
        if (snag[i]) continue;
        if (r() < snagP) {
          snag[i] = 1;
          continue;
        }
        const p = at(c, s[i]);
        const lee = ws > 0.1 ? (rate[i] * ws + L.offsetMps) * (1 + gauss(r) * 0.15) : 0;
        const along = ws > 0.1 ? lee * ((w.u / ws) * p.tx + (w.v / ws) * p.ty) : 0;
        const cur = dirSign !== 0 ? dirSign * amp[i] : amp[i] * Math.sin(2 * Math.PI * tideF + phase[i]);
        s[i] = Math.max(0, Math.min(c.total, s[i] + (along + cur) * dts));
      }
      t += dt;
    }
    const sorted = Array.from(s).sort((a, b) => a - b);
    const q = (f: number) => sorted[Math.min(N - 1, Math.max(0, Math.floor(f * N)))];
    const a90 = q(0.05), b90 = q(0.95), a50 = q(0.25), b50 = q(0.75), med = q(0.5);
    const d = at(c, med);
    const sample: [number, number][] = [];
    const stride = Math.max(1, Math.floor(N / 400));
    for (let i = 0; i < N; i += stride) {
      const p = at(c, s[i]);
      const off = (r() * 2 - 1) * halfW * 0.8;
      sample.push(toLL(c, p.x - p.ty * off, p.y + p.tx * off));
    }
    let snagged = 0;
    let ends = 0;
    for (let i = 0; i < N; i++) {
      snagged += snag[i];
      if (s[i] <= 1 || s[i] >= c.total - 1) ends++;
    }
    const lenM = Math.max(b90 - a90, 1);
    out.push({
      at: target,
      datum: toLL(c, d.x, d.y),
      ellipse50: band(c, a50, b50, halfW),
      ellipse90: band(c, a90, b90, halfW),
      axes90: { majorM: lenM, minorM: inp.widthM, bearingDeg: ((Math.atan2(d.tx, d.ty) * 180) / Math.PI + 360) % 180 },
      areaKm2_90: (lenM * inp.widthM) / 1e6,
      sample,
      hoursAdrift: (target - inp.lkp.at) / 3_600_000,
      creek: { fromM: Math.round(a90), toM: Math.round(b90), snaggedPct: Math.round((snagged / N) * 100), atEnd: ends / N > 0.05 },
    });
  }
  return out;
}

/** Runs along the stretch of channel in lanes across its width, starting at the end nearest the datum. */
export function creekPattern(snap: CreekSnapshot, channel: [number, number][], widthM: number, spacingNm: number): SearchPattern {
  const c = chain(channel, snap.datum[1], snap.datum[0]);
  const S = Math.max(0.05, spacingNm) * NM;
  const lanes = Math.max(1, Math.min(6, Math.ceil(widthM / (2 * S))));
  const halfW = widthM / 2;
  const pts: [number, number][] = [];
  const { fromM, toM } = snap.creek;
  const dS = project(c, 0, 0).s;
  const startNearFrom = Math.abs(dS - fromM) <= Math.abs(toM - dS);
  for (let k = 0; k < lanes; k++) {
    const off = lanes === 1 ? 0 : -halfW + ((k + 0.5) * widthM) / lanes;
    const forward = (k % 2 === 0) === startNearFrom;
    const leg = stretch(c, fromM, toM, off, 40);
    pts.push(...(forward ? leg : leg.reverse()));
  }
  let trackM = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = (pts[i][0] - pts[i - 1][0]) * M_PER_DEG_LAT * c.cos;
    const dy = (pts[i][1] - pts[i - 1][1]) * M_PER_DEG_LAT;
    trackM += Math.hypot(dx, dy);
  }
  const km = ((toM - fromM) / 1000).toFixed(1);
  return {
    kind: "creek_sweep",
    spacingNm,
    waypoints: pts,
    trackNm: trackM / NM,
    coverage: `${lanes === 1 ? "One run down the middle" : `${lanes} runs across the width`} of the ${km} km stretch of creek. Check both banks, mangrove roots, jetties and moored boats, where people in the water often reach or get caught`,
  };
}
