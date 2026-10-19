/**
 * Geometry the AI agent may put on the map, and the limits on it.
 *
 * The governing constraint: a language model does not know where anything
 * actually is. It cannot recall the outline of a harvest block or the edge of a
 * burn scar, and asked for one it will emit plausible, confident, fabricated
 * coordinates -- which on a map are indistinguishable from a measurement. So
 * the model is never allowed to produce geometry from memory. It may only:
 *
 *   draw_bbox         a box of a stated size around a stated point -- arithmetic
 *                     done here, from numbers the user supplied
 *   draw_polygon      coordinates the USER gave in the conversation
 *   highlight_patches the clearcut patches matching a query -- largest first, or
 *                     above a size threshold -- drawn from the published patch
 *                     vectors. The model chooses the region, year and query;
 *                     the geometry comes from the data.
 *   highlight_layer   the same for every other module, from the app's own COGs
 *                     (cogFinder.js): largest burned areas, harvest blocks, AI
 *                     clearcuts, core caribou habitat patches, logging scars.
 *   highlight_alerts  disturbance alerts already loaded in the app (largest,
 *                     newest, or confirmed only).
 *
 * These finders are the only way the agent draws a shape tied to a specific
 * place: a generic FMU outline says nothing a query didn't already ask for, so
 * there is no "outline this region" action. A finder with no region falls back
 * to the FMUs selected on the map, and with no year to the year on the map.
 *
 * Everything below is validation of untrusted model output: bounds, size, and
 * count are all capped, and anything failing is dropped rather than corrected,
 * because a silently "fixed" polygon is still a fabricated one.
 */

import { DATA_BASE_URL } from '../config';
import { findInCog, FINDER_LAYERS, layerAvailability } from './cogFinder';
import { REGION_LABELS } from './borealLayers';

// Ontario plus a wide margin. A coordinate outside this is a hallucination or a
// lat/lon swap, and both should be refused rather than drawn.
const BOUNDS = { minLon: -96.5, maxLon: -73.0, minLat: 41.0, maxLat: 57.5 };

const MAX_SHAPES = 5;
// Separate from MAX_SHAPES because one requested shape can expand to many: a
// highlight_patches query resolves to several patch polygons, and a patch can
// itself be a MultiPolygon. The cap is on what actually reaches the map, not
// on what was asked for.
const MAX_FEATURES = 60;
const MAX_VERTICES = 200;
// Larger than any FMU. A "polygon" spanning the province is a sign the model
// invented a bounding box rather than using what it was given.
const MAX_SIZE_KM = 400;

// terra-draw validates against a default coordinatePrecision of 9 and rejects
// anything finer -- and it does so through addFeatures' return value rather than
// by throwing, so the failure is silent. Every source here trips it: the
// published patch vectors and the bbox maths both produce full float
// expansions. 6 decimals is ~0.1 m, far beyond what any of this data
// supports, so rounding costs nothing real.
const COORD_PRECISION = 6;

const roundRing = (ring) => ring.map(([x, y]) => [
  Number(x.toFixed(COORD_PRECISION)),
  Number(y.toFixed(COORD_PRECISION)),
]);

/** UUID v4, with a fallback for browsers without crypto.randomUUID. */
function newFeatureId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const inBounds = ([lon, lat]) =>
  Number.isFinite(lon) && Number.isFinite(lat)
  && lon >= BOUNDS.minLon && lon <= BOUNDS.maxLon
  && lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat;

/**
 * Extracts a ```map-action fenced block, if the reply carries one.
 * Returns { action, text } with the block stripped from the prose.
 */
export function extractMapAction(text) {
  if (typeof text !== 'string') return { action: null, text };
  const fence = /```map-action\s*([\s\S]*?)```/i;
  const match = text.match(fence);
  if (!match) return { action: null, text };

  let action = null;
  try {
    action = JSON.parse(match[1].trim());
  } catch {
    // Malformed JSON means no action, but the prose is still worth showing.
    action = null;
  }
  return { action, text: text.replace(fence, '').trim() };
}

