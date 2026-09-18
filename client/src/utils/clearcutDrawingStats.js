import { DATA_BASE_URL } from '../config';

const _patchCache = new Map();

function regionKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(fmu|forest|management|unit|park)\b/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function loadPatches(region, year) {
  const id = regionKey(region);
  const y = Number(year);
  if (!id || !Number.isFinite(y)) return Promise.resolve(null);
  const key = `${id}_${y}`;
  if (!_patchCache.has(key)) {
    _patchCache.set(
      key,
      fetch(`${DATA_BASE_URL}/data/patches/${key}.json`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    );
  }
  return _patchCache.get(key);
}

function outerRings(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return geom.coordinates?.[0] ? [geom.coordinates[0]] : [];
  if (geom.type === 'MultiPolygon') return (geom.coordinates || []).map((p) => p[0]).filter(Boolean);
  return [];
}

function bboxOf(ring) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

function bboxesOverlap(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const straddles = (yi > y) !== (yj > y);
    if (straddles && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function orient(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a, b, p) {
  return (
    Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0])
    && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1])
  );
}

function segmentsIntersect(a1, a2, b1, b2) {
  const o1 = orient(a1, a2, b1);
  const o2 = orient(a1, a2, b2);
  const o3 = orient(b1, b2, a1);
  const o4 = orient(b1, b2, a2);

  if ((o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0)) return true;

  if (o1 === 0 && onSegment(a1, a2, b1)) return true;
  if (o2 === 0 && onSegment(a1, a2, b2)) return true;
  if (o3 === 0 && onSegment(b1, b2, a1)) return true;
  if (o4 === 0 && onSegment(b1, b2, a2)) return true;

  return false;
}

function ringIntersectsRing(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 4 || b.length < 4) return false;

  const aBbox = bboxOf(a);
  const bBbox = bboxOf(b);
  if (!bboxesOverlap(aBbox, bBbox)) return false;

  for (let i = 0; i < a.length - 1; i += 1) {
    const a1 = a[i];
    const a2 = a[i + 1];
    for (let j = 0; j < b.length - 1; j += 1) {
      const b1 = b[j];
      const b2 = b[j + 1];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }

  if (pointInRing(a[0], b)) return true;
  if (pointInRing(b[0], a)) return true;

  return false;
}

function areaShapes(features) {
  return (features || []).filter((f) => {
    const t = f?.geometry?.type;
    return t === 'Polygon' || t === 'MultiPolygon';
  });
}

export async function computeClearcutDrawingPresence({
  features,
  regions,
  year,
}) {
  const shapes = areaShapes(features);
  const regionIds = (regions || []).map(regionKey).filter(Boolean);
  const y = Number(year);

  if (!shapes.length || !regionIds.length || !Number.isFinite(y)) {
    return {
      available: false,
      intersects: null,
      intersectingPatchCount: 0,
      checkedPatchCount: 0,
      regionsChecked: [],
    };
  }

  let checkedPatchCount = 0;
  let intersectingPatchCount = 0;
  const regionsChecked = [];

  for (const region of regionIds) {
    const fc = await loadPatches(region, y);
    if (!fc?.features?.length) continue;
    regionsChecked.push(region);

    for (const patch of fc.features) {
      const patchRings = outerRings(patch.geometry);
      if (!patchRings.length) continue;
      checkedPatchCount += patchRings.length;

      let hit = false;
      for (const patchRing of patchRings) {
        for (const shape of shapes) {
          const shapeRings = outerRings(shape.geometry);
          if (shapeRings.some((shapeRing) => ringIntersectsRing(shapeRing, patchRing))) {
            hit = true;
            break;
          }
        }
        if (hit) break;
      }
      if (hit) intersectingPatchCount += 1;
    }
  }

  if (!regionsChecked.length) {
    return {
      available: false,
      intersects: null,
      intersectingPatchCount: 0,
      checkedPatchCount: 0,
      regionsChecked: [],
    };
  }

  return {
    available: true,
    intersects: intersectingPatchCount > 0,
    intersectingPatchCount,
    checkedPatchCount,
    regionsChecked,
  };
}
