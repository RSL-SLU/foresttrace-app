import React, { useState, useRef, useEffect } from 'react';
import { GoogleMap, useLoadScript, DrawingManager } from '@react-google-maps/api';

const containerStyle = {
  width: '100vw',
  height: '100vh'
};

const center = {
  lat: 45.0,
  lng: -122.0
};

function App() {
  const [polygons, setPolygons] = useState([]);
  const mapRef = useRef();

  const { isLoaded } = useLoadScript({
    googleMapsApiKey: process.env.REACT_APP_GOOGLE_MAPS_API_KEY,
    libraries: ['drawing']
  });

  useEffect(() => {
    if (isLoaded && !window.google?.maps?.ControlPosition) {
      console.error('Google Maps loaded but ControlPosition is undefined');
    }
  }, [isLoaded]);

  const onPolygonComplete = (polygon) => {
    const path = polygon.getPath().getArray().map(latlng => ({
      lat: latlng.lat(),
      lng: latlng.lng()
    }));
    setPolygons(prev => [...prev, path]);
    polygon.setMap(null); // Optionally remove the polygon from the map
  };

  if (!isLoaded) {
    return <div>Loading map...</div>;
  }

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={center}
        zoom={8}
        onLoad={map => (mapRef.current = map)}
      >
        {window.google?.maps?.ControlPosition && (
          <DrawingManager
            onPolygonComplete={onPolygonComplete}
            options={{
              drawingControl: true,
              drawingControlOptions: {
                position: window.google.maps.ControlPosition.TOP_CENTER,
                drawingModes: ['polygon']
              },
              polygonOptions: {
                fillColor: '#00FF00',
                fillOpacity: 0.3,
                strokeWeight: 2,
                clickable: false,
                editable: false,
                zIndex: 1
              }
            }}
          />
        )}
      </GoogleMap>
    </div>
  );
}

export default App;
