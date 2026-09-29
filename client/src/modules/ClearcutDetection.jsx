import { useState, useEffect, useMemo } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ErrorBar,
  ReferenceArea, Cell,
} from 'recharts';
import {
  computeClearcutAreaPerYear,
  computeAnnualClearcutAreaPerYear,
  computeEnteringClearcutAreaPerYear,
  computeCarriedClearcutAreaPerYear,
  getAnnualYearsWithData,
  getClearcutAccuracy,
  getClearcutWindowMeta,
  DEFAULT_CLEARCUT_SENSOR,
} from '../utils/clearcutAreaStats';
import { DATA_BASE_URL } from '../config';
import { getCogCoverage } from '../utils/clearcutCogCoverage';

const CLEARCUT_YEARS = [2010, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

// Years that used Landsat 8 OLI only — not spectrally harmonized with HLS.
// Values are not directly comparable to HLS years (2016+).
const LANDSAT_ONLY_YEARS = new Set([2010, 2015]);

// Fallback uncertainty used for years without validation notebooks (±15% HLS benchmark).
const FALLBACK_UNCERTAINTY = 0.15;

function XAxisTick({ x, y, payload }) {
  const isLandsatOnly = LANDSAT_ONLY_YEARS.has(Number(payload.value));
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0} y={0} dy={10}
        textAnchor="end"
        transform="rotate(-45)"
        fill={isLandsatOnly ? '#f59e0b' : 'currentColor'}
        fontSize={10}
      >
        {payload.value}{isLandsatOnly ? '*' : ''}
      </text>
    </g>
  );
}

// Spherical shoelace formula — returns area in hectares for a GeoJSON
// FeatureCollection or Feature (Polygon or MultiPolygon).
function computeGeoJsonAreaHa(geoJson) {
  if (!geoJson) return null;
  const R = 6371000; // Earth radius in metres
  const features = geoJson.type === 'FeatureCollection' ? geoJson.features : [geoJson];
  let totalM2 = 0;
  for (const feature of features) {
    const geom = feature?.geometry;
    if (!geom) continue;
    const rings = geom.type === 'Polygon'
      ? [geom.coordinates[0]]
      : geom.type === 'MultiPolygon'
        ? geom.coordinates.map(p => p[0])
        : [];
    for (const ring of rings) {
      if (ring.length < 3) continue;
      let area = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        const dLng = (ring[i + 1][0] - ring[i][0]) * Math.PI / 180;
        const phi1 = ring[i][1]     * Math.PI / 180;
        const phi2 = ring[i + 1][1] * Math.PI / 180;
        area += dLng * (Math.sin(phi1) + Math.sin(phi2));
      }
      totalM2 += Math.abs(area * R * R / 2);
    }
  }
  return totalM2 / 10000;
}

function linearRegression(points) {
  const n = points.length;
  if (n < 2) return null;
  const sumX  = points.reduce((s, p) => s + p.x, 0);
  const sumY  = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null;
  const slope     = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const meanY  = sumY / n;
  const ssTot  = points.reduce((s, p) => s + (p.y - meanY) ** 2, 0);
  const ssRes  = points.reduce((s, p) => s + (p.y - (intercept + slope * p.x)) ** 2, 0);
  const rSquared = ssTot < 1 ? 1 : Math.max(0, 1 - ssRes / ssTot);
  return { slope, intercept, rSquared };
}

