import { useEffect, useState } from 'react';

const NAV_ITEMS = [
  { id: 'about', label: 'About' },
  { id: 'help', label: 'Help' },
  { id: 'news', label: 'News' },
  { id: 'publication', label: 'Publication' },
  { id: 'documentation', label: 'Documentation' },
];

function TopMenu({ onNavigate, onHome, activePage }) {
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
          <button
            className={`nav-link-btn${!activePage ? ' nav-link-btn--active' : ''}`}
            onClick={onHome}
          >
            Home
          </button>
          {NAV_ITEMS.map(({ id, label }) => (
            <button
              key={id}
              className={`nav-link-btn${activePage === id ? ' nav-link-btn--active' : ''}`}
              onClick={() => onNavigate && onNavigate(id)}
            >
              {label}
            </button>
          ))}
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
