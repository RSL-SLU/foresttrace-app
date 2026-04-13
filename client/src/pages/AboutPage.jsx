import '../styles/infopage.css';

function AboutPage({ onBack }) {
  return (
    <div className="infopage">
      <div className="infopage-inner">
        <button className="infopage-back" onClick={onBack}>← Back to Map</button>

        <p className="infopage-tag">About</p>
        <h1 className="infopage-title">Remote Sensing Lab · Saint Louis University</h1>
        <p className="infopage-lead">
          ForestTrace is a research platform developed by the Remote Sensing Lab (RSL) at
          Saint Louis University to support boreal forest monitoring in northwestern Ontario.
        </p>

        <hr className="infopage-divider" />

        <div className="infopage-section">
          <h2>The Lab</h2>
          <p>
            The <strong>Remote Sensing Lab (RSL)</strong> at Saint Louis University is a research
            group focused on the development and application of satellite remote sensing techniques
            for environmental monitoring and natural resource management.
          </p>
          <p>
            Our work integrates multi-source satellite data — including Landsat, Sentinel-2, SAR,
            and commercial high-resolution imagery — to characterize forest structure, disturbance
            dynamics, and carbon cycles at regional scales.
          </p>
        </div>

        <div className="infopage-section">
          <h2>The Platform</h2>
          <p>
            ForestTrace provides an interactive web-based map for exploring annual clearcut events,
            biomass distributions, and multi-sensor satellite analyses across the Wabigoon Forest
            Management Unit (FMU) in Ontario, Canada.
          </p>
          <p>
            The platform supports Indigenous-led forest stewardship and evidence-based land
            management decisions in the boreal region of northwestern Ontario.
          </p>
        </div>

        <div className="infopage-section">
          <h2>Partners</h2>
          <div className="infopage-cards">
            {[
              { name: 'Wabigoon Lake Ojibway Nation', desc: 'Indigenous partner supporting community-led forest stewardship and land monitoring.' },
              { name: 'Ontario Ministry of Natural Resources', desc: 'Provincial agency providing forest management data and regulatory context.' },
              { name: 'Planet Labs', desc: 'Commercial satellite provider supplying high-resolution imagery for recent-year analyses.' },
              { name: 'NASA Earthdata', desc: 'Source of HLS (Harmonized Landsat and Sentinel-2) time-series data.' },
            ].map(({ name, desc }) => (
              <div className="infopage-card" key={name}>
                <h3>{name}</h3>
                <p>{desc}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="infopage-section">
          <h2>Contact</h2>
          <div className="infopage-callout">
            <p>
              For research inquiries or collaboration opportunities, please reach out through
              Saint Louis University's Remote Sensing Lab. Details available on the SLU
              departmental website.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AboutPage;
