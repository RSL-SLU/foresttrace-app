/**
 * Finders for the AI agent's highlights, read from the app's own COGs.
 *
 * "Highlight the largest burned areas" has to resolve to real places, never to
 * coordinates the model makes up (see mapActions.js). For modules with no
 * published vectors, the places come from the rasters the map already draws:
 *
 *   1. read one overview level of the region's COG (about 1,400 px across,
 *      ~100 m pixels: enough to find and outline areas, a few MB at most)
 *   2. mark the pixels matching the layer's rule (burned; harvested in a year;
 *      core habitat of a size class; flagged as a logging scar; AI detection)
 *   3. group them into connected areas, measure each in hectares, keep the
 *      largest (optionally above a size threshold)
 *   4. trace each area's outline along pixel edges and simplify it
 *
 * Outlines therefore follow the raster's pixels at that overview level: they
 * locate and size an area honestly, but are coarser than the raster itself.
 */

import { fromUrl } from 'geotiff';
import { COG_BASE_URL } from '../config';

const R = 6378137;                 // Web Mercator sphere
const MAX_DIM = 1400;              // overview level to read, in pixels
const MIN_PIXELS = 3;              // smaller groups are speckle, not places
const MAX_RING_POINTS = 200;       // mapActions caps drawn rings at this

const toLonLat = (x, y) => [
  (x / R) * (180 / Math.PI),
  (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI),
];

/**
 * What each layer highlights: its COG, which bands to read, and which pixels
 * count. `year` is required where the raster is per year.
 */
export const FINDER_LAYERS = {
  fire: {
    noun: 'burned area',
    prefix: 'wildfire-v3',
    url: ({ region, year }) => `${COG_BASE_URL}/cogs/wildfire-v3/${region}_${year}.tif`,
    needsYear: true,
    bands: [0],
    match: ([v]) => v === 1,
  },
  harvest: {
    noun: 'harvest block (official inventory)',
    prefix: 'ari-ground-truth-v1',
    static: true,
    url: ({ region }) => `${COG_BASE_URL}/cogs/ari-ground-truth-v1/${region}.tif`,
    needsYear: true,
    bands: [0],
    // AR_YEAR: the year the stand was harvested
    match: ([v], { year }) => v === year,
  },
  ai_clearcut: {
    noun: 'AI-detected clearcut',
    prefix: 'clearcut-status-v2',
    url: ({ region, year }) => `${COG_BASE_URL}/cogs/clearcut-status-v2/${region}_${year}.tif`,
    needsYear: true,
    bands: [0, 1],
    // STATUS 1 provisional (kept only above minConfidence), 2/4 confirmed
    match: ([status, confidence], { minConfidence = 0, confirmedOnly = false }) => (
      status === 2 || status === 4 || (!confirmedOnly && status === 1 && confidence >= minConfidence)
    ),
  },
  habitat: {
    noun: 'core caribou habitat',
    prefix: 'caribou-fmu-v1',
    url: ({ region, year }) => `${COG_BASE_URL}/cogs/caribou-fmu-v1/${region}_${year}.tif`,
    needsYear: true,
    bands: [0],
    // Size classes 1-5; by default the patches of 500 ha and up (classes 3-5)
    match: ([v], { minClass = 3 }) => v >= minClass && v <= 5,
  },
  scars: {
    noun: 'logging scar',
    prefix: 'logging-scars-v1',
    static: true,
    url: ({ region }) => `${COG_BASE_URL}/cogs/logging-scars-v1/${region}.tif`,
    needsYear: false,
    bands: [0],
    // SCAR_COUNT: snapshots flagged; persistentOnly keeps 2+
    match: ([count], { persistentOnly = false }) => count !== 65535 && count >= (persistentOnly ? 2 : 1),
  },
};

