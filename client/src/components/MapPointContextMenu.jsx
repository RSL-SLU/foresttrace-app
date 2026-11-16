import React from 'react';
import { createPortal } from 'react-dom';

function MapPointContextMenu({ point, onClose, onCopy, onAsk }) {
  if (!point) return null;

  const coordinates = `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
  const left = `min(${point.x}px, calc(100vw - 224px))`;
  const top = `min(${point.y}px, calc(100vh - 128px))`;

  return createPortal(
    <div className="map-point-menu-backdrop" onClick={onClose}>
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
