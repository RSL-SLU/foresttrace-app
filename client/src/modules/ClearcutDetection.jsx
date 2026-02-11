import React from 'react';

/**
 * ClearcutDetection Module Component
 * Displays clearcut detection statistics and controls
 */
function ClearcutDetection({ data }) {
  return (
    <div className="clearcut-module">
      <div className="module-section">
        <h3>Detection Results</h3>
        {data?.percentage ? (
          <div className="stat-item">
            <div className="stat-label">Clearcut Area</div>
            <div className="stat-value">{data.percentage}%</div>
            <div className="stat-bar">
              <div 
                className="stat-fill" 
                style={{ width: `${data.percentage}%` }}
              ></div>
            </div>
          </div>
        ) : (
          <p className="no-data">No data available. Draw an area on the map.</p>
        )}
      </div>

      <div className="module-section">
        <h3>Display Options</h3>
        <div className="control-group">
          <label htmlFor="opacity-slider">Overlay Opacity</label>
          <input
            id="opacity-slider"
            type="range"
            min="0"
            max="1"
            step="0.01"
            defaultValue="0.50"
            className="slider"
            onChange={(e) => {
              const event = new CustomEvent('opacityChange', {
                detail: { opacity: parseFloat(e.target.value) }
              });
              window.dispatchEvent(event);
            }}
          />
        </div>
      </div>

      <div className="module-section">
        <h3>Legend</h3>
        <div className="legend-item">
          <span className="legend-color red"></span>
          <span>Clearcut Area</span>
        </div>
        <div className="legend-item">
          <span className="legend-color satellite"></span>
          <span>Satellite Imagery</span>
        </div>
      </div>
    </div>
  );
}

export default ClearcutDetection;
