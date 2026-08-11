/**
 * Ground area of an FMU boundary, in hectares.
 *
 * Used to express a detection area as a percentage of the region it sits in
 * ("13.1% of total FMU area"). The boundary GeoJSON files are large — wabigoon
 * alone is ~1.1 MB — so results are cached per region and shared by every
 * caller.
 *
 * NOTE: ClearcutDetection.jsx carries its own copy of computeGeoJsonAreaHa,
 * written before this util existed. Pointing it here would remove the
 * duplication; left alone for now to avoid churn in working code.
 */

import { DATA_BASE_URL } from '../config';

/**
 * Spherical shoelace formula — area in hectares for a GeoJSON FeatureCollection
 * or Feature (Polygon or MultiPolygon). Only outer rings are counted; holes are
 * ignored, matching the existing clearcut behaviour.
 */
export function computeGeoJsonAreaHa(geoJson) {
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
        ? geom.coordinates.map((p) => p[0])
        : [];

    for (const ring of rings) {
      if (ring.length < 3) continue;
      let area = 0;
      for (let i = 0; i < ring.length - 1; i += 1) {
        const dLng = (ring[i + 1][0] - ring[i][0]) * Math.PI / 180;
        const phi1 = ring[i][1] * Math.PI / 180;
        const phi2 = ring[i + 1][1] * Math.PI / 180;
        area += dLng * (Math.sin(phi1) + Math.sin(phi2));
      }
      totalM2 += Math.abs(area * R * R / 2);
    }
  }

  return totalM2 / 10000;
}

// region id -> Promise<number ha>. Cached because the GeoJSON is megabytes and
// the area never changes.
const _areaCache = new Map();

function getSingleRegionAreaHa(region) {
  const id = String(region || '').toLowerCase();
  if (!id) return Promise.resolve(0);

  if (!_areaCache.has(id)) {
    const promise = fetch(`${DATA_BASE_URL}/data/regions/${id}.json`)
      .then((res) => {
        // Throw rather than resolve to null: a non-OK response is a failure,
        // and it has to reach the catch below so the cache entry is dropped.
        // Treating it as "no data" would cache 0 ha and pin the UI to 0%
        // until reload, even after a transient 500 clears.
        if (!res.ok) throw new Error(`regions/${id}.json: HTTP ${res.status}`);
        return res.json();
      })
      .then((geoJson) => computeGeoJsonAreaHa(geoJson) ?? 0)
      .catch(() => {
        // Don't cache a failure — a transient error shouldn't pin the area to 0.
        _areaCache.delete(id);
        return 0;
      });
    _areaCache.set(id, promise);
  }

  return _areaCache.get(id);
}

/**
 * Total boundary area across the given regions, in hectares.
 * Returns null when nothing could be resolved, so callers can distinguish
 * "still loading / unavailable" from a genuine zero.
 *
 * @param {string[]} regions - FMU ids
 * @returns {Promise<number|null>}
 */
export async function getRegionAreaHa(regions) {
  if (!Array.isArray(regions) || regions.length === 0) return null;

  const areas = await Promise.all(regions.map(getSingleRegionAreaHa));
  const total = areas.reduce((sum, a) => sum + (a ?? 0), 0);

  return total > 0 ? total : null;
}
