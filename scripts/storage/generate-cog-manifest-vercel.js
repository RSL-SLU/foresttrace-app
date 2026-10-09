#!/usr/bin/env node
/**
 * Rebuild the COG availability manifest from what is stored in Vercel Blob.
 *
 * Why a manifest
 * --------------
 * The app has to know which region/year COGs exist before it requests one, or
 * it asks for all of them: with 39 FMUs selected that was ~195 HEAD probes
 * issued at once, against a browser limit of roughly 6 per origin, and everything
 * else -- including the FMU boundaries -- queued behind lookups for regions that
 * have no COGs at all. One compact manifest replaces the lot.
 *
 * It describes the Vercel Blob store, not the source tree. It is derived from
 * Vercel Blob and published back to Vercel Blob as `cogs/manifest.json`.
 *
 * RUN THIS AFTER EVERY COG UPLOAD to Vercel Blob.
 *
 * Usage:
 *   node scripts/storage/generate-cog-manifest-vercel.js            # rebuild and publish
 *   node scripts/storage/generate-cog-manifest-vercel.js --dry-run  # print what it would publish
 */

const path = require('path');
// Repo root: this file lives in scripts/<group>/.
const ROOT = path.resolve(__dirname, '..', '..');
try { require('dotenv').config({ path: path.join(ROOT, '.env.vercel') }); } catch (_) {}
try { require('dotenv').config({ path: path.join(ROOT, '.env') }); } catch (_) {}
try { require('dotenv').config({ path: path.join(ROOT, '.env.r2') }); } catch (_) {}

const { list, put } = require('@vercel/blob');

const MANIFEST_KEY = 'cogs/manifest.json';

// cogs/<prefix>/<region>_<year>.tif -- the layout clearcutCogUrl() builds.
const COG_KEY = /^cogs\/([^/]+)\/([a-z0-9]+)_(\d{4})\.tif$/;
// cogs/<prefix>/<region>.tif -- one file covering every year (ARI, logging
// scars, SCANFI); listed under manifest.static[prefix] as region ids.
const STATIC_KEY = /^cogs\/([^/]+)\/([a-z0-9]+)\.tif$/;

/**
 * Rebuild the manifest from Vercel Blob and (unless dryRun) publish it.
 *
 * @param {Object} options
 * @param {string} [options.token] - Vercel Blob read-write token
 * @param {boolean} [options.dryRun] - Print manifest without uploading
 * @param {boolean} [options.quiet] - Suppress informational logs
 * @returns {Promise<Object>} The generated manifest object
 */
async function rebuildManifestVercel({
  token = process.env.BLOB_READ_WRITE_TOKEN,
  dryRun = false,
  quiet = false,
} = {}) {
  const log = quiet ? () => {} : console.log;

  if (!token) {
    throw new Error('Missing BLOB_READ_WRITE_TOKEN. Set it in .env.vercel or your environment.');
  }

  const prefixes = {};
  const statics = {};
  let cursor;
  let scanned = 0;

  do {
    const res = await list({
      prefix: 'cogs/',
      token,
      cursor,
    });

    for (const blob of res.blobs ?? []) {
      scanned += 1;
      const single = blob.pathname.match(STATIC_KEY);
      if (single) {
        (statics[single[1]] ??= []).push(single[2]);
        continue;
      }
      const match = blob.pathname.match(COG_KEY);
      if (!match) continue;
      const [, prefix, region, year] = match;
      prefixes[prefix] ??= {};
      prefixes[prefix][region] ??= [];
      prefixes[prefix][region].push(Number(year));
    }
    cursor = res.cursor;
  } while (cursor);

  for (const prefix of Object.keys(prefixes)) {
    for (const region of Object.keys(prefixes[prefix])) {
      prefixes[prefix][region].sort((a, b) => a - b);
    }
  }

  // Preserve tile coverage from R2 if R2 credentials exist, so existing tile
  // discovery remains intact if tiles are checked against the same manifest.
  let tiles = {};
  if (
    process.env.CLOUDFLARE_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME
  ) {
    try {
      const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
      const s3 = new S3Client({
        region: 'auto',
        endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
      });
      const TILE_DIR = /^([a-z0-9]+)_(\d{4})$/;
      const layerDirs = await s3.send(new ListObjectsV2Command({
        Bucket: process.env.R2_BUCKET_NAME,
        Prefix: 'tiles/',
        Delimiter: '/',
      }));
      for (const { Prefix: layerPrefix } of layerDirs.CommonPrefixes ?? []) {
        const layer = layerPrefix.replace('tiles/', '').replace(/\/$/, '');
        const byRegion = {};
        let layerToken;
        do {
          const res = await s3.send(new ListObjectsV2Command({
            Bucket: process.env.R2_BUCKET_NAME,
            Prefix: layerPrefix,
            Delimiter: '/',
            ContinuationToken: layerToken,
          }));
          for (const { Prefix: dir } of res.CommonPrefixes ?? []) {
            const name = dir.replace(layerPrefix, '').replace(/\/$/, '');
            const match = name.match(TILE_DIR);
            if (!match) continue;
            const [, region, year] = match;
            byRegion[region] ??= [];
            byRegion[region].push(Number(year));
          }
          layerToken = res.NextContinuationToken;
        } while (layerToken);
        for (const region of Object.keys(byRegion)) byRegion[region].sort((a, b) => a - b);
        if (Object.keys(byRegion).length) tiles[layer] = byRegion;
      }
    } catch (_) {
      // If R2 check fails or is unavailable, leave tiles empty; callers fall back to standard tile queries.
    }
  }

  Object.values(statics).forEach((regions) => regions.sort());
  const manifest = { generatedAt: new Date().toISOString(), prefixes, static: statics, tiles };
  const body = `${JSON.stringify(manifest, null, 2)}\n`;

  log(`Scanned ${scanned} objects under cogs/ in Vercel Blob\n`);
  for (const [prefix, regions] of Object.entries(prefixes)) {
    const names = Object.keys(regions);
    log(`  cog  ${prefix}: ${names.length} region(s) — ${names.join(', ')}`);
  }
  for (const [layer, regions] of Object.entries(tiles)) {
    const names = Object.keys(regions);
    log(`  tile ${layer}: ${names.length} region(s) — ${names.join(', ')}`);
  }

  if (dryRun) {
    log(`\n--dry-run: not published (${body.length} bytes)`);
    return manifest;
  }

  const result = await put(MANIFEST_KEY, body, {
    access: 'public',
    token,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 300,
  });

  log(`\nPublished manifest to Vercel Blob: ${result.url} (${body.length} bytes)`);
  return manifest;
}

module.exports = { rebuildManifestVercel, MANIFEST_KEY };

if (require.main === module) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.error('Missing BLOB_READ_WRITE_TOKEN in .env.vercel or environment.');
    process.exit(1);
  }
  rebuildManifestVercel({ dryRun: process.argv.includes('--dry-run') }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