// cogs/manifest.json (scripts/storage/generate-cog-manifest-vercel.js): which
// region (and year) each product exists for, so a finder over many FMUs only
// reads rasters that are there
let _manifest = null;
function loadManifest() {
  if (!_manifest) {
    _manifest = fetch(`${COG_BASE_URL}/cogs/manifest.json`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return _manifest;
}

/**
 * Of the given regions, those with this layer's raster (for the year, where
 * the raster is per year); plus every region that has it, for telling the
 * user where to look instead. null lists when the manifest can't be read.
 */
export async function layerAvailability(layerKey, regions, year) {
  const layer = FINDER_LAYERS[layerKey];
  const manifest = layer ? await loadManifest() : null;
  if (!manifest) return { available: null, everywhere: null };
  let everywhere;
  if (layer.static) {
    everywhere = manifest.static?.[layer.prefix] || [];
  } else {
    const byRegion = manifest.prefixes?.[layer.prefix] || {};
    everywhere = Object.keys(byRegion).filter((r) => !layer.needsYear || (byRegion[r] || []).includes(Number(year)));
  }
  return { available: regions.filter((r) => everywhere.includes(r)), everywhere };
}

/**
 * Which FMUs each highlight layer covers ({ layer: [region ids] }), from the
 * manifest, for telling the assistant where a finder can look. Per-year
 * layers count a region if it has any year. null if the manifest is missing.
 */
export async function finderCoverage() {
  const manifest = await loadManifest();
  if (!manifest) return null;
  return Object.fromEntries(Object.entries(FINDER_LAYERS).map(([key, layer]) => [
    key,
    (layer.static ? manifest.static?.[layer.prefix] : Object.keys(manifest.prefixes?.[layer.prefix] || {})) || [],
  ]));
}

const _levels = new Map();

/** The overview level closest to MAX_DIM across, with the raster's footprint. */
async function readLevel(url, bands) {
  const key = `${url}#${bands.join(',')}`;
  if (!_levels.has(key)) {
    _levels.set(key, (async () => {
      const tiff = await fromUrl(url);
      const base = await tiff.getImage(0);
      const [minX, minY, maxX, maxY] = base.getBoundingBox();
      const count = await tiff.getImageCount();
      const levels = [base];
      for (let i = 1; i < count; i++) {
        const img = await tiff.getImage(i);
        // eslint-disable-next-line no-bitwise
        if (!(img.fileDirectory.NewSubfileType & 4)) levels.push(img);   // skip mask images
      }
      // The most detailed level within MAX_DIM, else the smallest there is
      const dim = (img) => Math.max(img.getWidth(), img.getHeight());
      const fits = levels.filter((img) => dim(img) <= MAX_DIM).sort((a, b) => dim(b) - dim(a));
      const pick = fits[0] || levels.sort((a, b) => dim(a) - dim(b))[0];
      const width = pick.getWidth();
      const height = pick.getHeight();
      const data = await pick.readRasters({ samples: bands, interleave: false });
      return { width, height, data, minX, maxY, px: (maxX - minX) / width, py: (maxY - minY) / height };
    })().catch((err) => {
      _levels.delete(key);
      throw err;
    }));
  }
  return _levels.get(key);
}

/** Connected (8-neighbour) groups of matching pixels, with area in hectares. */
function components(level, test) {
  const { width: W, height: H, minX, maxY, px, py } = level;
  const n = W * H;
  const labels = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  // Ground area of a pixel shrinks with latitude in Web Mercator: cos^2
  const rowHa = new Float64Array(H);
  for (let r = 0; r < H; r++) {
    const lat = toLonLat(minX, maxY - (r + 0.5) * py)[1] * (Math.PI / 180);
    rowHa[r] = (px * py * Math.cos(lat) ** 2) / 10000;
  }
  const comps = [];
  for (let start = 0; start < n; start++) {
    if (labels[start] !== -1 || !test(start)) continue;
    const id = comps.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = id;
    const comp = { id, pixels: 0, ha: 0, minR: H, maxR: 0, minC: W, maxC: 0 };
    while (head < tail) {
      const p = queue[head++];
      const r = (p / W) | 0;
      const c = p - r * W;
      comp.pixels += 1;
      comp.ha += rowHa[r];
      if (r < comp.minR) comp.minR = r;
      if (r > comp.maxR) comp.maxR = r;
      if (c < comp.minC) comp.minC = c;
      if (c > comp.maxC) comp.maxC = c;
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= H) continue;
        for (let dc = -1; dc <= 1; dc++) {
          const cc = c + dc;
          if ((dr || dc) && cc >= 0 && cc < W) {
            const q = rr * W + cc;
            if (labels[q] === -1 && test(q)) {
              labels[q] = id;
              queue[tail++] = q;
            }
          }
        }
      }
    }
    comps.push(comp);
  }
  return { comps, labels };
}

/**
 * The outer outline of one group, along pixel edges: every edge between a
 * group pixel and a non-group pixel, chained into rings; the longest ring is
 * the outside (the others are holes, left out of a highlight).
 */
