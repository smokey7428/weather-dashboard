#!/usr/bin/env node
/* Regression test for the offline nearest-city lookup.
 *
 * Runs against the shipped vendor/cities/cities.js (not a reimplementation), so
 * it exercises the exact code the app uses. Fixtures live in tests/cases.js and
 * are validated by the proximity audit in tests/tune.js.
 *
 * Usage: node tests/cities.test.js
 */
"use strict";

global.window = {};
require("../vendor/cities/cities.js");
const CITIES = global.window.WX_CITIES;
const { cities, towns } = require("./cases.js");

const deaccent = (s) =>
  String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function run(label, group) {
  const failures = [];
  for (const [expected, lat, lon] of group) {
    const r = CITIES.nearest(lat, lon);
    const got = deaccent(r.name);
    const wanted = expected.split("|").map(deaccent);
    if (!wanted.some((w) => got.includes(w) || w.includes(got))) {
      failures.push(
        `${expected} (${lat}, ${lon}) -> ${r.name} | ${r.region} | ${r.country}` +
        ` (${r.distanceKm.toFixed(1)} km)`
      );
    }
  }
  console.log(`${label}: ${group.length - failures.length}/${group.length}`);
  for (const f of failures) console.log("  FAIL " + f);
  return failures.length;
}

console.log(`cities in dataset: ${CITIES.count}\n`);
const failed = run("major cities", cities) + run("small towns ", towns);

/* The lookup must also degrade sanely outside any populated area. */
const remote = CITIES.nearest(-40.0, -110.0);
console.log(`\nremote ocean point -> ${remote ? remote.name + ", " + remote.country : "null"}`);
if (!remote) { console.log("  FAIL expected a nearest place, got null"); process.exit(1); }

/* Sanity: a place name must never be empty and lookups must be repeatable. */
const a = CITIES.nearest(52.3676, 4.9041).name;
const b = CITIES.nearest(52.3676, 4.9041).name;
if (a !== b) { console.log("  FAIL lookup is not deterministic"); process.exit(1); }
if (!a) { console.log("  FAIL empty name"); process.exit(1); }

console.log(`\n${failed === 0 ? "PASS" : "FAIL"}`);
process.exit(failed ? 1 : 0);
