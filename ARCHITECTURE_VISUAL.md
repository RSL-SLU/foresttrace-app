# ForestTrace 3-Column Layout - Visual Architecture

## Main Layout Structure

```
┌──────────────────────────────────────────────────────────────┐
│                   <TopMenu /> Component                       │
│          (ForestTrace Header, Logo, Navigation)              │
└──────────────────────────────────────────────────────────────┘
┌───────────┬────────────────────────┬───────────────────────┐
│           │                        │                       │
│           │                        │                       │
│    LEFT   │      CENTER            │       RIGHT           │
│           │                        │                       │
│ Module    │  MapContainer          │  Module Panel         │
│ Selector  │  ===============       │  ===============      │
│           │                        │                       │
│ ┌─────┐  │  ┌────────────────┐   │  ┌─────────────────┐ │
│ │ 🔍  │  │  │                │   │  │ Clearcut        │ │
│ │Clear│  │  │   Interactive  │   │  │ Detection       │ │
│ │Cut  │  │  │   Map          │   │  │ ─────────────── │ │
│ │     │  │  │   (Leaflet)    │   │  │                 │ │
│ │(+)  │  │  │                │   │  │ Clearcut: 42%   │ │
│ │More │  │  │ • Satellite    │   │  │ ████████░░      │ │
│ │     │  │  │ • Drawing      │   │  │                 │ │
│ │     │  │  │   tools        │   │  │ Opacity:        │ │
│ │     │  │  │ • Controls     │   │  │ ────●───────    │ │
│ │     │  │  │ • Search       │   │  │                 │ │
│ │     │  │  │                │   │  │ Legend:         │ │
│ │     │  │  │                │   │  │ 🔴 Clearcut     │ │
│ │     │  │  │                │   │  │ 🟢 Forest       │ │
│ └─────┘  │  └────────────────┘   │  └─────────────────┘ │
│ 200px    │        Flexible       │       300px           │
└───────────┴────────────────────────┴───────────────────────┘
```

## Component Hierarchy

```
App
├── TopMenu
│   ├── menu-left
│   │   ├── app-title
│   │   └── nav-links
│   └── menu-right
│       └── logo
│
└── layout-container (3-column flex)
    ├── ModuleSelector (LEFT)
    │   ├── selector-header
    │   └── module-list
    │       ├── module-btn (clearcut)
    │       ├── module-btn (future module)
    │       └── ...
    │
    ├── map-center (CENTER)
    │   ├── search-box
    │   ├── locate-btn
    │   ├── loading-indicator
    │   └── MapContainer (Leaflet)
    │       ├── RasterTileLayer
    │       ├── TileLayer (satellite)
    │       ├── DrawingTools
    │       └── ZoomControlPositioner
    │
    └── module-panel-container (RIGHT)
        └── ModulePanel
            ├── module-header
            └── module-content
                └── [Dynamic Module Component]
                    ├── ClearcutDetection
                    ├── DeforestationTracking (future)
                    └── ...
```

## Data Flow

```
┌─────────────────────────────────────────────────────────┐
│                      App State                          │
│ ┌──────────────────────────────────────────────────┐   │
│ │ • selectedModule (MODULES[0] by default)         │   │
│ │ • clearcutPercent (from map analysis)            │   │
│ │ • rasterOpacity (overlay transparency)           │   │
│ │ • mapReady (loading state)                       │   │
│ └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
         ↓                    ↓                    ↓
    ┌────────────┐   ┌─────────────┐   ┌──────────────┐
    │   Module   │   │     Map     │   │   Module     │
    │  Selector  │   │  Analysis   │   │   Panel      │
    └────────────┘   └─────────────┘   └──────────────┘
         ↓                    ↓                    ↓
    Shows modules,   Analyzes tiles,    Displays stats
    user selects    updates stats       for selected
                                        module

         ↑────────────────────────────────────────↓
              User selection triggers updates
```

## Module Addition Workflow

