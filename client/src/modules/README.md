# ForestTrace - Modular Analysis Interface

## Architecture Overview

The ForestTrace application now uses a **3-column layout** with a modular architecture that makes it easy to add new analysis modules.

### Layout Structure

```
┌──────────────────────────────────────────────────────────┐
│                     ForestTrace Header                   │
├──────────────┬──────────────────────┬────────────────────┤
│   Module     │                      │                    │
│   Selector   │                      │    Module          │
│   (Left)     │        Map           │    Panel           │
│              │      (Center)        │    (Right)         │
│   - Clear    │                      │                    │
│     Cut      │                      │ Module-specific    │
│   - (Add     │                      │ statistics and     │
│     more)    │                      │ controls           │
│              │                      │                    │
└──────────────┴──────────────────────┴────────────────────┘
```

### Components

- **Top Menu** (`TopMenu.jsx`): Application header with branding and navigation
- **Module Selector** (`ModuleSelector.jsx`): Left sidebar showing available modules
- **Map Container** (center): Interactive map for spatial analysis
- **Module Panel** (`ModulePanel.jsx`): Right sidebar displaying module-specific UI
- **Modules** (in `/src/modules/`): Individual analysis modules

## Adding a New Module

### Step 1: Create the Module Component

Create a new file in `/src/modules/YourModuleName.jsx`:

```jsx
import React from 'react';

function YourModuleName({ data }) {
  return (
    <div className="your-module-class">
      <div className="module-section">
        <h3>Your Section Title</h3>
        {/* Add your UI here */}
      </div>
    </div>
  );
}

export default YourModuleName;
```

### Step 2: Register the Module in App.js

1. Import your module at the top:
```jsx
import YourModuleName from './modules/YourModuleName';
```

2. Add it to the `MODULES` array:
```jsx
const MODULES = [
  {
    id: 'clearcut',
    name: 'Clearcut Detection',
    icon: '🔍',
    description: 'Detect and analyze clearcut areas',
    component: ClearcutDetection,
  },
  {
    id: 'your-module',
    name: 'Your Module Name',
    icon: '📊',  // Choose an appropriate emoji
    description: 'Description of your module',
    component: YourModuleName,
  },
];
```

### Module Props

Each module component receives:
- `data` (object): Current data from the selected module, which includes:
  - `percentage`: Clearcut percentage (if applicable)
  - `opacity`: Current map overlay opacity
  - Other module-specific data

### Styling

Use the existing CSS classes for consistent styling:

- `.module-section`: Wraps a logical section within the module
- `.stat-item`: Single statistic display
- `.stat-label`: Label for a statistic
- `.stat-value`: Large number display
- `.stat-bar`: Progress bar visualization
- `.control-group`: Input control grouping
- `.slider`: Range input slider
- `.legend-item`: Legend entry
- `.no-data`: Empty state message

Example:
```jsx
<div className="module-section">
  <h3>Statistics</h3>
  <div className="stat-item">
    <div className="stat-label">Metric Name</div>
    <div className="stat-value">42%</div>
    <div className="stat-bar">
      <div className="stat-fill" style={{ width: '42%' }}></div>
    </div>
  </div>
</div>
```

## Styling Guidelines

### Colors
- Primary: `#1976d2` (blue)
- Background: White (`#ffffff`)
- Text: `#333`
- Borders: `#e0e0e0`

### Layout
- Sidebars: 200px width (left), 300px width (right)
- Borders: 1px solid `#e0e0e0`
- Shadows: `0 2px 4px rgba(0, 0, 0, 0.1)`

## Currently Available Modules

1. **Clearcut Detection** (`ClearcutDetection.jsx`)
   - Displays clearcut area percentages
   - Opacity control for overlay
   - Color legend

## Future Modules (Template Ready)

- Deforestation Tracking
- Forest Health Analysis
- Biomass Estimation
- Change Detection
- Custom Area Analysis

## File Structure

```
client/src/
├── components/
│   ├── ModulePanel.jsx
│   ├── ModuleSelector.jsx
│   ├── TopMenu.jsx
│   └── ...
├── modules/
│   ├── ClearcutDetection.jsx
│   ├── ModuleTemplate.jsx    ← Use as reference for new modules
│   └── [YourNewModule].jsx
├── styles/
│   ├── layout.css              ← 3-column layout styles
│   ├── map.css
│   ├── topmenu.css
│   └── menu.css
└── App.js                       ← Module registration
```

## Notes

- The layout is responsive and adapts to mobile screens
- Modules are lazy-loaded when selected
- The map remains interactive regardless of selected module
- All modules share the same data context from the map
