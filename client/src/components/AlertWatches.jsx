import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { FMU_LABELS } from './FMUSelector';
import {
  fetchWatches, watchArea, watchFmus, unwatch, setAlertEmails,
  sendTestEmail, runNotifications, drawnAreaGeometry,
} from '../utils/alerts';

const fmuName = (id) => FMU_LABELS[id] || id;

/**
 * "Email notifications" section of the Disturbance Alerts panel: the areas
 * and FMUs the signed-in user watches, and whether alerts in them are emailed.
 * Matching and sending happen server side (api/_alertNotify.js), daily.
 */
function AlertWatches({ drawnFeatures = [], selectedFMUs = [], zoomToGeometry, focus = false }) {
  const { token, user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [state, setState] = useState(null);      // fetchWatches() result
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null);         // name of the running action
  const [areaName, setAreaName] = useState('');
  const sectionRef = useRef(null);
  const nameRef = useRef(null);

  const load = useCallback(async () => {
    try {
      setState(await fetchWatches(token));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [token]);

  useEffect(() => { if (token) load(); }, [token, load]);

  // Open/closed. Unset means automatic: open until the user watches
  // something, then a one-line summary so the alert detail and list below
  // stay in reach.
  const [openChoice, setOpenChoice] = useState(null);

  // Brought forward by "Manage what you watch" in an alert email or "Get
  // alerts" on the map: `focus` changes on each request. Opens the section;
  // with a shape drawn, the cursor goes to its name so saving is type-and-Enter.
  const loaded = Boolean(state);
  const handledFocus = useRef(0);
  useEffect(() => {
    if (focus) setOpenChoice(true);
  }, [focus]);
  useEffect(() => {
    if (!focus || !loaded || openChoice !== true || handledFocus.current === focus) return;
    handledFocus.current = focus;
    sectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    nameRef.current?.focus({ preventScroll: true });
  }, [focus, loaded, openChoice]);

  const drawnGeometry = useMemo(() => drawnAreaGeometry(drawnFeatures), [drawnFeatures]);
  const areas = (state?.watches || []).filter((w) => w.kind === 'area');
  const watchedFmus = (state?.watches || []).find((w) => w.kind === 'fmus')?.fmus || [];
  const fmusToAdd = selectedFMUs.filter((f) => FMU_LABELS[f] && !watchedFmus.includes(f));

  // Runs one change, then reloads so the list is what the server holds.
  // Resolves true on success; errors are shown, not thrown.
  async function act(name, fn, done) {
    setBusy(name);
    setError(null);
    setNotice(null);
    try {
      const result = await fn();
      // Stay open while being edited: saving a first watch would otherwise
      // collapse the section under the user's cursor.
      setOpenChoice((c) => c ?? true);
      if (done) setNotice(typeof done === 'function' ? done(result) : done);
      await load();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (!state) {
    return (
      <div className="module-section alert-watches" ref={sectionRef}>
        <h3>Email notifications</h3>
        {error ? <p className="alert-error">{error}</p> : <p className="stat-sub">Loading…</p>}
      </div>
    );
  }

  const enabled = state.emailsEnabled;
  const watchingAnything = areas.length > 0 || watchedFmus.length > 0;
  const open = openChoice ?? !watchingAnything;

  const watching = [
    areas.length ? `${areas.length} area${areas.length === 1 ? '' : 's'}` : null,
    watchedFmus.length > 2 ? `${watchedFmus.length} FMUs` : (watchedFmus.map(fmuName).join(' and ') || null),
  ].filter(Boolean).join(' and ');

  const header = (
    <div className="alert-watch-head">
      <h3>Email notifications</h3>
      <button
        type="button"
        className="alert-link"
        aria-expanded={open}
        onClick={() => setOpenChoice(!open)}
      >
        {open ? 'Hide' : 'Manage'}
      </button>
    </div>
  );

  if (!open) {
    return (
      <div className="module-section alert-watches" ref={sectionRef}>
        {header}
        <p className="stat-sub">
          {watchingAnything ? `Watching ${watching}` : 'Not watching any areas or FMUs'}
          {' · '}{enabled ? 'emails on' : 'emails off'}
        </p>
      </div>
    );
  }

  return (
    <div className="module-section alert-watches" ref={sectionRef}>
      {header}
      <p className="stat-sub">
        Get an email when a new alert is detected in an area you drew or an FMU you chose.
        New alerts are checked once a day.
      </p>

      <label className="alert-checkbox">
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy === 'prefs'}
          onChange={(e) => act('prefs', () => setAlertEmails(token, e.target.checked))}
        />
        Email me at <strong className="alert-watch-email">{state.email}</strong>
      </label>
      {!enabled && watchingAnything && (
        <p className="stat-sub">Emails are off. Your areas and FMUs are kept.</p>
      )}

      <p className="alert-triage-title">Areas of interest</p>
      {areas.length === 0 && <p className="stat-sub">No saved areas yet.</p>}
      <ul className="alert-watch-list">
        {areas.map((w) => (
          <li key={w.id} className="alert-watch-row">
            <span className="alert-watch-name">{w.name}</span>
            {zoomToGeometry && (
              <button type="button" className="alert-link" onClick={() => zoomToGeometry(w.geometry)}>Zoom</button>
            )}
            <button
              type="button"
              className="alert-link"
              disabled={busy === w.id}
              aria-label={`Stop watching ${w.name}`}
              onClick={() => act(w.id, () => unwatch(token, w.id))}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>

      {drawnGeometry ? (
        <form
          className="alert-watch-save"
          onSubmit={(e) => {
            e.preventDefault();
            act('area', () => watchArea(token, areaName.trim(), drawnGeometry), 'Area saved. You’ll be emailed about new alerts inside it.')
              .then((ok) => { if (ok) setAreaName(''); });
          }}
        >
          <input
            ref={nameRef}
            type="text"
            className="alert-watch-input"
            placeholder={`Name, e.g. Area ${areas.length + 1}`}
            value={areaName}
            maxLength={80}
            onChange={(e) => setAreaName(e.target.value)}
            aria-label="Name for the drawn area"
          />
          <button type="submit" className="alert-button" disabled={busy === 'area'}>
            {busy === 'area' ? 'Saving…' : `Watch drawn area${drawnGeometry.type === 'MultiPolygon' ? 's' : ''}`}
          </button>
        </form>
      ) : (
        <p className="stat-sub">
          Draw a polygon or rectangle with the drawing tools at the bottom left of the map,
          then save it here.
        </p>
      )}

      <p className="alert-triage-title">Forest Management Units</p>
      {watchedFmus.length === 0 && <p className="stat-sub">No FMUs watched.</p>}
      <div className="alert-watch-chips">
        {watchedFmus.map((f) => (
          <span key={f} className="alert-watch-chip">
            {fmuName(f)}
            <button
              type="button"
              aria-label={`Stop watching ${fmuName(f)}`}
              disabled={busy === 'fmus'}
              onClick={() => act('fmus', () => watchFmus(token, watchedFmus.filter((x) => x !== f)))}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {fmusToAdd.length > 0 && (
        <button
          type="button"
          className="alert-button"
          disabled={busy === 'fmus'}
          onClick={() => act('fmus', () => watchFmus(token, [...watchedFmus, ...fmusToAdd]))}
        >
          Watch {fmusToAdd.length === 1 ? fmuName(fmusToAdd[0]) : `the ${fmusToAdd.length} selected FMUs`}
        </button>
      )}

      <div className="alert-watch-actions">
        <button
          type="button"
          className="alert-link"
          disabled={busy === 'test'}
          onClick={() => act('test', () => sendTestEmail(token), (r) => (r.simulated
            ? 'Email isn’t configured on the server (no RESEND_API_KEY); the message was printed to the server log.'
            : `Test email sent to ${r.to}.`))}
        >
          Send me a test email
        </button>
        {isAdmin && (
          <button
            type="button"
            className="alert-link"
            disabled={busy === 'notify'}
            onClick={() => act('notify', () => runNotifications(token), (r) => (r.newAlerts === 0
              ? 'No new alerts since the last check.'
              : `${r.newAlerts} new alert${r.newAlerts === 1 ? '' : 's'}; ${r.sent + r.simulated} email${r.sent + r.simulated === 1 ? '' : 's'} sent${r.failed ? `, ${r.failed} failed` : ''}${r.simulated ? ' (printed to the server log: no RESEND_API_KEY)' : ''}.`))}
          >
            {busy === 'notify' ? 'Checking…' : 'Check for new alerts now'}
          </button>
        )}
      </div>
      {isAdmin && !state.mailerConfigured && (
        <p className="stat-sub">RESEND_API_KEY isn’t set on this server, so emails are printed to its log instead of sent.</p>
      )}

      {notice && <p className="alert-notice" role="status">{notice}</p>}
      {error && <p className="alert-error">{error}</p>}
    </div>
  );
}

export default AlertWatches;
