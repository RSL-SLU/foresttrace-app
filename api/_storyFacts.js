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
const MAX_REGIONS = 6;

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

function series(byYear, pick = (v) => v) {
  if (!byYear) return null;
  const years = Object.keys(byYear).filter((y) => /^\d{4}$/.test(y)).sort();
  if (!years.length) return null;
  return { labels: years, values: years.map((y) => round(Number(pick(byYear[y])) || 0)) };
}

const titleCase = (id) => id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

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
      places.push({ id: `range:${region}`, kind: 'range', label: `${name} Caribou Range`, bbox: bboxOf(rangeFeature) });
    }
  } else {
    const boundary = await loadDataFile(`data/regions/${region}.json`);
    if (boundary) {
      summary.areaHa = Math.round(areaHa(boundary));
      layers.boundary = simplify(boundary);
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

/**
 * @param {object} ctx  from the client: { regions: string[], year, module,
 *                      activeLayers: [{module, layer, year}], drawing }
 */
async function buildStoryFacts(ctx = {}) {
  const inputRegions = (Array.isArray(ctx.ranges) && ctx.ranges.length > 0)
    ? [...ctx.ranges, ...(Array.isArray(ctx.regions) ? ctx.regions : [])]
    : (Array.isArray(ctx.regions) ? ctx.regions : []);
  // With more than MAX_REGIONS selected, keep the ones that have data for the
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
    .slice(0, MAX_REGIONS)
    .map(({ r }) => r);
  const year = Number(ctx.year) || new Date().getFullYear() - 1;

  let alertsCol = null;
  if (getMongoUri()) {
    try { alertsCol = await getCollection('disturbance_alerts'); } catch { alertsCol = null; }
  }

  const perRegion = await Promise.all(regions.map((r) => regionFacts(r, year, alertsCol)));
  const datasets = perRegion.flatMap((r) => r.datasets);
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

  // Clearcut rasters (accumulated and/or annual)
  if (hasClearcut) {
    const showAnnual = hasClearcutAnnual;
    const showAccumulated = hasClearcutAccumulated || !showAnnual;

    if (showAccumulated) {
      regions.forEach((r) => {
        cogs.push({
          id: `clearcut-accumulated-${r}-${year}`,
          layerId: 'clearcut-accumulated',
          name: `Standing clearcut (${year})`,
          region: r,
          year,
          cogPath: `/cogs/clearcut-accumulated-ari/${r}_${year}.tif`,
          tilePath: `/tiles/clearcut/${r}_${year}/{z}/{x}/{y}.png`,
          url: `${blobBase}/cogs/clearcut-accumulated-ari/${r}_${year}.tif`,
          tileUrl: `${blobBase}/tiles/clearcut/${r}_${year}/{z}/{x}/{y}.png`,
          color: '#d97706',
          opacity: 0.65,
          paletteType: 'clearcut',
        });
      });
    }

    if (showAnnual) {
      regions.forEach((r) => {
        cogs.push({
          id: `clearcut-annual-${r}-${year}`,
          layerId: 'clearcut-annual',
          name: `Annual clearcut (${year})`,
          region: r,
          year,
          cogPath: `/cogs/clearcut-annual-ari/${r}_${year}.tif`,
          tilePath: `/tiles/clearcut-annual-ari/${r}_${year}/{z}/{x}/{y}.png`,
          url: `${blobBase}/cogs/clearcut-annual-ari/${r}_${year}.tif`,
          tileUrl: `${blobBase}/tiles/clearcut-annual-ari/${r}_${year}/{z}/{x}/{y}.png`,
          color: '#dc2626',
          opacity: 0.75,
          paletteType: 'clearcut-annual',
        });
      });
    }
  }

  // Wildfire burned raster
  if (hasWildfire) {
    regions.forEach((r) => {
      cogs.push({
        id: `wildfire-${r}-${year}`,
        layerId: 'wildfire-burned',
        name: `Wildfire burned area (${year})`,
        region: r,
        year,
        cogPath: `/cogs/wildfire-v3/${r}_${year}.tif`,
        tilePath: `/tiles/wildfire/${r}_${year}/{z}/{x}/{y}.png`,
        url: `${blobBase}/cogs/wildfire-v3/${r}_${year}.tif`,
        tileUrl: `${blobBase}/tiles/wildfire/${r}_${year}/{z}/{x}/{y}.png`,
        color: '#FF7F00',
        opacity: 0.75,
        paletteType: 'wildfire',
      });
    });
  }

  // Caribou habitat raster
  if (hasCaribou) {
    regions.forEach((r) => {
      const isRange = CARIBOU_RANGE_IDS.has(r);
      const prefix = isRange ? 'caribou-v1' : 'caribou-fmu-v1';
      const cogPath = `/cogs/${prefix}/${r}_${year}.tif`;
      const tilePath = isRange
        ? `/tiles/wildlife/caribou-range/${r}_${year}/{z}/{x}/{y}.png`
        : `/tiles/wildlife/caribou/${r}_${year}/{z}/{x}/{y}.png`;
      cogs.push({
        id: `caribou-${r}-${year}`,
        layerId: 'caribou-habitat',
        name: isRange ? `Caribou habitat (${titleCase(r)} Range)` : `Caribou habitat (${titleCase(r)})`,
        region: r,
        year,
        cogPath,
        tilePath,
        url: `${blobBase}${cogPath}`,
        tileUrl: `${blobBase}${tilePath}`,
        color: '#21918c',
        opacity: 0.65,
        paletteType: 'caribou',
      });
    });
  }

  const hasRange = regions.some((r) => CARIBOU_RANGE_IDS.has(r));

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
      cogs,
    },
  };
}

module.exports = { buildStoryFacts };
