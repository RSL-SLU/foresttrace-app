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
          <h2>Current Team Members</h2>
          <ul>
            <li>Dr. Vasit Sagan (Principal Investigator)</li>
            <li>Dr. Derek Tesser (Senior Research Scientist)</li>
            <li>Dr. Felipe Lopes (AI Research Scientist)</li>
            <li>Nuerbiye Muhetaer (PhD Student)</li>
            <li>Mustafizur Rahaman (PhD Student)</li>
          </ul>
        </div>

        <div className="infopage-section">
          <h2>Partners</h2>
          <div className="infopage-cards">
            {[
              { name: 'Natural Resources Defense Council (NRDC)', desc: 'NRDC brings together science, policy, law, and people power to tackle the climate crisis, defend public lands and wildlife, and protect the health of our communities.' },
              { name: 'Wahkohtowin', desc: 'Connecting First Nations in culture, practice, and purpose. A social enterprise of First Nations actively upholding our rights for the benefit of our shared traditional territories, communities, and livelihood.' },
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
              For research inquiries or collaboration opportunities, please reach out to
              Dr. Vasit Sagan (<a href='mailto:vasit.sagan@slu.edu'>vasit.sagan@slu.edu</a>).
              Dr. Sagan is a professor at Saint Louis University and the supervisor of the Remote Sensing Lab.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AboutPage;
