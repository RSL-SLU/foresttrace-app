# Contributing to ForestTrace

## Project structure

```
foresttrace-app/
├── client/                          # React front-end (Create React App)
│   ├── public/
│   │   ├── tiles/                   # Local tiles for development (gitignored)
│   │   └── data/
│   │       └── clearcut_stats.json  # Precomputed area statistics
│   └── src/
│       ├── App.js                   # Main application layout & MODULES array registry
│       ├── config.js                # TILES_BASE_URL / DATA_BASE_URL / COG_BASE_URL routing
│       ├── context/
│       │   └── AuthContext.js       # Auth provider, user session & role state
│       ├── components/
│       │   ├── TopMenu.jsx          # Contextual header (landing anchor vs. app nav)
│       │   ├── LandingPage.jsx      # Landing page with section anchor IDs
│       │   ├── AdminDashboard.jsx   # Admin user management & metrics modal
│       │   ├── AuthModal.jsx        # Login, registration, code verification & bootstrap
│       │   ├── BugReportModal.jsx   # Context-aware user feedback & issue reporting
│       │   ├── UserChatHistoryModal.jsx # User AI chat session history
│       │   ├── RasterTileLayer.jsx  # Leaflet path: canvas-based PNG tile renderer
│       │   └── MapLibreMap.jsx      # MapLibre path: WebGL renderer, draws COGs directly
│       ├── modules/                 # One JSX file per analysis module
│       │   ├── ModuleTemplate.jsx   # Start here when adding a module
│       │   ├── ClearcutDetection.jsx
│       │   ├── BiomassModule.jsx
│       │   ├── WildfireModule.jsx
│       │   └── CaribouHabitatModule.jsx
│       ├── pages/                   # Static and technical docs pages
│       │   └── DocumentationPage.jsx
│       └── utils/
│           └── clearcutAreaStats.js # Stats helpers (reads clearcut_stats.json)
├── api/                             # Serverless backend functions & Express handlers
│   ├── _db.js                       # MongoDB connection pooling & database selector
│   ├── auth.js                      # User registration, login & sessions
│   ├── admin.js                     # Admin dashboard API & role management
│   ├── reports.js                   # Bug reports & map state snapshots
│   └── chat.js                      # Forestry AI Assistant Groq proxy
├── index.js                         # Express server for dev API & production bundle serving
├── scripts/                         # Offline tools (see scripts/README.md)
│   ├── storage/                     # Vercel Blob uploads & COG manifest
│   ├── stats/                       # Chart stats (refresh-stats.js)
│   ├── data/                        # FMU boundary download & simplification
│   ├── admin/                       # reset-password.js
│   └── legacy/                      # Old PNG-tile scripts, reference only
├── package.json                     # Root: Express dev server dependencies
├── .env.example                     # Template for backend & environment configuration
├── client/.env.example              # Template for client-side API keys and flags
└── .env.vercel.example              # Template for Vercel Blob credentials (production COGs)
```

## Development setup

### 1. Install dependencies

```bash
npm install          # root (Express server, MongoDB, scripts)
cd client && npm install
cd ..
```

### 2. Configure environment variables

Create the root `.env` from the template:

```bash
cp .env.example .env
```

Key variables in the root `.env`:
- `APP_MODE=development`: Enforces local development behavior and routes MongoDB operations to the `foresttrace_dev` database.
- `GROQ_API_KEY`: Required for the Forestry AI Assistant (`/api/chat`).
- `MONGODB_URI`: Connection string to MongoDB Atlas.
- `MONGODB_DB_NAME=foresttrace_dev`: Explicitly specifies the database name (default: `foresttrace_dev` in development).

Create `client/.env` from the template:

```bash
cp client/.env.example client/.env
```

Key variables in `client/.env`:
- `REACT_APP_GOOGLE_MAPS_API_KEY`: Required for Google Places search in the map.
- `REACT_APP_USE_MAPLIBRE=true`: Enables the MapLibre GL WebGL renderer.
- `REACT_APP_USE_COG_CLEARCUT=true`: Decodes COGs directly in-browser.
- `BROWSER=none`: Prevents Create React App from opening a new browser window on startup.

### 3. Start the application

