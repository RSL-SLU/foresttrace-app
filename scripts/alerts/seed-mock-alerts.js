#!/usr/bin/env node
/**
 * Seed MOCK disturbance alerts for the Disturbance Alerts module.
 *
 * The documents follow NASA OPERA DIST-ALERT-HLS semantics so the real
 * ingestion can write the same shape later:
 *   - status: provisional (seen once or twice) -> confirmed (repeated loss)
 *   - confidence: high when the max vegetation-cover loss (VEG-ANOM-MAX) is
 *     >= 50 %, low otherwise
 *   - dist.vegDistStatus: DIST's own code (1/2/3 low, 4/5/6 high confidence;
 *     first / provisional / confirmed)
 *
 * Geometries are real: the 2025 AI clearcut patches in
 * client/public/data/patches/wabigoon_2025.json, so the before/after imagery
 * in the app shows actual change. Dates, statuses, losses and triage labels
 * are synthetic, spread over the ~5 months before the seed date. Every
 * document carries `mock: true`, and re-running replaces only mock documents.
 *
 * Usage:
 *   node scripts/alerts/seed-mock-alerts.js --db foresttrace_dev
 *   node scripts/alerts/seed-mock-alerts.js --db foresttrace_dev --remove   # delete mock alerts only
 *
 * --db is required so demo data never lands in production by accident; the
 * app is public, and the UI labels these as demo data.
 *
 * Credentials: VERCEL_MONGODB_URI or MONGODB_URI from .env / .env.vercel.
 */

const path = require('path');
// Repo root: this file lives in scripts/<group>/.
const ROOT = path.resolve(__dirname, '..', '..');

const args = process.argv.slice(2);
const dbIdx = args.indexOf('--db');
const dbName = dbIdx !== -1 ? args[dbIdx + 1] : null;
const removeOnly = args.includes('--remove');
if (!dbName) {
  console.error('Usage: node scripts/alerts/seed-mock-alerts.js --db <foresttrace_dev|foresttrace_preview|foresttrace> [--remove]');
  process.exit(1);
}

// Must be set before _db is loaded: it resolves the database name from env.
process.env.MONGODB_DB_NAME = dbName;
const { getCollection, getMongoUri } = require(path.join(ROOT, 'api', '_db'));

const DAY = 24 * 60 * 60 * 1000;

// Deterministic, so re-seeding gives the same alerts (relative to today).
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// DIST-ALERT VEG-DIST-STATUS codes
function vegDistStatus(stage, confidence) {
  const base = { first: 1, provisional: 2, confirmed: 3 }[stage];
  return confidence === 'high' ? base + 3 : base;
}

function buildAlerts(now) {
  const rand = mulberry32(2025);
  const patches = require(path.join(ROOT, 'client', 'public', 'data', 'patches', 'wabigoon_2025.json')).features;

  // Age (days since first detection) per alert: a handful this week, more
  // this month, most older -- roughly what a season of alerts looks like.
  const ages = patches.map((_, i) => {
    if (i < 6) return Math.floor(rand() * 7);
    if (i < 18) return 7 + Math.floor(rand() * 23);
    if (i < 40) return 30 + Math.floor(rand() * 60);
    return 90 + Math.floor(rand() * 60);
  });
  // Shuffle so age doesn't follow patch size (patches are ranked by area)
  for (let i = ages.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ages[i], ages[j]] = [ages[j], ages[i]];
  }

  return patches.map((f, i) => {
    const age = ages[i];
    const firstDetected = new Date(now - age * DAY - Math.floor(rand() * DAY));
    // HLS revisits every ~2-3 days; clouds drop many passes.
    const observations = Math.max(1, Math.min(12, Math.round(age / (3 + rand() * 6)) + 1));
    const lastObserved = new Date(Math.min(now, firstDetected.getTime() + (observations - 1) * 4 * DAY));
    const stage = observations === 1 ? 'first' : (observations >= 3 && age >= 10 ? 'confirmed' : 'provisional');
    const vegLossPct = Math.round(25 + rand() * 70);
    const confidence = vegLossPct >= 50 ? 'high' : 'low';

    // A few older alerts already triaged, and a few inside (mock) fire perimeters.
    let triage = null;
    const inFirePerimeter = i % 17 === 5;
    if (inFirePerimeter && age > 20) {
      triage = { label: 'fire', note: 'Inside a 2026 NBAC fire perimeter.', by: 'demo-analyst@foresttrace.local', at: new Date(firstDetected.getTime() + 9 * DAY) };
    } else if (stage === 'confirmed' && age > 45 && rand() < 0.5) {
      triage = { label: rand() < 0.85 ? 'clearcut' : 'false_positive', note: '', by: 'demo-analyst@foresttrace.local', at: new Date(firstDetected.getTime() + 12 * DAY) };
    }

    return {
      alertId: `DIST-WAB-${String(i + 1).padStart(4, '0')}`,
      region: 'wabigoon',
      source: 'OPERA DIST-ALERT-HLS',
      mock: true,
      geometry: f.geometry,
      centroid: { type: 'Point', coordinates: f.properties.centroid },
      areaHa: f.properties.areaHa,
      firstDetected,
      lastObserved,
      observations,
      status: stage === 'confirmed' ? 'confirmed' : 'provisional',
      confidence,
      vegLossPct,
      dist: {
        vegDistStatus: vegDistStatus(stage, confidence),
        vegAnomMax: vegLossPct,
        sensor: 'HLS (Landsat 8/9, Sentinel-2)',
      },
      context: { inFirePerimeter },
      // Year of the pre-disturbance image shown in the app. The geometries are
      // 2025 accumulated clearcuts (cut within 2021-2025), so 2020 predates them.
      imagery: { beforeYear: 2020 },
      triage,
      createdAt: new Date(now),
    };
  });
}

(async () => {
  if (!getMongoUri()) {
    console.error('Neither VERCEL_MONGODB_URI nor MONGODB_URI is configured.');
    process.exit(1);
  }
  const alerts = await getCollection('disturbance_alerts');

  // Only mock documents are ever touched here.
  const removed = await alerts.deleteMany({ mock: true });
  console.log(`Removed ${removed.deletedCount} existing mock alert(s) from "${dbName}".`);
  if (removeOnly) process.exit(0);

  // Indexed on the centroid rather than the polygon: vectorised raster outlines
  // aren't guaranteed to be valid for a 2dsphere index, and a point is enough
  // for "alerts in this area" queries.
  await alerts.createIndex({ centroid: '2dsphere' });
  await alerts.createIndex({ region: 1, firstDetected: -1 });
  await alerts.createIndex({ alertId: 1 }, { unique: true });

  const docs = buildAlerts(Date.now());
  await alerts.insertMany(docs);

  const count = (fn) => docs.filter(fn).length;
  console.log(`Inserted ${docs.length} mock alerts into "${dbName}".disturbance_alerts:`);
  console.log(`  last 7 days: ${count((d) => Date.now() - d.firstDetected < 7 * DAY)}, last 30: ${count((d) => Date.now() - d.firstDetected < 30 * DAY)}`);
  console.log(`  confirmed: ${count((d) => d.status === 'confirmed')}, provisional: ${count((d) => d.status === 'provisional')}`);
  console.log(`  triaged: ${count((d) => d.triage)}, in fire perimeters: ${count((d) => d.context.inFirePerimeter)}`);
  process.exit(0);
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
