import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

const TOKEN_KEY = 'foresttrace_auth_token';
const USER_KEY = 'foresttrace_auth_user';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem(USER_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch (_) {
      return null;
    }
  });

  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || null);
  const [isInitialized, setIsInitialized] = useState(true);
  const [loading, setLoading] = useState(true);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState('login'); // 'login' | 'register' | 'bootstrap'
  // OAuth client ID for the Google button, from the server (api/auth.js status);
  // null hides the button.
  const [googleClientId, setGoogleClientId] = useState(process.env.REACT_APP_GOOGLE_CLIENT_ID || null);
  // Cloudflare Turnstile site key for the sign-up form (api/_botGuard.js); null = off
  const [turnstileSiteKey, setTurnstileSiteKey] = useState(null);

  // Persist session to localStorage
  const saveSession = useCallback((newToken, newUser) => {
    setToken(newToken);
    setUser(newUser);
    if (newToken) {
      localStorage.setItem(TOKEN_KEY, newToken);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
    if (newUser) {
      localStorage.setItem(USER_KEY, JSON.stringify(newUser));
    } else {
      localStorage.removeItem(USER_KEY);
    }
  }, []);

  // Check auth status & whether initial admin exists
  const checkAuthStatus = useCallback(async () => {
    setLoading(true);
    try {
      const headers = {};
      const currentToken = localStorage.getItem(TOKEN_KEY);
      if (currentToken) {
        headers['Authorization'] = `Bearer ${currentToken}`;
      }

      const res = await fetch('/api/auth?action=status', { headers });
      if (!res.ok) throw new Error('Auth status check failed');
      const data = await res.json();

      setIsInitialized(data.initialized !== false);
      if (data.googleClientId) setGoogleClientId(data.googleClientId);
      setTurnstileSiteKey(data.turnstileSiteKey || null);

      if (data.authenticated && data.user) {
        saveSession(currentToken, data.user);
      } else if (currentToken && !data.authenticated) {
        // Stale or expired token
        saveSession(null, null);
      }
    } catch (err) {
      console.warn('[AuthContext] Status check error:', err);
    } finally {
      setLoading(false);
    }
  }, [saveSession]);

  useEffect(() => {
    checkAuthStatus();
  }, [checkAuthStatus]);

  // Password-based login handler
  const login = async (email, password) => {
    const res = await fetch('/api/auth?action=login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Login failed');
    }

    saveSession(data.token, data.user);
    setAuthModalOpen(false);
    return data.user;
  };

  // Google sign-in/sign-up: `credential` is the ID token from the Google button
  const loginWithGoogle = async (credential) => {
    const res = await fetch('/api/auth?action=google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Google sign-in failed');
    }

    saveSession(data.token, data.user);
    setAuthModalOpen(false);
    return data.user;
  };

  // Register handler (standard user)
  // botCheck: { turnstileToken, website } -- see api/_botGuard.js
  const register = async (email, password, name, username, botCheck = {}) => {
    const res = await fetch('/api/auth?action=register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name, username, ...botCheck }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Registration failed');
    }

    saveSession(data.token, data.user);
    setAuthModalOpen(false);
    return data.user;
  };

  // Bootstrap initial admin handler
  const bootstrapAdmin = async (email, password, name) => {
    const res = await fetch('/api/auth?action=bootstrap-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Admin initialization failed');
    }

    setIsInitialized(true);
    saveSession(data.token, data.user);
    setAuthModalOpen(false);
    return data.user;
  };

  // Logout handler
  const logout = () => {
    saveSession(null, null);
  };

  // Open modal with specific mode
  const openAuthModal = (mode = 'login') => {
    setAuthModalMode(mode);
    setAuthModalOpen(true);
  };

  const closeAuthModal = () => {
    setAuthModalOpen(false);
  };

  const value = {
    user,
    token,
    isAuthenticated: Boolean(user && token),
    isAdmin: user?.role === 'admin',
    isInitialized,
    loading,
    authModalOpen,
    authModalMode,
    openAuthModal,
    closeAuthModal,
    setAuthModalMode,
    login,
    loginWithGoogle,
    googleClientId,
    turnstileSiteKey,
    register,
    bootstrapAdmin,
    logout,
    checkAuthStatus,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

