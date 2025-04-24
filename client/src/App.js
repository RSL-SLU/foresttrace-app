import React, { useState, useRef } from 'react';
import { GoogleMap, useLoadScript, DrawingManager } from '@react-google-maps/api';

const containerStyle = {
  width: '100%',
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
  
  const onPolygonComplete = (polygon) => {
    const path = polygon.getPath().getArray().map(latlng => ({
      lat: latlng.lat(),
      lng: latlng.lng()
    }));
    setPolygons([...polygons, path]);
    polygon.setMap(null); // Optionally remove the polygon from the map
    // You could send this data to the backend here for clearcut detection
  };

  console.log("Map loaded?", isLoaded);

  if (isLoaded) {
    return (
      <div>
        <GoogleMap
          mapContainerStyle={containerStyle}
          center={center}
          zoom={8}
          onLoad={map => (mapRef.current = map)}
        >
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
        </GoogleMap>
      </div>
    );
  } else {
    return <div>Loading...</div>;
  }
}

export default App;