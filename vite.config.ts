import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    TanStackRouterVite(),
    tanstackStart(),
    nitro(),
    tailwindcss(),
    tsconfigPaths(),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      manifestFilename: "consumer-manifest.webmanifest",
      includeManifestIcons: false,
      manifest: {
        name: "Lemtik Security Emergency",
        short_name: "Emergency",
        description: "Emergency reporting for secured premises",
        theme_color: "#dc2626",
        background_color: "#0a0f1e",
        display: "standalone",
        orientation: "portrait",
        start_url: "/consumer",
        scope: "/consumer",
        icons: [
          { src: "/icons/consumer-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/consumer-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        globPatterns: [],
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: /\/api\/v1\/consumer\/session\/validate/,
            handler: "NetworkFirst",
            options: { cacheName: "consumer-session-cache" },
          },
        ],
      },
    }),
  ],
  ssr: {
    noExternal: true,
  },
});
