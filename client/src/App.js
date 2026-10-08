import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import { MapContainer, TileLayer, useMap, GeoJSON } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import { SpeedInsights } from "@vercel/speed-insights/react";
import { Analytics } from "@vercel/analytics/react";

import TopMenu from './components/TopMenu';
import ModuleSelector from './components/ModuleSelector';
import ModulePanel from './components/ModulePanel';
import FMUSelector from './components/FMUSelector';
import MobileWarning from './components/MobileWarning';
import LandingPage from './components/LandingPage';
import AboutPage from './pages/AboutPage';
import HelpPage from './pages/HelpPage';
import NewsPage from './pages/NewsPage';
import PublicationPage from './pages/PublicationPage';
import DocumentationPage from './pages/DocumentationPage';
import MapSourcesInfo from './components/MapSourcesInfo';
import MapTimeline from './components/MapTimeline';
import MapDisplayOptions from './components/MapDisplayOptions';
import ClearcutDetection from './modules/ClearcutDetection';
import BiomassModule from './modules/BiomassModule';
import WildfireModule from './modules/WildfireModule';
import DisturbanceAlerts from './modules/DisturbanceAlerts';
import CaribouHabitatModule from './modules/CaribouHabitatModule';
import RasterTileLayer from './components/RasterTileLayer';
import { useAuth } from './context/AuthContext';
import AuthModal from './components/AuthModal';
import AdminDashboard from './components/AdminDashboard';
import UserChatHistoryModal from './components/UserChatHistoryModal';
import StoryMapsModal from './components/StoryMapsModal';
import BugReportModal from './components/BugReportModal';
import { handleLocateUser } from './utils/mapUtils';
import { CLEARCUT_SENSOR_SUBFOLDER_YEARS, DEFAULT_CLEARCUT_SENSOR, getRegionsWithClearcutData } from './utils/clearcutAreaStats';
import { createEmptyBiomassHistogram } from './utils/biomassHistogram';
import { getFireYearsForRegions } from './utils/wildfireYears';
import { WILDFIRE_CLASSES, WILDFIRE_CLASS_ID, WILDFIRE_VISIBLE_CLASSES } from './utils/wildfireClasses';
import { CARIBOU_CLASSES, CARIBOU_VISIBLE_CLASSES } from './utils/caribouClasses';
import { getFmusForRanges, rangeColor, CARIBOU_RANGES } from './utils/caribouStats';
import {
  TILES_BASE_URL, DATA_BASE_URL, COG_BASE_URL,
  cogPrefixForLayer, coveragePrefixForLayer, cogUrlForPrefix,
} from './config';
import useRegionBoundaries from './hooks/useRegionBoundaries';
import { TINTED_LAYER_IDS, tintedTileUrl } from './utils/tintedTileProtocol';
import { summarizeDrawing } from './utils/drawnShapeContext';
import { getCogCoverage, getTileCoverage } from './utils/clearcutCogCoverage';
import { fetchAlerts, triageAlert, ageDays, ageColor, geometryBounds } from './utils/alerts';
import { computeClearcutDrawingPresence } from './utils/clearcutDrawingStats';

import './styles/map.css';
import './styles/topmenu.css';
import './styles/menu.css';
import './styles/layout.css';

// maplibre-gl is ~400 kB gzipped -- as a static import it landed in the main
// bundle for every visitor even with USE_MAPLIBRE off. Lazy so the cost is paid
// only when the MapLibre renderer is actually switched on.
const MapLibreMap = React.lazy(() => import('./components/MapLibreMap'));

// Sentinel-2 cloudless annual composites (EOX IT Services GmbH).
// Free for non-commercial use; tiles.maps.eox.at serves 2018–2024.
// Years outside this range fall back to the static Esri World Imagery layer.
const EOX_S2_YEARS = new Set([2018, 2019, 2020, 2021, 2022, 2023, 2024]);

function getBasemapConfig(year) {
  if (EOX_S2_YEARS.has(year)) {
    return {
      url: `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-${year}_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg`,
      attribution: `Sentinel-2 cloudless ${year} &copy; <a href="https://eox.at">EOX IT Services GmbH</a>`,
    };
  }
  return {
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri, DigitalGlobe, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, and others',
  };
}

// Neutral basemap: gray canvas + boundaries/labels only, no imagery. Esri's
// "Light Gray Canvas" style is two stacked layers — a plain gray base and a
// reference layer carrying admin boundaries, place names, and city labels.
const LIGHT_BASEMAP = {
  baseUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
  referenceUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
  attribution: '&copy; Esri, HERE, Garmin, FAO, NOAA, USGS',
};

function isBasemapSynced(year) {
  if (EOX_S2_YEARS.has(year)) return true;
  // 2025 uses Esri "current" imagery which is close enough to the detection year
  // that a warning would be misleading.
  if (year >= 2025) return true;
  return false;
}

