import { useState, useEffect, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { computeClearcutAreaPerYear, CLEARCUT_PLANET_YEARS } from '../utils/clearcutAreaStats';

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
  const [loadingYear, setLoadingYear] = useState(null);
  const abortRef = useRef(false);

  const region = Array.isArray(data?.selectedFMUs) && data.selectedFMUs.length > 0
    ? data.selectedFMUs[0]
    : 'wabigoon';

  const selectedSensor = data?.selectedSensor ?? 'hls';
  const onSensorChange = data?.onSensorChange;
  const selectedYear = data?.selectedYear;

  useEffect(() => {
    abortRef.current = false;
    setYearlyStats(null);
    setLoadingYear(CLEARCUT_YEARS[0]);

    const partial = {};

    computeClearcutAreaPerYear(region, CLEARCUT_YEARS, (year, areaHa) => {
      if (abortRef.current) return;
      partial[year] = areaHa;
      setLoadingYear(year < CLEARCUT_YEARS[CLEARCUT_YEARS.length - 1] ? year + 1 : null);
      setYearlyStats(
        CLEARCUT_YEARS.map(y => ({
          year: y.toString(),
          area: parseFloat((partial[y] ?? 0).toFixed(1)),
        }))
      );
    }, selectedSensor).catch(() => {});

    return () => { abortRef.current = true; };
  }, [region, selectedSensor]);

  const chartData = yearlyStats ?? CLEARCUT_YEARS.map(y => ({ year: y.toString(), area: 0 }));
  const hasData = yearlyStats && yearlyStats.some(d => d.area > 0);

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
        {loadingYear && (
          <div className="biomass-chart-status">
            Computing {loadingYear}…
          </div>
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
                formatter={v => [`${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })} ha`, 'Clearcut']}
                labelFormatter={label => `Year ${label}`}
                labelStyle={{ fontSize: 12 }}
                itemStyle={{ fontSize: 12 }}
              />
              <Bar dataKey="area" fill="#ff4444" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {!hasData && !loadingYear && (
          <div className="biomass-chart-status">No clearcut tile data found for this region.</div>
        )}
        <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
          Area computed from zoom-12 tiles ({region}) · {selectedSensor.toUpperCase()}.
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
