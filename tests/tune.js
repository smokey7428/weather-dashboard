#!/usr/bin/env node
/* Audits the fixtures and sweeps the nearest-city scoring parameters against
 * tests/cases.js, so the weights are chosen from measurements.
 *
 * Scoring model under test:
 *   km   = equirectangular distance to the candidate
 *   rad  = "metro radius" subtracted for very large cities, because GeoNames
 *          stores imprecise centroids for some metropolises and a big city
 *          physically covers its inner suburbs
 *   score = max(0, km - rad) - W*log10(pop) + (neighbourhood ? P : 0)
 *
 * Usage: node tests/tune.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { cities, towns } = require("./cases.js");

const src = fs.readFileSync(path.join(__dirname, "..", "vendor", "cities", "cities.js"), "utf8");
const RAW = JSON.parse(src.match(/var RAW=("(?:[^"\\]|\\.)*");/)[1]);

const LAT_OFFSET = 90000, LON_OFFSET = 180000;
const rows = RAW.split("\n").map((l) => {
  const f = l.split("|");
  return {
    n: f[0],
    p: parseInt(f[3], 36) || 0,
    la: (parseInt(f[4], 36) - LAT_OFFSET) / 10000,
    lo: (parseInt(f[5], 36) - LON_OFFSET) / 10000,
    t: f[6] === "1" ? 1 : 0,
  };
});

const deaccent = (s) =>
  String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const present = new Set(rows.map((r) => deaccent(r.n)));

/* ---- audit: an expectation with no matching place near the test coordinates
 * is untestable (the name may exist only on another continent) ---- */
let auditFail = 0;
function hasNearby(expected, lat, lon) {
  const wanted = expected.split("|").map(deaccent);
  const k = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
  for (const r of rows) {
    const dy = r.la - lat;
    const dx = (r.lo - lon) * k;
    if (Math.sqrt(dx * dx + dy * dy) * 111.32 > 50) continue;
    const n = deaccent(r.n);
    if (wanted.some((w) => n.includes(w) || w.includes(n))) return true;
  }
  return false;
}
for (const group of [cities, towns]) {
  for (const [expected, lat, lon] of group) {
    if (!hasNearby(expected, lat, lon)) {
      console.log(`AUDIT FAIL: no "${expected}" within 50 km of ${lat}, ${lon}`);
      auditFail++;
    }
  }
}
console.log(auditFail ? "" : "audit: every expected place exists within 50 km of its test coordinates");

const N = rows.length;
function lookup(lat, lon, W, P, R) {
  const k = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
  let best = null, bestScore = Infinity;
  for (let i = 0; i < N; i++) {
    const r = rows[i];
    const dy = r.la - lat;
    const dx = (r.lo - lon) * k;
    const km = Math.sqrt(dx * dx + dy * dy) * 111.32;
    let eff = km;
    if (r.p >= 500000 && R > 0) {
      const rad = (R * (Math.log10(r.p) - 5.7)) / 1.3;
      eff = Math.max(0, km - rad);
    }
    const score = eff - W * Math.log10(r.p > 1 ? r.p : 1) + (r.t ? 0 : P);
    if (score < bestScore) { bestScore = score; best = r; }
  }
  return best ? best.n : null;
}

function score(group, W, P, R) {
  let ok = 0;
  const fails = [];
  for (const [expected, lat, lon] of group) {
    const got = deaccent(lookup(lat, lon, W, P, R));
    const wanted = expected.split("|").map(deaccent);
    if (wanted.some((w) => got.includes(w) || w.includes(got))) ok++;
    else fails.push(`${expected} -> ${lookup(lat, lon, W, P, R)}`);
  }
  return { ok, total: group.length, fails };
}

const results = [];
console.log("\n  W    P    R  | cities | towns | total");
for (const R of [0, 6, 10, 14, 18, 22, 26]) {
  for (const W of [1.5, 2, 2.5, 3]) {
    for (const P of [0, 3, 6]) {
      const c = score(cities, W, P, R);
      const t = score(towns, W, P, R);
      results.push({ W, P, R, c, t, total: c.ok + t.ok });
      if (P !== 0) continue;
      console.log(
        `  ${String(W).padEnd(4)} ${String(P).padEnd(4)} ${String(R).padEnd(3)} | ` +
        `${String(c.ok + "/" + c.total).padStart(6)} | ${String(t.ok + "/" + t.total).padStart(5)} | ${c.ok + t.ok}/${c.total + t.total}`
      );
    }
  }
}

results.sort((a, b) => b.total - a.total || b.t.ok - a.t.ok);
console.log("\nbest configurations (ties broken by rural accuracy):");
for (const r of results.slice(0, 6)) {
  console.log(`  W=${r.W} P=${r.P} R=${r.R}  cities ${r.c.ok}/${r.c.total}  towns ${r.t.ok}/${r.t.total}  total ${r.total}`);
}
const best = results[0];
console.log(`\nfailures for best (W=${best.W}, P=${best.P}, R=${best.R}):`);
for (const f of best.c.fails) console.log("  [city] " + f);
for (const f of best.t.fails) console.log("  [town] " + f);
