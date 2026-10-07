import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  listStoryMaps, setStoryMapPublic, deleteStoryMap, openStoryMap, publicStoryUrl,
} from '../utils/storymaps';
import '../styles/admin.css';
import '../styles/storymaps.css';

/** "My story maps": the signed-in user's story maps, with sharing controls. */
function StoryMapsModal({ isOpen, onClose }) {
  const { token } = useAuth();
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setStories(await listStoryMaps(token));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (isOpen) load();
  }, [isOpen, load]);

  if (!isOpen) return null;

  async function togglePublic(story) {
    try {
      const updated = await setStoryMapPublic(token, story.id, !story.isPublic);
      setStories((prev) => prev.map((s) => (s.id === story.id ? updated : s)));
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(story) {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete "${story.title}"? Its public link, if any, will stop working.`)) return;
    try {
      await deleteStoryMap(token, story.id);
      setStories((prev) => prev.filter((s) => s.id !== story.id));
    } catch (err) {
      setError(err.message);
    }
  }

  async function copyLink(story) {
    try {
      await navigator.clipboard.writeText(publicStoryUrl(story.slug));
      setCopied(story.id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError('Couldn’t copy the link. Open the story and copy the address instead.');
    }
  }

  return (
    <div className="admin-modal-backdrop" onClick={onClose}>
      <div className="admin-modal story-modal story-modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="admin-header">
          <h2><span>📰</span> My story maps</h2>
          <button className="auth-close-btn" type="button" onClick={onClose} aria-label="Close dialog">&times;</button>
        </div>

        <div className="admin-body">
          {loading && <p className="story-muted" style={{ textAlign: 'center', padding: 32 }}>Loading your story maps…</p>}
          {error && <div className="auth-error-box" style={{ marginBottom: 16 }}>{error}</div>}

          {!loading && !error && stories.length === 0 && (
            <div className="story-empty">
              <div style={{ fontSize: 40 }}>📰</div>
              <h3>No story maps yet</h3>
              <p>Open the Forestry AI Agent tab on the map and choose “Create story map”.</p>
            </div>
          )}

          <ul className="story-list">
            {stories.map((s) => (
              <li key={s.id} className="story-item">
                <div className="story-item-main">
                  <h3>{s.title}</h3>
                  <p>{s.dek}</p>
                  <p className="story-muted">
                    {new Date(s.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                    {s.regions?.length ? ` · ${s.regions.map((r) => r.replace(/_/g, ' ')).join(', ')}` : ''}
                    {s.year ? ` · ${s.year}` : ''}
                  </p>
                  {s.reviewNotes?.length > 0 && (
                    <p className="story-review story-review--small">Double-check: {s.reviewNotes.join(', ')}</p>
                  )}
                </div>
                <div className="story-item-actions">
                  <button type="button" className="story-primary" onClick={() => openStoryMap(token, s.id).catch((err) => setError(err.message))}>
                    Open
                  </button>
                  <label className="story-toggle">
                    <input type="checkbox" checked={s.isPublic} onChange={() => togglePublic(s)} />
                    Public link
                  </label>
                  {s.isPublic && (
                    <button type="button" className="story-link" onClick={() => copyLink(s)}>
                      {copied === s.id ? 'Link copied' : 'Copy link'}
                    </button>
                  )}
                  <button type="button" className="story-link story-link--danger" onClick={() => remove(s)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default StoryMapsModal;
