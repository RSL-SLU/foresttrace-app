import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import '../styles/auth.css';

const NAV_ITEMS = [
  { id: 'about', label: 'About' },
  { id: 'help', label: 'Help' },
  { id: 'news', label: 'News' },
  { id: 'publication', label: 'Publication' },
  { id: 'documentation', label: 'Documentation' },
];

const LANDING_NAV_ITEMS = [
  { id: 'overview', label: 'Overview' },
  { id: 'methodology', label: 'Methodology' },
  { id: 'about', label: 'About' },
  { id: 'news', label: 'News' },
  { id: 'contact', label: 'Contact' },
];

function TopMenu({
  isLanding = false,
  onNavigate,
  onHome,
  activePage,
  onOpenAdminDashboard,
  onOpenChatHistory,
  onOpenBugReport,
}) {
  const { user, isAuthenticated, isInitialized, openAuthModal, logout } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  // Mobile (<= 768px) collapses the nav links into a hamburger panel.
  const [navOpen, setNavOpen] = useState(false);
  const headerRef = useRef(null);

  const [darkMode, setDarkMode] = useState(() => {
    const storedPreference = localStorage.getItem('darkMode');
    if (storedPreference === null) return true;
    return storedPreference === 'true';
  });

  useEffect(() => {
    document.body.classList.toggle('dark-mode', darkMode);
    localStorage.setItem('darkMode', String(darkMode));
  }, [darkMode]);

  // Click outside to close user dropdown
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close the mobile nav panel on a click outside the header or on Escape
  useEffect(() => {
    if (!navOpen) return undefined;
    function handlePointer(e) {
      if (headerRef.current && !headerRef.current.contains(e.target)) setNavOpen(false);
    }
    function handleKey(e) {
      if (e.key === 'Escape') setNavOpen(false);
    }
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [navOpen]);

  // Runs a nav action and closes the mobile panel behind it
  const navAction = (fn) => () => {
    setNavOpen(false);
    fn();
  };

  const handleLandingScroll = (id) => {
    if (id === 'overview') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleBrandClick = () => {
    if (isLanding) {
      handleLandingScroll('overview');
    } else if (onHome) {
      onHome();
    }
  };

  return (
    <header className="top-menu" ref={headerRef}>
      <div className="menu-left">
        <div className="brand-group">
          <h1 className="app-title" onClick={handleBrandClick} style={{ cursor: 'pointer' }}>ForestTrace</h1>
          {!isLanding && (
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
          )}
        </div>
        <nav id="top-menu-nav" className={`nav-links${navOpen ? ' nav-links--open' : ''}`}>
          {isLanding ? (
            LANDING_NAV_ITEMS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className="nav-link-btn"
                onClick={navAction(() => handleLandingScroll(id))}
              >
                {label}
              </button>
            ))
          ) : (
            <>
              <button
                className={`nav-link-btn${!activePage ? ' nav-link-btn--active' : ''}`}
                onClick={navAction(() => onHome && onHome())}
              >
                Home
              </button>
              {NAV_ITEMS.map(({ id, label }) => (
                <button
                  key={id}
                  className={`nav-link-btn${activePage === id ? ' nav-link-btn--active' : ''}`}
                  onClick={navAction(() => onNavigate && onNavigate(id))}
                >
                  {label}
                </button>
              ))}
            </>
          )}
          {/* Mobile only: the header has no room for it next to Sign In */}
          <button
            type="button"
            className="nav-link-btn nav-dark-toggle"
            onClick={() => setDarkMode((prev) => !prev)}
            aria-pressed={darkMode}
          >
            {darkMode ? 'Light Mode' : 'Dark Mode'}
          </button>
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

        {isAuthenticated && user ? (
          <div className="user-menu-container" ref={dropdownRef}>
            <button
              type="button"
              className="user-profile-badge"
              onClick={() => setDropdownOpen((prev) => !prev)}
              aria-expanded={dropdownOpen}
            >
              <span>👤</span>
              <span>{user.name || user.email.split('@')[0]}</span>
              {user.role === 'admin' && (
                <span className="user-role-chip user-role-chip--admin">ADMIN</span>
              )}
              <span style={{ fontSize: 10 }}>▾</span>
            </button>

            {dropdownOpen && (
              <div className="user-dropdown-menu">
                <div className="user-dropdown-header">
                  <strong>{user.name || 'User'}</strong>
                  <span>{user.email}</span>
                </div>

                <button
                  type="button"
                  className="user-dropdown-item"
                  onClick={() => {
                    setDropdownOpen(false);
                    onOpenChatHistory && onOpenChatHistory();
                  }}
                >
                  <span>💬</span> My AI Chats
                </button>

                <button
                  type="button"
                  className="user-dropdown-item"
                  onClick={() => {
                    setDropdownOpen(false);
                    onOpenBugReport && onOpenBugReport();
                  }}
                >
                  <span>🐛</span> Report an Issue
                </button>

                {user.role === 'admin' && (
                  <button
                    type="button"
                    className="user-dropdown-item"
                    onClick={() => {
                      setDropdownOpen(false);
                      onOpenAdminDashboard && onOpenAdminDashboard();
                    }}
                  >
                    <span>⚙️</span> Admin Dashboard
                  </button>
                )}

                <div className="user-dropdown-divider" />

                <button
                  type="button"
                  className="user-dropdown-item"
                  onClick={() => {
                    setDropdownOpen(false);
                    logout();
                  }}
                >
                  <span>🚪</span> Sign Out
                </button>
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            className="user-profile-badge"
            onClick={() => openAuthModal(isInitialized ? 'login' : 'bootstrap')}
          >
            <span>👤</span> {isInitialized ? 'Sign In' : 'Setup Admin'}
          </button>
        )}

        <button
          type="button"
          className="nav-toggle"
          onClick={() => setNavOpen((prev) => !prev)}
          aria-expanded={navOpen}
          aria-controls="top-menu-nav"
          aria-label={navOpen ? 'Close menu' : 'Open menu'}
        >
          <span className="nav-toggle-bar" aria-hidden="true" />
          <span className="nav-toggle-bar" aria-hidden="true" />
          <span className="nav-toggle-bar" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

export default TopMenu;
