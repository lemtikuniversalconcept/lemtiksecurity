import { useEffect, useState } from "react";
import type { Map as MapboxMap } from "mapbox-gl";

/**
 * One basemap choice shared by every map in the app. Dark stays the default for the
 * control room; satellite shows real rooftops, gates and car parks. Both are standard
 * Mapbox styles counted the same way against the free map-load allowance.
 */
export type Basemap = "dark" | "satellite";

export const BASEMAP_STYLE: Record<Basemap, string> = {
  dark: "mapbox://styles/mapbox/dark-v11",
  satellite: "mapbox://styles/mapbox/satellite-streets-v12",
};

const KEY = "lemtik.basemap";
const EVENT = "lemtik-basemap";

function read(): Basemap {
  try {
    return window.localStorage.getItem(KEY) === "satellite" ? "satellite" : "dark";
  } catch {
    return "dark";
  }
}

export function useBasemap(): [Basemap, (b: Basemap) => void] {
  // Server and first client render agree on "dark"; the stored choice applies after mount.
  const [basemap, setLocal] = useState<Basemap>("dark");
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
 * Extruded building shapes from Mapbox's street data, shown from zoom 15. Where the data
 * has no height (common in parts of Lagos) buildings appear as low, flat blocks.
 */
export function add3DBuildings(map: MapboxMap, basemap: Basemap) {
  if (map.getLayer("lemtik-3d-buildings") || !map.getSource("composite")) return;
  const labelLayer = map.getStyle().layers?.find((l) => l.type === "symbol" && (l.layout as Record<string, unknown> | undefined)?.["text-field"])?.id;
  map.addLayer(
    {
      id: "lemtik-3d-buildings",
      source: "composite",
      "source-layer": "building",
      filter: ["==", ["get", "extrude"], "true"],
      type: "fill-extrusion",
      minzoom: 15,
      paint: {
        "fill-extrusion-color": basemap === "satellite" ? "#d9d4c7" : "#232a37",
        "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 15, 0, 15.6, ["coalesce", ["get", "height"], 6]],
        "fill-extrusion-base": ["interpolate", ["linear"], ["zoom"], 15, 0, 15.6, ["coalesce", ["get", "min_height"], 0]],
        "fill-extrusion-opacity": basemap === "satellite" ? 0.55 : 0.85,
      },
    },
    labelLayer,
  );
}

/** Small on-map control: Map / Satellite, plus tilt for 3D. Place it absolutely inside the map box. */
export function BasemapSwitch({ value, onChange, onTilt, tilted, style }: { value: Basemap; onChange: (b: Basemap) => void; onTilt?: () => void; tilted?: boolean; style?: React.CSSProperties }) {
  return (
    <div className="glass row g4" style={{ position: "absolute", padding: 3, zIndex: 2, ...style }}>
      <div className="seg" role="group" aria-label="Map style" style={{ background: "transparent", border: 0 }}>
        <button type="button" className={value === "dark" ? "on" : undefined} aria-pressed={value === "dark"} onClick={() => onChange("dark")}>
          Map
        </button>
        <button type="button" className={value === "satellite" ? "on" : undefined} aria-pressed={value === "satellite"} onClick={() => onChange("satellite")}>
          Satellite
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
