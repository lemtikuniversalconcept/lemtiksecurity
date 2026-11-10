// Corridor Watch helpers: weather, curfew and the pre-departure boarding check.

export type Weather = {
  source: string;
  at: string;
  wind_kn: number | null; // highest sustained wind over the next 3 hours
  gust_kn: number | null;
  thunder: boolean;
  rain_mm: number | null;
  summary: string;
};
export type BoardingProblem = { code: "capacity" | "life_jackets" | "curfew" | "weather"; text: string };

const KN = 1.943844;
const cache = new Map<string, { at: number; w: Weather | null }>();

/**
 * MET Norway Locationforecast (free, CC BY 4.0, commercial use allowed with attribution).
 * Their terms ask for an identifying User-Agent; set MET_NO_USER_AGENT to include a contact.
 * Wave height isn't available for Nigerian waters from a free commercial-use source, so
 * this checks wind, gusts, rain and thunder only.
 */
export async function weatherAt(lat: number, lng: number): Promise<Weather | null> {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.w;
  let w: Weather | null = null;
  try {
    const res = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}`, {
      headers: { "User-Agent": process.env.MET_NO_USER_AGENT?.trim() || "LemtikSOD/1.0" },
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const j: any = await res.json();
      const series: any[] = (j?.properties?.timeseries ?? []).slice(0, 3);
      let wind: number | null = null;
      let gust: number | null = null;
      let rain = 0;
      let thunder = false;
      for (const t of series) {
        const d = t?.data?.instant?.details ?? {};
        if (typeof d.wind_speed === "number") wind = Math.max(wind ?? 0, d.wind_speed * KN);
        if (typeof d.wind_speed_of_gust === "number") gust = Math.max(gust ?? 0, d.wind_speed_of_gust * KN);
        const n1 = t?.data?.next_1_hours;
        if (typeof n1?.details?.precipitation_amount === "number") rain += n1.details.precipitation_amount;
        if (String(n1?.summary?.symbol_code ?? "").includes("thunder")) thunder = true;
      }
      const r = (n: number | null) => (n == null ? null : Math.round(n));
      w = {
        source: "MET Norway (CC BY 4.0)",
        at: new Date().toISOString(),
        wind_kn: r(wind),
        gust_kn: r(gust),
        thunder,
        rain_mm: Math.round(rain * 10) / 10,
        summary: `Next 3 h: wind up to ${r(wind) ?? "?"} kn${gust != null ? `, gusts ${r(gust)} kn` : ""}${rain ? `, ${Math.round(rain * 10) / 10} mm rain` : ", dry"}${thunder ? ", THUNDERSTORMS" : ""}`,
      };
    }
  } catch {
    w = null;
  }
  cache.set(key, { at: Date.now(), w });
  return w;
}

/** "HH:MM" in Lagos time. */
export function lagosClock(d = new Date()) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

export function inCurfew(start: string | null, end: string | null, d = new Date()) {
  if (!start || !end) return false;
  const t = lagosClock(d);
  const s = start.slice(0, 5);
  const e = end.slice(0, 5);
  return s <= e ? t >= s && t < e : t >= s || t < e;
}

export const DEFAULT_MAX_WIND_KN = 25;

export function boardingProblems(opts: {
  count: number;
  lifeJackets: number | null;
  capacity: number | null;
  isVessel: boolean;
  curfew: { start: string | null; end: string | null; corridor: string } | null;
  weather: Weather | null;
  maxWindKn: number;
}): BoardingProblem[] {
  const p: BoardingProblem[] = [];
  if (opts.capacity != null && opts.count > opts.capacity) p.push({ code: "capacity", text: `${opts.count} aboard but the boat is licensed for ${opts.capacity}` });
  if (opts.isVessel && (opts.lifeJackets == null || opts.lifeJackets < opts.count)) p.push({ code: "life_jackets", text: opts.lifeJackets == null ? "Life jackets not counted" : `Only ${opts.lifeJackets} life jackets for ${opts.count} people` });
  if (opts.curfew && inCurfew(opts.curfew.start, opts.curfew.end)) p.push({ code: "curfew", text: `${opts.curfew.corridor} is under curfew from ${opts.curfew.start!.slice(0, 5)} to ${opts.curfew.end!.slice(0, 5)}` });
  const w = opts.weather;
  if (w) {
    if (w.thunder) p.push({ code: "weather", text: "Thunderstorms forecast in the next 3 hours" });
    const worst = Math.max(w.wind_kn ?? 0, w.gust_kn != null ? w.gust_kn * 0.8 : 0);
    if (worst > opts.maxWindKn) p.push({ code: "weather", text: `Wind up to ${w.wind_kn} kn${w.gust_kn != null ? ` (gusts ${w.gust_kn} kn)` : ""}, above the ${opts.maxWindKn} kn limit` });
  }
  return p;
}

export function metres(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = (v: number) => (v * Math.PI) / 180;
  const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}
