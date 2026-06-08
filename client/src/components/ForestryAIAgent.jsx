import { useState, useRef, useEffect } from 'react';

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

function buildContext(moduleData, selectedModule, selectedYear, selectedFMUs, selectedSensor) {
  return {
    module: selectedModule?.name || 'Clearcut Detection',
    region: selectedFMUs?.length ? selectedFMUs.join(', ') : 'All regions',
    year: selectedYear,
    sensor: selectedSensor,
    clearcut: moduleData?.percentage ?? null,
  };
}

function ForestryAIAgent({ moduleData, selectedModule, selectedYear, selectedFMUs, selectedSensor }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const context = buildContext(moduleData, selectedModule, selectedYear, selectedFMUs, selectedSensor);
  const hasClearcut = context.clearcut !== null && context.clearcut !== undefined;

  async function send(text) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setError(null);

    const outgoing = [...messages, { role: 'user', content: trimmed }];
    setMessages(outgoing);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: outgoing, context }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setMessages([...outgoing, { role: 'assistant', content: data.content }]);
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

  return (
    <div className="ai-panel">
      <div className="ai-context-bar">
        {context.region && <span className="ai-ctx-chip">{context.region}</span>}
        {context.year && <span className="ai-ctx-chip">{context.year}</span>}
        {context.sensor && <span className="ai-ctx-chip">{context.sensor}</span>}
        {hasClearcut && (
          <span className="ai-ctx-chip ai-ctx-chip--clearcut">
            {Number(context.clearcut).toFixed(1)}% cleared
          </span>
        )}
      </div>

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
