import React, { useEffect, useState } from 'react';

function TopMenu() {
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('darkMode') === 'true';
  });

  useEffect(() => {
    document.body.classList.toggle('dark-mode', darkMode);
    localStorage.setItem('darkMode', String(darkMode));
  }, [darkMode]);

  return (
    <header className="top-menu">
      <div className="menu-left">
        <div className="brand-group">
          <h1 className="app-title">ForestTrace</h1>
          <div className="country-select">
            <select aria-label="Select area to monitor" defaultValue="boreal-canada">
              <optgroup label="Countries">
                <option value="canada" disabled>🇨🇦 Canada (Coming soon)</option>
                <option value="us" disabled>🇺🇸 United States (Coming soon)</option>
                <option value="brazil" disabled>🇧🇷 Brazil (Coming soon)</option>
              </optgroup>
              <optgroup label="Regional boundaries">
                <option value="boreal-canada">🌲 Boreal Forest (Canada)</option>
              </optgroup>
            </select>
            <span className="select-arrow" aria-hidden="true">▾</span>
          </div>
        </div>
        <nav className="nav-links">
          <a href="#about">About</a>
          <a href="#help">Help</a>
          <a href="#news">News</a>
          <a href="#publication">Publication</a>
          <a href="#documentation">Documentation</a>
        </nav>
      </div>
      <div className="menu-right">
        <button
          className="dark-toggle"
          type="button"
          onClick={() => setDarkMode((prev) => !prev)}
          aria-pressed={darkMode}
          title={darkMode ? 'Disable dark mode' : 'Enable dark mode'}
        >
          {darkMode ? 'Light Mode' : 'Dark Mode'}
        </button>
      </div>
    </header>
  );
}

export default TopMenu;
