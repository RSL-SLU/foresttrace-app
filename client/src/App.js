import React, { useRef } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";


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

function RasterTileLayer({ onStatsUpdate }) {
  const clearcutTilesRef = useRef(0);
  const totalTilesRef = useRef(0);
  const handleTileLoad = (e) => {
    const img = e.tile;

    // Simple heuristic: if tile has any visible content (opacity > 0)
    if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
      totalTilesRef.current++;

      const tmpCanvas = document.createElement("canvas");
      tmpCanvas.width = img.naturalWidth;
      tmpCanvas.height = img.naturalHeight;
      const ctx = tmpCanvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, tmpCanvas.width, tmpCanvas.height).data;

      // Check if the tile contains any red pixel
      let containsRed = false;
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        if (r === 255 && g === 0 && b === 0) {
          containsRed = true;
          break;
        }
      }

      if (containsRed) {
        clearcutTilesRef.current++;
      }

      const percentage = (
        (clearcutTilesRef.current / totalTilesRef.current) *
        100
      ).toFixed(2);

      if (onStatsUpdate) onStatsUpdate(percentage);
    }
  };



  return (
    <TileLayer
      url="/tiles/{z}/{x}/red_{y}.png"
      minZoom={6}
      maxZoom={12}
      opacity={0.5}
      zIndex={1000}
      tms={true}
      eventHandlers={{
        tileload: handleTileLoad,
        tileerror: (e) => console.warn("❌ Tile failed to load:", e.tile.src),
      }}
    />
  );
}


function App() {
  const mapRef = useRef(null);
  const searchRef = useRef(null);
  const [mapReady, setMapReady] = useState(false); // ✅
  const [clearcutPercent, setClearcutPercent] = useState(null);

  console.log("mapReady", mapReady);
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
      </button>

      
      {clearcutPercent && (
        <div className="stats-box">
          <span className="red-square"></span>
          Clearcut: {clearcutPercent}%
        </div>
      )}
      <div className="loading-indicator" style={{ display: mapReady ? "none" : "block" }}>
        Loading map...
      </div>
      <MapContainer
        center={center}
        zoom={8}
        minZoom={6}
        maxZoom={12}
        whenCreated={(mapInstance) => {
      console.log("Map created", mapInstance);
      mapRef.current = mapInstance;
      setMapReady(true);
    }}
        style={{ width: "100vw", height: "100vh", zIndex: 0 }}
      >
        <RasterTileLayer onStatsUpdate={(p) => setClearcutPercent(p)} />

        <TileLayer
          url="https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          attribution="&copy; Esri, DigitalGlobe, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, and others"
        />
        <DrawingTools mapRef={mapRef} />
        <RasterTileLayer />
      </MapContainer>


    </div>
  );
}

export default App;