Run both the Express backend API (port 3001) and Create React App (port 3000) simultaneously:

```bash
npm run dev
```

The React app will be available at `http://localhost:3000`. API requests to `/api/*` are automatically proxied to the Express backend running on port 3001.

### 4. First-run Admin setup & authentication

When launching with an empty database or fresh clone:
1. ForestTrace checks user count. If zero, it sets `isInitialized: false`.
2. The navigation badge displays **Setup Admin**.
3. Clicking it opens the bootstrap modal where the first user creates their admin account.
4. Accounts sign in with email + password. To reset any account's password, including the admin's, run `node scripts/admin/reset-password.js <email> --db <foresttrace|foresttrace_preview|foresttrace_dev>` -- it prompts for the new password and uses the API's own hashing.

### 5. Managing background processes (Windows)

If you ever need to stop lingering Node dev processes running in the background:
- **PowerShell**: `Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force`
- **Command Prompt**: `taskkill /F /IM node.exe`

In development, `REACT_APP_TILES_BASE_URL` is empty so tiles are read from
`client/public/tiles/` via the CRA dev server, with anything missing proxied to
the Vercel Blob store. In production (Vercel), it is set to the Blob store's
public URL.

---

## Map renderers: Leaflet vs. MapLibre

The app can draw the map two ways, chosen at build time by env vars in
`client/.env` (unset = off):

```bash
REACT_APP_USE_MAPLIBRE=true          # switch from Leaflet to the MapLibre GL renderer
REACT_APP_USE_COG_CLEARCUT=true      # on the MapLibre path, draw clearcut from COGs instead of PNG tiles
```

- **Leaflet** (`MapContainer` in `App.js`, tiles via `RasterTileLayer.jsx`) is
  the renderer every visitor gets today. It reads pre-generated PNG XYZ tile
  pyramids and tints them per-pixel on a canvas.
- **MapLibre GL** (`MapLibreMap.jsx`, lazy-loaded so its ~400 kB bundle cost is
  only paid when the flag is on) is a WebGL renderer being brought to parity
  with the Leaflet path (stats tallying, biomass, etc. are still catching up).
  With `REACT_APP_USE_COG_CLEARCUT` also on, it reads **Cloud-Optimized
  GeoTIFFs (COGs)** directly — range-read over HTTP, so no tiling step or
  pyramid is needed for that layer. Without a COG for a given region/year, the
  MapLibre path falls back to the same PNG tiles Leaflet uses.

Both paths read the same underlying data; which one a given deployment runs is
purely an env var choice. See `client/src/config.js` for how a layer resolves
to a COG prefix (`cogPrefixForLayer`) versus a PNG tile URL, and the
[COG availability manifest](#cog-availability-manifest) section below for how
the app knows which region/year COGs actually exist.

---

## Adding a new analysis module

### 1. Create the component

Copy `client/src/modules/ModuleTemplate.jsx` and rename it:

```jsx
// client/src/modules/MyModule.jsx
function MyModule({ data }) {
  // data props available: percentage, selectedFMUs, selectedYear,
  // selectedSensor, onSensorChange, opacity, biomassHistogram
  return (
    <div className="clearcut-module">
      <div className="module-section">
        <h3>My Analysis</h3>
        <p>Region: {data.selectedFMUs?.[0]}</p>
      </div>
    </div>
  );
}

export default MyModule;
```

### 2. Register it in App.js

```js
// client/src/App.js
import MyModule from './modules/MyModule';

const MODULES = [
  // ... existing modules ...
  {
    id: 'my-module',
    name: 'My Module',
    icon: '🌍',
    description: 'Short description shown in the sidebar',
    component: MyModule,
    temporalOptions: {
      yearRange: [2015, 2024],          // [min, max] for the year slider
      availableYears: [2015, 2020, 2024], // optional: discrete year list
    },
    layers: [
      {
        id: 'my-layer',
        name: 'My Layer',
        // Tile URL pattern — {region}, {year}, {z}, {x}, {y} are substituted at runtime
        tileUrl: `${TILES_BASE_URL}/tiles/my-layer/{region}_{year}/{z}/{x}/{y}.png`,
        color: '#00BFFF',
        mode: 'annual',   // 'annual' | 'accumulated'
        tms: false,
      },
    ],
  },
];
```

Tiles are rendered by `RasterTileLayer`, which applies per-pixel canvas tinting
using the layer's `color`. If your layer needs custom rendering (e.g. a
different color formula), add a branch in
`client/src/components/RasterTileLayer.jsx` keyed on `layerId`.

