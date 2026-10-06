# Weather Dashboard — project memory

## What this is
A single-page weather dashboard for a location (geolocation + city search),
built as an installable PWA. It shows current conditions, hourly/daily
forecasts, air quality, observed rain radar, a forecast-precipitation map,
climate comparison vs the 1991–2020 normal, and a historical-weather date
picker.

Live URL: **https://smokey7428.github.io/weather-dashboard/**
Repo: **https://github.com/smokey7428/weather-dashboard** (public, branch `master`)
Host: GitHub Pages, `build_type: legacy`, source `master:/` (root).
Owner GitHub account: `smokey7428` (see the `github-account` skill).

## Files
- `index.html` — the entire app (HTML + CSS + JS inline, ~1900 lines).
- `sw.js` — service worker (offline + PWA). Version constant `VERSION` — bump it
  whenever you change cached assets so clients pick up the new shell.
- `manifest.json` — PWA manifest (name, icons, standalone, theme).
- `icon-192.png`, `icon-512.png` — app icons.
- `.nojekyll` — stops GitHub Pages running Jekyll (required so files load as-is).
- `serve.sh` — local dev helper: python http.server + cloudflared quick tunnel
  for testing on a phone over HTTPS. Not needed for production (Pages handles it).

## Data sources (all free, keyless, CORS-enabled)
- **Open-Meteo forecast API** `api.open-meteo.com/v1/forecast` — current, hourly
  (61 variables), daily; also the multi-point POST used for the forecast grid.
- **Open-Meteo air quality** `air-quality-api.open-meteo.com`.
- **Open-Meteo geocoding** `geocoding-api.open-meteo.com`.
- **Open-Meteo ERA5 archive** `archive-api.open-meteo.com/v1/archive` — historical
  daily data back to **1940**; used for climate normals and the date picker.
- **RainViewer** `api.rainviewer.com` + `tilecache.rainviewer.com` — observed
  radar tiles, **past ~2 h only** (free tier dropped nowcast/future frames and
  caps zoom at 7; tiles return "Zoom Level Not Supported" above 7 — the radar
  layer uses `maxNativeZoom:7`).
- **Esri World Dark Gray Canvas** (ArcGIS REST, `server.arcgisonline.com`) —
  basemap + reference labels. Replaced CARTO, which now watermarks tiles with
  "API KEY REQUIRED".
- **BigDataCloud** `api.bigdatacloud.net/data/reverse-geocode-client` — reverse
  geocoding for "my location". Returns a 307 → must follow redirects (fetch does).

## Key implementation notes / gotchas
- **Lat/lon ordering bug (fixed):** the forecast-grid code once had
  `const cx=state.lat, cy=state.lon` and used them swapped, fetching the wrong
  area and drawing the overlay off-screen. Coordinates are `[lat, lon]`.
- **Forecast grid:** 20×20 points, `step=0.08°`, 24 hourly steps, fetched via
  **POST** (URL-length limit; GET 414s at ~625 points, 400 points is safe).
  Rendered as a Leaflet `imageOverlay` from a canvas; animation slider + Play.
- **Playback** is mode-aware (`stepFrame`/`togglePlay`); forecast starts at the
  current local hour (`fc.start` derived from `state.data.utc_offset_seconds`).
- **Service worker caching:** network-first for APIs & tiles (tiles capped at
  300), stale-while-revalidate for CDN. Never cache POST.
- **Rate limits:** Open-Meteo enforces a minutely request limit (HTTP 429).
  Heavy probing/testing will trip it — wait ~60 s.
- **PWA install needs a secure context** (HTTPS or localhost). `file://` and
  plain `http://192.168.x.x` won't install and block the service worker.
- Mobile-first layout; verified at a OnePlus-13 viewport (412×915) with 0 px
  horizontal overflow. Sticky first column on wide tables; safe-area insets.

## How to update / deploy
Edit files, then:
```bash
cd "/Users/ericsmook/Documents/Opencode/S3D weather dashboard"
git add -A && git commit -m "<message>" && git push
```
GitHub Pages rebuilds in ~1 min. Verify: watch the `pages` status until `built`
and grep the live `index.html` for the new code.

If you changed `sw.js` or any precached asset, **bump `VERSION` in `sw.js`**
first so installed clients refresh.

## Testing
There is no test suite. Verification is done by loading the page. A headless
Chromium is available via `playwright-core` (installed at `/tmp/node_modules`)
and a cached browser at
`~/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app`.
Typical check: serve with `python3 -m http.server 8765 --directory .`, load the
page, and assert `#currentBody` contains `°` and not `Loading`.

## Conventions
- No comments unless necessary; keep JS "use strict" inline in `index.html`.
- Reuse existing helpers: `esc()`, `fmt()`, `mean()`, `wx()`, `lbl()`, `timeL()`,
  `dayL()`, `$()`.
- New metrics: add a label to `LABELS`, then render via a `.metrics`/`.kv` block.