function bboxFeature(center, sizeKm) {
  const [lat, lon] = center;
  if (!inBounds([lon, lat])) return null;
  if (!Number.isFinite(sizeKm) || sizeKm <= 0 || sizeKm > MAX_SIZE_KM) return null;

  const halfLat = sizeKm / 2 / 110.574;
  const halfLon = sizeKm / 2 / (111.320 * Math.cos((lat * Math.PI) / 180));
  const ring = [
    [lon - halfLon, lat - halfLat],
    [lon + halfLon, lat - halfLat],
    [lon + halfLon, lat + halfLat],
    [lon - halfLon, lat + halfLat],
    [lon - halfLon, lat - halfLat],
  ];
  return ring.every(inBounds) ? ring : null;
}

function polygonRing(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 3) return null;
  if (coordinates.length > MAX_VERTICES) return null;
  const ring = coordinates.map((c) => (Array.isArray(c) ? [Number(c[0]), Number(c[1])] : null));
  if (ring.some((c) => !c || !inBounds(c))) return null;
  // GeoJSON rings must close; models routinely forget.
  const [first] = ring;
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
  return ring;
}

/**
 * Loose key for region matching.
 *
 * The app's ids are bare ("wabigoon") while its display names are not
 * ("Wabigoon Forest"), and a model writing prose reaches for neither -- it says
 * "Wabigoon FMU". Exact matching rejected all three-quarters of the time, so
 * strip punctuation and the interchangeable words rather than making the model
 * guess our internal spelling.
 */
function regionKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(fmu|forest|management|unit|park)\b/g, '')
    .replace(/\s+/g, '')
    .trim();
}

/**
 * Every Ontario FMU, from the overview file the app already ships.
 *
 * Only used to tell the model which region ids are valid for highlight_patches
 * (see availableRegionIds below) -- the overview itself is no longer drawn, now
 * that the agent has no "outline this region" action.
 */
let _overviewPromise = null;

