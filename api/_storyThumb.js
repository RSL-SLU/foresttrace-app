const sharp = require('sharp');

/**
 * The social-preview image for a story map (og:image): the story's first map
 * view as a 1200x630 JPEG -- satellite tiles with the clearcut patches,
 * alerts and FMU outline drawn on top, in the story map's own colors.
 *
 * No text: social platforms print the title and summary next to the image,
 * and server-side fonts are not dependable on serverless hosts.
 */

const W = 1200;
const H = 630;
const TILE = 256;
const TILE_URL = (z, x, y) =>
  `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

function project([lng, lat], z) {
  const scale = TILE * 2 ** z;
  const sin = Math.sin((lat * Math.PI) / 180);
  return [((lng + 180) / 360) * scale, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale];
}

function polygons(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

async function fetchTile(z, x, y) {
  try {
    const res = await fetch(TILE_URL(z, x, y), { signal: AbortSignal.timeout(8000) });
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  } catch {
    return null;   // a missing tile leaves dark background, not a failed story
  }
}

/**
 * @param {number[]} bbox  [west, south, east, north] of the first map view
 * @param {object} layers  facts.layers: { boundaries, patches, alerts }
 * @returns {Promise<Buffer>} JPEG
 */
async function renderStoryThumbnail(bbox, layers) {
  const [w, s, e, n] = bbox;

  // Tiles come in whole zoom levels, so render one level deeper than the
  // deepest that fits and scale the crop down: the view then fills ~86% of the
  // card instead of anywhere between 43% and 86%.
  let z = 13;
  for (; z > 3; z--) {
    const [x0, y0] = project([w, n], z);
    const [x1, y1] = project([e, s], z);
    if (x1 - x0 <= W * 0.86 && y1 - y0 <= H * 0.86) break;
  }
  if (z < 13) z += 1;
  const [px0, py0] = project([w, n], z);
  const [px1, py1] = project([e, s], z);
  const k = Math.min(1, (W * 0.86) / Math.max(1, px1 - px0), (H * 0.86) / Math.max(1, py1 - py0));
  const cropW = Math.round(W / k);
  const cropH = Math.round(H / k);

  const [cx, cy] = project([(w + e) / 2, (s + n) / 2], z);
  const left = cx - cropW / 2;
  const top = cy - cropH / 2;

  const tx0 = Math.floor(left / TILE);
  const ty0 = Math.floor(top / TILE);
  const tx1 = Math.floor((left + cropW) / TILE);
  const ty1 = Math.floor((top + cropH) / TILE);
  const jobs = [];
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      jobs.push(fetchTile(z, tx, ty).then((buf) => buf && ({ input: buf, left: (tx - tx0) * TILE, top: (ty - ty0) * TILE })));
    }
  }
  const tiles = (await Promise.all(jobs)).filter(Boolean);

  // Stitch the tile grid, crop the view out of it, scale to the card
  const mosaic = await sharp({
    create: { width: (tx1 - tx0 + 1) * TILE, height: (ty1 - ty0 + 1) * TILE, channels: 3, background: '#1f2b24' },
  }).composite(tiles).png().toBuffer();
  const base = await sharp(mosaic)
    .extract({ left: Math.round(left - tx0 * TILE), top: Math.round(top - ty0 * TILE), width: cropW, height: cropH })
    .resize(W, H)
    .toBuffer();

  const path = (geometry) => polygons(geometry).map((poly) => poly.map((ring) => ring.map((pt, i) => {
    const [px, py] = project(pt, z);
    return `${i ? 'L' : 'M'}${((px - left) * k).toFixed(1)},${((py - top) * k).toFixed(1)}`;
  }).join('') + 'Z').join('')).join('');

  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="rgba(0,0,0,0.12)"/>
    ${layers.patches.map((f) => `<path d="${path(f.geometry)}" fill="rgba(217,119,6,0.75)" fill-rule="evenodd"/>`).join('')}
    ${layers.alerts.map((f) => `<path d="${path(f.geometry)}" fill="rgba(255,45,149,0.45)" stroke="#ff2d95" stroke-width="1.5" fill-rule="evenodd"/>`).join('')}
    ${layers.boundaries.map((f) => `<path d="${path(f.geometry)}" fill="none" stroke="#ffffff" stroke-width="3" stroke-linejoin="round"/>`).join('')}
    <rect y="${H - 10}" width="${W}" height="10" fill="#2f8f5b"/>
  </svg>`;

  return sharp(base)
    .composite([{ input: Buffer.from(overlay), top: 0, left: 0 }])
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
}

module.exports = { renderStoryThumbnail };
