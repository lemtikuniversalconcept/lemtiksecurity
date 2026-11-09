import { createFileRoute } from "@tanstack/react-router";

/**
 * Position input for trackers that speak the OsmAnd protocol: the free Traccar Client app
 * (Android/iOS), and a Traccar server forwarding hardware GPS trackers.
 *
 *   https://app.lemtik.com.ng/tracker/osmand?id=<ID>&lat=..&lon=..&timestamp=..&speed=..&bearing=..&batt=..&accuracy=..
 *
 * <ID> is the subject's tracker secret (shown on the subject's page). A Traccar server can
 * send the device's own unique id instead, but only together with key=<MOVEMENT_FORWARD_KEY>.
 * Speed in this protocol is in knots.
 */

function num(v: string | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toIso(ts: string | null): string | null {
  if (!ts) return null;
  if (/^\d+(\.\d+)?$/.test(ts)) {
    const n = Number(ts);
    return new Date(n > 1e12 ? n : n * 1000).toISOString();
  }
  const d = Date.parse(ts);
  return Number.isFinite(d) ? new Date(d).toISOString() : null;
}

async function handle(request: Request) {
  const url = new URL(request.url);
  const params = new URLSearchParams(url.search);
  if (request.method === "POST") {
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("application/x-www-form-urlencoded")) {
      new URLSearchParams(await request.text()).forEach((v, k) => params.set(k, v));
    } else if (type.includes("application/json")) {
      // Traccar Client 9+ posts JSON: { device_id, location: { timestamp, coords: {...}, battery: {...} } }
      const body = (await request.json().catch(() => null)) as any;
      if (body?.device_id) params.set("id", String(body.device_id));
      const c = body?.location?.coords;
      if (c) {
        params.set("lat", String(c.latitude));
        params.set("lon", String(c.longitude));
        if (c.accuracy != null) params.set("accuracy", String(c.accuracy));
        if (c.heading != null) params.set("bearing", String(c.heading));
        if (c.speed != null && c.speed >= 0) params.set("speed_mps", String(c.speed));
      }
      if (body?.location?.timestamp) params.set("timestamp", String(body.location.timestamp));
      const level = body?.location?.battery?.level;
      if (level != null) params.set("batt", String(level <= 1 ? Math.round(level * 100) : level));
    }
  }

  const id = (params.get("id") ?? params.get("deviceid") ?? "").trim();
  const lat = num(params.get("lat"));
  const lng = num(params.get("lon") ?? params.get("lng"));
  if (!id || lat == null || lng == null) return new Response("missing id, lat or lon", { status: 400 });

  const { subjectByToken, subjectByDeviceId, ingestFix } = await import("@/lib/movement.server");
  const forwardKey = process.env.MOVEMENT_FORWARD_KEY?.trim();
  const subject = /^[0-9a-f]{32}$/i.test(id)
    ? await subjectByToken(id)
    : forwardKey && params.get("key") === forwardKey
      ? await subjectByDeviceId(id)
      : null;
  if (!subject) return new Response("unknown tracker", { status: 404 });

  const knots = num(params.get("speed"));
  const mps = num(params.get("speed_mps"));
  const batt = num(params.get("batt"));
  const result = await ingestFix(
    subject,
    {
      lat,
      lng,
      accuracy_m: num(params.get("accuracy") ?? params.get("hdop")),
      speed_mps: mps ?? (knots == null ? null : knots * 0.514444),
      heading: num(params.get("bearing") ?? params.get("heading")),
      battery: batt == null ? null : Math.max(0, Math.min(100, Math.round(batt))),
      recorded_at: toIso(params.get("timestamp")),
    },
    params.get("source") === "satellite" ? "satellite" : "device",
    params.get("alarm") === "sos" || params.get("sos") === "1",
  );
  return new Response(result.ok ? "ok" : result.reason ?? "rejected", { status: result.ok ? 200 : 403 });
}

export const Route = createFileRoute("/tracker/osmand")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
