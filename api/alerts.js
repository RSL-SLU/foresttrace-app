const {
  getCollection,
  getUserFromRequest,
  getMongoUri,
} = require('./_db');

/**
 * Disturbance Alerts (OPERA DIST-ALERT-HLS shaped documents in
 * `disturbance_alerts`; see scripts/alerts/seed-mock-alerts.js for the schema).
 *
 *   GET  /api/alerts?action=list[&region=a,b][&days=180]   signed in
 *   POST /api/alerts?action=triage { id, label, note }     analyst / admin
 *
 * Any signed-in user can read alerts (the rest of the map is open to
 * everyone). Triage notes and who triaged stay with staff; everyone sees the
 * resulting label.
 */

const TRIAGE_LABELS = new Set(['clearcut', 'fire', 'natural', 'false_positive']);
const STAFF_ROLES = new Set(['admin', 'analyst']);
const MAX_DAYS = 365;
const DAY = 24 * 60 * 60 * 1000;

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

  const action = (req.query?.action || req.body?.action || 'list').toLowerCase();
  const user = getUserFromRequest(req);
  const isStaff = Boolean(user && STAFF_ROLES.has(user.role));

  try {
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
