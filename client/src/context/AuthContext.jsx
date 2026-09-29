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

  // Send verification code for registration
  const sendSignupCode = async (email, name, password) => {
    const res = await fetch('/api/auth?action=send-signup-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, password }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to send verification code');
    }
    return data;
  };

  // Verify registration code and complete sign-up
  const verifySignupCode = async (email, code) => {
    const res = await fetch('/api/auth?action=verify-signup-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to verify code');
    }

    saveSession(data.token, data.user);
    setAuthModalOpen(false);
    return data.user;
  };

  // Send passwordless login code to user's email
  const sendLoginCode = async (email) => {
    const res = await fetch('/api/auth?action=send-login-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to send login code');
    }
    return data;
  };

  // Verify login code and authenticate
  const verifyLoginCode = async (email, code) => {
    const res = await fetch('/api/auth?action=verify-login-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to verify login code');
    }

    saveSession(data.token, data.user);
    setAuthModalOpen(false);
    return data.user;
  };

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

  // Direct register handler (standard user)
  const register = async (email, password, name) => {
    const res = await fetch('/api/auth?action=register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
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
    register,
    sendSignupCode,
    verifySignupCode,
    sendLoginCode,
    verifyLoginCode,
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

