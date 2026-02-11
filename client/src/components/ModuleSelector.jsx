import React, { useState } from 'react';

/**
 * ModuleSelector - Left sidebar for selecting modules and layers
 * Displays available analysis modules and allows toggling of layers
 */
function ModuleSelector({ modules, selectedModule, onModuleSelect, activeLayers, onLayerToggle }) {
  const [activeTab, setActiveTab] = useState('modules');

  return (
    <div className="module-selector">
      <div className="selector-header">
        <h3>Explore</h3>
        <div className="selector-tabs">
          <button
            className={`selector-tab ${activeTab === 'modules' ? 'active' : ''}`}
            onClick={() => setActiveTab('modules')}
            type="button"
          >
            Modules
          </button>
          <button
            className={`selector-tab ${activeTab === 'forest-ai' ? 'active' : ''}`}
            onClick={() => setActiveTab('forest-ai')}
            type="button"
          >
            Forest AI
          </button>
        </div>
      </div>
      {activeTab === 'modules' && (
        <div className="module-list">
          {modules.map((module) => (
            <div key={module.id} className="module-item">
              <button
                className={`module-btn ${selectedModule?.id === module.id ? 'active' : ''}`}
                onClick={() => onModuleSelect(module)}
                title={module.description}
              >
                <span className="module-btn-icon">{module.icon}</span>
                <span className="module-btn-label">{module.name}</span>
                <span className="module-expand-indicator">
                  {selectedModule?.id === module.id ? '−' : '+'}
                </span>
              </button>
              {selectedModule?.id === module.id && module.layers && (
                <div className="module-options" role="group" aria-label={`${module.name} layers`}>
                  {module.layers.map((layer) => (
                    <label key={layer.id} className="module-option">
                      <input
                        type="checkbox"
                        checked={activeLayers.includes(layer.id)}
                        onChange={() => onLayerToggle(layer.id)}
                      />
                      {layer.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {activeTab === 'forest-ai' && (
        <div className="module-list empty-state">Forest AI modules coming soon.</div>
      )}
    </div>
  );
}

export default ModuleSelector;
