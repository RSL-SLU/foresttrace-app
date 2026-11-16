#!/usr/bin/env node
/**
 * Upload COGs to production with your ForestTrace account -- no Blob token.
 *
 * For students and collaborators. It goes through the app's upload route
 * (api/uploads.js), so the same rules apply as on the Upload Data page: you
 * can only write to the layers an admin granted you, names must be
 * <region>_<year>.tif (yearly layers) or <region>.tif (static ones), and
 * existing files are never replaced. Uploads are live as soon as the run ends.
 * (Admins holding BLOB_READ_WRITE_TOKEN can still use upload-cogs-vercel.js.)
 *
 * Usage:
 *   node scripts/storage/upload-cogs.js login [--url https://<app>]   # once; remembers you
 *   node scripts/storage/upload-cogs.js <folder> [options]
 *   node scripts/storage/upload-cogs.js logout
 *
 * <folder> is either
 *   - a layer folder, named after its layer:  .../foresttrace_cogs/clearcut-status-v2
 *   - a folder of layer folders, e.g. the output of prepare-boreal-cogs.py:
 *       .../foresttrace_cogs/{clearcut-status-v2, clearcut-status-acc-v2, ...}
 *   - any folder of .tif files, with --layer <layer>
 *
 * Options:
 *   --layer <prefix>    layer for a folder whose name isn't one
 *   --dry-run           check everything, upload nothing
 *   --yes               don't ask before uploading when some files were rejected
 *   --overwrite         confirm replacement of existing files (requires admin grant)
 *   --no-stats          skip refreshing chart stats afterwards
 *   --concurrency <n>   parallel uploads (default 3)
 *
 * Environment: FORESTTRACE_URL and FORESTTRACE_TOKEN override the saved login.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { upload } = require('@vercel/blob/client');
const { TARGETS_BY_PREFIX } = require('../../api/_uploadTargets');
const { refreshStatsForPrefix } = require('../stats/refresh-stats');

const CRED_FILE = path.join(os.homedir(), '.foresttrace', 'credentials.json');
const MULTIPART_BYTES = 50 * 1024 * 1024;
const BATCH = 1000; // server's per-request limit for check/complete

// ---------- small helpers ----------

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { positional: [], concurrency: 3 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--yes' || a === '-y') opts.yes = true;
    else if (a === '--overwrite') opts.overwrite = true;
    else if (a === '--no-stats') opts.noStats = true;
    else if (a === '--layer') opts.layer = argv[++i];
    else if (a === '--url') opts.url = argv[++i];
    else if (a === '--concurrency') opts.concurrency = Math.max(1, Number(argv[++i]) || 3);
    else if (a.startsWith('--')) fail(`Unknown option ${a}`);
    else opts.positional.push(a);
  }
  return opts;
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function mb(bytes) {
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

/** Prompt without echoing what is typed. */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.stdoutMuted = false;
    rl._writeToOutput = function writeToOutput(s) {
      if (!rl.stdoutMuted) rl.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    rl.stdoutMuted = true;
  });
}

// ---------- credentials ----------

function loadCreds() {
  const saved = (() => {
    try { return JSON.parse(fs.readFileSync(CRED_FILE, 'utf8')); } catch (_) { return {}; }
  })();
  const url = (process.env.FORESTTRACE_URL || saved.url || '').replace(/\/+$/, '');
  const token = process.env.FORESTTRACE_TOKEN || saved.token;
  if (!url || !token) fail('Not signed in. Run: node scripts/storage/upload-cogs.js login --url https://<app>');
  return { url, token, email: saved.email };
}

