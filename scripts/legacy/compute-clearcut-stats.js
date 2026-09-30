'use strict';

// Computes clearcut area (ha) from accumulated and/or annual clearcut tiles.
// Only counts pixels at the highest zoom level to avoid double-counting the tile pyramid.
// Pixel area is adjusted for latitude using the Mercator projection formula.
//
// Writes to client/public/data/clearcut_stats.json:
//   accumulated → {region}_hls          (reads tiles/clearcut/)
//   annual      → {region}_hls_annual   (reads tiles/clearcut-annual/)
//
// Usage:
//   node compute-clearcut-stats.js --local [--accumulated] [--annual] [region] [year]
//       reads from client/public/tiles/ (no credentials needed)
//
//   node compute-clearcut-stats.js --production [--accumulated] [--annual] [region] [year]
//       reads from Cloudflare R2 (requires .env.r2)
//
//   Default (no --accumulated / --annual flag): computes both.
//
// Credentials for --production: .env.r2

const args = process.argv.slice(2);
const isLocal        = args.includes('--local');
const isProduction   = args.includes('--production');
const doAccumulated  = args.includes('--accumulated') || (!args.includes('--accumulated') && !args.includes('--annual'));
const doAnnual       = args.includes('--annual')      || (!args.includes('--accumulated') && !args.includes('--annual'));

if (!isLocal && !isProduction) {
  console.error('Error: specify --local or --production');
  console.error('  --local       read from client/public/tiles/ (no credentials needed)');
  console.error('  --production  read from Cloudflare R2 (requires .env.r2)');
  process.exit(1);
}

if (isProduction) require('dotenv').config({ path: '.env.r2' });

const { PNG } = require('pngjs');
const fs   = require('fs');
const path = require('path');

// ── Config ───────────────────────────────────────────────────────────────────

const REGIONS = [
  'abitibiriver', 'algoma', 'algonquinpark', 'bancroftminden', 'blackspruce',
  'boundarywaters', 'caribou', 'dogrivermatawin', 'dryden', 'englishriver',
  'frenchsevern', 'gordoncosens', 'hearst', 'kenogami', 'kenora', 'lacseul',
  'lakenipigon', 'lakehead', 'mazinawlanark', 'missinaibi', 'nagagami',
  'nipissing', 'northshore', 'ogoki', 'ottawavalley', 'pic', 'pineland',
  'redlake', 'romeomalette', 'spanish', 'sudbury', 'temagami', 'timiskaming',
  'troutlake', 'wabadowgangnoopming', 'wabigoon', 'whiskeyjack', 'whiteriver',
  'whitefeather',
];

const ALL_YEARS       = [2010, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
const ANNUAL_YEARS    = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
const CONCURRENCY     = 16;
const EARTH_CIRCUMFERENCE = 40075016.686;
const LOCAL_TILES     = path.join(__dirname, 'client', 'public');

// ── Area formula ──────────────────────────────────────────────────────────────

function pixelAreaHaAtTile(tileY, tileZ) {
  const n       = Math.pow(2, tileZ) * 256;
  const worldY  = tileY * 256 + 128; // center pixel of tile
  const latRad  = Math.atan(Math.sinh(Math.PI * (1 - 2 * worldY / n)));
  const pixelSizeM = EARTH_CIRCUMFERENCE * Math.cos(latRad) / n;
  return (pixelSizeM * pixelSizeM) / 10000;
}

// ── R2 client (production only) ───────────────────────────────────────────────

let r2, BUCKET;
if (isProduction) {
  const { S3Client, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
  r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  BUCKET = process.env.R2_BUCKET_NAME;
  r2._GetObjectCommand     = GetObjectCommand;
  r2._ListObjectsV2Command = ListObjectsV2Command;
}

// ── Local I/O helpers ─────────────────────────────────────────────────────────

async function listPathsLocal(tileFolder, region, year) {
  const dir = path.join(LOCAL_TILES, 'tiles', tileFolder, `${region}_${year}`);
  try { await fs.promises.access(dir); } catch { return []; }
  const paths = [];
  for (const z of await fs.promises.readdir(dir)) {
    const zDir = path.join(dir, z);
    if (!(await fs.promises.stat(zDir)).isDirectory()) continue;
    for (const x of await fs.promises.readdir(zDir)) {
      const xDir = path.join(zDir, x);
      if (!(await fs.promises.stat(xDir)).isDirectory()) continue;
      for (const file of await fs.promises.readdir(xDir)) {
        if (file.endsWith('.png')) paths.push(`${z}/${x}/${file}`);
      }
    }
  }
  return paths;
}

async function getBufferLocal(tileFolder, region, year, tilePath) {
  const filePath = path.join(LOCAL_TILES, 'tiles', tileFolder, `${region}_${year}`, tilePath);
  try { return await fs.promises.readFile(filePath); } catch { return null; }
}

// ── R2 I/O helpers ────────────────────────────────────────────────────────────

async function listPathsR2(tileFolder, region, year) {
  const prefix = `tiles/${tileFolder}/${region}_${year}/`;
  const paths  = [];
  let token;
  do {
    const res = await r2.send(new r2._ListObjectsV2Command({
      Bucket: BUCKET, Prefix: prefix, ContinuationToken: token,
    }));
    for (const obj of res.Contents ?? []) paths.push(obj.Key.slice(prefix.length));
    token = res.NextContinuationToken;
  } while (token);
  return paths;
}

async function getBufferR2(tileFolder, region, year, tilePath) {
  const key = `tiles/${tileFolder}/${region}_${year}/${tilePath}`;
  try {
    const res = await r2.send(new r2._GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const chunks = [];
    for await (const chunk of res.Body) chunks.push(chunk);
    return Buffer.concat(chunks);
  } catch (e) {
    if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return null;
    throw e;
  }
}

const TILE_TIMEOUT_MS = 8000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(null), ms)),
  ]);
}

