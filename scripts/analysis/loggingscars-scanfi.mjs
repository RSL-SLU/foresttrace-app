#!/usr/bin/env node
/**
 * How SCANFI sees the Wildlands League logging-scar sites (loggingscars.ca).
 *
 * The sites (291 points, "Boreal Logging Scars" Google My Map) are field
 * sites where roads and landings from clearcut logging left productive forest
 * barren. None falls in the four FMUs our scanfi-v1 COGs cover, so this reads
 * the national SCANFI v2 rasters our COGs are cut from (NRCan, 30 m), at:
 *
 *   sites     each site point
 *   controls  random points in the same FMUs (forested pixels only)
 *
 * and compares each site's biomass with control stands of the same age in the
 * same FMU -- the same "relative to same-age peers" reading our logging-scar
 * layer uses. Sampled as the median of a 3x3 (90 m) and a 9x9 (270 m) window.
 *
 * Usage:
 *   node scripts/analysis/loggingscars-scanfi.mjs <sites.geojson> <out.json>
 * sites.geojson: points with properties.fmu (see the README section in the
 * output) -- built from the My Map's KML export.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { fromUrl } = await import(pathToFileURL(path.join(ROOT, 'client/node_modules/geotiff/dist-module/geotiff.js')).href);

const BASE = 'https://ftp.maps.canada.ca/pub/nrcan_rncan/Forests_Foret/SCANFI/v2';
const RASTER = (attr, year) => `${BASE}/SCANFI_${attr}_${year}_v2_20260119.tif`;
const YEARS = [2015, 2020, 2025];
const CONTROLS_PER_FMU = Number(process.env.CONTROLS_PER_FMU) || 150;
// NRCan's server throttles bursts (requests went from <1 s to ~25 s after a
// 12-way parallel run): keep it gentle and let it run unattended
const CONCURRENCY = Number(process.env.CONCURRENCY) || 3;
const AGE_TOLERANCE = 3;          // same-age cohort: +-3 years
const MIN_COHORT = 15;            // fewer controls than this: no ratio
const SCAR_THRESHOLD = 0.5;       // as in our logging-scar layer

// ── NAD83 Canada Lambert (ESRI:102001): LCC 2SP, GRS80 ──────────────────────
const A = 6378137;
const F = 1 / 298.257222101;
const E = Math.sqrt(2 * F - F * F);
const rad = (d) => (d * Math.PI) / 180;
const mF = (p) => Math.cos(p) / Math.sqrt(1 - (E * Math.sin(p)) ** 2);
const tF = (p) => Math.tan(Math.PI / 4 - p / 2) / ((1 - E * Math.sin(p)) / (1 + E * Math.sin(p))) ** (E / 2);
const P1 = rad(49); const P2 = rad(77); const L0 = rad(-95);
const N = (Math.log(mF(P1)) - Math.log(mF(P2))) / (Math.log(tF(P1)) - Math.log(tF(P2)));
const FF = mF(P1) / (N * tF(P1) ** N);
const RHO0 = A * FF * tF(0) ** N;
function lcc([lon, lat]) {
  const rho = A * FF * tF(rad(lat)) ** N;
  const th = N * (rad(lon) - L0);
  return [rho * Math.sin(th), RHO0 - rho * Math.cos(th)];
}

// ── raster sampling ──────────────────────────────────────────────────────────
const images = new Map();
async function image(url) {
  if (!images.has(url)) images.set(url, fromUrl(url).then((t) => t.getImage(0)));
  return images.get(url);
}
async function withRetry(fn, tries = 4) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
}
const median = (v) => {
  if (!v.length) return null;
  const s = v.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** Medians of the valid pixels in a 3x3 and a 9x9 window around a point. */
async function sample(url, lonlat) {
  const img = await image(url);
  const [ox, oy] = img.getOrigin();
  const [rx, ry] = img.getResolution();
  const nodata = Number(img.getGDALNoData());
  const [x, y] = lcc(lonlat);
  const c = Math.floor((x - ox) / rx);
  const r = Math.floor((y - oy) / ry);
  const half = 4;
  const win = [c - half, r - half, c + half + 1, r + half + 1];
  const [band] = await withRetry(() => img.readRasters({ window: win, interleave: false }));
  const ok = (v) => v !== nodata && v > -32000 && Number.isFinite(v);
  const all = [];
  const inner = [];
  for (let i = 0; i < 9; i++) {
    for (let j = 0; j < 9; j++) {
      const v = band[i * 9 + j];
      if (!ok(v)) continue;
      all.push(v);
      if (Math.abs(i - half) <= 1 && Math.abs(j - half) <= 1) inner.push(v);
    }
  }
  return { p3: median(inner), p9: median(all) };
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

// ── random control points inside each FMU ───────────────────────────────────
const inRing = (pt, ring) => {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi)) ins = !ins;
  }
  return ins;
};
function fmuPolys(id) {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'client/public/data/regions', `${id}.json`), 'utf8'));
  const feats = j.type === 'FeatureCollection' ? j.features : [j];
  return feats.flatMap((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates));
}
function randomPoints(id, n, seed) {
  const polys = fmuPolys(id);
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  polys.forEach((p) => p[0].forEach(([x, y]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }));
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const pts = [];
  while (pts.length < n) {
    const pt = [minX + rnd() * (maxX - minX), minY + rnd() * (maxY - minY)];
    if (polys.some((p) => inRing(pt, p[0]))) pts.push(pt);
  }
  return pts;
}

