import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { extractMapAction, actionToFeatures, availableRegionIds } from '../utils/mapActions';
import { finderCoverage } from '../utils/cogFinder';
import StoryMapGenerator from './StoryMapGenerator';

function renderContent(text) {
  return text.split(/\*\*(.*?)\*\*/gs).map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : part
  );
}

const SUGGESTIONS = [
  'What does this clearcut data tell us?',
  'How does this year compare to historical averages?',
  'What are the ecological impacts of this clearcut rate?',
  'What actions can forest managers take?',
];

function buildContext(moduleData, selectedModule, selectedYear, selectedFMUs, selectedSensor, drawingContext, availableRegions, highlightCoverage) {
  return {
    // Which FMUs each highlight layer covers (cogs/manifest.json), so the
    // assistant can pick a region that has the data instead of refusing
    highlightCoverage: highlightCoverage || undefined,
    module: selectedModule?.name || 'Clearcut Detection',
    region: selectedFMUs?.length ? selectedFMUs.join(', ') : 'All regions',
    year: selectedYear,
    sensor: selectedSensor,
    // View-level percentage from the raster tally in the current map viewport,
    // not a statistic clipped to the user-drawn geometry.
    clearcut: moduleData?.percentage ?? null,
    // Every layer currently switched on, so "what's in here" can speak to all
    // of them rather than only the module in front.
    activeLayers: moduleData?.activeLayerSummary?.length
      ? moduleData.activeLayerSummary
      : undefined,
    // The regions whose boundaries are loaded -- the only ones the assistant can
    // outline, so it can be told rather than left to guess and be refused.
    availableRegions,
    // Only the populated bins: an all-zero histogram means the biomass tiles
    // haven't been tallied for this view, and sending twelve zeroes invites the
    // model to describe an absence of data as a finding.
    biomass: moduleData?.biomassHistogram?.some((b) => b.area > 0)
      ? moduleData.biomassHistogram
          .filter((b) => b.area > 0)
          .map((b) => ({ range: b.label, areaHa: Math.round(b.area) }))
      : undefined,
    // Omitted entirely when nothing is drawn, so the prompt doesn't carry an
    // empty section the model might try to reason about.
    drawing: drawingContext || undefined,
    drawingStats: moduleData?.drawingStats || { clearcutInDrawnAreaAvailable: false },
  };
}

