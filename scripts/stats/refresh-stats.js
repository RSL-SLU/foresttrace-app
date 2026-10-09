#!/usr/bin/env node
/**
 * Regenerate a module's precomputed stats after its data changes.
 *
 * The charts read JSON files under client/public/data/ that are computed
 * offline, not from the live rasters, so they go stale whenever a module's COGs
 * are regenerated or gain a region/year. This runs the right generator for a
 * module; scripts/storage/upload-cogs-vercel.js calls it after every COG upload.
 *
 * Usage:
 *   node scripts/stats/refresh-stats.js clearcut [--region wabigoon] [-- extra args]
 *   node scripts/stats/refresh-stats.js wildfire
 *   node scripts/stats/refresh-stats.js --for-prefix cogs/wildfire-v3
 *
 * Modules and their inputs (set in .env or client/.env):
 *
 *   clearcut  -> client/public/data/clearcut_stats.json
 *       Runs compute_clearcut_stats_cog.py from the boreal-canada-mapping repo,
 *       which reads the classified rasters the COGs are made from and writes
 *       every field the chart uses (accumulated, annual, entering, carried,
 *       window, ...). One run per region.
 *         BOREAL_REPO_DIR       default: ../boreal-canada-mapping (sibling of this repo)
 *         CLEARCUT_RESULTS_DIR  default: $BOREAL_REPO_DIR/results
 *         PYTHON                default: python (point it at the pipeline's env if needed)
 *
 *   wildfire  -> wildfire_stats.json and wildfire_years.json
 *         WILDFIRE_PLAN_CSV     the NBAC tiler's plan CSV (areas per region/year)
 *         WILDFIRE_TILES_DIR    the NBAC output tiles folder (which years exist)
 *
 *   caribou   -> no generator in either repo yet; caribou_stats.json and
 *                caribou_years.json have to be updated by hand.
 *
 * The stats JSON is served from the deployment (client/public/data is
 * committed), so commit and push the changed files to publish them.
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

// Repo root: this file lives in scripts/<group>/.
const ROOT = path.resolve(__dirname, '..', '..');
try { require('dotenv').config({ path: path.join(ROOT, '.env') }); } catch (_) {}
try { require('dotenv').config({ path: path.join(ROOT, 'client', '.env') }); } catch (_) {}

const DATA_DIR = path.join(ROOT, 'client', 'public', 'data');

/**
 * Which module a COG prefix belongs to, or null when it has no stats of its own.
 * ARI ground truth is excluded: the clearcut chart is computed from the model's
 * rasters, and nothing computes ARI hectares yet.
 */
