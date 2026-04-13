import React, { useRef, useState, useCallback, useMemo } from "react";
import { MapContainer, TileLayer, useMap, GeoJSON } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";

import { useEffect } from 'react';

import TopMenu from './components/TopMenu';
import ModuleSelector from './components/ModuleSelector';
import ModulePanel from './components/ModulePanel';
import FMUSelector from './components/FMUSelector';
import ClearcutDetection from './modules/ClearcutDetection';
import BiomassModule from './modules/BiomassModule';
import { handleLocateUser, handlePlaceChanged } from "./utils/mapUtils";
import { CLEARCUT_PLANET_YEARS, CLEARCUT_SENSOR_SUBFOLDER_YEARS } from "./utils/clearcutAreaStats";
import { TILES_BASE_URL, DATA_BASE_URL } from "./config";

import "./styles/map.css";
import "./styles/topmenu.css";
import "./styles/menu.css";
import "./styles/layout.css";

const center = [49.80318325874751, -92.8087780822145];
const TILE_ZOOM_LEVELS = [6, 7, 8, 9, 10, 11, 12, 13, 14];
const TILE_ZOOM_RANGE = {
  min: Math.min(...TILE_ZOOM_LEVELS),
  max: Math.max(...TILE_ZOOM_LEVELS),
};

const BIOMASS_BINS = [
  { label: '0-10', min: 0, max: 10 },
  { label: '10-25', min: 10, max: 25 },
  { label: '25-40', min: 25, max: 40 },
  { label: '40-50', min: 40, max: 50 },
  { label: '50-70', min: 50, max: 70 },
  { label: '70-100', min: 70, max: 100 },
  { label: '100+', min: 100, max: Infinity },
];

const createEmptyBiomassHistogram = () => BIOMASS_BINS.map((bin) => ({
  label: bin.label,
  min: bin.min,
  max: bin.max,
  area: 0,
  pixels: 0,
}));

// Available modules - add new modules here
const MODULES = [
  {
    id: 'clearcut',
    name: 'Clearcut Detection',
    icon: '🪓',
    description: 'Detect and analyze clearcut areas',
    component: ClearcutDetection,
    temporalOptions: {
      yearRange: [2010, 2025],
    },
    layers: [
      { 
        id: 'clearcut-annual', 
        name: 'Annual Clearcuts', 
        tileUrl: `${TILES_BASE_URL}/tiles/clearcut/{region}_{year}/{z}/{x}/{y}.png`,
        color: '#FF0000',
        mode: 'annual',
        tms: false
      },
      { 
        id: 'clearcut-accumulated', 
        name: 'Accumulated Clearcuts', 
        tileUrl: `${TILES_BASE_URL}/tiles/{z}/{x}/accumulated_{y}.png`,
        color: '#FF6600',
        mode: 'accumulated'
      },
      { 
        id: 'clearcut-frequency', 
        name: 'Frequency', 
        tileUrl: `${TILES_BASE_URL}/tiles/{z}/{x}/frequency_{y}.png`,
        color: '#FF9900',
        mode: 'frequency'
      },
    ]
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
        tms: false
      },
    ]
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
        mode: 'annual'
      },
      { 
        id: 'forest-young', 
        name: 'Young Forest', 
        tileUrl: `${TILES_BASE_URL}/tiles/{year}/{z}/{x}/forest_young_{y}.png`,
        color: '#66BB6A',
        mode: 'annual'
      },
    ]
  },
  {
    id: 'wildlife',
    name: 'Wildlife & Species',
    icon: '🐦',
    description: 'Track birds and wildlife species distribution',
    component: ClearcutDetection,
    temporalOptions: {
      yearRange: [2015, 2025],
    },
    layers: [
      { 
        id: 'wildlife-birds', 
        name: 'Bird Species', 
        tileUrl: `${TILES_BASE_URL}/tiles/{year}/{z}/{x}/wildlife_birds_{y}.png`,
        color: '#FFD700',
        mode: 'annual'
      },
      { 
        id: 'wildlife-mammals', 
        name: 'Mammals', 
        tileUrl: `${TILES_BASE_URL}/tiles/{year}/{z}/{x}/wildlife_mammals_{y}.png`,
        color: '#8B4513',
        mode: 'annual'
      },
    ]
  },
];

