import React from 'react';
import { render, screen } from '@testing-library/react';
import AuthModal from './AuthModal';

let mockAuth;
jest.mock('../context/AuthContext', () => ({ useAuth: () => mockAuth }));

const base = {
  authModalOpen: true,
  closeAuthModal: jest.fn(),
  authModalMode: 'login',
  setAuthModalMode: jest.fn(),
  isInitialized: true,
  login: jest.fn(),
  loginWithGoogle: jest.fn(),
  register: jest.fn(),
  bootstrapAdmin: jest.fn(),
};

afterEach(() => {
  document.head.querySelectorAll('script[src*="accounts.google.com"]').forEach((s) => s.remove());
});

test('offers Google above the email form when a client ID is configured', () => {
  mockAuth = { ...base, googleClientId: 'abc.apps.googleusercontent.com' };
  render(<AuthModal />);
  expect(screen.getByTestId('google-signin')).toBeInTheDocument();
  expect(screen.getByText('or with email')).toBeInTheDocument();
  expect(screen.getByLabelText('Email Address')).toBeInTheDocument();
  expect(document.head.querySelector('script[src="https://accounts.google.com/gsi/client"]')).not.toBeNull();
});

test('hides Google without a client ID', () => {
  mockAuth = { ...base, googleClientId: null };
  render(<AuthModal />);
  expect(screen.queryByTestId('google-signin')).not.toBeInTheDocument();
  expect(screen.queryByText('or with email')).not.toBeInTheDocument();
});

test('hides Google during the first-admin setup', () => {
  mockAuth = { ...base, authModalMode: 'bootstrap', googleClientId: 'abc.apps.googleusercontent.com' };
  render(<AuthModal />);
  expect(screen.getByText('Create Admin Account')).toBeInTheDocument();
  expect(screen.queryByTestId('google-signin')).not.toBeInTheDocument();
});

test('sign-up sends the honeypot and Turnstile fields, and waits for the check', () => {
  mockAuth = { ...base, authModalMode: 'register', googleClientId: null, turnstileSiteKey: 'site-key' };
  render(<AuthModal />);
  expect(screen.getByTestId('turnstile')).toBeInTheDocument();
  // No token yet: the button waits for the check
  expect(screen.getByRole('button', { name: 'Create Account' })).toBeDisabled();
  // The honeypot exists but is hidden from people
  expect(document.getElementById('auth-website')).toHaveAttribute('tabindex', '-1');
});

test('no Turnstile on sign-in, or when it is not configured', () => {
  mockAuth = { ...base, authModalMode: 'login', turnstileSiteKey: 'site-key' };
  const { unmount } = render(<AuthModal />);
  expect(screen.queryByTestId('turnstile')).not.toBeInTheDocument();
  unmount();
  mockAuth = { ...base, authModalMode: 'register', turnstileSiteKey: null };
  render(<AuthModal />);
  expect(screen.queryByTestId('turnstile')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create Account' })).toBeEnabled();
});
