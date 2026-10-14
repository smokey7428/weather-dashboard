#!/usr/bin/env node
/* Guards the allow-list that appears in three separate places:
 *
 *   1. the Content-Security-Policy in index.html   (what the browser permits)
 *   2. ALLOWED_HOSTS in MainActivity.kt            (what the app permits)
 *   3. isDataRequest / isTileRequest in sw.js      (what gets cached)
 *
 * These must agree. If the CSP names a host the app blocks, the feature breaks
 * silently on Android only; if the app permits a host the CSP does not, the two
 * privacy claims stop matching each other. Neither is caught by any other test.
 *
 * Usage: node tests/consistency.test.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${!ok && detail ? "\n         " + detail : ""}`);
}

/* ---- 1. CSP in index.html ---- */
const html = read("index.html");
const cspMatch = html.match(/http-equiv="Content-Security-Policy"\s+content="([\s\S]*?)"\s*\/>/);
if (!cspMatch) {
  console.log("  FAIL  could not find the Content-Security-Policy meta tag");
  process.exit(1);
}
const csp = cspMatch[1];

function cspHosts(directive) {
  const m = csp.match(new RegExp(directive + "([^;]*);"));
  if (!m) return [];
  return [...m[1].matchAll(/https:\/\/([a-z0-9.-]+)/gi)].map((x) => x[1].toLowerCase());
}
const cspAll = new Set([...cspHosts("connect-src"), ...cspHosts("img-src")]);

/* ---- 2. ALLOWED_HOSTS in MainActivity.kt ---- */
const kotlin = read("android/app/src/main/java/com/smokey7428/weatherdashboard/MainActivity.kt");
const ktMatch = kotlin.match(/ALLOWED_HOSTS\s*=\s*setOf\(([\s\S]*?)\)/);
if (!ktMatch) {
  console.log("  FAIL  could not find ALLOWED_HOSTS in MainActivity.kt");
  process.exit(1);
}
const ktAll = new Set([...ktMatch[1].matchAll(/"([a-z0-9.-]+)"/gi)].map((x) => x[1].toLowerCase()));

/* ---- 3. predicates in sw.js ---- */
const sw = read("sw.js");
function swPredicate(fnName) {
  const re = new RegExp(
    "function " + fnName + "\\(url\\)\\s*\\{[\\s\\S]*?return\\s*(\\/.+?\\/)\\.test\\(url\\.hostname\\);"
  );
  const m = sw.match(re);
  if (!m) return null;
  return new RegExp(m[1].slice(1, -1));
}
const isData = swPredicate("isDataRequest");
const isTile = swPredicate("isTileRequest");

console.log(`CSP hosts (${cspAll.size}):        ${[...cspAll].sort().join(", ")}`);
console.log(`Kotlin hosts (${ktAll.size}):     ${[...ktAll].sort().join(", ")}`);
console.log("");

/* ---- comparisons ---- */
const onlyCsp = [...cspAll].filter((h) => !ktAll.has(h)).sort();
const onlyKotlin = [...ktAll].filter((h) => !cspAll.has(h)).sort();

check(
  "CSP and the app's native allow-list name the same hosts",
  onlyCsp.length === 0 && onlyKotlin.length === 0,
  [
    onlyCsp.length ? `only in CSP (would be blocked on Android): ${onlyCsp.join(", ")}` : "",
    onlyKotlin.length ? `only in Kotlin (not permitted by the CSP): ${onlyKotlin.join(", ")}` : "",
  ].filter(Boolean).join("\n         ")
);

check("both allow-lists are non-empty", cspAll.size > 0 && ktAll.size > 0);

if (!isData || !isTile) {
  check("could find the service-worker host predicates", false,
    "isDataRequest/isTileRequest not parsed");
} else {
  const uncovered = [...ktAll].filter((h) => !isData.test(h) && !isTile.test(h)).sort();
  check(
    "every allowed host is routed by the service worker",
    uncovered.length === 0,
    `not matched by isDataRequest or isTileRequest: ${uncovered.join(", ")}`
  );
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
console.log(failed.length ? "FAIL" : "PASS");
process.exit(failed.length ? 1 : 0);
