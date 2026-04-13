import '../styles/landing.css';

const METHODS = [
  {
    icon: '🪓',
    title: 'Clearcut Detection',
    text: 'Annual deforestation mapping using multi-source satellite imagery, tracking clearcut events across the Wabigoon Forest Management Unit from 2015 to present.',
  },
  {
    icon: '🌿',
    title: 'Biomass Estimation',
    text: 'Above-Ground Biomass (AGB) mapping derived from SAR and optical data, providing spatial estimates of carbon stocks across boreal forest landscapes.',
  },
  {
    icon: '🛰️',
    title: 'HLS Imagery',
    text: 'Harmonized Landsat and Sentinel-2 (HLS) time-series data providing 30 m resolution observations at high revisit frequency for consistent annual analyses.',
  },
  {
    icon: '🌍',
    title: 'Planet Imagery',
    text: 'High-resolution Planet imagery enabling sub-10 m monitoring of forest disturbances, offering finer spatial detail for recent-year clearcut validation.',
  },
];

const PARTNERS = [
  'Wabigoon Lake Ojibway Nation',
  'Ontario Ministry of Natural Resources',
  'Planet Labs',
  'NASA Earthdata',
];

function LandingPage({ onEnter }) {
  return (
    <div className="landing">

      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="landing-hero">
        <img
          src="/rsl-logo-transparent.png"
          alt="Remote Sensing Lab"
          className="landing-logo"
        />
        <p className="landing-subtitle">Remote Sensing Lab · Saint Louis University</p>
        <h1 className="landing-title">ForestTrace</h1>
        <p className="landing-description">
          An interactive platform for monitoring boreal forest dynamics in
          northern Ontario. Explore annual clearcut events, biomass distributions,
          and multi-sensor satellite analyses through an integrated web-based map.
        </p>
        <button className="landing-cta" onClick={onEnter}>
          Launch Application
          <span className="landing-cta-arrow">→</span>
        </button>
      </section>

      {/* ── Methods ──────────────────────────────────────── */}
      <section className="landing-section">
        <p className="landing-section-title">Methodology</p>
        <h2 className="landing-section-heading">Remote Sensing Approaches</h2>
        <div className="landing-cards">
          {METHODS.map(({ icon, title, text }) => (
            <div className="landing-card" key={title}>
              <span className="landing-card-icon">{icon}</span>
              <h3 className="landing-card-title">{title}</h3>
              <p className="landing-card-text">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── About ────────────────────────────────────────── */}
      <section className="landing-section">
        <p className="landing-section-title">About</p>
        <h2 className="landing-section-heading">Team &amp; Institution</h2>
        <div className="landing-about">
          <div>
            <p className="landing-about-text">
              ForestTrace is developed by the{' '}
              <strong>Remote Sensing Lab (RSL)</strong> at{' '}
              <strong>Saint Louis University</strong>, a research group focused
              on the development and application of satellite remote sensing
              techniques for environmental monitoring and natural resource
              management.
            </p>
            <p className="landing-about-text">
              Our work integrates multi-source satellite data — including
              Landsat, Sentinel-2, SAR, and commercial high-resolution imagery
              — to characterize forest structure, disturbance dynamics, and
              carbon cycles at regional scales.
            </p>
            <p className="landing-about-text">
              This platform supports Indigenous-led forest stewardship and
              evidence-based land management decisions in the boreal region of
              northwestern Ontario, Canada.
            </p>
            <img
              src="/rsl-logo-transparent.png"
              alt="RSL · Saint Louis University"
              className="landing-uni-logo"
            />
          </div>
          <div>
            <p className="landing-section-title" style={{ marginBottom: 16 }}>
              Current Partners
            </p>
            <div className="landing-partners">
              {PARTNERS.map((name) => (
                <div className="landing-partner-badge" key={name}>{name}</div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────── */}
      <footer className="landing-footer">
        © {new Date().getFullYear()} Remote Sensing Lab · Saint Louis University
      </footer>

    </div>
  );
}

export default LandingPage;
