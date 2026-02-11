import React from 'react';

/**
 * ModulePanel - Displays content for the selected module
 * Includes year slider for temporal navigation
 */
function ModulePanel({ 
  module, 
  data,
  selectedYear,
  onYearChange,
  yearRange = [2015, 2024],
}) {
  if (!module) {
    return (
      <div className="module-panel empty">
        <p>Select a module from the left sidebar</p>
      </div>
    );
  }

  return (
    <div className="module-panel">
      <div className="module-header">
        <h2>{module.name}</h2>
        {module.icon && <span className="module-icon">{module.icon}</span>}
      </div>
      <div className="module-content">
        {/* Year Slider */}
        {yearRange && yearRange.length === 2 && (
          <div className="module-section year-controls">
            <h3>Year</h3>
            <div className="control-group">
              <div className="year-display">
                <span className="year-value">{selectedYear}</span>
              </div>
              <input
                type="range"
                min={yearRange[0]}
                max={yearRange[1]}
                value={selectedYear}
                onChange={(e) => onYearChange(parseInt(e.target.value))}
                className="slider year-slider"
              />
              <div className="year-range">
                <span>{yearRange[0]}</span>
                <span>{yearRange[1]}</span>
              </div>
            </div>
          </div>
        )}

        {/* Module Component */}
        {module.component && <module.component data={data} />}
      </div>
    </div>
  );
}

export default ModulePanel;
