/**
 * Browser uploads of COGs straight into the production Blob store.
 *
 * The browser never sees BLOB_READ_WRITE_TOKEN. For each file it asks this
 * route for a client token, which Vercel Blob scopes to that one pathname,
 * expires after a few minutes, accepts only GeoTIFFs and only permits replacing
 * existing files when separately granted. Upload and overwrite access are read
 * from the database on every request, so revoking access takes effect at once.
 *
 *   GET  ?action=targets           folders the current user may upload to
 *   POST ?action=check             validate names before uploading
 *   POST  (handleUpload body)      issue a client token for one file
 *   POST ?action=complete          record finished uploads, rebuild the manifest
 *   GET  ?action=log               recent uploads                       [admin]
 *   POST ?action=delete            delete an uploaded file              [admin]
 *   POST ?action=rebuild-manifest  rebuild cogs/manifest.json           [admin]
 *
 * Charts are NOT updated: their stats are JSON committed under
 * client/public/data and regenerated offline (scripts/stats/refresh-stats.js).
 */

const { handleUpload } = require('@vercel/blob/client');
const { head, del, list, BlobNotFoundError } = require('@vercel/blob');
const { getCollection, getUserFromRequest, getMongoUri } = require('./_db');
const {
  UPLOAD_TARGETS,
  allowedPrefixesFor,
  overwritePrefixesFor,
  validateFileName,
  regionsFromManifest,
  parsePathname,
} = require('./_uploadTargets');
const {
  rebuildManifestVercel,
  MANIFEST_KEY,
} = require('../scripts/storage/generate-cog-manifest-vercel');

const TOKEN_TTL_MS = 15 * 60 * 1000;
const MAX_BYTES = (Number(process.env.UPLOAD_MAX_MB) || 2048) * 1024 * 1024;
// A full caribou run is ~220 files and clearcut writes two folders at once.
const MAX_FILES_PER_BATCH = 1000;

function blobToken() {
  return process.env.BLOB_READ_WRITE_TOKEN;
}

/** The signed-in user's current database record, or null. */
async function loadUser(req) {
  const session = getUserFromRequest(req);
  if (!session?.email) return null;
  const users = await getCollection('users');
  return users.findOne(
    { email: session.email.toLowerCase() },
    { projection: { passwordHash: 0 } },
  );
}

async function blobExists(pathname) {
  try {
    await head(pathname, { token: blobToken() });
    return true;
  } catch (err) {
    if (err instanceof BlobNotFoundError) return false;
    throw err;
  }
}

/**
 * Every blob under cogs/<prefix>/, keyed by pathname. One listing per folder
 * instead of a HEAD per file keeps a several-hundred-file batch inside the
 * function's time limit.
 */
