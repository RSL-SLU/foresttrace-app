const fs = require('fs');
const path = require('path');
const { getCollection, getMongoUri } = require('./_db');

/**
 * The facts a story map may use, gathered on the server from the app's own
 * data -- never from the model. Three products:
 *
 *   datasets  chartable series ({ id, title, unit, labels, values, source });
 *             every chart in a story is drawn from one of these by id
 *   places    things the story's map can focus on (an FMU, a clearcut patch,
 *             an alert, the user's drawn area), each with a bbox
 *   layers    GeoJSON for the story's map (boundaries, patches, alerts)
 *
 * The model sees datasets and places as compact JSON and refers to them by
 * id; the renderer looks the ids up, so a chart or map focus can only ever
 * show real data.
 */

// Committed with the app, so a static require bundles them into the function.
const clearcutStats = require('../client/public/data/clearcut_stats.json');
const wildfireStats = require('../client/public/data/wildfire_stats.json');
const caribouStats = require('../client/public/data/caribou_stats.json');

const CARIBOU_RANGE_IDS = new Set([
  'berens', 'brightsand', 'churchill', 'kesagami', 'nipigon', 'pagwachuan', 'sydney',
]);
let _caribouRangesGeoJson = null;
async function loadCaribouRange(rangeId) {
  if (!_caribouRangesGeoJson) {
    _caribouRangesGeoJson = await loadDataFile('data/caribou_ranges.geojson');
  }
  if (!_caribouRangesGeoJson?.features) return null;
  const wanted = String(rangeId || '').toLowerCase();
  return _caribouRangesGeoJson.features.find(
    (f) => String(f.properties?.RANGE_NAME || '').toLowerCase() === wanted
  );
}

const ROOT = path.resolve(__dirname, '..');
const DAY = 24 * 60 * 60 * 1000;
// AI stories cap the areas they write about (prompt size); framework stories
// take every selected area. Map rasters stop at MAP_LAYER_REGIONS areas so an
// all-of-Ontario story doesn't open a hundred COGs at once.
const MAX_REGIONS = 6;
const MAP_LAYER_REGIONS = 12;

// Boundaries and patches are gitignored: on disk in development, on Vercel
// Blob in production (same paths -- see scripts/storage/upload-data-vercel.js).
async function loadDataFile(rel) {
  const local = path.join(ROOT, 'client', 'public', rel);
  try {
    return JSON.parse(await fs.promises.readFile(local, 'utf8'));
  } catch { /* not local -- try the store */ }
  // Any of these points at the same Blob store; COG_BASE_URL is the one
  // production is known to have, since the map's COG layers depend on it.
  const base = process.env.VERCEL_BLOB_BASE_URL
    || process.env.REACT_APP_DATA_BASE_URL
    || process.env.REACT_APP_COG_BASE_URL;
  if (!base) return null;
  try {
    const res = await fetch(`${base}/${rel}`, { signal: AbortSignal.timeout(5000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// cogs/manifest.json (scripts/storage/generate-cog-manifest-vercel.js), cached
// for a few minutes per instance. null when it can't be read.
const MANIFEST_TTL_MS = 5 * 60 * 1000;
let _manifest = null;
let _manifestAt = 0;
async function loadCogManifest(base) {
  if (_manifest && Date.now() - _manifestAt < MANIFEST_TTL_MS) return _manifest;
  try {
    const res = await fetch(`${base}/cogs/manifest.json`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    _manifest = await res.json();
    _manifestAt = Date.now();
    return _manifest;
  } catch {
    return null;
  }
}

/** Whether /cogs/<prefix>/<region>_<year>.tif is listed in the manifest. */
function cogExists(manifest, cogPath) {
  const m = cogPath.match(/^\/cogs\/([^/]+)\/([a-z0-9_]+)_(\d{4})\.tif$/);
  if (!m) return false;
  const [, prefix, region, year] = m;
  return (manifest.prefixes?.[prefix]?.[region] || []).includes(Number(year));
}

const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

function polygonsOf(geojson) {
  const features = geojson?.type === 'FeatureCollection' ? geojson.features : geojson ? [geojson] : [];
  return features.flatMap((f) => {
    const g = f?.geometry;
    if (g?.type === 'Polygon') return [g.coordinates];
    if (g?.type === 'MultiPolygon') return g.coordinates;
    return [];
  });
}

function bboxOf(geojson) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]);
      b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]);
    } else c.forEach(walk);
  };
  polygonsOf(geojson).forEach(walk);
  return Number.isFinite(b[0]) ? b.map((v) => round(v, 4)) : null;
}

