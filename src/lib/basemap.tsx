import { useEffect, useState } from "react";
import type { Map as MaplibreMap } from "maplibre-gl";

/**
 * Basemaps come from OpenFreeMap (https://openfreemap.org): free, no account, no API key and no
 * card, rendered with the open-source MapLibre engine. Nothing here can bill anyone.
 * Day (default) is a clean light map like the ones ride-hailing apps use; Night suits a dark control room.
 */
export type Basemap = "night" | "day";

export const BASEMAP_STYLE: Record<Basemap, string> = {
  night: "https://tiles.openfreemap.org/styles/dark",
  day: "https://tiles.openfreemap.org/styles/positron",
};

const KEY = "lemtik.basemap.v2";
const EVENT = "lemtik-basemap";

function read(): Basemap {
  try {
    return window.localStorage.getItem(KEY) === "night" ? "night" : "day";
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

export function saveView(map: MaplibreMap): SavedView {
  const c = map.getCenter();
  return { center: [c.lng, c.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
}

/**
 * Extruded buildings from OpenStreetMap footprints, from zoom 15. Where OSM has no height
 * (common in parts of Lagos) a building is drawn as a low block.
 */
export function add3DBuildings(map: MaplibreMap, basemap: Basemap) {
  if (map.getLayer("lemtik-3d-buildings") || !map.getSource("openmaptiles")) return;
  for (const id of ["building", "building-3d"]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
  }
  const labelLayer = map.getStyle().layers?.find((l) => l.type === "symbol")?.id;
  map.addLayer(
    {
      id: "lemtik-3d-buildings",
      source: "openmaptiles",
      "source-layer": "building",
      type: "fill-extrusion",
      minzoom: 14,
      paint: {
        "fill-extrusion-color": basemap === "day" ? "#e4e6ea" : "#1d2330",
        "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 14, 0, 15, ["coalesce", ["get", "render_height"], 6]],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 0.9,
      },
    },
    labelLayer,
  );
}

/** Small on-map control: Night / Day, plus tilt for 3D. Place it absolutely inside the map box. */
export function BasemapSwitch({ value, onChange, onTilt, tilted, style }: { value: Basemap; onChange: (b: Basemap) => void; onTilt?: () => void; tilted?: boolean; style?: React.CSSProperties }) {
  return (
    <div className="glass row g4" style={{ position: "absolute", padding: 3, zIndex: 2, ...style }}>
      <div className="seg" role="group" aria-label="Map style" style={{ background: "transparent", border: 0 }}>
        <button type="button" className={value === "night" ? "on" : undefined} aria-pressed={value === "night"} onClick={() => onChange("night")}>
          Night
        </button>
        <button type="button" className={value === "day" ? "on" : undefined} aria-pressed={value === "day"} onClick={() => onChange("day")}>
          Day
        </button>
      </div>
      {onTilt && (
        <button type="button" className="b b-sm b-gh" aria-pressed={!!tilted} onClick={onTilt} title={tilted ? "Flat view" : "Tilt to see buildings in 3D (zoom in close)"}>
          {tilted ? "2D" : "3D"}
        </button>
      )}
    </div>
  );
}
