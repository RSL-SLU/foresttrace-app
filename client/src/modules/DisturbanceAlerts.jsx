import { useEffect, useMemo, useState } from 'react';
import AlertImagery from '../components/AlertImagery';
import {
  ALERT_AGE_BUCKETS, TRIAGE_LABELS, ageColor, formatDate, relativeDays,
} from '../utils/alerts';
import '../styles/alerts.css';

const LAST_SEEN_KEY = 'foresttrace_alerts_last_seen';
const PERIODS = [7, 30, 90, 180];
const LIST_PAGE = 25;

// When this viewer last opened the module, read once and then moved to now,
// so "new since your last visit" survives a reload but not a second visit.
function useLastSeen() {
  const [lastSeen] = useState(() => {
    try { return Number(localStorage.getItem(LAST_SEEN_KEY)) || null; } catch { return null; }
  });
  useEffect(() => {
    try { localStorage.setItem(LAST_SEEN_KEY, String(Date.now())); } catch { /* private mode */ }
  }, []);
  return lastSeen;
}

function StatusBadge({ status, confidence }) {
  return (
    <span className={`alert-badge alert-badge--${status}`}>
      {status === 'confirmed' ? 'Confirmed' : 'Provisional'}
      {confidence === 'high' ? ' · high' : ' · low'}
    </span>
  );
}

function AlertDetail({ feature, alerts }) {
  const p = feature.properties;
  const [note, setNote] = useState(p.triageNote || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { setNote(p.triageNote || ''); setError(null); }, [p.id, p.triageNote]);

  async function setLabel(label) {
    setSaving(true);
    setError(null);
    try {
      await alerts.triage(p.id, label, note);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="module-section alert-detail">
      <div className="alert-detail-head">
        <h3>Alert {p.id}</h3>
        <button type="button" className="alert-link" onClick={() => alerts.select(null)}>Close</button>
      </div>

      <div className="alert-detail-badges">
        <StatusBadge status={p.status} confidence={p.confidence} />
        {p.triageLabel && <span className="alert-badge alert-badge--triage">{TRIAGE_LABELS[p.triageLabel]}</span>}
        {p.inFirePerimeter && <span className="alert-badge alert-badge--fire">Inside fire perimeter</span>}
      </div>

      <dl className="alert-facts">
        <dt>First detected</dt><dd>{formatDate(p.firstDetected)} ({relativeDays(p.ageDays)})</dd>
        <dt>Last observed</dt><dd>{formatDate(p.lastObserved)}</dd>
        <dt>Observations</dt><dd>{p.observations} satellite pass{p.observations === 1 ? '' : 'es'}</dd>
        <dt>Vegetation loss</dt><dd>up to {p.vegLossPct}%</dd>
        <dt>Area</dt><dd>{p.areaHa.toLocaleString()} ha</dd>
        <dt>FMU</dt><dd className="alert-capitalize">{p.region}</dd>
      </dl>

      <AlertImagery geometry={feature.geometry} beforeYear={p.beforeYear || 2020} color={p.ageColor} />

      <button type="button" className="alert-button" onClick={() => alerts.zoomTo(feature)}>
        Zoom to alert
      </button>

      {alerts.canTriage && (
        <div className="alert-triage">
          <p className="alert-triage-title">Review</p>
          <div className="alert-triage-buttons">
            {Object.entries(TRIAGE_LABELS).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`alert-chip-button${p.triageLabel === value ? ' alert-chip-button--active' : ''}`}
                disabled={saving}
                onClick={() => setLabel(p.triageLabel === value ? null : value)}
              >
                {label}
              </button>
            ))}
          </div>
          <textarea
            className="alert-note"
            placeholder="Note (visible to staff only)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
          />
          {p.triagedBy && (
            <p className="stat-sub">Reviewed by {p.triagedBy} on {formatDate(p.triagedAt)}</p>
          )}
          {error && <p className="alert-error">{error}</p>}
        </div>
      )}
    </div>
  );
}

