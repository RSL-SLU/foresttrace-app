import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import MapPointContextMenu from './MapPointContextMenu';

const point = { lat: 49.803183, lng: -92.808778, x: 100, y: 120 };

test('copies the clicked point coordinates', () => {
  const onCopy = jest.fn();
  render(<MapPointContextMenu point={point} onCopy={onCopy} onClose={jest.fn()} onAsk={jest.fn()} />);

  fireEvent.click(screen.getByRole('menuitem', { name: 'Copy coordinates' }));

  expect(onCopy).toHaveBeenCalledWith('49.803183, -92.808778');
});

test('asks the AI about the clicked point', () => {
  const onAsk = jest.fn();
  render(<MapPointContextMenu point={point} onCopy={jest.fn()} onClose={jest.fn()} onAsk={onAsk} />);

  fireEvent.click(screen.getByRole('menuitem', { name: 'Ask AI about this point' }));

  expect(onAsk).toHaveBeenCalledWith(point);
});
