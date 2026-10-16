import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { generateStoryMap, openStoryMap } from '../utils/storymaps';
import '../styles/admin.css';
import '../styles/storymaps.css';

// FMUs that can have a story over a range of years (one FMU at a time), and
// the years each has data for. Mirrors RANGE_STORY_YEARS in api/_storyFacts.js.
const RANGE_STORY_YEARS = {
  wabigoon: [2010, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025],
  troutlake: [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025],
};

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
  const [period, setPeriod] = useState('year');   // year | range
  const [rangeFrom, setRangeFrom] = useState(null);
  const [rangeTo, setRangeTo] = useState(null);

  useEffect(() => {
    if (status !== 'working') return undefined;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [status]);

  if (!isOpen) return null;

  const regions = context?.regions || [];
  const rangeYears = regions.length === 1 ? RANGE_STORY_YEARS[regions[0]] : null;
  const isRange = Boolean(rangeYears) && period === 'range';
  // Defaults: the FMU's first year through the year on the map
  const to = rangeTo ?? (rangeYears?.includes(context?.year) && context.year !== rangeYears[0]
    ? context.year : rangeYears?.[rangeYears.length - 1]);
  const from = rangeFrom ?? rangeYears?.[0];
  const rangeValid = isRange && from < to;

  async function generate() {
    setStatus('working');
    setElapsed(0);
    setError(null);
    const storyContext = isRange ? { ...context, yearRange: [from, to] } : context;
    try {
      setStory(await generateStoryMap(token, { context: storyContext, angle: angle.trim(), audience }));
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
                reporter to edit. Without an angle it is built instantly from ForestTrace data, with every
                figure taken straight from the datasets. Add an angle to have AI write it around your
                question instead; check AI-written figures before publication.
              </p>
              <dl className="story-context">
                <dt>Area</dt>
                <dd>{regions.length ? regions.map((r) => r.replace(/_/g, ' ')).join(', ') : 'No FMU selected'}</dd>
                <dt>{([...new Set((context?.activeLayers || []).map((l) => l.module).filter(Boolean))].length > 1) ? 'Modules' : 'Module'}</dt>
                <dd>
                  {[...new Set((context?.activeLayers || []).map((l) => l.module).filter(Boolean))].join(', ')
                    || context?.module
                    || 'Clearcut Detection'}
                </dd>
                {Array.isArray(context?.activeLayers) && context.activeLayers.length > 1 && (
                  <>
                    <dt>Layers</dt>
                    <dd>{context.activeLayers.map((l) => l.layer || l.layerId).filter(Boolean).join(', ')}</dd>
                  </>
                )}
                <dt>{isRange ? 'Period' : 'Year'}</dt><dd>{isRange ? `${from}–${to}` : (context?.year ?? '—')}</dd>
                {context?.drawing?.shapes?.length > 0 && (<><dt>Drawn area</dt><dd>Included</dd></>)}
              </dl>

              <p className="story-year-note">
                {isRange
                  ? <>The story covers <strong>{from}–{to}</strong>: charts are trimmed to that period and the map draws every year in it.</>
                  : <>The story is built for <strong>{context?.year ?? 'the selected year'}</strong>, the year selected on the map. To write about another year, change it on the map timeline first.</>}
              </p>

              {rangeYears && (
                <>
                  <span className="story-label">Period</span>
                  <div className="story-audiences" role="radiogroup" aria-label="Period">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={!isRange}
                      className={`story-chip${!isRange ? ' story-chip--active' : ''}`}
                      onClick={() => setPeriod('year')}
                    >
                      Selected year ({context?.year ?? '—'})
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={isRange}
                      className={`story-chip${isRange ? ' story-chip--active' : ''}`}
                      onClick={() => setPeriod('range')}
                    >
                      Year range
                    </button>
                  </div>
                  {isRange && (
                    <div className="story-range">
                      <label htmlFor="story-range-from">From</label>
                      <select id="story-range-from" value={from} onChange={(e) => setRangeFrom(Number(e.target.value))}>
                        {rangeYears.filter((y) => y < to).map((y) => <option key={y} value={y}>{y}</option>)}
                      </select>
                      <label htmlFor="story-range-to">to</label>
                      <select id="story-range-to" value={to} onChange={(e) => setRangeTo(Number(e.target.value))}>
                        {rangeYears.filter((y) => y > from).map((y) => <option key={y} value={y}>{y}</option>)}
                      </select>
                    </div>
                  )}
                </>
              )}

              <label className="story-label" htmlFor="story-angle">Angle (optional — uses AI)</label>
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
                <button type="button" className="story-primary" onClick={generate} disabled={!regions.length || (isRange && !rangeValid)}>
                  {angle.trim() ? 'Write with AI' : 'Build story map'}
                </button>
              </div>
            </>
          )}

          {status === 'working' && (
            <div className="story-progress" role="status">
              <div className="story-spinner" aria-hidden="true" />
              <p><strong>{angle.trim() ? 'Writing your story…' : 'Building your story…'}</strong></p>
              <p className="story-muted">
                {angle.trim()
                  ? `AI is drafting the text around your angle; this usually takes under a minute. (${elapsed}s)`
                  : `Gathering the data and laying out the story. (${elapsed}s)`}
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