function DisturbanceAlerts({ data }) {
  const alerts = data?.alerts;
  const lastSeen = useLastSeen();
  const [shown, setShown] = useState(LIST_PAGE);

  const all = useMemo(() => alerts?.all || [], [alerts?.all]);
  const features = useMemo(() => alerts?.features || [], [alerts?.features]);
  const selected = features.find((f) => f.properties.id === alerts?.selectedId)
    || all.find((f) => f.properties.id === alerts?.selectedId);

  // Headline counts are over everything in the selected areas, not the filters,
  // so "last 7 days" doesn't change when the period filter does.
  const counts = useMemo(() => {
    const within = (d) => all.filter((f) => f.properties.ageDays <= d).length;
    return {
      newSinceVisit: lastSeen ? all.filter((f) => new Date(f.properties.firstDetected) > lastSeen).length : null,
      week: within(7),
      month: within(30),
    };
  }, [all, lastSeen]);
  const filteredArea = features.reduce((sum, f) => sum + (f.properties.areaHa || 0), 0);

  if (!alerts) return null;
  const { filters, setFilters } = alerts;

  return (
    <div className="alerts-module">
      <div className="module-section">
        <p className="alert-source">
          Source: NASA OPERA DIST-ALERT-HLS
          {alerts.meta?.mock && <span className="alert-badge alert-badge--demo">Demo data</span>}
        </p>
        <p className="stat-sub">
          Near real-time vegetation-loss alerts from Landsat and Sentinel-2 (HLS). New
          passes every 2–3 days; clouds and snow can delay detection.
        </p>
        {!alerts.layerOn && (
          <button type="button" className="alert-button" onClick={alerts.showLayer}>Show alerts on map</button>
        )}
      </div>

      {alerts.error && (
        <div className="module-section">
          <p className="alert-error">Couldn’t load alerts: {alerts.error}</p>
          <button type="button" className="alert-button" onClick={alerts.refresh}>Try again</button>
        </div>
      )}

      <div className="module-section">
        <div className="alert-stats">
          {counts.newSinceVisit !== null && (
            <div className="alert-stat alert-stat--new">
              <span className="alert-stat-value">{counts.newSinceVisit}</span>
              <span className="alert-stat-label">New since your last visit</span>
            </div>
          )}
          <div className="alert-stat">
            <span className="alert-stat-value">{counts.week}</span>
            <span className="alert-stat-label">Last 7 days</span>
          </div>
          <div className="alert-stat">
            <span className="alert-stat-value">{counts.month}</span>
            <span className="alert-stat-label">Last 30 days</span>
          </div>
        </div>
        {alerts.loading && <p className="stat-sub">Loading alerts…</p>}
      </div>

      {selected && <AlertDetail key={selected.properties.id} feature={selected} alerts={alerts} />}

      <div className="module-section">
        <h3>Filters</h3>
        <div className="alert-filter-row" role="group" aria-label="Period">
          {PERIODS.map((d) => (
            <button
              key={d}
              type="button"
              className={`alert-chip-button${filters.days === d ? ' alert-chip-button--active' : ''}`}
              onClick={() => setFilters({ ...filters, days: d })}
            >
              {d} days
            </button>
          ))}
        </div>
        <div className="alert-filter-row" role="group" aria-label="Status">
          {[['all', 'All'], ['confirmed', 'Confirmed'], ['provisional', 'Provisional']].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`alert-chip-button${filters.status === value ? ' alert-chip-button--active' : ''}`}
              onClick={() => setFilters({ ...filters, status: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="alert-checkbox">
          <input
            type="checkbox"
            checked={filters.hideFire}
            onChange={(e) => setFilters({ ...filters, hideFire: e.target.checked })}
          />
          Hide likely fire and dismissed alerts
        </label>
      </div>

      <div className="module-section">
        <h3>
          Alerts ({features.length}) · {Math.round(filteredArea).toLocaleString()} ha
        </h3>
        {features.length === 0 && !alerts.loading && (
          <p className="stat-sub">No alerts match these filters in the selected areas.</p>
        )}
        <ul className="alert-list">
          {features.slice(0, shown).map((f) => {
            const p = f.properties;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className={`alert-row${p.id === alerts.selectedId ? ' alert-row--selected' : ''}`}
                  onClick={() => { alerts.select(p.id); alerts.zoomTo(f); }}
                >
                  <span className="alert-row-dot" style={{ background: p.ageColor }} aria-hidden="true" />
                  <span className="alert-row-main">
                    <span className="alert-row-title">{p.areaHa.toLocaleString()} ha · {relativeDays(p.ageDays)}</span>
                    <span className="alert-row-sub">
                      {p.status === 'confirmed' ? 'Confirmed' : 'Provisional'}
                      {' · '}{p.vegLossPct}% loss
                      {p.triageLabel ? ` · ${TRIAGE_LABELS[p.triageLabel]}` : ''}
                      {p.inFirePerimeter && !p.triageLabel ? ' · fire perimeter' : ''}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {features.length > shown && (
          <button type="button" className="alert-link" onClick={() => setShown(shown + LIST_PAGE)}>
            Show {Math.min(LIST_PAGE, features.length - shown)} more
          </button>
        )}
      </div>

      <div className="module-section">
        <h3>Legend</h3>
        {ALERT_AGE_BUCKETS.map((b) => (
          <div className="legend-item" key={b.label}>
            <span className="legend-color" style={{ background: ageColor(b.maxDays === Infinity ? 999 : b.maxDays), opacity: 0.85 }} />
            <span>{b.label}</span>
          </div>
        ))}
        <div className="legend-item">
          <span className="alert-legend-line" />
          <span>Confirmed (repeated vegetation loss)</span>
        </div>
        <div className="legend-item">
          <span className="alert-legend-line alert-legend-line--dashed" />
          <span>Provisional (seen once or twice)</span>
        </div>
      </div>
    </div>
  );
}

export default DisturbanceAlerts;
