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

function RasterTileLayer({ mapRef, onStatsUpdate, opacity = 0.5 }) {
  const redPixelCountRef = useRef(0);
  const totalTilesRef = useRef(0);
  const totalPixelCountRef = useRef(0);

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

      let redCount = 0;
      let totalCount = 0;

      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const a = pixels[i + 3];
        // Count only non-transparent pixels
      
        totalCount++;
        if (r === 255 && g === 0 && b === 0) {
          redCount++;
        }
      }
      

      redPixelCountRef.current += redCount;
      totalPixelCountRef.current += totalCount;
      
      const percentage = totalPixelCountRef.current > 0
        ? ((redPixelCountRef.current / totalPixelCountRef.current) * 100).toFixed(2)
        : "0.00";

      if (onStatsUpdate) onStatsUpdate(percentage);
          }
    };
    
  return (
    <TileLayer
      url="/tiles/{z}/{x}/red_{y}.png"
      minZoom={6}
      maxZoom={14}
      opacity={opacity}
      zIndex={1000}
      tms={true}
      eventHandlers={{
        tileload: handleTileLoad,
        
      }}
    />
  );
}


function App() {
  const mapRef = useRef(null);
  const searchRef = useRef(null);
  const [mapReady, setMapReady] = useState(false); // ✅
  const [clearcutPercent, setClearcutPercent] = useState(null);
  const [rasterOpacity, setRasterOpacity] = useState(0.5); // default opacity

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

      <div className="opacity-control">
        <label htmlFor="opacity-slider">Overlay Opacity</label>
        <input
          id="opacity-slider"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={rasterOpacity}
          onChange={(e) => setRasterOpacity(parseFloat(e.target.value))}
        />
      </div>

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
        maxZoom={14}
        zoomControl={false}
        whenCreated={(mapInstance) => {
      console.log("Map created", mapInstance);
      mapRef.current = mapInstance;
      setMapReady(true);
    }}
        style={{ width: "100vw", height: "100vh", zIndex: 0 }}
      >
        <RasterTileLayer
          mapRef={mapRef}
          onStatsUpdate={(p) => setClearcutPercent(p)}
          opacity={rasterOpacity}
        />

        <TileLayer
          url="https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          attribution="&copy; Esri, DigitalGlobe, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, and others"
        />
        <DrawingTools mapRef={mapRef} />
        <ZoomControlPositioner position="bottomleft" />

      </MapContainer>


    </div>
  );
}

export default App;
