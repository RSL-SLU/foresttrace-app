import { summarizeDrawing } from './drawnShapeContext';
import wabigoon from '../../public/data/regions/wabigoon.json';

const boundaries = wabigoon.type === 'FeatureCollection'
  ? wabigoon
  : { type: 'FeatureCollection', features: [wabigoon] };

const rectangle = (lng, lat, d = 0.02) => ({
  type: 'Feature',
  properties: { mode: 'rectangle' },
  geometry: {
    type: 'Polygon',
    coordinates: [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]],
  },
});

test('a shape in a later part of a multi-part FMU is inside that FMU', () => {
  // Northern Wabigoon: boundary part 1, not part 0 (which ends at ~49.85 N).
  // Reported as "outside any FMU" before every part was tested.
  const ctx = summarizeDrawing([rectangle(-92.48095, 49.9607)], boundaries);
  expect(ctx.regionsContaining).toEqual(['wabigoon']);
  expect(ctx.regionsNearby).toEqual([]);
});

test('a shape in the first part is still inside', () => {
  const ctx = summarizeDrawing([rectangle(-92.4, 49.5, 0.01)], boundaries);
  expect(ctx.regionsContaining).toEqual(['wabigoon']);
});

test('a shape far from the FMU is neither inside nor nearby', () => {
  const ctx = summarizeDrawing([rectangle(-80, 45)], boundaries);
  expect(ctx.regionsContaining).toEqual([]);
  expect(ctx.regionsNearby).toEqual([]);
});

test('a pin in a later part counts too', () => {
  const pin = { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [-92.48095, 49.9607] } };
  expect(summarizeDrawing([pin], boundaries).regionsContaining).toEqual(['wabigoon']);
});
