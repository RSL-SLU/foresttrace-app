export const onShapeComplete = (shape, setShapes) => {
  const type = shape.type;
  setShapes(prev => [
    ...prev,
    {
      shape,
      type,
      path: shape.getPath?.().getArray().map(p => ({ lat: p.lat(), lng: p.lng() })) || null,
      center: type === "circle" ? shape.getCenter() : null,
      radius: type === "circle" ? shape.getRadius() : null,
      bounds: type === "rectangle" ? shape.getBounds() : null,
    }
  ]);
};

export const handlePlaceChanged = (autocompleteRef, mapRef) => {
  const place = autocompleteRef.current.getPlace();
  if (place?.geometry) {
    const loc = place.geometry.location;
    mapRef.current.panTo({ lat: loc.lat(), lng: loc.lng() });
    mapRef.current.setZoom(14);
  }
};

export const handleLocateUser = (mapRef) => {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const loc = { lat: coords.latitude, lng: coords.longitude };
        mapRef.current.panTo(loc);
        mapRef.current.setZoom(14);
      },
      err => alert("Location error: " + err.message)
    );
  } else {
    alert("Geolocation not supported");
  }
};