function DrawingTools({ mapRef }) {
  const map = useMap();
  mapRef.current = map;

  React.useEffect(() => {
    map.pm.addControls({
      position: "bottomleft",
      drawPolygon: true,
      drawCircle: true,
      drawRectangle: true,
      editMode: true,
      dragMode: true,
      cutPolygon: false,
      removalMode: true,
    });

    map.on("pm:create", (e) => {
      console.log("Shape created:", e.layer.toGeoJSON());
    });

    return () => {
      map.off("pm:create");
    };
  }, [map]);

  return null;
}

function RegionBoundaries({ selectedFMUs }) {
  const [regionsData, setRegionsData] = useState(null);

  useEffect(() => {
    // Load regions.json
    fetch(`${DATA_BASE_URL}/data/regions-simplified.json`)
      .then(res => res.json())
      .then(data => setRegionsData(data))
      .catch(err => console.error('Failed to load regions:', err));
  }, []);

  // Memoize the filtered GeoJSON to prevent unnecessary re-filtering
  const filteredGeoJSON = useMemo(() => {
    if (!regionsData || selectedFMUs.length === 0) return null;

    const filteredFeatures = regionsData.features?.filter(feature => {
      const regionId = feature.properties?.id?.toLowerCase();
      return selectedFMUs.some(fmu => fmu.toLowerCase() === regionId);
    }) || [];

    if (filteredFeatures.length === 0) return null;

    return {
      type: 'FeatureCollection',
      features: filteredFeatures
    };
  }, [regionsData, selectedFMUs]);



  // Memoize the style callback to prevent unnecessary re-creation
  const onEachFeature = useCallback((feature, layer) => {
    layer.setStyle({
      color: '#ffffff',
      weight: 2,
      opacity: 0.9,
      fillOpacity: 0
    });
  }, []);

  if (!filteredGeoJSON) return null;

  // Create key based on sorted feature IDs to trigger updates when regions change
  // This is necessary for react-leaflet's GeoJSON to detect data changes
  const featureIds = filteredGeoJSON.features.map(f => f.properties?.id).sort().join('-');
  
  return <GeoJSON key={featureIds} data={filteredGeoJSON} onEachFeature={onEachFeature} />;
}

