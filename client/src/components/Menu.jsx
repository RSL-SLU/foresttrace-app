import React, { useState } from 'react';

const menuItems = [
  { label: 'Catalog', icon: '📚' },
  { label: 'Layers', icon: '🗺️' },
  { label: 'Statistics', icon: '📊' },
  { label: 'PDF Map', icon: '📰' },
  { label: 'Profile', icon: '📈' },
  { label: 'Composite', icon: '🧩' },
  { label: 'Download', icon: '⬇️' },
  { label: 'Save Map', icon: '💾' },
];

function Menu({ onSelect }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className={`menu-container ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <button className="toggle-btn" onClick={() => setIsExpanded(prev => !prev)}>
        {isExpanded ? '←' : '☰'}
      </button>
      <ul className="menu-list">
        {menuItems.map((item) => (
          <li key={item.label} className="menu-item" onClick={() => onSelect(item.label)}>
            <span className="menu-icon">{item.icon}</span>
            {isExpanded && <span className="menu-label">{item.label}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default Menu;
