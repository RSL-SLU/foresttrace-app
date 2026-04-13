import '../styles/infopage.css';

const PUBLICATIONS = [
  {
    year: 'In preparation',
    authors: 'RSL Team',
    title: 'ForestTrace: An Interactive Platform for Boreal Forest Disturbance Monitoring Using Multi-Source Satellite Data',
    journal: 'Remote Sensing of Environment (forthcoming)',
    doi: null,
  },
];

function PublicationPage({ onBack }) {
  return (
    <div className="infopage">
      <div className="infopage-inner">
        <button className="infopage-back" onClick={onBack}>← Back to Map</button>

        <p className="infopage-tag">Publications</p>
        <h1 className="infopage-title">Research &amp; Publications</h1>
        <p className="infopage-lead">
          Peer-reviewed work and technical reports associated with the ForestTrace project
          and the Remote Sensing Lab at Saint Louis University.
        </p>

        <hr className="infopage-divider" />

        <div className="infopage-section">
          <h2>Journal Articles</h2>
          {PUBLICATIONS.map(({ year, authors, title, journal, doi }) => (
            <div className="infopage-card" key={title} style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 12, color: '#888', margin: '0 0 6px' }}>{year} · {journal}</p>
              <h3 style={{ marginBottom: 6 }}>{title}</h3>
              <p style={{ margin: 0 }}>{authors}</p>
              {doi && (
                <p style={{ margin: '6px 0 0', fontSize: 13 }}>
                  <a href={doi} target="_blank" rel="noopener noreferrer" style={{ color: '#1976d2' }}>
                    {doi}
                  </a>
                </p>
              )}
            </div>
          ))}
        </div>

        <div className="infopage-section">
          <h2>Data &amp; Software</h2>
          <p>
            Datasets and processing scripts associated with ForestTrace analyses will be
            made available through public repositories upon publication. Please check back
            for updates or contact the lab directly.
          </p>
        </div>

        <div className="infopage-section">
          <h2>Citing ForestTrace</h2>
          <div className="infopage-callout">
            <p>
              If you use ForestTrace data or visualizations in your work, please cite the
              associated publication once available, or acknowledge the Remote Sensing Lab
              at Saint Louis University.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PublicationPage;
