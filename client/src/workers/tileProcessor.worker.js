/* eslint-disable no-restricted-globals */
import { BIOMASS_BINS } from '../utils/biomassHistogram';

// Mirrors the color ramp previously computed on the main thread in
// RasterTileLayer — moved here so the per-pixel loop never blocks the UI.
function getColorForBiomassIntensity(rawIntensity) {
  const agb = (rawIntensity / 255) * 1000;
  if (agb < 10) {
    const t = agb / 10;
    return { r: Math.round(220 - (100 * t)), g: Math.round(180 - (95 * t)), b: Math.round(140 - (100 * t)) };
  }
  if (agb < 25) {
    const t = (agb - 10) / 15;
    return { r: Math.round(120 + (135 * t)), g: Math.round(85 + (155 * t)), b: Math.round(40) };
  }
  if (agb < 40) {
    const t = (agb - 25) / 15;
    return { r: Math.round(255), g: Math.round(240 - (50 * t)), b: Math.round(40) };
  }
  if (agb < 50) {
    const t = (agb - 40) / 10;
    return { r: Math.round(255), g: Math.round(190 + (65 * t)), b: Math.round(40) };
  }
  if (agb < 85) {
    const t = (agb - 50) / 35;
    return { r: Math.round(50 * (1 - t)), g: Math.round(220 + (35 * t)), b: Math.round(0) };
  }
  if (agb < 120) {
    const t = (agb - 85) / 35;
    return { r: 0, g: Math.round(255), b: Math.round(20 * t) };
  }
  const t = Math.min(1, (agb - 120) / 30);
  return { r: 0, g: Math.round(255 - (90 * t)), b: Math.round(50 * t) };
}

function getTilePixelAreaHa(z, y) {
  const tilesPerAxis = 2 ** z;
  const centerY = y + 0.5;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * centerY) / tilesPerAxis)));
  const metersPerPixel = (156543.03392 * Math.cos(latRad)) / tilesPerAxis;
  return (metersPerPixel * metersPerPixel) / 10000;
}

// Recolors a tile's pixels in place for the given layer type and tallies the
// stats each layer needs (red-pixel ratio for clearcut/wildfire, an AGB
// histogram for biomass). Returns null redCount/totalCount/histogram fields
// for layer types that don't apply.
function processPixels(layerId, pixels, coords, width = 256, height = 256) {
  let redCount = 0;
  let totalCount = 0;
  let histogram = null;

  // ML estimates: extract 2px outline and make interior transparent
  if (layerId === 'clearcut-ml-accumulated' || layerId === 'clearcut-ml-annual') {
    const numPixels = width * height;
    const mask = new Uint8Array(numPixels);

    for (let p = 0; p < numPixels; p++) {
      const idx = p * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      const a = pixels[idx + 3];
      totalCount += 1;
      // Mark disturbance pixels
      if (a > 30 && (r > 30 || g > 30 || b > 30)) {
        mask[p] = 1;
        redCount += 1;
      }
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        const idx = p * 4;

        if (mask[p] === 0) {
          pixels[idx + 3] = 0;
          continue;
        }

        // Check if on boundary within 2px neighborhood
        // Out-of-bounds neighbors treated as 1 so tile edges don't get artificial borders
        let isEdge = false;
        for (let dy = -2; dy <= 2; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -2; dx <= 2; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            if (mask[ny * width + nx] === 0) {
              isEdge = true;
              break;
            }
          }
          if (isEdge) break;
        }

        // Edge pixels keep the color function's own color and alpha: STATUS
        // picks the color, CONFIDENCE the opacity (utils/borealLayers.js).
        // The interior goes transparent.
        if (!isEdge) pixels[idx + 3] = 0;
      }
    }

    return { redCount, totalCount, histogram };
  }

  const isBiomass = layerId === 'biomass-density';
  const pixelAreaHa = isBiomass ? getTilePixelAreaHa(coords.z, coords.y) : 0;
  if (isBiomass) {
    histogram = BIOMASS_BINS.map(() => ({ area: 0, pixels: 0 }));
  }

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const a = pixels[i + 3];
    totalCount += 1;

    if (layerId === 'clearcut-accumulated' || layerId === 'clearcut-annual') {
      if (a > 0 && r > 200) redCount += 1;
      if (a === 0) continue;
      const intensity = r / 255;
      if (layerId === 'clearcut-annual') {
        // Red tint (#dc2626)
        pixels[i]     = Math.round((r * 0.35) + (220 * intensity * 0.65));
        pixels[i + 1] = Math.round(38 * intensity);
        pixels[i + 2] = Math.round(38 * intensity);
      } else {
        // Amber tint (#d97706) for accumulated ARI
        pixels[i]     = Math.round((r * 0.35) + (217 * intensity * 0.65));
        pixels[i + 1] = Math.round(119 * intensity);
        pixels[i + 2] = Math.round(6 * intensity);
      }
      continue;
    }

    if (layerId === 'wildfire-burned') {
      if (a > 0 && r > 200) redCount += 1;
      if (a === 0) continue;
      const intensity = r / 255;
      // Fire orange (#FF7F00), kept clear of clearcut's red.
      pixels[i]     = Math.round(255 * intensity);
      pixels[i + 1] = Math.round(127 * intensity);
      pixels[i + 2] = 0;
      continue;
    }

    if (isBiomass) {
      if (a === 0) continue;
      const agb = (g / 255) * 1000;
      for (let binIdx = 0; binIdx < BIOMASS_BINS.length; binIdx += 1) {
        const bin = BIOMASS_BINS[binIdx];
        if (agb >= bin.min && agb < bin.max) {
          histogram[binIdx].pixels += 1;
          histogram[binIdx].area += pixelAreaHa;
          break;
        }
      }
      const color = getColorForBiomassIntensity(g);
      pixels[i] = color.r;
      pixels[i + 1] = color.g;
      pixels[i + 2] = color.b;
    }
  }

  return { redCount, totalCount, histogram };
}

self.onmessage = (event) => {
  const { id, layerId, width, height, buffer, coords } = event.data;
  const pixels = new Uint8ClampedArray(buffer);
  const { redCount, totalCount, histogram } = processPixels(layerId, pixels, coords, width, height);

  self.postMessage(
    { id, buffer: pixels.buffer, width, height, redCount, totalCount, histogram },
    [pixels.buffer],
  );
};

