/**
 * Browser uploads of COGs straight into the production Blob store.
 *
 * The browser never sees BLOB_READ_WRITE_TOKEN. For each file it asks this
 * route for a client token, which Vercel Blob scopes to that one pathname,
 * expires after a few minutes, accepts only GeoTIFFs and refuses to replace an
 * existing file. Who may upload where is read from the database on every
 * request (users.uploadPrefixes, set from the admin dashboard), so revoking
 * access takes effect at once rather than when the 30-day login expires.
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
const { head, del, BlobNotFoundError } = require('@vercel/blob');
const { getCollection, getUserFromRequest, getMongoUri } = require('./_db');
const {
  UPLOAD_TARGETS,
  allowedPrefixesFor,
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
const MAX_FILES_PER_BATCH = 50;

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

/**
 * Full check of one upload: permission, naming rule, known region, and that
 * nothing already sits at that path. Returns { ok, pathname, error }.
 */
async function checkOne(userDoc, prefix, fileName, regions) {
  const pathname = `cogs/${prefix}/${fileName}`;
  if (!allowedPrefixesFor(userDoc).includes(prefix)) {
    return { ok: false, pathname, error: `You do not have upload access to ${prefix}` };
  }
  const named = validateFileName(prefix, fileName, regions);
  if (!named.ok) return { ok: false, pathname, error: named.error };
  if (await blobExists(pathname)) {
    return { ok: false, pathname, error: 'A file with this name already exists -- existing files cannot be replaced' };
  }
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
          const check = await checkOne(userDoc, parts.prefix, parts.fileName, await knownRegions());
          if (!check.ok) throw new Error(check.error);
          return {
            allowedContentTypes: ['image/tiff'],
            maximumSizeInBytes: MAX_BYTES,
            validUntil: Date.now() + TOKEN_TTL_MS,
            addRandomSuffix: false,
            allowOverwrite: false,
            // COGs are immutable; same header the CLI upload sets.
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
      return res.status(200).json({
        targets: UPLOAD_TARGETS.filter((t) => allowed.has(t.prefix)),
        maxBytes: MAX_BYTES,
      });
    }

    if (req.method === 'POST' && action === 'check') {
      const { prefix, fileNames } = body;
      if (!prefix || !Array.isArray(fileNames) || fileNames.length === 0) {
        return res.status(400).json({ error: 'prefix and fileNames are required' });
      }
      if (fileNames.length > MAX_FILES_PER_BATCH) {
        return res.status(400).json({ error: `Upload at most ${MAX_FILES_PER_BATCH} files at a time` });
      }
      const regions = await knownRegions();
      const seen = new Set();
      const results = [];
      for (const fileName of fileNames) {
        if (seen.has(fileName)) {
          results.push({ fileName, ok: false, error: 'Listed twice' });
          continue;
        }
        seen.add(fileName);
        const r = await checkOne(userDoc, prefix, fileName, regions);
        results.push({ fileName, ok: r.ok, error: r.error || null });
      }
      return res.status(200).json({ results, regionCheck: Boolean(regions) });
    }

    if (req.method === 'POST' && action === 'complete') {
      const pathnames = Array.isArray(body.pathnames) ? body.pathnames.slice(0, MAX_FILES_PER_BATCH) : [];
      const allowed = new Set(allowedPrefixesFor(userDoc));
      const recorded = [];
      for (const pathname of pathnames) {
        const parts = parsePathname(pathname);
        if (!parts || !allowed.has(parts.prefix)) continue;
        let meta;
        try {
          meta = await head(pathname, { token: blobToken() });
        } catch (err) {
          if (err instanceof BlobNotFoundError) continue;
          throw err;
        }
        await uploads.updateOne(
          { pathname },
          {
            // $set, not $setOnInsert: a path an admin deleted can be uploaded
            // again, and the row should then describe the new file.
            $set: {
              pathname,
              prefix: parts.prefix,
              url: meta.url,
              size: meta.size,
              uploadedAt: meta.uploadedAt ? new Date(meta.uploadedAt) : new Date(),
              uploadedBy: publicUser(userDoc),
            },
            $unset: { deletedAt: '', deletedBy: '' },
          },
          { upsert: true },
        );
        recorded.push(pathname);
      }

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
