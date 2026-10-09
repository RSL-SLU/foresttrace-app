/**
 * Color functions for the boreal-canada-mapping products (converted by
 * scripts/data/prepare-boreal-cogs.py). Each factory returns a
 * maplibre-cog-protocol color function: (pixel, color, metadata) where
 * `pixel` holds every band's value for one pixel.
 *
 * All products are integer-typed after conversion: uint16 with nodata 65535
 * (status, scars), uint16 with 0 = no record (ARI), uint8 with nodata 255
 * (SCANFI). Nodata always renders transparent and is never treated as "0".
 */

const U16_NODATA = 65535;
const U8_NODATA = 255;
const CLEAR = [0, 0, 0, 0];

export const ARI_WINDOW_YEARS = 5;
export const AMBER = [217, 119, 6];   // accumulated (5-year window)
export const RED = [220, 38, 38];     // annual

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// 256-entry lookup from color stops [[value0to1, '#hex'], ...]
function rampLut(stops) {
  const rgb = stops.map(([t, hex]) => [t, hexToRgb(hex)]);
  return Array.from({ length: 256 }, (_, i) => {
    const t = i / 255;
    let k = 0;
    while (k < rgb.length - 2 && t > rgb[k + 1][0]) k++;
    const [t0, c0] = rgb[k];
    const [t1, c1] = rgb[k + 1];
    const f = t1 === t0 ? 0 : Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    return c0.map((c, j) => Math.round(c + (c1[j] - c) * f));
  });
}

/**
 * ARI ground truth (band 1 = AR_YEAR, 0 = no harvest record). Annual: harvested
 * in `year`; accumulated: harvested in (year - 5, year], as the app's earlier
 * per-year ARI rasters were.
 */
export function ariColorFn(mode, year) {
  const rgba = [...(mode === 'annual' ? RED : AMBER), 255];
  return (pixel, color) => {
    const y = pixel[0];
    const hit = mode === 'annual'
      ? y === year
      : y > year - ARI_WINDOW_YEARS && y <= year;
    color.set(y > 0 && hit ? rgba : CLEAR);
  };
}

/**
 * AI clearcut status (bands: STATUS, CONFIDENCE, DETECTION_YEAR,
 * CONFIRMATION_YEAR), per the handoff's rendering rules. STATUS and
 * CONFIDENCE are separate dimensions: STATUS picks the color, CONFIDENCE the
 * opacity -- and only for provisional pixels.
 *   1 = provisional (model only)      amber, alpha from confidence (15-95%)
 *   2 = confirmed by an AR record     deep red, fixed opacity
 *   4 = confirmed by persistence      purple, fixed opacity
 *   3 = reserved, treated as no data
 * The files already carry confirmations from later years, so a pixel is drawn
 * as it was known in the viewed year: confirmed after `year` -> provisional.
 * Stepping the timeline then shows detections resolve to confirmed.
 */
export const STATUS_COLORS = {
  1: [245, 158, 11],   // amber
  2: [153, 27, 27],    // deep red
  4: [126, 34, 206],   // purple
};
const PROVISIONAL_ALPHA = [0.15, 0.95];

/** STATUS as known in `year`: 0 none, 1/2/4, or null for no data / reserved. */
export function statusAsOf(values, year) {
  const [status, , , confirmationYear] = values;
  if (status === undefined || status === U16_NODATA || !Number.isFinite(status)) return null;
  if (status === 0) return 0;
  if (status === 2 || status === 4) return confirmationYear > year ? 1 : status;
  return status === 1 ? 1 : null;
}

/** minConfidence (0-100) hides provisional pixels below it; confirmed ones always show. */
export function statusColorFn(year, minConfidence = 0) {
  const [lo, hi] = PROVISIONAL_ALPHA;
  return (pixel, color) => {
    const status = statusAsOf(pixel, year);
    if (!status) {
      color.set(CLEAR);
      return;
    }
    if (status === 1) {
      const confidence = Math.min(100, pixel[1] === U16_NODATA ? 0 : pixel[1]);
      if (confidence < minConfidence) {
        color.set(CLEAR);
        return;
      }
      color.set([...STATUS_COLORS[1], Math.round(255 * (lo + (hi - lo) * (confidence / 100)))]);
      return;
    }
    color.set([...STATUS_COLORS[status], 255]);
  };
}

