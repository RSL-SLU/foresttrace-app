#!/usr/bin/env node
/**
 * Upload the app's static data and remaining PNG tiles from client/public/ to
 * Vercel Blob, keeping the same paths (client/public/data/x.json -> data/x.json).
 *
 * The local copy under client/public/ is the source of truth: the dev server
 * serves it directly, and production reads the same files from Blob through
 * REACT_APP_DATA_BASE_URL / REACT_APP_TILES_BASE_URL.
 *
 * Usage:
 *   node scripts/storage/upload-data-vercel.js                 # everything in DEFAULT_PATHS
 *   node scripts/storage/upload-data-vercel.js data/patches    # specific paths under client/public
 *   node scripts/storage/upload-data-vercel.js --dry-run
 *
 * Re-runnable: objects already on Blob with the same size are skipped, so an
 * interrupted run resumes where it stopped.
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
const { put, list } = require('@vercel/blob');

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  console.error('Missing BLOB_READ_WRITE_TOKEN. Copy .env.vercel.example to .env.vercel and set your token.');
  process.exit(1);
}

const PUBLIC_DIR = path.join(ROOT, 'client', 'public');

// Everything the client fetches through DATA_BASE_URL or TILES_BASE_URL that
// isn't a COG. Stats JSON is left out: it's read from PUBLIC_URL, i.e. the
// deployment itself. Biomass is the only layer still drawn from PNG tiles.
const DEFAULT_PATHS = [
  'data/regions',
  'data/regions-simplified.json',
  'data/caribou_ranges.geojson',
  'data/patches',
  'tiles/biomass',
];

const CONTENT_TYPES = {
  '.json': 'application/json',
  '.geojson': 'application/geo+json',
  '.png': 'image/png',
};

// Tiles are regenerated into new folders rather than overwritten in place;
// JSON revalidates.
const CACHE_MAX_AGE = {
  '.png': 31536000,
  '.json': 300,
  '.geojson': 300,
};

const CONCURRENCY = 16;
const RETRIES = 3;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const paths = args.filter((a) => !a.startsWith('--'));
const targets = paths.length > 0 ? paths : DEFAULT_PATHS;

function walk(abs) {
  const stat = fs.statSync(abs);
  if (stat.isFile()) return [{ abs, size: stat.size }];
  return fs.readdirSync(abs).flatMap((name) => walk(path.join(abs, name)));
}

function toKey(abs) {
  return path.relative(PUBLIC_DIR, abs).split(path.sep).join('/');
}

// key -> size, for everything already on Blob under the given prefix.
async function listExisting(prefix) {
  const existing = new Map();
  let cursor;
  do {
    const res = await list({ prefix, cursor, limit: 1000, token });
    res.blobs.forEach((b) => existing.set(b.pathname, b.size));
    cursor = res.hasMore ? res.cursor : undefined;
  } while (cursor);
  return existing;
}

async function uploadFile(abs, key) {
  const ext = path.extname(abs).toLowerCase();
  for (let attempt = 1; ; attempt++) {
    try {
      return await put(key, fs.readFileSync(abs), {
        access: 'public',
        token,
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: CONTENT_TYPES[ext] || 'application/octet-stream',
        cacheControlMaxAge: CACHE_MAX_AGE[ext] || 300,
      });
    } catch (err) {
      if (attempt >= RETRIES) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

(async () => {
  const files = [];
  for (const rel of targets) {
    const abs = path.join(PUBLIC_DIR, rel);
    if (!fs.existsSync(abs)) {
      console.error(`Not found, skipping: client/public/${rel}`);
      continue;
    }
    walk(abs).forEach((f) => files.push({ ...f, key: toKey(f.abs) }));
  }

  const existing = new Map();
  for (const rel of targets) {
    (await listExisting(rel)).forEach((size, key) => existing.set(key, size));
  }
  const pending = files.filter((f) => existing.get(f.key) !== f.size);
  const bytes = pending.reduce((sum, f) => sum + f.size, 0);
  console.log(`${files.length} local file(s); ${files.length - pending.length} already on Blob; `
    + `${pending.length} to upload (${(bytes / 1e6).toFixed(2)} MB).`);

  if (dryRun || pending.length === 0) return;

  let done = 0;
  let failed = 0;
  const start = Date.now();
  let next = 0;
  async function worker() {
    while (next < pending.length) {
      const f = pending[next++];
      try {
        await uploadFile(f.abs, f.key);
      } catch (err) {
        failed++;
        console.error(`  FAIL ${f.key}: ${err.message}`);
      }
      done++;
      if (done % 500 === 0 || done === pending.length) {
        console.log(`  ${done}/${pending.length} (${((Date.now() - start) / 1000).toFixed(0)}s)`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`Done: ${done - failed} uploaded, ${failed} failed.`);
  if (failed > 0) {
    console.log('Re-run the same command to retry the failures.');
    process.exitCode = 1;
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