// The directory a layer's tiles live under: /tiles/<dir>/{region}_{year}/...
// Read from the URL template rather than hardcoded, so a new layer needs no
// second registration to be covered by the availability manifest.
function tileDirOf(tileUrl) {
  return tileUrl?.match(/\/tiles\/([^/]+)\//)?.[1] ?? null;
}

// COG url of the latest year before `year` that the product has for `region`,
// or undefined when `year` is the first. "Previous" means previous in the
// series, not year - 1: wabigoon jumps 2010 -> 2015, and the stats pipeline's
// entering(2015) is taken against 2010. A first year has nothing before it,
// so everything in it counts as new -- again matching the stats.
function previousCogUrl(prefix, coverage, region, year) {
  let prev = -Infinity;
  coverage?.forEach((key) => {
    if (!key.startsWith(`${region}_`)) return;
    const y = Number(key.slice(region.length + 1));
    if (y < year && y > prev) prev = y;
  });
  return Number.isFinite(prev) ? cogUrlForPrefix(prefix, region, prev) : undefined;
}

const center = [49.80318325874751, -92.8087780822145];

// Renders the MapLibre map instead of the Leaflet one. Off by default: the
// MapLibre path is still being brought to parity (stats tallying, biomass
// histograms and the wildfire layers still run through <RasterTileLayer>), so
// the Leaflet map stays the shipping one until those land.
//   REACT_APP_USE_MAPLIBRE=true npm start
const USE_MAPLIBRE = process.env.REACT_APP_USE_MAPLIBRE === 'true';

// Serve COG-backed layers from COGs rather than PNG pyramids. Independent of the
// renderer flag so the two can be evaluated separately -- though COGs only render
// on MapLibre, so this does nothing while USE_MAPLIBRE is off.
//
// Which layers this covers is data, not a list here: cogPrefixForLayer() returns
// null for any layer with no entry in COG_PREFIX_BY_LAYER, and those fall back to
// tiles. The env var keeps its original name so existing setups are unaffected.
const USE_COG = process.env.REACT_APP_USE_COG_CLEARCUT === 'true';
const TILE_ZOOM_LEVELS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
const TILE_ZOOM_RANGE = {
  min: Math.min(...TILE_ZOOM_LEVELS),
  max: Math.max(...TILE_ZOOM_LEVELS),
};

// Esri's Light Gray Canvas cache stops at level 16 — deeper requests just
// re-serve the same overzoomed level-16 tile, so cap zoom there in light mode.
const LIGHT_BASEMAP_MAX_ZOOM = 16;
// One pyramid per range-year, built by caribou_tiling/code/caribou_tiler_range.py
// and served from disk via setupProxy (CARIBOU_RANGE_TILES_DIR) until it is
// uploaded. Opt-in, because a checkout without those tiles would otherwise ask
// for a pyramid that is not there.
//
// Worth the switch on two counts. One layer per range instead of one per FMU
// (a range spans 5-7 of them, all seven span 25). And an FMU pyramid holds
// every range overlapping that FMU -- troutlake carries Berens, Churchill and
// Sydney -- so selecting one range through FMU tiles also draws the others.
// A range pyramid holds that range alone.
const CARIBOU_RANGE_TILES = process.env.REACT_APP_CARIBOU_RANGE_TILES === 'true';
const CARIBOU_RANGE_TILE_URL = `${TILES_BASE_URL}/tiles/wildlife/caribou-range/{region}_{year}/{z}/{x}/{y}.png`;

// How far the viewport may zoom out, which is NOT where the tile pyramid starts.
// The two were the same value, so the map was pinned to the tiles' floor of z6 --
// too close to fit Ontario, which spans ~15 degrees of latitude and needs about
// z4. Below z6 the raster overlays simply stop drawing (their sources declare
// minzoom 6); the basemap and FMU boundaries still do, which is what makes a
// province-wide view worth having.
const MAP_MIN_ZOOM = 4;
const RASTER_MULTI_FMU_SOFT_LIMIT = 8;
// Caribou range mode gets a higher ceiling than the general one above. That
// limit exists to contain the per-tile recolouring in RasterTileLayer, and
// habitat tiles are pre-coloured -- they return early out of that path
// entirely. All seven ranges together are 25 FMUs, so this admits every
// combination rather than silently dropping layers mid-range.
const RASTER_RANGE_MODE_LIMIT = 25;
const PREFERRED_RASTER_REGIONS = ['wabigoon', 'troutlake'];

// Matches WINDOW_YEARS in boreal-canada-mapping's utils/accumulated_clearcut.py
// (and the ARI COG pipeline's use of it) -- the two repos aren't wired together,
// so this stays in sync by comment rather than import. Used to filter the
// "Inspect harvest year" sub-layer to the same window Accumulated Clearcuts is
// currently showing, rather than every inspectable year in the archive at once.
const ARI_ACCUMULATED_WINDOW_YEARS = 5;

const MODULES = [
  {
    id: 'clearcut',
    name: 'Clearcut Detection',
    icon: '🪓',
    description: 'Detect and analyze clearcut areas',
    component: ClearcutDetection,
    temporalOptions: {
      yearRange: [2010, 2025],
      availableYears: [2010, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025],
    },
    layers: [
      // ARI ground-truth harvest data (utils/generate_ari_harvest_cogs.py in
      // boreal-canada-mapping), standing in for the ML model's inferred
      // clearcut layers for now -- reuses their ids/mode/default-active
      // wiring so nothing downstream (hasClearcutLayer, the default-layer
      // bootstrap, etc.) needs to know the source changed. wabigoon-only
      // today: FC130 (the ARI inventory tile matching the Wabigoon Forest
      // FMU) is the first region run through the pipeline. cogAuthoritative
      // because no PNG pyramid exists or ever will for these -- it skips the
      // fallback path instead of requesting one that was never generated.
      {
        id: 'clearcut-accumulated',
        name: 'Accumulated Clearcuts',
        tileUrl: `${TILES_BASE_URL}/tiles/clearcut-accumulated-ari/{region}_{year}/{z}/{x}/{y}.png`,
        // Amber rather than the original #ffeb3b yellow, which washed out
        // against the light basemap. Color encodes accumulated vs annual
        // only; the ML layers below reuse these colors as outlines.
        color: '#d97706',
        mode: 'accumulated',
        tms: false,
        cogAuthoritative: true,
      },
      {
        id: 'clearcut-annual',
        name: 'Annual Clearcuts',
        tileUrl: `${TILES_BASE_URL}/tiles/clearcut-annual-ari/{region}_{year}/{z}/{x}/{y}.png`,
        color: '#dc2626',
        mode: 'annual',
        tms: false,
        cogAuthoritative: true,
      },
      // Harvest polygons themselves (utils/generate_ari_harvest_mvt.py), as
      // vector tiles rather than a raster -- carries YRDEP per feature, so a
      // click reads the exact harvest year straight off the tile with no
      // separate lookup. A sub-layer of Accumulated Clearcuts, not an
      // independent one: parentLayerId keeps it off the map (and off the
      // checkbox, ModuleSelector.jsx) whenever its parent isn't active, and
      // toggling the parent off takes it with it (see handleLayerToggle).
      // The archive itself is pre-filtered to the app's own candidate years
      // (2010, 2015+), not the full ARI history -- matches what the
      // accumulated/annual rasters can show, so inspecting a polygon never
      // surfaces a year the map can't otherwise display.
      {
        id: 'clearcut-harvest-year-ari',
        name: 'Inspect harvest year',
        vectorUrl: `${COG_BASE_URL || TILES_BASE_URL}/mvt/wabigoon.pmtiles`,
        vectorSourceLayer: 'harvest',
        color: '#FF1493',
        parentLayerId: 'clearcut-accumulated',
        // Filters features to (year - ARI_ACCUMULATED_WINDOW_YEARS, year] --
        // the same window the accumulated raster is showing -- rather than
        // every inspectable year in the archive at once.
        yearFilterField: 'YRDEP',
        // An option of Accumulated Clearcuts, not a layer in its own right --
        // toggled from within ClearcutDetection's own panel (see moduleData's
        // onToggleInspectHarvest) instead of the left-hand layer list. Still
        // a real entry in `layers` so the existing activeLayers/vectorLayers
        // construction and parent-cascade logic need no special-casing.
        hideFromLayerList: true,
      },
      // Satellite Deep Learning Detections (HLS ML model), drawn as outlines
      // over the filled ARI layers for side-by-side comparison. Not picked
      // from the left-hand list: the left panel chooses the disturbance type
      // (accumulated/annual) and ClearcutDetection's source selector chooses
      // ARI and/or ML -- effectiveActiveLayers maps the pair onto these ids.
      // COG only, never the PNG pyramid: cogAuthoritative skips the fallback,
      // and cogOutline has MapLibreMap trace the rendered class-2 pixels into
      // a border (see its cog:// protocol wrapper). No tileUrl, so there is no
      // PNG to fall back to even with COGs switched off.
      {
        id: 'clearcut-ml-accumulated',
        name: 'AI Model: Accumulated Cuts',
        color: '#d97706',
        mode: 'accumulated',
        cogAuthoritative: true,
        cogOutline: true,
        hideFromLayerList: true,
      },
      {
        id: 'clearcut-ml-annual',
        name: 'AI Model: Annual Cuts',
        color: '#dc2626',
        mode: 'annual',
        cogAuthoritative: true,
        cogOutline: true,
        // Only what entered the accumulated window this year: a stand already
        // standing in the previous year's accumulated raster is masked out,
        // so a cut shown in 2024 doesn't reappear as annual in 2025.
        cogNewSincePrevious: true,
        hideFromLayerList: true,
      },
    ],
  },
  {
    // Near real-time disturbance alerts (OPERA DIST-ALERT-HLS semantics; see
    // api/alerts.js). Not year-based: alerts carry their own detection dates,
    // so there are no temporalOptions and the timeline ignores this module.
    // Its one layer is drawn from the alerts API as GeoJSON on the MapLibre
    // map; it has no tile/COG source, so the raster loops skip it.
    id: 'alerts',
    name: 'Disturbance Alerts',
    // Signed-in users only, here and in api/alerts.js
    requiresAuth: true,
    icon: '🚨',
    description: 'Near real-time forest disturbance alerts',
    component: DisturbanceAlerts,
    layers: [
      { id: 'disturbance-alerts', name: 'Alert Areas', color: '#ff2d95' },
    ],
  },
  {
    id: 'biomass',
    name: 'Biomass',
    icon: '🌿',
    description: 'Biomass density visualization',
    component: BiomassModule,
    temporalOptions: {
      yearRange: [2010, 2010],
    },
    layers: [
      {
        id: 'biomass-density',
        name: 'Biomass Density',
        tileUrl: `${TILES_BASE_URL}/tiles/biomass/{region}_{year}_agb/{z}/{x}/{y}.png`,
        mode: 'annual',
        tms: false,
      },
    ],
  },
  {
    id: 'wildfire',
    name: 'Wildfire',
    icon: '🔥',
    description: 'Burned area mapping from NBAC',
    component: WildfireModule,
    temporalOptions: {
      yearRange: [2010, 2025],
      availableYears: [
        2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017,
        2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025,
      ],
    },
    layers: [
      {
        id: 'wildfire-burned',
        name: 'Burned Area',
        tileUrl: `${TILES_BASE_URL}/tiles/wildfire/{region}_{year}/{z}/{x}/{y}.png`,
        color: '#FF7F00',
        mode: 'annual',
        tms: false,
        // Wildfire carries its own class table rather than borrowing clearcut's:
        // the rasteriser writes 1 for burned, 0 for nodata. All three unset for
        // clearcut, which falls back to its own palette and class 2.
        cogPalette: WILDFIRE_CLASSES,
        cogClasses: WILDFIRE_VISIBLE_CLASSES,
        cogColorClass: WILDFIRE_CLASS_ID,
      },
    ],
  },
  {
    id: 'forest',
    name: 'Forest',
    icon: '🌲',
    description: 'Forest type and age classification',
    component: ClearcutDetection,
    temporalOptions: {
      yearRange: [2010, 2025],
    },
    layers: [
      {
        id: 'forest-mature',
        name: 'Mature Forest',
        tileUrl: `${TILES_BASE_URL}/tiles/{year}/{z}/{x}/forest_mature_{y}.png`,
        color: '#1B4D1B',
        mode: 'annual',
      },
      {
        id: 'forest-young',
        name: 'Young Forest',
        tileUrl: `${TILES_BASE_URL}/tiles/{year}/{z}/{x}/forest_young_{y}.png`,
        color: '#66BB6A',
        mode: 'annual',
      },
    ],
  },
  {
    id: 'wildlife',
    name: 'Wildlife & Species',
    icon: '🐦',
    description: 'Species habitat and distribution',
    component: CaribouHabitatModule,
    temporalOptions: {
      // Caribou habitat (MSPA) is the only layer here with tiles behind it; the
      // bird/mammal entries below are still placeholders. availableYears drives
      // the slider by index so it snaps to assessed years.
      //
      // Year-over-year change is small by nature -- disturbance is cumulative,
      // so each year only ADDS to an existing footprint (0.01-1.35% of pixels
      // per step). The full span is where it reads: -12.9% core on troutlake.
      // 2023-2025 is nearly flat because the input disturbance layers do not
      // appear to extend past 2023.
      yearRange: [2015, 2025],
      availableYears: [2015, 2016, 2017, 2018, 2019, 2020,
        2021, 2022, 2023, 2024, 2025],
    },
    layers: [
      {
        id: 'caribou-habitat',
        name: 'Caribou Habitat',
        // Headline for the right panel while this layer is on. The Wildlife
        // module hosts several species, so the panel names the species rather
        // than the module. The left-hand module selector is untouched.
        panelTitle: 'Caribou Suitable Habitat',
        panelIcon: '🦌',
        // tiles/wildlife/{specie}/... so the module can host more species
        // without each one claiming a top-level prefix.
        tileUrl: `${TILES_BASE_URL}/tiles/wildlife/caribou/{region}_{year}/{z}/{x}/{y}.png`,
        // Mid-viridis: a single swatch standing in for the 5-class ramp.
        color: '#21918C',
        mode: 'annual',
        tms: false,
        // Caribou's own size-class table. cogColorClass is explicitly null: the
        // five-step ramp IS the information, so repainting one class in the
        // layer's colour would destroy the reading. `color` above is the panel
        // swatch, not the raster.
        cogPalette: CARIBOU_CLASSES,
        cogClasses: CARIBOU_VISIBLE_CLASSES,
        cogColorClass: null,
        // Both caribou products are complete -- 77 range COGs and 220 FMU COGs
        // cover every region that has habitat at all -- so a region-year absent
        // from coverage has no data rather than no conversion. Without this the
        // 19 FMUs outside the caribou range fell back to a PNG pyramid that does
        // not cover them either, and fetched a tree of 404s per region.
        cogAuthoritative: true,
      },
      {
        id: 'wildlife-birds',
        name: 'Bird Species',
        tileUrl: `${TILES_BASE_URL}/tiles/{year}/{z}/{x}/wildlife_birds_{y}.png`,
        color: '#FFD700',
        mode: 'annual',
      },
      {
        id: 'wildlife-mammals',
        name: 'Mammals',
        tileUrl: `${TILES_BASE_URL}/tiles/{year}/{z}/{x}/wildlife_mammals_{y}.png`,
        color: '#8B4513',
        mode: 'annual',
      },
    ],
  },
];

function DrawingTools({ mapRef, onDrawChange }) {
  const map = useMap();
  mapRef.current = map;
  const onDrawChangeRef = useRef(onDrawChange);
  onDrawChangeRef.current = onDrawChange;

  useEffect(() => {
    map.pm.addControls({
      position: 'bottomleft',
      drawPolygon: true,
      drawCircle: true,
      drawRectangle: true,
      editMode: true,
      dragMode: false,
      cutPolygon: false,
      removalMode: true,
    });

    // Re-read every geoman layer on any change rather than tracking a diff:
    // geoman fires create/remove/edit through several different events, and a
    // shape edited or deleted through the toolbar would otherwise leave a stale
    // copy behind. The layer count here is single digits, so re-reading is free.
    const publish = () => {
      if (!onDrawChangeRef.current) return;
      const features = map.pm.getGeomanLayers()
        .map((layer) => (layer.toGeoJSON ? layer.toGeoJSON() : null))
        .filter(Boolean);
      onDrawChangeRef.current(features);
    };

    // pm:create fires before the layer joins the map's geoman registry, so
    // publishing synchronously would miss the shape just drawn.
    const onCreate = () => setTimeout(publish, 0);

    map.on('pm:create', onCreate);
    map.on('pm:remove', publish);
    map.on('pm:cut', publish);
    map.on('pm:edit', publish);

    return () => {
      map.off('pm:create', onCreate);
      map.off('pm:remove', publish);
      map.off('pm:cut', publish);
      map.off('pm:edit', publish);
      map.pm.removeControls();
    };
  }, [map]);

  return null;
}

// Caribou population ranges (OMNR). Only the seven the pipeline models are in
// the file, so the overlay never implies coverage that does not exist. Each
// feature carries its own colour, so the map and the panel legend read from one
// source and cannot drift.
function CaribouRangeBoundaries({ visible, selectedRanges }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    // Fetch once, on first reveal -- 166 KB that most sessions never need.
    if (!visible || data) return undefined;
    let cancelled = false;
    fetch(`${DATA_BASE_URL}/data/caribou_ranges.geojson`)
      .then((r) => {
        if (!r.ok) throw new Error(`caribou_ranges.geojson: HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => { if (!cancelled) setData(json); })
      .catch((err) => console.error('[CaribouRanges]', err));
    return () => { cancelled = true; };
  }, [visible, data]);

  const onEachFeature = useCallback((feature, layer) => {
    layer.options.pmIgnore = true;
    // CARIBOU_RANGES wins over the geojson's own `color`, so restyling does not
    // mean regenerating the file.
    const colour = rangeColor(feature.properties?.RANGE_NAME)
      || feature.properties?.color || '#333333';
    layer.setStyle({
      color: colour,
      weight: 2,
      opacity: 1,
      // Outline only, matching RegionBoundaries. Leaflet draws vectors in
      // overlayPane, always above tilePane, so any fill here would tint the
      // habitat raster it is meant to annotate.
      fillOpacity: 0,
    });
    if (feature.properties?.RANGE_NAME) {
      layer.bindTooltip(feature.properties.RANGE_NAME, { sticky: true });
    }
  }, []);

  // With ranges selected, outline only those — otherwise the switches say one
  // range is on while the map still draws all seven.
  const shown = useMemo(() => {
    if (!data) return null;
    if (!selectedRanges || selectedRanges.length === 0) return data;
    const wanted = new Set(selectedRanges.map((r) => String(r).toLowerCase()));
    return {
      ...data,
      features: (data.features || []).filter(
        (f) => wanted.has(String(f.properties?.RANGE_NAME || '').toLowerCase()),
      ),
    };
  }, [data, selectedRanges]);

  if (!visible || !shown) return null;
  // Keyed on the selection so Leaflet rebuilds the layer when it changes;
  // react-leaflet does not diff GeoJSON data in place.
  return (
    <GeoJSON
      key={`caribou-ranges-${(selectedRanges || []).join('-') || 'all'}`}
      data={shown}
      onEachFeature={onEachFeature}
    />
  );
}

/**
 * The same range outlines as a plain FeatureCollection, for the MapLibre map.
 *
 * CaribouRangeBoundaries above is a Leaflet component -- setStyle, bindTooltip,
 * pmIgnore -- so it renders only inside <MapContainer>. With USE_MAPLIBRE on it
 * never mounted at all, which is why selecting a range drew habitat with no
 * boundary around it.
 *
 * MapLibre has no per-feature style callback, so the colour is resolved here and
 * written onto each feature for a data-driven paint expression to read.
 */
function useCaribouRangeGeoJson(selectedRanges) {
  const [data, setData] = useState(null);
  const wanted = (selectedRanges || []).length > 0;

  useEffect(() => {
    // Fetch once, on first reveal -- 166 KB that most sessions never need.
    if (!wanted || data) return undefined;
    let cancelled = false;
    fetch(`${DATA_BASE_URL}/data/caribou_ranges.geojson`)
      .then((r) => {
        if (!r.ok) throw new Error(`caribou_ranges.geojson: HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => { if (!cancelled) setData(json); })
      .catch((err) => console.error('[CaribouRanges]', err));
    return () => { cancelled = true; };
  }, [wanted, data]);

  return useMemo(() => {
    if (!data || !wanted) return null;
    const ids = new Set(selectedRanges.map((r) => String(r).toLowerCase()));
    const features = (data.features || [])
      .filter((f) => ids.has(String(f.properties?.RANGE_NAME || '').toLowerCase()))
      .map((f) => ({
        ...f,
        properties: {
          ...f.properties,
          // CARIBOU_RANGES wins over the geojson's own `color`, so restyling does
          // not mean regenerating the file -- same precedence as the Leaflet path.
          _lineColor: rangeColor(f.properties?.RANGE_NAME)
            || f.properties?.color || '#333333',
        },
      }));
    return { type: 'FeatureCollection', features };
  }, [data, wanted, selectedRanges]);
}

function RegionBoundaries({ selectedFMUs, useOntarioOverview, basemapMode }) {
  const regionsData = useRegionBoundaries(selectedFMUs, useOntarioOverview);

  const boundaryStyle = useMemo(() => ({
    color: basemapMode === 'satellite' ? '#ffffff' : '#2f8f5b',
    weight: 2,
    opacity: 0.9,
    fillOpacity: 0,
  }), [basemapMode]);

  const onEachFeature = useCallback((feature, layer) => {
    layer.options.pmIgnore = true;
  }, []);

  if (!regionsData) return null;

  const featureIds = regionsData.features.map((f) => f.properties?.id).sort().join('-');

  return (
    <GeoJSON
      key={featureIds}
      data={regionsData}
      style={boundaryStyle}
      onEachFeature={onEachFeature}
    />
  );
}

function ZoomControlPositioner({ position = 'bottomleft' }) {
  const map = useMap();

  useEffect(() => {
    const zoomControl = L.control.zoom({ position });
    map.addControl(zoomControl);

    return () => {
      map.removeControl(zoomControl);
    };
  }, [map, position]);

  return null;
}

// MapContainer's maxZoom prop only applies at initial mount, so this keeps
// Leaflet's own max-zoom clamp in sync when the basemap (and its supported
// zoom range) changes after the map already exists.
function MaxZoomController({ maxZoom }) {
  const map = useMap();

  useEffect(() => {
    map.setMaxZoom(maxZoom);
    if (map.getZoom() > maxZoom) {
      map.setZoom(maxZoom);
    }
  }, [map, maxZoom]);

  return null;
}

function App() {
  const { isAuthenticated, isInitialized, loading, openAuthModal, token } = useAuth();
  const [adminDashboardOpen, setAdminDashboardOpen] = useState(false);
  const [chatHistoryOpen, setChatHistoryOpen] = useState(false);
  const [storyMapsOpen, setStoryMapsOpen] = useState(false);
  const [bugReportOpen, setBugReportOpen] = useState(false);

  const [showApp, setShowApp] = useState(false);
  const [activePage, setActivePage] = useState(null);
  // Post the News page opens straight into (from a landing-page card); null = list
  const [newsSlug, setNewsSlug] = useState(null);
  // Top-menu navigation: a page opened from the menu starts at its top level,
  // so News shows the list rather than whichever post was last open.
  const navigateToPage = useCallback((page) => {
    setNewsSlug(null);
    setActivePage(page);
  }, []);
  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [clearcutPercent, setClearcutPercent] = useState(null);
  const [tilesLoading, setTilesLoading] = useState(false);
  const hidingTimerRef = useRef(null);
  const showingTimerRef = useRef(null);

  // If platform has no admin configured, automatically prompt for initial admin setup on first launch
  const initialPromptDoneRef = useRef(false);
  useEffect(() => {
    if (!loading && isInitialized === false && !isAuthenticated && !initialPromptDoneRef.current) {
      initialPromptDoneRef.current = true;
      openAuthModal('bootstrap');
    }
  }, [loading, isInitialized, isAuthenticated, openAuthModal]);

  // Automatically transition into the map when the user completes authentication
  const prevAuthRef = useRef(isAuthenticated);
  useEffect(() => {
    if (!prevAuthRef.current && isAuthenticated && !showApp) {
      setShowApp(true);
    }
    prevAuthRef.current = isAuthenticated;
  }, [isAuthenticated, showApp]);

  // Shown only if the load is still running after a beat. Most tile loads finish
  // faster than that, and an indicator that flashes on every pan reads as the
  // map fighting you rather than as information.
  const LOADING_SHOW_DELAY_MS = 500;
  // Held briefly once shown. Tiles arrive in batches with brief lulls between
  // them, and a source reads as loaded during a lull -- so a short hide delay
  // made the indicator strobe through a long load and, worse, re-armed the
  // 500 ms show delay each time, hiding it for most of the load it was meant to
  // report. Longer than the gaps, short enough not to linger once done.
  const LOADING_HIDE_DELAY_MS = 900;
  // Which map sources are still fetching, so the status line can name them.
  // Leaflet's <RasterTileLayer> passes no ids and simply leaves this empty.
  const [loadingSourceIds, setLoadingSourceIds] = useState([]);
  // The undebounced signal. tilesLoading is delayed on both edges so the
  // indicator doesn't strobe, which is right for a human watching it and wrong
  // for playback pacing -- the delays would add well over a second to every
  // frame. Playback reads this instead.
  const [tilesBusy, setTilesBusy] = useState(false);
  const handleLoadingChange = useCallback((loading, sourceIds = []) => {
    setTilesBusy(loading);
    // Only update the label when there is something to name. Clearing it during
    // a lull would flip the status line to the generic wording and back.
    if (sourceIds.length > 0) setLoadingSourceIds(sourceIds);
    if (loading) {
      clearTimeout(hidingTimerRef.current);
      if (!showingTimerRef.current) {
        showingTimerRef.current = setTimeout(() => setTilesLoading(true), LOADING_SHOW_DELAY_MS);
      }
    } else {
      clearTimeout(showingTimerRef.current);
      showingTimerRef.current = null;
      hidingTimerRef.current = setTimeout(() => setTilesLoading(false), LOADING_HIDE_DELAY_MS);
    }
  }, []);
  const [biomassHistogram, setBiomassHistogram] = useState(createEmptyBiomassHistogram());
  const [rasterOpacity, setRasterOpacity] = useState(1);
  const [selectedModuleId, setSelectedModuleId] = useState(MODULES[0]?.id);
  const selectedModule = useMemo(
    () => MODULES.find((m) => m.id === selectedModuleId) ?? MODULES[0],
    [selectedModuleId],
  );
  const [selectedYear, setSelectedYear] = useState(MODULES[0]?.temporalOptions?.yearRange?.[1] || 2025);
  const [selectedFMUs, setSelectedFMUs] = useState(['wabigoon']);
  const [allowHeavyRaster, setAllowHeavyRaster] = useState(false);
  const [basemapMode, setBasemapMode] = useState('light'); // 'light' | 'satellite'

  // Track module activation analytics
  useEffect(() => {
    if (!selectedModuleId) return;
    fetch('/api/reports?action=track-module', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ moduleId: selectedModuleId }),
    }).catch((err) => console.warn('[Analytics tracking]', err));
  }, [selectedModuleId, token]);

  // The map is open to everyone; only the AI features and Disturbance Alerts
  // ask for an account (see requireSignIn).
  const handleEnterApp = useCallback(() => {
    setShowApp(true);
  }, []);

  const currentContext = useMemo(() => ({
    module: selectedModule?.id || 'clearcut',
    year: selectedYear,
    fmus: selectedFMUs,
  }), [selectedModule?.id, selectedYear, selectedFMUs]);

  // Disable overview mode for now because the current simplified overview geometry
  // introduces visible boundary artifacts at Ontario-wide scale.
  const useOntarioOverview = false;

  const shouldLimitRasterRegions = useMemo(() => {
    if (!Array.isArray(selectedFMUs) || selectedFMUs.length <= RASTER_MULTI_FMU_SOFT_LIMIT) {
      return false;
    }
    return !allowHeavyRaster;
  }, [selectedFMUs, allowHeavyRaster]);

  const prioritizedRasterRegions = useMemo(() => {
    if (!Array.isArray(selectedFMUs)) return [];

    const selectedSet = new Set(selectedFMUs);
    const preferred = PREFERRED_RASTER_REGIONS.filter((id) => selectedSet.has(id));
    const rest = selectedFMUs.filter((id) => !PREFERRED_RASTER_REGIONS.includes(id));

    return [...preferred, ...rest];
  }, [selectedFMUs]);

  const rasterRegions = useMemo(() => {
    if (!shouldLimitRasterRegions) {
      return prioritizedRasterRegions;
    }
    return prioritizedRasterRegions.slice(0, RASTER_MULTI_FMU_SOFT_LIMIT);
  }, [prioritizedRasterRegions, shouldLimitRasterRegions]);

  const clearcutStatsRegion = useMemo(() => (
    rasterRegions.length > 0 ? rasterRegions[0] : null
  ), [rasterRegions]);

  // Caribou range mode. Selecting ranges swaps the habitat layer's regions for
  // the FMUs carrying those ranges, so the layer follows range boundaries
  // instead of the FMU selection. Deliberately scoped to that one layer: per
  // issue #15 the range shape must not affect any other module.
  const [selectedRanges, setSelectedRanges] = useState([]);
  const [rangeRegions, setRangeRegions] = useState([]);

  useEffect(() => {
    if (selectedRanges.length === 0) {
      setRangeRegions([]);
      return undefined;
    }
    let cancelled = false;
    getFmusForRanges(selectedRanges)
      .then((fmus) => {
        if (!cancelled) setRangeRegions(fmus.slice(0, RASTER_RANGE_MODE_LIMIT));
      })
      .catch((err) => {
        console.error('[CaribouRanges]', err);
        if (!cancelled) setRangeRegions([]);
      });
    return () => { cancelled = true; };
  }, [selectedRanges]);

  const caribouRasterRegions = selectedRanges.length > 0 ? rangeRegions : rasterRegions;

  // Range outlines for the MapLibre map. The Leaflet branch has its own
  // component; this is the same data shaped for a geojson source.
  const caribouRangeGeoJson = useCaribouRangeGeoJson(selectedRanges);

  const handleToggleRange = useCallback((rangeId, on) => {
    setSelectedRanges((prev) => (
      on ? [...new Set([...prev, rangeId])] : prev.filter((r) => r !== rangeId)
    ));
  }, []);

  const handleToggleAllRanges = useCallback((on) => {
    setSelectedRanges(on ? CARIBOU_RANGES.map((r) => r.id) : []);
  }, []);

  const [moduleYears, setModuleYears] = useState(() => {
    const initial = {};
    MODULES.forEach((module) => {
      if (module.temporalOptions?.yearRange) {
        initial[module.id] = module.temporalOptions.yearRange[1];
      }
    });
    return initial;
  });

  const [activeLayers, setActiveLayers] = useState(() => {
    const initial = {};
    MODULES.forEach((module) => {
      initial[module.id] = module === MODULES[0] ? [module.layers[0].id] : [];
    });
    return initial;
  });

  const handleLayerToggle = (moduleId, layerId) => {
    if (MODULES.find((m) => m.id === moduleId)?.requiresAuth && !isAuthenticated) {
      openAuthModal('login');
      return;
    }
    setActiveLayers((prev) => {
      const current = prev[moduleId] || [];
      if (current.includes(layerId)) {
        // A sub-layer (parentLayerId) has no reason to stay active once its
        // parent is gone -- the render loop below wouldn't draw it anyway,
        // and leaving it "on" in state would make its checkbox look checked
        // while disabled with nothing on the map to show for it.
        const module = MODULES.find((m) => m.id === moduleId);
        const childIds = new Set(
          (module?.layers || []).filter((l) => l.parentLayerId === layerId).map((l) => l.id),
        );
        return { ...prev, [moduleId]: current.filter((l) => l !== layerId && !childIds.has(l)) };
      }
      return { ...prev, [moduleId]: [...current, layerId] };
    });
  };

  // Which clearcut data sources are drawn: 'ari' (official inventory) and/or
  // 'ml' (model estimates). Chosen in ClearcutDetection's panel, independently
  // of the disturbance type picked in the left-hand layer list.
  const [clearcutSources, setClearcutSources] = useState(['ari']);

  const handleToggleClearcutSource = useCallback((source, on) => {
    setClearcutSources((prev) => (
      on ? [...new Set([...prev, source])] : prev.filter((s) => s !== source)
    ));
  }, []);

  // activeLayers with the clearcut entry translated from (disturbance type x
  // source) into the layer ids the map actually draws. Everything that renders
  // or describes the map reads this; the left-hand list keeps reading
  // activeLayers, since that's the state its checkboxes toggle.
  const effectiveActiveLayers = useMemo(() => {
    const selected = activeLayers.clearcut || [];
    const ari = clearcutSources.includes('ari');
    const ml = clearcutSources.includes('ml');
    const clearcut = [];
    [
      ['clearcut-accumulated', 'clearcut-ml-accumulated'],
      ['clearcut-annual', 'clearcut-ml-annual'],
    ].forEach(([ariId, mlId]) => {
      if (!selected.includes(ariId)) return;
      if (ari) clearcut.push(ariId);
      if (ml) clearcut.push(mlId);
    });
    // The harvest-year polygons are ARI data, so they go with the ARI source.
    if (ari && selected.includes('clearcut-harvest-year-ari')) {
      clearcut.push('clearcut-harvest-year-ari');
    }
    return { ...activeLayers, clearcut };
  }, [activeLayers, clearcutSources]);

  // ---- Disturbance Alerts ----------------------------------------------
  // Loaded from /api/alerts while the module is open or its layer is on, and
  // reloaded when the session changes (staff get triage rights and notes).
  const [alertsData, setAlertsData] = useState(null);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState(null);
  const [alertFilters, setAlertFilters] = useState({ days: 30, status: 'all', hideFire: false });
  const [selectedAlertId, setSelectedAlertId] = useState(null);
  const alertsLayerOn = (activeLayers.alerts || []).includes('disturbance-alerts');
  const alertsWanted = isAuthenticated && (alertsLayerOn || selectedModuleId === 'alerts');

  const loadAlerts = useCallback(async () => {
    setAlertsLoading(true);
    setAlertsError(null);
    try {
      setAlertsData(await fetchAlerts(token));
    } catch (err) {
      setAlertsError(err.message);
    } finally {
      setAlertsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (alertsWanted) loadAlerts();
  }, [alertsWanted, loadAlerts]);

  // Every alert in the selected FMUs, with its age and display color attached
  // (the map styles by ageColor; MapLibre can't compute dates itself).
  const alertsInArea = useMemo(() => {
    if (!alertsData?.features) return [];
    const now = Date.now();
    return alertsData.features
      .filter((f) => !selectedFMUs.length || selectedFMUs.includes(f.properties.region))
      .map((f) => {
        const days = ageDays(f.properties.firstDetected, now);
        return { ...f, properties: { ...f.properties, ageDays: days, ageColor: ageColor(days) } };
      });
  }, [alertsData, selectedFMUs]);

  const filteredAlerts = useMemo(() => alertsInArea.filter((f) => {
    const p = f.properties;
    if (p.ageDays > alertFilters.days) return false;
    if (alertFilters.status !== 'all' && p.status !== alertFilters.status) return false;
    if (alertFilters.hideFire && (p.inFirePerimeter || ['fire', 'false_positive'].includes(p.triageLabel))) return false;
    return true;
  }), [alertsInArea, alertFilters]);

  const alertsGeoJson = useMemo(
    () => (alertsLayerOn ? { type: 'FeatureCollection', features: filteredAlerts } : null),
    [alertsLayerOn, filteredAlerts],
  );

  const zoomToAlert = useCallback((feature) => {
    const map = mapRef.current;
    if (!map?.fitBounds || !feature?.geometry) return;
    const [w, s, e, n] = geometryBounds(feature.geometry);
    map.fitBounds([[w, s], [e, n]], { padding: 80, maxZoom: 13.5, duration: 800 });
  }, []);

  const handleAlertTriage = useCallback(async (id, label, note) => {
    const updated = await triageAlert(token, id, label, note);
    setAlertsData((prev) => prev && ({
      ...prev,
      features: prev.features.map((f) => (f.properties.id === id ? updated : f)),
    }));
  }, [token]);

  // Clicking an alert on the map opens it in the panel, whichever module was showing.
  const handleAlertClick = useCallback((id) => {
    setSelectedAlertId(id);
    setSelectedModuleId('alerts');
  }, []);

  // Safety net: if a layer unmounts mid-load (year change, layer toggle)
  // without firing its `load` event, the spinner would stay forever.
  // Auto-dismiss after 12 s as a fallback.
  useEffect(() => {
    if (!tilesLoading) return;
    const guard = setTimeout(() => setTilesLoading(false), 12000);
    return () => clearTimeout(guard);
  }, [tilesLoading]);

  // Which years the selected FMUs actually burned in. Wildfire coverage is
  // sparse — a region only has tiles for years something burned — so this
  // narrows the wildfire slider to those years, the same way the clearcut
  // module narrows its own with a static availableYears list. Years with no
  // data are skipped rather than flagged.
  const [fireYears, setFireYears] = useState([]);

  useEffect(() => {
    let cancelled = false;

    if (selectedFMUs.length === 0) {
      setFireYears([]);
      return undefined;
    }

    getFireYearsForRegions(selectedFMUs)
      .then((years) => {
        if (!cancelled) setFireYears(years);
      })
      .catch(() => {
        if (!cancelled) setFireYears([]);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedFMUs]);

  // The wildfire slider stops only on years with data. Falls back to the
  // module's declared list when a region has no fires at all, so the slider
  // stays usable and the panel's "No fire recorded" message carries the point.
  const wildfireYearOptions = useMemo(() => {
    const declared = MODULES.find((m) => m.id === 'wildfire')?.temporalOptions?.availableYears;
    return fireYears.length > 0 ? fireYears : declared;
  }, [fireYears]);

  // Stops on the timeline: the union of every year any ACTIVE layer can show,
  // not just the selected module's. The control moves all of them, so it has to
  // offer every year one of them has -- otherwise switching modules would
  // silently change which years are reachable.
  const timelineYears = useMemo(() => {
    const expand = (module) => {
      if (module.id === 'wildfire') return wildfireYearOptions || [];
      const declared = module.temporalOptions?.availableYears;
      if (declared?.length) return declared;
      const range = module.temporalOptions?.yearRange;
      if (!range || range.length !== 2) return [];
      const [from, to] = range;
      return Array.from({ length: to - from + 1 }, (_, i) => from + i);
    };

    const years = new Set();
    MODULES.forEach((module) => {
      if (!(effectiveActiveLayers[module.id] || []).length) return;
      expand(module).forEach((y) => years.add(y));
    });

    // Nothing switched on: fall back to the module in front, so the timeline
    // doesn't vanish while the user is deciding what to display.
    if (years.size === 0 && selectedModule) expand(selectedModule).forEach((y) => years.add(y));

    return [...years].sort((a, b) => a - b);
  }, [effectiveActiveLayers, wildfireYearOptions, selectedModule]);

  // Changing FMU can drop the year currently being viewed out of the list.
  // Snap to the nearest available year, otherwise the slider handle and the
  // year label disagree.
  useEffect(() => {
    if (selectedModule?.id !== 'wildfire') return;
    if (!wildfireYearOptions?.length) return;
    if (wildfireYearOptions.includes(selectedYear)) return;

    const nearest = wildfireYearOptions.reduce((best, year) => (
      Math.abs(year - selectedYear) < Math.abs(best - selectedYear) ? year : best
    ), wildfireYearOptions[0]);

    setSelectedYear(nearest);
    setModuleYears((prev) => ({ ...prev, wildfire: nearest }));
  }, [wildfireYearOptions, selectedYear, selectedModule]);



  const mapMaxZoom = basemapMode === 'satellite' ? TILE_ZOOM_RANGE.max : LIGHT_BASEMAP_MAX_ZOOM;

  // Boundary GeoJSON for the MapLibre renderer. The Leaflet path fetches this
  // inside <RegionBoundaries>; both call the same hook, so the two render from
  // identical data.
  const maplibreRegions = useRegionBoundaries(selectedFMUs, useOntarioOverview);

  // Shapes the user has drawn, from whichever renderer is active. Held here
  // rather than inside either map so the AI agent sees the same thing on both.
  const [drawnFeatures, setDrawnFeatures] = useState([]);

  // Boundaries are only loaded by the hook on the MapLibre path; the Leaflet
  // <RegionBoundaries> calls the same hook, which caches, so this is the same
  // data either way and costs nothing extra.
  const drawingContext = useMemo(
    () => summarizeDrawing(drawnFeatures, maplibreRegions),
    [drawnFeatures, maplibreRegions],
  );
  const [drawingStats, setDrawingStats] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const hasDrawnArea = drawnFeatures.some((f) => (
        f?.geometry?.type === 'Polygon' || f?.geometry?.type === 'MultiPolygon'
      ));
      const hasClearcutLayer = (effectiveActiveLayers.clearcut || []).some(
        (id) => id === 'clearcut-accumulated' || id === 'clearcut-annual',
      );
      const clearcutYear = moduleYears.clearcut || selectedYear;
      const candidateRegions = drawingContext?.regionsContaining?.length
        ? drawingContext.regionsContaining
        : drawingContext?.regionsNearby?.length
          ? drawingContext.regionsNearby
          : selectedFMUs;

      if (!hasDrawnArea || !hasClearcutLayer || candidateRegions.length === 0) {
        if (!cancelled) {
          setDrawingStats({ clearcutInDrawnAreaAvailable: false });
        }
        return;
      }

      const presence = await computeClearcutDrawingPresence({
        features: drawnFeatures,
        regions: candidateRegions,
        year: clearcutYear,
      });

      if (cancelled) return;

      if (!presence.available) {
        setDrawingStats({ clearcutInDrawnAreaAvailable: false });
        return;
      }

      setDrawingStats({
        clearcutInDrawnAreaAvailable: true,
        intersectsClearcut: presence.intersects,
        intersectingPatchCount: presence.intersectingPatchCount,
        regionsChecked: presence.regionsChecked,
        year: clearcutYear,
      });
    };

    run();
    return () => { cancelled = true; };
  }, [drawnFeatures, drawingContext, effectiveActiveLayers.clearcut, moduleYears.clearcut, selectedYear, selectedFMUs]);

  // Which panel tab is showing. Lifted out of <ModuleSelector> so the map's
  // "Ask AI" button can bring the agent forward.
  const [panelTab, setPanelTab] = useState('modules');
  const [pendingPrompt, setPendingPrompt] = useState(null);
  // Geometry the assistant proposed. Kept apart from drawnFeatures so a
  // proposal never feeds back into the context as something the user drew.
  const [proposedFeatures, setProposedFeatures] = useState(null);

  const askAboutDrawing = useCallback(() => {
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    setPanelTab('forest-ai');
    setPendingPrompt("What's in here?");
  }, [isAuthenticated, openAuthModal]);

  // Signing out closes whatever needed the account: the AI tab, the alerts
  // module and its layer. The rest of the map stays as it was.
  useEffect(() => {
    if (isAuthenticated) return;
    setPanelTab((tab) => (tab === 'forest-ai' ? 'modules' : tab));
    setSelectedModuleId((id) => (MODULES.find((m) => m.id === id)?.requiresAuth ? MODULES[0].id : id));
    setActiveLayers((prev) => {
      const gated = MODULES.filter((m) => m.requiresAuth && (prev[m.id] || []).length);
      if (!gated.length) return prev;
      const next = { ...prev };
      gated.forEach((m) => { next[m.id] = []; });
      return next;
    });
    setSelectedAlertId(null);
    setAlertsData(null);
  }, [isAuthenticated]);

  // Flattens the module/layer/region matrix into plain source descriptors.
  // Mirrors the <RasterTileLayer> mapping in the Leaflet branch below -- kept as
  // data rather than components because MapLibre sources are declared by value.
  // Which region/years actually have a clearcut COG published. Only wabigoon
  // does today, so requesting one per selected region gave a 404 per region and
  // an AggregateError out of MapLibre's tile loader -- and drew nothing, rather
  // than falling back to the PNG pyramid that does exist for every region.
  // How many years ahead playback buffers.
  const PREFETCH_YEARS = 2;
  const [playing, setPlaying] = useState(false);

  // Coverage per COG prefix, not one shared set. Clearcut and wildfire are
  // separate products holding different region-years -- wabigoon has clearcut for
  // twelve years and fire for one -- so a single set would have each layer
  // answering for the other. A missing key means "not loaded yet".
  const [cogCoverageByPrefix, setCogCoverageByPrefix] = useState({});
  // Regions that have a clearcut product of any kind. null until known, and
  // treated the same way as unknown COG coverage: request nothing yet.
  const [clearcutRegions, setClearcutRegions] = useState(null);

  // Which PNG tile sets exist, keyed by the directory under /tiles/. Loaded for
  // every layer up front: it is one manifest fetch shared by all of them.
  const [tileCoverage, setTileCoverage] = useState({});

  useEffect(() => {
    let cancelled = false;
    const dirs = [...new Set(
      MODULES.flatMap((m) => (m.layers || []).map((l) => tileDirOf(l.tileUrl)).filter(Boolean)),
    )];
    Promise.all(dirs.map((dir) => getTileCoverage(dir).then((covered) => [dir, covered])))
      .then((entries) => {
        if (cancelled) return;
        setTileCoverage(Object.fromEntries(entries.filter(([, covered]) => covered)));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getRegionsWithClearcutData(DEFAULT_CLEARCUT_SENSOR)
      .then((regions) => { if (!cancelled) setClearcutRegions(regions); })
      // A failed stats fetch shouldn't blank the map -- fall back to asking for
      // everything, which is the old behaviour.
      .catch(() => { if (!cancelled) setClearcutRegions(null); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    // Ranges count as a selection even with no FMU chosen -- clearing coverage
    // on an empty rasterRegions left caribou range mode waiting on a set that
    // would never arrive, which reads as "coverage unknown" and draws nothing.
    if (!USE_MAPLIBRE || !USE_COG
        || (rasterRegions.length === 0 && selectedRanges.length === 0)) {
      setCogCoverageByPrefix({});
      return undefined;
    }
    let cancelled = false;

    // One request per active COG product, asking only about that product's own
    // module year. Probing every module's year multiplied the request count for
    // nothing. (Moot once the manifest is published -- this is the fallback.)
    const wanted = [];
    MODULES.forEach((module) => {
      (effectiveActiveLayers[module.id] || []).forEach((layerId) => {
        const caribouRangeMode = layerId === 'caribou-habitat' && selectedRanges.length > 0;
        const prefix = coveragePrefixForLayer(layerId, { caribouRangeMode });
        if (!prefix || wanted.some((w) => w.prefix === prefix)) return;
        wanted.push({
          prefix,
          year: moduleYears[module.id] || selectedYear,
          // Caribou in range mode is keyed by range, everything else by FMU.
          // Only the HEAD-probe fallback reads this -- the manifest answers for
          // a whole prefix at once -- but probing FMU ids against a range-keyed
          // product would report the layer as having no coverage at all.
          regions: caribouRangeMode ? selectedRanges : rasterRegions,
        });
      });
    });

    Promise.all(wanted.map(({ prefix, year, regions }) => (
      getCogCoverage(regions.map((region) => ({ region, years: [year] })), prefix)
        .then((covered) => [prefix, covered])
    ))).then((entries) => {
      if (!cancelled) setCogCoverageByPrefix(Object.fromEntries(entries));
    });

    return () => { cancelled = true; };
  }, [rasterRegions, selectedRanges, effectiveActiveLayers, moduleYears, selectedYear]);

  // Source id -> "Module / Layer". Ids are built below as
  // `<prefix>-<layerId>-<region>`, and layer ids themselves contain hyphens, so
  // this is a lookup rather than a parse.
  const layerLabelById = useMemo(() => {
    const labels = {};
    MODULES.forEach((module) => {
      module.layers?.forEach((layer) => {
        rasterRegions.forEach((region) => {
          const label = `${module.name} · ${layer.name}`;
          labels[`raster-${layer.id}-${region}`] = label;
          labels[`cog-${layer.id}-${region}`] = label;
        });
      });
    });
    return labels;
  }, [rasterRegions]);

  // Source ids carry a trailing year; the label is the same whichever year is
  // showing, so it is looked up without one.
  const labelForSourceId = useCallback(
    (id) => layerLabelById[id.replace(/-\d{4}$/, '')],
    [layerLabelById],
  );

  // One entry per layer, however many regions are still fetching for it: the
  // user asked which module is loading, not how the request fan-out went.
  const loadingLabel = useMemo(() => {
    const names = [...new Set(loadingSourceIds.map(labelForSourceId).filter(Boolean))];
    if (names.length === 0) return null;
    if (names.length === 1) return names[0];
    return `${names[0]} +${names.length - 1} more`;
  }, [loadingSourceIds, labelForSourceId]);

  const maplibreLayers = useMemo(() => {
    if (!USE_MAPLIBRE) return { rasterLayers: [], cogLayers: [] };

    const rasterLayers = [];
    const cogLayers = [];
    const vectorLayers = [];

    MODULES.forEach((module) => {
      const moduleActiveLayerIds = effectiveActiveLayers[module.id] || [];
      // Iterates module.layers (fixed definition order) rather than
      // activeLayers[module.id] (toggle order) -- draw order otherwise
      // depended on which layer got switched on first, so accumulated could
      // end up painted over annual or vice versa depending on click order.
      // Definition order is the actual z-order contract: annual is listed
      // after accumulated in MODULES specifically so it always draws on top.
      (module.layers || []).forEach((layer) => {
        if (!moduleActiveLayerIds.includes(layer.id)) return;

        const moduleYear = moduleYears[module.id] || selectedYear;

        // Vector (PMTiles) layers carry no region/year in their URL -- one
        // archive covers every region and the full year range already, tiled
        // spatially -- so they skip the per-region-year raster machinery below
        // entirely rather than being forced through a loop built for it. The
        // features themselves still get a year filter, though: this layer is
        // a sub-layer of Accumulated Clearcuts, so it should only ever show
        // what that raster is currently showing, not every inspectable year
        // in the archive at once.
        if (layer.vectorUrl) {
          if (layer.parentLayerId && !moduleActiveLayerIds.includes(layer.parentLayerId)) return;
          vectorLayers.push({
            id: layer.id,
            url: layer.vectorUrl,
            sourceLayer: layer.vectorSourceLayer,
            color: layer.color,
            filter: layer.yearFilterField
              ? ['all',
                  ['>', ['get', layer.yearFilterField], moduleYear - ARI_ACCUMULATED_WINDOW_YEARS],
                  ['<=', ['get', layer.yearFilterField], moduleYear]]
              : undefined,
          });
          return;
        }

        // Caribou is the one layer whose unit is not the FMU. With ranges
        // selected it draws per RANGE, because an FMU pyramid carries every
        // range crossing it -- troutlake holds Berens, Churchill and Sydney, so
        // asking for Berens through FMU tiles drew all three. Mirrors the same
        // switch in the Leaflet branch below.
        const rangeMode = layer.id === 'caribou-habitat' && selectedRanges.length > 0;
        let layerRegions;
        if (rangeMode) {
          layerRegions = selectedRanges;
        } else if (layer.id === 'caribou-habitat') {
          layerRegions = caribouRasterRegions;
        } else {
          layerRegions = rasterRegions;
        }
        if (layerRegions.length === 0) return;

        // The current year, then the buffer. Buffered years are mounted at zero
        // opacity so MapLibre fetches their tiles for the current viewport
        // before they are needed; when the year advances the source it wants
        // already exists, loaded, instead of starting a fresh round of
        // requests. Only while playing -- doing this during ordinary browsing
        // would triple the requests for no benefit.
        const upcoming = playing
          ? timelineYears.slice(timelineYears.indexOf(moduleYear) + 1, timelineYears.indexOf(moduleYear) + 1 + PREFETCH_YEARS)
          : [];

        [moduleYear, ...upcoming].forEach((renderYear, frameIdx) => {
        const layerOpacity = frameIdx === 0 ? undefined : 0;

        layerRegions.forEach((region) => {
          // Which COG product this layer draws, and whose coverage answers for
          // it. Asking per prefix is what lets wildfire be gated by its own
          // availability rather than clearcut's -- the two hold different
          // region-years, so one shared set would have each hiding the other.
          //
          // Caribou resolves to a different prefix per mode -- range-keyed with
          // ranges selected, FMU-keyed otherwise -- so the mode has to travel
          // with the lookup. Testing FMU ids against range-keyed coverage would
          // match nothing and hide the layer.
          const cogOpts = { caribouRangeMode: rangeMode };
          const cogPrefix = USE_COG ? cogPrefixForLayer(layer.id, cogOpts) : null;
          const coverage = cogPrefix
            ? cogCoverageByPrefix[coveragePrefixForLayer(layer.id, cogOpts)]
            : undefined;

          // Hold off until coverage is known rather than rendering the PNG
          // meanwhile. Falling back eagerly meant every clearcut region fired a
          // full pyramid of tile requests on load, only to be replaced by the
          // COG a moment later once the manifest arrived -- the requests still
          // completed, so it was a burst of downloads for tiles nobody drew.
          // The manifest is a single small file, so the wait is brief.
          if (cogPrefix && coverage === undefined) return;

          // Skip regions with no clearcut product at all. lakehead_2025 has
          // neither a COG nor a tile pyramid, so the PNG fallback was issuing a
          // full request tree per region purely to collect 404s. Clearcut-only:
          // it is derived from clearcut_stats.json.
          if (cogPrefix && module.id === 'clearcut'
              && clearcutRegions && !clearcutRegions.has(region)) return;

          const hasCog = !!coverage && coverage.has(`${region}_${renderYear}`);
          // From the resolved prefix, not the layer id: caribou's id maps to two
          // different products depending on mode.
          const cogUrl = hasCog ? cogUrlForPrefix(cogPrefix, region, renderYear) : null;

          // A sparse COG layer with no raster for this region-year and no PNG to
          // fall back to has nothing to draw, and asking anyway is what produced
          // the 404s. Skip only when the manifest positively says the pyramid
          // lacks this region-year -- an unindexed directory means "unknown", not
          // "absent", and must fall through to the PNG path.
          //
          // tileDirOf() reads one path segment, so tiles/wildlife/caribou/ comes
          // back as `wildlife`, which the manifest never indexes: its tile scan
          // only sees <region>_<year> directly under tiles/<dir>/. Treating that
          // as "no pyramid" hid the caribou layer completely.
          const pngDir = tileDirOf(layer.tileUrl);
          const pngCoverage = pngDir ? tileCoverage[pngDir] : null;
          if (cogPrefix && !hasCog && !TINTED_LAYER_IDS.has(layer.id)
              && pngCoverage && !pngCoverage.has(`${region}_${renderYear}`)) return;

          // A layer whose COG product is complete needs no PNG fallback: absence
          // from coverage means "no data here", not "not converted yet". Caribou
          // says so because every FMU with habitat has a COG, and the 19 FMUs
          // without one are outside the caribou range entirely -- falling back
          // there fetched a full pyramid of 404s, since the PNG set does not
          // cover them either. Clearcut must NOT declare this: only wabigoon is
          // converted, and its fallback is load-bearing.
          if (cogPrefix && !hasCog && layer.cogAuthoritative) return;
          if (cogUrl) {
            // color carries the layer's identity, not the class's: accumulated and
            // annual are both class 2 in the raster, so without it they'd paint the
            // same and the two layers would be indistinguishable when stacked.
            cogLayers.push({
              id: `${layer.id}-${region}-${renderYear}`,
              url: cogUrl,
              color: layer.color,
              opacity: layerOpacity,
              // All undefined for clearcut, which falls back to its own palette
              // and class 2. Wildfire supplies its own table and paints class 1.
              palette: layer.cogPalette,
              visibleClasses: layer.cogClasses,
              colorClass: layer.cogColorClass,
              // Layer id for the outline pass, which paints in that layer's
              // color; undefined draws the plain fill.
              outline: layer.cogOutline ? layer.id : undefined,
              subtractUrl: layer.cogNewSincePrevious
                ? previousCogUrl(cogPrefix, coverage, region, renderYear)
                : undefined,
            });
            return;
          }

          // COG-only layers (the ML outlines) have no PNG pyramid at all.
          if (!layer.tileUrl) return;

          // Per region AND year: troutlake has clearcut tiles for 2020 and 2024
          // only, so a region-level check still asked for 2025.
          const tileDir = tileDirOf(layer.tileUrl);
          const covered = tileDir ? tileCoverage[tileDir] : null;
          if (covered && !covered.has(`${region}_${renderYear}`)) return;

          // In range mode `region` is a range id, and the per-range pyramid
          // spells its folders range_<id>_<year> -- the COGs use the bare id, so
          // only the PNG path needs the prefix. Behind CARIBOU_RANGE_TILES
          // because a checkout without those tiles would otherwise ask for a
          // pyramid that is not there.
          if (rangeMode && !CARIBOU_RANGE_TILES) return;
          const template = rangeMode ? CARIBOU_RANGE_TILE_URL : layer.tileUrl;
          const tileRegion = rangeMode ? `range_${region}` : region;

          let tileUrl = template.replace('{year}', renderYear).replace('{region}', tileRegion);

          if (layer.id === 'clearcut-accumulated' && CLEARCUT_SENSOR_SUBFOLDER_YEARS.includes(renderYear)) {
            tileUrl = tileUrl.replace(
              `${TILES_BASE_URL}/tiles/clearcut/${region}_${renderYear}/`,
              `${TILES_BASE_URL}/tiles/clearcut/${region}_${renderYear}/${DEFAULT_CLEARCUT_SENSOR}/`,
            );
          }

          rasterLayers.push({
            // The year is part of the id so a year change REPLACES the source
            // rather than retuning it. react-map-gl calls setTiles when only the
            // URLs change, and reloading a source that is mid-draw leaves a
            // renderable tile whose texture has been returned to the pool --
            // MapLibre then throws "Cannot read properties of undefined
            // (reading 'bind')" from its render loop, on an unguarded bind that
            // no paint setting can avoid. Remove-and-add tears the old tiles
            // down with their layer, so nothing is left pointing at a freed
            // texture.
            id: `${layer.id}-${region}-${renderYear}`,
            opacity: layerOpacity,
            // Routed through the tint protocol for the layers whose PNGs are a
            // flat intensity ramp that <RasterTileLayer> recolors on Leaflet.
            // Clearcut is excluded: it gets its color from the COG palette.
            tileUrl: TINTED_LAYER_IDS.has(layer.id) ? tintedTileUrl(layer.id, tileUrl) : tileUrl,
            tms: layer.tms !== undefined ? layer.tms : true,
          });
        });
        });
      });
    });

    return { rasterLayers, cogLayers, vectorLayers };
  }, [effectiveActiveLayers, rasterRegions, caribouRasterRegions, selectedRanges,
      moduleYears, selectedYear, cogCoverageByPrefix,
      clearcutRegions, tileCoverage, playing, timelineYears]);

  // What the AI agent needs to answer "what's in here" across every layer the
  // user has switched on, not just the module currently in front. Names rather
  // than ids, since these go into a prompt.
  const activeLayerSummary = useMemo(() => (
    MODULES.flatMap((module) => (effectiveActiveLayers[module.id] || []).map((layerId) => ({
      module: module.name,
      layer: module.layers?.find((l) => l.id === layerId)?.name || layerId,
      year: moduleYears[module.id] || selectedYear,
    })))
  ), [effectiveActiveLayers, moduleYears, selectedYear]);

  const moduleData = {
    percentage: clearcutPercent,
    biomassHistogram,
    activeLayerSummary,
    selectedFMUs,
    selectedYear,
    selectedRanges,
    onToggleRange: handleToggleRange,
    onToggleAllRanges: handleToggleAllRanges,
    // The regions the habitat layer is actually drawing, so the panel's numbers
    // describe what is on the map rather than the FMU selection behind it.
    caribouRegions: caribouRasterRegions,
    // Lets the clearcut module narrow its chart to regions the map can draw.
    useCogClearcut: USE_COG,
    drawingStats,
    clearcutSources,
    onToggleClearcutSource: handleToggleClearcutSource,
    alerts: {
      all: alertsInArea,
      features: filteredAlerts,
      meta: alertsData?.meta,
      loading: alertsLoading,
      error: alertsError,
      refresh: loadAlerts,
      filters: alertFilters,
      setFilters: setAlertFilters,
      selectedId: selectedAlertId,
      select: setSelectedAlertId,
      zoomTo: zoomToAlert,
      canTriage: Boolean(alertsData?.meta?.canTriage),
      triage: handleAlertTriage,
      layerOn: alertsLayerOn,
      showLayer: () => handleLayerToggle('alerts', 'disturbance-alerts'),
    },
  };

  // "Inspect harvest year" reads as an option OF Accumulated Clearcuts, not a
  // layer of its own -- it's the <MapDisplayOptions> extra slot for the
  // clearcut module (see the render below), not a left-hand-panel layer row.
  // Still backed by the same activeLayers/handleLayerToggle state (including
  // the parent-off-turns-child-off cascade) rather than a parallel toggle.
  const inspectHarvestActive = (activeLayers.clearcut || []).includes('clearcut-harvest-year-ari');
  // Needs the ARI source on too: the harvest polygons are ARI data.
  const accumulatedActive = (activeLayers.clearcut || []).includes('clearcut-accumulated')
    && clearcutSources.includes('ari');

  const handleModuleSelect = useCallback((module) => {
    if (module.requiresAuth && !isAuthenticated) {
      openAuthModal('login');
      return;
    }
    setSelectedModuleId(module.id);
    // Opening Disturbance Alerts shows them: the module is a single layer, and
    // an alert list with nothing on the map reads as broken.
    if (module.id === 'alerts') {
      setActiveLayers((prev) => ((prev.alerts || []).includes('disturbance-alerts')
        ? prev
        : { ...prev, alerts: [...(prev.alerts || []), 'disturbance-alerts'] }));
    }
    if (moduleYears[module.id] !== undefined) {
      setSelectedYear(moduleYears[module.id]);
    } else if (module.temporalOptions?.yearRange) {
      const [, maxYear] = module.temporalOptions.yearRange;
      setSelectedYear(maxYear);
    }
  }, [moduleYears, isAuthenticated, openAuthModal]);

  // The year is a property of the view, not of the module being read: the
  // timeline sits on the map and moves everything drawn there. Setting only the
  // selected module's year meant playback animated one layer while the others
  // stayed frozen on whatever year they were last left at -- and, worse, that
  // the map showed several different years at once without saying so.
  //
  // Modules with no data for a year simply draw nothing for it; the tile and COG
  // coverage gates already handle that, so no year needs special-casing here.
  const handleYearChange = useCallback((year) => {
    setSelectedYear(year);
    setModuleYears((prev) => {
      const next = { ...prev };
      MODULES.forEach((module) => { next[module.id] = year; });
      return next;
    });
  }, []);

  const PAGE_MAP = {
    about: AboutPage,
    help: HelpPage,
    news: NewsPage,
    publication: PublicationPage,
    documentation: DocumentationPage,
  };

  if (!showApp) {
    return (
      <div className="app-wrapper">
        <TopMenu
          isLanding={true}
          onNavigate={(page) => {
            setShowApp(true);
            navigateToPage(page);
          }}
          onHome={() => {
            setShowApp(false);
            setActivePage(null);
          }}
          activePage={null}
          onOpenAdminDashboard={() => setAdminDashboardOpen(true)}
          onOpenChatHistory={() => setChatHistoryOpen(true)}
          onOpenStoryMaps={() => setStoryMapsOpen(true)}
          onOpenBugReport={() => setBugReportOpen(true)}
        />
        <LandingPage
          onEnter={handleEnterApp}
          onOpenAbout={() => {
            setShowApp(true);
            setActivePage('about');
          }}
          onOpenNews={(slug = null) => {
            setShowApp(true);
            setNewsSlug(slug);
            setActivePage('news');
          }}
          onOpenDocumentation={() => {
            setShowApp(true);
            setActivePage('documentation');
          }}
        />
        <AuthModal />
        <AdminDashboard
          isOpen={adminDashboardOpen}
          onClose={() => setAdminDashboardOpen(false)}
        />
        <UserChatHistoryModal
          isOpen={chatHistoryOpen}
          onClose={() => setChatHistoryOpen(false)}
        />
        <StoryMapsModal isOpen={storyMapsOpen} onClose={() => setStoryMapsOpen(false)} />
        <BugReportModal
          isOpen={bugReportOpen}
          onClose={() => setBugReportOpen(false)}
          currentContext={currentContext}
        />
      </div>
    );
  }

  if (activePage) {
    const PageComponent = PAGE_MAP[activePage];
    return (
      <div className="app-wrapper">
        <TopMenu
          onNavigate={navigateToPage}
          onHome={() => setActivePage(null)}
          activePage={activePage}
          onOpenAdminDashboard={() => setAdminDashboardOpen(true)}
          onOpenChatHistory={() => setChatHistoryOpen(true)}
          onOpenStoryMaps={() => setStoryMapsOpen(true)}
          onOpenBugReport={() => setBugReportOpen(true)}
        />
        {PageComponent && (
          <PageComponent
            onBack={() => setActivePage(null)}
            {...(activePage === 'news' ? { initialSlug: newsSlug } : {})}
          />
        )}
        <AuthModal />
        <AdminDashboard
          isOpen={adminDashboardOpen}
          onClose={() => setAdminDashboardOpen(false)}
        />
        <UserChatHistoryModal
          isOpen={chatHistoryOpen}
          onClose={() => setChatHistoryOpen(false)}
        />
        <StoryMapsModal isOpen={storyMapsOpen} onClose={() => setStoryMapsOpen(false)} />
        <BugReportModal
          isOpen={bugReportOpen}
          onClose={() => setBugReportOpen(false)}
          currentContext={currentContext}
        />
      </div>
    );
  }

  return (
    <div className="app-wrapper">
      <SpeedInsights scriptSrc="https://va.vercel-scripts.com/v1/speed-insights/script.js" />
      <Analytics scriptSrc="https://va.vercel-scripts.com/v1/script.js" />
      {/* Map workspace only: the landing and info pages have mobile layouts */}
      <MobileWarning />
      <TopMenu
        onNavigate={navigateToPage}
        onHome={() => {
          setShowApp(false);
          setActivePage(null);
        }}
        activePage={activePage}
        onOpenAdminDashboard={() => setAdminDashboardOpen(true)}
        onOpenChatHistory={() => setChatHistoryOpen(true)}
        onOpenStoryMaps={() => setStoryMapsOpen(true)}
        onOpenBugReport={() => setBugReportOpen(true)}
      />
      <div className="layout-container">
        <ModuleSelector
          modules={MODULES}
          selectedModule={selectedModule}
          onModuleSelect={handleModuleSelect}
          activeLayers={activeLayers}
          onLayerToggle={handleLayerToggle}
          moduleData={moduleData}
          selectedYear={selectedYear}
          selectedFMUs={selectedFMUs}
          selectedSensor={DEFAULT_CLEARCUT_SENSOR}
          drawingContext={drawingContext}
          activeTab={panelTab}
          onTabChange={setPanelTab}
          pendingPrompt={pendingPrompt}
          onPromptConsumed={() => setPendingPrompt(null)}
          onProposeFeatures={setProposedFeatures}
          onOpenStoryMaps={() => setStoryMapsOpen(true)}
          regionsData={maplibreRegions}
        />

        <div className="map-center">
          <FMUSelector values={selectedFMUs} onChange={setSelectedFMUs} />

          {shouldLimitRasterRegions && (
            <div className="performance-notice" role="status" aria-live="polite">
              <span>
                Showing raster tiles for {RASTER_MULTI_FMU_SOFT_LIMIT} of {selectedFMUs.length} selected areas
                to keep the map responsive.
              </span>
              <button
                type="button"
                className="performance-notice-button"
                onClick={() => setAllowHeavyRaster(true)}
              >
                Load all anyway
              </button>
            </div>
          )}

          {/* Both docked above the map, stacked in one positioned column so
              the pair moves as a unit -- MapDisplayOptions is common to every
              module (opacity applies to whatever is drawn, not to whichever
              module the panel happens to be showing) for the same reason the
              year timeline itself lives on the map rather than in the panel. */}
          <div className="map-bottom-controls">
            <MapDisplayOptions
              opacity={rasterOpacity}
              onOpacityChange={setRasterOpacity}
              extra={selectedModule?.id === 'clearcut' ? (
                <label
                  htmlFor="inspect-harvest-toggle"
                  className="map-display-options-checkbox"
                  title={
                    accumulatedActive
                      ? 'Click a stand on the map to see its harvest year'
                      : 'Turn on Accumulated Clearcuts to inspect stands'
                  }
                >
                  <input
                    id="inspect-harvest-toggle"
                    type="checkbox"
                    checked={inspectHarvestActive && accumulatedActive}
                    disabled={!accumulatedActive}
                    onChange={() => handleLayerToggle('clearcut', 'clearcut-harvest-year-ari')}
                  />
                  Inspect harvest year
                </label>
              ) : null}
            />
            <MapTimeline
              years={timelineYears}
              selectedYear={selectedYear}
              onYearChange={handleYearChange}
              onPlayingChange={setPlaying}
              loading={tilesBusy}
            />
          </div>

          <MapSourcesInfo onOpenDocumentation={() => setActivePage('documentation')} />

          <button
            className="basemap-toggle-btn"
            onClick={() => setBasemapMode((m) => (m === 'satellite' ? 'light' : 'satellite'))}
            title={basemapMode === 'satellite' ? 'Switch to map view' : 'Switch to satellite view'}
          >
            {basemapMode === 'satellite' ? '🗺️ Map' : '🛰️ Satellite'}
          </button>

          <button
            className="locate-btn"
            onClick={() => handleLocateUser(mapRef)}
            title="Locate Me"
          />

          {/* The label is for screen readers only: the spinner sits over the map
              and a word of text there competes with the data underneath. */}
          <div className="loading-indicator" style={{ display: mapReady ? 'none' : 'flex' }}>
            <span className="loading-spinner" role="status" aria-label="Loading map" />
          </div>

          {/* Centred but small and click-through, so it marks progress without
              standing in front of the data. The status line names what is
              actually being fetched -- "still loading" is far less useful than
              "still loading Wildfire". */}
          <div className="tile-activity" style={{ display: tilesLoading ? 'flex' : 'none' }}>
            <span className="loading-spinner loading-spinner--small" role="status" aria-label="Loading map data" />
          </div>

          {tilesLoading && (
            <div className="load-status" role="status">
              Loading{loadingLabel ? ` ${loadingLabel}` : ' map data'}…
            </div>
          )}

          {USE_MAPLIBRE ? (() => {
            const basemapYear = moduleYears[selectedModule?.id] || selectedYear;
            const { url, attribution } = getBasemapConfig(basemapYear);
            // Imagery for the next years on the timeline, loaded ahead while
            // playing -- same buffer the overlays use (PREFETCH_YEARS).
            const upcomingIdx = timelineYears.indexOf(basemapYear) + 1;
            const satellitePrefetchUrls = playing
              ? timelineYears.slice(upcomingIdx, upcomingIdx + PREFETCH_YEARS)
                .map((y) => getBasemapConfig(y).url)
              : [];
            return (
              <React.Suspense fallback={(
                <div className="loading-indicator" style={{ display: 'flex' }}>
                  <span className="loading-spinner" role="status" aria-label="Loading map" />
                </div>
              )}>
              <MapLibreMap
                center={center}
                zoom={TILE_ZOOM_LEVELS[0]}
                minZoom={MAP_MIN_ZOOM}
                maxZoom={mapMaxZoom}
                basemapMode={basemapMode}
                satelliteUrl={url}
                satelliteAttribution={attribution}
                satellitePrefetchUrls={satellitePrefetchUrls}
                lightBasemap={LIGHT_BASEMAP}
                regionsData={maplibreRegions}
                rangeBoundaries={caribouRangeGeoJson}
                rasterLayers={maplibreLayers.rasterLayers}
                cogLayers={maplibreLayers.cogLayers}
                vectorLayers={maplibreLayers.vectorLayers}
                rasterOpacity={rasterOpacity}
                mapRef={mapRef}
                onMapReady={() => setMapReady(true)}
                onDrawChange={setDrawnFeatures}
                onAskAboutDrawing={askAboutDrawing}
                onLoadingChange={handleLoadingChange}
                proposedFeatures={proposedFeatures}
                drawingEnabled
                alertsGeoJson={alertsGeoJson}
                selectedAlertId={selectedAlertId}
                onAlertClick={handleAlertClick}
              />
              </React.Suspense>
            );
          })() : (
          <MapContainer
            center={center}
            zoom={TILE_ZOOM_LEVELS[0]}
            minZoom={MAP_MIN_ZOOM}
            maxZoom={mapMaxZoom}
            zoomControl={false}
            whenCreated={(mapInstance) => {
              console.log('Map created', mapInstance);
              mapRef.current = mapInstance;
            }}
            whenReady={() => {
              setMapReady(true);
            }}
            style={{ width: '100%', height: '100%', zIndex: 0 }}
          >
            {basemapMode === 'satellite' ? (() => {
              const basemapYear = moduleYears[selectedModule?.id] || selectedYear;
              const { url, attribution } = getBasemapConfig(basemapYear);
              return (
                <TileLayer
                  key={`satellite-${basemapYear}`}
                  url={url}
                  attribution={attribution}
                  zIndex={5}
                  pmIgnore={true}
                />
              );
            })() : (
              <React.Fragment key="light">
                <TileLayer
                  url={LIGHT_BASEMAP.baseUrl}
                  attribution={LIGHT_BASEMAP.attribution}
                  zIndex={5}
                  pmIgnore={true}
                />
                <TileLayer
                  url={LIGHT_BASEMAP.referenceUrl}
                  zIndex={6}
                  pmIgnore={true}
                />
              </React.Fragment>
            )}

            {MODULES.flatMap((module) => {
              const moduleActiveLayers = effectiveActiveLayers[module.id] || [];
              // module.layers order, not moduleActiveLayers (toggle) order --
              // same reasoning as the MapLibre branch above: draw order must
              // not depend on which layer was switched on first.
              return (module.layers || []).flatMap((layer) => {
                if (!moduleActiveLayers.includes(layer.id)) return null;
                // Vector (PMTiles) layers only exist on the MapLibre path --
                // this Leaflet branch has no PMTiles rendering, and layer.tileUrl
                // is undefined for them, so skip rather than crash on it below.
                // Same for COG-only layers (the ML outlines): Leaflet has no
                // COG renderer and they have no PNG pyramid to fall back to.
                if (layer.vectorUrl || !layer.tileUrl) return null;

                // Range mode addresses tiles by range rather than by FMU, so the
                // region list and the URL template have to change together.
                const useRangeTiles = layer.id === 'caribou-habitat'
                  && CARIBOU_RANGE_TILES
                  && selectedRanges.length > 0;

                let layerRegions;
                if (useRangeTiles) {
                  layerRegions = selectedRanges.map((r) => `range_${r}`);
                } else if (layer.id === 'caribou-habitat') {
                  layerRegions = caribouRasterRegions;
                } else {
                  layerRegions = rasterRegions;
                }
                if (layerRegions.length === 0) return null;

                const templateUrl = useRangeTiles ? CARIBOU_RANGE_TILE_URL : layer.tileUrl;
                const moduleYear = moduleYears[module.id] || selectedYear;

                return layerRegions.map((region) => {
                  let tileUrl = templateUrl.replace('{year}', moduleYear);
                  tileUrl = tileUrl.replace('{region}', region);

                  if (layer.id === 'clearcut-accumulated' && CLEARCUT_SENSOR_SUBFOLDER_YEARS.includes(moduleYear)) {
                    tileUrl = tileUrl.replace(
                      `${TILES_BASE_URL}/tiles/clearcut/${region}_${moduleYear}/`,
                      `${TILES_BASE_URL}/tiles/clearcut/${region}_${moduleYear}/${DEFAULT_CLEARCUT_SENSOR}/`,
                    );
                  }

                  return (
                    <RasterTileLayer
                      key={`${layer.id}-${region}`}
                      onStatsUpdate={
                        layer.id === 'clearcut-accumulated' && region === clearcutStatsRegion
                          ? setClearcutPercent
                          : null
                      }
                      onBiomassHistogramUpdate={setBiomassHistogram}
                      onLoadingChange={handleLoadingChange}
                      opacity={rasterOpacity}
                      tileUrl={tileUrl}
                      layerId={layer.id}
                      region={region}
                      year={moduleYear}
                      tms={layer.tms !== undefined ? layer.tms : true}
                    />
                  );
                });
              });
            })}

            <RegionBoundaries selectedFMUs={selectedFMUs} useOntarioOverview={useOntarioOverview} basemapMode={basemapMode} />
            {/* Selected ranges always outline themselves -- habitat with no
                boundary around it reads as a bug, and that is the only thing the
                old "Outline all ranges" switch was really being used for. Drawn
                only for what is selected, so the map says what you asked for and
                nothing else. */}
            <CaribouRangeBoundaries
              visible={selectedRanges.length > 0}
              selectedRanges={selectedRanges}
            />
            <DrawingTools mapRef={mapRef} onDrawChange={setDrawnFeatures} />
            <ZoomControlPositioner position="bottomleft" />
            <MaxZoomController maxZoom={mapMaxZoom} />
          </MapContainer>
          )}
        </div>

        <div className="module-panel-container">
          <ModulePanel
            module={selectedModule}
            data={moduleData}
            activeLayers={activeLayers[selectedModule?.id] || []}
            selectedYear={selectedYear}
            // null for modules with no years (Disturbance Alerts), so the
            // panel doesn't show the basemap-year caveat for them
            yearRange={selectedModule?.temporalOptions
              ? (selectedModule.temporalOptions.yearRange || [2010, 2024])
              : null}
            basemapSynced={
              basemapMode !== 'satellite' ||
              isBasemapSynced(moduleYears[selectedModule?.id] || selectedYear)
            }
          />
          <div className="right-column-logo">
            <img className="logo-image logo-light" src="/rsl-logo.png" alt="Remote Sensing Lab and Saint Louis University" />
            <img className="logo-image logo-dark" src="/rsl-logo-transparent.png" alt="Remote Sensing Lab and Saint Louis University" />
          </div>
        </div>
      </div>

      <AuthModal />
      <AdminDashboard
        isOpen={adminDashboardOpen}
        onClose={() => setAdminDashboardOpen(false)}
      />
      <UserChatHistoryModal
        isOpen={chatHistoryOpen}
        onClose={() => setChatHistoryOpen(false)}
      />
      <StoryMapsModal isOpen={storyMapsOpen} onClose={() => setStoryMapsOpen(false)} />
      <BugReportModal
        isOpen={bugReportOpen}
        onClose={() => setBugReportOpen(false)}
        currentContext={currentContext}
      />
    </div>
  );
}

export default App;