function ForestryAIAgent({
  moduleData, selectedModule, selectedYear, selectedFMUs, selectedSensor,
  drawingContext, pendingPrompt, onPromptConsumed, onProposeFeatures, regionsData,
  onOpenStoryMaps,
}) {
  const { token } = useAuth();
  const [storyOpen, setStoryOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);
  // Holds the latest send(). The effect below must not depend on send()'s
  // identity, which changes every render and would re-fire the prompt.
  const sendRef = useRef(null);
  // Resolved once from the province-wide overview, so the assistant is told the
  // full list of FMUs it can outline rather than only those on screen.
  const [availableRegions, setAvailableRegions] = useState([]);

  useEffect(() => {
    let cancelled = false;
    availableRegionIds(regionsData).then((ids) => {
      if (!cancelled) setAvailableRegions(ids);
    });
    return () => { cancelled = true; };
  }, [regionsData]);

  const [highlightCoverage, setHighlightCoverage] = useState(null);
  useEffect(() => {
    let cancelled = false;
    finderCoverage().then((cov) => { if (!cancelled) setHighlightCoverage(cov); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // A question handed in from outside -- the map's "Ask AI" button. Consumed
  // before sending so a re-render can't fire it twice.
  useEffect(() => {
    if (!pendingPrompt || loading) return;
    if (onPromptConsumed) onPromptConsumed();
    sendRef.current?.(pendingPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt]);

  const context = buildContext(
    moduleData, selectedModule, selectedYear, selectedFMUs, selectedSensor, drawingContext,
    availableRegions, highlightCoverage);

  // Assigned on every render so the ref always points at the current closure.
  sendRef.current = send;

  async function send(text) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setError(null);

    const outgoing = [...messages, { role: 'user', content: trimmed }];
    setMessages(outgoing);
    setInput('');
    setLoading(true);

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers,
        // The assistant's own turns go back with their map-action block and
        // what became of it (apiContent): shown stripped, they taught it that
        // it had never drawn anything, and it stopped including the block
        body: JSON.stringify({
          messages: outgoing.map((m) => ({ role: m.role, content: m.apiContent || m.content })),
          context,
        }),
      });

      let data;
      try {
        data = await res.json();
      } catch {
        if (res.status === 502 || res.status === 504) {
          throw new Error('API backend is unreachable (proxy 502/504). Start the Node server on port 3001 and retry.');
        }
        throw new Error(`Server error (${res.status}) — check backend logs`);
      }
      if (!res.ok) {
        if (res.status === 502 || res.status === 504) {
          throw new Error('API backend is unreachable (proxy 502/504). Start the Node server on port 3001 and retry.');
        }
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      // Geometry the model proposed rides in a fenced block. Strip it from the
      // prose either way -- raw JSON in the transcript helps nobody -- and only
      // draw what survives validation.
      const extracted = extractMapAction(data.content);
      const { action } = extracted;
      // "[app: ...]" notes are history for the assistant only; drop any it
      // copied into its own prose
      const text = extracted.text.replace(/^\s*\[app:[^\]\n]*\]\s*$/gim, '').replace(/\n{3,}/g, '\n\n').trim();
      let note = '';
      // What became of the reply's map action, for the next turn's history
      let outcome = '';
      // Straight or curly apostrophe: models write "I’ll" as often as "I'll"
      if (!action && /\b(i['’]?ll|i will|let me|i['’]?m going to)\b[^.]{0,60}\b(highlight|outline|zoom|show)\b/i.test(text)) {
        // Promised a highlight in prose but sent no action: say so, here and
        // to the assistant, rather than leave an empty map unexplained
        note += '\n\n_(no map action was included in this reply, so nothing was drawn — ask again to retry)_';
        outcome = '[app: this reply included no map-action block, so nothing was drawn]';
      }
      if (action && onProposeFeatures) {
        // Finders without a region or year use the FMUs and year on the map;
        // alert finders read the alerts the app has already loaded
        const { features, rejected } = await actionToFeatures(action, {
          regions: selectedFMUs || [],
          year: selectedYear,
          alerts: moduleData?.alerts?.all || [],
        });
        // Success needs no note: the shapes are on the map, and the model has
        // already said in prose what it drew.
        if (features.length) {
          onProposeFeatures(features);
          outcome = `[app: map action drew ${features.length} shape(s) and zoomed to them]`;
        }
        if (rejected) {
          // Surfaced rather than swallowed: a proposal that silently fails to
          // appear reads as a broken map.
          note += `\n\n_(map action ${rejected})_`;
          outcome = `[app: map action ${rejected}]`;
        }
      }
      setMessages([...outgoing, {
        role: 'assistant',
        content: text + note,
        // Sent back next turn: the reply as written, with its map-action block
        apiContent: outcome ? `${data.content}\n\n${outcome}` : data.content,
      }]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  // What the story map is about: the map as it stands. The server looks up the
  // numbers itself; this only says which FMUs, year, layers and drawn area.
  const storyContext = {
    regions: selectedFMUs || [],
    year: selectedYear,
    moduleId: selectedModule?.id,
    module: selectedModule?.name || selectedModule?.id,
    activeLayers: moduleData?.activeLayerSummary,
    drawing: drawingContext || undefined,
    // The story map draws clearcuts from the same sources, and hides the same
    // low-confidence AI detections, as the map does now
    clearcutSources: moduleData?.clearcutSources,
    aiMinConfidence: moduleData?.aiStatus?.minConfidence,
  };

  return (
    <div className="ai-panel">
      <button type="button" className="ai-story-btn" onClick={() => setStoryOpen(true)}>
        <span aria-hidden="true">📰</span> Create story map
      </button>
      <StoryMapGenerator
        isOpen={storyOpen}
        onClose={() => setStoryOpen(false)}
        context={storyContext}
        onOpenLibrary={() => { setStoryOpen(false); onOpenStoryMaps?.(); }}
      />
      <div className="ai-messages">
        {messages.length === 0 && !loading && (
          <div className="ai-empty">
            <p>Ask about the current clearcut visualization.</p>
            <div className="ai-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="ai-suggestion-btn" onClick={() => send(s)} type="button">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`ai-message ai-message--${msg.role}`}>
            <div className="ai-message-bubble">{renderContent(msg.content)}</div>
          </div>
        ))}

        {loading && (
          <div className="ai-message ai-message--assistant">
            <div className="ai-message-bubble ai-typing">
              <span /><span /><span />
            </div>
          </div>
        )}

        {error && <div className="ai-error">{error}</div>}
        <div ref={messagesEndRef} />
      </div>

      <div className="ai-input-area">
        <textarea
          className="ai-textarea"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about the forest data… (Enter to send)"
          rows={2}
          disabled={loading}
        />
        <button
          className="ai-send-btn"
          onClick={() => send(input)}
          disabled={!input.trim() || loading}
          type="button"
        >
          Send
        </button>
      </div>
    </div>
  );
}

export default ForestryAIAgent;
