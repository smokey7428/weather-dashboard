# Weather Dashboard — project memory

## What this is
A single-page weather dashboard for a location (geolocation + city search). It
ships in two forms from one source:

- **Website / installable PWA** — https://smokey7428.github.io/weather-dashboard/
- **Android app** — a native Kotlin shell around the same UI, built as a signed,
  sideloadable APK.

Shows current conditions, hourly/daily forecasts, air quality, observed rain
radar, a forecast-precipitation map, climate comparison vs the 1991–2020 normal,
and a historical-weather date picker.

Repo: **https://github.com/smokey7428/weather-dashboard** (public, branch
`master`). Host: GitHub Pages, `build_type: legacy`, source `master:/`.
Owner GitHub account: `smokey7428` (see the `github-account` skill).

## Privacy posture (this is a design constraint, not a feature)
The user asked for a version that is "secure and private", so these are
invariants — do not regress them:

- **No analytics, no advertising, no cookies, no tracking, no third-party
  scripts.** Never add one.
- **Coordinates are rounded to 2 decimals (~1.1 km)** before any outbound
  request: `r2()`, `apiLat()`, `apiLon()` in `index.html`. Every Open-Meteo call
  and the forecast-grid POST body go through these.
- **Place names are resolved on-device** from a bundled GeoNames list. There is
  **no reverse-geocoding service** — BigDataCloud was removed deliberately
  (it was a third party receiving the user's location).
- **Leaflet and Chart.js are self-hosted** in `vendor/`. Never reintroduce a CDN.
- **A Content-Security-Policy in `index.html` names every reachable server.**
  Adding a new upstream host means editing the CSP *and* `ALLOWED_HOSTS` in
  `MainActivity.kt` *and* `isDataRequest`/`isTileRequest` in `sw.js`.
- **The Android app enforces the same allow-list natively** in
  `shouldInterceptRequest`, independently of the page.
- Android permissions are exactly three: `INTERNET`, `ACCESS_COARSE_LOCATION`,
  `ACCESS_FINE_LOCATION`. CI fails the build if that set changes.
- No `Referer` is sent (`<meta name="referrer" content="no-referrer">`).

`privacy.html` is the user-facing statement; keep it in step with the code.

## Files
- `index.html` — the entire web app (HTML + CSS + JS inline, ~1500 lines).
- `privacy.html` — standalone privacy statement.
- `sw.js` — service worker. `VERSION` constant — **bump it whenever you change
  cached assets** so installed clients pick up the new shell.
- `manifest.json`, `icon-192.png`, `icon-512.png` — PWA manifest and icons.
- `vendor/leaflet/`, `vendor/chartjs/` — self-hosted libraries.
- `vendor/cities/cities.js` — **generated** offline city lookup (~1.2 MB).
  Built by `tools/build-cities.js`; do not hand-edit.
- `tools/build-cities.js` — regenerates the city list from the GeoNames dump.
- `tests/cases.js` — city-lookup fixtures (shared by the test and the tuner).
- `tests/cities.test.js` — city lookup: 73 major cities + 18 small towns.
- `tests/page.test.js` — headless Chromium privacy/CSP/layout checks.
- `tests/tune.js` — audits fixtures and sweeps the lookup's scoring constants.
- `tests/fixtures/` — recorded API responses (git-ignored, auto-created).
- `android/` — native shell; see `android/README.md` for the full story.
- `android/tools/bootstrap-toolchain.sh` — JDK 17 + Android SDK (no sudo).
- `android/tools/build-apk.sh`, `make-keystore.sh`, `make-icons.sh`.
- `.github/workflows/build.yml` — web tests + APK build/release.
- `serve.sh` — local dev helper (http.server + cloudflared tunnel).
- `.nojekyll` — stops GitHub Pages running Jekyll.

## Data sources (all free, keyless, CORS-enabled)
- **Open-Meteo forecast** `api.open-meteo.com/v1/forecast` — current, hourly (61
  vars), daily; also the multi-point POST used for the forecast grid.
- **Open-Meteo air quality** `air-quality-api.open-meteo.com`.
- **Open-Meteo geocoding** `geocoding-api.open-meteo.com` — only when the user
  searches by name.
- **Open-Meteo ERA5 archive** `archive-api.open-meteo.com/v1/archive` —
  historical daily data back to **1940**; climate normals + the date picker.
- **RainViewer** `api.rainviewer.com` + `tilecache.rainviewer.com` — observed
  radar, **past ~2 h only** (free tier dropped nowcast and caps zoom at 7; the
  radar layer sets `maxNativeZoom:7`).
- **Esri World Dark Gray Canvas** `server.arcgisonline.com` — basemap + labels.
  Replaced CARTO, which now watermarks tiles.
- **GeoNames** `cities15000` — place names, **bundled offline** (CC BY 4.0).

## Key implementation notes / gotchas
- **Lat/lon ordering:** coordinates are `[lat, lon]`. A previous bug had them
  swapped in the forecast grid.
- **Forecast grid:** 20×20 points, `step=0.08°`, 24 hourly steps, fetched via
  **POST** (GET 414s at ~625 points; 400 is safe). Rendered as a Leaflet
  `imageOverlay` from a canvas. Grid point coordinates are `.toFixed(2)` because
  the page-level rule is that nothing leaves with more precision than ~1 km.
- **Playback** is mode-aware (`stepFrame`/`togglePlay`); the forecast starts at
  the current local hour (`fc.start` from `state.data.utc_offset_seconds`).
- **Service worker:** network-first for APIs & tiles (tiles capped at 300),
  stale-while-revalidate for the shell. Never caches POST.
  `vendor/cities/cities.js` is deliberately **not** precached — it is 1.2 MB and
  only needed when a coordinate must be named; the same-origin runtime cache
  picks it up on first use.
- **Rate limits:** Open-Meteo enforces a minutely limit (HTTP 429). The page
  tests avoid this by recording responses into `tests/fixtures/` and replaying.
- **PWA install needs a secure context** (HTTPS or localhost). `file://` and
  plain `http://192.168.x.x` block the service worker and install prompt.
- Mobile-first; **0 px horizontal overflow at 412×915** is a checked invariant.

### Things that bit us
- **`--` is illegal inside XML comments.** A comment mentioning the CSS variable
  `--bg` fails `mergeReleaseResources`.
- **`set -o pipefail` + `tr < /dev/urandom | head`** makes the generator script
  die of SIGPIPE. Use `openssl rand` instead.
- **`jsdelivr` regenerates `chart.umd.min.js` itself** — it is not the artifact
  Chart.js publishes, and its hash differs from `chart.umd.js`. The self-hosted
  copy is the official `chart.umd.js` (byte-identical across unpkg and jsdelivr).
  When self-hosting a library, verify by fetching it from two CDNs and comparing.
- **GeoNames' own centroids are coarse for some cities.** Its Toronto entry is
  ~6 km north of downtown; its Dubai entry ~15 km away. This is why the city
  lookup gives large cities a "metro radius" rather than comparing raw distance.
- **Quantising the stored city coordinates to 2 decimals** introduced a 6.6 km
  error for Toronto and made downtown neighbourhoods win. The stored grid is
  4 decimals (~11 m) for that reason.
- **`.metrics` is a CSS grid; grid items default to `min-width:auto`**, so long
  metric values forced the columns wider than their container and produced an
  8 px overflow that varied with the data. Fixed with `min-width:0` on
  `.metric`. This was a pre-existing bug, found by the layout test.
- **A flaky single-sample overflow measurement** is not a real result. The test
  waits for the width to settle before asserting.

## City lookup: how to change it
`vendor/cities/cities.js` is generated. Scoring constants live in
`tools/build-cities.js` and were chosen by measurement:

```bash
node tests/tune.js        # audits fixtures, sweeps W / P / metro-radius
node tests/cities.test.js # must stay 73/73 and 18/18
```

Current model: `score = max(0, km - metroRadius(pop)) - 2*log10(pop) + (hood ? 6 : 0)`,
with a metro radius only for places above 500k. It scores 73/73 cities and 18/18
towns and holds across the whole `W = 1.5–3` plateau, so it is not tuned to a
knife edge.

`tests/tune.js` **audits the fixtures** for a place of the expected name within
50 km of the test coordinates. Without that, an expectation like "Keswick" is
satisfied by Keswick, Ontario — which tests nothing. Fixtures whose place is
below the dataset's 15k population floor cannot be tested and must not be added.

## Testing
```bash
npm install
npm test                  # cities + headless page tests
npm run test:cities       # fast, no browser
npm run test:page         # headless Chromium
node tests/page.test.js --record   # re-record API fixtures
```

`tests/page.test.js` resolves a browser automatically: it looks for a cached
Chromium under `~/Library/Caches/ms-playwright` (macOS), else defers to whatever
Playwright installed (which is what CI does). Override with `WX_BROWSER`.

It asserts, among other things: no CDN/third-party requests, no reverse-geocoding
request, every outbound coordinate ≤ 2 decimals (query strings **and** POST
bodies), the offline city list loaded, no CSP violations, no uncaught errors, the
privacy panel rendered, no overflow in both map modes, and the service worker
registering.

## How to update / deploy

**Website:**
```bash
cd "/Users/you/Documents/Opencode/S3D weather dashboard"
git add -A && git commit -m "<message>" && git push
```
Pages rebuilds in ~1 min. Verify: watch the `pages` status until `built`, then
grep the live `index.html` for the new code. Bump `sw.js` `VERSION` first if you
changed cached assets.

**Android:** see `android/README.md`. Short version:
```bash
cd android
./tools/bootstrap-toolchain.sh   # once
./tools/make-keystore.sh         # once — back up the keystore
./tools/build-apk.sh             # signed APK in app/build/outputs/apk/release/
```
Tag `v*` to have CI build and attach the APK to a GitHub Release.

## Conventions
- No comments unless they explain *why*. Keep JS `"use strict"` inline.
- Reuse existing helpers: `esc()`, `fmt()`, `mean()`, `wx()`, `lbl()`, `timeL()`,
  `dayL()`, `$()`, `r2()`, `apiLat()`, `apiLon()`, `locate()`.
- New metrics: add a label to `LABELS`, then render via a `.metrics`/`.kv` block.
