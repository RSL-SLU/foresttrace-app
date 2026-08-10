import { useState, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { getBurnedAreaPerYear } from '../utils/wildfireStats';
import { getRegionAreaHa } from '../utils/regionArea';

const WILDFIRE_YEARS = [
  2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017,
  2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025,
];

const FIRE_COLOR = '#F8420B';
const FIRE_COLOR_ACTIVE = '#8C1D00';

const fmt = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });

// Rotated tick, same treatment as ClearcutDetection's timeline: all 16 years
// stay labelled in a narrow panel by angling them rather than dropping every
// other one. fill="currentColor" because a custom tick renders a bare <text>
// that the dark-mode rule in layout.css (which targets .recharts-text) never
// matches — a hardcoded colour would stay dark on a dark background.
function XAxisTick({ x, y, payload }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0} y={0} dy={10}
        textAnchor="end"
        transform="rotate(-45)"
        fill="currentColor"
        fontSize={10}
      >
        {payload.value}
      </text>
    </g>
  );
}

function WildfireModule({ data }) {
  const { selectedFMUs, selectedYear } = data;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [regionAreaHa, setRegionAreaHa] = useState(null);

  // FMU boundary area, for expressing the burn as a share of the region.
  useEffect(() => {
    let cancelled = false;
    setRegionAreaHa(null);

    getRegionAreaHa(selectedFMUs)
      .then((area) => {
        if (!cancelled) setRegionAreaHa(area);
      })
      .catch(() => {
        if (!cancelled) setRegionAreaHa(null);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedFMUs]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedFMUs || selectedFMUs.length === 0) {
      setRows([]);
      return undefined;
    }

    setLoading(true);
    getBurnedAreaPerYear(selectedFMUs, WILDFIRE_YEARS)
      .then((result) => {
        if (!cancelled) {
          setRows(result);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRows([]);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedFMUs]);

  const totals = useMemo(() => {
    const areaHa = rows.reduce((sum, r) => sum + r.areaHa, 0);
    const fires = rows.reduce((sum, r) => sum + r.fires, 0);
    const burnedYears = rows.filter((r) => r.fires > 0).length;
    const peak = rows.reduce((best, r) => (r.areaHa > (best?.areaHa ?? -1) ? r : best), null);
    return { areaHa, fires, burnedYears, peak };
  }, [rows]);

  const current = rows.find((r) => r.year === selectedYear);
  const hasData = totals.fires > 0;

  // Burn as a share of the FMU, kept numeric so it can drive the bar width.
  const burnedPct = useMemo(() => {
    if (!current || !regionAreaHa || current.areaHa <= 0) return null;
    return (current.areaHa / regionAreaHa) * 100;
  }, [current, regionAreaHa]);

  // Sub-hectare fires round to "0.0%", which reads as nothing burned when
  // something did. Show "<0.1" instead.
  const burnedPctLabel = burnedPct === null
    ? null
    : (burnedPct < 0.1 ? '<0.1' : burnedPct.toFixed(1));

  return (
    <div className="clearcut-module">
      <div className="module-section">
        <p className="stat-sub">
          Burned area from the National Burned Area Composite (NBAC).
        </p>
      </div>

      <div className="module-section">
        <h3>Fire Results ({selectedYear})</h3>
        {current && current.fires > 0 ? (
          <div className="stat-item">
            <div className="stat-label">Burned Area</div>
            <div className="stat-value">
              {burnedPct !== null ? `${burnedPctLabel}%` : `${fmt(current.areaHa)} ha`}
            </div>
            {burnedPct !== null && (
              <div className="stat-bar">
                <div
                  className="stat-fill stat-fill--fire"
                  style={{ width: `${Math.min(100, Math.max(burnedPct, 0.5))}%` }}
                />
              </div>
            )}
            <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
              {burnedPct !== null
                ? `${fmt(current.areaHa)} ha of total FMU area (${(regionAreaHa / 1000).toFixed(0)}k ha)`
                : 'Loading region boundary…'}
              {' · '}
              {current.fires} fire{current.fires === 1 ? '' : 's'}
            </div>
          </div>
        ) : (
          <p className="no-data">No fire recorded in {selectedYear}</p>
        )}
      </div>

      <div className="module-section">
        <h3>Burned Area by Year (ha)</h3>
        {loading && <div className="biomass-chart-status">Loading…</div>}
        {!loading && !hasData && (
          <p className="stat-sub">
            {selectedFMUs?.length
              ? 'No fire recorded for the selected area.'
              : 'Select a forest management unit.'}
          </p>
        )}
        {!loading && hasData && (
          <div className="biomass-chart">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={rows} margin={{ left: 0, right: 12, top: 6, bottom: 4 }}>
                <XAxis dataKey="year" tick={<XAxisTick />} interval={0} height={40} />
                {/* No rotated axis label: burned areas reach six figures, so
                    "109.3k" fills the axis band and collides with it. The unit
                    lives in the section heading instead, which also frees ~14px
                    of plot width in a narrow panel. */}
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0))}
                  width={40}
                />
                <Tooltip
                  formatter={(value, name, props) => {
                    const { fires } = props.payload;
                    return [
                      `${fmt(value)} ha — ${fires} fire${fires === 1 ? '' : 's'}`,
                      'Burned',
                    ];
                  }}
                  labelFormatter={(label) => `Year ${label}`}
                  labelStyle={{ fontSize: 12 }}
                  itemStyle={{ fontSize: 12 }}
                />
                <Bar dataKey="areaHa" name="Burned" radius={[2, 2, 0, 0]}>
                  {rows.map((row) => (
                    <Cell
                      key={row.year}
                      fill={row.year === selectedYear ? FIRE_COLOR_ACTIVE : FIRE_COLOR}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {!loading && hasData && (
          <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
            Area from NBAC source polygons · not derived from tile pixels
          </div>
        )}
      </div>

      {hasData && (
        <div className="module-section">
          <h3>Legend</h3>
          <div className="legend-item">
            <span className="legend-color fire" />
            <span>Burned Area</span>
          </div>
          <div className="legend-item">
            <span className="legend-color fire-active" />
            <span>Selected year</span>
          </div>
          <div className="legend-item">
            <span aria-hidden="true">🔥</span>
            <span>Years with recorded fire (marked on the year slider)</span>
          </div>
        </div>
      )}

      {hasData && (
        <div className="module-section">
          <h3>2010–2025 Summary</h3>
          <div className="legend-item">
            <span>Total burned</span>
            <strong>{fmt(totals.areaHa)} ha</strong>
          </div>
          <div className="legend-item">
            <span>Total fires</span>
            <strong>{totals.fires}</strong>
          </div>
          <div className="legend-item">
            <span>Years with fire</span>
            <strong>{totals.burnedYears} of {WILDFIRE_YEARS.length}</strong>
          </div>
          {totals.peak && totals.peak.areaHa > 0 && (
            <div className="legend-item">
              <span>Worst year</span>
              <strong>{totals.peak.year} — {fmt(totals.peak.areaHa)} ha</strong>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default WildfireModule;
