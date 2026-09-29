import React, { useState, useEffect, useRef } from 'react';
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
    sendSignupCode,
    verifySignupCode,
    sendLoginCode,
    verifyLoginCode,
    bootstrapAdmin,
  } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [otpCode, setOtpCode] = useState('');

  // 'code' (passwordless via email) or 'password'
  const [loginMethod, setLoginMethod] = useState('code');
  // 'form' (initial entry) or 'otp' (awaiting 6-digit confirmation)
  const [step, setStep] = useState('form');

  const [error, setError] = useState(null);
  const [infoMessage, setInfoMessage] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const otpInputRef = useRef(null);

  // If the database has no admin user, default to bootstrap mode
  const isBootstrap = !isInitialized || authModalMode === 'bootstrap';

  // Clear transient states whenever modal or mode switches
  useEffect(() => {
    setError(null);
    setInfoMessage(null);
    setStep('form');
    setOtpCode('');
  }, [authModalMode, authModalOpen]);

  // Focus OTP input automatically when entering OTP step
  useEffect(() => {
    if (step === 'otp' && otpInputRef.current) {
      otpInputRef.current.focus();
    }
  }, [step]);

  // Resend cooldown timer tick
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  if (!authModalOpen) return null;

  // Send or Resend Verification Code
  async function handleSendCode(isResend = false) {
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      if (authModalMode === 'register') {
        const res = await sendSignupCode(email, name, password);
        setInfoMessage(res.message || `Verification code sent to ${email}`);
      } else {
        const res = await sendLoginCode(email);
        setInfoMessage(res.message || `Login code sent to ${email}`);
      }
      setStep('otp');
      setResendCooldown(60);
    } catch (err) {
      setError(err.message || 'Failed to send code. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // Verify 6-digit Code (for both Sign Up and Login)
  async function handleVerifyCode(e) {
    e.preventDefault();
    if (!otpCode || otpCode.trim().length !== 6) {
      setError('Please enter the complete 6-digit code.');
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      if (authModalMode === 'register') {
        await verifySignupCode(email, otpCode.trim());
      } else {
        await verifyLoginCode(email, otpCode.trim());
      }
      // Reset form
      setEmail('');
      setPassword('');
      setName('');
      setOtpCode('');
      setStep('form');
    } catch (err) {
      setError(err.message || 'Invalid code. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // Handle standard password login or admin bootstrap
  async function handleDirectSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (isBootstrap) {
        await bootstrapAdmin(email, password, name);
      } else {
        await login(email, password);
      }
      setEmail('');
      setPassword('');
      setName('');
      setStep('form');
    } catch (err) {
      setError(err.message || 'Operation failed');
    } finally {
      setSubmitting(false);
    }
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
                {step === 'otp'
                  ? 'Enter Verification Code'
                  : authModalMode === 'register'
                  ? 'Join ForestTrace'
                  : 'Sign in to ForestTrace'}
              </h2>
              <p className="auth-subtitle">
                {step === 'otp'
                  ? `We sent a 6-digit code to ${email}`
                  : authModalMode === 'register'
                  ? 'Create an account to monitor forests and save insights'
                  : 'Access your geospatial monitoring workspace'}
              </p>
            </>
          )}
        </div>

        {/* Mode Tabs (Sign In / Sign Up) */}
        {!isBootstrap && step === 'form' && (
          <div className="auth-tabs">
            <button
              type="button"
              className={`auth-tab ${authModalMode === 'login' ? 'auth-tab--active' : ''}`}
              onClick={() => {
                setAuthModalMode('login');
                setError(null);
                setInfoMessage(null);
              }}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`auth-tab ${authModalMode === 'register' ? 'auth-tab--active' : ''}`}
              onClick={() => {
                setAuthModalMode('register');
                setError(null);
                setInfoMessage(null);
              }}
            >
              Sign Up
            </button>
          </div>
        )}

        {/* STEP 2: 6-Digit OTP Code Verification */}
        {step === 'otp' ? (
          <form className="auth-form" onSubmit={handleVerifyCode}>
            {error && <div className="auth-error-box">{error}</div>}
            {infoMessage && <div className="auth-info-box">{infoMessage}</div>}

            <div className="auth-form-group">
              <label htmlFor="auth-otp">6-Digit Confirmation Code</label>
              <input
                ref={otpInputRef}
                id="auth-otp"
                className="auth-input auth-input-otp"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="123456"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                autoComplete="one-time-code"
                required
              />
            </div>

            <button
              className="auth-submit-btn"
              type="submit"
              disabled={submitting || otpCode.trim().length !== 6}
            >
              {submitting
                ? 'Verifying…'
                : authModalMode === 'register'
                ? 'Verify & Complete Sign Up'
                : 'Verify & Sign In'}
            </button>

            <div className="auth-otp-footer">
              <button
                type="button"
                className="auth-link-btn"
                disabled={resendCooldown > 0 || submitting}
                onClick={() => handleSendCode(true)}
              >
                {resendCooldown > 0
                  ? `Resend code in ${resendCooldown}s`
                  : 'Didn’t receive a code? Resend'}
              </button>

              <button
                type="button"
                className="auth-link-btn auth-link-btn--secondary"
                onClick={() => {
                  setStep('form');
                  setError(null);
                  setInfoMessage(null);
                  setOtpCode('');
                }}
              >
                ← Change Email
              </button>
            </div>
          </form>
        ) : (
          /* STEP 1: Entry Form */
          <form
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (isBootstrap || (authModalMode === 'login' && loginMethod === 'password')) {
                handleDirectSubmit(e);
              } else {
                handleSendCode(false);
              }
            }}
          >
            {error && <div className="auth-error-box">{error}</div>}
            {infoMessage && <div className="auth-info-box">{infoMessage}</div>}

            {/* In Login mode: Toggle between Email Code (passwordless) & Password */}
            {!isBootstrap && authModalMode === 'login' && (
              <div className="auth-method-switcher">
                <button
                  type="button"
                  className={`auth-method-pill ${loginMethod === 'code' ? 'auth-method-pill--active' : ''}`}
                  onClick={() => {
                    setLoginMethod('code');
                    setError(null);
                  }}
                >
                  ✉️ Email Code
                </button>
                <button
                  type="button"
                  className={`auth-method-pill ${loginMethod === 'password' ? 'auth-method-pill--active' : ''}`}
                  onClick={() => {
                    setLoginMethod('password');
                    setError(null);
                  }}
                >
                  🔑 Password
                </button>
              </div>
            )}

            {/* Name Field (Sign Up & Bootstrap) */}
            {(isBootstrap || authModalMode === 'register') && (
              <div className="auth-form-group">
                <label htmlFor="auth-name">Full Name</label>
                <input
                  id="auth-name"
                  className="auth-input"
                  type="text"
                  placeholder="e.g. Dr. Jane Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required={isBootstrap}
                />
              </div>
            )}

            {/* Email Field */}
            <div className="auth-form-group">
              <label htmlFor="auth-email">Email Address</label>
              <input
                id="auth-email"
                className="auth-input"
                type="email"
                placeholder="name@university.edu"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            {/* Password Field (for Bootstrap, Password-Login, or Optional on Sign Up) */}
            {(isBootstrap || (authModalMode === 'login' && loginMethod === 'password') || authModalMode === 'register') && (
              <div className="auth-form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label htmlFor="auth-password">
                    {authModalMode === 'register' ? 'Password (Optional)' : 'Password'}
                  </label>
                  {authModalMode === 'register' && (
                    <span style={{ fontSize: 11, color: '#64748b' }}>Allows sign-in without email access</span>
                  )}
                </div>
                <input
                  id="auth-password"
                  className="auth-input"
                  type="password"
                  placeholder={
                    isBootstrap
                      ? 'Choose strong master password (min 6 chars)'
                      : authModalMode === 'register'
                      ? 'Set password (optional, min 6 chars)'
                      : 'Enter your password'
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required={isBootstrap || (authModalMode === 'login' && loginMethod === 'password')}
                  minLength={password.length > 0 ? 6 : undefined}
                />
              </div>
            )}

            <button className="auth-submit-btn" type="submit" disabled={submitting}>
              {submitting ? (
                'Please wait…'
              ) : isBootstrap ? (
                'Create Administrator Account'
              ) : authModalMode === 'register' ? (
                'Send Verification Code →'
              ) : loginMethod === 'code' ? (
                'Email Me a Login Code →'
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default AuthModal;