function ClearcutDetection({ data }) {
  const [yearlyStats, setYearlyStats] = useState(null);
  const [annualDataYears, setAnnualDataYears] = useState(new Set());
  const [accuracy, setAccuracy] = useState({});
  const [windowMeta, setWindowMeta] = useState({});
  const [regionAreaHa, setRegionAreaHa] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);

  // Stable string key for the selected FMU list — used as effect dependency.
  const regionsKey = (Array.isArray(data?.selectedFMUs) && data.selectedFMUs.length > 0
    ? data.selectedFMUs
    : ['wabigoon']
  ).join(',');

  const regions = useMemo(() => regionsKey.split(','), [regionsKey]);

  const selectedSensor = data?.selectedSensor ?? DEFAULT_CLEARCUT_SENSOR;
  const selectedYear   = data?.selectedYear;
  // When the map renders COGs, the chart counts only what the map can draw.
  const useCogClearcut = data?.useCogClearcut ?? false;
  const clearcutSources = data?.clearcutSources ?? ['ari'];
  const onToggleClearcutSource = data?.onToggleClearcutSource;

  const sourcesSummary = clearcutSources.length === 0
    ? 'None'
    : clearcutSources.length === 2
      ? 'All (2)'
      : clearcutSources.includes('ari')
        ? 'Official Inventory'
        : 'AI Model';

  // Sum GeoJSON areas for all selected regions.
  useEffect(() => {
    setRegionAreaHa(null);
    Promise.all(
      regions.map(r =>
        fetch(`${DATA_BASE_URL}/data/regions/${r}.json`)
          .then(res => res.ok ? res.json() : null)
          .then(geoJson => geoJson ? computeGeoJsonAreaHa(geoJson) : 0)
          .catch(() => 0)
      )
    ).then(areas => {
      const total = areas.reduce((sum, a) => sum + (a ?? 0), 0);
      if (total > 0) setRegionAreaHa(total);
    });
  }, [regionsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sum clearcut stats across all selected regions.
  useEffect(() => {
    setLoading(true);
    setFetchError(false);
    Promise.all(
      regions.map(r =>
        Promise.all([
          computeClearcutAreaPerYear(r, CLEARCUT_YEARS, null, selectedSensor),
          computeAnnualClearcutAreaPerYear(r, CLEARCUT_YEARS, selectedSensor),
          getAnnualYearsWithData(r, selectedSensor),
          getClearcutAccuracy(r, selectedSensor),
          getClearcutWindowMeta(r, selectedSensor),
          computeEnteringClearcutAreaPerYear(r, CLEARCUT_YEARS, selectedSensor),
          computeCarriedClearcutAreaPerYear(r, CLEARCUT_YEARS, selectedSensor),
        ])
      )
    )
      .then(async results => {
        let covered = null;
        if (useCogClearcut) {
          const withStats = results
            .map(([acc], i) => ({
              region: regions[i],
              years: CLEARCUT_YEARS.filter(y => (acc[y] ?? 0) > 0),
            }))
            .filter(({ years }) => years.length > 0);
          covered = await getCogCoverage(withStats);
        }
        const counts = (i, y) => !covered || covered.has(`${regions[i]}_${y}`);

        const accumulated = {};
        const annual = {};
        const entering = {};
        const carried = {};
        const contributes = (i) => CLEARCUT_YEARS.some(y => counts(i, y) && (results[i][0][y] ?? 0) > 0);
        const haveEntering = results.every((r, i) => !contributes(i) || r[5]);
        CLEARCUT_YEARS.forEach(y => {
          const take = (fn) => results.reduce((sum, r, i) => sum + (counts(i, y) ? (fn(r) ?? 0) : 0), 0);
          accumulated[y] = take(([acc]) => acc[y]);
          annual[y]      = take(([, ann]) => ann[y]);
          if (haveEntering) {
            entering[y] = take(([,,,,, ent]) => ent[y]);
            carried[y]  = take(([,,,,,, car]) => car?.[y]);
          }
        });

        const mergedWindow = {};
        CLEARCUT_YEARS.forEach(y => {
          const contributing = results.filter(([acc], i) => counts(i, y) && (acc[y] ?? 0) > 0);
          if (contributing.length === 0) return;

          const metas = contributing.map(([,,,, w]) => w?.[y]).filter(Boolean);
          if (metas.length === 0) return;

          const undocumented = contributing.length - metas.length;
          mergedWindow[y] = {
            comparable: undocumented === 0 && metas.every(m => m.comparable),
            undocumentedRegions: undocumented,
            contributingRegions: contributing.length,
            isBaseline: metas.some(m => m.isBaseline),
            observationYears: Math.min(...metas.map(m => m.observationYears)),
            expectedYears: Math.max(...metas.map(m => m.expectedYears)),
            rule: metas.every(m => m.rule === metas[0].rule) ? metas[0].rule : null,
            minDetections: Math.min(...metas.map(m => m.minDetections ?? Infinity)),
            requiredDetections: Math.max(...metas.map(m => m.requiredDetections ?? 0)),
            adjacentPairs: Math.min(...metas.map(m => m.adjacentPairs ?? Infinity)),
            expectedPairs: Math.max(...metas.map(m => m.expectedPairs ?? 0)),
          };
        });
        setWindowMeta(mergedWindow);

        const trendYearSets = results
          .map(([,, years], i) => ({ years, i }))
          .filter(({ years, i }) => [...years].some(y => counts(i, y)))
          .map(({ years, i }) => new Set([...years].filter(y => counts(i, y))));
        const dataYears = trendYearSets.length
          ? trendYearSets.reduce((inter, years) => new Set([...inter].filter(y => years.has(y))))
          : new Set();
        setAnnualDataYears(dataYears);

        const mergedAccuracy = {};
        CLEARCUT_YEARS.forEach(y => {
          const yearAccs = results.map(([,,, acc]) => acc[String(y)]).filter(Boolean);
          if (yearAccs.length > 0) {
            mergedAccuracy[String(y)] = {
              precision: yearAccs.reduce((s, a) => s + a.precision, 0) / yearAccs.length,
              recall:    yearAccs.reduce((s, a) => s + a.recall, 0) / yearAccs.length,
              f1:        yearAccs.reduce((s, a) => s + a.f1, 0) / yearAccs.length,
              iou:       yearAccs.reduce((s, a) => s + a.iou, 0) / yearAccs.length,
            };
          }
        });
        setAccuracy(mergedAccuracy);

        setYearlyStats(
          CLEARCUT_YEARS.map(y => {
            const totalHa  = parseFloat((accumulated[y] ?? 0).toFixed(1));
            const newHa    = parseFloat(((haveEntering ? entering[y] : annual[y]) ?? 0).toFixed(1));
            const priorHa  = haveEntering
              ? parseFloat((carried[y] ?? 0).toFixed(1))
              : parseFloat(Math.max(0, totalHa - newHa).toFixed(1));
            return { year: y.toString(), historical: priorHa, annual: newHa };
          })
        );
      })
      .catch(() => setFetchError(true))
      .finally(() => setLoading(false));
  }, [regionsKey, selectedSensor, useCogClearcut]); // eslint-disable-line react-hooks/exhaustive-deps

  const fillingSpan = useMemo(() => {
    const years = CLEARCUT_YEARS.filter(y => windowMeta[y]);
    if (years.length === 0) return null;
    const partial = years.filter(y => !windowMeta[y].comparable);
    if (partial.length === 0) return null;
    return { from: String(Math.min(...partial)), to: String(Math.max(...partial)) };
  }, [windowMeta]);

  const trend = useMemo(() => {
    if (!yearlyStats || annualDataYears.size < 2) return null;
    const pts = yearlyStats
      .map(d => ({ x: parseInt(d.year), y: d.historical + d.annual }))
      .filter(p => annualDataYears.has(p.x));
    if (pts.length < 2) return null;
    return linearRegression(pts);
  }, [yearlyStats, annualDataYears]);

  const chartData = useMemo(() => {
    const base = yearlyStats ?? CLEARCUT_YEARS.map(y => ({
      year: y.toString(), historical: 0, annual: 0,
    }));
    return base.map(d => {
      const yr  = parseInt(d.year);
      const acc = accuracy[String(yr)];
      const lowerErr = acc
        ? parseFloat((d.annual * (1 - acc.precision)).toFixed(1))
        : parseFloat((d.annual * FALLBACK_UNCERTAINTY).toFixed(1));
      const upperErr = acc
        ? parseFloat((d.annual * (1 / acc.recall - 1)).toFixed(1))
        : parseFloat((d.annual * FALLBACK_UNCERTAINTY).toFixed(1));
      return {
        ...d,
        annualError: [lowerErr, upperErr],
        accF1: acc?.f1 ?? null,
        trendLine: trend && annualDataYears.has(yr)
          ? parseFloat(Math.max(0, trend.intercept + trend.slope * yr).toFixed(1))
          : undefined,
      };
    });
  }, [yearlyStats, accuracy, trend, annualDataYears]);

  const hasData = yearlyStats && yearlyStats.some(d => d.historical > 0 || d.annual > 0);

  const clearcutPercent = useMemo(() => {
    if (!yearlyStats || !regionAreaHa || !selectedYear) return null;
    const row = yearlyStats.find(d => d.year === String(selectedYear));
    if (!row) return null;
    const totalHa = row.historical + row.annual;
    if (totalHa <= 0) return null;
    return ((totalHa / regionAreaHa) * 100).toFixed(1);
  }, [yearlyStats, regionAreaHa, selectedYear]);

  const trendColor = trend?.slope >= 0 ? '#e53e3e' : '#38a169';

  return (
    <div className="clearcut-module">
      <div className="module-section">
        <details className="range-dropdown" open>
          <summary>
            <span>Clearcut Sources</span>
            <span className="range-summary-count">
              {sourcesSummary}
            </span>
          </summary>

          <div className="range-panel">
            <label className="switch range-switch" htmlFor="clearcut-source-ari">
              <i
                className="range-swatch"
                style={{ '--swatch': '#64748b', '--swatch-dark': '#94a3b8' }}
                aria-hidden="true"
              />
              <span className="range-name">Official Inventory (ARI Ground Truth)</span>
              <input
                id="clearcut-source-ari"
                type="checkbox"
                role="switch"
                checked={clearcutSources.includes('ari')}
                onChange={(e) => onToggleClearcutSource?.('ari', e.target.checked)}
              />
              <span className="switch-track" aria-hidden="true" />
            </label>

            <label className="switch range-switch" htmlFor="clearcut-source-ml">
              <i
                className="range-swatch range-swatch--hollow"
                style={{ '--swatch': '#64748b', '--swatch-dark': '#94a3b8' }}
                aria-hidden="true"
              />
              <span className="range-name">AI Model Estimates (HLS Deep Learning)</span>
              <input
                id="clearcut-source-ml"
                type="checkbox"
                role="switch"
                checked={clearcutSources.includes('ml')}
                onChange={(e) => onToggleClearcutSource?.('ml', e.target.checked)}
              />
              <span className="switch-track" aria-hidden="true" />
            </label>

            <p className="stat-sub range-mode-note">
              {clearcutSources.length === 2
                ? 'Showing Official Inventory (filled) and AI Model Estimates (outlines) for visual comparison.'
                : clearcutSources.includes('ari')
                  ? 'Showing Official Inventory (ARI ground truth harvest data).'
                  : clearcutSources.includes('ml')
                    ? 'Showing AI Model Estimates (deep learning satellite detections as outlines).'
                    : 'No clearcut source selected — select at least one source to display clearcuts on the map.'}
            </p>
          </div>
        </details>
      </div>

      <div className="module-section">
        <h3>Detection Results ({selectedYear})</h3>
        {clearcutPercent !== null ? (
          <div className="stat-item">
            <div className="stat-label">Clearcut Area</div>
            <div className="stat-value">{clearcutPercent}%</div>
            <div className="stat-bar">
              <div className="stat-fill" style={{ width: `${Math.min(100, clearcutPercent)}%` }} />
            </div>
            <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
              of total FMU area
              {regionAreaHa && ` (${(regionAreaHa / 1000).toFixed(0)}k ha)`}
            </div>
          </div>
        ) : (
          <p className="no-data">
            {regionAreaHa === null ? 'Loading region boundary…' : 'No clearcut data for this region/year.'}
          </p>
        )}
      </div>

      <div className="module-section">
        <h3>Annual vs Accumulated Clearcut Area — Timeline</h3>
        {loading && <div className="biomass-chart-status">Loading…</div>}
        <div className="biomass-chart">
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={chartData} margin={{ left: 0, right: 12, top: 6, bottom: 4 }}>
              <XAxis
                dataKey="year"
                tick={<XAxisTick />}
                interval={0}
                height={40}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}
                label={{ value: 'ha', angle: -90, position: 'insideLeft', offset: 10, style: { fontSize: 11 } }}
                width={42}
              />
              <Tooltip
                formatter={(v, name, props) => {
                  const fmt = n => Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 });
                  if (name === 'trendLine') return [`${fmt(v)} ha`, 'Forest loss trend'];
                  if (name === 'annual') {
                    const acc = accuracy[props.payload?.year];
                    const note = acc
                      ? `F1=${acc.f1.toFixed(2)}, P=${acc.precision.toFixed(2)}, R=${acc.recall.toFixed(2)}`
                      : `±${(FALLBACK_UNCERTAINTY * 100).toFixed(0)}% (estimated)`;
                    return [`${fmt(v)} ha  [${note}]`, 'New clearcut'];
                  }
                  return [`${fmt(v)} ha`, 'Historical'];
                }}
                labelFormatter={label => {
                  const m = windowMeta[label];
                  if (!m) return `Year ${label}`;
                  if (m.isBaseline) return `Year ${label} — baseline`;
                  if (!m.comparable) {
                    if (m.undocumentedRegions > 0) {
                      return `Year ${label} — ${m.undocumentedRegions}/${m.contributingRegions} regions undocumented`;
                    }
                    const span = `${m.observationYears}/${m.expectedYears}yr window`;
                    const short = m.rule === 'consecutive'
                      ? m.adjacentPairs < m.expectedPairs
                        && `${m.adjacentPairs}/${m.expectedPairs} consecutive pairs`
                      : m.minDetections < m.requiredDetections
                        && `≥${m.minDetections} detections`;
                    return `Year ${label} — ${short ? `${span}, ${short}` : span}`;
                  }
                  return `Year ${label}`;
                }}
                labelStyle={{ fontSize: 12 }}
                itemStyle={{ fontSize: 12 }}
              />
              {fillingSpan && (
                <ReferenceArea
                  x1={fillingSpan.from}
                  x2={fillingSpan.to}
                  fill="#94a3b8"
                  fillOpacity={0.16}
                  label={{ value: 'window filling', position: 'insideTop', fontSize: 10, fill: '#64748b' }}
                />
              )}
              {/* Amber for historical/accumulated clearcuts (#d97706) for high contrast on light basemap */}
              <Bar dataKey="historical" stackId="a" fill="#d97706" name="historical">
                {chartData.map(d => (
                  <Cell key={d.year} fillOpacity={windowMeta[d.year]?.comparable === false ? 0.45 : 1} />
                ))}
              </Bar>
              <Bar dataKey="annual" stackId="a" fill="#dc2626" name="annual" radius={[2, 2, 0, 0]}>
                {chartData.map(d => (
                  <Cell key={d.year} fillOpacity={windowMeta[d.year]?.comparable === false ? 0.45 : 1} />
                ))}
                <ErrorBar dataKey="annualError" width={3} strokeWidth={1.5} stroke="#92400e" direction="y" />
              </Bar>
              {trend && (
                <Line
                  dataKey="trendLine"
                  type="linear"
                  stroke={trendColor}
                  strokeWidth={2}
                  strokeDasharray="6 3"
                  dot={false}
                  name="trendLine"
                  connectNulls
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {trend && (
          <div style={{ fontSize: 11, marginTop: 4 }}>
            <span style={{ color: trendColor }}>
              {trend.slope >= 0 ? '▲ Forest loss increasing' : '▼ Forest loss decreasing'}{' '}
              · {Math.abs(trend.slope).toFixed(0)} ha/yr &nbsp;(R²={trend.rSquared.toFixed(2)})
            </span>
          </div>
        )}

        {fetchError && (
          <div className="biomass-chart-status">Could not load clearcut_stats.json — check console.</div>
        )}
        {!fetchError && !hasData && !loading && (
          <div className="biomass-chart-status">No clearcut tile data found for this region.</div>
        )}
        <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
          Area from leaf-level tiles · {selectedSensor.toUpperCase()}
          · Error bars: precision/recall from validation notebooks (fallback ±{(FALLBACK_UNCERTAINTY * 100).toFixed(0)}%)
        </div>
      </div>

      <div className="module-section">
        <h3>Legend &amp; Color Guide</h3>
        {clearcutSources.includes('ari') && (
          <>
            <p className="stat-sub" style={{ marginBottom: 6 }}>
              <strong>Official Inventory (ARI Ground Truth):</strong>
            </p>
            <div className="legend-item">
              <span className="legend-color amber" />
              <span>ARI Accumulated Clearcuts (5-year window)</span>
            </div>
            <div className="legend-item">
              <span className="legend-color red" />
              <span>ARI Annual Clearcuts (harvested this year)</span>
            </div>
          </>
        )}
        {clearcutSources.includes('ml') && (
          <>
            <p className="stat-sub" style={{ marginTop: clearcutSources.includes('ari') ? 8 : 0, marginBottom: 6 }}>
              <strong>AI Model Estimates (HLS Deep Learning):</strong>
            </p>
            <div className="legend-item">
              <span className="legend-color outline-amber" />
              <span>AI Model: Accumulated Cuts (outline)</span>
            </div>
            <div className="legend-item">
              <span className="legend-color outline-red" />
              <span>AI Model: Annual Cuts (newly detected this year, outline)</span>
            </div>
          </>
        )}
        {clearcutSources.length === 0 && (
          <p className="stat-sub" style={{ fontStyle: 'italic', color: '#888' }}>
            No clearcut source selected.
          </p>
        )}
        <div className="legend-item" style={{ marginTop: 8 }}>
          <span
            style={{
              display: 'inline-block',
              width: 16,
              height: 0,
              borderTop: '2px dashed #888',
              marginRight: 6,
              verticalAlign: 'middle',
            }}
          />
          <span>Annual clearcut trend (red = increasing · green = decreasing)</span>
        </div>
      </div>
    </div>
  );
}

export default ClearcutDetection;

