import '../styles/infopage.css';

const NEWS_ITEMS = [
  {
    date: 'April 2025',
    badge: 'Platform Update',
    title: 'Planet Imagery Integration',
    body: 'High-resolution Planet imagery is now available for the 2025 dataset, providing sub-10 m clearcut detection alongside the existing HLS time series.',
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
    title: 'Collaboration with Wabigoon Lake Ojibway Nation',
    body: 'ForestTrace expanded its partnership with Wabigoon Lake Ojibway Nation to co-develop monitoring protocols aligned with Indigenous land stewardship priorities.',
  },
  {
    date: 'March 2024',
    badge: 'Platform Launch',
    title: 'ForestTrace Goes Public',
    body: 'The ForestTrace web platform was officially launched, making boreal forest monitoring data accessible through an interactive map interface.',
  },
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
