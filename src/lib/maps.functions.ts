import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const lngLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

/** Areas a responder can reach from a point in 5, 10 and 15 minutes (Mapbox Isochrone). */
export const getResponseReach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      center: lngLat,
      mode: z.enum(["driving", "walking"]).default("driving"),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { mapboxIsochrone } = await import("./mapbox.server");
    const minutes = data.mode === "walking" ? [3, 6, 10] : [5, 10, 15];
    const fc = await mapboxIsochrone(data.center, minutes, data.mode);
    return { minutes, mode: data.mode, geojson: fc };
  });

/** Address and place search in Nigeria, biased towards where the map is looking. */
export const searchPlaces = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      q: z.string().trim().min(3).max(120),
      near: lngLat.optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { mapboxGeocode } = await import("./mapbox.server");
    return (await mapboxGeocode(data.q, data.near)) ?? [];
  });