function moduleForPrefix(prefix) {
  const product = prefix.replace(/^\/*(cogs\/)?/, '').split('/')[0];
  if (/^clearcut-.*-ari$/.test(product)) return null;
  // boreal-canada-mapping handoff products (scripts/data/prepare-boreal-cogs.py):
  // no chart-stats generator for them yet
  if (/^(clearcut-status|ari-ground-truth|logging-scars|scanfi)/.test(product)) return null;
  if (product.startsWith('clearcut')) return 'clearcut';
  if (product.startsWith('wildfire')) return 'wildfire';
  if (product.startsWith('caribou')) return 'caribou';
  return null;
}

function run(cmd, args) {
  console.log(`  $ ${[cmd, ...args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, shell: false });
  if (res.error) throw new Error(`${cmd}: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`${path.basename(args[0] || cmd)} exited with code ${res.status}`);
}

const MODULES = {
  clearcut({ regions = [], extraArgs = [] }) {
    const boreal = process.env.BOREAL_REPO_DIR || path.resolve(ROOT, '..', 'boreal-canada-mapping');
    const script = path.join(boreal, 'compute_clearcut_stats_cog.py');
    const resultsDir = process.env.CLEARCUT_RESULTS_DIR || path.join(boreal, 'results');
    if (!fs.existsSync(script)) {
      return { skipped: `compute_clearcut_stats_cog.py not found in ${boreal} -- set BOREAL_REPO_DIR` };
    }
    if (!fs.existsSync(resultsDir)) {
      return { skipped: `results folder not found at ${resultsDir} -- set CLEARCUT_RESULTS_DIR` };
    }
    const python = process.env.PYTHON || 'python';
    const statsJson = path.join(DATA_DIR, 'clearcut_stats.json');
    // No region given: the generator's own default (wabigoon).
    for (const region of regions.length ? regions : [null]) {
      run(python, [script, '--results-dir', resultsDir, '--stats-json', statsJson,
        ...(region ? ['--region', region] : []), ...extraArgs]);
    }
    return { updated: ['clearcut_stats.json'] };
  },

  wildfire() {
    const missing = ['WILDFIRE_PLAN_CSV', 'WILDFIRE_TILES_DIR'].filter((k) => !process.env[k]);
    if (missing.length) return { skipped: `set ${missing.join(' and ')} in .env` };
    run(process.execPath, [path.join(__dirname, 'generate-wildfire-stats.js'), process.env.WILDFIRE_PLAN_CSV]);
    run(process.execPath, [path.join(__dirname, 'generate-wildfire-years.js'), process.env.WILDFIRE_TILES_DIR]);
    return { updated: ['wildfire_stats.json', 'wildfire_years.json'] };
  },

  caribou() {
    return { skipped: 'no caribou stats generator exists yet -- update caribou_stats.json / caribou_years.json by hand' };
  },
};

/**
 * Refresh one module's stats. Never throws for a missing input: returns
 * { skipped: reason } so an upload isn't reported as failed because of it.
 */
function refreshStats(module, opts = {}) {
  const job = MODULES[module];
  if (!job) return { skipped: `no stats for module "${module}"` };
  console.log(`\nRefreshing ${module} stats…`);
  const result = job(opts);
  if (result.skipped) {
    console.log(`  skipped: ${result.skipped}`);
  } else if ((opts.extraArgs || []).includes('--dry-run')) {
    console.log('  dry run: nothing written');
  } else {
    console.log(`  ok  updated ${result.updated.map((f) => `client/public/data/${f}`).join(', ')}`);
    console.log('  Commit and push the changed stats file(s) to publish them.');
  }
  return result;
}

/** For the upload script: refresh whatever module a COG prefix belongs to. */
function refreshStatsForPrefix(prefix, opts = {}) {
  const module = moduleForPrefix(prefix);
  if (!module) {
    console.log(`\nNo stats to refresh for ${prefix}.`);
    return { skipped: 'no module' };
  }
  return refreshStats(module, opts);
}

module.exports = { refreshStats, refreshStatsForPrefix, moduleForPrefix };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const dashDash = argv.indexOf('--');
  const extraArgs = dashDash === -1 ? [] : argv.slice(dashDash + 1);
  const args = dashDash === -1 ? argv : argv.slice(0, dashDash);

  const regions = [];
  args.forEach((a, i) => { if (a === '--region' && args[i + 1]) regions.push(args[i + 1]); });
  const prefixIdx = args.indexOf('--for-prefix');
  const moduleName = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--region' && args[i - 1] !== '--for-prefix');

  if (prefixIdx === -1 && !moduleName) {
    console.error(`Usage: node scripts/stats/refresh-stats.js <${Object.keys(MODULES).join('|')}> [--region <id>] [-- extra args]`);
    console.error('       node scripts/stats/refresh-stats.js --for-prefix <cogs/prefix>');
    process.exit(1);
  }
  try {
    const opts = { regions, extraArgs };
    const result = prefixIdx !== -1
      ? refreshStatsForPrefix(args[prefixIdx + 1], opts)
      : refreshStats(moduleName, opts);
    process.exitCode = result.skipped ? 2 : 0;
  } catch (err) {
    console.error(`  FAIL ${err.message}`);
    process.exit(1);
  }
}
