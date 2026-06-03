import React, { useState } from 'react';

const PROVINCE_GROUPS = [
  {
    id: 'ontario',
    label: 'Ontario',
    units: [
      { value: 'abitibiriver', label: 'Abitibi River Forest' },
      { value: 'algoma', label: 'Algoma Forest' },
      { value: 'algonquinpark', label: 'Algonquin Park Forest' },
      { value: 'bancroftminden', label: 'Bancroft-Minden Forest' },
      { value: 'blackspruce', label: 'Black Spruce Forest' },
      { value: 'boundarywaters', label: 'Boundary Waters Forest' },
      { value: 'caribou', label: 'Caribou Forest' },
      { value: 'dogrivermatawin', label: 'Dog River-Matawin Forest' },
      { value: 'dryden', label: 'Dryden Forest' },
      { value: 'englishriver', label: 'English River Forest' },
      { value: 'frenchsevern', label: 'French-Severn Forest' },
      { value: 'gordoncosens', label: 'Gordon Cosens Forest' },
      { value: 'hearst', label: 'Hearst Forest' },
      { value: 'kenogami', label: 'Kenogami Forest' },
      { value: 'kenora', label: 'Kenora Forest' },
      { value: 'lacseul', label: 'Lac Seul Forest' },
      { value: 'lakehead', label: 'Lakehead Forest' },
      { value: 'lakenipigon', label: 'Lake Nipigon Forest' },
      { value: 'mazinawlanark', label: 'Mazinaw-Lanark Forest' },
      { value: 'missinaibi', label: 'Missinaibi Forest' },
      { value: 'nagagami', label: 'Nagagami Forest' },
      { value: 'nipissing', label: 'Nipissing Forest' },
      { value: 'northshore', label: 'Northshore Forest' },
      { value: 'ogoki', label: 'Ogoki Forest' },
      { value: 'ottawavalley', label: 'Ottawa Valley Forest' },
      { value: 'pic', label: 'Pic Forest' },
      { value: 'pineland', label: 'Pineland Forest' },
      { value: 'redlake', label: 'Red Lake Forest' },
      { value: 'romeomalette', label: 'Romeo Malette Forest' },
      { value: 'spanish', label: 'Spanish Forest' },
      { value: 'sudbury', label: 'Sudbury Forest' },
      { value: 'temagami', label: 'Temagami Forest' },
      { value: 'timiskaming', label: 'Timiskaming Forest' },
      { value: 'troutlake', label: 'Trout Lake Forest' },
      { value: 'wabadowgangnoopming', label: 'Wabadowgang Noopming Forest' },
      { value: 'wabigoon', label: 'Wabigoon Forest' },
      { value: 'whiskeyjack', label: 'Whiskey Jack Forest' },
      { value: 'whitefeather', label: 'Whitefeather Forest' },
      { value: 'whiteriver', label: 'White River Forest' },
    ],
  },
  { id: 'quebec', label: 'Quebec', units: [], mocked: true },
  { id: 'britishcolumbia', label: 'British Columbia', units: [], mocked: true },
  { id: 'alberta', label: 'Alberta', units: [], mocked: true },
  { id: 'saskatchewan', label: 'Saskatchewan', units: [], mocked: true },
  { id: 'manitoba', label: 'Manitoba', units: [], mocked: true },
  { id: 'atlanticcanada', label: 'Atlantic Canada', units: [], mocked: true },
];

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
