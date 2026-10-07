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
│   └── legacy/                      # R2 / PNG-tile era, reference only
├── package.json                     # Root: Express dev server dependencies
├── .env.example                     # Template for backend & environment configuration
├── client/.env.example              # Template for client-side API keys and flags
├── .env.r2.example                  # Template for R2 credentials (tiles & dev alternative)
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
`client/public/tiles/` via the CRA dev server. In production (Vercel), the
env var is set to the Cloudflare R2 public URL.

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

This `tileUrl` pattern is what every layer falls back to. If you also want
your layer to draw from a COG on the MapLibre path (see
[Map renderers](#map-renderers-leaflet-vs-maplibre) above), add it to
`COG_PREFIX_BY_LAYER` in `client/src/config.js` instead of duplicating the URL
logic here.

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

## Tile pipeline

> **Legacy.** This section describes the PNG-tile / Cloudflare R2 workflow.
> Clearcut, wildfire and caribou now draw from COGs on Vercel Blob; only
> biomass still uses PNG tiles. The scripts below live in `scripts/legacy/`.
> For the current workflow see [scripts/README.md](scripts/README.md).

Tiles follow the standard XYZ/TMS pyramid structure:

```
tiles/<layer>/<region>_<year>/<z>/<x>/<y>.png
```

### Generating tiles locally

The processing scripts shown below are committed under `scripts/legacy/`. Other
one-off/local tooling scripts (data exploration, cleanup one-shots, etc.) stay
**gitignored** — no reason to version those. Committed scripts accept
`--local` (read/write `client/public/tiles/`) or `--production` (read/write
Cloudflare R2).

```bash
# Generate annual clearcut tiles from accumulated tiles (2-year lookback filter)
node scripts/legacy/generate-annual-clearcut-tiles.js --local wabigoon 2023

# Compute area statistics and write to clearcut_stats.json
node scripts/legacy/compute-clearcut-stats.js --local --annual wabigoon
```

Local tiles are placed under `client/public/tiles/` and served by the CRA dev
server at `http://localhost:3000/tiles/...`.

### Setting up R2 credentials

Copy `.env.r2.example` to `.env.r2` and fill in your values:

```bash
cp .env.r2.example .env.r2
```

```ini
# .env.r2  — never commit this file
CLOUDFLARE_ACCOUNT_ID=   # Cloudflare Dashboard → top-right "Account ID"
R2_ACCESS_KEY_ID=        # R2 → Manage R2 API Tokens → Create token
R2_SECRET_ACCESS_KEY=    # Shown once at token creation
R2_BUCKET_NAME=          # Exact bucket name, e.g. foresttrace-tiles
```

`.env.r2` is listed in `.gitignore` and must never be committed.

### Uploading tiles to Cloudflare R2

`scripts/legacy/upload-tiles.js` is committed to the repo. It reads from
`client/public/tiles/` and mirrors the directory tree to R2. You'll need R2
credentials to run it — ask a maintainer for the token values and fill them
into your own local `.env.r2` (see
[Setting up R2 credentials](#setting-up-r2-credentials) above; that file is
gitignored and must never be committed).

```bash
node scripts/legacy/upload-tiles.js --region wabigoon --layer clearcut-annual --year 2023
```

You can also use the `--production` flag on the processing scripts directly,
which reads from and writes to R2 without generating local copies:

```bash
node scripts/legacy/generate-annual-clearcut-tiles.js --production wabigoon 2023
node scripts/legacy/compute-clearcut-stats.js --production --annual wabigoon
```

### Tile URL routing

| Environment | `REACT_APP_TILES_BASE_URL` | Tile source |
|-------------|---------------------------|-------------|
| Development | *(empty)* | `client/public/tiles/` (CRA dev server) |
| Production  | `https://pub-<id>.r2.dev` | Cloudflare R2 public bucket |

Set `REACT_APP_TILES_BASE_URL` in the Vercel project settings (not in a
committed `.env` file).

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
`highlight_patches` will refuse until you either point the app at R2 or
generate them locally.

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
node scripts/legacy/upload-cogs.js client/public/data/patches data/patches
```

`scripts/legacy/upload-cogs.js` sets a short revalidating cache header on `.json` (unlike the
immutable one it uses for COGs, which live under versioned prefixes) precisely
because these are regenerated in place under the same filenames.

They are read through `REACT_APP_DATA_BASE_URL`, so the same routing as the
boundary files applies: empty in development (served from `client/public/`),
set to the R2 bucket in production.

---

## Vercel Pro Storage for Production COGs

Production deployments host Cloud-Optimized GeoTIFFs (COGs) and the COG availability manifest on **Vercel Pro Storage (Vercel Blob)**. Cloudflare R2 serves raster tile pyramids and acts as an alternative/fallback for local development.

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

### 3. Migrating existing files from Cloudflare R2 to Vercel

If you already have COGs or assets on Cloudflare R2, use `scripts/storage/migrate-r2-to-vercel.js` to stream them directly to Vercel Blob without downloading to disk:

```bash
# Preview what will be migrated without transferring
node scripts/storage/migrate-r2-to-vercel.js --dry-run

# Migrate all files under cogs/ (default) and rebuild the manifest
node scripts/storage/migrate-r2-to-vercel.js

# Migrate another prefix or all bucket contents
node scripts/storage/migrate-r2-to-vercel.js --prefix data/patches/
node scripts/storage/migrate-r2-to-vercel.js --all
```

Requirements for migration:
- `.env.r2` configured with Cloudflare R2 credentials
- `.env.vercel` (or `.env`) configured with `BLOB_READ_WRITE_TOKEN`

---

## COG availability manifest

`cogs/manifest.json` lists which region/year COGs exist, per versioned prefix. The app reads it before requesting any COG; without it, selecting all 39 FMUs issued ~195 HEAD probes at once and left the FMU boundaries queued behind lookups for regions that have no COGs at all.

It is **generated, never committed** — it describes the storage bucket/store rather than the source tree, so a checked-in copy goes stale the moment anyone uploads.

- **For Vercel Blob (Production)**:
  `scripts/storage/upload-cogs-vercel.js` and `scripts/storage/migrate-r2-to-vercel.js` rebuild it automatically. You can also re-index manually:
  ```bash
  node scripts/storage/generate-cog-manifest-vercel.js --dry-run   # preview manifest
  node scripts/storage/generate-cog-manifest-vercel.js             # rebuild and publish to Vercel Blob
  ```

- **For Cloudflare R2 (Local dev fallback / alternative)**:
  ```bash
  node scripts/legacy/generate-cog-manifest.js --dry-run
  node scripts/legacy/generate-cog-manifest.js
  ```

---

## Deployment

The app is deployed on Vercel. Pushes to `main` trigger automatic deploys. Serverless API routes live under `api/` and are deployed as Vercel Functions.

Environment variables required in Vercel project settings:

| Variable | Required In | Purpose |
|----------|-------------|---------|
| `REACT_APP_COG_BASE_URL` | Production (Vercel) | Vercel Blob store public base URL (`https://<id>.public.blob.vercel-storage.com`) |
| `BLOB_READ_WRITE_TOKEN` | Production & Build/CLI | Vercel Blob store access token (generated in Vercel Storage) |
| `REACT_APP_TILES_BASE_URL` | Production (Vercel) | R2 public CDN URL for raster tile pyramids |
| `REACT_APP_DATA_BASE_URL` | Production (Vercel) | R2 public CDN URL for data files (or local fallback) |
| `REACT_APP_GOOGLE_MAPS_API_KEY` | Client (Browser) | Google Places search |
| `GROQ_API_KEY` | Serverless (`api/chat.js`) | ForestryAI assistant — read server-side only |
| `VERCEL_MONGODB_URI` / `MONGODB_URI` | Serverless | MongoDB Atlas URI for user authentication, bug reports, and chat logs |
| `MONGODB_DB_NAME` | Serverless (Optional) | Database name override (defaults to `foresttrace` in prod, `foresttrace_preview` on preview, `foresttrace_dev` locally) |
| `AUTH_SECRET` | Serverless (Optional) | JWT signing secret for user authentication sessions |
| `ANTHROPIC_API_KEY` | Serverless (`api/storymaps.js`) | Claude Sonnet 5 for story map generation — read server-side only |

`GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `VERCEL_MONGODB_URI`, `MONGODB_URI`, `AUTH_SECRET`, and `BLOB_READ_WRITE_TOKEN` must **not** use the `REACT_APP_` prefix — that prefix causes Create React App to bundle the value into the client JavaScript, exposing it in the browser. None of these go in a committed `.env` file.
