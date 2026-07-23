#!/usr/bin/env node
/**
 * Replace local clearcut tile folders in client/public/tiles/clearcut/ with
 * freshly generated tiles from the boreal-canada-mapping repo (sibling folder).
 *
 * Usage:
 *   node replace-tiles.js [year ...]     # defaults to 2017-2023
 *
 * Example:
 *   node replace-tiles.js 2017 2018 2019
 *
 * Source layout (boreal-canada-mapping):
 *   results/tiles/<year>_wabigoon_clearcut_unet_wabigoon_<year>_multiclass_v1/<z>/<x>/<y>.png
 * Destination layout (this repo):
 *   client/public/tiles/clearcut/wabigoon_<year>/<z>/<x>/<y>.png
 *
 * Only .png files are copied -- the source folders also contain normalized_input.tif
 * and _manifest.json, which aren't tiles and shouldn't ship in the public build.
 */

const fs = require('fs');
const path = require('path');

const BOREAL_REPO = path.resolve(__dirname, '..', 'boreal-canada-mapping');
const DEST_ROOT = path.join(__dirname, 'client', 'public', 'tiles', 'clearcut');

const argYears = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n));
const YEARS = argYears.length > 0 ? argYears : [2017, 2018, 2019, 2020, 2021, 2022, 2023];

function sourceDirFor(year) {
  return path.join(
    BOREAL_REPO, 'results', 'tiles',
    `${year}_wabigoon_clearcut_unet_wabigoon_${year}_multiclass_v1`
  );
}

function walkPngs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkPngs(full);
    return entry.name.toLowerCase().endsWith('.png') ? [full] : [];
  });
}

function replaceYear(year) {
  const src = sourceDirFor(year);
  const dest = path.join(DEST_ROOT, `wabigoon_${year}`);

  if (!fs.existsSync(src)) {
    console.error(`${year}: [skip] source not found: ${src}`);
    return;
  }

  const pngs = walkPngs(src);
  if (pngs.length === 0) {
    console.error(`${year}: [skip] no PNG tiles found in: ${src}`);
    return;
  }

  console.log(`${year}: replacing ${dest}`);
  console.log(`  removing existing tiles...`);
  fs.rmSync(dest, { recursive: true, force: true });

  console.log(`  copying ${pngs.length} tiles...`);
  for (const file of pngs) {
    const rel = path.relative(src, file);
    const destFile = path.join(dest, rel);
    fs.mkdirSync(path.dirname(destFile), { recursive: true });
    fs.copyFileSync(file, destFile);
  }
  console.log(`  done (${pngs.length} tiles).`);
}

if (!fs.existsSync(BOREAL_REPO)) {
  console.error(`boreal-canada-mapping repo not found at: ${BOREAL_REPO}`);
  process.exit(1);
}

for (const year of YEARS) {
  replaceYear(year);
}
