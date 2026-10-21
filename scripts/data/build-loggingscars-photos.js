#!/usr/bin/env node
/**
 * Copies the Wildlands League field-site photos to Vercel Blob, so the app can
 * show them in its own photo viewer.
 *
 * Google's My Maps image host sends Cross-Origin-Resource-Policy: same-site
 * and Content-Disposition: attachment, so the original URLs can't be shown in
 * an <img> on another site; they only download. Each photo (PNG, ~2048 px,
 * ~8 MB) is fetched once, resized to a 1600 px WebP plus a 320 px thumbnail,
 * and uploaded to media/loggingscars/. The URLs are written back to each site
 * in client/public/data/loggingscars-sites.geojson as photoUrl / thumbUrl;
 * `photo` keeps the original as the source link.
 *
 *   node scripts/data/build-loggingscars-photos.js [--force]
 *
 * Run after build-loggingscars-sites.js. Sites that already have a photoUrl
 * are skipped unless --force. Downloads are cached in .cache/loggingscars-photos.
 *
 * Credentials: BLOB_READ_WRITE_TOKEN from .env.vercel or .env in the repo root.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
try { require('dotenv').config({ path: path.join(ROOT, '.env.vercel') }); } catch (_) {}
try { require('dotenv').config({ path: path.join(ROOT, '.env') }); } catch (_) {}

const sharp = require('sharp');
const { put } = require('@vercel/blob');

const SITES = path.join(ROOT, 'client', 'public', 'data', 'loggingscars-sites.geojson');
const CACHE = path.join(ROOT, '.cache', 'loggingscars-photos');
const PREFIX = 'media/loggingscars';
const SIZES = { photo: 1600, thumb: 320 };
const CONCURRENCY = 4;

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  console.error('Missing BLOB_READ_WRITE_TOKEN (.env.vercel or .env).');
  process.exit(1);
}
const force = process.argv.includes('--force');

// Stable file name per site: its name, slugged, plus a short hash of the
// photo URL so two sites with one name never collide
function keyFor(props) {
  const slug = props.name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const hash = crypto.createHash('sha1').update(props.photo).digest('hex').slice(0, 8);
  return `${slug}-${hash}`;
}

async function download(url, file) {
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(file, buf);
  return buf;
}

async function upload(key, buf) {
  const res = await put(key, buf, {
    access: 'public',
    token,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'image/webp',
    cacheControlMaxAge: 31536000,
  });
  return res.url;
}

async function processSite(f) {
  const p = f.properties;
  const key = keyFor(p);
  const original = await download(p.photo, path.join(CACHE, `${key}.img`));
  const [photo, thumb] = await Promise.all([
    sharp(original).rotate().resize({ width: SIZES.photo, height: SIZES.photo, fit: 'inside', withoutEnlargement: true }).webp({ quality: 72 }).toBuffer(),
    sharp(original).rotate().resize({ width: SIZES.thumb, height: SIZES.thumb, fit: 'inside', withoutEnlargement: true }).webp({ quality: 65 }).toBuffer(),
  ]);
  p.photoUrl = await upload(`${PREFIX}/${key}.webp`, photo);
  p.thumbUrl = await upload(`${PREFIX}/${key}_t.webp`, thumb);
  return photo.length + thumb.length;
}

(async () => {
  fs.mkdirSync(CACHE, { recursive: true });
  const gj = JSON.parse(fs.readFileSync(SITES, 'utf8'));
  const todo = gj.features.filter((f) => f.properties.photo && (force || !f.properties.photoUrl));
  console.log(`${todo.length} of ${gj.features.length} sites to process`);

  let done = 0;
  let bytes = 0;
  const failed = [];
  const queue = [...todo];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const f = queue.shift();
      try {
        const n = await processSite(f);
        bytes += n;
      } catch (err) {
        failed.push(`${f.properties.name}: ${err.message}`);
      }
      done += 1;
      if (done % 20 === 0 || done === todo.length) {
        console.log(`  ${done}/${todo.length}  ${(bytes / 1e6).toFixed(1)} MB uploaded`);
        // Save progress, so an interrupted run resumes where it stopped
        fs.writeFileSync(SITES, `${JSON.stringify(gj)}\n`);
      }
    }
  }));

  fs.writeFileSync(SITES, `${JSON.stringify(gj)}\n`);
  console.log(`done: ${todo.length - failed.length} uploaded, ${(bytes / 1e6).toFixed(1)} MB`);
  if (failed.length) console.log(`failed (${failed.length}):\n  ${failed.join('\n  ')}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
