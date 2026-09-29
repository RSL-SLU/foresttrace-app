import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import '../styles/admin.css';

function UserChatHistoryModal({ isOpen, onClose }) {
  const { token } = useAuth();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchHistory = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/chat', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to load chat history');
      }
      const data = await res.json();
      setHistory(data.history || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (isOpen) {
      fetchHistory();
    }
  }, [isOpen, fetchHistory]);

  if (!isOpen) return null;

  return (
    <div className="admin-modal-backdrop" onClick={onClose}>
      <div className="admin-modal" style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
        <div className="admin-header">
          <h2>
            <span>💬</span> My AI Chat Inquiries
          </h2>
          <button
            className="auth-close-btn"
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            &times;
          </button>
        </div>

        <div className="admin-body">
          {loading && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#64748b' }}>
              Loading your previous conversations…
            </div>
          )}

          {error && !loading && (
            <div className="auth-error-box" style={{ marginBottom: 16 }}>
              {error}
            </div>
          )}

          {!loading && !error && history.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#64748b' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🌲</div>
              <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>No Conversations Yet</h3>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, maxWidth: 440, marginLeft: 'auto', marginRight: 'auto' }}>
                When you ask questions to the Forestry AI Assistant in the map sidebar, your queries and ecological analyses will be saved here.
              </p>
            </div>
          )}

          {!loading && !error && history.length > 0 && (
            <div className="chat-history-list">
              {history.map((item) => (
                <div key={item.id} className="chat-history-item">
                  <div className="chat-history-q">
                    👤 Q: {item.message}
                  </div>
                  {item.response && (
                    <div className="chat-history-a">
                      <strong>🤖 AI Analysis:</strong>
                      <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>
                        {item.response}
                      </div>
                    </div>
                  )}
                  <div className="chat-history-meta">
                    <span>🕒 {new Date(item.timestamp).toLocaleString()}</span>
                    {item.context?.module && (
                      <span>Module: <code>{item.context.module}</code></span>
                    )}
                    {item.context?.year && (
                      <span>Year: <code>{item.context.year}</code></span>
                    )}
                    {item.context?.fmus && item.context.fmus.length > 0 && (
                      <span>FMU: <code>{item.context.fmus.join(', ')}</code></span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default UserChatHistoryModal;

