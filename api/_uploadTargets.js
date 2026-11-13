/**
 * The production COG folders that users can be granted upload access to, and
 * the file-name rules each one enforces.
 *
 * Uploads go live as soon as they finish and cannot replace an existing file,
 * so a mistyped name cannot be fixed by the uploader -- only an admin can
 * delete it. The rules below exist to stop those mistakes before the upload:
 * the names must match what the COG manifest indexes
 * (scripts/storage/generate-cog-manifest-vercel.js) or the app never sees the
 * file.
 *
 *   yearly  cogs/<prefix>/<region>_<year>.tif
 *   static  cogs/<prefix>/<region>.tif   (one file covering every year)
 *
 * Adding a module: add its prefix here. Removing a prefix here revokes it for
 * everyone, even users whose stored list still names it.
 */

const UPLOAD_TARGETS = [
  { prefix: 'caribou-fmu-v1', label: 'Caribou habitat (per FMU)', module: 'caribou', kind: 'yearly' },
  { prefix: 'caribou-v1', label: 'Caribou habitat (per range)', module: 'caribou', kind: 'yearly' },
  { prefix: 'wildfire-v3', label: 'Wildfire burned area', module: 'wildfire', kind: 'yearly' },
  { prefix: 'clearcut-status-v2', label: 'Clearcut AI status (annual)', module: 'clearcut', kind: 'yearly' },
  { prefix: 'clearcut-status-acc-v2', label: 'Clearcut AI status (accumulated)', module: 'clearcut', kind: 'yearly' },
  { prefix: 'clearcut-annual-ari', label: 'Clearcut ARI (annual)', module: 'clearcut', kind: 'yearly' },
  { prefix: 'clearcut-accumulated-ari', label: 'Clearcut ARI (accumulated)', module: 'clearcut', kind: 'yearly' },
  { prefix: 'ari-ground-truth-v1', label: 'ARI ground truth', module: 'clearcut', kind: 'static' },
  { prefix: 'logging-scars-v1', label: 'Logging scars', module: 'clearcut', kind: 'static' },
  { prefix: 'scanfi-v1', label: 'SCANFI', module: 'clearcut', kind: 'static' },
];

const TARGETS_BY_PREFIX = new Map(UPLOAD_TARGETS.map((t) => [t.prefix, t]));

const YEARLY_NAME = /^([a-z0-9]+)_(\d{4})\.tif$/;
const STATIC_NAME = /^([a-z0-9]+)\.tif$/;
const MIN_YEAR = 1985;

/** Prefixes a user may upload to. Admins get every target. */
function allowedPrefixesFor(userDoc) {
  if (!userDoc) return [];
  if (userDoc.role === 'admin') return UPLOAD_TARGETS.map((t) => t.prefix);
  const granted = Array.isArray(userDoc.uploadPrefixes) ? userDoc.uploadPrefixes : [];
  return granted.filter((p) => TARGETS_BY_PREFIX.has(p));
}

/**
 * Check one file name against a target's naming rule.
 *
 * @param {string} prefix - target prefix, e.g. 'caribou-fmu-v1'
 * @param {string} fileName - bare file name, e.g. 'troutlake_2021.tif'
 * @param {Set<string>|null} knownRegions - region ids already in the manifest;
 *   null skips the check (manifest unavailable)
 * @returns {{ ok: true, region: string, year: number|null } | { ok: false, error: string }}
 */
function validateFileName(prefix, fileName, knownRegions) {
  const target = TARGETS_BY_PREFIX.get(prefix);
  if (!target) return { ok: false, error: `Unknown upload folder: ${prefix}` };
  if (typeof fileName !== 'string' || !fileName) return { ok: false, error: 'Missing file name' };

  const lower = fileName.toLowerCase();
  if (lower.endsWith('.tiff')) {
    return { ok: false, error: 'Use the .tif extension, not .tiff -- the app only reads .tif' };
  }

  const rule = target.kind === 'yearly' ? YEARLY_NAME : STATIC_NAME;
  const example = target.kind === 'yearly' ? '<region>_<year>.tif' : '<region>.tif';
  const match = fileName.match(rule);
  if (!match) {
    const hint = lower !== fileName && lower.match(rule) ? ' (use lowercase)' : '';
    return { ok: false, error: `Name must be ${example}${hint}` };
  }

  const region = match[1];
  let year = null;
  if (target.kind === 'yearly') {
    year = Number(match[2]);
    const maxYear = new Date().getUTCFullYear() + 1;
    if (year < MIN_YEAR || year > maxYear) {
      return { ok: false, error: `Year ${year} is outside ${MIN_YEAR}-${maxYear}` };
    }
  }

  if (knownRegions && !knownRegions.has(region)) {
    return {
      ok: false,
      error: `Region "${region}" is not in any existing layer -- check the spelling, or ask an admin to add a new region`,
    };
  }

  return { ok: true, region, year };
}

/** Collect every region id the manifest mentions, across all layers. */
function regionsFromManifest(manifest) {
  const regions = new Set();
  for (const byRegion of Object.values(manifest?.prefixes || {})) {
    Object.keys(byRegion).forEach((r) => regions.add(r));
  }
  for (const list of Object.values(manifest?.static || {})) {
    list.forEach((r) => regions.add(r));
  }
  return regions;
}

/** Split 'cogs/<prefix>/<file>' into its parts, or null if it is not that shape. */
function parsePathname(pathname) {
  const m = typeof pathname === 'string' && pathname.match(/^cogs\/([^/]+)\/([^/]+)$/);
  return m ? { prefix: m[1], fileName: m[2] } : null;
}

module.exports = {
  UPLOAD_TARGETS,
  TARGETS_BY_PREFIX,
  allowedPrefixesFor,
  validateFileName,
  regionsFromManifest,
  parsePathname,
};