// Spherical shoelace, outer rings only -- same as client/src/utils/regionArea.js
function areaHa(geojson) {
  const R = 6371000;
  let m2 = 0;
  for (const poly of polygonsOf(geojson)) {
    const ring = poly[0];
    let a = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[i + 1];
      a += ((x2 - x1) * Math.PI / 180) * (2 + Math.sin(y1 * Math.PI / 180) + Math.sin(y2 * Math.PI / 180));
    }
    m2 += Math.abs((a * R * R) / 2);
  }
  return m2 / 10000;
}

// Boundary files run to ~1 MB; a story map only needs the outline. Keep every
// nth vertex and 4 decimals (~10 m), enough at the zooms a story uses.
function simplify(geojson, step = 6) {
  const polys = polygonsOf(geojson).map((poly) => poly.map((ring) => {
    const kept = ring.filter((_, i) => i % step === 0 || i === ring.length - 1);
    return (kept.length >= 4 ? kept : ring).map(([x, y]) => [round(x, 4), round(y, 4)]);
  }));
  return { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: polys } };
}

// Where a region's name goes on the map: the centroid of its largest outer
// ring (planar; fine at FMU scale)
function labelPoint(geojson) {
  let best = null;
  for (const poly of polygonsOf(geojson)) {
    const ring = poly[0];
    let a = 0; let cx = 0; let cy = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[i + 1];
      const f = x1 * y2 - x2 * y1;
      a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
    }
    if (a && (!best || Math.abs(a) > best.a)) best = { a: Math.abs(a), pt: [round(cx / (3 * a), 4), round(cy / (3 * a), 4)] };
  }
  return best ? best.pt : null;
}

function series(byYear, pick = (v) => v) {
  if (!byYear) return null;
  const years = Object.keys(byYear).filter((y) => /^\d{4}$/.test(y)).sort();
  if (!years.length) return null;
  return { labels: years, values: years.map((y) => round(Number(pick(byYear[y])) || 0)) };
}

// Display names from the official FMU index ("Trout Lake", not "Troutlake"),
// without the trailing "Forest"; ids not in it fall back to title case.
// The index is gitignored like the boundaries, so it loads the same way
// (disk in development, Blob in production), once per instance.
let FMU_NAMES = null;
async function loadFmuNames() {
  if (FMU_NAMES) return;
  const index = await loadDataFile('data/regions/ontario-index.json');
  FMU_NAMES = Object.fromEntries((index?.areas || []).map((a) => [a.id, a.name.replace(/ Forest$/, '')]));
}
const titleCase = (id) => FMU_NAMES?.[id]
  || id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

