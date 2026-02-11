import React, { useRef, useState, useCallback } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";

import { useEffect } from 'react';

import TopMenu from './components/TopMenu';
import ModuleSelector from './components/ModuleSelector';
import ModulePanel from './components/ModulePanel';
import ClearcutDetection from './modules/ClearcutDetection';
import { handleLocateUser, handlePlaceChanged } from "./utils/mapUtils";

import "./styles/map.css";
import "./styles/topmenu.css";
import "./styles/menu.css";
import "./styles/layout.css";

const center = [49.80318325874751, -92.8087780822145];
const TILE_ZOOM_LEVELS = [6, 7, 8, 9, 13, 14];
const TILE_ZOOM_RANGE = {
  min: Math.min(...TILE_ZOOM_LEVELS),
  max: Math.max(...TILE_ZOOM_LEVELS),
};

// Available modules - add new modules here
const MODULES = [
  {
    id: 'clearcut',
    name: 'Clearcut Detection',
    icon: '🪓',
    description: 'Detect and analyze clearcut areas',
    component: ClearcutDetection,
    temporalOptions: {
      yearRange: [2015, 2025],
    },
    layers: [
      { 
        id: 'clearcut-annual', 
        name: 'Annual Clearcuts', 
        tileUrl: '/tiles/{z}/{x}/{year}/red_{y}.png',
        color: '#FF0000',
        mode: 'annual'
      },
      { 
        id: 'clearcut-accumulated', 
        name: 'Accumulated Clearcuts', 
        tileUrl: '/tiles/{z}/{x}/accumulated_{y}.png',
        color: '#FF6600',
        mode: 'accumulated'
      },
      { 
        id: 'clearcut-frequency', 
        name: 'Frequency', 
        tileUrl: '/tiles/{z}/{x}/frequency_{y}.png',
        color: '#FF9900',
        mode: 'frequency'
      },
    ]
  },
  {
    id: 'biomass',
    name: 'Biomass',
    icon: '🌿',
    description: 'Mock visualization of biomass data',
    component: ClearcutDetection,
    temporalOptions: {
      yearRange: [2015, 2025],
    },
    layers: [
      { 
        id: 'biomass-density', 
        name: 'Biomass Density', 
        tileUrl: '/tiles/{z}/{x}/{year}/biomass_{y}.png',
        color: '#00AA00',
        mode: 'annual'
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
      yearRange: [2015, 2025],
    },
    layers: [
      { 
        id: 'forest-mature', 
        name: 'Mature Forest', 
        tileUrl: '/tiles/{z}/{x}/{year}/forest_mature_{y}.png',
        color: '#1B4D1B',
        mode: 'annual'
      },
      { 
        id: 'forest-young', 
        name: 'Young Forest', 
        tileUrl: '/tiles/{z}/{x}/{year}/forest_young_{y}.png',
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
        tileUrl: '/tiles/{z}/{x}/{year}/wildlife_birds_{y}.png',
        color: '#FFD700',
        mode: 'annual'
      },
      { 
        id: 'wildlife-mammals', 
        name: 'Mammals', 
        tileUrl: '/tiles/{z}/{x}/{year}/wildlife_mammals_{y}.png',
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

function RasterTileLayer({ mapRef, onStatsUpdate, opacity = 0.50, tileUrl = '/tiles/{z}/{x}/red_{y}.png' }) {
  const map = useMap();
  const lowResLayerRef = useRef(null);
  const highResLayerRef = useRef(null);
  const tileCountsRef = useRef(new Map());
  const styleTagRef = useRef(null);

  // Create/update dynamic CSS rule for tile opacity
  useEffect(() => {
    console.log('RasterTileLayer useEffect - opacity changed to:', opacity);
    
    // Create or update style tag with opacity rule
    if (!styleTagRef.current) {
      const style = document.createElement('style');
      style.id = 'tile-opacity-rule';
      document.head.appendChild(style);
      styleTagRef.current = style;
    }
    
    // Update the rule with current opacity - applies to all tiles
    const rule = `img[src*="/tiles/"] { opacity: ${opacity} !important; }`;
    styleTagRef.current.textContent = rule;
    console.log('Updated CSS rule:', rule);
  }, [opacity]);

  const updateVisiblePercentage = () => {
    let visibleRed = 0;
    let visibleTotal = 0;

    [lowResLayerRef.current, highResLayerRef.current].forEach((layer) => {
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
  };

  const handleTileLoad = useCallback((e) => {
    const img = e.tile;
    // Opacity is controlled by CSS rule with !important
    console.log('Tile loaded:', e.coords);

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
  }, [onStatsUpdate]);

  useEffect(() => {
    if (!map) return;
    const handleMove = () => updateVisiblePercentage();
    map.on("moveend", handleMove);
    map.on("zoomend", handleMove);
    return () => {
      map.off("moveend", handleMove);
      map.off("zoomend", handleMove);
    };
  }, [map]);

  return (
    <>
      <TileLayer
        ref={lowResLayerRef}
        url={tileUrl}
        minZoom={TILE_ZOOM_RANGE.min}
        maxZoom={12}
        maxNativeZoom={9}
        zIndex={10}
        tms={true}
        crossOrigin="anonymous"
        eventHandlers={{
          tileload: (e) => {
            console.log('TILELOAD EVENT FIRED', e);
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
        tms={true}
        crossOrigin="anonymous"
        eventHandlers={{
          tileload: (e) => {
            console.log('TILELOAD EVENT FIRED', e);
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
  const [rasterOpacity, setRasterOpacity] = useState(0.50);
  const [selectedModule, setSelectedModule] = useState(MODULES[0]); // Default to first module
  const [selectedYear, setSelectedYear] = useState(2025);
  
  // Track which layers are active for each module
  const [activeLayers, setActiveLayers] = useState(() => {
    const initial = {};
    MODULES.forEach(module => {
      // By default, enable the first layer of each module
      initial[module.id] = [module.layers[0].id];
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
  };

  return (
    <div className="app-wrapper">
      <TopMenu />
      <div className="layout-container">
        {/* Left Sidebar - Module Selector */}
        <ModuleSelector
          modules={MODULES}
          selectedModule={selectedModule}
          onModuleSelect={setSelectedModule}
          activeLayers={activeLayers[selectedModule?.id] || []}
          onLayerToggle={(layerId) => handleLayerToggle(selectedModule?.id, layerId)}
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

            
            {/* Render tile layers for all active layers in selected module */}
            {(activeLayers[selectedModule?.id] || []).map((layerId) => {
              const layer = selectedModule?.layers?.find(l => l.id === layerId);
              if (!layer) return null;
              
              // Substitute year placeholder
              let tileUrl = layer.tileUrl.replace('{year}', selectedYear);
              
              return (
                <RasterTileLayer
                  key={`${layer.id}-${selectedYear}`}
                  mapRef={mapRef}
                  onStatsUpdate={(p) => setClearcutPercent(p)}
                  opacity={rasterOpacity}
                  tileUrl={tileUrl}
                  layerId={layer.id}
                />
              );
            })}

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
            onYearChange={setSelectedYear}
            yearRange={selectedModule?.temporalOptions?.yearRange || [2015, 2024]}
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
