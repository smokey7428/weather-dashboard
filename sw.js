/* Weather Dashboard service worker
 * - app shell precache (works offline)
 * - network-first for live weather/air APIs, with cached fallback
 * - network-first with cached fallback for map tiles
 *
 * Every asset is served from this origin: the app has no CDN dependencies, so
 * the shell cache is the complete set of code that can run.
 */
const VERSION = "v6";
const SHELL = "wx-shell-" + VERSION;
const DATA = "wx-data-" + VERSION;
const TILES = "wx-tiles-" + VERSION;
const MAX_TILES = 300;

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./privacy.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./vendor/leaflet/leaflet.css",
  "./vendor/leaflet/leaflet.js",
  "./vendor/leaflet/images/layers.png",
  "./vendor/leaflet/images/layers-2x.png",
  "./vendor/leaflet/images/marker-icon.png",
  "./vendor/leaflet/images/marker-icon-2x.png",
  "./vendor/leaflet/images/marker-shadow.png",
  "./vendor/chartjs/chart.umd.js"
];

/* vendor/cities/cities.js (~1.2 MB) is deliberately NOT precached: it is only
 * needed when a coordinate has to be turned into a place name, and the
 * same-origin runtime cache below picks it up on first use. */

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.all(SHELL_ASSETS.map(async (url) => {
      try {
        const res = await fetch(url, { cache: "reload" });
        if (res && res.ok) await cache.put(url, res.clone());
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

/* The complete set of upstream hosts this app is allowed to reach, matching the
 * connect-src directive in index.html and ALLOWED_HOSTS in MainActivity.kt.
 * tests/consistency.test.js fails the build if they drift apart. */
function isDataRequest(url) {
  return /(^|\.)open-meteo\.com$|^api\.rainviewer\.com$/.test(url.hostname);
}
function isTileRequest(url) {
  return /(^|\.)arcgisonline\.com$|^tilecache\.rainviewer\.com$/.test(url.hostname);
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
    if (fresh && fresh.ok) {
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
    if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
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

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, SHELL));
  }
});
