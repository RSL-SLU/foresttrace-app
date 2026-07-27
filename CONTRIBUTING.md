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
│       ├── App.js                   # MODULES array — central registry
│       ├── config.js                # TILES_BASE_URL / DATA_BASE_URL
│       ├── modules/                 # One JSX file per analysis module
│       │   ├── ModuleTemplate.jsx   # Start here when adding a module
│       │   ├── ClearcutDetection.jsx
│       │   └── BiomassModule.jsx
│       ├── components/
│       │   └── RasterTileLayer.jsx  # Canvas-based PNG tile renderer
│       └── utils/
│           └── clearcutAreaStats.js # Stats helpers (reads clearcut_stats.json)
├── api/                             # Vercel serverless functions
├── package.json                     # Root: Express dev server + tile scripts
└── .env.r2.example                  # Template for R2 credentials
```

## Development setup

```bash
# 1. Install dependencies
npm install          # root (Express + tile-processing scripts)
cd client && npm install

# 2. Create client/.env with your client-side API key (never commit this file)
REACT_APP_GOOGLE_MAPS_API_KEY=...

# 3. Create a root .env for the server-side AI assistant proxy (never commit this file)
GROQ_API_KEY=...        # powers the ForestryAI /api/chat proxy
MONGODB_URI=...         # optional — enables chat message logging

# 4. Start the dev server
cd client && npm start   # React app at http://localhost:3000
```

In development, `REACT_APP_TILES_BASE_URL` is empty so tiles are read from
`client/public/tiles/` via the CRA dev server. In production (Vercel), the
env var is set to the Cloudflare R2 public URL.

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

Tiles follow the standard XYZ/TMS pyramid structure:

```
tiles/<layer>/<region>_<year>/<z>/<x>/<y>.png
```

### Generating tiles locally

The processing scripts live at the repo root and are **gitignored** (they
contain no credentials but are large/environment-specific). They accept
`--local` (read/write `client/public/tiles/`) or `--production` (read/write
Cloudflare R2).

```bash
# Generate annual clearcut tiles from accumulated tiles (2-year lookback filter)
node generate-annual-clearcut-tiles.js --local wabigoon 2023

# Compute area statistics and write to clearcut_stats.json
node compute-clearcut-stats.js --local --annual wabigoon
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

The upload script (`upload-tiles.js`) is local-only and gitignored. It reads
from `client/public/tiles/` and mirrors the directory tree to R2.

```bash
node upload-tiles.js --region wabigoon --layer clearcut-annual --year 2023
```

You can also use the `--production` flag on the processing scripts directly,
which reads from and writes to R2 without generating local copies:

```bash
node generate-annual-clearcut-tiles.js --production wabigoon 2023
node compute-clearcut-stats.js --production --annual wabigoon
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

`client/public/data/clearcut_stats.json` is a committed file that holds
precomputed hectare values. It is checked in so the app works without running
any scripts at startup.

After generating new tiles or updating a region, recompute and commit the JSON:

```bash
node compute-clearcut-stats.js --local --accumulated wabigoon
node compute-clearcut-stats.js --local --annual wabigoon
git add client/public/data/clearcut_stats.json
git commit -m "chore: update clearcut_stats for wabigoon 2024"
```

Accuracy metrics (precision / recall / F1 per year) are stored alongside the
area values under `<region>_<sensor>_accuracy` and are populated manually from
the training notebooks in `boreal-canada-mapping/notebooks/`.

---

## Deployment

The app is deployed on Vercel. Pushes to `main` trigger automatic deploys.
Serverless API routes live under `api/` and are deployed as Vercel Functions.

Environment variables required in Vercel project settings:

| Variable | Purpose |
|----------|---------|
| `REACT_APP_TILES_BASE_URL` | R2 public CDN URL for tiles |
| `REACT_APP_DATA_BASE_URL` | R2 public CDN URL for data files |
| `REACT_APP_GOOGLE_MAPS_API_KEY` | Google Places search (client-side) |
| `GROQ_API_KEY` | ForestryAI assistant — read server-side only, in `api/chat.js` |
| `MONGODB_URI` | Optional chat message logging (server-side only) |

`GROQ_API_KEY` and `MONGODB_URI` must **not** use the `REACT_APP_` prefix —
that prefix causes Create React App to bundle the value into the client
JavaScript, exposing it in the browser. None of these go in a committed
`.env` file.