async function api(creds, method, pathAndQuery, body) {
  let res;
  try {
    res = await fetch(`${creds.url}${pathAndQuery}`, {
      method,
      headers: {
        Authorization: `Bearer ${creds.token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    fail(`Could not reach ${creds.url} (${err.cause?.code || err.message}). Is the address right and the app running?`);
  }
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) fail('Your login has expired. Run the login command again.');
  if (!res.ok) throw new Error(json.error || `${method} ${pathAndQuery} failed (${res.status})`);
  return json;
}

async function login(opts) {
  const url = (opts.url || process.env.FORESTTRACE_URL || '').replace(/\/+$/, '');
  if (!url) fail('Give the app address: login --url https://<app>');
  const email = await ask('Email: ');
  const password = await askHidden('Password: ');
  const res = await fetch(`${url}/api/auth?action=login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) fail(json.error || `Login failed (${res.status})`);
  fs.mkdirSync(path.dirname(CRED_FILE), { recursive: true });
  fs.writeFileSync(CRED_FILE, JSON.stringify({ url, token: json.token, email: json.user.email }, null, 2), { mode: 0o600 });
  console.log(`Signed in as ${json.user.email}. Saved to ${CRED_FILE} (valid 30 days).`);
  if (!json.user.canUpload) console.log('Note: you have no upload access yet -- ask an admin to grant you layers.');
}

// ---------- finding files ----------

function tifsIn(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && /\.tiff?$/i.test(d.name))
    .map((d) => d.name)
    .sort();
}

/** [{ prefix, dir, fileName }] for everything the folder argument points at. */
function collect(folder, layer) {
  const abs = path.resolve(folder);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) fail(`Not a folder: ${abs}`);
  const items = (prefix, dir) => tifsIn(dir).map((fileName) => ({ prefix, dir, fileName }));

  if (layer) {
    if (!TARGETS_BY_PREFIX.has(layer)) fail(`Unknown layer ${layer}. Known: ${[...TARGETS_BY_PREFIX.keys()].join(', ')}`);
    return items(layer, abs);
  }
  const base = path.basename(abs);
  if (TARGETS_BY_PREFIX.has(base)) return items(base, abs);

  const found = [];
  for (const d of fs.readdirSync(abs, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    if (TARGETS_BY_PREFIX.has(d.name)) found.push(...items(d.name, path.join(abs, d.name)));
    else console.log(`  skip folder ${d.name}/ (not a layer name)`);
  }
  if (!found.length) {
    fail(`No layer folders in ${abs}. Name the folder after its layer, or pass --layer <prefix>.\n`
      + `Layers: ${[...TARGETS_BY_PREFIX.keys()].join(', ')}`);
  }
  return found;
}

// ---------- main ----------

async function run(opts) {
  const folder = opts.positional[0];
  if (!folder) fail('Usage: node scripts/storage/upload-cogs.js <folder> [--layer <prefix>] [--dry-run]');
  const creds = loadCreds();
  const files = collect(folder, opts.layer);
  console.log(`Found ${files.length} file(s) in ${new Set(files.map((f) => f.prefix)).size} layer(s). Checking with ${creds.url}…\n`);

  const results = [];
  for (const part of chunk(files, BATCH)) {
    const json = await api(creds, 'POST', '/api/uploads?action=check', {
      items: part.map(({ prefix, fileName }) => ({ prefix, fileName })),
    });
    json.results.forEach((r, i) => results.push({ ...part[i], ...r }));
    if (!json.regionCheck) console.log('  (no manifest yet: region spelling not checked)');
  }

  const ready = results.filter((r) => r.ok);
  const rejected = results.filter((r) => !r.ok);
  const replacing = ready.filter((r) => r.overwrites);
  const byPrefix = (list) => list.reduce((acc, r) => ((acc[r.prefix] ??= []).push(r), acc), {});
  for (const [prefix, list] of Object.entries(byPrefix(results))) {
    const ok = list.filter((r) => r.ok).length;
    console.log(`  ${prefix}: ${ok} ready, ${list.length - ok} rejected`);
  }
  if (rejected.length) {
    console.log('\nRejected:');
    rejected.forEach((r) => console.log(`  ${r.prefix}/${r.fileName}: ${r.error}`));
  }
  if (replacing.length) {
    console.log(`\nWill replace ${replacing.length} existing file(s):`);
    replacing.forEach((r) => console.log(`  ${r.prefix}/${r.fileName}`));
  }

  if (opts.dryRun) {
    console.log(`\n--dry-run: ${ready.length} file(s) would be uploaded, including ${replacing.length} replacement(s).`);
    return;
  }
  if (!ready.length) fail('\nNothing to upload.');
  if (replacing.length && !opts.overwrite) {
    if (!process.stdin.isTTY) {
      fail('\nExisting files would be replaced. Re-run with --overwrite to confirm.');
    }
    const a = await ask(`\nReplace these ${replacing.length} existing file(s)? This changes production data. [y/N] `);
    if (!/^y(es)?$/i.test(a)) fail('Cancelled.');
  }
  if (rejected.length && !opts.yes) {
    if (!process.stdin.isTTY) fail('\nSome files were rejected; re-run with --yes to upload the rest.');
    const a = await ask(`\nUpload the ${ready.length} valid file(s) anyway? They go live immediately. [y/N] `);
    if (!/^y(es)?$/i.test(a)) fail('Cancelled.');
  }

  const totalBytes = ready.reduce((s, r) => s + fs.statSync(path.join(r.dir, r.fileName)).size, 0);
  console.log(`\nUploading ${ready.length} file(s), ${mb(totalBytes)}…`);
  const done = [];
  const failed = [];
  let next = 0;
  async function worker() {
    while (next < ready.length) {
      const r = ready[next];
      next += 1;
      const local = path.join(r.dir, r.fileName);
      try {
        const body = await fs.openAsBlob(local, { type: 'image/tiff' });
        await upload(r.pathname, body, {
          access: 'public',
          handleUploadUrl: `${creds.url}/api/uploads`,
          headers: { Authorization: `Bearer ${creds.token}` },
          contentType: 'image/tiff',
          multipart: body.size > MULTIPART_BYTES,
        });
        done.push(r);
        console.log(`  ok   ${r.pathname}  (${mb(body.size)})  [${done.length + failed.length}/${ready.length}]`);
      } catch (err) {
        failed.push(r);
        console.error(`  FAIL ${r.pathname}: ${err.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.concurrency, ready.length) }, worker));

  if (done.length) {
    console.log('\nRegistering uploads and rebuilding the layer index…');
    let manifestOk = true;
    for (const part of chunk(done, BATCH)) {
      const json = await api(creds, 'POST', '/api/uploads?action=complete', { pathnames: part.map((r) => r.pathname) });
      if (!json.manifestUpdated) {
        manifestOk = false;
        console.error(`  manifest not updated: ${json.manifestError || 'unknown error'} -- ask an admin to rebuild it`);
      }
    }
    if (manifestOk) console.log('  ok  live in the map');
  }

  console.log(`\nDone: ${done.length} uploaded, ${failed.length} failed, ${rejected.length} rejected.`);

  // Same as upload-cogs-vercel.js: regenerate the charts' stats where a
  // generator exists (today: wildfire). Runs here, not on the server, because
  // the generators read local source data.
  if (done.length && !opts.noStats) {
    for (const [prefix, list] of Object.entries(byPrefix(done))) {
      const regions = [...new Set(list.map((r) => r.fileName.match(/^(.+?)(?:_\d{4})?\.tif$/i)?.[1]).filter(Boolean))];
      try {
        refreshStatsForPrefix(prefix, { regions });
      } catch (err) {
        console.error(`  FAIL stats refresh for ${prefix}: ${err.message}`);
      }
    }
  }
  if (failed.length) process.exitCode = 1;
}

(async () => {
  const argv = process.argv.slice(2);
  const opts = parseArgs(argv);
  const cmd = opts.positional[0];
  if (cmd === 'login') return login(opts);
  if (cmd === 'logout') {
    fs.rmSync(CRED_FILE, { force: true });
    return console.log('Signed out.');
  }
  return run(opts);
})().catch((err) => fail(err.message || String(err)));
