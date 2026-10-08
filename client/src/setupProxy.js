const path = require('path');
const express = require('express');
const https = require('https');
const { createProxyMiddleware } = require('http-proxy-middleware');

try { require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') }); } catch (_) {}
try { require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env.vercel') }); } catch (_) {}
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch (_) {}

// A map view fans out into dozens of parallel tile requests, and without a
// keep-alive agent each one opens a fresh TLS connection and a fresh DNS
// lookup. That is what produced the intermittent ENOTFOUND against the bucket:
// it was reachable, the resolver was just being asked hundreds of times a
// second. Pooling connections collapses that to a handful of lookups and makes
// the tiles arrive faster besides.
const keepAliveAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 24,
  timeout: 30000,
});

// Vercel Blob store -- the remote origin for everything not on local disk
// (COGs, and any data or tile file missing from client/public/). R2 is retired.
const BLOB_TARGET = process.env.REACT_APP_COG_BASE_URL
  || process.env.VERCEL_BLOB_BASE_URL
  || process.env.VERCEL_BLOB_PUBLIC;

// client/public/, served first for the routes that also have a Blob fallback.
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Port the Express API (index.js) listens on. Its own default is 3001 -- chosen
// so CRA can hold 3000 -- and this proxy used to point at 5001, so /api/chat got
// ECONNREFUSED even with the server running.
//
// Deliberately NOT falling back to process.env.PORT: CRA uses that for the dev
// server itself, so a developer who sets PORT=3000 would have this proxy dial
// the dev server and loop back into itself.
const API_PORT = process.env.API_PORT || 3001;

// Layers that can be served off disk from outside the repo, for fast iteration
// on a freshly generated pyramid. Set these in client/.env (gitignored) to a
// directory OUTSIDE the repo: 22k+ tiles under client/public/ make the CRA dev
// server crawl at startup, since it scans and watches everything there.
//
// Leave one unset and that layer falls through to client/public/tiles/, then
// the /tiles Blob proxy -- i.e. what production serves. That keeps this file
// free of machine-specific paths, so a fresh clone works with no configuration.
const LOCAL_TILE_DIRS = {
  '/tiles/wildfire': process.env.WILDFIRE_TILES_DIR,
  '/tiles/wildlife/caribou': process.env.CARIBOU_TILES_DIR,
  // Per-range caribou pyramids (range_<range>_<year>), built by
  // caribou_tiling/code/caribou_tiler_range.py. Express matches mount paths on
  // segment boundaries, so this and /tiles/wildlife/caribou stay distinct.
  '/tiles/wildlife/caribou-range': process.env.CARIBOU_RANGE_TILES_DIR,
  // The pre-simplification wildfire pyramid, mounted alongside the live one so
  // the 4 px edge simplification can be compared tile-for-tile in the browser
  // without swapping directories on disk. Purely a local verification aid:
  // nothing requests it by default, and it just 404s when unset.
  '/tiles/wildfire-baseline': process.env.WILDFIRE_BASELINE_TILES_DIR,
};

// Same idea as LOCAL_TILE_DIRS, but for COGs: ARI ground-truth clearcut rasters
// (boreal-canada-mapping's utils/generate_ari_harvest_cogs.py) can be served
// straight off disk. Mounted before the /cogs Blob proxy below, so express
// falls through to Blob for every other prefix unchanged -- this only
// intercepts the two ARI-specific ones.
const LOCAL_COG_DIRS = {
  '/cogs/clearcut-annual-ari': process.env.ARI_CLEARCUT_ANNUAL_COG_DIR,
  '/cogs/clearcut-accumulated-ari': process.env.ARI_CLEARCUT_ACCUMULATED_COG_DIR,
};

// ARI harvest-year PMTiles archive (boreal-canada-mapping's
// utils/generate_ari_harvest_mvt.py). One static file, not a prefix of many --
// mounted the same way so it's reachable at /mvt/wabigoon.pmtiles without a
// bucket round trip.
const ARI_MVT_DIR = process.env.ARI_MVT_DIR;

// Shared config for the Vercel Blob passthroughs.
function blobProxy(prefix) {
  return {
    target: BLOB_TARGET,
    changeOrigin: true,
    agent: keepAliveAgent,
    // Abort an upstream request that stalls. The agent's own `timeout` only
    // flags the socket; without this a hung request keeps its socket forever,
    // and once maxSockets are held that way every proxied route queues behind
    // them indefinitely.
    proxyTimeout: 30000,
    pathRewrite: { [`^${prefix}`]: prefix },
    // A missing tile is normal -- pyramids are sparse -- and a transient DNS
    // failure is not worth a stack trace per tile. Answer the browser and log
    // one line instead of letting the default handler print the full error.
    onError: (err, _req, res) => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`proxy error: ${err.code || err.message}`);
    },
  };
}

module.exports = function (app) {
  // Disk-backed layers first: they need no bucket. express.static calls next()
  // on a miss, so a local directory covering only part of a pyramid still
  // falls through to Blob.
  Object.entries(LOCAL_TILE_DIRS).forEach(([route, dir]) => {
    if (dir) {
      app.use(route, express.static(path.normalize(dir)));
    }
  });

  Object.entries(LOCAL_COG_DIRS).forEach(([route, dir]) => {
    if (dir) {
      app.use(route, express.static(path.normalize(dir)));
    }
  });

  if (ARI_MVT_DIR) {
    app.use('/mvt', express.static(path.normalize(ARI_MVT_DIR)));
  }

  // xfwd: pass the browser's host on, so links the API builds (story map share
  // URLs) point at this dev server rather than at the API's own port.
  app.use(
    '/api',
    createProxyMiddleware({
      target: `http://localhost:${API_PORT}`,
      changeOrigin: true,
      xfwd: true,
    })
  );

  // Public story map URLs -- served by the API (see index.js / vercel.json)
  app.use(
    '/stories',
    createProxyMiddleware({
      target: `http://localhost:${API_PORT}`,
      changeOrigin: true,
      xfwd: true,
    })
  );

  // Per-FMU boundary GeoJSON is NOT proxied: client/public/data/regions/ holds
  // every FMU, and the dev server serves it as a static file.

  if (!BLOB_TARGET) {
    // Warn rather than throw: /api and everything under client/public still work.
    console.warn(
      '[setupProxy] VERCEL_BLOB_BASE_URL is not set in .env.vercel -- skipping the '
        + '/cogs, /data/patches and /tiles proxies. COG layers will not load '
        + 'locally until it is set (see .env.vercel.example).'
    );
    return;
  }

  // COGs are range-read by the browser, and a Range header isn't CORS-safelisted,
  // so every read triggers a preflight the bucket must answer. Proxying them
  // through the dev server makes them same-origin, so local work isn't blocked on
  // the bucket's CORS policy.
  //
  // This is a DEV-ONLY convenience -- react-scripts ignores this file in a
  // production build, where the app reads the bucket directly and the CORS policy
  // is load-bearing. Verifying a COG works locally therefore proves nothing about
  // whether it will work in production.
  app.use('/cogs', createProxyMiddleware(blobProxy('/cogs')));

  // Clearcut patch vectors (drawn-area checks) and PNG tiles (biomass): local
  // copy first, Blob for anything missing from it.
  //
  // The explicit express.static matters. CRA runs this file BEFORE it serves
  // client/public/, so a bare proxy here shadows the local files entirely --
  // which is how local boundaries and biomass tiles ended up fetched remotely.
  ['/data/patches', '/tiles'].forEach((route) => {
    app.use(route, express.static(path.join(PUBLIC_DIR, route)));
    app.use(route, createProxyMiddleware(blobProxy(route)));
  });
};
