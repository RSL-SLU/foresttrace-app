'use strict';

/**
 * Builds client/public/data/wildfire_years.json — a map of
 *   { "<region>": [year, year, ...] }
 * listing which years each region actually has burned-area tiles for.
 *
 * The wildfire tile pyramid is sparse: a region only has a folder for a year
 * in which something burned. Without this manifest the year slider offers all
 * years 2010-2025 for every region and most of them render nothing, which
 * looks like a broken layer rather than "no fire that year".
 *
 * Usage:
 *   node generate-wildfire-years.js [tilesDir]
 *
 * Defaults to the local NBAC tiling output. Re-run whenever tiles are added.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_TILES_DIR = 'F:/forest_data_curation/nbac_tiling/tiles/wildfire';
const OUT_FILE = path.join(__dirname, 'client', 'public', 'data', 'wildfire_years.json');

const tilesDir = process.argv[2] || DEFAULT_TILES_DIR;

if (!fs.existsSync(tilesDir)) {
  console.error(`Tiles directory not found: ${tilesDir}`);
  process.exit(1);
}

const byRegion = new Map();

for (const entry of fs.readdirSync(tilesDir)) {
  if (!fs.statSync(path.join(tilesDir, entry)).isDirectory()) continue;

  const match = entry.match(/^(.*)_(\d{4})$/);
  if (!match) {
    console.warn(`  skipping unrecognised folder name: ${entry}`);
    continue;
  }

  const [, region, year] = match;
  if (!byRegion.has(region)) byRegion.set(region, new Set());
  byRegion.get(region).add(Number(year));
}

const result = {};
for (const region of [...byRegion.keys()].sort()) {
  result[region] = [...byRegion.get(region)].sort((a, b) => a - b);
}

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, `${JSON.stringify(result, null, 2)}\n`);

const totalYears = Object.values(result).reduce((sum, years) => sum + years.length, 0);
console.log(`Wrote ${OUT_FILE}`);
console.log(`  ${Object.keys(result).length} regions, ${totalYears} region-years`);
