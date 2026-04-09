const STATIC_CACHE = "pollux-static-v1";
const OFFLINE_CACHE = "pollux-offline-v1";
const EXPECTED_CACHES = [STATIC_CACHE, OFFLINE_CACHE];

const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pollux — Offline</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0f0f0f;
      color: #a0a0a0;
      font-family: system-ui, -apple-system, sans-serif;
      text-align: center;
      padding: 1rem;
    }
    h1 { color: #e4e4e4; font-size: 1.25rem; margin-bottom: 0.5rem; }
  </style>
</head>
<body>
  <div>
    <h1>You are offline</h1>
    <p>Please check your connection and try again.</p>
  </div>
</body>
</html>`;

// Install: cache the offline fallback page
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(OFFLINE_CACHE).then((cache) => {
      return cache.put(
        new Request("/_offline"),
        new Response(OFFLINE_HTML, {
          headers: { "Content-Type": "text/html" },
        })
      );
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => !EXPECTED_CACHES.includes(key))
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Should this response be cached?
function isCacheable(response) {
  if (!response || response.status !== 200) return false;
  if (response.headers.has("set-cookie")) return false;
  if (response.type === "opaqueredirect") return false;
  return true;
}

// Is this a static asset request?
function isStaticAsset(url) {
  if (url.pathname.startsWith("/_next/static/")) return true;
  return /\.(js|css|woff2?|ttf|otf|png|jpg|jpeg|gif|svg|ico|webp)$/.test(
    url.pathname
  );
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Network-only: API routes and dev HMR
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_next/webpack-hmr")) {
    return;
  }

  // Navigation requests: network-first with offline fallback
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match("/_offline");
      })
    );
    return;
  }

  // Static assets: cache-first
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (isCacheable(response)) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => {
              cache.put(event.request, clone);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // Everything else: network-only (passthrough)
});