/** Plain-language reading of one status pixel for a tooltip, as known in `year`. */
export function describeStatus(values, year) {
  const status = statusAsOf(values, year);
  if (status === null) return { title: 'No data available here.' };
  if (status === 0) return { title: 'Checked — no disturbance detected.' };
  const [raw, confidence, detectionYear, confirmationYear] = values;
  const detected = detectionYear > 0 ? `Detected ${detectionYear}.` : '';
  if (status === 1) {
    const pending = (raw === 2 || raw === 4) && confirmationYear > year
      ? ` Confirmed later, in ${confirmationYear}.` : '';
    return {
      title: 'Provisional — model detection, not yet confirmed.',
      detail: `${detected} Confidence ${Math.min(100, confidence)}%.${pending}`.trim(),
    };
  }
  if (status === 2) {
    return {
      title: `Confirmed by ${confirmationYear > 0 ? `${confirmationYear} ` : ''}harvest record.`,
      detail: `${detected}${confirmationYear > 0 ? ` Confirmed ${confirmationYear}.` : ''}`.trim(),
    };
  }
  return {
    title: 'Confirmed — the model flagged it again in a later year.',
    detail: `${detected}${confirmationYear > 0 ? ` Confirmed ${confirmationYear}.` : ''}`.trim(),
  };
}

// Logging scars: darker = further below same-age peers' biomass
export const SCAR_RAMP = [[0, '#1e3a8a'], [0.5, '#3b82f6'], [1, '#bfdbfe']];
const SCAR_LUT = rampLut(SCAR_RAMP);

/**
 * Logging scars (bands: SCAR_COUNT 0-3, WORST_COHORT_RATIO x 100). Drawn only
 * where SCAR_COUNT >= 1 (>= 2 with persistentOnly), colored by the ratio over
 * 0-0.5 (the flag line). A single-snapshot scar is lighter: it may be a
 * transient bad year rather than a stand that never recovered.
 */
export function scarsColorFn(persistentOnly) {
  return (pixel, color) => {
    const count = pixel[0];
    const ratio = pixel[1];
    if (count === U16_NODATA || ratio === U16_NODATA || count < (persistentOnly ? 2 : 1)) {
      color.set(CLEAR);
      return;
    }
    const t = Math.min(1, Math.max(0, ratio / 100 / 0.5));
    const rgb = SCAR_LUT[Math.round(t * 255)];
    color.set([...rgb, count >= 2 ? 235 : 130]);
  };
}

// SCANFI above-ground biomass, t/ha
export const BIOMASS_MAX = 180;
export const BIOMASS_RAMP = [[0, '#ffffcc'], [0.25, '#c2e699'], [0.5, '#78c679'], [0.75, '#31a354'], [1, '#006837']];
const BIOMASS_LUT = rampLut(BIOMASS_RAMP);
export const SCANFI_YEARS = [2015, 2020, 2025];

/** The SCANFI snapshot shown for a map year: the latest one not after it (2015 before that). */
export function scanfiSnapshot(year) {
  return [...SCANFI_YEARS].reverse().find((y) => y <= year) ?? SCANFI_YEARS[0];
}

/** SCANFI biomass (bands 1-3 = BIOMASS_2015/2020/2025 t/ha; 4-6 = stand age). */
export function scanfiColorFn(year) {
  const band = SCANFI_YEARS.indexOf(scanfiSnapshot(year));
  return (pixel, color) => {
    const v = pixel[band];
    if (v === U8_NODATA) {
      color.set(CLEAR);
      return;
    }
    const rgb = BIOMASS_LUT[Math.round(Math.min(1, v / BIOMASS_MAX) * 255)];
    color.set([...rgb, 210]);
  };
}

/** CSS linear-gradient for a ramp, for legends */
export function rampCss(stops) {
  return `linear-gradient(90deg, ${stops.map(([t, hex]) => `${hex} ${Math.round(t * 100)}%`).join(', ')})`;
}

/**
 * Notes the clearcut panel shows for the selected FMUs and year (from the
 * boreal-canada-mapping handoff, 2026-10-09). Which model produced each
 * region's AI layer differs, and two cases are known to be weaker.
 */
export const REGION_LABELS = {
  wabigoon: 'Wabigoon',
  dogrivermatawin: 'Dog River-Matawin',
  gordoncosens: 'Gordon Cosens',
  bancroftminden: 'Bancroft Minden',
};

export const REGION_MODEL_NOTES = {
  wabigoon: 'AI model trained on Wabigoon’s own imagery.',
  dogrivermatawin: 'Uses the Wabigoon model on its own imagery (same ecozone; the transfer was validated).',
  gordoncosens: 'Its own model, trained on Gordon Cosens imagery (Clay Belt ecozone).',
  bancroftminden: 'Its own model (Great Lakes–St. Lawrence ecozone). Lowest confidence of the four regions: few harvest records to train and validate against.',
};

export function reliabilityNotes(regions, year) {
  const notes = [];
  if (regions.includes('wabigoon') && year === 2016) {
    notes.push('Wabigoon 2016 is a lower-confidence year: no earlier composite exists, so it has no change (delta-NBR) evidence, and it was the worst year for sensor contamination. Its clearcut rate reads about double its neighbours’.');
  }
  if (regions.includes('bancroftminden')) {
    notes.push('Bancroft Minden figures are structurally less certain than the other regions’; read them as indicative.');
  }
  return notes;
}
