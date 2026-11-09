import { createServerFn } from "@tanstack/react-start";

// Maps now use MapLibre with OpenFreeMap tiles, which need no key and can't bill anyone.
// This keeps the old function name so existing callers still get a non-empty value and draw
// their maps; MAPBOX_PUBLIC_TOKEN is no longer used and can be removed from Vercel.
export const getMapboxToken = createServerFn({ method: "GET" }).handler(async () => {
  return { token: "openfreemap" };
});
