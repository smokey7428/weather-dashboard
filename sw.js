/* Weather Dashboard service worker
 * - app shell precache (works offline)
 * - network-first for live weather/air APIs, with cached fallback
 * - stale-while-revalidate for CDN libraries
 * - network-first with cached fallback for map tiles
 */
const VERSION = "v2";
const SHELL = "wx-shell-" + VERSION;
const DATA = "wx-data-" + VERSION;
const TILES = "wx-tiles-" + VERSION;
const MAX_TILES = 300;

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.all(SHELL_ASSETS.map(async (url) => {
      try {
        const res = await fetch(url, { cache: "reload" });
        if (res && (res.ok || res.type === "opaque")) await cache.put(url, res.clone());
      } catch (e) { /* ignore individual failures */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, DATA, TILES]);
    const names = await caches.keys();
    await Promise.all(names.map((n) => (keep.has(n) ? null : caches.delete(n))));
    await self.clients.claim();
  })());
});

function isDataRequest(url) {
  return /(^|\.)open-meteo\.com$|(^|\.)air-quality-api\.open-meteo\.com$|(^|\.)geocoding-api\.open-meteo\.com$|(^|\.)rainviewer\.com$|(^|\.)bigdatacloud\.net$/.test(url.hostname);
}
function isTileRequest(url) {
  return /(^|\.)arcgisonline\.com$|(^|\.)tilecache\.rainviewer\.com$/.test(url.hostname);
}
function isCdn(url) {
  return /(^|\.)unpkg\.com$|(^|\.)jsdelivr\.net$/.test(url.hostname);
}

async function trimCache(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > max) {
    for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(request);
    if (fresh && (fresh.ok || fresh.type === "opaque")) {
      cache.put(request, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (e) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw e;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request).then((res) => {
    if (res && (res.ok || res.type === "opaque")) cache.put(request, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);
  return cached || (await network) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(SHELL);
        cache.put("./index.html", fresh.clone()).catch(() => {});
        return fresh;
      } catch (e) {
        const cache = await caches.open(SHELL);
        return (await cache.match("./index.html")) ||
               (await cache.match("./")) ||
               new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
      }
    })());
    return;
  }

  if (isTileRequest(url)) {
    event.respondWith((async () => {
      const res = await networkFirst(req, TILES);
      await trimCache(TILES, MAX_TILES);
      return res;
    })());
    return;
  }
  if (isDataRequest(url)) {
    event.respondWith(networkFirst(req, DATA));
    return;
  }
  if (isCdn(url)) {
    event.respondWith(staleWhileRevalidate(req, SHELL));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, SHELL));
  }
});
