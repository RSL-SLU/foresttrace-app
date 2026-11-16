import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import AuthModal from './AuthModal';

jest.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    authModalOpen: true,
    closeAuthModal: jest.fn(),
    authModalMode: 'register',
    setAuthModalMode: jest.fn(),
    isInitialized: true,
    login: jest.fn(),
    register: jest.fn(),
    bootstrapAdmin: jest.fn(),
  }),
}));

test('preserves the typed username and validates it without inserting characters', () => {
  render(<AuthModal />);
  const username = screen.getByLabelText('Username');

  fireEvent.change(username, { target: { value: 'testuser' } });

  expect(username).toHaveValue('testuser');
  expect(username).toBeValid();
});
