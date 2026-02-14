import React from 'react';

/**
 * Biomass Module Component
 * Displays biomass density visualization controls and legend
 */
function BiomassModule({ data }) {
  return (
    <div className="biomass-module">
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
        <h3>Legend - Biomass Density (Mg/ha)</h3>
        <div className="legend-gradient" style={{ position: 'relative', height: '220px', marginBottom: '10px' }}>
          <div className="continuous-gradient-bar" style={{
            background: 'linear-gradient(to bottom, rgb(0, 100, 80), rgb(0, 180, 40), rgb(0, 255, 0), rgb(100, 255, 0), rgb(178, 255, 0), rgb(230, 255, 0), rgb(255, 255, 0), rgb(255, 225, 75), rgb(255, 200, 150))',
            width: '40px',
            height: '220px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            position: 'absolute',
            left: '0'
          }}></div>
          <div style={{ position: 'absolute', left: '50px', width: '80px', height: '220px' }}>
            <div style={{ position: 'absolute', top: '0%', transform: 'translateY(-50%)', fontSize: '13px' }}>~176</div>
            <div style={{ position: 'absolute', top: '6.4%', transform: 'translateY(-50%)', fontSize: '13px' }}>~150</div>
            <div style={{ position: 'absolute', top: '20.1%', transform: 'translateY(-50%)', fontSize: '13px' }}>~100</div>
            <div style={{ position: 'absolute', top: '27.1%', transform: 'translateY(-50%)', fontSize: '13px' }}>~75</div>
            <div style={{ position: 'absolute', top: '36.3%', transform: 'translateY(-50%)', fontSize: '13px' }}>~50</div>
            <div style={{ position: 'absolute', top: '49.1%', transform: 'translateY(-50%)', fontSize: '13px' }}>~25</div>
            <div style={{ position: 'absolute', top: '64.5%', transform: 'translateY(-50%)', fontSize: '13px' }}>~10</div>
            <div style={{ position: 'absolute', top: '100%', transform: 'translateY(-100%)', fontSize: '13px' }}>0</div>
          </div>
        </div>
        <div className="legend-note">
          <small>AGB = Above Ground Biomass<br/>
          Enhanced sensitivity at lower values (0-50 Mg/ha)</small>
        </div>
      </div>
    </div>
  );
}

export default BiomassModule;