function ZoomControlPositioner({ position = "bottomleft" }) {
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

function RasterTileLayer({ mapRef, onStatsUpdate, onBiomassHistogramUpdate, opacity = 0.50, tileUrl = `${TILES_BASE_URL}/tiles/{z}/{x}/red_{y}.png`, tms = true, layerId = '' }) {
  const map = useMap();
  const lowResLayerRef = useRef(null);
  const highResLayerRef = useRef(null);
  const canvasLayerRef = useRef(null);
  const tileCountsRef = useRef(new Map());
  const biomassTileHistogramRef = useRef(new Map());
  const styleTagRef = useRef(null);

  // Create/update dynamic CSS rule for tile opacity
  useEffect(() => {
    // Create or update style tag with opacity rule
    if (!styleTagRef.current) {
      const style = document.createElement('style');
      style.id = 'tile-opacity-rule';
      document.head.appendChild(style);
      styleTagRef.current = style;
    }
    
    // Update the rule with current opacity - applies to all tiles
    const rule = `img[src*="/tiles/"], canvas.leaflet-tile { opacity: ${opacity} !important; }`;
    styleTagRef.current.textContent = rule;
  }, [opacity, layerId]);

  const updateVisiblePercentage = useCallback(() => {
    let visibleRed = 0;
    let visibleTotal = 0;

    [lowResLayerRef.current, highResLayerRef.current, canvasLayerRef.current].forEach((layer) => {
      if (!layer || !layer._tiles) return;
      Object.values(layer._tiles).forEach((tile) => {
        if (!tile || !tile.coords) return;
        const key = `${tile.coords.z}/${tile.coords.x}/${tile.coords.y}`;
        const counts = tileCountsRef.current.get(key);
        if (!counts) return;
        visibleRed += counts.red;
        visibleTotal += counts.total;
      });
    });

    const percentage = visibleTotal > 0
      ? ((visibleRed / visibleTotal) * 100).toFixed(2)
      : "0.00";

    if (onStatsUpdate) onStatsUpdate(percentage);
  }, [onStatsUpdate]);

  const handleTileLoad = useCallback((e) => {
    const img = e.tile;

    if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
      const tmpCanvas = document.createElement("canvas");
      tmpCanvas.width = img.naturalWidth;
      tmpCanvas.height = img.naturalHeight;
      const ctx = tmpCanvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, tmpCanvas.width, tmpCanvas.height).data;

      let redCount = 0;
      let totalCount = 0;

      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const a = pixels[i + 3];
        totalCount++;
        if (a > 0 && r === 255 && g === 0 && b === 0) {
          redCount++;
        }
      }

      if (e.coords) {
        const key = `${e.coords.z}/${e.coords.x}/${e.coords.y}`;
        tileCountsRef.current.set(key, { red: redCount, total: totalCount });
      }
      updateVisiblePercentage();
    }
  }, [updateVisiblePercentage]);

  const getTilePixelAreaHa = (coords) => {
    const tilesPerAxis = Math.pow(2, coords.z);
    const centerY = coords.y + 0.5;
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * centerY) / tilesPerAxis)));
    const metersPerPixel = (156543.03392 * Math.cos(latRad)) / tilesPerAxis;
    return (metersPerPixel * metersPerPixel) / 10000;
  };

  const emitBiomassHistogram = useCallback(() => {
    if (!onBiomassHistogramUpdate) return;
    const combined = createEmptyBiomassHistogram();
    biomassTileHistogramRef.current.forEach((tileBins) => {
      tileBins.forEach((tileBin, idx) => {
        combined[idx].area += tileBin.area;
        combined[idx].pixels += tileBin.pixels;
      });
    });
    onBiomassHistogramUpdate(combined);
  }, [onBiomassHistogramUpdate]);

  useEffect(() => {
    if (!map) return;
    const handleMove = () => updateVisiblePercentage();
    map.on("moveend", handleMove);
    map.on("zoomend", handleMove);
    return () => {
      map.off("moveend", handleMove);
      map.off("zoomend", handleMove);
    };
  }, [map, updateVisiblePercentage]);

  // Create a custom canvas tile layer for colorizing biomass tiles
  useEffect(() => {
    if (!map || layerId !== 'biomass-density') return;

    const biomassHistogram = biomassTileHistogramRef.current;
    biomassHistogram.clear();
    if (onBiomassHistogramUpdate) {
      onBiomassHistogramUpdate(createEmptyBiomassHistogram());
    }

    const CanvasTileLayer = L.GridLayer.extend({
      createTile: function(coords, done) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        
        const img = new Image();
        img.crossOrigin = 'anonymous';
        
        img.onload = () => {
          ctx.drawImage(img, 0, 0);
          
          const imageData = ctx.getImageData(0, 0, 256, 256);
          const pixels = imageData.data;
          
          // Debug: Sample pixel values across entire tile
          const samplePixels = [];
          const zeroPixels = [];
          // Sample every 10th pixel to get ~2600 samples from 65536 pixels
          for (let i = 0; i < pixels.length; i += 40) { // 40 = 4 channels * 10 pixels
            if (pixels[i + 3] > 0) { // Only check opaque pixels
              const val = pixels[i + 1]; // Green channel
              if (val > 0) {
                samplePixels.push(val);
              } else {
                zeroPixels.push(1);
              }
            }
          }
          if (samplePixels.length > 0) {
            const avg = samplePixels.reduce((a, b) => a + b) / samplePixels.length;
            const max = Math.max(...samplePixels);
            const min = Math.min(...samplePixels);
            console.log(`Tile pixel values (${samplePixels.length} non-zero + ${zeroPixels.length} zeros) - Min: ${min}, Max: ${max}, Avg: ${avg.toFixed(1)}, AGB: ${((min/255)*1000).toFixed(1)}-${((max/255)*1000).toFixed(1)} Mg/ha`);
          }
          
          // Color mapping based on actual AGB values (Mg/ha)
          // PNG tiles encoded with max=1000: decoder set to 1000
          // Green threshold: 50 Mg/ha (matches pixel max of ~51)
          const getColorForIntensity = (rawIntensity) => {
            // Convert grayscale (0-255) to AGB (0-1000 Mg/ha)
            const agb = (rawIntensity / 255) * 1000;
            
            // Color thresholds optimized for 0-150 Mg/ha (typical data range)
            if (agb < 10) {
              // Tan (0-10 Mg/ha)
              const t = agb / 10;
              return {
                r: Math.round(220 - (100 * t)), // 220 → 120
                g: Math.round(180 - (95 * t)),  // 180 → 85
                b: Math.round(140 - (100 * t))  // 140 → 40
              };
            } else if (agb < 25) {
              // Tan to Light Orange (10-25 Mg/ha)
              const t = (agb - 10) / 15;
              return {
                r: Math.round(120 + (135 * t)), // 120 → 255
                g: Math.round(85 + (155 * t)),  // 85 → 240
                b: Math.round(40)               // 40 (constant)
              };
            } else if (agb < 40) {
              // Light Orange to Bright Orange (25-40 Mg/ha)
              const t = (agb - 25) / 15;
              return {
                r: Math.round(255),             // 255 (constant)
                g: Math.round(240 - (50 * t)),  // 240 → 190
                b: Math.round(40)               // 40 (constant)
              };
            } else if (agb < 50) {
              // Bright Orange to Yellow (40-50 Mg/ha)
              const t = (agb - 40) / 10;
              return {
                r: Math.round(255),             // 255 (constant)
                g: Math.round(190 + (65 * t)),  // 190 → 255
                b: Math.round(40)               // 40 (constant)
              };
            } else if (agb < 85) {
              // Green (50-85 Mg/ha) - light to bright green
              const t = (agb - 50) / 35;
              return {
                r: Math.round(50 * (1 - t)),   // 50 → 0
                g: Math.round(220 + (35 * t)), // 220 → 255
                b: Math.round(0)                // 0 (constant)
              };
            } else if (agb < 120) {
              // Bright Green (85-120 Mg/ha)
              const t = (agb - 85) / 35;
              return {
                r: 0,                          // 0 (stays 0)
                g: Math.round(255),             // 255 (constant)
                b: Math.round(20 * t)           // 0 → 20
              };
            } else {
              // Bright Green to Dark Green (120+ Mg/ha)
              const t = Math.min(1, (agb - 120) / 30);
              return {
                r: 0,
                g: Math.round(255 - (90 * t)),  // 255 → 165
                b: Math.round(50 * t)           // 0 → 50
              };
            }
          };
          
          const tileHistogram = createEmptyBiomassHistogram();
          const pixelAreaHa = getTilePixelAreaHa(coords);

          for (let i = 0; i < pixels.length; i += 4) {
            const g = pixels[i + 1];
            const a = pixels[i + 3];
            
            // Skip transparent pixels
            if (a === 0) continue;

            const agb = (g / 255) * 1000;
            for (let binIdx = 0; binIdx < BIOMASS_BINS.length; binIdx++) {
              const bin = BIOMASS_BINS[binIdx];
              if (agb >= bin.min && agb < bin.max) {
                tileHistogram[binIdx].pixels += 1;
                tileHistogram[binIdx].area += pixelAreaHa;
                break;
              }
            }
            
            // Get grayscale value (all channels are the same in grayscale)
            // Pass raw intensity (0-255) to color function
            const color = getColorForIntensity(g);
            pixels[i] = color.r;
            pixels[i + 1] = color.g;
            pixels[i + 2] = color.b;
          }

          const tileKey = `${coords.z}/${coords.x}/${coords.y}`;
          biomassTileHistogramRef.current.set(tileKey, tileHistogram);
          emitBiomassHistogram();
          
          ctx.putImageData(imageData, 0, 0);
          done(null, canvas);
        };
        
        img.onerror = () => done(null, canvas);
        
        const url = L.Util.template(tileUrl, coords);
        img.src = url;
        
        return canvas;
      }
    });

    const canvasLayer = new CanvasTileLayer({
      minZoom: TILE_ZOOM_RANGE.min,
      maxZoom: TILE_ZOOM_RANGE.max,
      tms: tms,
      zIndex: 10
    });

    canvasLayerRef.current = canvasLayer;
    canvasLayer.addTo(map);

    const handleTileUnload = (event) => {
      if (!event.coords) return;
      const tileKey = `${event.coords.z}/${event.coords.x}/${event.coords.y}`;
      biomassTileHistogramRef.current.delete(tileKey);
      emitBiomassHistogram();
    };

    canvasLayer.on('tileunload', handleTileUnload);

    return () => {
      canvasLayer.off('tileunload', handleTileUnload);
      map.removeLayer(canvasLayer);
      canvasLayerRef.current = null;
      biomassHistogram.clear();
      if (onBiomassHistogramUpdate) {
        onBiomassHistogramUpdate(createEmptyBiomassHistogram());
      }
    };
  }, [map, layerId, tileUrl, tms, onBiomassHistogramUpdate, emitBiomassHistogram]);

  // Create a custom canvas tile layer for colorizing clearcut tiles to red
  useEffect(() => {
    if (!map || layerId !== 'clearcut-annual') return;

    const CanvasTileLayer = L.GridLayer.extend({
      createTile: function(coords, done) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        
        const img = new Image();
        img.crossOrigin = 'anonymous';
        
        img.onload = () => {
          ctx.drawImage(img, 0, 0);
          
          const imageData = ctx.getImageData(0, 0, 256, 256);
          const pixels = imageData.data;
          
          // Count clearcut pixels (bright/white pixels in grayscale)
          let clearcutCount = 0;
          let totalCount = 0;
          
          for (let i = 0; i < pixels.length; i += 4) {
            const r = pixels[i];
            const a = pixels[i + 3];

            totalCount++;
            
            // Count non-transparent white/bright pixels as clearcut areas
            // In grayscale, clearcut areas are white/bright (high intensity)
            if (a > 0 && r > 200) {  // Threshold for "clearcut" pixels
              clearcutCount++;
            }
            
            // Skip transparent pixels for colorization
            if (a === 0) continue;
            
            // Get grayscale intensity (use any channel, they're all the same in grayscale)
            const intensity = r / 255;
            
            // Convert white/gray to red, keeping the intensity
            // White (255,255,255) becomes bright red (255,0,0)
            // Gray becomes darker red proportionally
            pixels[i] = Math.round(255 * intensity);     // Red channel
            pixels[i + 1] = 0;                           // Green channel (0)
            pixels[i + 2] = 0;                           // Blue channel (0)
            // Keep alpha as is
          }
          
          // Store tile counts for percentage calculation
          const key = `${coords.z}/${coords.x}/${coords.y}`;
          tileCountsRef.current.set(key, { red: clearcutCount, total: totalCount });
          
          ctx.putImageData(imageData, 0, 0);
          done(null, canvas);
          
          // Update percentage after tile is processed
          updateVisiblePercentage();
        };
        
        img.onerror = () => done(null, canvas);
        
        const url = L.Util.template(tileUrl, coords);
        img.src = url;
        
        return canvas;
      }
    });

    const canvasLayer = new CanvasTileLayer({
      minZoom: TILE_ZOOM_RANGE.min,
      maxZoom: TILE_ZOOM_RANGE.max,
      tms: tms,
      zIndex: 10
    });

    canvasLayerRef.current = canvasLayer;
    canvasLayer.addTo(map);

    return () => {
      map.removeLayer(canvasLayer);
      canvasLayerRef.current = null;
    };
  }, [map, layerId, tileUrl, tms, updateVisiblePercentage]);

  // If using canvas colorization for biomass or clearcut, don't render standard TileLayers
  if (layerId === 'biomass-density' || layerId === 'clearcut-annual') {
    return null;
  }

  return (
    <>
      <TileLayer
        ref={lowResLayerRef}
        url={tileUrl}
        minZoom={TILE_ZOOM_RANGE.min}
        maxZoom={12}
        maxNativeZoom={12}
        zIndex={10}
        tms={tms}
        crossOrigin="anonymous"
        eventHandlers={{
          tileload: (e) => {
            handleTileLoad(e);
          },
        }}
      />
      <TileLayer
        ref={highResLayerRef}
        url={tileUrl}
        minZoom={13}
        maxZoom={TILE_ZOOM_RANGE.max}
        maxNativeZoom={TILE_ZOOM_RANGE.max}
        zIndex={10}
        tms={tms}
        crossOrigin="anonymous"
        eventHandlers={{
          tileload: (e) => {
            handleTileLoad(e);
          },
        }}
      />
    </>
  );
}