function outline(level, labels, comp) {
  const W = level.width;
  const inside = (r, c) => r >= 0 && c >= 0 && r < level.height && c < W && labels[r * W + c] === comp.id;
  const K = W + 1;                         // corner key = r * K + c
  const next = new Map();
  const add = (a, b) => {
    if (!next.has(a)) next.set(a, []);
    next.get(a).push(b);
  };
  for (let r = comp.minR; r <= comp.maxR; r++) {
    for (let c = comp.minC; c <= comp.maxC; c++) {
      if (!inside(r, c)) continue;
      // clockwise around each pixel, keeping only edges on the group's border
      if (!inside(r - 1, c)) add(r * K + c, r * K + c + 1);
      if (!inside(r, c + 1)) add(r * K + c + 1, (r + 1) * K + c + 1);
      if (!inside(r + 1, c)) add((r + 1) * K + c + 1, (r + 1) * K + c);
      if (!inside(r, c - 1)) add((r + 1) * K + c, r * K + c);
    }
  }
  let best = [];
  while (next.size) {
    const [start] = next.keys();
    const ring = [];
    let cur = start;
    for (let guard = 0; guard < 4e6; guard++) {
      ring.push(cur);
      const outs = next.get(cur);
      if (!outs) break;
      const to = outs.pop();
      if (!outs.length) next.delete(cur);
      cur = to;
      if (cur === start) break;
    }
    if (ring.length > best.length) best = ring;
  }
  const pts = best.map((k) => [k % K, Math.floor(k / K)]);   // [col, row] corners
  return simplify(pts).map(([c, r]) => toLonLat(level.minX + c * level.px, level.maxY - r * level.py));
}

/** Douglas-Peucker in pixel units, loosened until the ring fits MAX_RING_POINTS. */
function simplify(pts) {
  if (pts.length <= 4) return pts.concat([pts[0]]);
  const dp = (tol) => {
    const keep = new Uint8Array(pts.length);
    keep[0] = 1;
    keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      const [x1, y1] = pts[a];
      const [x2, y2] = pts[b];
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      let worst = -1;
      let dmax = tol;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / len;
        if (d > dmax) { dmax = d; worst = i; }
      }
      if (worst > 0) {
        keep[worst] = 1;
        stack.push([a, worst], [worst, b]);
      }
    }
    return pts.filter((_, i) => keep[i]);
  };
  let tol = 0.6;
  let out = dp(tol);
  while (out.length > MAX_RING_POINTS - 1 && tol < 64) {
    tol *= 1.6;
    out = dp(tol);
  }
  return out.length >= 3 ? out.concat([out[0]]) : pts.slice(0, 4).concat([pts[0]]);
}

/**
 * The largest areas of a layer in one region (and year), as outlines.
 *
 * @param {object} q  { layer, region, year?, count?, minAreaHa?, ...layer options }
 * @returns {Promise<{ found: Array<{ ring, ha }>, error?: string }>}
 */
export async function findInCog(q) {
  const layer = FINDER_LAYERS[q.layer];
  if (!layer) return { found: [], error: `unknown layer "${q.layer}"` };
  const year = Number(q.year);
  if (layer.needsYear && !Number.isFinite(year)) return { found: [], error: `${layer.noun} needs a year` };
  let level;
  try {
    level = await readLevel(layer.url({ region: q.region, year }), layer.bands);
  } catch {
    return { found: [], error: `no ${layer.noun} raster published for ${q.region}${layer.needsYear ? ` ${year}` : ''}` };
  }
  const opts = { ...q, year };
  const values = new Array(layer.bands.length);
  const test = (i) => {
    for (let b = 0; b < layer.bands.length; b++) values[b] = level.data[b][i];
    return layer.match(values, opts);
  };
  const { comps, labels } = components(level, test);
  const count = Math.min(Math.max(Number(q.count) || 5, 1), 25);
  const minHa = Number(q.minAreaHa) > 0 ? Number(q.minAreaHa) : 0;
  const top = comps
    .filter((c) => c.pixels >= MIN_PIXELS && c.ha >= minHa)
    .sort((a, b) => b.ha - a.ha)
    .slice(0, count);
  return {
    found: top.map((c) => ({ ring: outline(level, labels, c), ha: c.ha })),
    noun: layer.noun,
  };
}
