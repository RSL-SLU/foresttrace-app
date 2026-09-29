import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import '../styles/admin.css';

const MODULE_LABELS = {
  clearcut: 'Clearcut Detection',
  biomass: 'Forest Biomass',
  wildfire: 'Wildfire Tracking',
  caribou: 'Wildlife & Caribou',
};

function AdminDashboard({ isOpen, onClose }) {
  const { token, user } = useAuth();
  const [activeTab, setActiveTab] = useState('users');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionInProgress, setActionInProgress] = useState(null);

  const fetchOverview = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin?action=overview', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to load administration overview');
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (isOpen) {
      fetchOverview();
    }
  }, [isOpen, fetchOverview]);

  if (!isOpen) return null;

  async function handleToggleUserRole(targetUser) {
    const newRole = targetUser.role === 'admin' ? 'user' : 'admin';
    const confirmMsg = targetUser.role === 'admin'
      ? `Demote ${targetUser.email} from Administrator to standard User?`
      : `Promote ${targetUser.email} to Administrator?`;

    if (!window.confirm(confirmMsg)) return;

    setActionInProgress(targetUser.id);
    try {
      const res = await fetch('/api/admin', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'update-user-role',
          targetUserId: targetUser.id,
          newRole,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to update user role');
      }

      await fetchOverview();
    } catch (err) {
      alert(`Error updating role: ${err.message}`);
    } finally {
      setActionInProgress(null);
    }
  }

  async function handleUpdateReportStatus(reportId, newStatus) {
    setActionInProgress(reportId);
    try {
      const res = await fetch('/api/admin', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'update-report',
          reportId,
          status: newStatus,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to update report status');
      }

      await fetchOverview();
    } catch (err) {
      alert(`Error updating report: ${err.message}`);
    } finally {
      setActionInProgress(null);
    }
  }

  const usersList = data?.users || [];
  const reportsList = data?.reports || [];
  const openReportsCount = reportsList.filter((r) => r.status === 'open').length;
  const moduleActivations = data?.moduleActivations || [];
  const totalModuleUses = moduleActivations.reduce((acc, m) => acc + (m.count || 0), 0);

  return (
    <div className="admin-modal-backdrop" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-header">
          <h2>
            <span>⚙️</span> ForestTrace Admin Dashboard
          </h2>
          <button
            className="auth-close-btn"
            type="button"
            onClick={onClose}
            aria-label="Close admin dashboard"
          >
            &times;
          </button>
        </div>

        <div className="admin-nav-tabs">
          <button
            type="button"
            className={`admin-nav-tab ${activeTab === 'users' ? 'admin-nav-tab--active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            Users ({usersList.length})
          </button>
          <button
            type="button"
            className={`admin-nav-tab ${activeTab === 'modules' ? 'admin-nav-tab--active' : ''}`}
            onClick={() => setActiveTab('modules')}
          >
            Module Activations
          </button>
          <button
            type="button"
            className={`admin-nav-tab ${activeTab === 'reports' ? 'admin-nav-tab--active' : ''}`}
            onClick={() => setActiveTab('reports')}
          >
            Bug Reports {openReportsCount > 0 ? `(${openReportsCount} open)` : `(${reportsList.length})`}
          </button>
          <button
            type="button"
            className={`admin-nav-tab ${activeTab === 'vercel' ? 'admin-nav-tab--active' : ''}`}
            onClick={() => setActiveTab('vercel')}
          >
            Vercel Analytics ↗
          </button>
        </div>

        <div className="admin-body">
          {loading && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#64748b' }}>
              Loading administration metrics…
            </div>
          )}

          {error && !loading && (
            <div className="auth-error-box" style={{ marginBottom: 16 }}>
              {error}
            </div>
          )}

          {!loading && !error && (
            <>
              {/* TAB 1: USERS */}
              {activeTab === 'users' && (
                <div>
                  <div className="admin-stats-grid">
                    <div className="admin-stat-card">
                      <span>Total Users</span>
                      <strong>{usersList.length}</strong>
                    </div>
                    <div className="admin-stat-card">
                      <span>Administrators</span>
                      <strong>{usersList.filter((u) => u.role === 'admin').length}</strong>
                    </div>
                    <div className="admin-stat-card">
                      <span>Standard Users</span>
                      <strong>{usersList.filter((u) => u.role !== 'admin').length}</strong>
                    </div>
                  </div>

                  <div className="admin-table-container">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Email</th>
                          <th>Role</th>
                          <th>Registered</th>
                          <th>Last Active</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usersList.map((u) => {
                          const isSelf = u.id === user?.id;
                          return (
                            <tr key={u.id}>
                              <td><strong>{u.name}</strong></td>
                              <td>{u.email}</td>
                              <td>
                                <span className={`admin-role-badge admin-role-badge--${u.role}`}>
                                  {u.role}
                                </span>
                              </td>
                              <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                              <td>{u.lastActiveAt ? new Date(u.lastActiveAt).toLocaleDateString() : '—'}</td>
                              <td>
                                <button
                                  type="button"
                                  className="admin-action-btn"
                                  disabled={isSelf || actionInProgress === u.id}
                                  onClick={() => handleToggleUserRole(u)}
                                  title={isSelf ? 'Cannot change your own role' : `Switch to ${u.role === 'admin' ? 'user' : 'admin'}`}
                                >
                                  {actionInProgress === u.id
                                    ? 'Updating…'
                                    : (u.role === 'admin' ? 'Demote to User' : 'Promote to Admin')}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 2: MODULE ANALYTICS */}
              {activeTab === 'modules' && (
                <div>
                  <div className="admin-stats-grid">
                    <div className="admin-stat-card">
                      <span>Total Activations</span>
                      <strong>{totalModuleUses}</strong>
                    </div>
                    <div className="admin-stat-card">
                      <span>AI Chat Queries</span>
                      <strong>{data?.totalChats || 0}</strong>
                    </div>
                    <div className="admin-stat-card">
                      <span>Tracked Modules</span>
                      <strong>{moduleActivations.length}</strong>
                    </div>
                  </div>

                  <div className="admin-table-container">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Module</th>
                          <th>Identifier</th>
                          <th>Activations</th>
                          <th>Last Used</th>
                        </tr>
                      </thead>
                      <tbody>
                        {moduleActivations.length === 0 ? (
                          <tr>
                            <td colSpan="4" style={{ textAlign: 'center', color: '#64748b' }}>
                              No module activations recorded yet.
                            </td>
                          </tr>
                        ) : (
                          moduleActivations.map((m) => (
                            <tr key={m.moduleId}>
                              <td><strong>{MODULE_LABELS[m.moduleId] || m.moduleId}</strong></td>
                              <td><code>{m.moduleId}</code></td>
                              <td><strong>{m.count}</strong></td>
                              <td>{m.lastUsed ? new Date(m.lastUsed).toLocaleString() : '—'}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 3: BUG REPORTS */}
              {activeTab === 'reports' && (
                <div>
                  <div className="admin-stats-grid">
                    <div className="admin-stat-card">
                      <span>Total Reports</span>
                      <strong>{reportsList.length}</strong>
                    </div>
                    <div className="admin-stat-card">
                      <span>Open Issues</span>
                      <strong style={{ color: openReportsCount > 0 ? '#ef4444' : 'inherit' }}>
                        {openReportsCount}
                      </strong>
                    </div>
                    <div className="admin-stat-card">
                      <span>Resolved</span>
                      <strong>{reportsList.filter((r) => r.status === 'resolved').length}</strong>
                    </div>
                  </div>

                  {reportsList.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '30px 0', color: '#64748b' }}>
                      No bug reports submitted yet.
                    </div>
                  ) : (
                    <div className="admin-reports-list">
                      {reportsList.map((r) => (
                        <div key={r.id} className="admin-report-card">
                          <div className="admin-report-header">
                            <h3 className="admin-report-title">{r.title}</h3>
                            <span className={`admin-report-status admin-report-status--${r.status}`}>
                              {r.status}
                            </span>
                          </div>
                          <p className="admin-report-desc">{r.description}</p>
                          <div className="admin-report-meta">
                            <span>Reported by: <strong>{r.userEmail || 'Anonymous'}</strong></span>
                            <span>Date: {new Date(r.createdAt).toLocaleString()}</span>
                            {r.context?.module && (
                              <span>Module: <code>{r.context.module}</code></span>
                            )}
                            {r.context?.year && (
                              <span>Year: <code>{r.context.year}</code></span>
                            )}
                            {r.context?.fmus && r.context.fmus.length > 0 && (
                              <span>FMUs: <code>{r.context.fmus.join(', ')}</code></span>
                            )}
                            <div style={{ marginLeft: 'auto' }}>
                              <button
                                type="button"
                                className="admin-action-btn"
                                disabled={actionInProgress === r.id}
                                onClick={() => handleUpdateReportStatus(r.id, r.status === 'open' ? 'resolved' : 'open')}
                              >
                                {actionInProgress === r.id
                                  ? 'Saving…'
                                  : (r.status === 'open' ? '✓ Mark as Resolved' : '↺ Reopen Issue')}
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 4: VERCEL ANALYTICS */}
              {activeTab === 'vercel' && (
                <div className="vercel-analytics-card">
                  <div style={{ fontSize: 36 }}>📊</div>
                  <h3 style={{ margin: '0 0 4px', fontSize: 18 }}>Vercel Web Analytics & Speed Insights</h3>
                  <p style={{ margin: '0 0 16px', maxWidth: 480, fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
                    View real-time visitor traffic, page views, geographic distribution, top referrers, and Core Web Vitals performance metrics directly in the Vercel workspace.
                  </p>
                  <a
                    href={data?.vercelAnalyticsUrl || 'https://vercel.com/rsl7/foresttrace/analytics'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="vercel-btn"
                  >
                    Open Vercel Analytics Dashboard ↗
                  </a>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default AdminDashboard;

