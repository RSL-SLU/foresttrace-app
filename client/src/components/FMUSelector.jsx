import React from 'react';

const FMU_OPTIONS = [
  { value: 'wabigoon', label: 'Wabigoon' },
  { value: 'troutlake', label: 'Troutlake' },
];

function FMUSelector({ values = [], onChange }) {
  const handleToggle = (fmuValue) => {
    const isSelected = values.includes(fmuValue);
    if (isSelected) {
      onChange(values.filter((value) => value !== fmuValue));
      return;
    }
    onChange([...values, fmuValue]);
  };

  return (
    <div className="fmu-selector-container" role="group" aria-label="Forest Management Area selector">
      <div className="fmu-selector-label">Forest Management Areas</div>
      <div className="fmu-selector-list">
        {FMU_OPTIONS.map((option) => {
          const inputId = `fmu-selector-${option.value}`;
          return (
            <label key={option.value} htmlFor={inputId} className="fmu-selector-option">
              <input
                id={inputId}
                type="checkbox"
                checked={values.includes(option.value)}
                onChange={() => handleToggle(option.value)}
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export default FMUSelector;