function loadOverview() {
  if (!_overviewPromise) {
    _overviewPromise = fetch(`${DATA_BASE_URL}/data/regions/ontario-overview.json`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return _overviewPromise;
}

// Patch vectors, one file per region/year, derived from the same accumulated
// masks the map draws. Cached because a conversation revisits the same year.
const _patchCache = new Map();

function loadPatches(region, year) {
  const key = `${region}_${year}`;
  if (!_patchCache.has(key)) {
    _patchCache.set(key, fetch(`${DATA_BASE_URL}/data/patches/${key}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null));
  }
  return _patchCache.get(key);
}

// Spherical shoelace formula, mirrors ClearcutDetection.jsx's
// computeGeoJsonAreaHa. Patch files carry no pre-computed area property, so
// minAreaHa filtering (below) has to derive it from the ring itself.
const EARTH_RADIUS_M = 6371000;

function ringAreaM2(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const dLng = ((ring[i + 1][0] - ring[i][0]) * Math.PI) / 180;
    const phi1 = (ring[i][1] * Math.PI) / 180;
    const phi2 = (ring[i + 1][1] * Math.PI) / 180;
    area += dLng * (Math.sin(phi1) + Math.sin(phi2));
  }
  return Math.abs((area * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

const featureAreaHa = (rings) => rings.reduce((sum, ring) => sum + ringAreaM2(ring), 0) / 10000;

/**
 * The clearcut patches for a region/year matching a query: the N largest, or
 * the N largest above a minAreaHa threshold.
 *
 * This is the answer to "highlight the biggest clearcuts" / "clearcuts bigger
 * than X ha", which the assistant previously had to refuse: it has no way to
 * know where they are, and guessing is the one thing it must not do. Here it
 * chooses only the query; every coordinate comes from the published vectors,
 * which are pre-sorted largest first.
 */
async function patchRings(shape) {
  const region = regionKey(shape.region);
  const year = Number(shape.year);
  if (!region || !Number.isFinite(year)) return [];

  const fc = await loadPatches(region, year);
  if (!fc?.features?.length) return [];

  const count = Math.min(Math.max(Number(shape.count) || 5, 1), 25);
  const minAreaHa = Number(shape.minAreaHa);
  const hasMinArea = Number.isFinite(minAreaHa) && minAreaHa > 0;

  const rings = [];
  let taken = 0;
  for (const feature of fc.features) {
    if (taken >= count) break;
    const geom = feature.geometry;
    const featureRings = geom?.type === 'Polygon'
      ? [geom.coordinates[0]]
      : geom?.type === 'MultiPolygon'
        ? geom.coordinates.map((poly) => poly[0])
        : [];
    if (!featureRings.length) continue;
    if (hasMinArea && featureAreaHa(featureRings) < minAreaHa) continue;

    rings.push(...featureRings);
    taken += 1;
  }
  return rings;
}

// Finders over several FMUs read one raster each; past this they'd be slow
const MAX_FINDER_REGIONS = 6;

/** Regions a finder runs over: the one it names, else the FMUs on the map. */
function finderRegions(shape, ctx) {
  if (shape.region) return [regionKey(shape.region)].filter(Boolean);
  return (ctx.regions || []).map(regionKey).filter(Boolean);
}

const REGION_NAMES = (ids) => ids.map((id) => REGION_LABELS[id] || id.replace(/\b\w/g, (c) => c.toUpperCase())).join(', ');

// Yearly stats the app already ships, used to pick which FMUs a finder reads
// when more are selected than it can read at once
const _stats = {};
function loadStats(name) {
  if (!_stats[name]) {
    _stats[name] = fetch(`${DATA_BASE_URL}/data/${name}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  }
  return _stats[name];
}

/**
 * Orders candidate regions by how much of the layer they have that year, so
 * "the biggest fires" across 38 FMUs reads the FMUs that burned most rather
 * than the first six alphabetically. Layers without yearly stats keep order.
 */
async function rankRegions(layerKey, regions, year) {
  const source = { fire: ['wildfire_stats', (v) => v?.areaHa], habitat: ['caribou_stats', (v) => v?.coreHa] }[layerKey];
  if (!source || regions.length <= MAX_FINDER_REGIONS) return regions;
  const stats = await loadStats(source[0]);
  if (!stats) return regions;
  const amount = (r) => Number(source[1](stats[r]?.[String(year)])) || 0;
  return regions.slice().sort((a, b) => amount(b) - amount(a));
}

const fmtHa = (ha) => `${Math.round(ha).toLocaleString('en-US')} ha`;

/**
 * highlight_layer: the largest areas of a module's layer, from its COGs, over
 * every region asked about, ranked together. Returns { rings, labels, error }.
 */
async function layerRings(shape, ctx) {
  const layer = FINDER_LAYERS[shape.layer];
  if (!layer) return { rings: [], error: `unknown layer "${shape.layer}" (use ${Object.keys(FINDER_LAYERS).join(', ')})` };
  const year = Number.isFinite(Number(shape.year)) && shape.year !== null && shape.year !== '' ? Number(shape.year) : Number(ctx.year);
  // Only the regions that have this layer (for the year): most products
  // cover a handful of FMUs, so taking the first selected ones found nothing
  const asked = finderRegions(shape, ctx);
  const { available, everywhere } = await layerAvailability(shape.layer, asked, year);
  let regions = available === null ? asked : available;
  if (!asked.length && everywhere) regions = everywhere;   // nothing selected: wherever it exists
  if (!regions.length) {
    if (!asked.length) return { rings: [], error: 'no region given and no FMU selected on the map' };
    return {
      rings: [],
      error: everywhere && everywhere.length
        ? `${layer.noun} is published only for ${REGION_NAMES(everywhere)}${layer.needsYear ? ` in ${year}` : ''}, none of which is selected`
        : `no ${layer.noun} published${layer.needsYear ? ` for ${year}` : ''}`,
    };
  }
  regions = (await rankRegions(shape.layer, regions, year)).slice(0, MAX_FINDER_REGIONS);
  const count = Math.min(Math.max(Number(shape.count) || 5, 1), 25);
  const results = await Promise.all(regions.map((region) => findInCog({ ...shape, region, year, count })
    .then((r) => ({ ...r, region }))));
  const found = results.flatMap((r) => r.found.map((f) => ({ ...f, region: r.region })))
    .sort((a, b) => b.ha - a.ha)
    .slice(0, count);
  if (!found.length) {
    const why = results.map((r) => r.error).filter(Boolean)[0];
    // Name the filter that emptied the result, so the next request can relax it
    const filters = [
      shape.persistentOnly && 'persistent only (flagged at 2+ snapshots)',
      shape.confirmedOnly && 'confirmed only',
      Number(shape.minAreaHa) > 0 && `at least ${shape.minAreaHa} ha`,
      Number(shape.minClass) > 0 && `size class ${shape.minClass}+`,
    ].filter(Boolean);
    return {
      rings: [],
      error: why || `no ${layer.noun} found for ${REGION_NAMES(regions)}${layer.needsYear ? ` ${year}` : ''}`
        + (filters.length ? ` with the filter: ${filters.join(', ')} -- try without it` : ''),
    };
  }
  return {
    rings: found.map((f) => f.ring),
    labels: found.map((f) => `${layer.noun}, ${fmtHa(f.ha)}${layer.needsYear ? ` (${year})` : ''}`),
  };
}

/**
 * highlight_alerts: alerts the app has loaded (signed in, last 180 days),
 * filtered to the region(s), ranked largest or newest first.
 */
function alertRings(shape, ctx) {
  const all = Array.isArray(ctx.alerts) ? ctx.alerts : [];
  if (!all.length) return { rings: [], error: 'no disturbance alerts loaded (sign in and open Disturbance Alerts)' };
  const regions = shape.region ? finderRegions(shape, ctx) : null;
  const days = Number(shape.days) > 0 ? Number(shape.days) : null;
  const now = Date.now();
  const picked = all.filter((f) => {
    const p = f.properties || {};
    if (regions && !regions.includes(regionKey(p.region))) return false;
    if (shape.confirmedOnly && p.status !== 'confirmed') return false;
    if (days && now - new Date(p.firstDetected).getTime() > days * 86400000) return false;
    return true;
  });
  const byNewest = shape.sortBy === 'newest';
  picked.sort((a, b) => (byNewest
    ? new Date(b.properties.firstDetected) - new Date(a.properties.firstDetected)
    : (b.properties.areaHa || 0) - (a.properties.areaHa || 0)));
  const count = Math.min(Math.max(Number(shape.count) || 5, 1), 25);
  const rings = [];
  const labels = [];
  picked.slice(0, count).forEach((f) => {
    const g = f.geometry;
    const featureRings = g?.type === 'Polygon' ? [g.coordinates[0]] : g?.type === 'MultiPolygon' ? g.coordinates.map((p) => p[0]) : [];
    featureRings.forEach((ring) => {
      rings.push(ring);
      labels.push(`${f.properties.status === 'confirmed' ? 'Confirmed' : 'Provisional'} alert, ${fmtHa(f.properties.areaHa || 0)}, ${String(f.properties.firstDetected).slice(0, 10)}`);
    });
  });
  return rings.length ? { rings, labels } : { rings: [], error: 'no alerts match that query' };
}

// Layer names a model reaches for, mapped to FINDER_LAYERS keys
const LAYER_ALIASES = {
  fire: 'fire', fires: 'fire', burn: 'fire', burns: 'fire', burned: 'fire', burned_area: 'fire', wildfire: 'fire', wildfires: 'fire',
  harvest: 'harvest', harvests: 'harvest', harvest_blocks: 'harvest', ari: 'harvest', inventory: 'harvest',
  ai_clearcut: 'ai_clearcut', ai_clearcuts: 'ai_clearcut', clearcut: 'ai_clearcut', clearcuts: 'ai_clearcut',
  habitat: 'habitat', caribou: 'habitat', caribou_habitat: 'habitat', core_habitat: 'habitat',
  scars: 'scars', scar: 'scars', logging_scars: 'scars', logging_scar: 'scars',
};
const aliasKey = (v) => String(v || '').toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '');

/**
 * Accepts the near-misses models produce for the finder actions -- a layer
 * with no action, "highlight_scars" for highlight_layer + scars, "logging
 * scars" for scars -- rather than refusing a request whose intent is clear.
 * Geometry is still never taken from the model: this only names the query.
 */
function normalizeShape(shape) {
  if (!shape || typeof shape !== 'object') return shape;
  const action = aliasKey(shape.action || shape.type);
  const layerFrom = (v) => LAYER_ALIASES[aliasKey(v)];
  if (action === 'highlight_layer' || (!action && shape.layer)) {
    return { ...shape, action: 'highlight_layer', layer: layerFrom(shape.layer) || shape.layer };
  }
  // highlight_scars, highlight_fires, find_habitat, ...
  const m = action.match(/^(?:highlight|find|show)_(.+)$/);
  if (m && m[1] !== 'patches' && m[1] !== 'alerts' && m[1] !== 'layer') {
    const layer = layerFrom(m[1]) || layerFrom(shape.layer);
    if (layer) return { ...shape, action: 'highlight_layer', layer };
  }
  if (action === 'highlight_patches' || action === 'highlight_alerts' || action === 'draw_bbox' || action === 'draw_polygon') {
    return { ...shape, action };
  }
  return shape;
}

/** Ids the assistant may query with highlight_patches. Falls back to what's loaded if the fetch fails. */
export async function availableRegionIds(regionsData) {
  const overview = await loadOverview();
  const ids = (overview?.features ?? []).map((f) => f.properties?.id).filter(Boolean);
  if (ids.length) return ids;
  return (regionsData?.features ?? []).map((f) => f.properties?.id).filter(Boolean);
}

/**
 * Validates a model-proposed action into drawable features.
 *
 * @returns {{ features: Array, rejected: string|null }} rejected carries a
 *   reason to show the user -- a refusal the reader can see beats geometry that
 *   quietly never appeared.
 */
export async function actionToFeatures(action, ctx = {}) {
  if (!action || typeof action !== 'object') return { features: [], rejected: null };

  const shapes = (Array.isArray(action.shapes) ? action.shapes : [action]).map(normalizeShape);
  if (shapes.length > MAX_SHAPES) {
    return { features: [], rejected: `refused: ${shapes.length} shapes exceeds the limit of ${MAX_SHAPES}` };
  }

  const features = [];
  for (const shape of shapes) {
    let rings = [];
    let labels = null;
    let finderError = null;
    switch (shape?.action) {
      case 'draw_bbox': {
        const ring = bboxFeature(shape.center || [], Number(shape.sizeKm));
        if (ring) rings = [ring];
        break;
      }
      case 'draw_polygon': {
        const ring = polygonRing(shape.coordinates);
        if (ring) rings = [ring];
        break;
      }
      case 'highlight_patches': {
        // No region or year given: the first FMU and the year on the map
        const region = shape.region || (ctx.regions || [])[0];
        const year = shape.year ?? ctx.year;
        rings = await patchRings({ ...shape, region, year });
        labels = rings.map((ring) => `clearcut patch, ${fmtHa(featureAreaHa([ring]))} (${year})`);
        if (!rings.length) finderError = `no patch data published for ${region || 'the selected area'} ${year}`;
        break;
      }
      case 'highlight_layer': {
        const r = await layerRings(shape, ctx);
        rings = r.rings;
        labels = r.labels || null;
        finderError = r.error || null;
        break;
      }
      case 'highlight_alerts': {
        const r = alertRings(shape, ctx);
        rings = r.rings;
        labels = r.labels || null;
        finderError = r.error || null;
        break;
      }
      default:
        break;
    }

    if (rings.length === 0) {
      if (finderError) return { features: [], rejected: `refused: ${finderError}` };
      // Not an action we know: say what arrived, so a mismatch between the
      // assistant's instructions and the app is diagnosable from the chat
      if (!['draw_bbox', 'draw_polygon'].includes(shape?.action)) {
        const keys = shape && typeof shape === 'object' ? Object.keys(shape).join(', ') : typeof shape;
        return {
          features: [],
          rejected: `refused: unrecognised map action "${shape?.action || 'none'}" (fields: ${keys}). `
            + 'If the API server was not restarted since the highlight actions were added, restart it.',
        };
      }
      return {
        features: [],
        rejected: `refused: "${shape.action}" produced no valid geometry `
          + '(coordinates outside Ontario, or an implausible size)',
      };
    }

    const isFinder = /^highlight_/.test(shape.action);
    rings.forEach((ring, i) => features.push({
      // terra-draw's default id strategy validates ids as UUIDs and rejects a
      // feature that arrives without one -- silently, since addFeatures returns
      // validation results rather than throwing.
      id: newFeatureId(),
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [roundRing(ring)] },
      properties: {
        mode: 'ai',
        // Carried so the UI can always say where a shape came from. Nothing
        // downstream should treat these as user intent.
        proposedBy: 'assistant',
        label: labels?.[i] || (typeof shape.label === 'string' ? shape.label.slice(0, 80) : undefined),
        // Found in the data (not drawn from numbers the user gave): the map
        // blinks these so they can be spotted
        highlight: isFinder || undefined,
      },
    }));
  }

  if (features.length > MAX_FEATURES) {
    return {
      features: [],
      rejected: `refused: ${features.length} outlines exceeds the limit of ${MAX_FEATURES} — ask for fewer regions`,
    };
  }

  return { features, rejected: null };
}