async function regionFacts(region, year, alertsCol) {
  const name = titleCase(region);
  const datasets = [];
  const places = [];
  const layers = { boundary: null, patches: [], alerts: [] };
  const summary = { id: region, name };

  const isRange = CARIBOU_RANGE_IDS.has(region.toLowerCase());
  if (isRange) {
    const rangeFeature = await loadCaribouRange(region);
    if (rangeFeature) {
      summary.areaHa = Math.round(areaHa(rangeFeature));
      layers.boundary = simplify(rangeFeature);
      layers.boundary.properties = { regionId: region, name };
      summary.labelPoint = labelPoint(rangeFeature);
      places.push({ id: `range:${region}`, kind: 'range', label: `${name} Caribou Range`, bbox: bboxOf(rangeFeature) });
    }
  } else {
    const boundary = await loadDataFile(`data/regions/${region}.json`);
    if (boundary) {
      summary.areaHa = Math.round(areaHa(boundary));
      layers.boundary = simplify(boundary);
      layers.boundary.properties = { regionId: region, name };
      summary.labelPoint = labelPoint(boundary);
      places.push({ id: `fmu:${region}`, kind: 'fmu', label: `${name} Forest Management Unit`, bbox: bboxOf(boundary) });
    }
  }

  // Clearcut (AI model, HLS). "New" is the entering series: newly standing
  // clearcut each year, the only series that answers "how much was cut".
  const acc = series(clearcutStats[`${region}_hls`]);
  if (acc) {
    datasets.push({ id: `clearcut_accumulated:${region}`, title: `Standing clearcut area, ${name} (5-year window)`, unit: 'ha', ...acc, source: 'ForestTrace AI clearcut model (HLS)' });
  }
  const entering = series(clearcutStats[`${region}_hls_entering`]);
  // The series' first year is the baseline: with no earlier year to compare
  // against, everything in it counts as "new", which charts as a huge spike.
  if (entering && entering.labels.length > 1) {
    entering.labels = entering.labels.slice(1);
    entering.values = entering.values.slice(1);
  }
  if (entering) {
    datasets.push({ id: `clearcut_new:${region}`, title: `Newly detected clearcut area per year, ${name}`, unit: 'ha', ...entering, source: 'ForestTrace AI clearcut model (HLS)' });
  }
  const accuracy = clearcutStats[`${region}_hls_accuracy`];
  if (accuracy) {
    const f1 = series(accuracy, (v) => (v.f1 || 0) * 100);
    if (f1) datasets.push({ id: `clearcut_accuracy:${region}`, title: `Clearcut model accuracy (F1 score), ${name}`, unit: '%', ...f1, source: 'ForestTrace validation against held-out labels' });
  }

  const fire = series(wildfireStats[region], (v) => v.areaHa);
  if (fire) {
    datasets.push({ id: `wildfire_area:${region}`, title: `Area burned per year, ${name}`, unit: 'ha', ...fire, source: 'Canadian National Burned Area Composite (NBAC)' });
  }
  const fireYear = wildfireStats[region]?.[year];
  if (fireYear) {
    summary.wildfire = {
      year,
      areaHa: round(fireYear.areaHa),
      fires: fireYear.fires,
    };
  }

  if (isRange) {
    // Sum across FMUs overlapping this range
    const years = ['2015', '2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025'];
    const coreHaByYear = {};
    let inRangeHaTotal = 0;
    Object.entries(caribouStats).forEach(([fmuId, fmuYears]) => {
      const hasRange = Object.values(fmuYears).some((entry) =>
        (entry?.ranges || []).some((rng) => rng.toLowerCase() === region.toLowerCase())
      );
      if (hasRange) {
        years.forEach((yr) => {
          const entry = fmuYears[yr];
          if (entry?.coreHa) {
            coreHaByYear[yr] = (coreHaByYear[yr] || 0) + entry.coreHa;
          }
        });
        const currentEntry = fmuYears[String(year)] || fmuYears['2025'];
        if (currentEntry?.inRangeHa) {
          inRangeHaTotal += currentEntry.inRangeHa;
        }
      }
    });
    const caribou = series(coreHaByYear);
    if (caribou) {
      datasets.push({
        id: `caribou_core:${region}`,
        title: `Core caribou habitat, ${name} Range`,
        unit: 'ha',
        ...caribou,
        source: 'ForestTrace caribou habitat model (MSPA)',
      });
    }
    if (coreHaByYear[year]) {
      summary.caribou = {
        year,
        coreHa: round(coreHaByYear[year]),
        inRangeHa: round(inRangeHaTotal),
      };
    }
  } else {
    const caribou = series(caribouStats[region], (v) => v.coreHa);
    if (caribou) {
      datasets.push({ id: `caribou_core:${region}`, title: `Core caribou habitat, ${name}`, unit: 'ha', ...caribou, source: 'ForestTrace caribou habitat model' });
    }
    const caribouYear = caribouStats[region]?.[year];
    if (caribouYear) {
      summary.caribou = {
        year,
        coreHa: round(caribouYear.coreHa),
        inRangeHa: round(caribouYear.inRangeHa),
      };
    }
  }

  // The year's largest clearcut patches, as places the map can visit
  const patches = await loadDataFile(`data/patches/${region}_${year}.json`);
  if (patches?.features?.length) {
    const top = [...patches.features].sort((a, b) => (b.properties.areaHa || 0) - (a.properties.areaHa || 0));
    top.slice(0, 5).forEach((f, i) => {
      places.push({
        id: `patch:${region}:${i + 1}`, kind: 'clearcut_patch',
        label: `Clearcut patch of ${round(f.properties.areaHa)} ha (${year}), ${name}`,
        areaHa: round(f.properties.areaHa), bbox: bboxOf(f),
      });
    });
    layers.patches = top.slice(0, 60).map((f) => ({ type: 'Feature', properties: { areaHa: f.properties.areaHa }, geometry: f.geometry }));
    summary.clearcutPatches = { year, count: patches.features.length, largestHa: round(top[0].properties.areaHa) };
  }

  // Disturbance alerts (DIST-ALERT shaped; mock data is flagged as such)
  if (alertsCol) {
    const docs = await alertsCol.find({ region, firstDetected: { $gte: new Date(Date.now() - 180 * DAY) } })
      .sort({ firstDetected: -1 }).limit(500).toArray();
    if (docs.length) {
      const within = (d) => docs.filter((a) => Date.now() - a.firstDetected < d * DAY);
      summary.alerts = {
        last7Days: within(7).length,
        last30Days: within(30).length,
        last90Days: within(90).length,
        confirmed: docs.filter((a) => a.status === 'confirmed').length,
        areaHaLast30Days: round(within(30).reduce((s, a) => s + (a.areaHa || 0), 0)),
        demoData: docs.some((a) => a.mock),
      };
      // Alerts per month, oldest first
      const months = {};
      docs.forEach((a) => {
        const k = a.firstDetected.toISOString().slice(0, 7);
        months[k] = (months[k] || 0) + 1;
      });
      const labels = Object.keys(months).sort();
      datasets.push({ id: `alerts_monthly:${region}`, title: `Disturbance alerts per month, ${name}`, unit: 'alerts', labels, values: labels.map((k) => months[k]), source: summary.alerts.demoData ? 'NASA OPERA DIST-ALERT-HLS (demo data)' : 'NASA OPERA DIST-ALERT-HLS' });

      [...within(90)].sort((a, b) => b.areaHa - a.areaHa).slice(0, 5).forEach((a) => {
        places.push({
          id: `alert:${a.alertId}`, kind: 'alert',
          label: `${a.status === 'confirmed' ? 'Confirmed' : 'Provisional'} disturbance alert, ${round(a.areaHa)} ha, first detected ${a.firstDetected.toISOString().slice(0, 10)}`,
          areaHa: round(a.areaHa), bbox: bboxOf({ type: 'Feature', geometry: a.geometry }),
        });
      });
      layers.alerts = within(90).map((a) => ({ type: 'Feature', properties: { status: a.status, areaHa: a.areaHa }, geometry: a.geometry }));
    }
  }

  return { summary, datasets, places, layers };
}