async function listFolder(prefix) {
  const blobs = new Map();
  let cursor;
  do {
    const page = await list({ prefix: `cogs/${prefix}/`, token: blobToken(), cursor, limit: 1000 });
    for (const b of page.blobs || []) blobs.set(b.pathname, b);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

/** listFolder for each distinct prefix, merged into one map. */
async function listFolders(prefixes) {
  const maps = await Promise.all([...new Set(prefixes)].map(listFolder));
  return new Map(maps.flatMap((m) => [...m]));
}

/** Regions already in the manifest, or null if it cannot be read. */
async function knownRegions() {
  try {
    const meta = await head(MANIFEST_KEY, { token: blobToken() });
    const res = await fetch(meta.url, { cache: 'no-store' });
    if (!res.ok) return null;
    return regionsFromManifest(await res.json());
  } catch (_) {
    return null;
  }
}

const EXISTS_ERROR = 'This file already exists -- ask an admin for overwrite access to replace it';

/**
 * Permission and naming check for one upload (no storage lookup).
 * Returns { ok, pathname, error }.
 */
function checkName(userDoc, prefix, fileName, regions) {
  const pathname = `cogs/${prefix}/${fileName}`;
  if (!allowedPrefixesFor(userDoc).includes(prefix)) {
    return { ok: false, pathname, error: `You do not have upload access to ${prefix}` };
  }
  const named = validateFileName(prefix, fileName, regions);
  if (!named.ok) return { ok: false, pathname, error: named.error };
  return { ok: true, pathname };
}

function publicUser(userDoc) {
  return { id: userDoc._id.toString(), email: userDoc.email, name: userDoc.name || null };
}

module.exports = async function handler(req, res) {
  if (!getMongoUri()) return res.status(503).json({ error: 'Database service unavailable' });
  if (!blobToken()) return res.status(503).json({ error: 'Blob storage is not configured' });

  const action = (req.query?.action || '').toLowerCase();
  const body = req.body || {};

  try {
    const userDoc = await loadUser(req);
    if (!userDoc) return res.status(401).json({ error: 'Sign in to upload data.' });
    const isAdmin = userDoc.role === 'admin';
    const uploads = await getCollection('cog_uploads');

    // Token requests come from @vercel/blob/client's upload(), which posts its
    // own body ({ type: 'blob.generate-client-token', ... }) with no action.
    if (req.method === 'POST' && typeof body.type === 'string' && body.type.startsWith('blob.')) {
      const result = await handleUpload({
        body,
        request: req,
        token: blobToken(),
        onBeforeGenerateToken: async (pathname) => {
          const parts = parsePathname(pathname);
          if (!parts) throw new Error('Uploads must go to cogs/<folder>/<file>.tif');
          const check = checkName(userDoc, parts.prefix, parts.fileName, await knownRegions());
          if (!check.ok) throw new Error(check.error);
          const canOverwrite = overwritePrefixesFor(userDoc).includes(parts.prefix);
          if (await blobExists(pathname) && !canOverwrite) throw new Error(EXISTS_ERROR);
          return {
            allowedContentTypes: ['image/tiff'],
            maximumSizeInBytes: MAX_BYTES,
            validUntil: Date.now() + TOKEN_TTL_MS,
            addRandomSuffix: false,
            allowOverwrite: canOverwrite,
            cacheControlMaxAge: 31536000,
          };
        },
        // No onUploadCompleted: Vercel's callback cannot reach localhost or a
        // protected preview. The browser calls ?action=complete instead.
      });
      return res.status(200).json(result);
    }

    if (req.method === 'GET' && action === 'targets') {
      const allowed = new Set(allowedPrefixesFor(userDoc));
      const overwriteAllowed = new Set(overwritePrefixesFor(userDoc));
      return res.status(200).json({
        targets: UPLOAD_TARGETS
          .filter((t) => allowed.has(t.prefix))
          .map((t) => ({ ...t, canOverwrite: overwriteAllowed.has(t.prefix) })),
        maxBytes: MAX_BYTES,
      });
    }

    // Body: { items: [{ prefix, fileName }, ...] } -- may span several folders.
    if (req.method === 'POST' && action === 'check') {
      const items = Array.isArray(body.items) ? body.items : [];
      if (items.length === 0) return res.status(400).json({ error: 'items[] is required' });
      if (items.length > MAX_FILES_PER_BATCH) {
        return res.status(400).json({ error: `Check at most ${MAX_FILES_PER_BATCH} files at a time` });
      }
      const regions = await knownRegions();
      const allowed = new Set(allowedPrefixesFor(userDoc));
      const overwriteAllowed = new Set(overwritePrefixesFor(userDoc));
      const existing = await listFolders(items.map((i) => i.prefix).filter((p) => allowed.has(p)));
      const seen = new Set();
      const results = items.map(({ prefix, fileName }) => {
        const r = checkName(userDoc, prefix, fileName, regions);
        let error = r.error || null;
        const exists = existing.has(r.pathname);
        if (r.ok && seen.has(r.pathname)) error = 'Listed twice';
        else if (r.ok && exists && !overwriteAllowed.has(prefix)) error = EXISTS_ERROR;
        seen.add(r.pathname);
        return { prefix, fileName, pathname: r.pathname, ok: !error, error, overwrites: !error && exists };
      });
      return res.status(200).json({ results, regionCheck: Boolean(regions) });
    }

    if (req.method === 'POST' && action === 'complete') {
      const allowed = new Set(allowedPrefixesFor(userDoc));
      const wanted = (Array.isArray(body.pathnames) ? body.pathnames : [])
        .slice(0, MAX_FILES_PER_BATCH)
        .map((p) => ({ pathname: p, parts: parsePathname(p) }))
        .filter((x) => x.parts && allowed.has(x.parts.prefix));
      const stored = await listFolders(wanted.map((x) => x.parts.prefix));
      const ops = [];
      for (const { pathname, parts } of wanted) {
        const blob = stored.get(pathname);
        if (!blob) continue;
        ops.push({
          updateOne: {
            filter: { pathname },
            update: {
              // $set, not $setOnInsert: a path an admin deleted can be uploaded
              // again, and the row should then describe the new file.
              $set: {
                pathname,
                prefix: parts.prefix,
                url: blob.url,
                size: blob.size,
                uploadedAt: blob.uploadedAt ? new Date(blob.uploadedAt) : new Date(),
                uploadedBy: publicUser(userDoc),
              },
              $unset: { deletedAt: '', deletedBy: '' },
            },
            upsert: true,
          },
        });
      }
      if (ops.length) await uploads.bulkWrite(ops, { ordered: false });
      const recorded = ops.map((o) => o.updateOne.filter.pathname);

      let manifestUpdated = false;
      let manifestError = null;
      if (recorded.length) {
        try {
          await rebuildManifestVercel({ token: blobToken(), quiet: true });
          manifestUpdated = true;
        } catch (err) {
          manifestError = err.message;
          console.error('[uploads] manifest rebuild failed', err);
        }
      }
      return res.status(200).json({ recorded, manifestUpdated, manifestError });
    }

    // ---- admin only below ----
    if (!isAdmin) return res.status(403).json({ error: 'Administrator privileges required.' });

    if (req.method === 'GET' && action === 'log') {
      const rows = await uploads.find({}).sort({ uploadedAt: -1 }).limit(200).toArray();
      return res.status(200).json({
        uploads: rows.map((r) => ({
          pathname: r.pathname,
          prefix: r.prefix,
          url: r.url,
          size: r.size,
          uploadedAt: r.uploadedAt,
          uploadedBy: r.uploadedBy,
          deletedAt: r.deletedAt || null,
          deletedBy: r.deletedBy || null,
        })),
      });
    }

    if (req.method === 'POST' && action === 'delete') {
      const { pathname } = body;
      // Only files that came through this upload route; production data put
      // there by the CLI scripts is out of reach of this button.
      const row = pathname && await uploads.findOne({ pathname, deletedAt: { $exists: false } });
      if (!row) return res.status(404).json({ error: 'No live upload with that path' });
      await del(pathname, { token: blobToken() });
      await uploads.updateOne(
        { pathname },
        { $set: { deletedAt: new Date(), deletedBy: publicUser(userDoc) } },
      );
      await rebuildManifestVercel({ token: blobToken(), quiet: true });
      return res.status(200).json({ success: true });
    }

    if (req.method === 'POST' && action === 'rebuild-manifest') {
      const manifest = await rebuildManifestVercel({ token: blobToken(), quiet: true });
      return res.status(200).json({ success: true, generatedAt: manifest.generatedAt });
    }

    return res.status(400).json({ error: `Unknown uploads action: ${action || '(none)'}` });
  } catch (err) {
    console.error('[uploads]', err);
    return res.status(400).json({ error: err.message || 'Upload service error' });
  }
};
