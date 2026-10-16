import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { scanfiSnapshot } from '../utils/borealLayers';

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
 * Biomass stats and SCANFI snapshot info; the colour key is in the map legend (MapLegend)
 */
function BiomassModule({ data }) {
  const histogram = Array.isArray(data?.biomassHistogram) ? data.biomassHistogram : EMPTY_HISTOGRAM;
  const hasHistogramData = histogram.some((bin) => (bin.pixels || 0) > 0 || (bin.area || 0) > 0);
  const totalArea = histogram.reduce((sum, bin) => sum + (bin.area || 0), 0);

  return (
    <div className="biomass-module">
      {data?.scanfiOn && (
        <div className="module-section">
          <h3>Biomass (SCANFI) · {scanfiSnapshot(data?.selectedYear ?? 2025)} snapshot</h3>
          <p className="stat-sub">
            Above-ground biomass from NRCan’s SCANFI (ground-plot calibrated), snapshots for 2015, 2020
            and 2025. The map shows the latest snapshot not after the selected year.
          </p>
        </div>
      )}
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
        <div className="biomass-interval-legend" role="note" aria-label="Biomass interval legend">
          <div className="biomass-interval-legend-title">Interval Legend (Mg/ha)</div>
          <div className="biomass-interval-legend-grid">
            <span>0-10</span>
            <span>Very low biomass</span>
            <span>10-25</span>
            <span>Low biomass</span>
            <span>25-40</span>
            <span>Moderate-low biomass</span>
            <span>40-50</span>
            <span>Moderate biomass</span>
            <span>50-70</span>
            <span>Moderate-high biomass</span>
            <span>70-100</span>
            <span>High biomass</span>
            <span>100+</span>
            <span>Very high biomass</span>
          </div>
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
