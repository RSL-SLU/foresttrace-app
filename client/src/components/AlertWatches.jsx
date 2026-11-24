import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { FMU_LABELS } from './FMUSelector';
import {
  fetchWatches, watchArea, watchFmus, unwatch, setAlertEmails,
  sendTestEmail, runNotifications, drawnAreaGeometry,
} from '../utils/alerts';

const fmuName = (id) => FMU_LABELS[id] || id;
const NOTICE_MS = 8000;

/**
 * "Email notifications" section of the Disturbance Alerts panel: the areas
 * and FMUs the signed-in user watches, and whether alerts in them are emailed.
 * Matching and sending happen server side (api/_alertNotify.js), daily.
 *
 * Layout: an on/off switch, one "Watching" list (areas and FMUs together),
 * an "Add" block, and a footer for test tools. Each message appears in the
 * block whose action caused it.
 */
function AlertWatches({ drawnFeatures = [], selectedFMUs = [], zoomToGeometry, focus = 0 }) {
  const { token, user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [state, setState] = useState(null);      // fetchWatches() result
  const [loadError, setLoadError] = useState(null);
  // { where: 'list' | 'area' | 'fmus' | 'footer' | 'prefs', kind: 'ok' | 'error', text }
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null);         // name of the running action
  const [areaName, setAreaName] = useState('');
  // The drawing last saved as an area, so the form doesn't offer it twice
  const [savedDrawing, setSavedDrawing] = useState(null);   // { key, name }
  const sectionRef = useRef(null);
  const nameRef = useRef(null);

  const load = useCallback(async () => {
    try {
      setState(await fetchWatches(token));
      setLoadError(null);
    } catch (err) {
      setLoadError(err.message);
    }
  }, [token]);

  useEffect(() => { if (token) load(); }, [token, load]);

  // Success messages fade; errors stay until the next action.
  useEffect(() => {
    if (notice?.kind !== 'ok') return undefined;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

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
  const drawnKey = useMemo(() => (drawnGeometry ? JSON.stringify(drawnGeometry.coordinates) : null), [drawnGeometry]);
  const drawingSaved = Boolean(drawnKey && savedDrawing?.key === drawnKey);
  const areas = (state?.watches || []).filter((w) => w.kind === 'area');
  const watchedFmus = (state?.watches || []).find((w) => w.kind === 'fmus')?.fmus || [];
  const fmusToAdd = selectedFMUs.filter((f) => FMU_LABELS[f] && !watchedFmus.includes(f));

  // Runs one change, then reloads so the list is what the server holds.
  // Resolves true on success; errors are shown where they happened, not thrown.
  async function act(name, where, fn, okText) {
    setBusy(name);
    setNotice(null);
    try {
      const result = await fn();
      // Stay open while being edited: saving a first watch would otherwise
      // collapse the section under the user's cursor.
      setOpenChoice((c) => c ?? true);
      const text = typeof okText === 'function' ? okText(result) : okText;
      if (text) setNotice({ where, kind: 'ok', text });
      await load();
      return true;
    } catch (err) {
      setNotice({ where, kind: 'error', text: err.message });
      return false;
    } finally {
      setBusy(null);
    }
  }

  const Notice = ({ where }) => (notice?.where === where ? (
    <p className={`aw-notice aw-notice--${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
      {notice.kind === 'ok' && <span aria-hidden="true">✓ </span>}
      {notice.text}
    </p>
  ) : null);

  if (!state) {
    return (
      <div className="module-section alert-watches" ref={sectionRef}>
        <h3>Email notifications</h3>
        {loadError ? <p className="alert-error">{loadError}</p> : <p className="stat-sub">Loading…</p>}
      </div>
    );
  }

  const enabled = state.emailsEnabled;
  const watchingAnything = areas.length > 0 || watchedFmus.length > 0;
  const open = openChoice ?? !watchingAnything;

  const watchingSummary = [
    areas.length ? `${areas.length} area${areas.length === 1 ? '' : 's'}` : null,
    watchedFmus.length > 2 ? `${watchedFmus.length} FMUs` : (watchedFmus.map(fmuName).join(' and ') || null),
  ].filter(Boolean).join(' and ');

  const header = (
    <div className="alert-watch-head">
      <h3>Email notifications</h3>
      <button type="button" className="alert-link" aria-expanded={open} onClick={() => setOpenChoice(!open)}>
        {open ? 'Hide' : 'Manage'}
      </button>
    </div>
  );

  if (!open) {
    return (
      <div className="module-section alert-watches" ref={sectionRef}>
        {header}
        <p className="stat-sub">
          {watchingAnything ? `Watching ${watchingSummary}` : 'Not watching any areas or FMUs'}
          {' · '}{enabled ? 'emails on' : 'emails off'}
        </p>
      </div>
    );
  }

  const removeFmu = (f) => act(`fmu:${f}`, 'list', () => watchFmus(token, watchedFmus.filter((x) => x !== f)),
    `Stopped watching ${fmuName(f)}.`);

  return (
    <div className="module-section alert-watches" ref={sectionRef}>
      {header}
      <p className="stat-sub aw-intro">
        Get one email a day when new alerts appear in an area you drew or an FMU you chose.
      </p>

      {/* On / off */}
      <label className="switch range-switch aw-switch" htmlFor="aw-emails">
        <span className="range-name">
          Email me new alerts
          <span className="aw-switch-sub">to {state.email}</span>
        </span>
        <input
          id="aw-emails"
          type="checkbox"
          role="switch"
          checked={enabled}
          disabled={busy === 'prefs'}
          onChange={(e) => act('prefs', 'prefs', () => setAlertEmails(token, e.target.checked),
            e.target.checked ? 'Emails on.' : 'Emails paused. Your areas and FMUs are kept.')}
        />
        <span className="switch-track" aria-hidden="true" />
      </label>
      <Notice where="prefs" />

      {/* Everything watched, in one list */}
      <p className="aw-label">Watching{watchingAnything ? ` (${areas.length + watchedFmus.length})` : ''}</p>
      {!watchingAnything ? (
        <p className="stat-sub">Nothing yet. Add an area or an FMU below.</p>
      ) : (
        <ul className="aw-list">
          {areas.map((w) => (
            <li key={w.id} className="aw-row">
              <span className="aw-kind" title="Area you drew">Area</span>
              <span className="aw-name">{w.name}</span>
              {zoomToGeometry && (
                <button type="button" className="alert-link" onClick={() => zoomToGeometry(w.geometry)}>Zoom</button>
              )}
              <button
                type="button"
                className="aw-remove"
                disabled={busy === w.id}
                aria-label={`Stop watching ${w.name}`}
                title="Stop watching"
                onClick={() => act(w.id, 'list', () => unwatch(token, w.id), `Stopped watching ${w.name}.`)}
              >
                ×
              </button>
            </li>
          ))}
          {watchedFmus.map((f) => (
            <li key={f} className="aw-row">
              <span className="aw-kind aw-kind--fmu" title="Forest Management Unit">FMU</span>
              <span className="aw-name">{fmuName(f)}</span>
              <button
                type="button"
                className="aw-remove"
                disabled={busy === `fmu:${f}`}
                aria-label={`Stop watching ${fmuName(f)}`}
                title="Stop watching"
                onClick={() => removeFmu(f)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <Notice where="list" />

      {/* Add */}
      <p className="aw-label">Add</p>
      {drawingSaved ? (
        <p className="aw-notice aw-notice--ok" role="status">
          ✓ Your drawing is saved as “{savedDrawing.name}”. Draw another shape to add more.
        </p>
      ) : drawnGeometry ? (
        <form
          className="aw-add-area"
          onSubmit={async (e) => {
            e.preventDefault();
            const name = areaName.trim() || `Area ${areas.length + 1}`;
            const ok = await act('area', 'area', () => watchArea(token, name, drawnGeometry));
            if (ok) {
              setSavedDrawing({ key: drawnKey, name });
              setAreaName('');
            }
          }}
        >
          <span className="aw-hint">
            Your drawing{drawnGeometry.type === 'MultiPolygon' ? 's' : ''} on the map:
          </span>
          <div className="aw-add-row">
            <input
              ref={nameRef}
              type="text"
              className="alert-watch-input"
              placeholder={`Area ${areas.length + 1}`}
              value={areaName}
              maxLength={80}
              onChange={(e) => setAreaName(e.target.value)}
              aria-label="Name for the drawn area"
            />
            <button type="submit" className="aw-button" disabled={busy === 'area'}>
              {busy === 'area' ? 'Saving…' : 'Save area'}
            </button>
          </div>
        </form>
      ) : (
        <p className="stat-sub">
          <strong>Your own area:</strong> draw a polygon or rectangle with the tools at the bottom
          left of the map, then save it here.
        </p>
      )}
      <Notice where="area" />

      {fmusToAdd.length > 0 && (
        <button
          type="button"
          className="aw-button aw-button--outline"
          disabled={busy === 'fmus'}
          onClick={() => act('fmus', 'fmus', () => watchFmus(token, [...watchedFmus, ...fmusToAdd]),
            `Now watching ${fmusToAdd.length === 1 ? fmuName(fmusToAdd[0]) : `${fmusToAdd.length} more FMUs`}.`)}
        >
          + Watch {fmusToAdd.length === 1 ? fmuName(fmusToAdd[0]) : `the ${fmusToAdd.length} selected FMUs`}
        </button>
      )}
      {fmusToAdd.length === 0 && (
        <p className="stat-sub">
          <strong>An FMU:</strong>{' '}
          {selectedFMUs.length ? 'the selected FMUs are already watched. Select others' : 'select one'} in the
          province selector over the map.
        </p>
      )}
      <Notice where="fmus" />

      {/* Tools */}
      <div className="aw-footer">
        <button
          type="button"
          className="alert-link"
          disabled={busy === 'test'}
          onClick={() => act('test', 'footer', () => sendTestEmail(token), (r) => (r.simulated
            ? 'Email isn’t set up on this server (no RESEND_API_KEY), so the message went to the server log.'
            : `Test email sent to ${r.to}. It can take a minute to arrive.`))}
        >
          {busy === 'test' ? 'Sending…' : 'Send me a test email'}
        </button>
        {isAdmin && (
          <button
            type="button"
            className="alert-link"
            disabled={busy === 'notify'}
            title="Admins: runs the daily check now, emailing everyone watching a place where a new alert fell"
            onClick={() => act('notify', 'footer', () => runNotifications(token), (r) => {
              if (r.newAlerts === 0) return 'No new alerts since the last check, so no emails were sent.';
              const emailed = r.sent + r.simulated;
              const alerts = `${r.newAlerts} new alert${r.newAlerts === 1 ? '' : 's'}`;
              const people = emailed ? `emailed ${emailed} ${emailed === 1 ? 'person' : 'people'}` : 'nobody watches where they are';
              return `Found ${alerts}; ${people}${r.failed ? ` (${r.failed} failed)` : ''}${r.simulated ? ' (to the server log: no RESEND_API_KEY)' : ''}.`;
            })}
          >
            {busy === 'notify' ? 'Checking…' : 'Run the daily check now'}
          </button>
        )}
      </div>
      <Notice where="footer" />
      {isAdmin && !state.mailerConfigured && (
        <p className="stat-sub">RESEND_API_KEY isn’t set on this server, so emails go to its log instead.</p>
      )}
    </div>
  );
}

export default AlertWatches;
