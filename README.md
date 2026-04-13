# ForestTrace

ForestTrace is an interactive web platform for monitoring boreal forest dynamics in northern Ontario, Canada. The application supports annual clearcut mapping, biomass visualization, and multi-sensor satellite analysis through a web-based geospatial interface.

Developed by the Remote Sensing Lab (RSL) at Saint Louis University, ForestTrace supports research and decision-making for forest stewardship, including Indigenous-led land management workflows.

## Current Project Description

The platform currently provides:

- Clearcut detection and annual disturbance tracking (Wabigoon FMU and related regions)
- Above-Ground Biomass (AGB) visualization from remote sensing products
- Multi-year tiled map overlays (2015 to present for clearcut workflows)
- Interactive map exploration with module-based analysis panels

Primary datasets and analysis context include Landsat/Sentinel-derived products, HLS time series, SAR-assisted biomass workflows, and high-resolution imagery support for validation.

## Tech Stack

- Frontend: React + Leaflet (`client/`)
- Backend: Node.js + Express (`index.js`)
- Mapping: Raster tile services, vector overlays, and custom analysis modules

## Repository Structure

- `client/`: React application and map UI components
- `client/public/tiles/`: Static tile resources and map examples
- `client/src/modules/`: Analysis modules (Clearcut, Biomass, etc.)
- `index.js`: Express server for production build hosting
- Python/Node helper scripts at repo root: tile generation, reorganization, and validation utilities

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