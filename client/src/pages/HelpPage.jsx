import '../styles/infopage.css';

const STEPS = [
  { title: 'Select a Module', desc: 'Use the left sidebar to choose between Clearcut Detection, Biomass Estimation, or other available analyses.' },
  { title: 'Choose a Year', desc: 'Use the year slider or input in the module panel to navigate across the temporal range of the dataset.' },
  { title: 'Toggle Layers', desc: 'Enable or disable individual map layers using the layer controls in the left panel.' },
  { title: 'Select a Region', desc: 'Filter statistics and tiles to a specific Forest Management Unit (FMU) using the region selector.' },
  { title: 'Explore the Chart', desc: 'The right panel displays per-year area statistics. Hover over bars to see exact values.' },
  { title: 'Switch Sensors', desc: 'For supported years, toggle between HLS (Landsat/Sentinel-2) and Planet imagery using the sensor selector.' },
];

function HelpPage({ onBack }) {
  return (
    <div className="infopage">
      <div className="infopage-inner">
        <button className="infopage-back" onClick={onBack}>← Back to Map</button>

        <p className="infopage-tag">Help</p>
        <h1 className="infopage-title">Using ForestTrace</h1>
        <p className="infopage-lead">
          A quick guide to navigating the ForestTrace platform and getting the most out of
          the map, layers, and analysis tools.
        </p>

        <hr className="infopage-divider" />

        <div className="infopage-section">
          <h2>Getting Started</h2>
          <div className="infopage-cards">
            {STEPS.map(({ title, desc }) => (
              <div className="infopage-card" key={title}>
                <h3>{title}</h3>
                <p>{desc}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="infopage-section">
          <h2>Map Controls</h2>
          <ul>
            <li><strong>Zoom:</strong> Use the scroll wheel or the +/− buttons on the map.</li>
            <li><strong>Pan:</strong> Click and drag to move the map.</li>
            <li><strong>Search:</strong> Type a place name in the search bar at the top of the map to navigate to that location.</li>
            <li><strong>Locate me:</strong> Click the locate button to center the map on your current position.</li>
          </ul>
        </div>

        <div className="infopage-section">
          <h2>Understanding the Statistics</h2>
          <p>
            The bar chart shows the estimated clearcut area (in hectares) per year within the
            selected region. Values are computed by counting red-flagged pixels in the raster
            tiles at zoom level 12, scaled by the ground resolution at that zoom.
          </p>
          <p>
            Note that percentage coverage is viewport-dependent and may differ from the
            fixed-grid hectare totals shown in the chart.
          </p>
        </div>

        <div className="infopage-section">
          <h2>Browser Requirements</h2>
          <ul>
            <li>Modern desktop browser: Chrome, Firefox, Edge, or Safari (latest versions).</li>
            <li>Minimum screen width: 1024 px. The application is not optimized for mobile devices.</li>
            <li>JavaScript must be enabled.</li>
          </ul>
        </div>

        <div className="infopage-section">
          <h2>Need More Help?</h2>
          <div className="infopage-callout">
            <p>
              If you encounter an issue or have a question not covered here, please contact the
              Remote Sensing Lab at Saint Louis University.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default HelpPage;
