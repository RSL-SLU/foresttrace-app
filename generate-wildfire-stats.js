'use strict';

/**
 * Builds client/public/data/wildfire_stats.json — burned area per region/year:
 *
 *   { "kenora": { "2011": { "areaHa": 1234.5, "fires": 7 }, ... } }
 *
 * Source is the tiler's own plan CSV (region, year, n_fires, area_ha, ...),
 * whose areas come from the NBAC source vectors. That is more accurate than
 * counting pixels in the rendered tiles, which are quantised to the zoom-14
 * grid.
 *
 * The CSV still uses the pre-rename region names, so the same normalisation
 * and merges applied to the tile folders are applied here — otherwise the
 * chart would key on names the app never asks for.
 *
 * Usage:
 *   node generate-wildfire-stats.js [planCsv]
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_PLAN_CSV = 'F:/forest_data_curation/nbac_tiling/output/tiling_plan.csv';
const OUT_FILE = path.join(__dirname, 'client', 'public', 'data', 'wildfire_stats.json');

// Regions that were merged when the tile folders were renamed. Areas and fire
// counts are summed for the target FMU.
const EXPLICIT_MERGES = {
  big_pic_forest: 'pic',
  pic_river_forest: 'pic',
  magpie_forest: 'missinaibi',
  martel_forest: 'missinaibi',
  crossroute_forest: 'boundarywaters',
};

// FMU ids the app can actually select (FMUSelector.jsx). Only regions that
// normalise onto one of these were renamed on disk.
const APP_FMU_IDS = new Set([
  'abitibiriver', 'algoma', 'algonquinpark', 'bancroftminden', 'blackspruce',
  'boundarywaters', 'caribou', 'dogrivermatawin', 'dryden', 'englishriver',
  'frenchsevern', 'gordoncosens', 'hearst', 'kenogami', 'kenora', 'lacseul',
  'lakehead', 'lakenipigon', 'mazinawlanark', 'missinaibi', 'nagagami',
  'nipissing', 'northshore', 'ogoki', 'ottawavalley', 'pic', 'pineland',
  'redlake', 'romeomalette', 'spanish', 'sudbury', 'temagami', 'timiskaming',
  'troutlake', 'wabadowgangnoopming', 'wabigoon', 'whiskeyjack', 'whitefeather',
  'whiteriver',
]);

// Follows the folder-rename rule: drop separators, drop the trailing "forest".
// Regions with no app FMU were left alone on disk, so they keep their raw name
// here too — otherwise this file and wildfire_years.json would key differently
// for the same region.
function toFmuId(region) {
  if (EXPLICIT_MERGES[region]) return EXPLICIT_MERGES[region];
  const normalised = region.replace(/[_-]/g, '').replace(/forest$/, '');
  return APP_FMU_IDS.has(normalised) ? normalised : region;
}

const planCsv = process.argv[2] || DEFAULT_PLAN_CSV;

if (!fs.existsSync(planCsv)) {
  console.error(`Plan CSV not found: ${planCsv}`);
  process.exit(1);
}

const lines = fs.readFileSync(planCsv, 'utf8').trim().split(/\r?\n/);
const header = lines[0].split(',').map((h) => h.trim());
const idx = {
  region: header.indexOf('region'),
  year: header.indexOf('year'),
  fires: header.indexOf('n_fires'),
  area: header.indexOf('area_ha'),
};

for (const [key, value] of Object.entries(idx)) {
  if (value === -1) {
    console.error(`Column "${key}" missing from ${planCsv}`);
    process.exit(1);
  }
}

const stats = {};
let rows = 0;

for (const line of lines.slice(1)) {
  if (!line.trim()) continue;
  const cells = line.split(',');

  const fmu = toFmuId(cells[idx.region].trim());
  const year = String(Number(cells[idx.year]));
  const areaHa = Number(cells[idx.area]) || 0;
  const fires = Number(cells[idx.fires]) || 0;

  if (!stats[fmu]) stats[fmu] = {};
  if (!stats[fmu][year]) stats[fmu][year] = { areaHa: 0, fires: 0 };

  stats[fmu][year].areaHa += areaHa;
  stats[fmu][year].fires += fires;
  rows += 1;
}

// Stable key order so diffs stay readable.
const ordered = {};
for (const fmu of Object.keys(stats).sort()) {
  ordered[fmu] = {};
  for (const year of Object.keys(stats[fmu]).sort()) {
    const entry = stats[fmu][year];
    ordered[fmu][year] = {
      areaHa: Math.round(entry.areaHa * 10) / 10,
      fires: entry.fires,
    };
  }
}

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, `${JSON.stringify(ordered, null, 2)}\n`);

console.log(`Wrote ${OUT_FILE}`);
console.log(`  ${rows} rows -> ${Object.keys(ordered).length} regions`);
