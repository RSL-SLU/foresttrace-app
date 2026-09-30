import { useEffect, useState } from 'react';
import '../styles/infopage.css';
import { useNews } from '../utils/news';

// Posts live in src/content/news/ as markdown -- see the README there.
function NewsPage({ onBack, initialSlug = null }) {
  const posts = useNews();
  const [openSlug, setOpenSlug] = useState(initialSlug);

  // Opening a post from the landing page while this page is already mounted
  useEffect(() => {
    setOpenSlug(initialSlug);
  }, [initialSlug]);

  const openPost = openSlug ? posts.find((p) => p.slug === openSlug) : null;

  if (openPost) {
    return (
      <div className="infopage">
        <div className="infopage-inner">
          <button className="infopage-back" onClick={() => setOpenSlug(null)}>← All News</button>

          <span className="infopage-badge">{openPost.tag}</span>
          <h1 className="infopage-title">{openPost.title}</h1>
          <p className="news-date">{openPost.dateLabel}</p>

          <hr className="infopage-divider" />

          {/* Authored in the repo (src/content/news), not user input */}
          <div className="news-body" dangerouslySetInnerHTML={{ __html: openPost.html }} />
        </div>
      </div>
    );
  }

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

        {posts.map(({ slug, tag, title, dateLabel, summary }) => (
          <div className="infopage-section" key={slug}>
            <span className="infopage-badge">{tag}</span>
            <h2 style={{ marginTop: 0 }}>{title}</h2>
            <p className="news-date">{dateLabel}</p>
            <p>{summary}</p>
            <button className="news-read-more" onClick={() => setOpenSlug(slug)}>
              Read more →
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default NewsPage;
