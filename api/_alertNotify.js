const { getCollection, ObjectId, signValue } = require('./_db');
const { sendEmail, renderAlertDigest } = require('./_mailer');
const ONTARIO_FMUS = require('../client/src/data/ontarioFmus.json');

/**
 * Alert watches and the emails they trigger.
 *
 * A watch (collection `alert_watches`) is one of
 *   { userId, kind: 'area', name, geometry: Polygon | MultiPolygon, createdAt }
 *   { userId, kind: 'fmus', fmus: ['wabigoon', ...], createdAt }   (one per user)
 *
 * runAlertNotifications() takes every alert not yet notified (no `notifiedAt`),
 * finds the watches it falls in, and sends each affected user one digest.
 * Alerts are marked before any mail goes out, so a run that dies half way
 * never sends the same alert twice; the price is that a failed send is not
 * retried (it is logged in `alert_notifications` with its error).
 *
 * Runs daily from Vercel Cron (vercel.json -> /api/alerts?action=notify), on
 * demand by an admin, and from scripts/alerts/add-test-alert.js --notify.
 */

const DAY = 24 * 60 * 60 * 1000;
// An alert older than this when first seen is history, not news: e.g. a
// backfill of last season's alerts shouldn't email anyone.
const MAX_ALERT_AGE_DAYS = 14;
const MAX_ALERTS_PER_RUN = 2000;
// Resend's default limit is 2 requests per second.
const SEND_INTERVAL_MS = 600;

const FMU_LABELS = Object.fromEntries(ONTARIO_FMUS.map((u) => [u.value, u.label]));
const fmuLabel = (id) => FMU_LABELS[id] || id;

let indexesReady = null;
function ensureWatchIndexes() {
  if (!indexesReady) {
    indexesReady = (async () => {
      const watches = await getCollection('alert_watches');
      // 2dsphere indexes skip documents without the field, so FMU watches are fine.
      await watches.createIndex({ geometry: '2dsphere' });
      await watches.createIndex({ userId: 1, kind: 1 });
      await watches.createIndex({ kind: 1, fmus: 1 });
      const alerts = await getCollection('disturbance_alerts');
      await alerts.createIndex({ notifiedAt: 1, createdAt: -1 });
    })().catch((err) => { indexesReady = null; throw err; });
  }
  return indexesReady;
}

function unsubscribeUrl(appUrl, userId) {
  return `${appUrl}/api/alerts?action=unsubscribe&u=${encodeURIComponent(userId)}&s=${signValue(`alert-unsub:${userId}`)}`;
}

/** Watches an alert falls in: areas it touches, plus FMU watches on its FMU. */
async function watchesForAlert(watches, alert) {
  let areas;
  try {
    areas = await watches.find({ kind: 'area', geometry: { $geoIntersects: { $geometry: alert.geometry } } }).toArray();
  } catch (_) {
    // Vectorised raster outlines can be invalid polygons, which $geoIntersects
    // rejects; the centroid is always a valid point.
    areas = alert.centroid
      ? await watches.find({ kind: 'area', geometry: { $geoIntersects: { $geometry: alert.centroid } } }).toArray()
      : [];
  }
  const fmus = alert.region ? await watches.find({ kind: 'fmus', fmus: alert.region }).toArray() : [];
  return [...areas, ...fmus];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} opts
 * @param {string} opts.appUrl   origin links in the email point to, no trailing slash
 * @param {boolean} [opts.dryRun] match and report, but neither mark alerts nor send
 * @returns summary counts, plus per-user results for the caller to show
 */
async function runAlertNotifications({ appUrl, dryRun = false, now = new Date() } = {}) {
  if (!appUrl) throw new Error('appUrl is required');
  await ensureWatchIndexes();
  const alerts = await getCollection('disturbance_alerts');
  const watches = await getCollection('alert_watches');
  const users = await getCollection('users');
  const log = await getCollection('alert_notifications');

  const fresh = await alerts.find({
    notifiedAt: { $exists: false },
    createdAt: { $gte: new Date(now.getTime() - MAX_ALERT_AGE_DAYS * DAY) },
  }).sort({ createdAt: 1 }).limit(MAX_ALERTS_PER_RUN).toArray();

  const summary = { dryRun, newAlerts: fresh.length, matchedUsers: 0, sent: 0, simulated: 0, failed: 0, skippedOptedOut: 0, results: [] };
  if (!fresh.length) return summary;

  if (!dryRun) {
    await alerts.updateMany({ _id: { $in: fresh.map((a) => a._id) } }, { $set: { notifiedAt: now } });
  }

  // userId -> alertId -> { alert, names: Set<watch name> }
  const byUser = new Map();
  for (const alert of fresh) {
    for (const w of await watchesForAlert(watches, alert)) {
      if (!byUser.has(w.userId)) byUser.set(w.userId, new Map());
      const perUser = byUser.get(w.userId);
      if (!perUser.has(alert.alertId)) perUser.set(alert.alertId, { alert, names: new Set() });
      perUser.get(alert.alertId).names.add(w.kind === 'area' ? w.name : fmuLabel(alert.region));
    }
  }
  summary.matchedUsers = byUser.size;
  if (!byUser.size) return summary;

  const ids = [...byUser.keys()].filter(ObjectId.isValid).map((id) => new ObjectId(id));
  const userDocs = await users.find({ _id: { $in: ids } }, { projection: { email: 1, name: 1, alertEmails: 1 } }).toArray();

  let first = true;
  for (const user of userDocs) {
    const userId = user._id.toString();
    if (user.alertEmails === false) { summary.skippedOptedOut++; continue; }

    const items = [...byUser.get(userId).values()]
      .sort((a, b) => new Date(b.alert.firstDetected) - new Date(a.alert.firstDetected))
      .map(({ alert, names }) => ({
        alertId: alert.alertId,
        areaHa: alert.areaHa,
        region: alert.region,
        regionLabel: fmuLabel(alert.region),
        firstDetected: alert.firstDetected,
        status: alert.status,
        confidence: alert.confidence,
        vegLossPct: alert.vegLossPct,
        mock: Boolean(alert.mock),
        link: `${appUrl}/?alert=${encodeURIComponent(alert.alertId)}`,
        matchedBy: [...names],
      }));

    const unsub = unsubscribeUrl(appUrl, userId);
    const email = renderAlertDigest({
      name: user.name,
      alerts: items,
      appUrl: `${appUrl}/?alerts=open`,
      manageUrl: `${appUrl}/?alerts=watch`,
      unsubscribeUrl: unsub,
    });

    const result = { email: user.email, alerts: items.length, subject: email.subject };
    if (dryRun) { summary.results.push(result); continue; }

    if (!first) await sleep(SEND_INTERVAL_MS);
    first = false;
    try {
      const sent = await sendEmail({ to: user.email, ...email, unsubscribeUrl: unsub });
      if (sent.simulated) summary.simulated++; else summary.sent++;
      result.resendId = sent.id || null;
    } catch (err) {
      summary.failed++;
      result.error = err.message;
      console.error(`[Alert notify] ${user.email}: ${err.message}`);
    }
    summary.results.push(result);
    await log.insertOne({
      userId,
      email: user.email,
      alertIds: items.map((i) => i.alertId),
      subject: email.subject,
      sentAt: new Date(),
      resendId: result.resendId || null,
      error: result.error || null,
    });
  }
  return summary;
}

module.exports = { runAlertNotifications, ensureWatchIndexes, unsubscribeUrl, fmuLabel, FMU_LABELS };