```
1. Developer Creates Module
   └─ src/modules/YourModule.jsx
      ├─ Imports React
      ├─ Receives { data } prop
      └─ Returns JSX with module content

2. Import in App.js
   └─ import YourModule from './modules/YourModule'

3. Register in MODULES Array
   └─ const MODULES = [
        {
          id: 'your-id',
          name: 'Your Module Name',
          icon: '🎯',
          description: 'Module description',
          component: YourModule
        },
        ...
      ]

4. Automatic UI Update
   ├─ ModuleSelector shows new module button
   ├─ Clicking button updates selectedModule
   ├─ ModulePanel renders the component
   └─ Module receives current data props
```

## CSS Class Hierarchy

```
layout-container (Flex: row)
├── module-selector (Left sidebar)
│   ├── selector-header
│   └── module-list
│       └── module-btn
│           ├── module-btn-icon
│           └── module-btn-label
│
├── map-center (Center, flex: 1)
│   ├── search-box
│   ├── locate-btn
│   ├── loading-indicator
│   └── MapContainer (Leaflet)
│
└── module-panel-container (Right sidebar)
    └── module-panel
        ├── module-header
        │   ├── module-header h2
        │   └── module-icon
        └── module-content
            └── [Module-specific classes]
                ├── module-section
                │   └── module-section h3
                ├── stat-item
                │   ├── stat-label
                │   ├── stat-value
                │   └── stat-bar
                │       └── stat-fill
                ├── control-group
                │   ├── label
                │   └── slider
                └── legend-item
                    ├── legend-color
                    └── [text]
```

## CSS Responsive Breakpoints

```
Desktop (1200px+)
├── module-selector: 200px
├── map-center: flex 1
└── module-panel-container: 300px

Tablet (768px - 1199px)
├── module-selector: 160px
├── map-center: flex 1
└── module-panel-container: 250px

Mobile (<768px)
├── module-selector: 100% height (60px with flex-row)
├── map-center: flex 1
└── module-panel-container: 100% height (200px)
```

## Module Data Props Example

```javascript
// ModulePanel passes this data to each module component:
const moduleData = {
  percentage: clearcutPercent,    // null or number
  opacity: rasterOpacity,         // 0-1
  // Add more as needed:
  // selectedArea: {...},
  // historicalData: [...],
  // thresholds: {...}
};

// Module receives it:
function MyModule({ data }) {
  const { percentage, opacity } = data;
  // Use data to render UI
}
```

## Event Communication

```
Module Component
        ↓
Custom Event: 'opacityChange'
        ↓
window.dispatchEvent(new CustomEvent('opacityChange', {
  detail: { opacity: 0.7 }
}))
        ↓
App.js Event Listener
        ↓
Updates rasterOpacity state
        ↓
RasterTileLayer re-renders with new opacity
```

## Color Theme

```
Primary Elements
├── Primary Blue: #1976d2 (buttons, accents)
├── Light Blue: #2196f3 (hover states)
└── Very Light Blue: #e3f2fd (selected state)

Backgrounds & Surfaces
├── White: #ffffff (main background)
├── Light Gray: #f9f9f9 (secondary panels)
└── Very Light Gray: #f5f5f5 (hover backgrounds)

Borders & Dividers
├── Border: #e0e0e0 (main dividers)
└── Light Border: #ccc (secondary)

Text
├── Primary Text: #333 (main text)
├── Secondary Text: #666 (labels)
└── Muted Text: #999 (placeholder)

Semantic Colors
├── Success/Forest: #4CAF50
├── Alert/Clearcut: #ff0000 (red)
└── Water: #87CEEB (sky blue)
```

## File Organization

```
src/
├── components/               ← React components
│   ├── ModulePanel.jsx
│   ├── ModuleSelector.jsx
│   ├── TopMenu.jsx
│   ├── Menu.jsx (legacy)
│   └── ...
│
├── modules/                 ← Analysis modules
│   ├── ClearcutDetection.jsx
│   ├── ModuleTemplate.jsx
│   └── README.md
│
├── styles/                  ← CSS files
│   ├── layout.css           ← MAIN LAYOUT STYLES
│   ├── map.css
│   ├── topmenu.css
│   └── menu.css
│
├── utils/
│   ├── mapUtils.js
│   └── ...
│
└── App.js                   ← Main app component + MODULES array
```

---

This visual guide helps understand how all pieces fit together!
