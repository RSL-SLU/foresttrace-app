import React, { useState, useRef } from "react";
import { GoogleMap, useLoadScript, DrawingManager, Autocomplete } from "@react-google-maps/api";
import DrawingToolbar from "./components/DrawingToolbar";
import { onShapeComplete, handlePlaceChanged, handleLocateUser } from "./utils/mapUtils";
import Menu from './components/Menu';
import TopMenu from './components/TopMenu';


import "./styles/map.css";
import "./styles/topmenu.css";
import "./styles/menu.css";

const containerStyle = { width: "100vw", height: "100vh" };
const center = { lat: 45.0, lng: -122.0 };

function App() {
  const [isMapDraggable, setIsMapDraggable] = useState(true);
  const [activeTool, setActiveTool] = useState(null);
  const [shapes, setShapes] = useState([]);
  const mapRef = useRef();
  const drawingManagerRef = useRef(null);
  const autocompleteRef = useRef(null);

  const { isLoaded } = useLoadScript({
    googleMapsApiKey: process.env.REACT_APP_GOOGLE_MAPS_API_KEY,
    libraries: ["drawing", "places"],
  });

  if (!isLoaded) return <div>Loading map...</div>;

  return (
    <div className="map-container">
      <TopMenu />
      <Menu onSelect={(option) => console.log('Selected:', option)} />

      <Autocomplete
        onLoad={(auto) => (autocompleteRef.current = auto)}
        onPlaceChanged={() => handlePlaceChanged(autocompleteRef, mapRef)}
      >
        <input className="search-box" placeholder="Search a place" />
      </Autocomplete>

      <DrawingToolbar
        isMapDraggable={isMapDraggable}
        setIsMapDraggable={setIsMapDraggable}
        activeTool={activeTool}
        setActiveTool={setActiveTool}
        shapes={shapes}
        setShapes={setShapes}
        mapRef={mapRef}
        drawingManagerRef={drawingManagerRef}
      />

      <button className="locate-btn" onClick={() => handleLocateUser(mapRef)} title="Locate Me">
        <svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" stroke="black" strokeWidth="2"/><circle cx="12" cy="12" r="9" stroke="black" strokeWidth="2"/><line x1="12" y1="2" x2="12" y2="5" stroke="black" strokeWidth="2"/><line x1="12" y1="19" x2="12" y2="22" stroke="black" strokeWidth="2"/><line x1="2" y1="12" x2="5" y2="12" stroke="black" strokeWidth="2"/><line x1="19" y1="12" x2="22" y2="12" stroke="black" strokeWidth="2"/></svg>
      </button>

      <GoogleMap
        mapContainerStyle={containerStyle}
        center={center}
        zoom={8}
        onLoad={(map) => (mapRef.current = map)}
      >
        <DrawingManager
          onLoad={(dm) => (drawingManagerRef.current = dm)}
          onPolygonComplete={(shape) => onShapeComplete(shape, setShapes)}
          onCircleComplete={(shape) => onShapeComplete(shape, setShapes)}
          onRectangleComplete={(shape) => onShapeComplete(shape, setShapes)}
          options={{
            drawingControl: false,
            polygonOptions: { fillColor: "#00FF00", fillOpacity: 0.3, strokeWeight: 2 },
            circleOptions: { fillColor: "#FF0000", fillOpacity: 0.3, strokeWeight: 2 },
            rectangleOptions: { fillColor: "#0000FF", fillOpacity: 0.3, strokeWeight: 2 },
          }}
        />
      </GoogleMap>
    </div>
  );
}

export default App;
