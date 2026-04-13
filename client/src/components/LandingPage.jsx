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

const TEAM_MEMBERS = [
  'Dr. Vasit Sagan (Principal Investigator)',
  'Dr. Derek Tesser (Senior Research Scientist)',
  'Dr. Felipe Lopes (AI Research Scientist)',
  'Nuerbiye Muhetaer (PhD Student)',
  'Mustafizur Rahaman (PhD Student)',
];

const PARTNERS = [
  {
    name: 'Natural Resources Defense Council (NRDC)',
    desc: 'Science, policy, law, and advocacy support for climate, public lands, and communities.',
  },
  {
    name: 'Wahkohtowin',
    desc: 'First Nations social enterprise supporting rights, culture, and stewardship across shared territories.',
  },
  {
    name: 'Planet Labs',
    desc: 'High-resolution commercial satellite imagery for recent-year forest monitoring.',
  },
  {
    name: 'NASA Earthdata',
    desc: 'Provider of HLS time-series products used for annual and multi-year analyses.',
  },
];

const NEWS_ITEMS = [
  {
    date: 'April 2025',
    badge: 'Platform Update',
    title: 'Planet Imagery Integration',
    body: 'High-resolution Planet imagery is now available for the 2025 dataset, providing sub-10 m clearcut detection alongside the existing HLS time series.',
  },
  {
    date: 'December 2025',
    badge: 'Presentation',
    title: 'ForestTrace at AGU 2025',
    body: 'Our paper "Boreal Forest Regrowth Stage Classification Using Multi-Sensor Remote Sensing and Machine Learning" was presented at AGU Fall Meeting 2025, highlighting recent methods for post-clearcut regrowth characterization.',
  },
  {
    date: 'November 2025',
    badge: 'Platform Launch',
    title: 'ForestTrace Goes Public',
    body: 'The ForestTrace web platform was officially launched, making boreal forest monitoring data accessible through an interactive map interface.',
  },
];

function LandingPage({ onEnter, onOpenAbout, onOpenNews, onOpenDocumentation }) {
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
        <button className="landing-section-button" onClick={onOpenDocumentation}>
          Open Full Documentation
        </button>
      </section>

      {/* ── About ────────────────────────────────────────── */}
      <section className="landing-section">
        <p className="landing-section-title">About</p>
        <h2 className="landing-section-heading">Team and Institution</h2>
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
          </div>
          <div>
            <p className="landing-section-title" style={{ marginBottom: 16 }}>
              Current Team Members
            </p>
            <ul className="landing-team-list">
              {TEAM_MEMBERS.map((member) => (
                <li key={member}>{member}</li>
              ))}
            </ul>

            <p className="landing-section-title" style={{ marginBottom: 16, marginTop: 24 }}>
              Current Partners
            </p>
            <div className="landing-partners">
              {PARTNERS.map(({ name, desc }) => (
                <div className="landing-partner-badge" key={name}>
                  <strong>{name}</strong>
                  <span>{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <button className="landing-section-button" onClick={onOpenAbout}>
          Read Full About Page
        </button>
      </section>

      {/* ── News ─────────────────────────────────────────── */}
      <section className="landing-section">
        <p className="landing-section-title">News</p>
        <h2 className="landing-section-heading">Latest Updates</h2>
        <div className="landing-cards">
          {NEWS_ITEMS.map(({ date, badge, title, body }) => (
            <article className="landing-card" key={title}>
              <p className="landing-news-meta">{badge} · {date}</p>
              <h3 className="landing-card-title">{title}</h3>
              <p className="landing-card-text">{body}</p>
            </article>
          ))}
        </div>
        <button className="landing-section-button" onClick={onOpenNews}>
          View All News
        </button>
      </section>

      {/* ── Contact ──────────────────────────────────────── */}
      <section className="landing-section landing-contact-section">
        <p className="landing-section-title">Contact</p>
        <h2 className="landing-section-heading">Get in Touch</h2>
        <p className="landing-about-text" style={{ marginBottom: 12 }}>
          For research inquiries and collaboration opportunities, contact Dr. Vasit Sagan.
        </p>
        <a className="landing-contact-link" href="mailto:vasit.sagan@slu.edu">
          vasit.sagan@slu.edu
        </a>
      </section>

      {/* ── Footer ───────────────────────────────────────── */}
      <footer className="landing-footer">
        © {new Date().getFullYear()} Remote Sensing Lab · Saint Louis University
      </footer>

    </div>
  );
}

export default LandingPage;
