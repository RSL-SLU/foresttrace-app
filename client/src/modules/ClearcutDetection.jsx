import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  computeClearcutAreaPerYear,
  computeAnnualClearcutAreaPerYear,
  CLEARCUT_PLANET_YEARS,
} from '../utils/clearcutAreaStats';

const CLEARCUT_YEARS = [2010, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

const SENSORS = [
  { id: 'hls', label: 'HLS' },
  { id: 'planet', label: 'Planet' },
];

/**
 * ClearcutDetection Module Component
 * Displays clearcut detection statistics, controls, and a per-year area bar chart.
 */
function ClearcutDetection({ data }) {
  const [yearlyStats, setYearlyStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);

  const region = Array.isArray(data?.selectedFMUs) && data.selectedFMUs.length > 0
    ? data.selectedFMUs[0]
    : 'wabigoon';

  const selectedSensor = data?.selectedSensor ?? 'hls';
  const onSensorChange = data?.onSensorChange;
  const selectedYear = data?.selectedYear;

  useEffect(() => {
    setLoading(true);
    setFetchError(false);
    Promise.all([
      computeClearcutAreaPerYear(region, CLEARCUT_YEARS, null, selectedSensor),
      computeAnnualClearcutAreaPerYear(region, CLEARCUT_YEARS, selectedSensor),
    ])
      .then(([accumulated, annual]) => {
        setYearlyStats(
          CLEARCUT_YEARS.map(y => {
            const totalHa = parseFloat((accumulated[y] ?? 0).toFixed(1));
            const annualHa = parseFloat((annual[y] ?? 0).toFixed(1));
            const historicalHa = parseFloat(Math.max(0, totalHa - annualHa).toFixed(1));
            return { year: y.toString(), historical: historicalHa, annual: annualHa };
          })
        );
      })
      .catch(() => setFetchError(true))
      .finally(() => setLoading(false));
  }, [region, selectedSensor]);

  const chartData = yearlyStats ?? CLEARCUT_YEARS.map(y => ({ year: y.toString(), historical: 0, annual: 0 }));
  const hasData = yearlyStats && yearlyStats.some(d => d.historical > 0 || d.annual > 0);

  return (
    <div className="clearcut-module">
      <div className="module-section">
        <h3>Detection Results</h3>
        {data?.percentage ? (
          <div className="stat-item">
            <div className="stat-label">Clearcut Area (current view)</div>
            <div className="stat-value">{data.percentage}%</div>
            <div className="stat-bar">
              <div
                className="stat-fill"
                style={{ width: `${data.percentage}%` }}
              ></div>
            </div>
          </div>
        ) : (
          <p className="no-data">Navigate the map to see clearcut coverage %.</p>
        )}
      </div>

      <div className="module-section">
        <h3>Annual Clearcut Area — {region}</h3>
        {loading && (
          <div className="biomass-chart-status">Loading…</div>
        )}
        <div className="biomass-chart">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={chartData}
              margin={{ left: 0, right: 12, top: 6, bottom: 4 }}
            >
              <XAxis
                dataKey="year"
                tick={{ fontSize: 10 }}
                interval={0}
                angle={-45}
                textAnchor="end"
                height={40}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}
                label={{
                  value: 'ha',
                  angle: -90,
                  position: 'insideLeft',
                  offset: 10,
                  style: { fontSize: 11 },
                }}
                width={42}
              />
              <Tooltip
                formatter={(v, name) => [
                  `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })} ha`,
                  name === 'annual' ? 'New clearcut' : 'Historical',
                ]}
                labelFormatter={label => `Year ${label}`}
                labelStyle={{ fontSize: 12 }}
                itemStyle={{ fontSize: 12 }}
              />
              <Bar dataKey="historical" stackId="a" fill="#ff4444" name="historical" />
              <Bar dataKey="annual" stackId="a" fill="#FFD700" name="annual" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {fetchError && (
          <div className="biomass-chart-status">Could not load clearcut_stats.json — check console.</div>
        )}
        {!fetchError && !hasData && !loading && (
          <div className="biomass-chart-status">No clearcut tile data found for this region.</div>
        )}
        <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
          Area precomputed from leaf-level tiles ({region}) · {selectedSensor.toUpperCase()}.
        </div>
      </div>

      <div className="module-section">
        <h3>Display Options</h3>

        <div className="control-group">
          <label>Sensor</label>
          <div className="mode-buttons">
            {SENSORS.map(({ id, label }) => {
              const unavailable = id === 'planet' && !CLEARCUT_PLANET_YEARS.includes(selectedYear);
              return (
                <button
                  key={id}
                  className={`mode-btn${selectedSensor === id ? ' active' : ''}`}
                  disabled={unavailable}
                  title={unavailable ? `No ${label} data for ${selectedYear}` : label}
                  onClick={() => onSensorChange && onSensorChange(id)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

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
          <span>Accumulated Clearcut Area</span>
        </div>
        <div className="legend-item">
          <span className="legend-color yellow"></span>
          <span>New Clearcut Area</span>
        </div>
      </div>
    </div>
  );
}

export default ClearcutDetection;
