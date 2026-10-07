/**
 * Disturbance Alerts: API access and display helpers.
 *
 * Alerts follow NASA OPERA DIST-ALERT-HLS semantics (provisional -> confirmed,
 * high confidence at >= 50 % vegetation loss); see api/alerts.js.
 */

const DAY = 24 * 60 * 60 * 1000;

// By age since first detection. Pink-to-violet so alerts never read as the
// clearcut (amber/red) or wildfire (orange) layers they may sit on top of.
export const ALERT_AGE_BUCKETS = [
  { maxDays: 7, label: 'Last 7 days', color: '#ff2d95' },
  { maxDays: 30, label: '8–30 days', color: '#c026d3' },
  { maxDays: 90, label: '31–90 days', color: '#7c3aed' },
  { maxDays: Infinity, label: 'Older', color: '#64748b' },
];

export const TRIAGE_LABELS = {
  clearcut: 'Clearcut',
  fire: 'Fire',
  natural: 'Natural disturbance',
  false_positive: 'False positive',
};

export function ageDays(iso, now = Date.now()) {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / DAY));
}

export function ageColor(days) {
  return ALERT_AGE_BUCKETS.find((b) => days <= b.maxDays).color;
}

export function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function relativeDays(days) {
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}

/** [minLng, minLat, maxLng, maxLat] of a GeoJSON geometry. */
export function geometryBounds(geometry) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]);
      b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]);
    } else c.forEach(walk);
  };
  walk(geometry.coordinates);
  return b;
}

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** All alerts from the last `days` days, as a FeatureCollection with meta. */
export async function fetchAlerts(token, days = 180) {
  const res = await fetch(`/api/alerts?action=list&days=${days}`, { headers: authHeaders(token) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Alerts request failed (HTTP ${res.status})`);
  return data;
}

/** Sets (or clears, with label null) an alert's triage label. Staff only. */
export async function triageAlert(token, id, label, note = '') {
  const res = await fetch('/api/alerts?action=triage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ id, label, note }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Triage failed (HTTP ${res.status})`);
  return data.feature;
}
