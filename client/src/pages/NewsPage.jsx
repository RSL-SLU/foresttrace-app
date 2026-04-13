import '../styles/infopage.css';

const NEWS_ITEMS = [
  {
    date: 'April 2025',
    badge: 'Platform Update',
    title: 'Planet Imagery Integration',
    body: 'High-resolution Planet imagery is now available for the 2025 dataset, providing sub-10 m clearcut detection alongside the existing HLS time series.',
  },
  {
    date: 'December2025',
    badge: 'Presentation',
    title: 'ForestTrace at AGU 2025',
    body: 'Our paper "Boreal Forest Regrowth Stage Classification Using Multi-Sensor Remote Sensing and Machine Learning" was presented at the AGU Fall Meeting 2025, showcasing our latest methods for characterizing post-clearcut regrowth dynamics.',
  },
  {
    date: 'November 2025',
    badge: 'Platform Launch',
    title: 'ForestTrace Goes Public',
    body: 'The ForestTrace web platform was officially launched, making boreal forest monitoring data accessible through an interactive map interface.',
  },
  {
    date: 'January 2025',
    badge: 'Dataset',
    title: '2024 Clearcut Season Released',
    body: 'Annual clearcut detection results for the 2024 growing season have been processed and added to the platform, extending the time series to ten years.',
  },
  {
    date: 'September 2024',
    badge: 'Partnership',
    title: 'Collaboration with Private Donor Secured',
    body: 'ForestTrace has secured funding for the year of 2025 from a private donor to support ongoing platform development and data processing efforts, ensuring sustainability and continued updates.',
  }
];

function NewsPage({ onBack }) {
  return (
    <div className="infopage">
      <div className="infopage-inner">
        <button className="infopage-back" onClick={onBack}>← Back to Map</button>

        <p className="infopage-tag">News</p>
        <h1 className="infopage-title">Latest Updates</h1>
        <p className="infopage-lead">
          Recent developments in the ForestTrace platform, datasets, and research partnerships.
        </p>

        <hr className="infopage-divider" />

        {NEWS_ITEMS.map(({ date, badge, title, body }) => (
          <div className="infopage-section" key={title}>
            <span className="infopage-badge">{badge}</span>
            <h2 style={{ marginTop: 0 }}>{title}</h2>
            <p style={{ fontSize: 12, color: '#888', marginBottom: 8, marginTop: -8 }}>{date}</p>
            <p>{body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default NewsPage;
