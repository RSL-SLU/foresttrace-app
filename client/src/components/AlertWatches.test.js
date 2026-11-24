import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AlertWatches from './AlertWatches';
import { drawnAreaGeometry } from '../utils/alerts';

let mockRole = 'user';
jest.mock('../context/AuthContext', () => ({
  useAuth: () => ({ token: 't0k', user: { role: mockRole } }),
}));

const square = (x) => ({
  type: 'Feature',
  properties: { mode: 'polygon' },
  geometry: { type: 'Polygon', coordinates: [[[x, 49], [x + 0.1, 49], [x + 0.1, 49.1], [x, 49.1], [x, 49]]] },
});

// A fake /api/alerts holding one user's watches, so each test sees the
// component reload what it just saved.
function mockServer(initial = []) {
  let watches = [...initial];
  let nextId = 1;
  const calls = [];
  global.fetch = jest.fn(async (url, opts = {}) => {
    const action = new URL(url, 'http://x').searchParams.get('action');
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ action, body, headers: opts.headers });
    let data = {};
    if (action === 'watches') {
      data = { watches, email: 'me@example.org', emailsEnabled: true, mailerConfigured: true };
    } else if (action === 'watch-area') {
      const w = { id: String(nextId++), kind: 'area', name: body.name || 'Area of interest', geometry: body.geometry };
      watches.push(w);
      data = { watch: w };
    } else if (action === 'watch-fmus') {
      watches = watches.filter((w) => w.kind !== 'fmus');
      if (body.fmus.length) watches.push({ id: 'f', kind: 'fmus', fmus: body.fmus });
    } else if (action === 'unwatch') {
      watches = watches.filter((w) => w.id !== body.id);
    } else if (action === 'test-email') {
      data = { success: true, to: 'me@example.org', simulated: false };
    }
    return { ok: true, status: 200, json: async () => data };
  });
  return calls;
}

afterEach(() => { mockRole = 'user'; });

describe('drawnAreaGeometry', () => {
  test('ignores points and lines, keeps a single polygon as is', () => {
    const point = { geometry: { type: 'Point', coordinates: [0, 0] } };
    expect(drawnAreaGeometry([point])).toBeNull();
    expect(drawnAreaGeometry([point, square(-92)])).toEqual(square(-92).geometry);
  });

  test('merges several polygons into one MultiPolygon', () => {
    const g = drawnAreaGeometry([square(-92), square(-91)]);
    expect(g.type).toBe('MultiPolygon');
    expect(g.coordinates).toHaveLength(2);
  });
});

test('saves the drawn area under the typed name and lists it', async () => {
  const calls = mockServer();
  render(<AlertWatches drawnFeatures={[square(-92)]} selectedFMUs={[]} />);

  await screen.findByText('me@example.org');
  fireEvent.change(screen.getByLabelText('Name for the drawn area'), { target: { value: 'North block' } });
  fireEvent.click(screen.getByRole('button', { name: 'Watch drawn area' }));

  expect(await screen.findByText('North block')).toBeInTheDocument();
  const save = calls.find((c) => c.action === 'watch-area');
  expect(save.body).toEqual({ name: 'North block', geometry: square(-92).geometry });
  expect(save.headers.Authorization).toBe('Bearer t0k');
  await waitFor(() => expect(screen.getByLabelText('Name for the drawn area')).toHaveValue(''));
});

test('asks for a drawing when nothing is drawn', async () => {
  mockServer();
  render(<AlertWatches drawnFeatures={[]} selectedFMUs={[]} />);
  expect(await screen.findByText(/Draw a polygon or rectangle/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Watch drawn area/ })).not.toBeInTheDocument();
});

test('adds only selected FMUs not already watched, and removes one', async () => {
  const calls = mockServer([{ id: 'f', kind: 'fmus', fmus: ['wabigoon'] }]);
  render(<AlertWatches drawnFeatures={[]} selectedFMUs={['wabigoon', 'dryden']} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Watch Dryden Forest' }));
  await screen.findByRole('button', { name: 'Stop watching Dryden Forest' });
  expect(calls.find((c) => c.action === 'watch-fmus').body).toEqual({ fmus: ['wabigoon', 'dryden'] });

  fireEvent.click(screen.getByRole('button', { name: 'Stop watching Wabigoon Forest' }));
  await waitFor(() => expect(screen.queryByText('Wabigoon Forest')).not.toBeInTheDocument());
  expect(calls.filter((c) => c.action === 'watch-fmus').pop().body).toEqual({ fmus: ['dryden'] });
});

test('only admins get the manual notification check', async () => {
  mockServer();
  const { unmount } = render(<AlertWatches />);
  await screen.findByText('me@example.org');
  expect(screen.queryByRole('button', { name: 'Check for new alerts now' })).not.toBeInTheDocument();
  unmount();

  mockRole = 'admin';
  render(<AlertWatches />);
  expect(await screen.findByRole('button', { name: 'Check for new alerts now' })).toBeInTheDocument();
});

test('reports where the test email went', async () => {
  mockServer();
  render(<AlertWatches />);
  fireEvent.click(await screen.findByRole('button', { name: 'Send me a test email' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Test email sent to me@example.org.');
});