function App() {
  const mapRef = useRef(null);
  const searchRef = useRef(null);
  const autocompleteRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [clearcutPercent, setClearcutPercent] = useState(null);
  const [biomassHistogram, setBiomassHistogram] = useState(createEmptyBiomassHistogram());
  const [rasterOpacity, setRasterOpacity] = useState(0.50);
  const [selectedModule, setSelectedModule] = useState(MODULES[0]); // Default to first module
  const [selectedYear, setSelectedYear] = useState(MODULES[0]?.temporalOptions?.yearRange?.[1] || 2025);
  const [selectedFMUs, setSelectedFMUs] = useState(['wabigoon']); // Default to Wabigoon
  const [selectedSensor, setSelectedSensor] = useState('hls');
  
  // Store year per module
  const [moduleYears, setModuleYears] = useState(() => {
    const initial = {};
    MODULES.forEach(module => {
      if (module.temporalOptions?.yearRange) {
        initial[module.id] = module.temporalOptions.yearRange[1]; // Max year
      }
    });
    return initial;
  });
  
  // Track which layers are active for each module
  const [activeLayers, setActiveLayers] = useState(() => {
    const initial = {};
    MODULES.forEach(module => {
      // By default, only enable the first layer of the first module
      initial[module.id] = module === MODULES[0] ? [module.layers[0].id] : [];
    });
    return initial;
  });

  // Handle layer visibility toggle
  const handleLayerToggle = (moduleId, layerId) => {
    setActiveLayers(prev => {
      const current = prev[moduleId] || [];
      if (current.includes(layerId)) {
        return { ...prev, [moduleId]: current.filter(l => l !== layerId) };
      } else {
        return { ...prev, [moduleId]: [...current, layerId] };
      }
    });
  };

  // Auto-reset sensor to HLS when the active year has no data for the selected sensor
  useEffect(() => {
    const moduleYear = moduleYears[selectedModule?.id] ?? selectedYear;
    if (selectedSensor === 'planet' && !CLEARCUT_PLANET_YEARS.includes(moduleYear)) {
      setSelectedSensor('hls');
    }
  }, [selectedYear, moduleYears, selectedModule, selectedSensor]);

  const handleSensorChange = useCallback((sensor) => {
    setSelectedSensor(sensor);
  }, []);

  // Handle opacity changes from module panel
  useEffect(() => {
    const handleOpacityChange = (e) => {
      setRasterOpacity(e.detail.opacity);
    };
    
    window.addEventListener('opacityChange', handleOpacityChange);
    return () => window.removeEventListener('opacityChange', handleOpacityChange);
  }, []);

  useEffect(() => {
    const initAutocomplete = () => {
      if (!searchRef.current || !window.google?.maps?.places) return;
      autocompleteRef.current = new window.google.maps.places.Autocomplete(searchRef.current);
      autocompleteRef.current.addListener('place_changed', () => {
        handlePlaceChanged(autocompleteRef, mapRef);
      });
    };

    if (window.google?.maps?.places) {
      initAutocomplete();
      return;
    }

    const apiKey = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      console.warn('Missing REACT_APP_GOOGLE_MAPS_API_KEY. Google Places search will be disabled.');
      return;
    }

    const scriptId = 'google-maps-places-script';
    if (document.getElementById(scriptId)) return;

    const script = document.createElement('script');
    script.id = scriptId;
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.onload = initAutocomplete;
    document.head.appendChild(script);
  }, []);

  const moduleData = {
    percentage: clearcutPercent,
    opacity: rasterOpacity,
    biomassHistogram,
    selectedFMUs,
    selectedSensor,
    onSensorChange: handleSensorChange,
    selectedYear,
  };

  // Handle module selection with year adjustment
  const handleModuleSelect = useCallback((module) => {
    setSelectedModule(module);
    
    // Restore the saved year for this module
    if (moduleYears[module.id] !== undefined) {
      setSelectedYear(moduleYears[module.id]);
    } else if (module.temporalOptions?.yearRange) {
      const [, maxYear] = module.temporalOptions.yearRange;
      setSelectedYear(maxYear);
    }
  }, [moduleYears]);
  
  // Handle year change and save it for the current module
  const handleYearChange = useCallback((year) => {
    setSelectedYear(year);
    if (selectedModule?.id) {
      setModuleYears(prev => ({
        ...prev,
        [selectedModule.id]: year
      }));
    }
  }, [selectedModule]);

  return (
    <div className="app-wrapper">
      <TopMenu />
      <div className="layout-container">
        {/* Left Sidebar - Module Selector */}
        <ModuleSelector
          modules={MODULES}
          selectedModule={selectedModule}
          onModuleSelect={handleModuleSelect}
          activeLayers={activeLayers}
          onLayerToggle={handleLayerToggle}
        />

        {/* Center - Map */}
        <div className="map-center">
          <div className="search-container">
            <span className="search-icon" aria-hidden="true">🔍</span>
            <input
              className="search-box"
              placeholder="Search a place"
              ref={searchRef}
              onKeyDown={(e) => {
                if (e.key === "Enter") handlePlaceChanged(autocompleteRef, mapRef);
              }}
            />
          </div>

          <FMUSelector 
            values={selectedFMUs}
            onChange={setSelectedFMUs}
          />

          <button
            className="locate-btn"
            onClick={() => handleLocateUser(mapRef)}
            title="Locate Me"
          >
          </button>

          <div className="loading-indicator" style={{ display: mapReady ? "none" : "block" }}>
            Loading map...
          </div>

          <MapContainer
            center={center}
            zoom={TILE_ZOOM_LEVELS[0]}
            minZoom={TILE_ZOOM_RANGE.min}
            maxZoom={TILE_ZOOM_RANGE.max}
            zoomControl={false}
            whenCreated={(mapInstance) => {
              console.log("Map created", mapInstance);
              mapRef.current = mapInstance;
            }}
            whenReady={() => {
              setMapReady(true);
            }}
            style={{ width: "100%", height: "100%", zIndex: 0 }}
          >
            <TileLayer
              url="https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              attribution="&copy; Esri, DigitalGlobe, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, and others"
              zIndex={5}
            />

            
            {/* Render tile layers for all active layers from ALL modules */}
            {MODULES.flatMap((module) => {
              const moduleActiveLayers = activeLayers[module.id] || [];
              return moduleActiveLayers.flatMap((layerId) => {
                const layer = module.layers?.find(l => l.id === layerId);
                if (!layer) return null;
                
                // Don't render tiles if no FMUs are selected
                if (selectedFMUs.length === 0) return null;
                
                // Use the module's specific year instead of global selectedYear
                const moduleYear = moduleYears[module.id] || selectedYear;
                
                return selectedFMUs.map((region) => {
                  let tileUrl = layer.tileUrl.replace('{year}', moduleYear);
                  tileUrl = tileUrl.replace('{region}', region);

                  // Insert sensor subfolder for years that use hls/ or planet/ subdirectories
                  if (layer.id === 'clearcut-annual' && CLEARCUT_SENSOR_SUBFOLDER_YEARS.includes(moduleYear)) {
                    const folder = selectedSensor === 'planet' && CLEARCUT_PLANET_YEARS.includes(moduleYear)
                      ? 'planet' : 'hls';
                    tileUrl = tileUrl.replace(
                      `${TILES_BASE_URL}/tiles/clearcut/${region}_${moduleYear}/`,
                      `${TILES_BASE_URL}/tiles/clearcut/${region}_${moduleYear}/${folder}/`
                    );
                  }

                  return (
                    <RasterTileLayer
                      key={`${layer.id}-${region}-${moduleYear}-${selectedSensor}`}
                      mapRef={mapRef}
                      onStatsUpdate={(p) => setClearcutPercent(p)}
                      onBiomassHistogramUpdate={setBiomassHistogram}
                      opacity={rasterOpacity}
                      tileUrl={tileUrl}
                      layerId={layer.id}
                      tms={layer.tms !== undefined ? layer.tms : true}
                    />
                  );
                });
              });
            })}

            <RegionBoundaries selectedFMUs={selectedFMUs} />

            <DrawingTools mapRef={mapRef} />
            <ZoomControlPositioner position="bottomleft" />
          </MapContainer>
        </div>

        {/* Right Sidebar - Module Panel */}
        <div className="module-panel-container">
          <ModulePanel 
            module={selectedModule} 
            data={moduleData}
            selectedYear={selectedYear}
            onYearChange={handleYearChange}
            yearRange={selectedModule?.temporalOptions?.yearRange || [2010, 2024]}
          />
          <div className="right-column-logo">
            <img className="logo-image logo-light" src="/rsl-logo.png" alt="Remote Sensing Lab and Saint Louis University" />
            <img className="logo-image logo-dark" src="/rsl-logo-transparent.png" alt="Remote Sensing Lab and Saint Louis University" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
