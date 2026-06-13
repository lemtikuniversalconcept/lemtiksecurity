import { createServerFn } from "@tanstack/react-start";

// Publishable Mapbox token (pk.*) — safe to expose to authenticated client code.
// No auth middleware: avoids 401 from token-attacher race; restrict the
// token via Mapbox URL allowlist in the Mapbox dashboard instead.
export const getMapboxToken = createServerFn({ method: "GET" })
  .handler(async () => {
    return { token: process.env.MAPBOX_PUBLIC_TOKEN ?? "" };
  });
