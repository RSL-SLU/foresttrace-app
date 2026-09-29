import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import '../styles/auth.css';

function BugReportModal({ isOpen, onClose, currentContext }) {
  const { token } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch('/api/reports', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title,
          description,
          context: currentContext || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit bug report');
      }

      setSuccess(true);
      setTitle('');
      setDescription('');
      setTimeout(() => {
        setSuccess(false);
        onClose();
      }, 1800);
    } catch (err) {
      setError(err.message || 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    setError(null);
    setSuccess(false);
    onClose();
  }

  return (
    <div className="auth-backdrop" onClick={handleClose}>
      <div className="auth-modal" style={{ maxWidth: 500 }} onClick={(e) => e.stopPropagation()}>
        <button
          className="auth-close-btn"
          type="button"
          onClick={handleClose}
          aria-label="Close dialog"
        >
          &times;
        </button>

        <div className="auth-header">
          <div className="auth-logo-badge" style={{ background: '#d97706' }}>🐛</div>
          <h2 className="auth-title">Report an Issue or Feedback</h2>
          <p className="auth-subtitle">
            Let our remote sensing engineering team know if you encountered a bug, tile loading error, or calculation discrepancy.
          </p>
        </div>

        {success ? (
          <div style={{ padding: '32px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 36, color: '#16a34a', marginBottom: 12 }}>✓</div>
            <h3 style={{ margin: '0 0 8px', fontSize: 17, color: '#16a34a' }}>Report Submitted!</h3>
            <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
              Thank you for helping us improve ForestTrace. Our team has received your report.
            </p>
          </div>
        ) : (
          <form className="auth-form" onSubmit={handleSubmit}>
            {error && <div className="auth-error-box">{error}</div>}

            {currentContext && (
              <div
                style={{
                  background: 'rgba(0,0,0,0.03)',
                  padding: '8px 12px',
                  borderRadius: 6,
                  fontSize: 12,
                  color: '#64748b',
                }}
              >
                <strong>Attached Map Context:</strong>{' '}
                {currentContext.module && <span>Module: {currentContext.module} | </span>}
                {currentContext.year && <span>Year: {currentContext.year} | </span>}
                {currentContext.fmus && currentContext.fmus.length > 0 && (
                  <span>FMUs: {currentContext.fmus.join(', ')}</span>
                )}
              </div>
            )}

            <div className="auth-form-group">
              <label htmlFor="bug-title">Issue Summary</label>
              <input
                id="bug-title"
                className="auth-input"
                type="text"
                placeholder="e.g. 2023 clearcut layer didn't load in Dryden FMU"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            <div className="auth-form-group">
              <label htmlFor="bug-desc">Details & Reproduction Steps</label>
              <textarea
                id="bug-desc"
                className="auth-input"
                rows={4}
                style={{ resize: 'vertical', fontFamily: 'inherit' }}
                placeholder="Please describe what you observed, what you expected, and any error message you saw…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
              />
            </div>

            <button
              className="auth-submit-btn"
              type="submit"
              disabled={submitting}
              style={{ background: '#d97706' }}
            >
              {submitting ? 'Submitting Report…' : 'Submit Issue Report'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default BugReportModal;

