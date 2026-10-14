#!/usr/bin/env node
/* End-to-end checks for the web app, run in headless Chromium.
 *
 * Verifies the privacy properties that are easy to regress:
 *   - no request ever leaves for a CDN or a third-party reverse geocoder
 *   - every coordinate sent to a weather API is rounded to ~1 km
 *   - the bundled offline city lookup resolves "my location" with no network
 *   - the Content-Security-Policy produces no violations
 *   - the page actually renders
 *
 * Open-Meteo responses are recorded to tests/fixtures/ on first run and
 * replayed afterwards, so repeated runs are deterministic and do not trip the
 * API's rate limit.
 *
 * Usage: node tests/page.test.js [--record]
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/* playwright-core is enough locally (a Chromium is already cached), while CI
 * installs the full `playwright` package. Accept either. */
let chromium;
try {
  chromium = require("playwright").chromium;
} catch (e) {
  chromium = require("playwright-core").chromium;
}

const ROOT = process.env.WX_ROOT || path.join(__dirname, "..");
const FIXTURES = path.join(__dirname, "fixtures");
const RECORD = process.argv.includes("--record");

const ALLOWED_HOSTS = new Set([
  "api.open-meteo.com",
  "air-quality-api.open-meteo.com",
  "geocoding-api.open-meteo.com",
  "archive-api.open-meteo.com",
  "api.rainviewer.com",
  "server.arcgisonline.com",
  "tilecache.rainviewer.com",
]);

/* Any of these appearing in a request is a hard failure. */
const FORBIDDEN_HOSTS = ["unpkg.com", "jsdelivr.net", "cdnjs", "bigdatacloud.net",
  "google-analytics", "googletagmanager", "doubleclick", "sentry", "mixpanel"];

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".png": "image/png", ".webmanifest": "application/manifest+json",
};

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

/* Returns an explicit browser path when one is known, otherwise undefined so
 * Playwright resolves the browser it installed itself (which is what CI does). */
function findBrowser() {
  if (process.env.WX_BROWSER) return process.env.WX_BROWSER;

  const base = path.join(
    process.env.HOME || "",
    "Library/Caches/ms-playwright"      // macOS; also where the dev machine keeps one
  );
  if (!fs.existsSync(base)) return undefined;

  const dirs = fs.readdirSync(base).filter((d) => d.startsWith("chromium-")).sort();
  if (!dirs.length) return undefined;

  const candidates = [
    ["chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"],
    ["chrome-mac-x64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"],
    ["chrome-linux", "chrome"],
    ["chrome-linux64", "chrome"],
  ];
  for (const dir of dirs.reverse()) {
    for (const parts of candidates) {
      const exe = path.join(base, dir, ...parts);
      if (fs.existsSync(exe)) return exe;
    }
  }
  return undefined;
}

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

/* ---- fixture-backed replay of upstream API calls ----
 * Keys deliberately ignore coordinate values: the response shape is the same
 * wherever the query points, and location-independent keys let the same
 * fixtures serve a comparison against another revision of the app. The
 * coordinate-rounding assertions inspect the real outgoing requests instead. */
