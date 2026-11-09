import { useEffect, useState } from "react";
import type { Map as MapboxMap } from "mapbox-gl";

/**
 * One basemap choice shared by every map in the app, all on Mapbox Standard: Mapbox's current
 * style with 3D buildings and landmarks built in. Day and Night are the same map under different
 * lighting; Satellite shows real rooftops, gates and car parks. Every option counts as one normal
 * map load against the free 50,000-a-month allowance.
 */
export type Basemap = "day" | "night" | "satellite";

const STANDARD = "mapbox://styles/mapbox/standard";

/** Spread into `new mapboxgl.Map({...})`: the style plus its lighting setting. */
export function basemapOptions(b: Basemap): { style: string; config?: Record<string, Record<string, string | boolean>> } {
  if (b === "satellite") return { style: "mapbox://styles/mapbox/standard-satellite" };
  return { style: STANDARD, config: { basemap: { lightPreset: b === "night" ? "night" : "day", showPointOfInterestLabels: true } } };
}

const KEY = "lemtik.basemap.v3";
const EVENT = "lemtik-basemap";

function read(): Basemap {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "night" || v === "satellite" ? v : "day";
  } catch {
    return "day";
  }
}

export function useBasemap(): [Basemap, (b: Basemap) => void] {
  // Server and first client render agree on "day"; the stored choice applies after mount.
  const [basemap, setLocal] = useState<Basemap>("day");
  useEffect(() => {
    setLocal(read());
    const on = () => setLocal(read());
    window.addEventListener(EVENT, on);
    window.addEventListener("storage", on);
    return () => {
      window.removeEventListener(EVENT, on);
      window.removeEventListener("storage", on);
    };
  }, []);
  const set = (b: Basemap) => {
    try {
      window.localStorage.setItem(KEY, b);
    } catch {
      /* storage blocked: still switch for this page */
    }
    setLocal(b);
    window.dispatchEvent(new Event(EVENT));
  };
  return [basemap, set];
}

/** Camera of a map that is about to be rebuilt for a style change, so the view doesn't jump. */
export type SavedView = { center: [number, number]; zoom: number; pitch: number; bearing: number };

export function saveView(map: MapboxMap): SavedView {
  const c = map.getCenter();
  return { center: [c.lng, c.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
}

/**
 * Mapbox Standard already draws 3D buildings and landmarks, so there is nothing to add. Kept so
 * existing map code can call it unchanged; it only adds extrusions on an older style.
 */
export function add3DBuildings(map: MapboxMap, _basemap: Basemap) {
  if (map.getLayer("lemtik-3d-buildings") || !map.getSource("composite")) return;
  const labelLayer = map.getStyle()?.layers?.find((l) => l.type === "symbol")?.id;
  map.addLayer(
    {
      id: "lemtik-3d-buildings",
      source: "composite",
      "source-layer": "building",
      filter: ["==", ["get", "extrude"], "true"],
      type: "fill-extrusion",
      minzoom: 15,
      paint: {
        "fill-extrusion-color": "#232a37",
        "fill-extrusion-height": ["coalesce", ["get", "height"], 6],
        "fill-extrusion-base": ["coalesce", ["get", "min_height"], 0],
        "fill-extrusion-opacity": 0.85,
      },
    },
    labelLayer,
  );
}

/** Small on-map control: Day / Night / Satellite, plus tilt for 3D. Place it absolutely inside the map box. */
export function BasemapSwitch({ value, onChange, onTilt, tilted, style }: { value: Basemap; onChange: (b: Basemap) => void; onTilt?: () => void; tilted?: boolean; style?: React.CSSProperties }) {
  return (
    <div className="glass row g4" style={{ position: "absolute", padding: 3, zIndex: 2, ...style }}>
      <div className="seg" role="group" aria-label="Map style" style={{ background: "transparent", border: 0 }}>
        {(["day", "night", "satellite"] as const).map((b) => (
          <button key={b} type="button" className={value === b ? "on" : undefined} aria-pressed={value === b} onClick={() => onChange(b)}>
            {b === "day" ? "Day" : b === "night" ? "Night" : "Satellite"}
          </button>
        ))}
      </div>
      {onTilt && (
        <button type="button" className="b b-sm b-gh" aria-pressed={!!tilted} onClick={onTilt} title={tilted ? "Flat view" : "Tilt to see buildings in 3D (zoom in close)"}>
          {tilted ? "2D" : "3D"}
        </button>
      )}
    </div>
  );
}
