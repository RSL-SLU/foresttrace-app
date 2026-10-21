import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Full-screen lightbox for a Wildlands League field-site photo, so the image
 * opens inside the app instead of as a download in a new tab. Shows our
 * Blob copy (photoUrl, scripts/data/build-loggingscars-photos.js). Closes on Esc,
 * the close button, or a click on the backdrop.
 */
function SitePhotoModal({ site, onClose }) {
  const [status, setStatus] = useState('loading');
  const closeRef = useRef(null);

  useEffect(() => {
    setStatus('loading');
  }, [site?.photoUrl]);

  useEffect(() => {
    if (!site) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [site, onClose]);

  if (!site?.photoUrl) return null;

  return createPortal(
    <div className="site-photo-backdrop" onClick={onClose} role="presentation">
      <figure
        className="site-photo-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Photo of ${site.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button ref={closeRef} type="button" className="site-photo-close" onClick={onClose} aria-label="Close photo">×</button>
        {status === 'loading' && <div className="site-photo-status">Loading photo…</div>}
        {status === 'error' ? (
          <div className="site-photo-status">
            The photo could not be loaded.{' '}
            <a href={site.photoUrl} target="_blank" rel="noopener noreferrer">Open it in a new tab</a>
          </div>
        ) : (
          <img
            src={site.photoUrl}
            alt={`Field site ${site.name}`}
            onLoad={() => setStatus('ok')}
            onError={() => setStatus('error')}
            style={status === 'ok' ? undefined : { display: 'none' }}
          />
        )}
        <figcaption>
          <strong>{site.name}</strong>
          {site.fmuName ? ` · ${site.fmuName}` : ''}
          <span className="site-photo-credit">
            Photo: Wildlands League · <a href="https://loggingscars.ca" target="_blank" rel="noopener noreferrer">loggingscars.ca</a>
          </span>
        </figcaption>
      </figure>
    </div>,
    document.body,
  );
}

export default SitePhotoModal;