// ── Area computation ──────────────────────────────────────────────────────────

async function computeAreaHa(tileFolder, region, year) {
  const paths = await (isLocal
    ? listPathsLocal(tileFolder, region, year)
    : listPathsR2(tileFolder, region, year));

  if (paths.length === 0) return null;

  // Only count leaf tiles at max zoom to avoid pyramid double-counting.
  // Filter out folder-marker entries (empty string or non-tile paths) before parsing.
  const tilePaths = paths.filter(p => /^\d+\/\d+\/\d+\.png$/.test(p));
  const zLevels   = [...new Set(tilePaths.map(p => parseInt(p.split('/')[0], 10)))];
  const maxZ      = Math.max(...zLevels);
  const leafPaths = tilePaths.filter(p => parseInt(p.split('/')[0], 10) === maxZ);

  let nullCount = 0;
  let totalHa = 0;

  for (let i = 0; i < leafPaths.length; i += CONCURRENCY) {
    const batch = leafPaths.slice(i, i + CONCURRENCY);
    const haValues = await Promise.all(batch.map(async (tilePath) => {
      const [z, , y] = tilePath.replace('.png', '').split('/').map(Number);
      const buf = isLocal
        ? await withTimeout(getBufferLocal(tileFolder, region, year, tilePath), TILE_TIMEOUT_MS)
        : await getBufferR2(tileFolder, region, year, tilePath);
      if (!buf) { nullCount++; return 0; }
      const png = PNG.sync.read(buf);
      let opaqueCount = 0;
      for (let j = 3; j < png.data.length; j += 4) {
        if (png.data[j] > 0) opaqueCount++;
      }
      return opaqueCount * pixelAreaHaAtTile(y, z);
    }));
    totalHa += haValues.reduce((a, b) => a + b, 0);
    process.stdout.write(`\r  ${i + batch.length}/${leafPaths.length} tiles…`);
  }
  process.stdout.write('\r');
  if (nullCount > 0) console.warn(`  ${nullCount}/${leafPaths.length} tiles skipped (read error or timeout)`);

  return Math.round(totalHa * 100) / 100;
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  if (isProduction) {
    const missing = ['CLOUDFLARE_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']
      .filter(k => !process.env[k]);
    if (missing.length) {
      console.error(`Missing in .env.r2: ${missing.join(', ')}`);
      process.exit(1);
    }
  }

  const posArgs   = args.filter(a => !a.startsWith('--'));
  const argRegion = posArgs[0] || null;
  const argYear   = posArgs[1] ? parseInt(posArgs[1], 10) : null;

  const regions = argRegion ? [argRegion] : REGIONS;

  const mode = isLocal ? 'local (client/public/tiles/)' : 'production (R2)';
  const layers = [
    ...(doAccumulated ? [{ folder: 'clearcut',        statKey: '{region}_hls',        years: argYear ? [argYear] : ALL_YEARS    }] : []),
    ...(doAnnual      ? [{ folder: 'clearcut-annual', statKey: '{region}_hls_annual', years: argYear ? [argYear] : ANNUAL_YEARS }] : []),
  ];
  console.log(`Computing clearcut stats — ${mode}`);
  console.log(`  Layers: ${layers.map(l => l.folder).join(', ')}`);
  console.log(`  Regions: ${regions.length}\n`);

  const statsPath = path.join(__dirname, 'client', 'public', 'data', 'clearcut_stats.json');
  const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));

  for (const { folder, statKey, years } of layers) {
    console.log(`\n── ${folder} ──`);
    for (const region of regions) {
      for (const year of years) {
        process.stdout.write(`${region} ${year}…\n`);
        const ha = await computeAreaHa(folder, region, year);
        if (ha !== null) {
          const key = statKey.replace('{region}', region);
          if (!stats[key]) stats[key] = {};
          stats[key][String(year)] = ha;
          console.log(`  → ${ha.toLocaleString()} ha`);
        } else {
          console.log(`  → no tiles found, skipping`);
        }
      }
    }
  }

  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
  console.log('\nUpdated clearcut_stats.json');
}

main().catch(err => { console.error(err); process.exit(1); });
