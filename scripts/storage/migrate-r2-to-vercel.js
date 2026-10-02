#!/usr/bin/env node
/**
 * Migrate files from Cloudflare R2 to Vercel Pro Storage (Vercel Blob).
 *
 * Usage:
 *   node scripts/storage/migrate-r2-to-vercel.js                    # Migrates all objects under cogs/
 *   node scripts/storage/migrate-r2-to-vercel.js --dry-run          # Preview files without transferring
 *   node scripts/storage/migrate-r2-to-vercel.js --prefix data/     # Migrate specific prefix
 *   node scripts/storage/migrate-r2-to-vercel.js --all              # Migrate all R2 bucket contents
 *
 * Credentials:
 *   - Source (R2): .env.r2 (CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME)
 *   - Target (Vercel): .env.vercel or .env (BLOB_READ_WRITE_TOKEN)
 */

const path = require('path');
// Repo root: this file lives in scripts/<group>/.
const ROOT = path.resolve(__dirname, '..', '..');
try { require('dotenv').config({ path: path.join(ROOT, '.env.r2') }); } catch (_) {}
try { require('dotenv').config({ path: path.join(ROOT, '.env.vercel') }); } catch (_) {}
try { require('dotenv').config({ path: path.join(ROOT, '.env') }); } catch (_) {}

const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { put } = require('@vercel/blob');
const { rebuildManifestVercel } = require('./generate-cog-manifest-vercel');

// 1. Verify credentials
const {
  CLOUDFLARE_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME,
  BLOB_READ_WRITE_TOKEN,
} = process.env;

const missingR2 = ['CLOUDFLARE_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']
  .filter((k) => !process.env[k]);

if (missingR2.length > 0) {
  console.error(`Missing R2 credentials in .env.r2: ${missingR2.join(', ')}`);
  process.exit(1);
}

if (!BLOB_READ_WRITE_TOKEN) {
  console.error('Missing BLOB_READ_WRITE_TOKEN. Set it in .env.vercel or your environment.');
  process.exit(1);
}

// 2. Parse CLI args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const migrateAll = args.includes('--all');
const prefixArgIdx = args.indexOf('--prefix');
const targetPrefix = migrateAll
  ? ''
  : (prefixArgIdx !== -1 && args[prefixArgIdx + 1] ? args[prefixArgIdx + 1] : 'cogs/');

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

const CONTENT_TYPES = {
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.json': 'application/json',
  '.png': 'image/png',
  '.pmtiles': 'application/vnd.pmtiles',
};

const CACHE_MAX_AGE = {
  '.tif': 31536000,
  '.tiff': 31536000,
  '.png': 31536000,
  '.json': 300,
};

const allowAllExtensions = args.includes('--include-all-extensions') || args.includes('--include-png');

async function listR2Objects(prefix) {
  const objects = [];
  let token;
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: R2_BUCKET_NAME,
      Prefix: prefix,
      ContinuationToken: token,
    }));
    if (res.Contents) {
      for (const obj of res.Contents) {
        // Exclude empty directory markers or the manifest itself if regenerating
        if (obj.Key.endsWith('/') || obj.Key === 'cogs/manifest.json') continue;

        // Safety filter: By default, ONLY migrate COG GeoTIFFs (.tif, .tiff) and sidecar .json.
        // Never migrate .png tile pyramids.
        const ext = path.extname(obj.Key).toLowerCase();
        if (!allowAllExtensions && !['.tif', '.tiff', '.json'].includes(ext)) {
          continue;
        }

        objects.push(obj);
      }
    }
    token = res.NextContinuationToken;
  } while (token);
  return objects;
}

async function transferObject(key, size) {
  const ext = path.extname(key).toLowerCase();
  const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
  const cacheControlMaxAge = CACHE_MAX_AGE[ext] || 300;

  const getRes = await s3.send(new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
  }));

  return await put(key, getRes.Body, {
    access: 'public',
    token: BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType,
    cacheControlMaxAge,
  });
}

(async () => {
  console.log(`Scanning R2 bucket "${R2_BUCKET_NAME}" with prefix "${targetPrefix}"…`);
  const objects = await listR2Objects(targetPrefix);

  if (objects.length === 0) {
    console.log(`No objects found under prefix "${targetPrefix}".`);
    process.exit(0);
  }

  const totalBytes = objects.reduce((sum, o) => sum + (o.Size || 0), 0);
  console.log(`Found ${objects.length} object(s), ${(totalBytes / 1e6).toFixed(2)} MB total.`);

  if (dryRun) {
    console.log('\n[DRY RUN] Objects to migrate:');
    for (const obj of objects) {
      console.log(`  - ${obj.Key} (${((obj.Size || 0) / 1e6).toFixed(2)} MB)`);
    }
    console.log(`\n--dry-run completed. No files were written to Vercel.`);
    return;
  }

  console.log(`\nStarting migration from Cloudflare R2 to Vercel Blob…\n`);
  let successCount = 0;
  let failCount = 0;
  let transferredBytes = 0;
  let sampleUrl = null;
  const startTime = Date.now();

  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    const progress = `[${i + 1}/${objects.length}]`;
    const sizeMb = ((obj.Size || 0) / 1e6).toFixed(2);

    try {
      const res = await transferObject(obj.Key, obj.Size);
      successCount++;
      transferredBytes += (obj.Size || 0);
      sampleUrl ??= res.url;
      console.log(`  ${progress} ok   ${obj.Key} (${sizeMb} MB)`);
    } catch (err) {
      failCount++;
      console.error(`  ${progress} FAIL ${obj.Key}: ${err.message}`);
    }
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nMigration completed in ${durationSec}s:`);
  console.log(`  Transferred: ${successCount}/${objects.length} files (${(transferredBytes / 1e6).toFixed(2)} MB)`);
  if (failCount > 0) {
    console.log(`  Failed:      ${failCount} files`);
  }

  if (sampleUrl) {
    const storeOrigin = new URL(sampleUrl).origin;
    console.log(`\nVercel Blob Store Base URL: ${storeOrigin}`);
    console.log(`To use this store in production, set in Vercel Project Settings:`);
    console.log(`  REACT_APP_COG_BASE_URL=${storeOrigin}`);
  }

  // Re-index manifest on Vercel if cogs were migrated
  if (successCount > 0 && (targetPrefix.startsWith('cogs') || targetPrefix === '')) {
    console.log('\nRe-indexing COG manifest on Vercel Blob…');
    try {
      await rebuildManifestVercel({ token: BLOB_READ_WRITE_TOKEN, quiet: true });
      console.log('  ok  cogs/manifest.json created and published on Vercel Blob.');
    } catch (err) {
      console.error(`  FAIL manifest re-indexing: ${err.message}`);
      console.error('  Run `node scripts/storage/generate-cog-manifest-vercel.js` to build it manually.');
    }
  }
})();

