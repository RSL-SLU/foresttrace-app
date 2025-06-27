import React, { useRef } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import L from "leaflet";

import Menu from './components/Menu';
import TopMenu from './components/TopMenu';
import { handleLocateUser, handlePlaceChanged } from "./utils/mapUtils";

import "./styles/map.css";
import "./styles/topmenu.css";
import "./styles/menu.css";

const center = [45.0, -122.0];

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
      </MapContainer>
    </div>
  );
}

export default App;
