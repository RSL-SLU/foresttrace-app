import React from 'react';

function TopMenu() {
  return (
    <header className="top-menu">
      <div className="menu-left">
        <h1 className="app-title">ForestTrace</h1>
        <nav className="nav-links">
          <a href="#about">About</a>
          <a href="#help">Help</a>
          <a href="#news">News</a>
          <a href="#publication">Publication</a>
          <a href="#documentation">Documentation</a>
        </nav>
      </div>
      <div className="menu-right">
        <img className="logo-placeholder" src="rsl-logo.png" alt="RSL SLU" />
      </div>
    </header>
  );
}

export default TopMenu;
