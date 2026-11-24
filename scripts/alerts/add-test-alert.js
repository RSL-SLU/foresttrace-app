#!/usr/bin/env node
/**
 * Add one fresh MOCK disturbance alert, to test alert emails end to end.
 *
 * Unlike seed-mock-alerts.js, the alert is left un-notified, so the next
 * notification run (daily cron, the admin button, or --notify here) emails
 * everyone watching the place it lands.
 *
 * Where it lands, first match wins:
 *   --lng <x> --lat <y>     an explicit point
 *   --email <address>       the middle of that user's first saved area
 *   (neither)               a point in the Wabigoon Forest
 *
 * Usage:
 *   node scripts/alerts/add-test-alert.js --db foresttrace_dev --email you@example.com --notify
 *   node scripts/alerts/add-test-alert.js --db foresttrace_dev --lng -92.5 --lat 49.9 --region wabigoon
 *   node scripts/alerts/add-test-alert.js --db foresttrace_dev --remove     # delete test alerts
 *
 * Options:
 *   --region <fmu>    FMU the alert belongs to (default wabigoon); FMU watches match on this
 *   --notify          run the notifier right after inserting
 *   --dry-run         with --notify: report who would be emailed, send nothing
 *   --app-url <url>   origin for links in the email (default APP_URL or http://localhost:3000)
 *
 * Emails go through Resend when RESEND_API_KEY is set, otherwise they are
 * printed here. Credentials: VERCEL_MONGODB_URI or MONGODB_URI from .env.
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };
const dbName = opt('--db');
if (!dbName) {
  console.error('Usage: node scripts/alerts/add-test-alert.js --db <foresttrace_dev|foresttrace_preview|foresttrace> [--email you@x] [--lng x --lat y] [--region fmu] [--notify [--dry-run]] [--remove]');
  process.exit(1);
}
process.env.MONGODB_DB_NAME = dbName;
const { getCollection, getMongoUri } = require(path.join(ROOT, 'api', '_db'));
const { runAlertNotifications } = require(path.join(ROOT, 'api', '_alertNotify'));

const TEST_PREFIX = 'DIST-TEST-';
// The centroid of a real 2025 cut block in client/public/data/patches/wabigoon_2025.json.
const WABIGOON_POINT = [-92.466182, 49.988867];

// A ~300 m square around a point: about 9 ha, a small cut block.
function squareAround([lng, lat], halfMetres = 150) {
  const dLat = halfMetres / 111320;
  const dLng = halfMetres / (111320 * Math.cos((lat * Math.PI) / 180));
  return {
    type: 'Polygon',
    coordinates: [[
      [lng - dLng, lat - dLat], [lng + dLng, lat - dLat],
      [lng + dLng, lat + dLat], [lng - dLng, lat + dLat], [lng - dLng, lat - dLat],
    ]],
  };
}

// Middle of a polygon's bounding box, nudged onto the shape if that misses it
// (an L-shaped area): falls back to the first vertex's neighbourhood.
function pointInside(geometry) {
  const rings = geometry.type === 'Polygon' ? [geometry.coordinates[0]] : geometry.coordinates.map((p) => p[0]);
  const ring = rings[0];
  const xs = ring.map((c) => c[0]); const ys = ring.map((c) => c[1]);
  const mid = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  const inside = (pt, r) => {
    let hit = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i]; const [xj, yj] = r[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  if (inside(mid, ring)) return mid;
  // Average of three consecutive vertices lies inside for most simple shapes.
  return [(ring[0][0] + ring[1][0] + ring[2][0]) / 3, (ring[0][1] + ring[1][1] + ring[2][1]) / 3];
}

(async () => {
  if (!getMongoUri()) {
    console.error('Neither VERCEL_MONGODB_URI nor MONGODB_URI is configured.');
    process.exit(1);
  }
  const alerts = await getCollection('disturbance_alerts');

  if (args.includes('--remove')) {
    const { deletedCount } = await alerts.deleteMany({ alertId: { $regex: `^${TEST_PREFIX}` }, mock: true });
    console.log(`Removed ${deletedCount} test alert(s) from "${dbName}".`);
    process.exit(0);
  }

  let point = WABIGOON_POINT;
  let where = 'the Wabigoon Forest (default)';
  if (opt('--lng') && opt('--lat')) {
    point = [Number(opt('--lng')), Number(opt('--lat'))];
    where = `${point[1]}, ${point[0]}`;
  } else if (opt('--email')) {
    const users = await getCollection('users');
    const user = await users.findOne({ email: opt('--email').trim().toLowerCase() });
    if (!user) { console.error(`No user with email ${opt('--email')} in "${dbName}".`); process.exit(1); }
    const watches = await getCollection('alert_watches');
    const area = await watches.findOne({ userId: user._id.toString(), kind: 'area' }, { sort: { createdAt: 1 } });
    if (!area) {
      console.error(`${user.email} has no saved areas. Save one in the app (Disturbance Alerts > Email notifications), or pass --lng/--lat.`);
      process.exit(1);
    }
    point = pointInside(area.geometry);
    where = `the middle of "${area.name}" (${user.email})`;
  }

  const now = new Date();
  const doc = {
    alertId: `${TEST_PREFIX}${now.toISOString().replace(/\D/g, '').slice(0, 14)}`,
    region: opt('--region') || 'wabigoon',
    source: 'OPERA DIST-ALERT-HLS',
    mock: true,
    geometry: squareAround(point),
    centroid: { type: 'Point', coordinates: point },
    areaHa: 9,
    firstDetected: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    lastObserved: now,
    observations: 1,
    status: 'provisional',
    confidence: 'high',
    vegLossPct: 72,
    dist: { vegDistStatus: 4, vegAnomMax: 72, sensor: 'HLS (Landsat 8/9, Sentinel-2)' },
    context: { inFirePerimeter: false },
    imagery: { beforeYear: 2020 },
    triage: null,
    createdAt: now,
  };
  await alerts.insertOne(doc);
  console.log(`Added test alert ${doc.alertId} at ${where}, FMU ${doc.region}.`);

  if (args.includes('--notify')) {
    const appUrl = (opt('--app-url') || process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const summary = await runAlertNotifications({ appUrl, dryRun: args.includes('--dry-run') });
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log('Not notified yet: run with --notify, use "Check for new alerts now" in the app (admins), or wait for the daily cron.');
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
