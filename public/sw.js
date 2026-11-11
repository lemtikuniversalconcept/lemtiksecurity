const CACHE_NAME = "lemtik-security-v3";
const TILE_CACHE_NAME = "lemtik-mapbox-v2";
const PRECACHE_URLS = [
  "/",
  "/app/",
  "/officer/",
  "/login",
  "/manifest.webmanifest",
  "/favicon.ico",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME && key !== TILE_CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);
  const isMapboxAsset =
    requestUrl.hostname.endsWith("mapbox.com") ||
    requestUrl.hostname.endsWith("tiles.mapbox.com") ||
    requestUrl.hostname.endsWith("api.mapbox.com");
  const isStaticAsset =
    event.request.destination === "script" ||
    event.request.destination === "style" ||
    event.request.destination === "image" ||
    event.request.destination === "font" ||
    event.request.destination === "worker";

  if (isMapboxAsset) {
    event.respondWith(
      caches.open(TILE_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) {
          fetch(event.request)
            .then((response) => {
              if (response.ok) cache.put(event.request, response.clone());
            })
            .catch(() => {});
          return cached;
        }
        try {
          const response = await fetch(event.request);
          if (response.ok) await cache.put(event.request, response.clone());
          return response;
        } catch {
          const fallback = await cache.match(event.request);
          return fallback ?? new Response("", { status: 504, statusText: "Offline" });
        }
      })
    );
    return;
  }

  if (requestUrl.origin !== self.location.origin) return;

  // Keep dynamic same-origin requests on the network so app data and server-fn
  // responses cannot get mixed with stale cached assets.
  if (event.request.mode !== "navigate" && !isStaticAsset) {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          const fallback = await caches.match("/app/");
          if (fallback) return fallback;
          return caches.match("/");
        })
    );
    return;
  }

  if (!isStaticAsset) return;

  // Static assets use a network-first strategy with cache fallback to avoid
  // serving stale JS/CSS chunks after deployments.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        return cached ?? new Response("", { status: 504, statusText: "Offline" });
      })
  );
});

// ---- Push notifications (alerts from the escalation chain)
self.addEventListener("push", (event) => {
  let msg = { title: "Lemtik alert", body: "", url: "/app/alerts" };
  try {
    if (event.data) msg = { ...msg, ...event.data.json() };
  } catch {
    if (event.data) msg.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(msg.title, {
      body: msg.body,
      icon: "/favicon.png",
      
      tag: msg.tag,
      renotify: !!msg.tag,
      requireInteraction: !!msg.requireInteraction,
      data: { url: msg.url || "/app/alerts" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/app/alerts", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.startsWith(self.location.origin) && "focus" in w) {
          w.navigate(url).catch(() => {});
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
