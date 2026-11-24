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
