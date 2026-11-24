import React, { useState } from 'react';
// Shared with the API (alert emails name FMUs), hence JSON rather than inline.
import ONTARIO_FMUS from '../data/ontarioFmus.json';

const PROVINCE_GROUPS = [
  {
    id: 'ontario',
    label: 'Ontario',
    units: ONTARIO_FMUS,
  },
  { id: 'quebec', label: 'Quebec', units: [], mocked: true },
  { id: 'britishcolumbia', label: 'British Columbia', units: [], mocked: true },
  { id: 'alberta', label: 'Alberta', units: [], mocked: true },
  { id: 'saskatchewan', label: 'Saskatchewan', units: [], mocked: true },
  { id: 'manitoba', label: 'Manitoba', units: [], mocked: true },
  { id: 'atlanticcanada', label: 'Atlantic Canada', units: [], mocked: true },
];

/** FMU id -> display name, e.g. wabigoon -> "Wabigoon Forest". */
export const FMU_LABELS = Object.fromEntries(ONTARIO_FMUS.map((u) => [u.value, u.label]));

export const ALL_FMU_VALUES = Array.from(new Set(PROVINCE_GROUPS.flatMap((group) => group.units.map((unit) => unit.value))));

function FMUSelector({ values = [], onChange }) {
  const [activeProvinceId, setActiveProvinceId] = useState(null);

  const handleToggle = (fmuValue) => {
    const isSelected = values.includes(fmuValue);
    if (isSelected) {
      onChange(values.filter((value) => value !== fmuValue));
      return;
    }
    onChange([...values, fmuValue]);
  };

  const handleSelectAll = () => {
    onChange(ALL_FMU_VALUES);
  };

  const handleDeselectAll = () => {
    onChange([]);
  };

  const activeProvince = PROVINCE_GROUPS.find((province) => province.id === activeProvinceId) || null;

  return (
    <div className="fmu-selector-container" role="group" aria-label="Forest Management Area selector">
      <div className="fmu-selector-label">
        {activeProvince ? `Province / ${activeProvince.label}` : 'Province'}
      </div>
      <div className="fmu-selector-actions">
        <button type="button" className="fmu-selector-link" onClick={handleSelectAll}>
          Select all
        </button>
        <span className="fmu-selector-action-separator">|</span>
        <button type="button" className="fmu-selector-link" onClick={handleDeselectAll}>
          Deselect all
        </button>
      </div>

      {activeProvince && (
        <button type="button" className="fmu-back-button" onClick={() => setActiveProvinceId(null)}>
          Back to provinces
        </button>
      )}

      <div className="fmu-selector-list">
        {!activeProvince && PROVINCE_GROUPS.map((province) => (
          <div key={province.id} className="fmu-province-group">
            <button
              type="button"
              className="fmu-province-toggle"
              onClick={() => setActiveProvinceId(province.id)}
              aria-label={`Open ${province.label}`}
            >
              <span className="fmu-province-chevron">▸</span>
              <span className="fmu-province-label">{province.label}</span>
              {province.units.length > 0 && (
                <span className="fmu-province-meta">{province.units.length} FMUs</span>
              )}
              {province.mocked && (
                <span className="fmu-province-meta">Mocked</span>
              )}
            </button>
          </div>
        ))}

        {activeProvince && activeProvince.units.length > 0 && (
          <div className="fmu-selector-subtree" role="group" aria-label={`${activeProvince.label} Forest Management Units`}>
            {activeProvince.units.map((unit) => {
              const inputId = `fmu-selector-${unit.value}`;
              return (
                <label key={unit.value} htmlFor={inputId} className="fmu-selector-option">
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={values.includes(unit.value)}
                    onChange={() => handleToggle(unit.value)}
                  />
                  <span>{unit.label}</span>
                </label>
              );
            })}
          </div>
        )}

        {activeProvince && activeProvince.units.length === 0 && (
          <div className="fmu-mocked-note">Mocked province group. FMUs coming soon.</div>
        )}
      </div>
    </div>
  );
}

export default FMUSelector;
