#!/usr/bin/env node
/**
 * Builds client/public/data/loggingscars-sites.geojson: the field sites of
 * Wildlands League's logging-scars study (https://loggingscars.ca), from the
 * "Boreal Logging Scars" Google My Map, for the Logging Scars overlay.
 *
 * Each site is a point where roads and landings from clearcut logging left
 * productive forest barren (two groups: selected sample sites and candidate
 * study sites). Kept as a static project file, so the app never calls Google:
 * re-run this script to refresh it.
 *
 *   node scripts/data/build-loggingscars-sites.js [analysis.json] [--overlay <csv>] [--reuse]
 *
 * analysis.json (optional): output of scripts/analysis/loggingscars-scanfi.mjs.
 * When given, each site gets its SCANFI biomass/age and the file carries the
 * site-vs-control summary the panel shows.
 *
 * --overlay: boreal-canada-mapping's wildlands_sites_scar_overlay.csv, which
 * reads our logging-scar raster within 150 m of each site. Each site gets a
 * `scarCheck` and the file a `summary.scarOverlay`. The raster only judges
 * stands with a 2002-2010 harvest record, so this describes what the layer
 * can say about each site; it does not confirm or rate the sites.
 * --reuse: keep the sites already in the output file instead of downloading
 * the map again (to re-merge an overlay or analysis).
 *
 * Needs the FMU boundaries in client/public/data/regions/ (gitignored; see the
 * repo README) to tag each site with its FMU.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MAP_ID = '1t9RkBTUGQqaPMjJ5IayLY8o66HNNVhCR';
const KML_URL = `https://www.google.com/maps/d/kml?mid=${MAP_ID}&forcekml=1`;
const OUT = path.join(ROOT, 'client', 'public', 'data', 'loggingscars-sites.geojson');

function parseKml(kml) {
  const features = [];
  for (const folder of kml.split('<Folder>').slice(1)) {
    const group = (folder.match(/<name>([^<]*)<\/name>/) || [])[1] || '';
    for (const pm of folder.split('<Placemark>').slice(1)) {
      const name = ((pm.match(/<name>([^<]*)<\/name>/) || [])[1] || '').trim();
      const photo = (pm.match(/gx_media_links">\s*<value>([^<]*)<\/value>/) || [])[1] || null;
      const coords = (pm.match(/<coordinates>\s*([^<]*)<\/coordinates>/) || [])[1];
      if (!coords) continue;
      const [lon, lat] = coords.trim().split(',').map(Number);
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5] },
        properties: {
          name,
          group: /selected/i.test(group) ? 'selected' : 'candidate',
          photo,
        },
      });
    }
  }
  return features;
}

const inRing = (pt, ring) => {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi)) ins = !ins;
  }
  return ins;
};

function loadFmus() {
  const idxFile = path.join(ROOT, 'client', 'public', 'data', 'regions', 'ontario-index.json');
  if (!fs.existsSync(idxFile)) return [];
  const idx = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
  return idx.areas.map((a) => {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'client', 'public', a.file), 'utf8'));
    const feats = j.type === 'FeatureCollection' ? j.features : [j];
    const polys = feats.flatMap((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates));
    return { id: a.id, name: a.name.replace(/ Forest$/, ''), polys };
  });
}

// Flag rate within 150 m of random points in the same FMUs, from the
// boreal-canada-mapping handoff (2026-10-20); the CSV covers the sites only.
const RANDOM_POINT_FLAGGED = [84, 88];

const SCAR_CHECK = {
  'no AR clearcut within 150 m': 'no-record',
  'only CC after 2010 (too young)': 'too-young',
  'CC 2002-2010 but cohort too small': 'cohort-small',
};

function parseCsv(text) {
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const cols = head.split(',');
  return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
}

function mergeOverlay(features, csvFile) {
  const rows = parseCsv(fs.readFileSync(csvFile, 'utf8'));
  const counts = { 'no-record': 0, 'too-young': 0, 'cohort-small': 0, flagged: 0, 'not-flagged': 0, outside: 0 };
  features.forEach((f) => {
    const [lon, lat] = f.geometry.coordinates;
    const row = rows.find((r) => r.name === f.properties.name
      && Math.abs(Number(r.lon) - lon) < 1e-3 && Math.abs(Number(r.lat) - lat) < 1e-3);
    let check = 'outside';
    if (row && row.raster_fmu) {
      if (row.judgeable === 'True') check = row.flagged === 'True' ? 'flagged' : 'not-flagged';
      else check = SCAR_CHECK[row.why] || 'no-record';
    }
    f.properties.scarCheck = check;
    counts[check] += 1;
  });
  const judgeable = counts.flagged + counts['not-flagged'];
  return {
    radiusM: 150,
    sites: features.length,
    judgeable,
    flagged: counts.flagged,
    noRecord: counts['no-record'],
    tooYoung: counts['too-young'],
    cohortSmall: counts['cohort-small'],
    outside: counts.outside,
    randomFlaggedPct: RANDOM_POINT_FLAGGED,
  };
}

(async () => {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(name);
    if (i < 0) return null;
    const [, value] = args.splice(i, 2);
    return value ?? true;
  };
  const overlayFile = flag('--overlay');
  const reuse = args.includes('--reuse');
  const positional = args.filter((a) => !a.startsWith('--'));

  let features;
  let previous = null;
  if (reuse && fs.existsSync(OUT)) {
    previous = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    ({ features } = previous);
  } else {
    const res = await fetch(KML_URL);
    if (!res.ok) throw new Error(`KML download failed: HTTP ${res.status}`);
    features = parseKml(await res.text());
  }

  const fmus = loadFmus();
  features.forEach((f) => {
    const hit = fmus.find((m) => m.polys.some((p) => inRing(f.geometry.coordinates, p[0])));
    f.properties.fmu = hit ? hit.id : null;
    f.properties.fmuName = hit ? hit.name : null;
  });

  let summary = previous?.summary || null;
  const [analysisFile] = positional;
  if (analysisFile) {
    const a = JSON.parse(fs.readFileSync(analysisFile, 'utf8'));
    const byName = new Map(a.siteValues.map((v) => [`${v.name}|${v.lon}|${v.lat}`, v]));
    features.forEach((f) => {
      const v = byName.get(`${f.properties.name}|${f.geometry.coordinates[0]}|${f.geometry.coordinates[1]}`)
        || a.siteValues.find((s) => s.name === f.properties.name
          && Math.abs(s.lon - f.geometry.coordinates[0]) < 1e-4 && Math.abs(s.lat - f.geometry.coordinates[1]) < 1e-4);
      if (!v) return;
      for (const y of [2015, 2020, 2025]) {
        f.properties[`biomass${y}`] = v[`biomass${y}`] ?? null;
        f.properties[`age${y}`] = v[`age${y}`] ?? null;
      }
    });
    summary = { ...summary, generatedAt: a.generatedAt, fmus: a.fmus, controlsPerFmu: a.controlsPerFmu, byYear: a.byYear };
  }
  if (overlayFile) summary = { ...summary, scarOverlay: mergeOverlay(features, overlayFile) };

  const out = {
    type: 'FeatureCollection',
    source: 'Wildlands League, Boreal Logging Scars (loggingscars.ca); map by Samantha Zabudsky and Clare Wark',
    sourceUrl: 'https://loggingscars.ca',
    summary,
    features,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(out)}\n`);
  const inFmu = features.filter((f) => f.properties.fmu).length;
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${features.length} sites (${inFmu} inside an FMU), ${Math.round(fs.statSync(OUT).size / 1024)} KB${summary ? ', with SCANFI summary' : ''}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
