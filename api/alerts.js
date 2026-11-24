const {
  getCollection,
  getUserFromRequest,
  getMongoUri,
  ObjectId,
  signValue,
  safeEqual,
} = require('./_db');
const { sendEmail, isConfigured: mailerConfigured, renderTestEmail, escapeHtml } = require('./_mailer');
const { runAlertNotifications, ensureWatchIndexes, FMU_LABELS } = require('./_alertNotify');

/**
 * Disturbance Alerts (OPERA DIST-ALERT-HLS shaped documents in
 * `disturbance_alerts`; see scripts/alerts/seed-mock-alerts.js for the schema).
 *
 *   GET  /api/alerts?action=list[&region=a,b][&days=180]   signed in
 *   POST /api/alerts?action=triage { id, label, note }     analyst / admin
 *
 * Email notifications (api/_alertNotify.js):
 *   GET  ?action=watches                          signed in: own watches + email settings
 *   POST ?action=watch-area { name, geometry }    save a drawn area of interest
 *   POST ?action=watch-fmus { fmus: [...] }       replace the watched FMUs ([] clears)
 *   POST ?action=unwatch { id }                   delete one watch
 *   POST ?action=email-prefs { enabled }          turn alert emails on or off
 *   POST ?action=test-email                       send yourself a test message
 *   GET|POST ?action=notify[&dryRun=1]            Vercel Cron (CRON_SECRET) or admin
 *   GET|POST ?action=unsubscribe&u=&s=            link in every alert email
 *
 * Any signed-in user can read alerts (the rest of the map is open to
 * everyone). Triage notes and who triaged stay with staff; everyone sees the
 * resulting label.
 */

const TRIAGE_LABELS = new Set(['clearcut', 'fire', 'natural', 'false_positive']);
const STAFF_ROLES = new Set(['admin', 'analyst']);
const MAX_DAYS = 365;
const DAY = 24 * 60 * 60 * 1000;
const MAX_AREA_WATCHES = 20;
const MAX_WATCH_VERTICES = 5000;
const TEST_EMAIL_INTERVAL_MS = 60 * 1000;

// Where links in emails point. APP_URL pins it (set it in production: a cron
// request arrives on the deployment's own hostname, not the public domain).
function appOrigin(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  const h = req.headers || {};
  const host = String(h['x-forwarded-host'] || h.host || 'localhost').split(',')[0].trim();
  const proto = String(h['x-forwarded-proto'] || (host.startsWith('localhost') ? 'http' : 'https')).split(',')[0].trim();
  return `${proto}://${host}`;
}

function isCronRequest(req) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers?.authorization || '';
  return Boolean(secret) && safeEqual(auth, `Bearer ${secret}`);
}

function countVertices(coords) {
  return typeof coords[0] === 'number' ? 1 : coords.reduce((n, c) => n + countVertices(c), 0);
}

function validAreaGeometry(g) {
  if (!g || !['Polygon', 'MultiPolygon'].includes(g.type) || !Array.isArray(g.coordinates)) return false;
  try {
    const n = countVertices(g.coordinates);
    return n >= 4 && n <= MAX_WATCH_VERTICES;
  } catch (_) {
    return false;
  }
}

const watchToJson = (w) => ({
  id: w._id.toString(),
  kind: w.kind,
  name: w.name || null,
  geometry: w.geometry || null,
  fmus: w.fmus || null,
  createdAt: w.createdAt,
});