// ── statistics ───────────────────────────────────────────────────────────────
/** AUC: probability a random site scores lower than a random control (0.5 = no signal). */
function aucLower(sites, controls) {
  let wins = 0;
  sites.forEach((s) => controls.forEach((c) => { wins += s < c ? 1 : s === c ? 0.5 : 0; }));
  return sites.length && controls.length ? wins / (sites.length * controls.length) : null;
}
const q = (v, p) => { const s = v.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const r2 = (x) => (x === null ? null : Math.round(x * 100) / 100);

// ── run ──────────────────────────────────────────────────────────────────────
const [sitesFile, outFile] = process.argv.slice(2);
const sites = JSON.parse(fs.readFileSync(sitesFile, 'utf8')).features.filter((f) => f.properties.fmu);
const fmus = [...new Set(sites.map((f) => f.properties.fmu))];
const controls = fmus.flatMap((id, k) => randomPoints(id, CONTROLS_PER_FMU, 7919 * (k + 1)).map((pt) => ({ fmu: id, pt })));
console.log(`${sites.length} sites in ${fmus.length} FMUs, ${controls.length} controls`);

const points = [
  ...sites.map((f) => ({ kind: 'site', fmu: f.properties.fmu, pt: f.geometry.coordinates, name: f.properties.name, group: f.properties.group })),
  ...controls.map((c) => ({ kind: 'control', fmu: c.fmu, pt: c.pt })),
];
// Spatial order (rows of ~10 km), so consecutive reads share tiles in the cache
points.sort((a, b) => Math.round(b.pt[1] * 10) - Math.round(a.pt[1] * 10) || a.pt[0] - b.pt[0]);
for (const year of YEARS) {
  for (const attr of ['att_biomass', 'age_median']) {
    const url = RASTER(attr, year);
    const t0 = Date.now();
    let done = 0;
    const vals = await pool(points, CONCURRENCY, (p) => sample(url, p.pt)
      .catch(() => ({ p3: null, p9: null }))
      .finally(() => { done += 1; if (done % 100 === 0) console.log(`    ${attr} ${year}: ${done}/${points.length}`); }));
    vals.forEach((v, i) => { points[i][`${attr}_${year}`] = v; });
    console.log(`  ${attr} ${year}: ${Math.round((Date.now() - t0) / 1000)} s`);
  }
}

const results = { generatedAt: new Date().toISOString(), sites: sites.length, controlsPerFmu: CONTROLS_PER_FMU, fmus, byYear: {} };
for (const year of YEARS) {
  for (const win of ['p3', 'p9']) {
    const rows = points.map((p) => ({ ...p, bio: p[`att_biomass_${year}`]?.[win], age: p[`age_median_${year}`]?.[win] }))
      .filter((p) => p.bio !== null && p.age !== null && p.bio !== undefined && p.age !== undefined);
    // forested controls only: SCANFI gives non-forest no age, already dropped
    const ctl = rows.filter((p) => p.kind === 'control');
    const cohortMedian = (p) => {
      const peers = ctl.filter((c) => c.fmu === p.fmu && Math.abs(c.age - p.age) <= AGE_TOLERANCE && c !== p);
      return peers.length >= MIN_COHORT ? median(peers.map((c) => c.bio)) : null;
    };
    const withRatio = rows.map((p) => { const m = cohortMedian(p); return { ...p, ratio: m ? p.bio / m : null }; })
      .filter((p) => p.ratio !== null);
    const sR = withRatio.filter((p) => p.kind === 'site').map((p) => p.ratio);
    const cR = withRatio.filter((p) => p.kind === 'control').map((p) => p.ratio);
    const sB = rows.filter((p) => p.kind === 'site').map((p) => p.bio);
    const cB = ctl.map((p) => p.bio);
    const sA = rows.filter((p) => p.kind === 'site').map((p) => p.age);
    results.byYear[`${year}_${win}`] = {
      year,
      window: win === 'p3' ? '90 m (3x3)' : '270 m (9x9)',
      sitesSampled: sB.length,
      controlsSampled: cB.length,
      biomass: { siteMedian: r2(median(sB)), controlMedian: r2(median(cB)), aucSiteLower: r2(aucLower(sB, cB)) },
      siteAge: { median: median(sA), p25: q(sA, 0.25), p75: q(sA, 0.75) },
      sameAge: {
        sitesWithCohort: sR.length,
        controlsWithCohort: cR.length,
        siteMedianRatio: r2(median(sR)),
        controlMedianRatio: r2(median(cR)),
        sitesBelowThreshold: sR.length ? r2(sR.filter((v) => v < SCAR_THRESHOLD).length / sR.length) : null,
        controlsBelowThreshold: cR.length ? r2(cR.filter((v) => v < SCAR_THRESHOLD).length / cR.length) : null,
        aucSiteLower: r2(aucLower(sR, cR)),
      },
    };
  }
}
// Per-site values, for mapping and for the app's layer popups
results.siteValues = points.filter((p) => p.kind === 'site').map((p) => ({
  name: p.name, group: p.group, fmu: p.fmu, lon: p.pt[0], lat: p.pt[1],
  ...Object.fromEntries(YEARS.flatMap((y) => [[`biomass${y}`, p[`att_biomass_${y}`]?.p3 ?? null], [`age${y}`, p[`age_median_${y}`]?.p3 ?? null]])),
}));
fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.byYear, null, 1));
