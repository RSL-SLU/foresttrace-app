import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const EMPTY_HISTOGRAM = [
  { label: '0-10', area: 0, pixels: 0 },
  { label: '10-25', area: 0, pixels: 0 },
  { label: '25-40', area: 0, pixels: 0 },
  { label: '40-50', area: 0, pixels: 0 },
  { label: '50-70', area: 0, pixels: 0 },
  { label: '70-100', area: 0, pixels: 0 },
  { label: '100+', area: 0, pixels: 0 },
];

/**
 * Biomass Module Component
 * Displays biomass density visualization controls and legend
 */
function BiomassModule({ data }) {
  const histogram = Array.isArray(data?.biomassHistogram) ? data.biomassHistogram : EMPTY_HISTOGRAM;
  const hasHistogramData = histogram.some((bin) => (bin.pixels || 0) > 0 || (bin.area || 0) > 0);
  const totalArea = histogram.reduce((sum, bin) => sum + (bin.area || 0), 0);

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

      <div className="module-section">
        <h3>Biomass Area Distribution</h3>
        <div className="biomass-chart">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={histogram} layout="vertical" margin={{ left: 5, right: 12, top: 6, bottom: 8 }}>
              <XAxis
                type="number"
                tick={{ fontSize: 12 }}
                tickCount={4}
                minTickGap={24}
                interval="preserveStartEnd"
                tickFormatter={(v) => v.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                label={{ value: 'Area (ha)', position: 'insideBottomRight', offset: -4, style: { fontSize: 12 } }}
              />
              <YAxis type="category" dataKey="label" width={44} tick={{ fontSize: 12 }} />
              <Tooltip
                formatter={(v) => `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })} ha`}
                labelStyle={{ fontSize: 12 }}
                itemStyle={{ fontSize: 12 }}
              />
              <Bar dataKey="area" fill="#4caf50" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {!hasHistogramData && (
          <div className="biomass-chart-status">Loading biomass stats or no biomass tiles in current view.</div>
        )}
        <div style={{ fontSize: 11, color: '#666', marginTop: 6 }}>
          <span>Area per biomass interval (hectares). Total shown: {totalArea.toLocaleString(undefined, { maximumFractionDigits: 2 })} ha.</span>
        </div>
      </div>
    </div>
  );
}

export default BiomassModule;
