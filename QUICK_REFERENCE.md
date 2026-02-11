# ForestTrace - Quick Reference Guide

## 🎯 What Changed?

Your app now has a **3-column layout** that's easy to extend with new modules!

```
┌─────────────────────────────────────┐
│      Header (ForestTrace)           │
├────────┬──────────────┬─────────────┤
│Modules │              │ Module Info │
│Selector│     Map      │ & Stats     │
│        │              │             │
└────────┴──────────────┴─────────────┘
```

## 📁 What's New?

**New Components:**
- `ModuleSelector.jsx` - Left sidebar
- `ModulePanel.jsx` - Right sidebar

**New Module System:**
- `ClearcutDetection.jsx` - Your clearcut detection as a module
- `ModuleTemplate.jsx` - Template for new modules

**New Styles:**
- `layout.css` - All 3-column layout styles

**Documentation:**
- `IMPLEMENTATION_GUIDE.md` - How to add modules
- `ARCHITECTURE_VISUAL.md` - Visual diagrams
- `LAYOUT_SUMMARY.md` - Overview
- `CHANGELOG.md` - All changes
- `README.md` - Module development guide

---

## 🚀 Quick Start: Add a New Module

### Step 1: Create Module
Create `src/modules/YourModuleName.jsx`:
```jsx
import React from 'react';

function YourModuleName({ data }) {
  return (
    <div className="your-module">
      <div className="module-section">
        <h3>Your Title</h3>
        {/* Your content */}
      </div>
    </div>
  );
}

export default YourModuleName;
```

### Step 2: Import
In `App.js`, add at top:
```jsx
import YourModuleName from './modules/YourModuleName';
```

### Step 3: Register
In `App.js`, add to `MODULES` array:
```jsx
{
  id: 'your-id',
  name: 'Your Module Name',
  icon: '📊',
  description: 'What it does',
  component: YourModuleName,
}
```

**Done!** Your module appears in the left sidebar.

---

## 🎨 CSS Classes for Styling

Use these classes in your modules:

**Sections:**
```jsx
<div className="module-section">
  <h3>Title</h3>
  {/* content */}
</div>
```

**Statistics:**
```jsx
<div className="stat-item">
  <div className="stat-label">Label</div>
  <div className="stat-value">42%</div>
  <div className="stat-bar">
    <div className="stat-fill" style={{ width: '42%' }}></div>
  </div>
</div>
```

**Controls:**
```jsx
<div className="control-group">
  <label>Option</label>
  <input type="range" className="slider" />
</div>
```

**Legend:**
```jsx
<div className="legend-item">
  <span className="legend-color red"></span>
  <span>Label</span>
</div>
```

---

## 🎨 Colors to Use

```
Primary Blue:      #1976d2
Light Blue:        #2196f3
White:             #ffffff
Light Gray:        #f9f9f9
Border Gray:       #e0e0e0
Text Dark:         #333
Text Light:        #666
Red Alert:         #ff0000
```

---

## 📊 Module Data Props

Your module receives `data` with:
```javascript
{
  percentage: number,  // Clearcut percentage
  opacity: number,     // Overlay opacity
}
```

To update opacity:
```jsx
const handleOpacityChange = (value) => {
  window.dispatchEvent(new CustomEvent('opacityChange', {
    detail: { opacity: value }
  }));
};
```

---

## 📁 Key Files

| File | Purpose |
|------|---------|
| `App.js` | Main app + module registration |
| `styles/layout.css` | Layout styles |
| `components/ModuleSelector.jsx` | Left sidebar |
| `components/ModulePanel.jsx` | Right sidebar |
| `modules/ClearcutDetection.jsx` | Example module |
| `modules/ModuleTemplate.jsx` | Template for new modules |

---

## 🔧 File Sizes

| File | Lines | New/Modified |
|------|-------|--------------|
| App.js | 243 | Modified |
| layout.css | 347 | New |
| ModuleSelector.jsx | 51 | New |
| ModulePanel.jsx | 27 | New |
| ClearcutDetection.jsx | 71 | New |
| ModuleTemplate.jsx | 38 | New |

**Total New/Modified Code:** ~780 lines

---

## ✅ Testing Checklist

Before adding a new module:
- [ ] Module file created in `src/modules/`
- [ ] Component exports correctly
- [ ] Imported in `App.js`
- [ ] Added to `MODULES` array
- [ ] All required fields in module object:
  - `id` (unique string)
  - `name` (display name)
  - `icon` (emoji)
  - `description` (short text)
  - `component` (React component)

---

## 📱 Responsive Layout

- **Desktop** (1200px+): Full 3-column
- **Tablet** (768-1199px): Adjusted widths
- **Mobile** (<768px): Stacked layout

The layout automatically adapts - no changes needed!

---

## 🎯 Common Tasks

### Change Left Sidebar Width
Edit `layout.css`:
```css
.module-selector {
  width: 200px;  /* Change this */
}
```

### Change Right Sidebar Width
Edit `layout.css`:
```css
.module-panel-container {
  width: 300px;  /* Change this */
}
```

### Change Primary Color
Edit `layout.css` and replace `#1976d2` with your color.

### Hide Module Panel
Add to module-panel-container:
```css
display: none;
```

### Add More Space Between Sections
Edit in `layout.css`:
```css
.module-section {
  margin-bottom: 16px;  /* Increase this */
}
```

---

## 🐛 Troubleshooting

**Module doesn't appear?**
- Check id, name, icon, description, component all exist
- Verify import statement is correct
- Ensure component is exported as default

**Styling looks off?**
- Use the provided CSS classes
- Don't override `.layout-container` or `.map-center`
- Follow the color palette

**Map not visible?**
- Check map-center width is set to flex: 1
- Verify map height is 100%
- Check z-index isn't blocking interaction

**Module text gets cut off?**
- Use `.module-section` for containers
- Add padding/margin with classes
- Check max-width on containers

---

## 📚 Documentation Links

- **Quick Start**: IMPLEMENTATION_GUIDE.md
- **Visual Diagrams**: ARCHITECTURE_VISUAL.md
- **Overview**: LAYOUT_SUMMARY.md
- **Module Development**: src/modules/README.md
- **All Changes**: CHANGELOG.md

---

## 💡 Pro Tips

1. **Use emojis for icons** - Makes modules visually distinct
2. **Keep descriptions short** - Shows as tooltips
3. **Reuse CSS classes** - Faster, consistent styling
4. **Test on mobile** - Responsive design matters
5. **Add comments** - Help future developers
6. **One module active** - Users see one at a time

---

## 🎯 Next Steps

1. Read `IMPLEMENTATION_GUIDE.md` (5 min)
2. Create a test module using `ModuleTemplate.jsx`
3. Register it in `App.js`
4. Test it in the browser
5. Build your actual modules!

---

**Questions?** Check the detailed guides in the docs folder!