function normalizeCoords(s) {
  return String(s).replace(/(latitude|longitude)=[-\d.,]+/g, "$1=_");
}
function fixtureKey(method, url, body) {
  const u = new URL(url);
  const h = crypto.createHash("sha1")
    .update(method + " " + u.host + u.pathname + " " +
      normalizeCoords(u.search) + " " + normalizeCoords(body || ""))
    .digest("hex").slice(0, 20);
  return path.join(FIXTURES, h + ".json");
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${detail && !ok ? "\n         " + detail : ""}`);
}

(async () => {
  fs.mkdirSync(FIXTURES, { recursive: true });
  const { server, port } = await serve();
  const browser = await chromium.launch({ executablePath: findBrowser() });
  const context = await browser.newContext({
    serviceWorkers: "block",
    geolocation: { latitude: 52.3676, longitude: 4.9041 },
    permissions: ["geolocation"],
    viewport: { width: 412, height: 915 },
  });

  const requested = [];
  const violations = [];
  const consoleErrors = [];
  let gridPostBody = null;

  await context.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());

    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return route.continue();

    requested.push({ method: req.method(), url: req.url(), body: req.postData() });
    if (req.method() === "POST" && url.hostname === "api.open-meteo.com") {
      gridPostBody = req.postData();
    }

    if (FORBIDDEN_HOSTS.some((h) => url.hostname.includes(h))) {
      violations.push(req.url());
      return route.abort();
    }
    if (!ALLOWED_HOSTS.has(url.hostname)) {
      violations.push("unexpected host: " + req.url());
      return route.abort();
    }
    // map tiles: stub a 1x1 png, no need to download imagery
    if (/arcgisonline|tilecache\.rainviewer/.test(url.hostname)) {
      return route.fulfill({ status: 200, contentType: "image/png", body: PNG_1PX });
    }

    const file = fixtureKey(req.method(), req.url(), req.postData());
    if (fs.existsSync(file) && !RECORD) {
      return route.fulfill({
        status: 200, contentType: "application/json", body: fs.readFileSync(file),
      });
    }
    try {
      const resp = await route.fetch();
      const body = await resp.body();
      fs.writeFileSync(file, body);
      return route.fulfill({ status: resp.status(), contentType: "application/json", body });
    } catch (e) {
      return route.abort();
    }
  });

  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "load" });

  // the app renders the current temperature once data arrives
  let rendered = true;
  try {
    await page.waitForFunction(
      () => {
        const el = document.getElementById("currentBody");
        return el && el.textContent.includes("°") && !el.textContent.includes("Loading");
      },
      { timeout: 30000 }
    );
  } catch (e) { rendered = false; }

  const currentText = (await page.textContent("#currentBody").catch(() => "")) || "";
  const headerText = (await page.textContent("#locHost").catch(() => "")) || "";
  const privacyText = (await page.textContent("#privacy").catch(() => "")) || "";

  check("page renders current conditions", rendered, currentText.slice(0, 160));
  check("current conditions contain a temperature", /°/.test(currentText), currentText.slice(0, 120));

  /* Exercise the forecast-precipitation grid. It is the one request whose
   * coordinates travel in a POST body rather than the query string, so it needs
   * its own coverage. */
  await page.click('button[data-mode="forecast"]');
  const gridDeadline = Date.now() + 30000;
  while (!gridPostBody && Date.now() < gridDeadline) {
    await new Promise((r) => setTimeout(r, 250));
  }
  check("forecast grid POST reached the API", !!gridPostBody,
    gridPostBody ? "" : "no POST to api.open-meteo.com/v1/forecast");

  /* --- privacy: no CDN, no third-party geocoder --- */
  check("no requests to forbidden third parties", violations.length === 0, violations.join("\n         "));

  const hosts = [...new Set(requested.map((r) => new URL(r.url).hostname))].sort();
  check("only allow-listed upstream hosts contacted",
    hosts.every((h) => ALLOWED_HOSTS.has(h)), hosts.join(", "));

  const cdnLike = requested.filter((r) => /unpkg|jsdelivr|cdnjs/.test(r.url));
  check("no CDN script/style requests", cdnLike.length === 0, cdnLike.map((r) => r.url).join(", "));

  const bdc = requested.filter((r) => /bigdatacloud/.test(r.url));
  check("no reverse-geocoding service contacted", bdc.length === 0, bdc.map((r) => r.url).join(", "));

  /* --- privacy: coordinates are rounded to ~1 km --- */
  const withCoords = requested.filter((r) => /[?&]latitude=/.test(r.url));
  const unrounded = [];
  for (const r of withCoords) {
    for (const m of r.url.matchAll(/[?&](latitude|longitude)=([-\d.,]+)/g)) {
      for (const v of m[2].split(",")) {
        const dp = (v.split(".")[1] || "").length;
        if (dp > 2) unrounded.push(`${m[1]}=${v} in ${r.url.slice(0, 90)}`);
      }
    }
  }
  // grid requests are POSTed, check the body too
  for (const r of requested.filter((x) => x.body)) {
    for (const m of (r.body || "").matchAll(/(?:^|&)(latitude|longitude)=([-\d.,]+)/g)) {
      for (const v of m[2].split(",")) {
        const dp = (v.split(".")[1] || "").length;
        if (dp > 2) unrounded.push(`${m[1]}=${v} in POST body`);
      }
    }
  }
  check("all outbound coordinates rounded to 2 decimals", unrounded.length === 0,
    unrounded.slice(0, 6).join("\n         "));
  check("weather requests were actually made", withCoords.length > 0, "none seen");

  /* --- offline place naming --- */
  const hasCities = await page.evaluate(() => typeof window.WX_CITIES === "object" &&
    typeof window.WX_CITIES.nearest === "function");
  check("bundled city list loaded in the page", hasCities);
  check("header shows the resolved place name", /Amsterdam/i.test(headerText), headerText.slice(0, 160));

  const geoRequests = requested.filter((r) => /reverse-geocode|geocoding-api/.test(r.url));
  check("no geocoding request for the initial location", geoRequests.length === 0,
    geoRequests.map((r) => r.url).join(", "));

  /* --- CSP --- */
  const cspErrors = consoleErrors.filter((e) => /Content Security Policy/i.test(e));
  check("no Content-Security-Policy violations", cspErrors.length === 0, cspErrors.slice(0, 4).join("\n         "));

  const fatal = consoleErrors.filter((e) => /pageerror|is not defined|Uncaught/i.test(e));
  check("no uncaught script errors", fatal.length === 0, fatal.slice(0, 4).join("\n         "));

  /* --- privacy panel present --- */
  check("privacy disclosure rendered", /leaves this device/i.test(privacyText) &&
    /On device/i.test(privacyText), privacyText.slice(0, 120));

  /* --- the at-your-own-risk notice must stay visible --- */
  const disclaimerText = (await page.textContent("#disclaimer").catch(() => "")) || "";
  const disclaimerVisible = await page.evaluate(() => {
    const el = document.getElementById("disclaimer");
    if (!el) return false;
    const s = getComputedStyle(el);
    return el.offsetHeight > 0 && s.display !== "none" && s.visibility !== "hidden";
  });
  check("vibe-coded / at-your-own-risk notice is visible",
    disclaimerVisible && /vibe coded/i.test(disclaimerText) && /own risk/i.test(disclaimerText),
    disclaimerText.replace(/\s+/g, " ").slice(0, 140));

  /* --- vendor libraries served locally --- */
  const libRequests = requested.filter((r) => /leaflet|chart/.test(r.url));
  check("map and chart libraries come from this origin (no external requests)",
    libRequests.length === 0,
    libRequests.map((r) => r.url).join(", "));

  /* --- no horizontal overflow at phone width ---
   * Chart.js resizes its canvas asynchronously, so a single sample can catch a
   * transient mid-layout width. Wait for the measurement to settle before
   * asserting, and check both modes. */
  async function settledOverflow(pg) {
    let last = -1, stable = 0;
    for (let i = 0; i < 40; i++) {
      const w = await pg.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (w === last) { if (++stable >= 3) return w; } else { stable = 0; last = w; }
      await new Promise((r) => setTimeout(r, 250));
    }
    return last;
  }

  await page.click('button[data-mode="radar"]');
  const overRadar = await settledOverflow(page);
  check("no horizontal overflow in radar mode at 412px", overRadar <= 0, `overflow ${overRadar}px`);

  await page.click('button[data-mode="forecast"]');
  const overForecast = await settledOverflow(page);
  check("no horizontal overflow in forecast mode at 412px", overForecast <= 0, `overflow ${overForecast}px`);

  /* --- service worker registers when allowed --- */
  const swContext = await browser.newContext({
    geolocation: { latitude: 52.3676, longitude: 4.9041 },
    permissions: ["geolocation"],
  });
  await swContext.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return route.continue();
    if (/arcgisonline|tilecache\.rainviewer/.test(url.hostname)) {
      return route.fulfill({ status: 200, contentType: "image/png", body: PNG_1PX });
    }
    if (!ALLOWED_HOSTS.has(url.hostname)) return route.abort();
    const file = fixtureKey(route.request().method(), route.request().url(), route.request().postData());
    if (fs.existsSync(file)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: fs.readFileSync(file) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  const swPage = await swContext.newPage();
  await swPage.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "load" });
  const swReady = await swPage.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    return !!reg;
  });
  check("service worker registers and activates", swReady);

  await browser.close();
  server.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log(failed.length ? "FAIL" : "PASS");
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
