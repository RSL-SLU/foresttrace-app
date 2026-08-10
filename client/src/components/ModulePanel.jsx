import React from 'react';

// The range thumb is 16px wide (.slider::-webkit-slider-thumb in layout.css),
// so its centre travels across (track width - 16px) rather than the full track.
// Markers have to use the same inset or they drift out of line with the thumb
// at the ends. Keep in sync if the thumb is ever resized.
const SLIDER_THUMB_PX = 16;

function ModulePanel({
  module,
  data,
  selectedYear,
  onYearChange,
  yearRange = [2015, 2024],
  availableYears,
  basemapSynced,
  fireYears = [],
}) {
  if (!module) {
    return (
      <div className="module-panel empty">
        <p>Select a module from the left sidebar</p>
      </div>
    );
  }

  // When the module declares specific years (with gaps), drive the slider by
  // index so positions snap directly to valid years instead of sweeping through
  // empty years like 2011–2014.
  const years = availableYears || null;
  const sliderMin = years ? 0 : yearRange[0];
  const sliderMax = years ? years.length - 1 : yearRange[1];
  const sliderValue = years
    ? Math.max(0, years.indexOf(selectedYear))
    : selectedYear;

  const handleSliderChange = (e) => {
    const raw = parseInt(e.target.value, 10);
    onYearChange(years ? years[raw] : raw);
  };

  const labelMin = years ? years[0] : yearRange[0];
  const labelMax = years ? years[years.length - 1] : yearRange[1];

  const showSlider = yearRange && yearRange.length === 2;

  // Place a fire marker over each year that actually has burned-area tiles.
  // Years the current slider cannot reach are dropped rather than clamped to
  // an end position, which would point at the wrong year.
  const fireMarkers = (fireYears || [])
    .map((year) => {
      let fraction;
      if (years) {
        const index = years.indexOf(year);
        if (index === -1) return null;
        fraction = years.length > 1 ? index / (years.length - 1) : 0;
      } else {
        const [min, max] = yearRange;
        if (year < min || year > max) return null;
        fraction = max > min ? (year - min) / (max - min) : 0;
      }
      return { year, fraction };
    })
    .filter(Boolean);

  return (
    <div className="module-panel">
      <div className="module-header">
        <h2>{module.name}</h2>
        {module.icon && <span className="module-icon">{module.icon}</span>}
      </div>
      <div className="module-content">
        {showSlider && (
          <div className="module-section year-controls">
            <h3>YEAR</h3>
            <div className="control-group">
              <div className="year-display">
                <span className="year-value">{selectedYear}</span>
              </div>
              <div className="year-slider-wrap">
                {/* Not aria-hidden: these are real, focusable controls that
                    jump the slider to a year. Hiding the container from the
                    accessibility tree while leaving the buttons tabbable
                    strands keyboard users on controls that announce nothing.
                    The emoji is hidden instead, so the aria-label is read. */}
                {fireMarkers.length > 0 && (
                  <div className="fire-marker-track">
                    {fireMarkers.map(({ year, fraction }) => (
                      <button
                        key={year}
                        type="button"
                        className={`fire-marker${year === selectedYear ? ' fire-marker--active' : ''}`}
                        style={{
                          left: `calc(${SLIDER_THUMB_PX / 2}px + (100% - ${SLIDER_THUMB_PX}px) * ${fraction})`,
                        }}
                        title={`Fire recorded in ${year}`}
                        aria-label={`Fire recorded in ${year} — show ${year}`}
                        aria-pressed={year === selectedYear}
                        onClick={() => onYearChange(year)}
                      >
                        <span aria-hidden="true">🔥</span>
                      </button>
                    ))}
                  </div>
                )}
                <input
                  type="range"
                  min={sliderMin}
                  max={sliderMax}
                  value={sliderValue}
                  onChange={handleSliderChange}
                  className="slider year-slider"
                />
              </div>
              <div className="year-range">
                <span>{labelMin}</span>
                <span>{labelMax}</span>
              </div>
              {basemapSynced === false && (
                <div className="basemap-warning">
                  Basemap shows current imagery — detections used {selectedYear} satellite data
                </div>
              )}
            </div>
          </div>
        )}

        {module.component && <module.component data={data} />}
      </div>
    </div>
  );
}

export default ModulePanel;
