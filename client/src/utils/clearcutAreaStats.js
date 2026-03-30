/**
 * Utility to compute clearcut area (ha) per year for a given region,
 * by fetching tiles at a fixed zoom level and counting bright (clearcut) pixels.
 *
 * Tile URL conventions:
 *  - HLS (all years):  /tiles/clearcut/{region}_{year}/{z}/{x}/{yXyz}.png
 *  - Planet (2025+):   /tiles/clearcut/{region}_{year}/planet/{z}/{x}/{yXyz}.png
 *
 * The wabigoon tile grid at zoom 12 spans:
 *   x: 979, 1000–1004  (present in all years 2010–2025)
 *   y (XYZ): 1381–1403
 */

const STATS_ZOOM = 12;

// X columns present in all clearcut years for wabigoon
const WABIGOON_X = [979, 1000, 1001, 1002, 1003, 1004];

// Y range in standard XYZ coordinates
const WABIGOON_Y_MIN = 1381;
const WABIGOON_Y_MAX = 1403;

// Years where tiles are organized under a sensor subfolder (hls/ or planet/)
export const CLEARCUT_SENSOR_SUBFOLDER_YEARS = [2025];

// Years that have Planet sensor data (must also be in CLEARCUT_SENSOR_SUBFOLDER_YEARS)
export const CLEARCUT_PLANET_YEARS = [2025];

// In-memory cache: `${region}_${sensor}` → { year: areaHa }
const statsCache = new Map();

function buildTileUrl(region, year, x, yXyz, sensor) {
  const z = STATS_ZOOM;
  if (CLEARCUT_SENSOR_SUBFOLDER_YEARS.includes(year)) {
    const folder = sensor === 'planet' && CLEARCUT_PLANET_YEARS.includes(year) ? 'planet' : 'hls';
    return `/tiles/clearcut/${region}_${year}/${folder}/${z}/${x}/${yXyz}.png`;
  }
  return `/tiles/clearcut/${region}_${year}/${z}/${x}/${yXyz}.png`;
}

function getTilePixelAreaHa(yXyz) {
  const tilesPerAxis = Math.pow(2, STATS_ZOOM);
  const centerY = yXyz + 0.5;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * centerY) / tilesPerAxis)));
  const metersPerPixel = (156543.03392 * Math.cos(latRad)) / tilesPerAxis;
  return (metersPerPixel * metersPerPixel) / 10000;
}

function fetchAndCountClearcut(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, 256, 256);
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 0 && data[i] > 200) count++;
      }
      resolve(count);
    };
    img.onerror = () => resolve(0);
    img.src = url;
  });
}

/**
 * Computes clearcut area in hectares for each year in `years`.
 *
 * @param {string} region - Region name (e.g. 'wabigoon')
 * @param {number[]} years - Array of years to process
 * @param {Function|null} onProgress - Optional callback(year, areaHa) called after each year
 * @param {string} sensor - Sensor type: 'hls' (default) or 'planet'
 * @returns {Promise<Object>} Map of year → areaHa
 */
export async function computeClearcutAreaPerYear(region, years, onProgress, sensor = 'hls') {
  const cacheKey = `${region}_${sensor}`;
  const cached = statsCache.get(cacheKey);
  if (cached) {
    if (onProgress) years.forEach(y => onProgress(y, cached[y] ?? 0));
    return cached;
  }

  const results = {};

  for (const year of years) {
    const fetches = [];

    for (const x of WABIGOON_X) {
      for (let yXyz = WABIGOON_Y_MIN; yXyz <= WABIGOON_Y_MAX; yXyz++) {
        const url = buildTileUrl(region, year, x, yXyz, sensor);
        const pixelAreaHa = getTilePixelAreaHa(yXyz);
        fetches.push(
          fetchAndCountClearcut(url).then(count => count * pixelAreaHa)
        );
      }
    }

    const areas = await Promise.all(fetches);
    results[year] = areas.reduce((sum, a) => sum + a, 0);
    if (onProgress) onProgress(year, results[year]);
  }

  statsCache.set(cacheKey, results);
  return results;
}

export function clearStatsCache() {
  statsCache.clear();
}
