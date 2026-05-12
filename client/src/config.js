/**
 * Runtime configuration derived from environment variables.
 *
 * In development (local):   .env  →  REACT_APP_TILES_BASE_URL is empty → relative paths
 * In production (Vercel):   set REACT_APP_TILES_BASE_URL in the Vercel project settings
 *                           e.g. https://pub-<id>.r2.dev
 */

// Base URL for all raster tiles. No trailing slash.
export const TILES_BASE_URL = process.env.REACT_APP_TILES_BASE_URL || '';

// Optional ArcGIS historical imagery service.
// Supports time-aware MapServer or ImageServer endpoints when configured.
export const ESRI_HISTORICAL_SERVICE_URL = process.env.REACT_APP_ESRI_HISTORICAL_SERVICE_URL || '';
export const ESRI_HISTORICAL_SERVICE_TYPE = process.env.REACT_APP_ESRI_HISTORICAL_SERVICE_TYPE || 'dynamic';

// Base URL for static data files (GeoJSON, etc.). No trailing slash.
export const DATA_BASE_URL = process.env.REACT_APP_DATA_BASE_URL || '';