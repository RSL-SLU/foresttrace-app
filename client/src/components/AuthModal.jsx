import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import '../styles/auth.css';

function AuthModal() {
  const {
    authModalOpen,
    closeAuthModal,
    authModalMode,
    setAuthModalMode,
    isInitialized,
    login,
    register,
    bootstrapAdmin,
  } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');

  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // If the database has no admin user, default to bootstrap mode
  const isBootstrap = !isInitialized || authModalMode === 'bootstrap';
  const isRegister = !isBootstrap && authModalMode === 'register';

  // Clear the error whenever the modal opens or switches mode
  useEffect(() => {
    setError(null);
  }, [authModalMode, authModalOpen]);

  if (!authModalOpen) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (isBootstrap) {
        await bootstrapAdmin(email, password, name);
      } else if (isRegister) {
        await register(email, password, name);
      } else {
        await login(email, password);
      }
      setEmail('');
      setPassword('');
      setName('');
    } catch (err) {
      setError(err.message || 'Operation failed');
    } finally {
      setSubmitting(false);
    }
  }

  function switchMode(mode) {
    setAuthModalMode(mode);
    setError(null);
  }

  return (
    <div className="auth-backdrop" onClick={closeAuthModal}>
      <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
        <button
          className="auth-close-btn"
          type="button"
          onClick={closeAuthModal}
          aria-label="Close dialog"
        >
          &times;
        </button>

        <div className="auth-header">
          <div className="auth-logo-badge">🌲</div>
          {isBootstrap ? (
            <>
              <span className="auth-badge-admin-setup">Initial Setup</span>
              <h2 className="auth-title">Create Admin Account</h2>
              <p className="auth-subtitle">
                Set up the master administrator credentials for ForestTrace.
              </p>
            </>
          ) : (
            <>
              <h2 className="auth-title">
                {isRegister ? 'Join ForestTrace' : 'Sign in to ForestTrace'}
              </h2>
              <p className="auth-subtitle">
                {isRegister
                  ? 'Create an account to monitor forests and save insights'
                  : 'Access your geospatial monitoring workspace'}
              </p>
            </>
          )}
        </div>

        {/* Mode Tabs (Sign In / Sign Up) */}
        {!isBootstrap && (
          <div className="auth-tabs">
            <button
              type="button"
              className={`auth-tab ${authModalMode === 'login' ? 'auth-tab--active' : ''}`}
              onClick={() => switchMode('login')}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`auth-tab ${authModalMode === 'register' ? 'auth-tab--active' : ''}`}
              onClick={() => switchMode('register')}
            >
              Sign Up
            </button>
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          {error && <div className="auth-error-box">{error}</div>}

          {/* Name Field (Sign Up & Bootstrap) */}
          {(isBootstrap || isRegister) && (
            <div className="auth-form-group">
              <label htmlFor="auth-name">Full Name</label>
              <input
                id="auth-name"
                className="auth-input"
                type="text"
                placeholder="e.g. Dr. Jane Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                required={isBootstrap}
              />
            </div>
          )}

          <div className="auth-form-group">
            <label htmlFor="auth-email">Email Address</label>
            <input
              id="auth-email"
              className="auth-input"
              type="email"
              placeholder="name@university.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete={isBootstrap || isRegister ? 'email' : 'username'}
              required
            />
          </div>

          <div className="auth-form-group">
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              className="auth-input"
              type="password"
              placeholder={
                isBootstrap
                  ? 'Choose strong master password (min 6 chars)'
                  : isRegister
                  ? 'Choose a password (min 6 chars)'
                  : 'Enter your password'
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isBootstrap || isRegister ? 'new-password' : 'current-password'}
              minLength={isBootstrap || isRegister ? 6 : undefined}
              required
            />
          </div>

          <button className="auth-submit-btn" type="submit" disabled={submitting}>
            {submitting
              ? 'Please wait…'
              : isBootstrap
              ? 'Create Administrator Account'
              : isRegister
              ? 'Create Account'
              : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default AuthModal;
