# Weather Dashboard

A weather dashboard for one location: current conditions, hourly and 8-day
forecasts, air quality and pollen, observed rain radar, a forecast-precipitation
map, climate comparison against the 1991–2020 normal, and a historical-weather
date picker.

It runs in two forms from the same source:

- **A website / installable PWA** — <https://smokey7428.github.io/weather-dashboard/>
- **An Android app** — a native shell around the same UI, built as a signed APK
  you can share with anyone.

## Privacy

There is no account, no analytics, no advertising, no cookies and no tracking,
and there are no third-party scripts. Concretely:

- **Coordinates are rounded to 2 decimals (~1 km)** before being sent to any
  weather service. Your exact position never leaves the device.
- **Place names are resolved on-device** from a bundled GeoNames city list, so no
  reverse-geocoding service is contacted at all. This works offline.
- **Leaflet and Chart.js are bundled**, not loaded from a CDN — no runtime code
  comes from a third party.
- **A Content-Security-Policy names every server** the page may contact; the
  browser blocks everything else.
- **The Android app enforces the same server list natively**, independently of
  the page, and refuses cleartext HTTP.
- The Android app requests exactly three permissions — `INTERNET`,
  `ACCESS_COARSE_LOCATION` and `ACCESS_FINE_LOCATION`. (A fourth, app-scoped
  permission is contributed automatically by the Android support library to
  protect its internal broadcast receivers; it grants nothing to any other app.)
  Location is optional — the app is fully usable by searching for a city.

See [`privacy.html`](privacy.html) for the full statement, including exactly
which server receives what.

## Layout

```
index.html            the whole web app (HTML + CSS + JS inline)
privacy.html          privacy statement
sw.js                 service worker (offline shell, API caching)
manifest.json         PWA manifest
vendor/leaflet/       self-hosted Leaflet 1.9.4
vendor/chartjs/       self-hosted Chart.js 4.4.3
vendor/cities/        generated GeoNames offline city lookup (~1.2 MB)
tools/build-cities.js regenerates vendor/cities from the GeoNames dump
tests/                regression tests (city lookup + headless-browser checks)
android/              native Android shell (see android/README.md)
.githooks/            optional pre-push test hook
```

## Running the web app locally

The service worker and geolocation need a secure context, so serve it over HTTP
rather than opening the file directly:

```bash
python3 -m http.server 8765
# then open http://localhost:8765/
```

`serve.sh` additionally opens a Cloudflare quick tunnel so you can test on a
phone over HTTPS.

## Tests

```bash
npm install
npm test
```

Two suites:

- `tests/cities.test.js` — runs the shipped city lookup against 73 major cities
  and 18 small towns, asserting each resolves to the right place. Fast, no
  browser, no network.
- `tests/page.test.js` — loads the app in headless Chromium and asserts the
  privacy properties: no CDN or third-party requests, every outbound coordinate
  rounded, the offline city lookup used, no CSP violations, no layout overflow at
  412 × 915, and the service worker registering.

Open-Meteo responses are recorded to `tests/fixtures/` on first run and replayed
afterwards, so repeated runs are deterministic and do not trip the API's rate
limit. To refresh the recordings, delete `tests/fixtures/` and run
`node tests/page.test.js --record`.

## Rebuilding the offline city list

The bundled city list is generated, not hand-edited. To regenerate it:

```bash
mkdir -p /tmp/geonames && cd /tmp/geonames
curl -O https://download.geonames.org/export/dump/cities15000.zip
curl -O https://download.geonames.org/export/dump/admin1CodesASCII.txt
curl -O https://download.geonames.org/export/dump/countryInfo.txt
unzip cities15000.zip

cd "/Users/you/Documents/Opencode/S3D weather dashboard"
node tools/build-cities.js /tmp/geonames
node tests/cities.test.js
```

The scoring constants in `tools/build-cities.js` were chosen by sweeping against
`tests/cases.js` (`node tests/tune.js`), not by guesswork. That script also
audits the fixtures, because an expectation whose place is not actually in the
dataset (Keswick in Ontario rather than Cumbria, say) tests nothing.

## Android app

See [`android/README.md`](android/README.md) for building, signing, installing and
sharing the APK.

## Data sources

All free, keyless and CORS-enabled.

| Source | Used for |
| --- | --- |
| Open-Meteo forecast API | current, hourly and daily forecast; the multi-point grid |
| Open-Meteo air quality API | AQI, pollutants, pollen |
| Open-Meteo geocoding API | city-name search (only when you search) |
| Open-Meteo ERA5 archive | historical weather back to 1940, climate normals |
| RainViewer | observed radar, past ~2 hours |
| Esri World Dark Gray Canvas | basemap tiles |
| GeoNames | offline place names (bundled) |

## Deploying the website

```bash
git add -A && git commit -m "<message>" && git push
```

GitHub Pages rebuilds in about a minute. If you changed `sw.js` or any precached
asset, bump `VERSION` in `sw.js` first so installed clients pick up the new shell.
