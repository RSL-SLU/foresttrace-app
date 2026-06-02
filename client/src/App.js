import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import { MapContainer, TileLayer, useMap, GeoJSON } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';

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
import ClearcutDetection from './modules/ClearcutDetection';
import BiomassModule from './modules/BiomassModule';
import RasterTileLayer from './components/RasterTileLayer';
import { handleLocateUser, handlePlaceChanged } from './utils/mapUtils';
import { CLEARCUT_PLANET_YEARS, CLEARCUT_SENSOR_SUBFOLDER_YEARS } from './utils/clearcutAreaStats';
import { createEmptyBiomassHistogram } from './utils/biomassHistogram';
import { TILES_BASE_URL, DATA_BASE_URL } from './config';

import './styles/map.css';
import './styles/topmenu.css';
import './styles/menu.css';
import './styles/layout.css';

const center = [49.80318325874751, -92.8087780822145];
const TILE_ZOOM_LEVELS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
const TILE_ZOOM_RANGE = {
  min: Math.min(...TILE_ZOOM_LEVELS),
  max: Math.max(...TILE_ZOOM_LEVELS),
};

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
        tms: false,
      },
      {
        id: 'clearcut-accumulated',
        name: 'Accumulated Clearcuts',
        tileUrl: `${TILES_BASE_URL}/tiles/{z}/{x}/accumulated_{y}.png`,
        color: '#FF6600',
        mode: 'accumulated',
      },
      {
        id: 'clearcut-frequency',
        name: 'Frequency',
        tileUrl: `${TILES_BASE_URL}/tiles/{z}/{x}/frequency_{y}.png`,
        color: '#FF9900',
        mode: 'frequency',
      },
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

function DrawingTools({ mapRef }) {
  const map = useMap();
  mapRef.current = map;

  useEffect(() => {
    map.pm.addControls({
      position: 'bottomleft',
      drawPolygon: true,
      drawCircle: true,
      drawRectangle: true,
      editMode: true,
      dragMode: true,
      cutPolygon: false,
      removalMode: true,
    });

    map.on('pm:create', (e) => {
      console.log('Shape created:', e.layer.toGeoJSON());
    });

    return () => {
      map.off('pm:create');
    };
  }, [map]);

  return null;
}

