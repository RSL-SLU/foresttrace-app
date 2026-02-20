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
            background: `linear-gradient(to bottom, 
              rgb(0, 100, 0) 0%, 
              rgb(0, 200, 0) 11%, 
              rgb(0, 255, 0) 37%, 
              rgb(50, 220, 0) 59%, 
              rgb(255, 255, 0) 70%, 
              rgb(255, 190, 0) 81%, 
              rgb(255, 120, 0) 92%, 
              rgb(220, 180, 140) 100%)`,
            width: '40px',
            height: '220px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            position: 'absolute',
            left: '0'
          }}></div>
          <div style={{ position: 'absolute', left: '50px', width: '80px', height: '220px' }}>
            <div style={{ position: 'absolute', top: '0%', transform: 'translateY(-50%)', fontSize: '13px' }}>135</div>
            <div style={{ position: 'absolute', top: '10.4%', transform: 'translateY(-50%)', fontSize: '13px' }}>~121</div>
            <div style={{ position: 'absolute', top: '23.7%', transform: 'translateY(-50%)', fontSize: '13px' }}>~103</div>
            <div style={{ position: 'absolute', top: '37.8%', transform: 'translateY(-50%)', fontSize: '13px' }}>~84</div>
            <div style={{ position: 'absolute', top: '48.1%', transform: 'translateY(-50%)', fontSize: '13px' }}>~70</div>
            <div style={{ position: 'absolute', top: '57.8%', transform: 'translateY(-50%)', fontSize: '13px' }}>~57</div>
            <div style={{ position: 'absolute', top: '67.4%', transform: 'translateY(-50%)', fontSize: '13px' }}>~44</div>
            <div style={{ position: 'absolute', top: '79.3%', transform: 'translateY(-50%)', fontSize: '13px' }}>~27</div>
            <div style={{ position: 'absolute', top: '100%', transform: 'translateY(-100%)', fontSize: '13px' }}>0</div>
          </div>
        </div>
        <div className="legend-note">
          <small>AGB = Above Ground Biomass<br/>
          Green starts at ~50 Mg/ha. Max display: 135 Mg/ha</small>
        </div>
      </div>
    </div>
  );
}

export default BiomassModule;
