import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import "maplibre-gl/dist/maplibre-gl.css";
import { add3DBuildings, BASEMAP_STYLE, BasemapSwitch, saveView, useBasemap, type SavedView } from "@/lib/basemap";
import { getMapboxToken } from "@/lib/config.functions";

/** maplibre-gl ships as a UMD bundle: depending on the bundler the module or its default export is the library. */
async function loadMaplibre(): Promise<typeof import("maplibre-gl")> {
  const mod = (await import("maplibre-gl")) as typeof import("maplibre-gl") & { default?: typeof import("maplibre-gl") };
  return mod.default ?? mod;
}


type LngLat = [number, number];
const LAGOS: LngLat = [3.4219, 6.4281];

export function useMapboxToken() {
  const getToken = useServerFn(getMapboxToken);
  return useQuery({ queryKey: ["mapbox_token"], queryFn: () => getToken(), staleTime: Infinity });
}

/** A real map: click to drop the pin. Renders nothing when no Mapbox token is configured. */
export function LocationPicker({ value, center, onChange, height = 240, readOnly = false }: { value: LngLat | null; center?: LngLat | null; onChange?: (c: LngLat) => void; height?: number; readOnly?: boolean }) {
  const { data } = useMapboxToken();
  const token = data?.token ?? "";
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const markerRef = useRef<import("maplibre-gl").Marker | null>(null);
  const mapboxRef = useRef<typeof import("maplibre-gl") | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [ready, setReady] = useState(false);
  const [basemap, setBasemap] = useBasemap();
  const viewRef = useRef<SavedView | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token || !container.current || mapRef.current) return;
      const maplibregl = await loadMaplibre();
      if (cancelled || !container.current) return;
      mapboxRef.current = maplibregl;
      const v = viewRef.current;
      const map = new maplibregl.Map({
        container: container.current,
        style: BASEMAP_STYLE[basemap],
        center: v?.center ?? value ?? center ?? LAGOS,
        zoom: v?.zoom ?? (value || center ? 15 : 11),
        pitch: v?.pitch ?? 0,
        attributionControl: { compact: true },
      });
      if (!readOnly) map.getCanvas().style.cursor = "crosshair";
      map.on("click", (e) => !readOnly && onChangeRef.current?.([Number(e.lngLat.lng.toFixed(6)), Number(e.lngLat.lat.toFixed(6))]));
      map.on("load", () => {
        add3DBuildings(map, basemap);
        setReady(true);
      });
      mapRef.current = map;
    })();
    return () => {
      cancelled = true;
      markerRef.current?.remove();
      if (mapRef.current) viewRef.current = saveView(mapRef.current);
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
    };
    // the map is created once per token and style; value/center are applied by the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, basemap]);

  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = mapboxRef.current;
    if (!map || !maplibregl || !ready) return;
    markerRef.current?.remove();
    markerRef.current = null;
    if (!value) return;
    const el = document.createElement("span");
    el.style.cssText = "width:18px;height:18px;border-radius:50%;background:#F2384B;box-shadow:0 0 0 3px #0A0C10,0 0 0 6px rgba(242,56,75,.35)";
    markerRef.current = new maplibregl.Marker({ element: el }).setLngLat(value).addTo(map);
  }, [value, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && ready && center) map.easeTo({ center, zoom: Math.max(map.getZoom(), 15), duration: 400 });
  }, [center?.[0], center?.[1], ready]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!token) return null;
  return (
    <div className="map" style={{ height }}>
      <div ref={container} style={{ position: "absolute", inset: 0 }} />
      <BasemapSwitch value={basemap} onChange={setBasemap} style={{ right: 8, bottom: 8 }} />
      {!readOnly && (
        <div className="glass" style={{ position: "absolute", left: 10, top: 10, padding: "4px 10px", fontSize: 12 }}>
          Click the map to drop the pin
        </div>
      )}
    </div>
  );
}