// FMUs that can have a story over a range of years (one FMU at a time), and
// the years each has data for. Mirrored in client StoryMapGenerator.jsx.
const RANGE_STORY_YEARS = {
  wabigoon: [2010, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025],
  troutlake: [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025],
};

/** [from, to] when the request is a valid range for a single eligible FMU, else null. */
function parseYearRange(range, regions) {
  if (!Array.isArray(range) || range.length !== 2 || regions.length !== 1) return null;
  const years = RANGE_STORY_YEARS[regions[0]];
  const [from, to] = range.map(Number);
  if (!years || !years.includes(from) || !years.includes(to) || from >= to) return null;
  return [from, to];
}

/**
 * @param {object} ctx  from the client: { regions: string[], year, yearRange?,
 *                      module, activeLayers: [{module, layer, year}], drawing,
 *                      clearcutSources?, aiMinConfidence? }
 */
async function buildStoryFacts(ctx = {}, { maxRegions = MAX_REGIONS } = {}) {
  await loadFmuNames();
  const inputRegions = (Array.isArray(ctx.ranges) && ctx.ranges.length > 0)
    ? [...ctx.ranges, ...(Array.isArray(ctx.regions) ? ctx.regions : [])]
    : (Array.isArray(ctx.regions) ? ctx.regions : []);
  // With more than maxRegions selected, keep the ones that have data for the
  // modules on screen -- taking the first six alphabetically dropped Wabigoon
  // (the clearcut FMU) from a clearcut story with all of Ontario selected.
  const ctxText = [ctx.moduleId, ctx.module, ...(Array.isArray(ctx.activeLayers)
    ? ctx.activeLayers.map((l) => `${l.moduleId || ''} ${l.module || ''} ${l.layer || ''}`) : [])].join(' ');
  const wants = (re) => re.test(ctxText);
  const dataScore = (r) => (CARIBOU_RANGE_IDS.has(r) && Array.isArray(ctx.ranges) && ctx.ranges.includes(r) ? 8 : 0)
    + (wants(/clearcut/i) && clearcutStats[`${r}_hls`] ? 4 : 0)
    + (wants(/caribou|wildlife|species/i) && caribouStats[r] ? 2 : 0)
    + (wants(/wildfire|burned/i) && wildfireStats[r] ? 1 : 0);
  const regions = [...new Set(inputRegions.map((r) => String(r).toLowerCase().trim()))]
    .filter((r) => /^[a-z0-9_]+$/.test(r))
    .map((r, i) => ({ r, i, score: dataScore(r) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, maxRegions)
    .map(({ r }) => r);
  const yearRange = parseYearRange(ctx.yearRange, regions);
  // A range story is told as of its last year; layers cover every year in it
  const year = yearRange ? yearRange[1] : (Number(ctx.year) || new Date().getFullYear() - 1);
  const layerYears = yearRange
    ? RANGE_STORY_YEARS[regions[0]].filter((y) => y >= yearRange[0] && y <= yearRange[1])
    : [year];

  let alertsCol = null;
  if (getMongoUri()) {
    try { alertsCol = await getCollection('disturbance_alerts'); } catch { alertsCol = null; }
  }

  const perRegion = await Promise.all(regions.map((r) => regionFacts(r, year, alertsCol)));
  // Yearly series are trimmed to the range so the charts and the prose stay on
  // the period asked about; monthly series (alerts) are left as they are.
  const datasets = perRegion.flatMap((r) => r.datasets).map((d) => {
    if (!yearRange || !d.labels.every((l) => /^\d{4}$/.test(l))) return d;
    const keep = d.labels.map((l) => Number(l) >= yearRange[0] && Number(l) <= yearRange[1]);
    return { ...d, labels: d.labels.filter((_, i) => keep[i]), values: d.values.filter((_, i) => keep[i]) };
  }).filter((d) => d.labels.length > 0);
  const places = perRegion.flatMap((r) => r.places);

  const drawing = ctx.drawing;
  if (drawing?.shapes?.length && Number(drawing.totalAreaHa) > 0) {
    const pts = drawing.shapes.flatMap((s) => (s.outline || []).concat(s.centroid ? [s.centroid] : []));
    if (pts.length) {
      const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
      places.push({
        id: 'drawn:area', kind: 'drawn_area',
        label: `Area of interest drawn by the author (${round(Number(drawing.totalAreaHa))} ha)`,
        bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => round(v, 4)),
      });
    }
  }

  const activeLayers = Array.isArray(ctx.activeLayers) ? ctx.activeLayers : [];

  // Determine active layers and modules across activeLayers array and primary selection
  const hasWildfireLayer = activeLayers.some((l) =>
    l.moduleId === 'wildfire' || l.layerId === 'wildfire-burned' || /wildfire|burned/i.test(l.module || l.layer || '')
  );
  const isWildfirePrimary = ctx.moduleId === 'wildfire' || (ctx.module && /wildfire/i.test(ctx.module));
  const hasWildfire = Boolean(hasWildfireLayer || isWildfirePrimary);

  const hasCaribouLayer = activeLayers.some((l) =>
    l.moduleId === 'wildlife' || l.moduleId === 'caribou' || l.layerId === 'caribou-habitat'
    || /caribou|wildlife|species/i.test(l.module || l.layer || '')
  );
  const isCaribouPrimary = ctx.moduleId === 'wildlife' || ctx.moduleId === 'caribou'
    || /caribou|wildlife/i.test(ctx.module || '')
    || (Array.isArray(ctx.ranges) && ctx.ranges.length > 0)
    || regions.some((r) => CARIBOU_RANGE_IDS.has(r));
  const hasCaribou = Boolean(hasCaribouLayer || isCaribouPrimary);

  const hasClearcutAccumulated = activeLayers.some((l) =>
    l.layerId === 'clearcut-accumulated' || /accumulated/i.test(l.layer || '')
  );
  const hasClearcutAnnual = activeLayers.some((l) =>
    l.layerId === 'clearcut-annual' || /annual/i.test(l.layer || '')
  );
  const hasClearcutLayer = activeLayers.some((l) =>
    l.moduleId === 'clearcut' || /clearcut/i.test(l.module || l.layer || '')
  );
  const isClearcutPrimary = ctx.moduleId === 'clearcut' || (ctx.module && /clearcut/i.test(ctx.module));
  // Clearcut is active if explicitly chosen OR if no specific module/layers provided at all
  const hasClearcut = Boolean(
    hasClearcutLayer || isClearcutPrimary || hasClearcutAccumulated || hasClearcutAnnual
    || (!hasWildfire && !hasCaribou && activeLayers.length === 0)
  );

  const hasAlerts = Boolean(
    activeLayers.some((l) => l.moduleId === 'alerts' || /alert/i.test(l.module || l.layer || ''))
    || ctx.moduleId === 'alerts' || (ctx.module && /alert/i.test(ctx.module))
  );

  const blobBase = (
    process.env.VERCEL_BLOB_BASE_URL
    || process.env.REACT_APP_COG_BASE_URL
    || process.env.REACT_APP_DATA_BASE_URL
    || 'https://mljbssdjqong7yae.public.blob.vercel-storage.com'
  ).replace(/\/$/, '');

  const cogs = [];
  // Regions come ranked by data for the modules on screen (above)
  const mapRegions = regions.slice(0, MAP_LAYER_REGIONS);
  const span = yearRange ? `${yearRange[0]}–${yearRange[1]}` : String(year);
  const cogLayer = (r, y, prefix, extra) => ({
    id: `${extra.layerId}-${r}-${y}`,
    region: r,
    year: y,
    cogPath: `/cogs/${prefix}/${r}_${y}.tif`,
    url: `${blobBase}/cogs/${prefix}/${r}_${y}.tif`,
    ...extra,
  });

  // Clearcut rasters: the sources (official inventory / AI model) and the AI
  // confidence threshold are the ones set on the map. A range story draws the
  // annual layer of every year in the range, which together show all cuts in
  // the period; a single-year story draws what the map had on.
  if (hasClearcut) {
    const sources = Array.isArray(ctx.clearcutSources) ? ctx.clearcutSources : ['ari'];
    const minConfidence = Math.min(100, Math.max(0, Number(ctx.aiMinConfidence) || 0));
    const showAnnual = Boolean(yearRange) || hasClearcutAnnual;
    const showAccumulated = !yearRange && (hasClearcutAccumulated || !showAnnual);

    mapRegions.forEach((r) => {
      if (sources.includes('ari')) {
        if (showAccumulated) {
          cogs.push(cogLayer(r, year, 'clearcut-accumulated-ari', {
            layerId: 'clearcut-accumulated', name: `Standing clearcut (${year})`,
            color: '#d97706', opacity: 0.65, paletteType: 'clearcut',
          }));
        }
        if (showAnnual) {
          layerYears.forEach((y) => cogs.push(cogLayer(r, y, 'clearcut-annual-ari', {
            layerId: 'clearcut-annual', name: `Annual clearcut (${y})`,
            color: '#dc2626', opacity: 0.75, paletteType: 'clearcut-annual',
          })));
        }
      }
      if (sources.includes('ml')) {
        if (showAccumulated) {
          cogs.push(cogLayer(r, year, 'clearcut-status-acc-v2', {
            layerId: 'clearcut-ml-accumulated', name: `AI clearcut estimate, 5-year window (${year})`,
            opacity: 0.85, paletteType: 'ai-status', minConfidence, viewYear: year,
          }));
        }
        if (showAnnual) {
          // Status as known at the story's last year, as the map would show it then
          layerYears.forEach((y) => cogs.push(cogLayer(r, y, 'clearcut-status-v2', {
            layerId: 'clearcut-ml-annual', name: `AI clearcut estimate (${y})`,
            opacity: 0.85, paletteType: 'ai-status', minConfidence, viewYear: year,
          })));
        }
      }
    });
  }

  // Wildfire burned raster
  if (hasWildfire) {
    mapRegions.forEach((r) => layerYears.forEach((y) => cogs.push(cogLayer(r, y, 'wildfire-v3', {
      layerId: 'wildfire-burned', name: `Wildfire burned area (${y})`,
      color: '#facc15', opacity: 0.8, paletteType: 'wildfire',
    }))));
  }

  // Caribou habitat raster: habitat is a state, not an event, so one year --
  // the last -- even in a range story. Same ramp as the web app: viridis on
  // its own, single-hue teal alongside other modules (caribouClasses.js).
  const moduleCount = [hasClearcut, hasWildfire, hasCaribou, hasAlerts].filter(Boolean).length;
  const caribouLayer = (r, y, id) => {
    const isRange = CARIBOU_RANGE_IDS.has(r);
    return cogLayer(r, y, isRange ? 'caribou-v1' : 'caribou-fmu-v1', {
      layerId: id || 'caribou-habitat',
      name: isRange ? `Caribou habitat (${titleCase(r)} Range)` : `Caribou habitat (${titleCase(r)})`,
      color: '#21918c', opacity: 0.8, paletteType: 'caribou', singleHue: moduleCount > 1,
    });
  };
  if (hasCaribou) mapRegions.forEach((r) => cogs.push(caribouLayer(r, year)));

  // Only rasters that exist: a story listed every region x year, and each
  // missing COG fell back to a PNG pyramid of 404s.
  const manifest = await loadCogManifest(blobBase);
  const existingCogs = manifest ? cogs.filter((c) => cogExists(manifest, c.cogPath)) : cogs;

  const hasRange = regions.some((r) => CARIBOU_RANGE_IDS.has(r));

  // One place framing every selected area, for overview steps
  if (regions.length > 1) {
    const boxes = places.filter((p) => p.kind === 'fmu' || p.kind === 'range').map((p) => p.bbox).filter(Boolean);
    if (boxes.length > 1) {
      places.unshift({
        id: 'area:all', kind: 'overview', label: 'All selected areas',
        bbox: [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])),
          Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))],
      });
    }
  }

  // Before/after pairs for the compare slider: the same place in two years,
  // from rasters the manifest lists. The story framework picks which to show.
  const compares = [];
  const yearsOf = (prefix, r) => (manifest?.prefixes?.[prefix]?.[r] || []).slice().sort((a, b) => a - b);
  const atOrBefore = (list, y) => [...list].reverse().find((v) => v <= y);
  const from = yearRange ? yearRange[0] : year - 5;
  const placeOf = (r) => (places.find((p) => p.id === `fmu:${r}` || p.id === `range:${r}`) || {}).id;
  if (manifest) {
    mapRegions.forEach((r) => {
      if (hasClearcut) {
        const sources = Array.isArray(ctx.clearcutSources) ? ctx.clearcutSources : ['ari'];
        const ari = sources.includes('ari');
        const prefix = ari ? 'clearcut-accumulated-ari' : 'clearcut-status-acc-v2';
        const list = yearsOf(prefix, r);
        const after = atOrBefore(list, year);
        const before = atOrBefore(list, from) ?? list.find((v) => v >= from);
        if (before && after && before < after) {
          const side = (y) => ({ year: y, label: String(y), cog: cogLayer(r, y, prefix, ari
            ? { layerId: 'cmp-clearcut', color: '#d97706', opacity: 0.8, paletteType: 'clearcut' }
            : { layerId: 'cmp-clearcut', opacity: 0.85, paletteType: 'ai-status', viewYear: y,
              minConfidence: Math.min(100, Math.max(0, Number(ctx.aiMinConfidence) || 0)) }) });
          compares.push({
            id: `compare:clearcut:${r}`, topic: 'clearcut', region: r, placeId: placeOf(r),
            title: `Standing clearcut, ${before} and ${after}`,
            caption: `Clearcuts still open within each year's five-year window (${ari ? 'official harvest inventory' : 'AI estimates'}). Drag the divider on the map to compare.`,
            left: side(before), right: side(after),
          });
        }
      }
      if (hasCaribou) {
        const isRange = CARIBOU_RANGE_IDS.has(r);
        const list = yearsOf(isRange ? 'caribou-v1' : 'caribou-fmu-v1', r);
        const after = atOrBefore(list, year);
        const before = (yearRange ? atOrBefore(list, yearRange[0]) : null) ?? list[0];
        if (before && after && before < after) {
          compares.push({
            id: `compare:habitat:${r}`, topic: 'habitat', region: r, placeId: placeOf(r),
            title: `Core caribou habitat, ${before} and ${after}`,
            caption: 'Core habitat patches in each year; darker or brighter shades are larger patches. Drag the divider on the map to compare.',
            left: { year: before, label: String(before), cog: caribouLayer(r, before, 'cmp-habitat') },
            right: { year: after, label: String(after), cog: caribouLayer(r, after, 'cmp-habitat') },
          });
        }
      }
      if (hasWildfire) {
        // The worst fire year in the story's period that has a raster, from
        // 2018 on: yearly imagery starts in 2016 with a gap in 2017, so only
        // then does the "before" side show the ground before the fire
        const fireYears = yearsOf('wildfire-v3', r).filter((y) => y >= 2018 && y <= year && (!yearRange || y >= yearRange[0]));
        const peak = fireYears
          .map((y) => ({ y, ha: wildfireStats[r]?.[y]?.areaHa || 0 }))
          .sort((a, b) => b.ha - a.ha)[0];
        if (peak && peak.ha > 0) {
          compares.push({
            id: `compare:fire:${r}`, topic: 'fire', region: r, placeId: placeOf(r),
            title: `Before and after the ${peak.y} fires`,
            caption: `Left: satellite imagery from before the fire. Right: imagery from after it, with the area burned in ${peak.y} (NBAC). Drag the divider on the map to compare.`,
            left: { year: peak.y - 1, label: 'Before', cog: null },
            right: { year: peak.y, label: String(peak.y), cog: cogLayer(r, peak.y, 'wildfire-v3', {
              layerId: 'cmp-fire', color: '#facc15', opacity: 0.85, paletteType: 'wildfire',
            }) },
          });
        }
      }
    });
  }

  const activeModuleNames = [];
  if (hasClearcut) activeModuleNames.push('Clearcut Detection');
  if (hasWildfire) activeModuleNames.push('Wildfire');
  if (hasCaribou) activeModuleNames.push('Caribou Habitat');
  if (hasAlerts) activeModuleNames.push('Disturbance Alerts');

  const combinedModuleName = activeModuleNames.length > 1
    ? activeModuleNames.join(' & ')
    : (activeModuleNames[0] || ctx.module || 'Clearcut Detection');

  return {
    year,
    yearRange,
    span,
    clearcutSources: hasClearcut ? (Array.isArray(ctx.clearcutSources) ? ctx.clearcutSources : ['ari']) : undefined,
    aiMinConfidence: hasClearcut && Array.isArray(ctx.clearcutSources) && ctx.clearcutSources.includes('ml')
      ? Math.min(100, Math.max(0, Number(ctx.aiMinConfidence) || 0)) : undefined,
    module: combinedModuleName,
    moduleId: ctx.moduleId || (activeModuleNames.length === 1 ? (hasWildfire ? 'wildfire' : hasCaribou ? 'wildlife' : 'clearcut') : 'multi'),
    isWildfire: hasWildfire,
    isClearcut: hasClearcut,
    hasCaribou,
    hasRange,
    hasAlerts,
    activeModules: activeModuleNames,
    activeLayers: activeLayers.slice(0, 12),
    regions: perRegion.map((r) => r.summary),
    datasets,
    places,
    layers: {
      boundaries: perRegion.map((r) => r.layers.boundary).filter(Boolean),
      patches: hasClearcut ? perRegion.flatMap((r) => r.layers.patches) : [],
      alerts: perRegion.flatMap((r) => r.layers.alerts),
      cogs: existingCogs,
    },
    compares,
  };
}

module.exports = { buildStoryFacts };
