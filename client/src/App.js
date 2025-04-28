import React, { useState, useRef } from 'react';
import { GoogleMap, useLoadScript, DrawingManager } from '@react-google-maps/api';
import { Autocomplete } from '@react-google-maps/api';

const containerStyle = {
  width: '100vw',
  height: '100vh'
};


const center = {
  lat: 45.0,
  lng: -122.0
};

// Adjusted Polygon Icon for larger size
const PolygonIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
    <polygon points="20,5 35,15 30,35 10,35 5,15" fill="#1976d2" />
  </svg>
);

const CircleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
    <circle cx="20" cy="20" r="18" fill="#FF5722" />
  </svg>
);

const SquareIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
    <rect x="6" y="6" width="28" height="28" fill="#4CAF50" />
  </svg>
);

function App() {
  const [isMapDraggable, setIsMapDraggable] = useState(true);  // State to track the dragging state
  const [activeTool, setActiveTool] = useState(null); 

  const [shapes, setShapes] = useState([]);  // Store the actual shape instances here
  const mapRef = useRef();
  const drawingManagerRef = useRef(null);
  const autocompleteRef = useRef(null);

  const { isLoaded } = useLoadScript({
    googleMapsApiKey: process.env.REACT_APP_GOOGLE_MAPS_API_KEY,
    libraries: ['drawing', 'places']
  });

  // Function to turn on Map dragging
  const enableMapDragging = () => {
    console.log('Map dragging enabled');
    // Disable the drawing manager
    if (drawingManagerRef.current) {
      drawingManagerRef.current.setDrawingMode(null);
    }
    if (mapRef.current) {
      const newDraggable = !(mapRef.current.get('draggable'));
      mapRef.current.setOptions({ draggable: true });
      setIsMapDraggable(true);
      setActiveTool(newDraggable ? 'hand' : null);

    }
  };

  const onShapeComplete = (shape) => {
    // Save the actual shape instance along with type and necessary data
    const shapeData = {
      shape,
      type: shape.type,
      path: shape.getPath ? shape.getPath().getArray().map(latlng => ({
        lat: latlng.lat(),
        lng: latlng.lng()
      })) : null,
      center: shape.type === 'circle' ? shape.getCenter() : null,
      radius: shape.type === 'circle' ? shape.getRadius() : null,
      bounds: shape.type === 'rectangle' ? shape.getBounds() : null,
    };

    // Add the shape to the state
    setShapes(prev => [...prev, shapeData]);
  };

  const startDrawingPolygon = () => {
    if (drawingManagerRef.current) {
      drawingManagerRef.current.setDrawingMode(window.google.maps.drawing.OverlayType.POLYGON);
      setIsMapDraggable(false);
      setActiveTool('polygon');
    }
  };

  const startDrawingCircle = () => {
    if (drawingManagerRef.current) {
      drawingManagerRef.current.setDrawingMode(window.google.maps.drawing.OverlayType.CIRCLE);
      setIsMapDraggable(false);
      setActiveTool('circle');
    }
  };

  const startDrawingRectangle = () => {
    if (drawingManagerRef.current) {
      drawingManagerRef.current.setDrawingMode(window.google.maps.drawing.OverlayType.RECTANGLE);
      setIsMapDraggable(false);
      setActiveTool('rectangle');
    }
  };

  const undoLastShape = () => {
    if (shapes.length > 0) {
      const lastShape = shapes[shapes.length - 1].shape;
      lastShape.setMap(null);  // Remove it from the map
      setShapes(shapes.slice(0, shapes.length - 1)); // Remove the last shape from the state
    }
  };

  const HandIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="40" height="40">
      <path
        d="M20 30V14c0-2 1-4 4-4s4 2 4 4v10h2V10c0-2 1-4 4-4s4 2 4 4v14h2V14c0-2 1-4 4-4s4 2 4 4v16h2V18c0-2 1-4 4-4s4 2 4 4v26c0 8-6 14-14 14s-18-6-22-14l-4-8c-1-2 0-5 2-6s5-1 7 2l4 6z"
        fill="#ffffff"
        stroke="#000000"
        strokeWidth="2"
      />
    </svg>
  );

  if (!isLoaded) {
    return <div>Loading map...</div>;
  }

  const handlePlaceChanged = () => {
    const place = autocompleteRef.current.getPlace();
    if (place.geometry) {
      const location = place.geometry.location;
      mapRef.current.panTo({ lat: location.lat(), lng: location.lng() });
      mapRef.current.setZoom(14); // Zoom into the searched location
    }
  };

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <Autocomplete
          onLoad={(autocomplete) => (autocompleteRef.current = autocomplete)}
          onPlaceChanged={handlePlaceChanged}
        >
          <input
            type="text"
            placeholder="Search a place"
            style={{
              position: 'absolute',
              top: '10px',
              left: '50%',
              transform: 'translateX(-50%)',
              width: '300px',
              height: '40px',
              padding: '0 12px',
              borderRadius: '5px',
              border: '1px solid #ccc',
              fontSize: '16px',
              zIndex: 20,
            }}
          />
        </Autocomplete>
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '30px', // Move it a bit away from the edge
          transform: 'translateY(-50%)', // Center vertically
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column', // <--- Change to column for vertical stacking
          gap: '10px',
        }}
      >

        <button
          onClick={enableMapDragging}
          style={{
            padding: '15px',
            background: isMapDraggable ? '#ccc' : '#fff',
            border: '1px solid #ccc',
            cursor: 'pointer',
            fontSize: '18px',
            borderRadius: '5px',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
            <HandIcon />
        </button>
        <button
          onClick={startDrawingPolygon}
          style={{
            padding: '15px',
            background: activeTool === 'polygon' ? '#ccc' : '#fff',
            border: '1px solid #ccc',
            cursor: 'pointer',
            fontSize: '18px', // Larger font for easier clickability
            borderRadius: '5px',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <PolygonIcon />
        </button>
        <button
          onClick={startDrawingCircle}
          style={{
            padding: '15px',
            background: activeTool === 'circle' ? '#ccc' : '#fff',
            border: '1px solid #ccc',
            cursor: 'pointer',
            fontSize: '18px',
            borderRadius: '5px',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <CircleIcon />
        </button>
        <button
          onClick={startDrawingRectangle}
          style={{
            padding: '15px',
            background:  activeTool === 'rectangle' ? '#ccc' : '#fff',
            border: '1px solid #ccc',
            cursor: 'pointer',
            fontSize: '18px',
            borderRadius: '5px',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <SquareIcon />
        </button>
        <button
          onClick={undoLastShape}
          style={{
            padding: '15px',
            background: '#fff',
            border: '1px solid #ccc',
            cursor: 'pointer',
            fontSize: '18px',
            borderRadius: '5px',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          ↩️
        </button>
      </div>

      <GoogleMap
        mapContainerStyle={containerStyle}
        center={center}
        zoom={8}
        onLoad={map => (mapRef.current = map)}
      >
        <DrawingManager
          onLoad={drawingManager => (drawingManagerRef.current = drawingManager)}
          onPolygonComplete={onShapeComplete}
          onCircleComplete={onShapeComplete}
          onRectangleComplete={onShapeComplete}
          options={{
            drawingControl: false, // Disable default control
            drawingControlOptions: {
              drawingModes: ['polygon', 'circle', 'rectangle']
            },
            polygonOptions: {
              fillColor: '#00FF00',
              fillOpacity: 0.3,
              strokeWeight: 2,
              clickable: false,
              editable: false,
              zIndex: 1
            },
            circleOptions: {
              fillColor: '#FF0000',
              fillOpacity: 0.3,
              strokeWeight: 2,
              clickable: false,
              editable: false,
              zIndex: 1
            },
            rectangleOptions: {
              fillColor: '#0000FF',
              fillOpacity: 0.3,
              strokeWeight: 2,
              clickable: false,
              editable: false,
              zIndex: 1
            }
          }}
        />
      </GoogleMap>
    </div>
  );
}

export default App;
