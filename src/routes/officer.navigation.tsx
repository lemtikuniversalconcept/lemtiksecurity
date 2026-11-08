import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, Loader2, MapPinned, RefreshCw } from "lucide-react";
import { getMapboxToken } from "@/lib/config.functions";
import { calculateRoute } from "@/lib/patrols.functions";
import { Notice } from "@/components/nw";
import { fmtDistance, getPosition, metersBetween, NetPill, useMyDispatch, useOnline } from "@/components/officer/kit";

export const Route = createFileRoute("/officer/navigation")({
  component: OfficerNavigation,
});

type Coord = [number, number];
type Plan =
  | { kind: "road"; coords: Coord[]; steps: string[]; distance: number; minutes: number }
  | { kind: "straight"; distance: number; bearing: string };

function bearingLabel(from: Coord, to: Coord) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(to[0] - from[0])) * Math.cos(toRad(to[1]));
  const x = Math.cos(toRad(from[1])) * Math.sin(toRad(to[1])) - Math.sin(toRad(from[1])) * Math.cos(toRad(to[1])) * Math.cos(toRad(to[0] - from[0]));
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  const names = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  return names[Math.round(deg / 45) % 8];
}

function OfficerNavigation() {
  const tokenFn = useServerFn(getMapboxToken);
  const routeFn = useServerFn(calculateRoute);
  const { data: token } = useQuery({ queryKey: ["mapbox-token"], queryFn: () => tokenFn(), staleTime: Infinity });
  const { dispatch, isLoading, arrived } = useMyDispatch();
  const online = useOnline();
  const [here, setHere] = useState<Coord | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [routing, setRouting] = useState(false);
  const [routeNote, setRouteNote] = useState<string | null>(null);
  const [arrival, setArrival] = useState<{ state: "idle" | "busy" | "done" | "fail"; text?: string }>({ state: "idle" });
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  const inc = dispatch?.incident;
  const dest: Coord | null = inc && inc.coord_x != null && inc.coord_y != null ? [Number(inc.coord_x), Number(inc.coord_y)] : null;

  const locate = useCallback(() => {
    setGpsError(null);
    getPosition(10_000)
      .then((p) => setHere([p.coords.longitude, p.coords.latitude]))
      .catch((e) => setGpsError(e instanceof Error ? e.message : "Couldn't get your location."));
  }, []);
  useEffect(() => locate(), [locate]);

  const buildRoute = useCallback(async () => {
    if (!here || !dest) return;
    const straight: Plan = { kind: "straight", distance: metersBetween(here, dest), bearing: bearingLabel(here, dest) };
    if (!online) {
      setPlan(straight);
      setRouteNote("You're offline, so there's no road route. Use the direction and distance below.");
      return;
    }
    setRouting(true);
    try {
      const r = (await routeFn({ data: { start: here, destination: dest, mode: "walking", incident_id: inc.id } })) as {
        geometry?: { coordinates?: Coord[] };
        duration?: number;
        distance?: number;
        legs?: Array<{ steps?: Array<{ maneuver?: { instruction?: string } }> }>;
      } | null;
      const coords = r?.geometry?.coordinates;
      if (!coords?.length) throw new Error("no route");
      setPlan({
        kind: "road",
        coords,
        steps: (r?.legs?.[0]?.steps ?? []).map((s) => s.maneuver?.instruction).filter((x): x is string => !!x),
        distance: r?.distance ?? straight.distance,
        minutes: (r?.duration ?? 0) / 60,
      });
      setRouteNote(null);
    } catch {
      setPlan(straight);
      setRouteNote("The routing service didn't return a road route. Use the direction and distance below.");
    } finally {
      setRouting(false);
    }
  }, [here, dest?.[0], dest?.[1], online, inc?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => void buildRoute(), [buildRoute]);

  useEffect(() => {
    if (!token?.token || !mapEl.current || !dest) return;
    mapboxgl.accessToken = token.token;
    const map = new mapboxgl.Map({ container: mapEl.current, style: "mapbox://styles/mapbox/dark-v11", center: dest, zoom: 15, attributionControl: false });
    mapRef.current = map;
    map.on("load", () => {
      const line: Coord[] = plan?.kind === "road" ? plan.coords : here ? [here, dest] : [];
      if (line.length >= 2) {
        map.addSource("nav", { type: "geojson", data: { type: "Feature", geometry: { type: "LineString", coordinates: line }, properties: {} } as any });
        map.addLayer({
          id: "nav",
          type: "line",
          source: "nav",
          layout: { "line-cap": "round" },
          paint: plan?.kind === "road" ? { "line-color": "#7A9BFF", "line-width": 5 } : { "line-color": "#F5A524", "line-width": 3, "line-dasharray": [1.5, 1.5] },
        });
      }
      const dot = (bg: string) => {
        const el = document.createElement("span");
        el.style.cssText = `width:18px;height:18px;border-radius:9px;background:${bg};box-shadow:0 0 0 3px #0A0C10`;
        return el;
      };
      new mapboxgl.Marker({ element: dot("#F2384B") }).setLngLat(dest).addTo(map);
      if (here) new mapboxgl.Marker({ element: dot("#7A9BFF") }).setLngLat(here).addTo(map);
      const b = new mapboxgl.LngLatBounds();
      for (const c of line.length ? line : [dest]) b.extend(c);
      map.fitBounds(b, { padding: 50, maxZoom: 17, duration: 0 });
    });
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [token?.token, plan, here?.[0], here?.[1], dest?.[0], dest?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  const logArrival = async () => {
    setArrival({ state: "busy" });
    try {
      await arrived(here ? { lat: here[1], lng: here[0] } : null);
      setArrival({ state: "done", text: "Arrival logged on the incident timeline. Command can see it." });
    } catch (e) {
      setArrival({ state: "fail", text: `${(e as Error)?.message || "Arrival wasn't logged."} Tell command on the radio.` });
    }
  };

  const header = (
    <div className="o-h">
      <Link to="/officer/dispatch" className="ibtn" aria-label="Back to dispatch">
        <ChevronLeft size={18} />
      </Link>
      <div className="col f1" style={{ minWidth: 0 }}>
        <span className="t3">{inc ? inc.code : "Navigation"}</span>
        <h1 className="trunc">{inc ? inc.location : "No destination"}</h1>
      </div>
      <NetPill />
    </div>
  );

  if (isLoading) return <div className="o-b t3">Loading…</div>;
  if (!dispatch) {
    return (
      <>
        {header}
        <div className="o-b">
          <div className="o-card t2">There's nothing to navigate to. Routes appear here when command dispatches you.</div>
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      {token?.token && dest ? <div className="map" style={{ height: 300, borderRadius: 0, borderLeft: 0, borderRight: 0 }}><div ref={mapEl} className="absolute inset-0" /></div> : null}
      <div className="o-b">
        {!dest && <Notice tone="warn">This incident has no map pin, so there's no route. Go to "{inc.location}" and ask command if unsure.</Notice>}
        {gpsError && (
          <Notice tone="warn">
            {gpsError}{" "}
            <button type="button" className="lnk" onClick={locate}>
              Try again
            </button>
          </Notice>
        )}
        {routeNote && <Notice tone="warn">{routeNote}</Notice>}

        {plan && (
          <div className="row g10">
            <div className="o-card f1 col">
              <span className="o-lbl">{plan.kind === "road" ? "Route distance" : "Straight line"}</span>
              <b className="mono" style={{ fontSize: 20 }}>
                {fmtDistance(plan.distance)}
              </b>
            </div>
            <div className="o-card f1 col">
              <span className="o-lbl">{plan.kind === "road" ? "Walking time" : "Direction"}</span>
              <b className="mono" style={{ fontSize: 20 }}>
                {plan.kind === "road" ? `${Math.max(1, Math.round(plan.minutes))} min` : plan.bearing}
              </b>
            </div>
          </div>
        )}

        {plan?.kind === "road" && plan.steps.length > 0 && (
          <ol className="o-card col g8" style={{ margin: 0, paddingLeft: 30 }}>
            {plan.steps.map((s, i) => (
              <li key={i} style={{ fontSize: 14 }}>
                {s}
              </li>
            ))}
          </ol>
        )}

        <button type="button" className="b b-sec" onClick={() => { locate(); void buildRoute(); }} disabled={routing} style={{ alignSelf: "flex-start" }}>
          {routing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Update from my position
        </button>

        {arrival.text && <Notice tone={arrival.state === "done" ? "ok" : "fail"}>{arrival.text}</Notice>}
        <button type="button" className="bigbtn" style={{ background: "var(--ok)", color: "#0A0C10" }} onClick={() => void logArrival()} disabled={arrival.state === "busy" || arrival.state === "done"}>
          {arrival.state === "busy" ? <Loader2 size={18} className="animate-spin" /> : <MapPinned size={18} />}
          {arrival.state === "done" ? "Arrival logged" : "I've arrived on scene"}
        </button>
      </div>
    </>
  );
}