This `tileUrl` pattern is the PNG-tile path. New layers should draw from COGs
instead: give the layer a `cog` entry and no `tileUrl`. See
[Using uploaded COGs in a module](#using-uploaded-cogs-in-a-module).

### 3. Add statistics (optional)

If your module displays chart data derived from tiles, add a key to
`client/public/data/clearcut_stats.json`:

```json
{
  "wabigoon_my_layer": {
    "2015": 12345.6,
    "2020": 23456.7
  }
}
```

Then read it in your component via a utility in
`client/src/utils/clearcutAreaStats.js` (or add your own `utils/myStats.js`
following the same `loadStats()` singleton pattern).

---

## Raster tiles (biomass)

Clearcut, wildfire and caribou draw from COGs (see
[How COGs are stored and read](#how-cogs-are-stored-and-read)). Biomass is the
only layer still drawn from PNG tiles, in the standard XYZ pyramid:

```
tiles/<layer>/<region>_<year>/<z>/<x>/<y>.png
```

The tiles live in `client/public/tiles/`, which the dev server serves directly,
and are published to Vercel Blob under the same paths:

```bash
node scripts/storage/upload-data-vercel.js tiles/biomass --dry-run
node scripts/storage/upload-data-vercel.js tiles/biomass
```

| Environment | `REACT_APP_TILES_BASE_URL` | Tile source |
|-------------|---------------------------|-------------|
| Development | *(empty)* | `client/public/tiles/`, then the Blob store via `setupProxy.js` |
| Production  | `https://<id>.public.blob.vercel-storage.com` | Vercel Blob |

Set `REACT_APP_TILES_BASE_URL` in the Vercel project settings (not in a
committed `.env` file). The PNG-tile generators of the earlier pipeline are
kept in `scripts/legacy/` for reference only.

---

## Area statistics

The charts read precomputed, committed JSON in `client/public/data/`
(`clearcut_stats.json`, `wildfire_stats.json`, ...), not the rasters. Whenever
a module's COGs are regenerated or gain a region or year, refresh its stats and
commit them. `scripts/storage/upload-cogs-vercel.js` does the refresh
automatically after each upload; to run it by hand:

```bash
node scripts/stats/refresh-stats.js clearcut --region wabigoon
git add client/public/data/clearcut_stats.json
git commit -m "chore: update clearcut_stats for wabigoon 2025"
```

Clearcut stats come from `compute_clearcut_stats_cog.py` in the
boreal-canada-mapping repo (set `PYTHON` to an environment with rasterio). See
[scripts/README.md](scripts/README.md) for every module's generator and inputs.
Do not use `scripts/legacy/compute-clearcut-stats.js`: it counts pixels in the
old PNG tiles and would overwrite the chart's numbers.

Accuracy metrics (precision / recall / F1 per year) are stored alongside the
area values under `<region>_<sensor>_accuracy` and are populated manually from
the training notebooks in `boreal-canada-mapping/notebooks/`.

---

## Clearcut patch vectors

`client/public/data/patches/<region>_<year>.json` holds the largest detected
clearcut patches for a region and year, as GeoJSON with a `rank` and `areaHa`
per feature. The Forestry AI Agent uses them to answer "highlight the biggest
clearcuts": the model chooses the query, and every coordinate comes from these
files rather than from the model.

Unlike `clearcut_stats.json`, these are **not committed** — they are bulk
generated geodata (~1.8 MB across the years) and are gitignored alongside
`client/public/data/regions/`. A fresh clone therefore has none, and
`highlight_patches` will refuse until you either point the app at the Blob
store or generate them locally.

### Generating them

The extraction lives in the `boreal-canada-mapping` repo, because it reads the
per-year classified rasters and shares the accumulation rule with them. It
needs that repo's Python environment (rasterio, shapely, pyproj):

```bash
cd ../boreal-canada-mapping
python scripts/extract_clearcut_patches.py \
    --results-dir /path/to/results \
    --out-dir     ../foresttrace-app/client/public/data/patches \
    --region wabigoon
```

`--results-dir` must contain `clearcut_definition/` (the per-year classified
rasters). Patches below `--min-ha` (default 5) are dropped as speckle, and
`--top` (default 50) caps how many are published per year — the file is fetched
by the browser, so that is a size budget as much as a data choice.

Regenerate whenever the accumulation rule changes: the patches are derived from
the same accumulated masks the map draws, so a rule change makes them stale.

### Publishing them

```bash
node scripts/storage/upload-data-vercel.js data/patches
```

`upload-data-vercel.js` gives `.json` a short revalidating cache (5 minutes,
unlike the immutable one COGs get under their versioned prefixes) precisely
because these are regenerated in place under the same filenames.

They are read through `REACT_APP_DATA_BASE_URL`, so the same routing as the
boundary files applies: empty in development (served from `client/public/`),
set to the Blob store in production.

---

## How COGs are stored and read

Clearcut, wildfire and caribou are drawn from Cloud-Optimized GeoTIFFs (COGs). This section explains how the files are laid out and read, so you know what a file must look like before it goes to production.

### One file per FMU (and per year)

Each map layer reads one folder, and each file in it covers a **whole FMU**:

```
cogs/<layer>/<region>_<year>.tif     yearly layers   e.g. cogs/clearcut-status-v2/wabigoon_2021.tif
cogs/<layer>/<region>.tif            static layers   e.g. cogs/logging-scars-v1/wabigoon.tif (one file, every year)
```

- `<layer>` is the layer's folder (its COG prefix). The layer → prefix mapping is in `client/src/App.js` (`cog: { prefix }`) and `client/src/config.js` (`COG_PREFIX_BY_LAYER`).
- `<region>` is the app's FMU id (lowercase, no separators: `dogrivermatawin`, `troutlake`), as in `client/public/data/regions/<id>.json`. Caribou's range layer `caribou-v1` uses range ids instead.
- A file only appears in the map once it is listed in `cogs/manifest.json` (see below).

This replaced the PNG tile pyramids: caribou went from 882,116 tiles to 297 files.

### The browser downloads only the parts it needs

The MapLibre renderer reads COGs through `@geomatico/maplibre-cog-protocol` (registered as `cog://` in `client/src/components/MapLibreMap.jsx`), which uses `geotiff.js` underneath. For each map tile on screen it:

1. reads the file's **header**, a few KB at the start, which records where every block of the image sits in the file;
2. works out which blocks cover that tile at the current zoom;
3. downloads **only those bytes** with HTTP range requests (`Range: bytes=…`), which Vercel Blob serves directly.

That only works because of how the file is laid out inside:

```
wabigoon_2021.tif
├─ header                      where every block is
├─ full resolution, 512×512 blocks    ← zoomed in: only the blocks in view are fetched
├─ overview ½ resolution
├─ overview ¼ resolution
└─ overview ⅛ …                       ← zoomed out: a few small blocks cover the whole FMU
```

Zoomed out, a whole FMU loads from a few small, low-resolution blocks. Zoomed in, only the full-resolution blocks inside the view are fetched. A clearcut status file is 2–4.5 MB and a SCANFI file about 60 MB, but a pan or zoom only moves a few blocks of either.

### What a production COG must be

| Property | Required | Why |
|---|---|---|
| Layout | Real COG (GDAL `driver='COG'`): tiled, overviews, header first | A plain GeoTIFF has no blocks or overviews, so the browser has to download most of the file for any tile |
| Projection | **EPSG:3857** (Web Mercator) | The COG protocol does not reproject; anything else draws in the wrong place |
| Block size | 512 | Matches the other files; keeps requests few and small |
| Overview resampling | **nearest** | Pixels are class codes and years. Averaging creates values that mean nothing (a "2019.5" harvest) |
| Data type and nodata | Integer, with the product's nodata value | The colourers compare pixels against an integer nodata. Clearcut status and logging scars are `uint16` with nodata 65535; ARI is `uint16` with 0 meaning no record; SCANFI is `uint8` with nodata 255 |
| Extent | Clipped to the FMU boundary | Neighbouring FMUs must not overlap or double-count |
| Compression | DEFLATE | Smaller files; every reader supports it |

For the clearcut products (status, accumulated status, ARI, logging scars, SCANFI), `scripts/data/prepare-boreal-cogs.py` produces exactly this from the boreal-canada-mapping outputs, and its output folders are already named by layer:

```
E:/boreal-canada-mapping/foresttrace_cogs/
  clearcut-status-v2/      clearcut-status-acc-v2/      ari-ground-truth-v1/
  logging-scars-v1/        scanfi-v1/
```

Caribou (`caribou_tiling`) and wildfire (the NBAC tiler) are produced outside this repo. Match the files already in production; compare a new file against an existing one with `gdalinfo` (it ships with GDAL, e.g. in the `geo-env` conda environment the preparation script uses) before uploading:

```bash
gdalinfo E:/boreal-canada-mapping/foresttrace_cogs/clearcut-status-v2/wabigoon_2021.tif
# Look for: "LAYOUT=COG", EPSG:3857 ("WGS 84 / Pseudo-Mercator"), Block=512x512, "Overviews:", NoData Value
```

> **The upload checks do not verify any of this.** The upload page and `upload-cogs.js` check the file *name*, the layer access and that the file is new. A plain GeoTIFF, or one in the wrong projection, is accepted, and that FMU and year then loads slowly or draws in the wrong place. The uploader cannot replace it, so it stays broken until an admin deletes it in Admin Dashboard → Data Uploads. Run the `gdalinfo` check, or upload only files produced by the module's preparation script.

---

## Vercel Pro Storage for Production COGs

Production deployments host Cloud-Optimized GeoTIFFs (COGs) and the COG availability manifest on **Vercel Pro Storage (Vercel Blob)**. The remaining PNG tiles and the static data files (FMU boundaries, caribou ranges, patch vectors) are on the same store; see [Raster tiles](#raster-tiles-biomass).

### 1. Setting up Vercel Blob credentials

Copy `.env.vercel.example` to `.env.vercel` in the project root:

```bash
cp .env.vercel.example .env.vercel
```

```ini
# .env.vercel — never commit this file
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...   # Vercel Dashboard → Project/Team → Storage → Blob Store
VERCEL_BLOB_BASE_URL=https://<id>.public.blob.vercel-storage.com
```

### 2. Uploading COGs to Vercel Blob

Use `scripts/storage/upload-cogs-vercel.js` to upload local `.tif`, `.tiff`, and sidecar `.json` files directly to Vercel Blob:

```bash
node scripts/storage/upload-cogs-vercel.js ./cogs cogs/clearcut-accumulated-ari
```

This script:
- Sets `addRandomSuffix: false` and `allowOverwrite: true` so filenames match conventions.
- Sets standard COG headers (`Content-Type: image/tiff`, `Cache-Control: public, max-age=31536000, immutable`).
- **Automatically re-indexes** `cogs/manifest.json` on Vercel Blob upon completion.

### 3. Uploading with an app account (students and collaborators)

Signed-in users can upload COGs into production module folders without ever holding `BLOB_READ_WRITE_TOKEN`. Admins grant access per user and per folder in **Admin Dashboard → Data Uploads**. Admins can upload to every folder. There are two ways in, and both apply the same server-side rules:

**Command line**, right after generating the COGs:

```bash
node scripts/storage/upload-cogs.js login --url https://<app>        # once; saved for 30 days
node scripts/storage/upload-cogs.js E:/boreal-canada-mapping/foresttrace_cogs --dry-run
node scripts/storage/upload-cogs.js E:/boreal-canada-mapping/foresttrace_cogs
```

The folder can be the whole output of `prepare-boreal-cogs.py` (one subfolder per layer, each named after its layer), a single layer folder, or any folder of `.tif` files with `--layer <prefix>`. The tool checks every file first, lists what was rejected and why, and asks before uploading the rest. Afterwards it refreshes chart stats locally the way `upload-cogs-vercel.js` does (only wildfire has a generator today), so commit any changed stats files.

**Browser** (**user menu → Upload Data**): pick the same `foresttrace_cogs/` folder with **Layer: From folder names**, or pick one layer and its files.

- **Live immediately.** Each finished batch rebuilds `cogs/manifest.json`, so the layer appears in the map at once.
- **Replacement is separately granted.** In **Admin Dashboard → Data Uploads**, grant a user **Replace** access for a layer in addition to **Upload** access. They can then replace only files at the same path and filename; uploads ask for confirmation before replacing. The CLI requires `--overwrite` to confirm replacement in non-interactive use. Admins can replace files in every layer. Deletion remains admin-only.
- **The file's contents are not checked.** Only names and access are. Make sure each file meets [What a production COG must be](#what-a-production-cog-must-be) before uploading.
- **Names are checked before uploading:** `<region>_<year>.tif` for yearly layers and `<region>.tif` for static ones, lowercase. The region must already appear somewhere in the manifest, which catches typos. The first file for a brand-new region has to go through the CLI.
- **Browser uploads don't update charts.** Stats JSON under `client/public/data/` is regenerated offline (`scripts/stats/refresh-stats.js`) and committed. The command-line tool runs that refresh for you.

How it works: `api/uploads.js` issues a [client token](https://vercel.com/docs/vercel-blob/client-upload) for each file. The token is locked to that one pathname, expires after 15 minutes, and accepts only `image/tiff`. The server sets `allowOverwrite` only for admins or users with a matching `users.uploadOverwritePrefixes` grant, and rechecks access when issuing each token. Upload access is stored in `users.uploadPrefixes`; both permissions are read on every request, so revocation takes effect immediately. The folders that can be granted are listed in `api/_uploadTargets.js`; add a module's prefix there to make it grantable. Uploads are logged in the `cog_uploads` collection. `UPLOAD_MAX_MB` (default 2048) caps the file size.

### 4. Using uploaded COGs in a module

An upload only puts files in a folder (`cogs/<prefix>/`) and adds them to the manifest. A module shows them through a layer that names that folder.

**Adding regions or years to a layer that already exists needs no code.** For example, uploading `gordoncosens_2025.tif` to `clearcut-status-acc-v2`:

- The manifest now lists `gordoncosens: [2025]` under that prefix.
- The "AI Model: Accumulated Cuts" layer in `App.js` already points at `clearcut-status-acc-v2`.
- The next time someone selects Gordon Cosens and 2025, the layer draws it.

The one exception is a year the module doesn't offer yet. The year slider uses the module's `temporalOptions.availableYears` in `App.js`, so add the year there, or the map can't reach it.

**A new product needs a new folder and a layer.** Say a student produces a regrowth classification:

1. **Pick a versioned prefix**, e.g. `regrowth-v1`. If the product changes later, upload it as `regrowth-v2` rather than replacing files, since COGs are cached as immutable.
2. **Make it uploadable.** Add the prefix to `UPLOAD_TARGETS` in `api/_uploadTargets.js` (`yearly` for `<region>_<year>.tif`, `static` for `<region>.tif`). Then grant it in Admin → Data Uploads.
3. **Upload the files** with the commands in §3, from a folder named `regrowth-v1/`.
4. **Declare the layer** in the module's `layers` in `client/src/App.js`:

   ```js
   {
     id: 'regrowth',
     name: 'Forest Regrowth',
     color: '#16a34a',              // legend swatch
     cogAuthoritative: true,        // COG only: no PNG tiles to fall back to
     cog: {
       prefix: 'regrowth-v1',       // = the upload folder, cogs/regrowth-v1/
       // static: true,             // for one file per FMU (<region>.tif)
       colorFn: (year, opts) => regrowthColorFn(year),
     },
   },
   ```

   For each selected FMU, the app checks the manifest and requests `${COG_BASE_URL}/cogs/regrowth-v1/<region>_<year>.tif`. It builds that URL itself (`cogUrlForPrefix` in `client/src/config.js`); modules don't write it.
5. **Say how pixels become colours.** Put the function next to the existing ones in `client/src/utils/borealLayers.js` (`statusColorFn`, `scarsColorFn`, `ariColorFn`). It receives one pixel's band values and fills an RGBA colour:

   ```js
   // Band 0: 0 = no regrowth, 1 = regrowing, 2 = recovered; 255 = nodata
   const REGROWTH_COLORS = { 1: [250, 204, 21], 2: [22, 163, 74] };

   export function regrowthColorFn(year) {
     return (pixel, color) => {
       const rgb = REGROWTH_COLORS[pixel[0]];
       color.set(rgb ? [...rgb, 255] : [0, 0, 0, 0]);   // anything else: transparent
     };
   }
   ```

   A function that depends on a panel setting (like the AI confidence slider) reads it from `opts`. It also needs a `variant: (opts) => ...` key, so changing the setting redraws the layer. `clearcut-status-v2` is an example.

**Reading values in code** (for a chart, a click readout or a search) uses the same file. `readLevel(url, bands)` in `client/src/utils/cogFinder.js` returns a whole-FMU grid from the smallest overview that fits:

```js
import { cogUrlForPrefix } from '../config';
import { readLevel } from '../utils/cogFinder';

const url = cogUrlForPrefix('regrowth-v1', 'wabigoon', 2025);
const { width, height, data } = await readLevel(url, [0]);   // band 0, at most 1400 px across
```

For full resolution over a small area, open it with geotiff.js's `fromUrl(url)` and pass `readRasters` a `window`. Only the blocks under that window are downloaded.

---

## COG availability manifest

`cogs/manifest.json` lists which region/year COGs exist, per versioned prefix. The app reads it before requesting any COG; without it, selecting all 39 FMUs issued ~195 HEAD probes at once and left the FMU boundaries queued behind lookups for regions that have no COGs at all.

It is **generated, never committed** — it describes the storage bucket/store rather than the source tree, so a checked-in copy goes stale the moment anyone uploads.

  `scripts/storage/upload-cogs-vercel.js` and the in-app uploads rebuild it automatically. You can also re-index manually:
  ```bash
  node scripts/storage/generate-cog-manifest-vercel.js --dry-run   # preview manifest
  node scripts/storage/generate-cog-manifest-vercel.js             # rebuild and publish to Vercel Blob
  ```

---

## Deployment

The app is deployed on Vercel. Pushes to `main` trigger automatic deploys. Serverless API routes live under `api/` and are deployed as Vercel Functions.

Environment variables required in Vercel project settings:

| Variable | Required In | Purpose |
|----------|-------------|---------|
| `REACT_APP_COG_BASE_URL` | Production (Vercel) | Vercel Blob store public base URL (`https://<id>.public.blob.vercel-storage.com`) |
| `BLOB_READ_WRITE_TOKEN` | Production & Build/CLI | Vercel Blob store access token (generated in Vercel Storage) |
| `REACT_APP_TILES_BASE_URL` | Production (Vercel) | Vercel Blob store public base URL, for the biomass PNG tiles |
| `REACT_APP_DATA_BASE_URL` | Production (Vercel) | Vercel Blob store public base URL, for boundaries, caribou ranges and patch vectors |
| `REACT_APP_GOOGLE_MAPS_API_KEY` | Client (Browser) | Google Places search |
| `GROQ_API_KEY` | Serverless (`api/chat.js`) | ForestryAI assistant — read server-side only |
| `VERCEL_MONGODB_URI` / `MONGODB_URI` | Serverless | MongoDB Atlas URI for user authentication, bug reports, and chat logs |
| `MONGODB_DB_NAME` | Serverless (Optional) | Database name override (defaults to `foresttrace` in prod, `foresttrace_preview` on preview, `foresttrace_dev` locally) |
| `AUTH_SECRET` | Serverless (**required**) | JWT signing secret for sign-in sessions and upload access. Without it the code falls back to a built-in secret, so anyone could forge an admin session |
| `ANTHROPIC_API_KEY` | Serverless (`api/storymaps.js`) | Claude Sonnet 5 for story map generation — read server-side only |

`GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `VERCEL_MONGODB_URI`, `MONGODB_URI`, `AUTH_SECRET`, and `BLOB_READ_WRITE_TOKEN` must **not** use the `REACT_APP_` prefix — that prefix causes Create React App to bundle the value into the client JavaScript, exposing it in the browser. None of these go in a committed `.env` file.
