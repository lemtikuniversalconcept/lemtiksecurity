import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import "mapbox-gl/dist/mapbox-gl.css";
import { add3DBuildings, basemapOptions, BasemapSwitch, saveView, useBasemap, type SavedView } from "@/lib/basemap";
import { getMapboxToken } from "@/lib/config.functions";
import { searchPlaces } from "@/lib/maps.functions";

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
  const mapRef = useRef<import("mapbox-gl").Map | null>(null);
  const markerRef = useRef<import("mapbox-gl").Marker | null>(null);
  const mapboxRef = useRef<typeof import("mapbox-gl") | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [ready, setReady] = useState(false);
  const [basemap, setBasemap] = useBasemap();
  const viewRef = useRef<SavedView | null>(null);
  const placesFn = useServerFn(searchPlaces);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ name: string; address: string; coord: LngLat }[]>([]);

  useEffect(() => {
    const term = q.trim();
    if (readOnly || term.length < 3) {
      setHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      const c = mapRef.current?.getCenter();
      placesFn({ data: { q: term, near: c ? [c.lng, c.lat] : undefined } })
        .then((r) => setHits(r as typeof hits))
        .catch(() => setHits([]));
    }, 350);
    return () => window.clearTimeout(t);
  }, [q, readOnly, placesFn]);

  const pick = (c: LngLat) => {
    setQ("");
    setHits([]);
    onChangeRef.current?.(c);
    mapRef.current?.easeTo({ center: c, zoom: Math.max(mapRef.current.getZoom(), 16), duration: 500 });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token || !container.current || mapRef.current) return;
      const mapboxgl = await import("mapbox-gl");
      if (cancelled || !container.current) return;
      mapboxRef.current = mapboxgl;
      mapboxgl.default.accessToken = token;
      const v = viewRef.current;
      const map = new mapboxgl.default.Map({
        container: container.current,
        ...basemapOptions(basemap),
        center: v?.center ?? value ?? center ?? LAGOS,
        zoom: v?.zoom ?? (value || center ? 15 : 11),
        pitch: v?.pitch ?? 0,
        attributionControl: true,
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
    const mapboxgl = mapboxRef.current;
    if (!map || !mapboxgl || !ready) return;
    markerRef.current?.remove();
    markerRef.current = null;
    if (!value) return;
    const el = document.createElement("span");
    el.style.cssText = "width:18px;height:18px;border-radius:50%;background:#F2384B;box-shadow:0 0 0 3px #0A0C10,0 0 0 6px rgba(242,56,75,.35)";
    markerRef.current = new mapboxgl.default.Marker({ element: el }).setLngLat(value).addTo(map);
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
        <div style={{ position: "absolute", left: 10, top: 10, right: 10, maxWidth: 340, zIndex: 3 }}>
          <input
            className="in glass"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (hits[0]) pick(hits[0].coord);
              }
              if (e.key === "Escape") setQ("");
            }}
            placeholder="Type an address, or click the map"
            aria-label="Search for an address"
            style={{ height: 34, fontSize: 12.5, width: "100%" }}
          />
          {hits.length > 0 && (
            <div className="glass col" role="listbox" style={{ marginTop: 4, overflow: "hidden" }}>
              {hits.map((h, i) => (
                <button key={i} type="button" role="option" aria-selected={false} className="col w-full text-left hover:bg-ink-3" style={{ padding: "7px 10px" }} onClick={() => pick(h.coord)}>
                  <b style={{ fontSize: 12.5 }}>{h.name}</b>
                  {h.address && <span className="t3 trunc" style={{ fontSize: 11.5 }}>{h.address}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
