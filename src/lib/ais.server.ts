// Nearby ships from AISStream (https://aisstream.io), a free public AIS feed. It's a live
// WebSocket stream with no "current positions" endpoint, so instead of running an always-on
// worker we listen for a few seconds when someone asks, and keep the result for a minute.
// Coverage depends on volunteer receivers and can be patchy; the UI says so.

import type { NearbyShip } from "./voyages.functions";

const LISTEN_MS = 12_000;
const MAX_SPAN_DEG = 3;
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; ships: NearbyShip[] }>();

type Box = { west: number; south: number; east: number; north: number };

function clampBox(b: Box): Box {
  const cx = (b.west + b.east) / 2;
  const cy = (b.south + b.north) / 2;
  const hw = Math.min(MAX_SPAN_DEG, Math.abs(b.east - b.west)) / 2;
  const hh = Math.min(MAX_SPAN_DEG, Math.abs(b.north - b.south)) / 2;
  return { west: cx - hw, east: cx + hw, south: cy - hh, north: cy + hh };
}

export async function aisSnapshot(input: Box): Promise<{ configured: boolean; ships: NearbyShip[]; listened_s: number; note?: string }> {
  const key = (process.env.AISSTREAM_API_KEY || "").trim();
  if (!key) return { configured: false, ships: [], listened_s: 0 };
  const WS = (globalThis as any).WebSocket as typeof WebSocket | undefined;
  if (!WS) return { configured: true, ships: [], listened_s: 0, note: "This server can't open live connections (needs Node 22 or later)." };

  const box = clampBox(input);
  const cacheKey = [box.west, box.south, box.east, box.north].map((n) => n.toFixed(2)).join(",");
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return { configured: true, ships: hit.ships, listened_s: 0 };

  const ships = new Map<string, NearbyShip>();
  const started = Date.now();
  let note: string | undefined;

  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      resolve();
    };
    const ws = new WS("wss://stream.aisstream.io/v0/stream");
    const timer = setTimeout(finish, LISTEN_MS);
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          APIKey: key,
          BoundingBoxes: [[[box.south, box.west], [box.north, box.east]]],
          FilterMessageTypes: ["PositionReport", "StandardClassBPositionReport", "ShipStaticData"],
        }),
      );
    };
    ws.onerror = () => {
      note = "Couldn't reach the AIS feed.";
      clearTimeout(timer);
      finish();
    };
    ws.onclose = () => {
      clearTimeout(timer);
      finish();
    };
    ws.onmessage = async (ev: MessageEvent) => {
      try {
        const text = typeof ev.data === "string" ? ev.data : await new Response(ev.data as any).text();
        const m = JSON.parse(text);
        if (m?.error) {
          note = "The AIS feed rejected the request. Check AISSTREAM_API_KEY.";
          return finish();
        }
        const meta = m?.MetaData;
        if (!meta?.MMSI) return;
        const mmsi = String(meta.MMSI);
        const prev = ships.get(mmsi);
        const name = typeof meta.ShipName === "string" && meta.ShipName.trim() ? meta.ShipName.trim() : prev?.name ?? null;
        if (m.MessageType === "ShipStaticData") {
          if (prev) prev.name = name;
          return;
        }
        const pr = m.Message?.PositionReport ?? m.Message?.StandardClassBPositionReport ?? {};
        const lat = Number(meta.latitude ?? pr.Latitude);
        const lng = Number(meta.longitude ?? pr.Longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
        const sog = Number(pr.Sog);
        const cog = Number(pr.Cog);
        ships.set(mmsi, {
          mmsi,
          name,
          lat,
          lng,
          speed_kn: Number.isFinite(sog) && sog < 102.3 ? sog : null,
          course: Number.isFinite(cog) && cog < 360 ? cog : null,
          at: typeof meta.time_utc === "string" ? meta.time_utc : null,
        });
        if (ships.size >= 500) finish();
      } catch {
        /* ignore a malformed message */
      }
    };
  });

  const list = [...ships.values()];
  if (!note) cache.set(cacheKey, { at: Date.now(), ships: list });
  return { configured: true, ships: list, listened_s: Math.round((Date.now() - started) / 1000), note };
}
