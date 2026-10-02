#!/usr/bin/env node
/**
 * Upload Cloud Optimized GeoTIFFs to Vercel Pro Storage (Vercel Blob).
 *
 * Usage:
 *   node scripts/storage/upload-cogs-vercel.js <local-folder> <destination-prefix>
 *
 * Example:
 *   node scripts/storage/upload-cogs-vercel.js ./cogs cogs/clearcut-accumulated-ari
 *
 * Credentials:
 *   Reads BLOB_READ_WRITE_TOKEN from .env.vercel or .env in the project root.
 */

const path = require('path');
// Repo root: this file lives in scripts/<group>/.
const ROOT = path.resolve(__dirname, '..', '..');
try { require('dotenv').config({ path: path.join(ROOT, '.env.vercel') }); } catch (_) {}
try { require('dotenv').config({ path: path.join(ROOT, '.env') }); } catch (_) {}

const fs = require('fs');
const { put } = require('@vercel/blob');
const { rebuildManifestVercel } = require('./generate-cog-manifest-vercel');
const { refreshStatsForPrefix } = require('../stats/refresh-stats');

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  console.error('Missing BLOB_READ_WRITE_TOKEN. Copy .env.vercel.example to .env.vercel and set your token.');
  process.exit(1);
}

const cliArgs = process.argv.slice(2);
// --no-stats: upload only, skip regenerating the module's chart stats
const skipStats = cliArgs.includes('--no-stats');
const [localFolder, destPrefix] = cliArgs.filter((a) => !a.startsWith('--'));
if (!localFolder || !destPrefix) {
  console.error('Usage: node scripts/storage/upload-cogs-vercel.js <local-folder> <destination-prefix> [--no-stats]');
  process.exit(1);
}

const localAbs = path.resolve(localFolder);
if (!fs.existsSync(localAbs)) {
  console.error(`Local folder not found: ${localAbs}`);
  process.exit(1);
}

const CONTENT_TYPES = {
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.json': 'application/json',
};

// COGs are versioned and immutable; sidecar JSON revalidates.
const CACHE_MAX_AGE = {
  '.tif': 31536000,
  '.tiff': 31536000,
  '.json': 300,
};

async function uploadFile(localPath, key) {
  const ext = path.extname(localPath).toLowerCase();
  const fileStream = fs.createReadStream(localPath);
  const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
  const cacheControlMaxAge = CACHE_MAX_AGE[ext] || 300;

  return await put(key, fileStream, {
    access: 'public',
    token,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType,
    cacheControlMaxAge,
  });
}

(async () => {
  const files = fs.readdirSync(localAbs)
    .filter((f) => /\.(tif|tiff|json)$/i.test(f))
    .sort();

  if (files.length === 0) {
    console.error(`No .tif/.tiff/.json files found in ${localAbs}`);
    process.exit(1);
  }

  // Normalize prefix: strip leading/trailing slashes
  const cleanPrefix = destPrefix.replace(/^\/+|\/+$/g, '');
  console.log(`Uploading ${files.length} file(s) -> Vercel Blob [${cleanPrefix}/]\n`);

  let uploaded = 0;
  let bytes = 0;
  let sampleUrl = null;

  for (const file of files) {
    const localPath = path.join(localAbs, file);
    const key = `${cleanPrefix}/${file}`;
    const size = fs.statSync(localPath).size;
    try {
      const res = await uploadFile(localPath, key);
      uploaded += 1;
      bytes += size;
      sampleUrl ??= res.url;
      console.log(`  ok  ${key}  (${(size / 1e6).toFixed(2)} MB)`);
    } catch (err) {
      console.error(`  FAIL ${key}: ${err.name || 'Error'} - ${err.message}`);
    }
  }

  console.log(`\nDone: ${uploaded}/${files.length} file(s) uploaded, ${(bytes / 1e6).toFixed(2)} MB total.`);

  if (sampleUrl) {
    const storeOrigin = new URL(sampleUrl).origin;
    console.log(`\nVercel Blob Store Base URL: ${storeOrigin}`);
    console.log(`To use this store in production, set in Vercel Project Settings:`);
    console.log(`  REACT_APP_COG_BASE_URL=${storeOrigin}`);
  }

  // Re-index manifest automatically when uploading to cogs/
  if (uploaded > 0 && /^cogs(\/|$)/.test(cleanPrefix)) {
    console.log('\nRe-indexing COG manifest on Vercel Blob…');
    try {
      await rebuildManifestVercel({ token, quiet: true });
      console.log('  ok  cogs/manifest.json updated successfully.');
    } catch (err) {
      console.error(`  FAIL manifest re-index: ${err.message}`);
      console.error('  Run `node scripts/storage/generate-cog-manifest-vercel.js` manually to update the manifest.');
    }
  }

  // The charts read precomputed stats, not the COGs, so new or regenerated COGs
  // leave them stale. Regions come from the file names (<region>_<year>.tif).
  if (uploaded > 0 && !skipStats && /^cogs(\/|$)/.test(cleanPrefix)) {
    const regions = [...new Set(files
      .map((f) => f.match(/^(.+)_\d{4}\.tiff?$/i)?.[1])
      .filter(Boolean))];
    try {
      const result = refreshStatsForPrefix(cleanPrefix, { regions });
      if (result.skipped && result.skipped !== 'no module') {
        console.log('  Stats not refreshed -- fix the above and run:');
        console.log(`  node scripts/stats/refresh-stats.js --for-prefix ${cleanPrefix}`);
      }
    } catch (err) {
      console.error(`  FAIL stats refresh: ${err.message}`);
      console.error(`  Re-run: node scripts/stats/refresh-stats.js --for-prefix ${cleanPrefix}`);
    }
  }
})();

