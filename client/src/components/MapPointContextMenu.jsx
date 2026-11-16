import React from 'react';
import { createPortal } from 'react-dom';

function MapPointContextMenu({ point, onClose, onCopy, onAsk }) {
  if (!point) return null;

  const coordinates = `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
  const left = `${Math.max(8, Math.min(point.x, window.innerWidth - 224))}px`;
  const top = `${Math.max(8, Math.min(point.y, window.innerHeight - 128))}px`;

  return createPortal(
    <div className="map-point-menu-backdrop" role="presentation" onClick={onClose}>
      <div
        className="map-point-menu"
        role="menu"
        aria-label="Map point actions"
        style={{ left, top }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="map-point-menu-coordinates">Lat, lon: {coordinates}</div>
        <button type="button" role="menuitem" onClick={() => onCopy(coordinates)}>
          {point.copied ? 'Copied coordinates' : 'Copy coordinates'}
        </button>
        {point.copyError && <div className="map-point-menu-error" role="status">{point.copyError}</div>}
        <button type="button" role="menuitem" onClick={() => onAsk(point)}>
          Ask AI about this point
        </button>
      </div>
    </div>,
    document.body,
  );
}

export default MapPointContextMenu;
