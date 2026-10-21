/**
 * Reporting lag: stands the AI model saw cleared before the official
 * harvest inventory (ARI) recorded them.
 *
 * Per pixel, from the app's own COGs:
 *   detected  the first year the AI model flagged it -- the earliest of the
 *             yearly clearcut-status-v2 files that has it (each yearly file
 *             holds only that year's new detections)
 *   recorded  the AR_YEAR of its harvest record (ari-ground-truth-v1)
 *   lag       recorded - detected
 *
 * The usual lag is -1: a harvest is booked in its Annual Report year and the
 * summer imagery shows the opening the following season. A lag of +1 or more
 * means the opening was visible from space a year or more before any record
 * of it -- a possible late report (or another disturbance later harvested,
 * or a model error the inventory happens to match), so it is flagged for a
 * closer look, not concluded.
 *
 * The series' first year is a baseline: with no earlier year to compare, the
 * model flags every opening visible then (old cuts, roads, natural openings),
 * and one harvested years later would read as a long "late report". Pixels
 * first flagged in the baseline year are left out of the comparison.
 *
 * Read at the same ~100 m overview the finders use (cogFinder.js): areas are
 * approximate. Records end in the inventory's last year, so the most recent
 * detections cannot show a lag yet (right-censored).
 */

import { COG_BASE_URL } from '../config';
import { loadManifest, readLevel, components, outline } from './cogFinder';

const R = 6378137;
const U16_NODATA = 65535;
const MAX_BLOCKS = 25;

/** Lag classes, for the map and legend: +1 possible, +2 and more likely. */
// 1-3 years fits a late report; 4+ more likely an earlier, different
// disturbance that was later harvested (or a model error)
export const LAG_CLASSES = [
  { min: 1, max: 1, label: '1 year earlier', color: '#f0abfc' },
  { min: 2, max: 2, label: '2 years earlier', color: '#d946ef' },
  { min: 3, max: 3, label: '3 years earlier', color: '#a21caf' },
  { min: 4, max: Infinity, label: '4+ years earlier (likely another disturbance)', color: '#701a75' },
];
export const lagClass = (lag) => LAG_CLASSES.findIndex((c) => lag >= c.min && lag <= c.max);

/** FMUs that have both the AI status and the inventory rasters. */
export async function reportingLagRegions() {
  const m = await loadManifest();
  if (!m) return [];
  const ari = m.static?.['ari-ground-truth-v1'] || [];
  const status = m.prefixes?.['clearcut-status-v2'] || {};
  return ari.filter((r) => (status[r] || []).length);
}

const _cache = new Map();

/**
 * @returns {Promise<{ region, detectionYears, lastRecordYear, hist, recordedHa,
 *   laggedHa, lagged2Ha, undetectedHa, unrecordedHa, blocks }>}
 */
export function computeReportingLag(region) {
  if (!_cache.has(region)) {
    _cache.set(region, run(region).catch((err) => {
      _cache.delete(region);
      throw err;
    }));
  }
  return _cache.get(region);
}

async function run(region) {
  const manifest = await loadManifest();
  const years = (manifest?.prefixes?.['clearcut-status-v2']?.[region] || []).slice().sort((a, b) => a - b);
  if (!years.length) throw new Error(`no AI status rasters for ${region}`);
  const ari = await readLevel(`${COG_BASE_URL}/cogs/ari-ground-truth-v1/${region}.tif`, [0]);
  const W = ari.width;
  const H = ari.height;
  const n = W * H;

  // First AI detection year per pixel (0 = never; BASELINE = flagged in the
  // baseline year, left out)
  const BASELINE = 1;
  const first = new Uint16Array(n);
  for (const y of years) {
    const st = await readLevel(`${COG_BASE_URL}/cogs/clearcut-status-v2/${region}_${y}.tif`, [0, 2]);
    if (st.width !== W || st.height !== H) continue;   // grids must line up pixel for pixel
    const [S, D] = st.data;
    for (let i = 0; i < n; i++) {
      if (first[i]) continue;
      const s = S[i];
      if (s === 1 || s === 2 || s === 4) first[i] = y === years[0] ? BASELINE : (D[i] && D[i] !== U16_NODATA ? D[i] : y);
    }
  }
  const A = ari.data[0];
  let lastRecordYear = 0;
  for (let i = 0; i < n; i++) if (A[i] > lastRecordYear && A[i] !== U16_NODATA) lastRecordYear = A[i];
  const firstDetection = years[1] || years[0];   // first year after the baseline

  // Pixel area shrinks with latitude in Web Mercator
  const rowHa = new Float64Array(H);
  for (let r = 0; r < H; r++) {
    const y = ari.maxY - (r + 0.5) * ari.py;
    const lat = 2 * Math.atan(Math.exp(y / R)) - Math.PI / 2;
    rowHa[r] = (ari.px * ari.py * Math.cos(lat) ** 2) / 10000;
  }

  const hist = new Map();
  let recordedHa = 0;      // harvest recorded in the comparable window
  let laggedHa = 0;        // ...that the model saw 1+ years earlier
  let lagged2Ha = 0;       // ...2+ years earlier
  let undetectedHa = 0;    // recorded, never detected
  let unrecordedHa = 0;    // detected, no record (detections the inventory could already hold)
  const lagAt = new Int16Array(n).fill(-32768);
  for (let i = 0; i < n; i++) {
    const ha = rowHa[(i / W) | 0];
    const a = A[i] !== U16_NODATA ? A[i] : 0;
    if (first[i] === BASELINE) continue;
    const d = first[i];
    const inWindow = a >= firstDetection && a <= lastRecordYear;
    if (a && inWindow) {
      recordedHa += ha;
      if (!d) undetectedHa += ha;
    }
    if (d && !a && d < lastRecordYear) unrecordedHa += ha;
    if (a && d && inWindow) {
      const lag = a - d;
      lagAt[i] = lag;
      const key = Math.max(-5, Math.min(5, lag));
      hist.set(key, (hist.get(key) || 0) + ha);
      if (lag >= 1) laggedHa += ha;
      if (lag >= 2) lagged2Ha += ha;
    }
  }

  // The largest lagged blocks, as outlines with their years
  const level = { ...ari };
  const { comps, labels } = components(level, (i) => lagAt[i] >= 1, true);
  const top = comps.filter((c) => c.pixels >= 3).sort((a, b) => b.ha - a.ha).slice(0, MAX_BLOCKS);
  const keep = new Map(top.map((c) => [c.id, { lags: new Map(), det: new Map(), rec: new Map() }]));
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  const mode = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
  for (let i = 0; i < n; i++) {
    const k = keep.get(labels[i]);
    if (!k) continue;
    bump(k.lags, lagAt[i]);
    bump(k.det, first[i]);
    bump(k.rec, A[i]);
  }
  const blocks = top.map((c) => {
    const k = keep.get(c.id);
    const lag = mode(k.lags);
    return {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [outline(level, labels, c)] },
      properties: {
        region, lag, lagClass: lagClass(lag), detected: mode(k.det), recorded: mode(k.rec), ha: Math.round(c.ha),
      },
    };
  });

  return {
    region,
    detectionYears: years,
    baselineYear: years[0],
    lastRecordYear,
    hist: [...hist.entries()].sort((a, b) => a[0] - b[0]).map(([lag, ha]) => ({ lag, ha: Math.round(ha) })),
    recordedHa: Math.round(recordedHa),
    laggedHa: Math.round(laggedHa),
    lagged2Ha: Math.round(lagged2Ha),
    undetectedHa: Math.round(undetectedHa),
    unrecordedHa: Math.round(unrecordedHa),
    blocks,
  };
}
