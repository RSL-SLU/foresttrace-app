import React, { useRef } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import "leaflet.vectorgrid";  // ✅ Move here
import { VectorTile } from "@mapbox/vector-tile";
import Protobuf from "pbf";


import { useEffect, useState } from 'react';

import Menu from './components/Menu';
import TopMenu from './components/TopMenu';
import { handleLocateUser, handlePlaceChanged } from "./utils/mapUtils";

import "./styles/map.css";
import "./styles/topmenu.css";
import "./styles/menu.css";

const center = [49.80318325874751, -92.8087780822145];

function DrawingTools({ mapRef }) {
  const map = useMap();
  mapRef.current = map;

  React.useEffect(() => {
    map.pm.addControls({
      position: "topleft",
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

function VectorTileLayer() {
  const map = useMap();
  const layerRef = useRef(L.layerGroup());
  const [loading, setLoading] = useState(false);

  function getTileCoords(lat, lng, z) {
    const tileSize = 256;
    const worldCoord = map.project([lat, lng], z);
    return {
      x: Math.floor(worldCoord.x / tileSize),
      y: Math.floor(worldCoord.y / tileSize),
      z,
    };
  }

  useEffect(() => {
    layerRef.current.addTo(map);

    function loadTiles() {
      const bounds = map.getBounds();
      const zoom = map.getZoom();
      if (zoom < 6 || zoom > 10) return;

      const nw = bounds.getNorthWest();
      const se = bounds.getSouthEast();

      const nwTile = getTileCoords(nw.lat, nw.lng, zoom);
      const seTile = getTileCoords(se.lat, se.lng, zoom);

      console.log(`🗺️ Loading tiles for zoom ${zoom}:`, nwTile, seTile);

      layerRef.current.clearLayers();
      setLoading(true);

      const promises = [];

      for (let x = nwTile.x; x <= seTile.x; x++) {
        for (let y = nwTile.y; y <= seTile.y; y++) {
          const url = `http://127.0.0.1:5000/tiles/${zoom}/${x}/${y}.geojson`;
          console.log("📦 Fetching:", url);

          const promise = fetch(url)
            .then(res => {
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              return res.json();
            })
            .then(data => {
              if (!data || !data.features || data.features.length === 0) {
                console.log(`📭 Empty tile: ${zoom}/${x}/${y}`);
                return;
              }

              const geoJsonLayer = L.geoJSON(data, {
                style: {
                  color: "#FF0000",
                  weight: 1,
                  fillOpacity: 0.3,
                },
                onEachFeature: (feature, layer) => {
                  const { cluster, area } = feature.properties || {};
                  if (cluster !== undefined) {
                    layer.bindPopup(`Cluster: ${cluster}, Area: ${area}`);
                  }
                }
              });

              geoJsonLayer.addTo(layerRef.current);
            })
            .catch(err => {
              console.warn("❌ Tile fetch failed:", url, err);
            });

          promises.push(promise);
        }
      }

      Promise.allSettled(promises).then(() => {
        setLoading(false);
      });
    }

    map.on("moveend", loadTiles);
    loadTiles();

    return () => {
      map.off("moveend", loadTiles);
      map.removeLayer(layerRef.current);
    };
  }, [map]);

  return (
    <>
      {loading && (
        <div style={{
          position: "absolute",
          top: "10px",
          right: "10px",
          padding: "8px 12px",
          backgroundColor: "rgba(255,255,255,0.9)",
          border: "1px solid #ccc",
          borderRadius: "8px",
          zIndex: 1000
        }}>
          <span role="status">🔄 Loading tiles...</span>
        </div>
      )}
    </>
  );
}



function App() {
  const mapRef = useRef(null);
  const searchRef = useRef(null);

  return (
    <div className="map-container">
      <TopMenu />
      <Menu onSelect={(option) => console.log("Selected:", option)} />

      <input
        className="search-box"
        placeholder="Search a place"
        ref={searchRef}
        onKeyDown={(e) => {
          if (e.key === "Enter") handlePlaceChanged(searchRef, mapRef);
        }}
      />

      <button
        className="locate-btn"
        onClick={() => handleLocateUser(mapRef)}
        title="Locate Me"
      >
        <svg width="24" height="24" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3" stroke="black" strokeWidth="2" />
          <circle cx="12" cy="12" r="9" stroke="black" strokeWidth="2" />
          <line x1="12" y1="2" x2="12" y2="5" stroke="black" strokeWidth="2" />
          <line x1="12" y1="19" x2="12" y2="22" stroke="black" strokeWidth="2" />
          <line x1="2" y1="12" x2="5" y2="12" stroke="black" strokeWidth="2" />
          <line x1="19" y1="12" x2="22" y2="12" stroke="black" strokeWidth="2" />
        </svg>
      </button>

      <MapContainer
        center={center}
        zoom={8}
        style={{ width: "100vw", height: "100vh", zIndex: 0 }}
      >
        <TileLayer
          url="https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          attribution="&copy; Esri, DigitalGlobe, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, and others"
        />
        <DrawingTools mapRef={mapRef} />
        <VectorTileLayer />  {/* Add this line here */}
      </MapContainer>
    </div>
  );
}

export default App;