function unsubscribePage({ title, message, form }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f1f5f9;color:#1e293b}
main{max-width:440px;margin:15vh auto;padding:28px 24px;background:#fff;border:1px solid #e2e8f0;border-radius:12px}
h1{font-size:18px;margin:0 0 10px}p{font-size:14px;line-height:1.6;margin:0 0 16px}
button{background:#7c3aed;color:#fff;border:0;border-radius:8px;padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer}</style></head>
<body><main><h1>${escapeHtml(title)}</h1><p>${message}</p>${form || ''}</main></body></html>`;
}

function toFeature(doc, isStaff) {
  return {
    type: 'Feature',
    id: doc.alertId,
    geometry: doc.geometry,
    properties: {
      id: doc.alertId,
      region: doc.region,
      source: doc.source,
      mock: Boolean(doc.mock),
      areaHa: doc.areaHa,
      firstDetected: doc.firstDetected,
      lastObserved: doc.lastObserved,
      observations: doc.observations,
      status: doc.status,
      confidence: doc.confidence,
      vegLossPct: doc.vegLossPct,
      centroid: doc.centroid?.coordinates,
      inFirePerimeter: Boolean(doc.context?.inFirePerimeter),
      beforeYear: doc.imagery?.beforeYear ?? null,
      triageLabel: doc.triage?.label ?? null,
      ...(isStaff && doc.triage ? {
        triageNote: doc.triage.note || '',
        triagedBy: doc.triage.by,
        triagedAt: doc.triage.at,
      } : {}),
    },
  };
}

module.exports = async function handler(req, res) {
  if (!getMongoUri()) {
    return res.status(503).json({ error: 'Database service unavailable' });
  }

  const action = String(req.query?.action || req.body?.action || 'list').toLowerCase();
  const user = getUserFromRequest(req);
  const isStaff = Boolean(user && STAFF_ROLES.has(user.role));

  try {
    // ---- Unsubscribe: no session, the signed link is the authority. GET
    // only shows a button, since mail scanners prefetch links; the POST is the
    // button and the one-click List-Unsubscribe request from the mail client.
    if (action === 'unsubscribe') {
      const u = String(req.query?.u || '');
      const valid = ObjectId.isValid(u) && safeEqual(req.query?.s, signValue(`alert-unsub:${u}`));
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (!valid) {
        return res.status(400).send(unsubscribePage({ title: 'Link not valid', message: 'This unsubscribe link is incomplete or has been altered. You can turn alert emails off in ForestTrace, under Disturbance Alerts.' }));
      }
      if (req.method === 'POST') {
        const users = await getCollection('users');
        await users.updateOne({ _id: new ObjectId(u) }, { $set: { alertEmails: false, alertEmailsUpdatedAt: new Date() } });
        return res.status(200).send(unsubscribePage({ title: 'Alert emails turned off', message: 'You won’t get disturbance alert emails any more. Your saved areas and FMUs are kept; turn emails back on in ForestTrace, under Disturbance Alerts.' }));
      }
      return res.status(200).send(unsubscribePage({
        title: 'Stop alert emails?',
        message: 'You’ll stop getting emails about new disturbance alerts. Your saved areas and FMUs are kept.',
        form: '<form method="POST"><button type="submit">Stop alert emails</button></form>',
      }));
    }

    // ---- Notify: daily from Vercel Cron, or an admin testing it
    if (action === 'notify') {
      if (!isCronRequest(req) && user?.role !== 'admin') {
        return res.status(403).json({ error: 'Only administrators can run alert notifications.' });
      }
      const dryRun = ['1', 'true'].includes(String(req.query?.dryRun || req.body?.dryRun || ''));
      const summary = await runAlertNotifications({ appUrl: appOrigin(req), dryRun });
      console.log('[Alert notify]', JSON.stringify({ ...summary, results: undefined }));
      return res.status(200).json({ success: true, mailerConfigured: mailerConfigured(), ...summary });
    }

    // ---- Watches and email settings: the signed-in user's own
    const watchActions = new Set(['watches', 'watch-area', 'watch-fmus', 'unwatch', 'email-prefs', 'test-email']);
    if (watchActions.has(action)) {
      if (!user?.id || !ObjectId.isValid(user.id)) return res.status(401).json({ error: 'Sign in to manage alert emails.' });
      await ensureWatchIndexes();
      const watches = await getCollection('alert_watches');
      const users = await getCollection('users');
      const userId = new ObjectId(user.id);

      if (req.method === 'GET' && action === 'watches') {
        const [docs, me] = await Promise.all([
          watches.find({ userId: user.id }).sort({ createdAt: 1 }).toArray(),
          users.findOne({ _id: userId }, { projection: { email: 1, alertEmails: 1 } }),
        ]);
        return res.status(200).json({
          watches: docs.map(watchToJson),
          email: me?.email || user.email,
          emailsEnabled: me?.alertEmails !== false,
          mailerConfigured: mailerConfigured(),
        });
      }

      if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
      const body = req.body || {};

      if (action === 'watch-area') {
        const name = String(body.name || '').trim().slice(0, 80) || 'Area of interest';
        if (!validAreaGeometry(body.geometry)) {
          return res.status(400).json({ error: 'Draw a polygon, rectangle or circle to watch.' });
        }
        if (await watches.countDocuments({ userId: user.id, kind: 'area' }) >= MAX_AREA_WATCHES) {
          return res.status(400).json({ error: `You can watch up to ${MAX_AREA_WATCHES} areas. Delete one to add another.` });
        }
        const doc = { userId: user.id, kind: 'area', name, geometry: { type: body.geometry.type, coordinates: body.geometry.coordinates }, createdAt: new Date() };
        try {
          const { insertedId } = await watches.insertOne(doc);
          return res.status(201).json({ watch: watchToJson({ ...doc, _id: insertedId }) });
        } catch (err) {
          // The 2dsphere index refuses self-intersecting or otherwise invalid shapes.
          if (err.code === 16755 || /geo keys|Loop is not valid|Edges .* cross/i.test(err.message)) {
            return res.status(400).json({ error: 'That shape can’t be watched: its outline crosses itself. Redraw it and try again.' });
          }
          throw err;
        }
      }

      if (action === 'watch-fmus') {
        const fmus = [...new Set((Array.isArray(body.fmus) ? body.fmus : []).map(String))].filter((f) => FMU_LABELS[f]);
        if (!fmus.length) {
          await watches.deleteMany({ userId: user.id, kind: 'fmus' });
          return res.status(200).json({ watch: null });
        }
        const result = await watches.findOneAndUpdate(
          { userId: user.id, kind: 'fmus' },
          { $set: { fmus, updatedAt: new Date() }, $setOnInsert: { userId: user.id, kind: 'fmus', createdAt: new Date() } },
          { upsert: true, returnDocument: 'after' },
        );
        return res.status(200).json({ watch: watchToJson(result?.value ?? result) });
      }

      if (action === 'unwatch') {
        if (!ObjectId.isValid(body.id)) return res.status(400).json({ error: 'Watch id is required.' });
        const { deletedCount } = await watches.deleteOne({ _id: new ObjectId(body.id), userId: user.id });
        if (!deletedCount) return res.status(404).json({ error: 'Watch not found.' });
        return res.status(200).json({ success: true });
      }

      if (action === 'email-prefs') {
        const enabled = Boolean(body.enabled);
        await users.updateOne({ _id: userId }, { $set: { alertEmails: enabled, alertEmailsUpdatedAt: new Date() } });
        return res.status(200).json({ emailsEnabled: enabled });
      }

      if (action === 'test-email') {
        const me = await users.findOne({ _id: userId }, { projection: { email: 1, name: 1, lastTestEmailAt: 1 } });
        if (!me) return res.status(404).json({ error: 'Account not found.' });
        if (me.lastTestEmailAt && Date.now() - new Date(me.lastTestEmailAt).getTime() < TEST_EMAIL_INTERVAL_MS) {
          return res.status(429).json({ error: 'A test email was just sent. Wait a minute before sending another.' });
        }
        await users.updateOne({ _id: userId }, { $set: { lastTestEmailAt: new Date() } });
        const sent = await sendEmail({ to: me.email, ...renderTestEmail({ name: me.name, appUrl: appOrigin(req) }) });
        return res.status(200).json({ success: true, to: me.email, simulated: Boolean(sent.simulated) });
      }
    }

    const alerts = await getCollection('disturbance_alerts');

    if (req.method === 'GET' && action === 'list') {
      if (!user) return res.status(401).json({ error: 'Sign in to see disturbance alerts.' });
      const days = Math.min(MAX_DAYS, Math.max(1, parseInt(req.query?.days, 10) || 180));
      const query = { firstDetected: { $gte: new Date(Date.now() - days * DAY) } };
      const regions = String(req.query?.region || '')
        .split(',').map((r) => r.trim()).filter(Boolean);
      if (regions.length) query.region = { $in: regions };

      const docs = await alerts.find(query).sort({ firstDetected: -1 }).limit(2000).toArray();
      return res.status(200).json({
        type: 'FeatureCollection',
        features: docs.map((d) => toFeature(d, isStaff)),
        meta: {
          generatedAt: new Date(),
          days,
          mock: docs.some((d) => d.mock),
          canTriage: isStaff,
        },
      });
    }

    if (req.method === 'POST' && action === 'triage') {
      if (!isStaff) {
        return res.status(403).json({ error: 'Only analysts and administrators can triage alerts.' });
      }
      const { id, label = null, note = '' } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Alert id is required.' });
      if (label !== null && !TRIAGE_LABELS.has(label)) {
        return res.status(400).json({ error: `Unknown label: ${label}` });
      }

      const update = label === null
        ? { $set: { triage: null } }
        : { $set: { triage: { label, note: String(note).slice(0, 1000), by: user.email, at: new Date() } } };
      const result = await alerts.findOneAndUpdate({ alertId: id }, update, { returnDocument: 'after' });
      const doc = result?.value ?? result;   // driver v4 returns { value }, v5+ the document
      if (!doc) return res.status(404).json({ error: 'Alert not found.' });
      return res.status(200).json({ success: true, feature: toFeature(doc, true) });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    console.error('[Alerts API Error]', err);
    return res.status(500).json({ error: err.message || 'Alerts service error' });
  }
};
