import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { upload } from '@vercel/blob/client';
import { useAuth } from '../context/AuthContext';
import '../styles/auth.css';
import '../styles/admin.css';

// Above this size the SDK splits the file into parallel, retried parts.
const MULTIPART_BYTES = 50 * 1024 * 1024;
const CONCURRENCY = 3;
const BATCH = 1000; // server's per-request limit for check/complete
const AUTO = '__auto__';

const STATUS_LABEL = {
  checking: 'Checking…',
  ready: 'Ready',
  invalid: 'Rejected',
  uploading: 'Uploading',
  done: 'Uploaded',
  failed: 'Failed',
};

function formatBytes(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  return `${(n / 1e6).toFixed(1)} MB`;
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * The layer a picked file belongs to: the nearest folder in its path named
 * after a layer (so picking prepare-boreal-cogs.py's whole foresttrace_cogs/
 * output sorts every product into its own layer), else the chosen layer.
 */
function layerFor(file, choice, prefixes) {
  const dirs = (file.webkitRelativePath || '').split('/').slice(0, -1).reverse();
  const fromPath = dirs.find((d) => prefixes.has(d));
  if (choice === AUTO) return fromPath || null;
  return choice;
}

/**
 * Upload COGs into production module folders (api/uploads.js). Files go live
 * as soon as the batch finishes; replacing existing files requires an admin grant.
 */
function DataUploadModal({ isOpen, onClose }) {
  const { token } = useAuth();
  const [targets, setTargets] = useState([]);
  const [maxBytes, setMaxBytes] = useState(null);
  const [choice, setChoice] = useState(AUTO);
  const [rows, setRows] = useState([]); // { key, file, prefix, pathname, status, error, progress }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);
  const folderInput = useRef(null);

  useEffect(() => {
    if (!isOpen || !token) return;
    setError(null);
    fetch('/api/uploads?action=targets', { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Could not load upload layers');
        setTargets(json.targets || []);
        setMaxBytes(json.maxBytes || null);
      })
      .catch((err) => setError(err.message));
  }, [isOpen, token]);

  // React drops the non-standard webkitdirectory prop; set it on the node.
  useEffect(() => {
    if (folderInput.current) folderInput.current.setAttribute('webkitdirectory', '');
  });

  if (!isOpen) return null;

  const prefixes = new Set(targets.map((t) => t.prefix));
  const target = targets.find((t) => t.prefix === choice);
  const ready = rows.filter((r) => r.status === 'ready');
  const counts = rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});

  function patchRow(key, patch) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function checkFiles(files, layerChoice) {
    setSummary(null);
    const tifs = files.filter((f) => /\.tiff?$/i.test(f.name));
    const initial = tifs.map((file) => {
      const prefix = layerFor(file, layerChoice, prefixes);
      const key = `${prefix || '?'}/${file.webkitRelativePath || file.name}`;
      const base = { key, file, prefix, pathname: prefix ? `cogs/${prefix}/${file.name}` : null, progress: 0 };
      if (!prefix) return { ...base, status: 'invalid', error: 'Not inside a layer folder -- pick a layer above' };
      if (maxBytes && file.size > maxBytes) return { ...base, status: 'invalid', error: `Larger than the ${formatBytes(maxBytes)} limit` };
      return { ...base, status: 'checking', error: null };
    });
    setRows(initial);

    const pending = initial.filter((r) => r.status === 'checking');
    try {
      const verdicts = new Map();
      for (const part of chunk(pending, BATCH)) {
        const res = await fetch('/api/uploads?action=check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ items: part.map((r) => ({ prefix: r.prefix, fileName: r.file.name })) }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Could not check the files');
        json.results.forEach((v, i) => verdicts.set(part[i].key, v));
      }
      setRows((prev) => prev.map((r) => {
        const v = verdicts.get(r.key);
        if (!v) return r;
        return v.ok
          ? { ...r, status: 'ready', overwrites: Boolean(v.overwrites) }
          : { ...r, status: 'invalid', error: v.error || 'Rejected' };
      }));
    } catch (err) {
      setRows((prev) => prev.map((r) => (r.status === 'checking' ? { ...r, status: 'invalid', error: err.message } : r)));
    }
  }

  function handlePick(e) {
    checkFiles(Array.from(e.target.files || []), choice);
    e.target.value = '';
  }

  function handleChoiceChange(next) {
    setChoice(next);
    // Layers decide the paths and naming rules, so re-check under the new choice.
    if (rows.length) checkFiles(rows.map((r) => r.file), next);
  }

  async function handleUpload() {
    const queue = rows.filter((r) => r.status === 'ready');
    const replacing = queue.filter((r) => r.overwrites);
    if (replacing.length) {
      const examples = replacing.slice(0, 10).map((r) => r.pathname);
      const remaining = replacing.length - examples.length;
      const list = examples.join('\n');
      const suffix = remaining > 0 ? `\n…and ${remaining} more file(s).` : '';
      if (!window.confirm(
        `Replace ${replacing.length} existing production COG(s)?\n\n${list}${suffix}\n\nThis change takes effect immediately.`,
      )) return;
    }
    setBusy(true);
    setSummary(null);
    const done = [];
    let next = 0;
    async function worker() {
      while (next < queue.length) {
        const r = queue[next];
        next += 1;
        patchRow(r.key, { status: 'uploading', progress: 0 });
        try {
          await upload(r.pathname, r.file, {
            access: 'public',
            handleUploadUrl: '/api/uploads',
            headers: { Authorization: `Bearer ${token}` },
            contentType: 'image/tiff',
            multipart: r.file.size > MULTIPART_BYTES,
            onUploadProgress: ({ percentage }) => patchRow(r.key, { progress: percentage }),
          });
          patchRow(r.key, { status: 'done', progress: 100 });
          done.push(r.pathname);
        } catch (err) {
          patchRow(r.key, { status: 'failed', error: err.message || 'Upload failed' });
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

    if (done.length) {
      try {
        let manifestError = null;
        for (const part of chunk(done, BATCH)) {
          const res = await fetch('/api/uploads?action=complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ pathnames: part }),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(json.error || 'Could not register the uploads');
          if (!json.manifestUpdated) manifestError = json.manifestError || 'unknown error';
        }
        setSummary(manifestError
          ? `${done.length} file(s) uploaded, but the layer index did not update (${manifestError}). Ask an admin to rebuild the manifest.`
          : `${done.length} file(s) uploaded and live in the map.`);
      } catch (err) {
        setSummary(`${done.length} file(s) uploaded, but registering them failed: ${err.message}. Ask an admin to rebuild the manifest.`);
      }
    }
    setBusy(false);
  }

  function handleClose() {
    if (busy) return;
    setRows([]);
    setSummary(null);
    onClose();
  }

  // Long batches: show problems first, then the rest.
  const ORDER = { invalid: 0, failed: 1, uploading: 2, checking: 3, ready: 4, done: 5 };
  const sortedRows = [...rows].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.key.localeCompare(b.key));

  return createPortal(
    <div className="admin-modal-backdrop" onClick={handleClose}>
      <div className="admin-modal upload-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-header">
          <h2><span>⬆️</span> Upload Data</h2>
          <button className="auth-close-btn" type="button" onClick={handleClose} aria-label="Close upload dialog" disabled={busy}>
            &times;
          </button>
        </div>

        <div className="admin-body">
          {error && <div className="auth-error-box" style={{ marginBottom: 16 }}>{error}</div>}

          {!error && targets.length === 0 && (
            <p className="upload-note">You do not have upload access to any layer yet. Ask an administrator to grant it.</p>
          )}

          {targets.length > 0 && (
            <>
              <div className="upload-warning">
                Files go <strong>live immediately</strong>. Replacing existing files requires an admin grant for that layer and confirmation before upload.
                Check names and data carefully. Uploads don't update the charts; tell an admin when a new year or region needs its stats refreshed.
              </div>

              <div className="auth-form-group">
                <label htmlFor="upload-target">Layer</label>
                <select
                  id="upload-target"
                  className="auth-input"
                  value={choice}
                  disabled={busy}
                  onChange={(e) => handleChoiceChange(e.target.value)}
                >
                  <option value={AUTO}>From folder names (e.g. a whole foresttrace_cogs/ output)</option>
                  {targets.map((t) => (
                    <option key={t.prefix} value={t.prefix}>{t.label} ({t.prefix})</option>
                  ))}
                </select>
                <span className="upload-note">
                  {choice === AUTO
                    ? <>Each file goes to the layer named by its folder, e.g. <code>clearcut-status-v2/wabigoon_2021.tif</code>. Pick the folder that holds the layer folders.</>
                    : <>Every file goes to <code>{choice}</code>, named <code>{target?.kind === 'static' ? '<region>.tif' : '<region>_<year>.tif'}</code>.</>}
                  {' '}Names are lowercase; {maxBytes ? `up to ${formatBytes(maxBytes)} per file.` : ''}
                </span>
              </div>

              <div className="auth-form-group">
                <label>Choose</label>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <label className="admin-action-btn" style={{ fontSize: 13, padding: '6px 12px' }}>
                    📁 A folder
                    <input ref={folderInput} type="file" multiple hidden disabled={busy} onChange={handlePick} />
                  </label>
                  <label className="admin-action-btn" style={{ fontSize: 13, padding: '6px 12px' }}>
                    📄 Files
                    <input type="file" accept=".tif,image/tiff" multiple hidden disabled={busy} onChange={handlePick} />
                  </label>
                </div>
              </div>

              {rows.length > 0 && (
                <>
                  <p className="upload-note" style={{ marginBottom: 8 }}>
                    {rows.length} file(s): {Object.entries(counts).map(([s, n]) => `${n} ${STATUS_LABEL[s].toLowerCase().replace('…', '')}`).join(' · ')}
                  </p>
                  <div className="admin-table-container" style={{ maxHeight: 320, overflowY: 'auto' }}>
                    <table className="admin-table">
                      <thead>
                        <tr><th>Layer</th><th>File</th><th>Size</th><th>Status</th></tr>
                      </thead>
                      <tbody>
                        {sortedRows.map((r) => (
                          <tr key={r.key}>
                            <td><code>{r.prefix || '—'}</code></td>
                            <td><code>{r.file.name}</code></td>
                            <td>{formatBytes(r.file.size)}</td>
                            <td>
                              <span className={`upload-status upload-status--${r.status}`}>
                                {r.overwrites && r.status === 'ready' ? 'Will replace' : STATUS_LABEL[r.status]}
                                {r.status === 'uploading' ? ` ${Math.round(r.progress)}%` : ''}
                              </span>
                              {r.error && <div className="upload-row-error">{r.error}</div>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {summary && <div className="upload-summary">{summary}</div>}

              <button
                type="button"
                className="auth-submit-btn"
                style={{ marginTop: 16 }}
                disabled={busy || ready.length === 0}
                onClick={handleUpload}
              >
                {busy ? 'Uploading…' : `Upload ${ready.length} file(s)`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default DataUploadModal;
