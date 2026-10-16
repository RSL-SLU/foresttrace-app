import { useState } from 'react';

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
 *
 * With two or more modules drawn, `modules` ({ id, name, icon }) adds an
 * expandable list of per-module sliders. Each is a share of the overall
 * slider (default 100%), so the overall one still dims everything at once.
 */
function MapDisplayOptions({
  opacity, onOpacityChange, extra = null,
  modules = [], moduleOpacity = {}, onModuleOpacityChange,
}) {
  const [expanded, setExpanded] = useState(false);
  const perModule = modules.length > 1 && onModuleOpacityChange;

  return (
    <div className="map-display-options-wrap">
      {perModule && expanded && (
        <div className="map-display-options-modules" id="map-opacity-modules" role="group" aria-label="Opacity per module">
          {modules.map((m) => {
            const value = moduleOpacity[m.id] ?? 1;
            return (
              <div className="map-display-options-module" key={m.id}>
                <label htmlFor={`map-opacity-${m.id}`} className="map-display-options-label">
                  <span aria-hidden="true">{m.icon}</span> {m.name}
                </label>
                <input
                  id={`map-opacity-${m.id}`}
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={value}
                  className="slider"
                  onChange={(e) => onModuleOpacityChange(m.id, parseFloat(e.target.value))}
                />
                <span className="map-display-options-value">{Math.round(value * 100)}%</span>
              </div>
            );
          })}
        </div>
      )}
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
        {perModule && (
          <button
            type="button"
            className="map-display-options-expand"
            aria-expanded={expanded}
            aria-controls="map-opacity-modules"
            onClick={() => setExpanded((v) => !v)}
          >
            Per module {expanded ? '▾' : '▴'}
          </button>
        )}
        {extra}
      </div>
    </div>
  );
}

export default MapDisplayOptions;
