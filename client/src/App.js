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

// Sentinel-2 cloudless annual composites (EOX IT Services GmbH).
// Free for non-commercial use; covers 2016–2023.
// Years outside this range fall back to the static Esri World Imagery layer.
const EOX_S2_YEARS = new Set([2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023]);

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

const center = [49.80318325874751, -92.8087780822145];
const TILE_ZOOM_LEVELS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
const TILE_ZOOM_RANGE = {
  min: Math.min(...TILE_ZOOM_LEVELS),
  max: Math.max(...TILE_ZOOM_LEVELS),
};
const RASTER_MULTI_FMU_SOFT_LIMIT = 8;
const PREFERRED_RASTER_REGIONS = ['wabigoon', 'troutlake'];

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
      dragMode: false,
      cutPolygon: false,
      removalMode: true,
    });

    const onCreate = (e) => {
      console.log('Shape created:', e.layer.toGeoJSON());
    };
    map.on('pm:create', onCreate);

    return () => {
      map.off('pm:create', onCreate);
      map.pm.removeControls();
    };
  }, [map]);

  return null;
}

function RegionBoundaries({ selectedFMUs, useOntarioOverview }) {
  const [regionsData, setRegionsData] = useState(null);
  const legacyRegionsRef = useRef(null);
  const perAreaCacheRef = useRef(new Map());
  const overviewCacheRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    const loadLegacyIfNeeded = async () => {
      if (legacyRegionsRef.current) return legacyRegionsRef.current;
      const res = await fetch(`${DATA_BASE_URL}/data/regions-simplified.json`);
      if (!res.ok) throw new Error(`regions-simplified.json: HTTP ${res.status}`);
      const data = await res.json();
      legacyRegionsRef.current = data;
      return data;
    };

    const normalizeFeatureCollection = (data) => {
      if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) return null;
      return data;
    };

    const loadSelectedBoundaries = async () => {
      if (selectedFMUs.length === 0) {
        if (!cancelled) setRegionsData(null);
        return;
      }

      if (useOntarioOverview) {
        try {
          if (!overviewCacheRef.current) {
            const overviewRes = await fetch(`${DATA_BASE_URL}/data/regions/ontario-overview.json`);
            if (!overviewRes.ok) {
              throw new Error(`ontario-overview.json: HTTP ${overviewRes.status}`);
            }
            overviewCacheRef.current = normalizeFeatureCollection(await overviewRes.json());
          }

          if (!cancelled) {
            setRegionsData(overviewCacheRef.current);
          }
          return;
        } catch (err) {
          console.warn('Failed to load Ontario overview boundaries; falling back to per-area boundaries.', err);
        }
      }

      const mergedFeatures = [];

      for (const fmu of selectedFMUs) {
        const id = String(fmu || '').toLowerCase();
        if (!id) continue;

        if (perAreaCacheRef.current.has(id)) {
          const cached = perAreaCacheRef.current.get(id);
          if (cached?.features) mergedFeatures.push(...cached.features);
          continue;
        }

        let loaded = null;

        // Preferred source: one JSON per FMU at /data/regions/<id>.json
        try {
          const areaRes = await fetch(`${DATA_BASE_URL}/data/regions/${id}.json`);
          if (areaRes.ok) {
            loaded = normalizeFeatureCollection(await areaRes.json());
          }
        } catch {
          loaded = null;
        }

        // Backward-compatible fallback: filter from legacy simplified file.
        if (!loaded) {
          try {
            const legacy = await loadLegacyIfNeeded();
            const features = (legacy.features || []).filter((feature) => {
              const regionId = feature?.properties?.id?.toLowerCase();
              return regionId === id;
            });
            loaded = { type: 'FeatureCollection', features };
          } catch (err) {
            console.error('Failed to load region boundaries:', err);
            loaded = { type: 'FeatureCollection', features: [] };
          }
        }

        perAreaCacheRef.current.set(id, loaded);
        if (loaded?.features) mergedFeatures.push(...loaded.features);
      }

      if (!cancelled) {
        setRegionsData(
          mergedFeatures.length
            ? { type: 'FeatureCollection', features: mergedFeatures }
            : null,
        );
      }
    };

    loadSelectedBoundaries();

    return () => {
      cancelled = true;
    };
  }, [selectedFMUs, useOntarioOverview]);

  const onEachFeature = useCallback((feature, layer) => {
    layer.options.pmIgnore = true;
    layer.setStyle({
      color: '#ffffff',
      weight: 2,
      opacity: 0.9,
      fillOpacity: 0,
    });
  }, []);

  if (!regionsData) return null;

  const featureIds = regionsData.features.map((f) => f.properties?.id).sort().join('-');

  return <GeoJSON key={featureIds} data={regionsData} onEachFeature={onEachFeature} />;
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
  const hidingTimerRef = useRef(null);
  const handleLoadingChange = useCallback((loading) => {
    if (loading) {
      clearTimeout(hidingTimerRef.current);
      setTilesLoading(true);
    } else {
      hidingTimerRef.current = setTimeout(() => setTilesLoading(false), 300);
    }
  }, []);
  const [biomassHistogram, setBiomassHistogram] = useState(createEmptyBiomassHistogram());
  const [rasterOpacity, setRasterOpacity] = useState(0.5);
  const [selectedModule, setSelectedModule] = useState(MODULES[0]);
  const [selectedYear, setSelectedYear] = useState(MODULES[0]?.temporalOptions?.yearRange?.[1] || 2025);
  const [selectedFMUs, setSelectedFMUs] = useState(['wabigoon']);
  const [selectedSensor, setSelectedSensor] = useState('planet');
  const [allowHeavyRaster, setAllowHeavyRaster] = useState(false);

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

  // Safety net: if a layer unmounts mid-load (year change, layer toggle)
  // without firing its `load` event, the spinner would stay forever.
  // Auto-dismiss after 12 s as a fallback.
  useEffect(() => {
    if (!tilesLoading) return;
    const guard = setTimeout(() => setTilesLoading(false), 12000);
    return () => clearTimeout(guard);
  }, [tilesLoading]);

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
          moduleData={moduleData}
          selectedYear={selectedYear}
          selectedFMUs={selectedFMUs}
          selectedSensor={selectedSensor}
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
            {(() => {
              const basemapYear = moduleYears[selectedModule?.id] || selectedYear;
              const { url, attribution } = getBasemapConfig(basemapYear);
              return (
                <TileLayer
                  key={basemapYear}
                  url={url}
                  attribution={attribution}
                  zIndex={5}
                  pmIgnore={true}
                />
              );
            })()}

            {MODULES.flatMap((module) => {
              const moduleActiveLayers = activeLayers[module.id] || [];
              return moduleActiveLayers.flatMap((layerId) => {
                const layer = module.layers?.find((l) => l.id === layerId);
                if (!layer) return null;
                if (rasterRegions.length === 0) return null;

                const moduleYear = moduleYears[module.id] || selectedYear;

                return rasterRegions.map((region) => {
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
                      onStatsUpdate={
                        layer.id === 'clearcut-annual' && region === clearcutStatsRegion
                          ? setClearcutPercent
                          : null
                      }
                      onBiomassHistogramUpdate={setBiomassHistogram}
                      onLoadingChange={handleLoadingChange}
                      opacity={rasterOpacity}
                      tileUrl={tileUrl}
                      layerId={layer.id}
                      tms={layer.tms !== undefined ? layer.tms : true}
                    />
                  );
                });
              });
            })}

            <RegionBoundaries selectedFMUs={selectedFMUs} useOntarioOverview={useOntarioOverview} />
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
