import '../styles/infopage.css';

const SECTIONS = [
  {
    title: 'Clearcut Detection',
    items: [
      { term: 'Data source', def: 'Harmonized Landsat and Sentinel-2 (HLS) time series; Planet imagery for 2025.' },
      { term: 'Spatial resolution', def: '30 m (HLS) · ~3 m (Planet).' },
      { term: 'Temporal range', def: '2015–2025 (annual).' },
      { term: 'Detection method', def: 'Spectral change detection identifying pixels with significant reflectance shifts indicative of forest removal.' },
      { term: 'Output', def: 'Binary clearcut mask per year, stored as raster tiles (TMS/XYZ scheme, zoom 6–14).' },
    ],
  },
  {
    title: 'Biomass Estimation',
    items: [
      { term: 'Data source', def: 'SAR (Synthetic Aperture Radar) and optical imagery fusion.' },
      { term: 'Variable', def: 'Above-Ground Biomass (AGB) in Mg/ha.' },
      { term: 'Spatial resolution', def: '30 m.' },
      { term: 'Method', def: 'Machine-learning regression calibrated against field plots and airborne LiDAR.' },
    ],
  },
  {
    title: 'Tile Architecture',
    items: [
      { term: 'Format', def: 'PNG tiles following the XYZ tile scheme.' },
      { term: 'Zoom levels', def: '6 – 14.' },
      { term: 'Hosting', def: 'Tiles served from Cloudflare R2 via a public bucket URL.' },
      { term: 'Sensor subfolders', def: 'For years with multiple sensors (e.g. 2025), tiles are stored under hls/ or planet/ subfolders within the year directory.' },
    ],
  },
  {
    title: 'Area Statistics',
    items: [
      { term: 'Zoom level', def: 'Statistics computed at zoom 12 for consistency across all years.' },
      { term: 'Pixel size at zoom 12', def: '≈ 38.2 m at the equator; adjusted by cos(latitude) for the Wabigoon area (≈ 50°N).' },
      { term: 'Threshold', def: 'Pixels with red channel > 200 and green < 100 are classified as clearcut.' },
      { term: 'Caching', def: 'Results are cached per region + sensor combination within the browser session.' },
    ],
  },
];

function DocumentationPage({ onBack }) {
  return (
    <div className="infopage">
      <div className="infopage-inner">
        <button className="infopage-back" onClick={onBack}>← Back to Map</button>

        <p className="infopage-tag">Documentation</p>
        <h1 className="infopage-title">Technical Documentation</h1>
        <p className="infopage-lead">
          Details on datasets, processing methods, tile architecture, and statistical
          approaches used in the ForestTrace platform.
        </p>

        <hr className="infopage-divider" />

        {SECTIONS.map(({ title, items }) => (
          <div className="infopage-section" key={title}>
            <h2>{title}</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {items.map(({ term, def }) => (
                  <tr key={term} style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                    <td style={{ padding: '10px 16px 10px 0', fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', verticalAlign: 'top', width: '30%' }}>
                      {term}
                    </td>
                    <td style={{ padding: '10px 0', fontSize: 14, lineHeight: 1.65, color: '#555' }}>
                      {def}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        <div className="infopage-section">
          <h2>Coordinate Reference System</h2>
          <p>
            All spatial data is served in Web Mercator (EPSG:3857) for map tile compatibility.
            Area calculations account for the latitude-dependent pixel size distortion.
          </p>
        </div>

        <div className="infopage-section">
          <h2>Open Source</h2>
          <div className="infopage-callout">
            <p>
              ForestTrace is built with React, Leaflet, Recharts, and react-leaflet. Processing
              pipelines use Python with rasterio, GDAL, and Google Earth Engine. Source code
              availability will be announced alongside the associated publication.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DocumentationPage;
