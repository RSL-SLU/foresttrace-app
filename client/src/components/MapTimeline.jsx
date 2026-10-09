import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Year timeline across the bottom of the map, with playback.
 *
 * Lives over the map rather than in the module panel because the year applies
 * to what is *drawn*, not to the module being read: it belongs with the thing it
 * changes, and it stays reachable while the panel shows a chart or the AI agent.
 *
 * Ticks are positioned by index, not by year, so the gap between 2010 and 2015
 * does not stretch a quarter of the track across years that have no data. That
 * makes the axis non-linear in time, which is the right trade for a record with
 * a five-year hole in it -- every stop is a year you can actually select.
 */

// Target display time per frame during playback.
const FRAME_MS = 1500;

// Maximum wait before advancing, preventing cold caches, sparse data, or 404s
// from freezing playback.
const MAX_WAIT_MS = 3000;

function MapTimeline({
  years, selectedYear, onYearChange, onPlayingChange,
  loading = false, disabled = false,
}) {
  const [playing, setPlaying] = useState(false);
  // The tick the pointer is over, so the label can preview it without the map
  // reloading on the way past.
  const [hoverIndex, setHoverIndex] = useState(null);

  const index = Math.max(0, years.indexOf(selectedYear));
  const onYearChangeRef = useRef(onYearChange);
  onYearChangeRef.current = onYearChange;

  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  const restartingRef = useRef(false);
  const frameStartTimeRef = useRef(Date.now());

  // Lifted so the map can buffer upcoming years only while playing -- rendering
  // three years' worth of sources during ordinary browsing would triple the
  // requests for no benefit.
  const onPlayingChangeRef = useRef(onPlayingChange);
  onPlayingChangeRef.current = onPlayingChange;
  useEffect(() => { onPlayingChangeRef.current?.(playing); }, [playing]);

  // Keep track of when a new frame begins
  useEffect(() => {
    frameStartTimeRef.current = Date.now();
  }, [index]);

  // Playback advancement with steady cadence
  useEffect(() => {
    if (!playing) return undefined;

    if (index >= years.length - 1) {
      if (restartingRef.current) {
        // Just requested wrap-around to start; wait for index prop update to 0
        return undefined;
      }
      setPlaying(false);
      return undefined;
    }
    restartingRef.current = false;

    let advanced = false;
    const advance = () => {
      if (advanced) return;
      advanced = true;
      const nextIdx = index + 1;
      if (nextIdx < years.length) {
        onYearChangeRef.current(years[nextIdx]);
      }
    };

    // If tiles are already cached or finish within FRAME_MS, advance at FRAME_MS.
    const minTimer = setTimeout(() => {
      if (!loadingRef.current) {
        advance();
      }
    }, FRAME_MS);

    // Hard ceiling: advance even if network requests linger
    const maxTimer = setTimeout(advance, MAX_WAIT_MS);

    return () => {
      clearTimeout(minTimer);
      clearTimeout(maxTimer);
    };
  }, [playing, index, years]);

  // If tiles finish loading after FRAME_MS has already elapsed, advance promptly
  useEffect(() => {
    if (!playing || loading || index >= years.length - 1) return;
    const elapsed = Date.now() - frameStartTimeRef.current;
    if (elapsed >= FRAME_MS) {
      const nextIdx = index + 1;
      if (nextIdx < years.length) {
        onYearChangeRef.current(years[nextIdx]);
      }
    }
  }, [loading, playing, index, years]);

  useEffect(() => {
    if (disabled) setPlaying(false);
  }, [disabled]);

  const togglePlay = useCallback(() => {
    setPlaying((was) => {
      if (was) return false;
      // Restart from the beginning when parked on the last year, so the button
      // never appears to do nothing.
      if (index >= years.length - 1) {
        restartingRef.current = true;
        onYearChangeRef.current(years[0]);
      }
      return true;
    });
  }, [index, years]);

  const step = useCallback((delta) => {
    setPlaying(false);
    const next = Math.min(years.length - 1, Math.max(0, index + delta));
    if (next !== index) onYearChangeRef.current(years[next]);
  }, [index, years]);

  const handleTrackClick = useCallback((e) => {
    if (disabled) return;
    if (e.target.closest('.timeline-tick')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const targetIdx = Math.round(ratio * (years.length - 1));
    if (targetIdx >= 0 && targetIdx < years.length) {
      setPlaying(false);
      onYearChangeRef.current(years[targetIdx]);
    }
  }, [disabled, years]);

  if (!years?.length) return null;

  const waiting = playing && loading;
  const progress = years.length > 1 ? (index / (years.length - 1)) * 100 : 0;

  return (
    <div className="map-timeline" role="group" aria-label="Year timeline">
      <button
        type="button"
        className="timeline-btn"
        onClick={() => step(-1)}
        disabled={disabled || index === 0}
        title="Previous year"
        aria-label="Previous year"
      >
        {'◀'}
      </button>

      <button
        type="button"
        className="timeline-btn timeline-btn--play"
        onClick={togglePlay}
        disabled={disabled}
        title={waiting ? 'Waiting for tiles…' : (playing ? 'Pause' : 'Play through the years')}
        aria-label={waiting ? 'Waiting for tiles' : (playing ? 'Pause' : 'Play through the years')}
      >
        {waiting
          ? <span className="loading-spinner loading-spinner--tiny" aria-hidden="true" />
          : (playing ? '⏸' : '▶')}
      </button>

      <button
        type="button"
        className="timeline-btn"
        onClick={() => step(1)}
        disabled={disabled || index >= years.length - 1}
        title="Next year"
        aria-label="Next year"
      >
        {'▶'}
      </button>

      <span
        className="timeline-bound-year timeline-bound-year--min"
        onClick={() => { setPlaying(false); onYearChange(years[0]); }}
        title={`Jump to ${years[0]}`}
      >
        {years[0]}
      </span>

      <div
        className="timeline-track"
        onClick={handleTrackClick}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <div className="timeline-fill" style={{ width: `${progress}%` }} />

        {/* A tick per year, both as the visible scale and as the primary hit target */}
        {years.map((year, i) => {
          const isActive = i === index;
          const isPassed = i < index;
          const isHovered = i === hoverIndex;
          return (
            <button
              key={year}
              type="button"
              className={`timeline-tick${isActive ? ' timeline-tick--active' : ''}${isPassed ? ' timeline-tick--passed' : ''}`}
              style={{ left: `${years.length > 1 ? (i / (years.length - 1)) * 100 : 50}%` }}
              onClick={(e) => {
                e.stopPropagation();
                setPlaying(false);
                onYearChange(year);
              }}
              onMouseEnter={() => setHoverIndex(i)}
              disabled={disabled}
              title={String(year)}
              aria-label={String(year)}
              aria-current={isActive}
            >
              {isActive && (
                <span className="timeline-tick-bubble">
                  {year}
                </span>
              )}
              {isHovered && !isActive && (
                <span className="timeline-tick-bubble timeline-tick-bubble--hover">
                  {year}
                </span>
              )}
            </button>
          );
        })}

        {/* The range input sits underneath the ticks for keyboard and drag access */}
        <input
          type="range"
          className="timeline-range"
          min={0}
          max={years.length - 1}
          value={index}
          disabled={disabled}
          onChange={(e) => {
            setPlaying(false);
            onYearChange(years[parseInt(e.target.value, 10)]);
          }}
          aria-label="Year"
        />
      </div>

      {years.length > 1 && (
        <span
          className="timeline-bound-year timeline-bound-year--max"
          onClick={() => { setPlaying(false); onYearChange(years[years.length - 1]); }}
          title={`Jump to ${years[years.length - 1]}`}
        >
          {years[years.length - 1]}
        </span>
      )}
    </div>
  );
}

export default MapTimeline;
