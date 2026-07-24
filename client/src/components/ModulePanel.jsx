import React from 'react';

function ModulePanel({
  module,
  data,
  selectedYear,
  onYearChange,
  yearRange = [2015, 2024],
  availableYears,
  basemapSynced,
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
              <input
                type="range"
                min={sliderMin}
                max={sliderMax}
                value={sliderValue}
                onChange={handleSliderChange}
                className="slider year-slider"
              />
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
