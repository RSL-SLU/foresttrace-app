# ForestTrace

ForestTrace is an interactive web platform for monitoring boreal forest dynamics in northern Ontario, Canada. The application supports annual clearcut mapping, biomass visualization, and multi-sensor satellite analysis through a web-based geospatial interface.

Developed by the Remote Sensing Lab (RSL) at Saint Louis University, ForestTrace supports research and decision-making for forest stewardship, including Indigenous-led land management workflows.

## Current Project Description

The platform currently provides:

- Clearcut detection and annual disturbance tracking (Wabigoon FMU and related regions)
- Above-Ground Biomass (AGB) visualization from remote sensing products
- Multi-year raster overlays (2015 to present for clearcut workflows), served as PNG tile pyramids and, increasingly, as Cloud-Optimized GeoTIFFs (COGs)
- Interactive map exploration with module-based analysis panels, including user-drawn areas of interest
- A Forestry AI Agent that answers questions about the active map view and can highlight AI-selected clearcut patches drawn from published data

Primary datasets and analysis context include Landsat/Sentinel-derived products, HLS time series, SAR-assisted biomass workflows, and high-resolution imagery support for validation.

## Tech Stack

- Frontend: React (`client/`), with two map renderers:
  - **Leaflet** — the default renderer for all modules today
  - **MapLibre GL** — a WebGL renderer being brought to parity behind the `REACT_APP_USE_MAPLIBRE` flag; it's what renders Cloud-Optimized GeoTIFFs directly in-browser (`REACT_APP_USE_COG_CLEARCUT`) instead of pre-tiled PNGs
- Backend: Node.js + Express (`index.js`) for production-style serving, plus Vercel serverless functions under `api/` (the Groq-backed Forestry AI Agent proxy)
- Data/CDN: Cloudflare R2 hosts tile pyramids, COGs, and geospatial data files (region boundaries, clearcut patch vectors) in production
- Mapping: Raster tile and COG services, vector overlays, and custom per-module analysis panels

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full development setup, environment variables, and the tile/COG pipeline.

## Repository Structure

- `client/`: React application and map UI components
  - `client/src/components/MapLibreMap.jsx`: the MapLibre GL / COG renderer
  - `client/src/components/RasterTileLayer.jsx`: the Leaflet PNG tile renderer
  - `client/src/modules/`: Analysis modules (Clearcut, Biomass, etc.)
  - `client/public/tiles/`: Local tile resources for development (gitignored)
- `api/`: Vercel serverless functions, including the Forestry AI Agent's `/api/chat` proxy
- `index.js`: Express server for production build hosting
- Node helper scripts at repo root: tile/COG generation, R2 upload, and manifest utilities (see CONTRIBUTING.md)

## Getting Started

### 1) Install dependencies

From the repository root:

```bash
npm install
cd client
npm install
```

### 2) Run the frontend (development)

From `client/`:

```bash
npm start
```

The app runs on `http://localhost:3000` by default.

### 3) Run the Node server (production-style serving)

Build the React app first:

```bash
cd client
npm run build
```

Then run the server from repository root:

```bash
node index.js
```

## License

This project is licensed under the **Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)** license.

- Full license text: https://creativecommons.org/licenses/by-nc/4.0/legalcode
- Local license file: `LICENSE`

### Summary

- You may share and adapt the material.
- You must provide attribution.
- Commercial use is not permitted without additional permission.

For permissions beyond this license (including commercial use), contact the Remote Sensing Lab at Saint Louis University.