function RegionBoundaries({ selectedFMUs }) {
  const [regionsData, setRegionsData] = useState(null);

  useEffect(() => {
    fetch(`${DATA_BASE_URL}/data/regions-simplified.json`)
      .then((res) => res.json())
      .then((data) => setRegionsData(data))
      .catch((err) => console.error('Failed to load regions:', err));
  }, []);

  const filteredGeoJSON = useMemo(() => {
    if (!regionsData || selectedFMUs.length === 0) return null;

    const filteredFeatures = regionsData.features?.filter((feature) => {
      const regionId = feature.properties?.id?.toLowerCase();
      return selectedFMUs.some((fmu) => fmu.toLowerCase() === regionId);
    }) || [];

    if (filteredFeatures.length === 0) return null;

    return {
      type: 'FeatureCollection',
      features: filteredFeatures,
    };
  }, [regionsData, selectedFMUs]);

  const onEachFeature = useCallback((feature, layer) => {
    layer.setStyle({
      color: '#ffffff',
      weight: 2,
      opacity: 0.9,
      fillOpacity: 0,
    });
  }, []);

  if (!filteredGeoJSON) return null;

  const featureIds = filteredGeoJSON.features.map((f) => f.properties?.id).sort().join('-');

  return <GeoJSON key={featureIds} data={filteredGeoJSON} onEachFeature={onEachFeature} />;
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

function App() {
  const [showApp, setShowApp] = useState(false);
  const [activePage, setActivePage] = useState(null);
  const mapRef = useRef(null);
  const searchRef = useRef(null);
  const autocompleteRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [clearcutPercent, setClearcutPercent] = useState(null);
  const [tilesLoading, setTilesLoading] = useState(false);
  const [biomassHistogram, setBiomassHistogram] = useState(createEmptyBiomassHistogram());
  const [rasterOpacity, setRasterOpacity] = useState(0.5);
  const [selectedModule, setSelectedModule] = useState(MODULES[0]);
  const [selectedYear, setSelectedYear] = useState(MODULES[0]?.temporalOptions?.yearRange?.[1] || 2025);
  const [selectedFMUs, setSelectedFMUs] = useState(['wabigoon']);
  const [selectedSensor, setSelectedSensor] = useState('hls');

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
    setActiveLayers((prev) => {
      const current = prev[moduleId] || [];
      if (current.includes(layerId)) {
        return { ...prev, [moduleId]: current.filter((l) => l !== layerId) };
      }
      return { ...prev, [moduleId]: [...current, layerId] };
    });
  };

  useEffect(() => {
    const moduleYear = moduleYears[selectedModule?.id] ?? selectedYear;
    if (selectedSensor === 'planet' && !CLEARCUT_PLANET_YEARS.includes(moduleYear)) {
      setSelectedSensor('hls');
    }
  }, [selectedYear, moduleYears, selectedModule, selectedSensor]);

  const handleSensorChange = useCallback((sensor) => {
    setSelectedSensor(sensor);
  }, []);

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

  const handleModuleSelect = useCallback((module) => {
    setSelectedModule(module);
    if (moduleYears[module.id] !== undefined) {
      setSelectedYear(moduleYears[module.id]);
    } else if (module.temporalOptions?.yearRange) {
      const [, maxYear] = module.temporalOptions.yearRange;
      setSelectedYear(maxYear);
    }
  }, [moduleYears]);

  const handleYearChange = useCallback((year) => {
    setSelectedYear(year);
    if (selectedModule?.id) {
      setModuleYears((prev) => ({
        ...prev,
        [selectedModule.id]: year,
      }));
    }
  }, [selectedModule]);

  const PAGE_MAP = {
    about: AboutPage,
    help: HelpPage,
    news: NewsPage,
    publication: PublicationPage,
    documentation: DocumentationPage,
  };

  if (!showApp) {
    return (
      <LandingPage
        onEnter={() => setShowApp(true)}
        onOpenAbout={() => {
          setShowApp(true);
          setActivePage('about');
        }}
        onOpenNews={() => {
          setShowApp(true);
          setActivePage('news');
        }}
        onOpenDocumentation={() => {
          setShowApp(true);
          setActivePage('documentation');
        }}
      />
    );
  }

  if (activePage) {
    const PageComponent = PAGE_MAP[activePage];
    return (
      <div className="app-wrapper">
        <MobileWarning />
        <TopMenu
          onNavigate={setActivePage}
          onHome={() => setActivePage(null)}
          activePage={activePage}
        />
        {PageComponent && <PageComponent onBack={() => setActivePage(null)} />}
      </div>
    );
  }

  return (
    <div className="app-wrapper">
      <MobileWarning />
      <TopMenu
        onNavigate={setActivePage}
        onHome={() => {
          setShowApp(false);
          setActivePage(null);
        }}
        activePage={activePage}
      />
      <div className="layout-container">
        <ModuleSelector
          modules={MODULES}
          selectedModule={selectedModule}
          onModuleSelect={handleModuleSelect}
          activeLayers={activeLayers}
          onLayerToggle={handleLayerToggle}
        />

        <div className="map-center">
          <div className="search-container">
            <span className="search-icon" aria-hidden="true">🔍</span>
            <input
              className="search-box"
              placeholder="Search a place"
              ref={searchRef}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handlePlaceChanged(autocompleteRef, mapRef);
              }}
            />
          </div>

          <FMUSelector values={selectedFMUs} onChange={setSelectedFMUs} />

          <button
            className="locate-btn"
            onClick={() => handleLocateUser(mapRef)}
            title="Locate Me"
          />

          <div className="loading-indicator" style={{ display: mapReady ? 'none' : 'block' }}>
            Loading map...
          </div>

          <div className="loading-indicator" style={{ display: tilesLoading ? 'block' : 'none' }}>
            Loading...
          </div>

          <MapContainer
            center={center}
            zoom={TILE_ZOOM_LEVELS[0]}
            minZoom={TILE_ZOOM_RANGE.min}
            maxZoom={TILE_ZOOM_RANGE.max}
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
            <TileLayer
              url="https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              attribution="&copy; Esri, DigitalGlobe, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, and others"
              zIndex={5}
            />

            {MODULES.flatMap((module) => {
              const moduleActiveLayers = activeLayers[module.id] || [];
              return moduleActiveLayers.flatMap((layerId) => {
                const layer = module.layers?.find((l) => l.id === layerId);
                if (!layer) return null;
                if (selectedFMUs.length === 0) return null;

                const moduleYear = moduleYears[module.id] || selectedYear;

                return selectedFMUs.map((region) => {
                  let tileUrl = layer.tileUrl.replace('{year}', moduleYear);
                  tileUrl = tileUrl.replace('{region}', region);

                  if (layer.id === 'clearcut-annual' && CLEARCUT_SENSOR_SUBFOLDER_YEARS.includes(moduleYear)) {
                    const folder = selectedSensor === 'planet' && CLEARCUT_PLANET_YEARS.includes(moduleYear)
                      ? 'planet' : 'hls';
                    tileUrl = tileUrl.replace(
                      `${TILES_BASE_URL}/tiles/clearcut/${region}_${moduleYear}/`,
                      `${TILES_BASE_URL}/tiles/clearcut/${region}_${moduleYear}/${folder}/`,
                    );
                  }

                  return (
                    <RasterTileLayer
                      key={`${layer.id}-${region}-${moduleYear}-${selectedSensor}`}
                      onStatsUpdate={setClearcutPercent}
                      onBiomassHistogramUpdate={setBiomassHistogram}
                      onLoadingChange={setTilesLoading}
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
