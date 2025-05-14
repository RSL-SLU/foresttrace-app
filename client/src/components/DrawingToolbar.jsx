import React from "react";
import { PolygonIcon, CircleIcon, SquareIcon, HandIcon } from "./Icons";

export default function DrawingToolbar({
  isMapDraggable,
  setIsMapDraggable,
  activeTool,
  setActiveTool,
  shapes,
  setShapes,
  mapRef,
  drawingManagerRef,
}) {
  const setDrawingMode = (mode) => {
    drawingManagerRef.current.setDrawingMode(
      window.google.maps.drawing.OverlayType[mode.toUpperCase()]
    );
    setIsMapDraggable(false);
    setActiveTool(mode);
  };

  const enableMapDragging = () => {
    drawingManagerRef.current.setDrawingMode(null);
    mapRef.current.setOptions({ draggable: true });
    setIsMapDraggable(true);
    setActiveTool("hand");
  };

  const undoLastShape = () => {
    const last = shapes.at(-1)?.shape;
    if (last) last.setMap(null);
    setShapes(shapes.slice(0, -1));
  };

  return (
    <div className="toolbar">
      <button className={activeTool === "hand" ? "active" : ""} onClick={enableMapDragging}><HandIcon /></button>
      <button className={activeTool === "polygon" ? "active" : ""} onClick={() => setDrawingMode("polygon")}><PolygonIcon /></button>
      <button className={activeTool === "circle" ? "active" : ""} onClick={() => setDrawingMode("circle")}><CircleIcon /></button>
      <button className={activeTool === "rectangle" ? "active" : ""} onClick={() => setDrawingMode("rectangle")}><SquareIcon /></button>
      <button onClick={undoLastShape}>↩️</button>
    </div>
  );
}
