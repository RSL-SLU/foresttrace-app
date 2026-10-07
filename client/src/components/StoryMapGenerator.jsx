import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { generateStoryMap, openStoryMap } from '../utils/storymaps';
import '../styles/admin.css';
import '../styles/storymaps.css';

const AUDIENCES = [
  { value: 'news', label: 'News article' },
  { value: 'explainer', label: 'Explainer' },
  { value: 'brief', label: 'Brief for editors' },
];

/**
 * "Create story map" dialog, opened from the Forestry AI Agent. Sends what the
 * map is showing (FMUs, year, layers, drawn area) plus the author's angle;
 * the server gathers the actual numbers itself (api/_storyFacts.js).
 */
function StoryMapGenerator({ isOpen, onClose, context, onOpenLibrary }) {
  const { token } = useAuth();
  const [angle, setAngle] = useState('');
  const [audience, setAudience] = useState('news');
  const [status, setStatus] = useState('idle');   // idle | working | done | error
  const [elapsed, setElapsed] = useState(0);
  const [story, setStory] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (status !== 'working') return undefined;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [status]);

  if (!isOpen) return null;

  const regions = context?.regions || [];

  async function generate() {
    setStatus('working');
    setElapsed(0);
    setError(null);
    try {
      setStory(await generateStoryMap(token, { context, angle: angle.trim(), audience }));
      setStatus('done');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }

  function reset() {
    setStatus('idle');
    setStory(null);
    setError(null);
  }

  function close() {
    if (status === 'working') return;   // the request keeps running; don't hide it
    reset();
    onClose();
  }

  return (
    <div className="admin-modal-backdrop" onClick={close}>
      <div className="admin-modal story-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-header">
          <h2><span>📰</span> Create a story map</h2>
          <button className="auth-close-btn" type="button" onClick={close} aria-label="Close dialog" disabled={status === 'working'}>
            &times;
          </button>
        </div>

        <div className="admin-body">
          {(status === 'idle' || status === 'error') && (
            <>
              <p className="story-intro">
                Turns what’s on the map into a scrolling story with charts and a guided map, ready for a
                reporter to edit. Figures come from ForestTrace data; the text is written by AI and should
                be checked before publication.
              </p>
              <dl className="story-context">
                <dt>Area</dt>
                <dd>{regions.length ? regions.map((r) => r.replace(/_/g, ' ')).join(', ') : 'No FMU selected'}</dd>
                <dt>Year</dt><dd>{context?.year ?? '—'}</dd>
                {context?.drawing?.shapes?.length > 0 && (<><dt>Drawn area</dt><dd>Included</dd></>)}
              </dl>

              <label className="story-label" htmlFor="story-angle">Angle (optional)</label>
              <textarea
                id="story-angle"
                className="story-textarea"
                rows={3}
                maxLength={1000}
                placeholder="e.g. Is clearcutting in Wabigoon speeding up or slowing down?"
                value={angle}
                onChange={(e) => setAngle(e.target.value)}
              />

              <span className="story-label">Format</span>
              <div className="story-audiences" role="radiogroup" aria-label="Format">
                {AUDIENCES.map((a) => (
                  <button
                    key={a.value}
                    type="button"
                    role="radio"
                    aria-checked={audience === a.value}
                    className={`story-chip${audience === a.value ? ' story-chip--active' : ''}`}
                    onClick={() => setAudience(a.value)}
                  >
                    {a.label}
                  </button>
                ))}
              </div>

              {error && <div className="auth-error-box" style={{ marginTop: 14 }}>{error}</div>}

              <div className="story-actions">
                <button type="button" className="story-link" onClick={onOpenLibrary}>My story maps</button>
                <button type="button" className="story-primary" onClick={generate} disabled={!regions.length}>
                  Generate story map
                </button>
              </div>
            </>
          )}

          {status === 'working' && (
            <div className="story-progress" role="status">
              <div className="story-spinner" aria-hidden="true" />
              <p><strong>Writing your story…</strong></p>
              <p className="story-muted">
                Gathering the data and drafting the text usually takes one to two minutes. ({elapsed}s)
              </p>
            </div>
          )}

          {status === 'done' && story && (
            <div className="story-done">
              <p className="story-muted">Saved to My story maps (private).</p>
              <h3>{story.title}</h3>
              <p>{story.dek}</p>
              {story.reviewNotes?.length > 0 && (
                <div className="story-review">
                  <strong>Double-check these figures:</strong> {story.reviewNotes.join(', ')}.
                  {' '}They don’t match a value in the data exactly; they may be the model’s own rounding or
                  arithmetic.
                </div>
              )}
              <div className="story-actions">
                <button type="button" className="story-link" onClick={reset}>Create another</button>
                <button type="button" className="story-link" onClick={onOpenLibrary}>My story maps</button>
                <button
                  type="button"
                  className="story-primary"
                  onClick={() => openStoryMap(token, story.id).catch((err) => setError(err.message))}
                >
                  Open story map
                </button>
              </div>
              {error && <div className="auth-error-box" style={{ marginTop: 14 }}>{error}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default StoryMapGenerator;
