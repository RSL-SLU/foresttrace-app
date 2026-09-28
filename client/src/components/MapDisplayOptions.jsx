/**
 * Display options bar, docked above the year timeline.
 *
 * Was duplicated per module (ClearcutDetection.jsx and BiomassModule.jsx each
 * had their own "Display Options" section with an identical opacity slider,
 * wildfire and caribou had none at all). Pulled out for the same reason the
 * year control itself lives on the map rather than in the panel: opacity
 * applies to what is *drawn*, not to whichever module the right-hand panel
 * happens to be showing, so one control here is both less code and more
 * correct than a copy owned by each module.
 *
 * `extra` is a module-specific control slot (e.g. clearcut's "Inspect harvest
 * year" toggle) -- most modules pass nothing and get just the opacity slider.
 */
function MapDisplayOptions({ opacity, onOpacityChange, extra = null }) {
  return (
    <div className="map-display-options" role="group" aria-label="Display options">
      <label htmlFor="map-opacity-slider" className="map-display-options-label">
        Overlay Opacity
      </label>
      <input
        id="map-opacity-slider"
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={opacity}
        className="slider"
        onChange={(e) => onOpacityChange(parseFloat(e.target.value))}
      />
      {extra}
    </div>
  );
}

export default MapDisplayOptions;
