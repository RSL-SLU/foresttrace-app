import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { upload } from '@vercel/blob/client';
import { useAuth } from '../context/AuthContext';
import '../styles/auth.css';
import '../styles/admin.css';

// Above this size the SDK splits the file into parallel, retried parts.
const MULTIPART_BYTES = 50 * 1024 * 1024;

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

/**
 * Upload COGs into a production module folder (api/uploads.js). Files go live
 * as soon as they finish and cannot replace an existing file.
 */
function DataUploadModal({ isOpen, onClose }) {
  const { token } = useAuth();
  const [targets, setTargets] = useState([]);
  const [maxBytes, setMaxBytes] = useState(null);
  const [prefix, setPrefix] = useState('');
  const [rows, setRows] = useState([]); // { file, status, error, progress }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    if (!isOpen || !token) return;
    setError(null);
    fetch('/api/uploads?action=targets', { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Could not load upload folders');
        setTargets(json.targets || []);
        setMaxBytes(json.maxBytes || null);
        setPrefix((p) => p || json.targets?.[0]?.prefix || '');
      })
      .catch((err) => setError(err.message));
  }, [isOpen, token]);

  if (!isOpen) return null;

  const target = targets.find((t) => t.prefix === prefix);
  const namePattern = target?.kind === 'static' ? '<region>.tif' : '<region>_<year>.tif';
  const readyCount = rows.filter((r) => r.status === 'ready').length;

  function patchRow(name, patch) {
    setRows((prev) => prev.map((r) => (r.file.name === name ? { ...r, ...patch } : r)));
  }

  async function checkFiles(files, forPrefix) {
    if (!files.length || !forPrefix) return;
    setSummary(null);
    setRows(files.map((file) => ({
      file,
      status: maxBytes && file.size > maxBytes ? 'invalid' : 'checking',
      error: maxBytes && file.size > maxBytes ? `Larger than the ${formatBytes(maxBytes)} limit` : null,
      progress: 0,
    })));
    try {
      const res = await fetch('/api/uploads?action=check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ prefix: forPrefix, fileNames: files.map((f) => f.name) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not check the files');
      const byName = new Map(json.results.map((r) => [r.fileName, r]));
      setRows((prev) => prev.map((r) => {
        if (r.status === 'invalid') return r;
        const result = byName.get(r.file.name);
        return result?.ok
          ? { ...r, status: 'ready', error: null }
          : { ...r, status: 'invalid', error: result?.error || 'Rejected' };
      }));
    } catch (err) {
      setRows((prev) => prev.map((r) => (r.status === 'checking' ? { ...r, status: 'invalid', error: err.message } : r)));
    }
  }

  function handleFiles(e) {
    checkFiles(Array.from(e.target.files || []), prefix);
    e.target.value = '';
  }

  function handlePrefixChange(next) {
    setPrefix(next);
    // Names are judged against the folder's rule, so re-check for the new one.
    if (rows.length) checkFiles(rows.map((r) => r.file), next);
  }

  async function handleUpload() {
    setBusy(true);
    setSummary(null);
    const done = [];
    for (const row of rows) {
      if (row.status !== 'ready') continue;
      const { file } = row;
      const pathname = `cogs/${prefix}/${file.name}`;
      patchRow(file.name, { status: 'uploading', progress: 0 });
      try {
        await upload(pathname, file, {
          access: 'public',
          handleUploadUrl: '/api/uploads',
          headers: { Authorization: `Bearer ${token}` },
          contentType: 'image/tiff',
          multipart: file.size > MULTIPART_BYTES,
          onUploadProgress: ({ percentage }) => patchRow(file.name, { progress: percentage }),
        });
        patchRow(file.name, { status: 'done', progress: 100 });
        done.push(pathname);
      } catch (err) {
        patchRow(file.name, { status: 'failed', error: err.message || 'Upload failed' });
      }
    }

    if (done.length) {
      try {
        const res = await fetch('/api/uploads?action=complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ pathnames: done }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Could not register the uploads');
        setSummary(json.manifestUpdated
          ? `${done.length} file(s) uploaded and live in the map.`
          : `${done.length} file(s) uploaded, but the layer index did not update (${json.manifestError || 'unknown error'}). Ask an admin to rebuild the manifest.`);
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
                Files go <strong>live immediately</strong> and <strong>cannot be replaced or deleted</strong> by you.
                Check names and data before uploading. Charts are not updated by uploads; tell an admin when a new year or region needs its stats refreshed.
              </div>

              <div className="auth-form-group">
                <label htmlFor="upload-target">Layer</label>
                <select
                  id="upload-target"
                  className="auth-input"
                  value={prefix}
                  disabled={busy}
                  onChange={(e) => handlePrefixChange(e.target.value)}
                >
                  {targets.map((t) => (
                    <option key={t.prefix} value={t.prefix}>{t.label} ({t.prefix})</option>
                  ))}
                </select>
                <span className="upload-note">
                  File names must be <code>{namePattern}</code>, lowercase, as Cloud-Optimized GeoTIFFs
                  {maxBytes ? `, up to ${formatBytes(maxBytes)} each` : ''}.
                </span>
              </div>

              <div className="auth-form-group">
                <label htmlFor="upload-files">Files</label>
                <input id="upload-files" type="file" accept=".tif,image/tiff" multiple disabled={busy} onChange={handleFiles} />
              </div>

              {rows.length > 0 && (
                <div className="admin-table-container">
                  <table className="admin-table">
                    <thead>
                      <tr><th>File</th><th>Size</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.file.name}>
                          <td><code>{r.file.name}</code></td>
                          <td>{formatBytes(r.file.size)}</td>
                          <td>
                            <span className={`upload-status upload-status--${r.status}`}>
                              {STATUS_LABEL[r.status]}
                              {r.status === 'uploading' ? ` ${Math.round(r.progress)}%` : ''}
                            </span>
                            {r.error && <div className="upload-row-error">{r.error}</div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {summary && <div className="upload-summary">{summary}</div>}

              <button
                type="button"
                className="auth-submit-btn"
                style={{ marginTop: 16 }}
                disabled={busy || readyCount === 0}
                onClick={handleUpload}
              >
                {busy ? 'Uploading…' : `Upload ${readyCount} file(s) to ${prefix}`}
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
