import { geometryBounds } from '../utils/alerts';

/**
 * Before/after satellite views of one alert: a small mosaic of XYZ tiles at a
 * zoom that fits the alert, with its outline drawn on top. Plain <img> tiles
 * rather than a second map -- this is a thumbnail, and a map per alert would be
 * far heavier than nine images.
 *
 * Both views use Sentinel-2 cloudless annual mosaics (EOX), so the comparison
 * is like for like. Once real DIST-ALERT ingestion lands, "after" should be the
 * HLS scene that triggered the alert.
 */

const TILE = 256;
const MAX_ZOOM = 14;   // Sentinel-2 is 10 m; deeper zooms only upsample
const MIN_ZOOM = 8;

const eoxUrl = (year) => (z, x, y) =>
  `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-${year}_3857/default/GoogleMapsCompatible/${z}/${y}/${x}.jpg`;

// Web Mercator world pixel coordinates at zoom z
function project([lng, lat], z) {
  const scale = TILE * 2 ** z;
  const sin = Math.sin((lat * Math.PI) / 180);
  return [
    ((lng + 180) / 360) * scale,
    (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  ];
}

function rings(geometry) {
  if (geometry.type === 'Polygon') return geometry.coordinates;
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat();
  return [];
}

function Chip({ geometry, size, tileUrl, label, color }) {
  const [minLng, minLat, maxLng, maxLat] = geometryBounds(geometry);

  // Deepest zoom at which the alert still fits in ~75% of the chip
  let z = MAX_ZOOM;
  for (; z > MIN_ZOOM; z--) {
    const [x0, y0] = project([minLng, maxLat], z);
    const [x1, y1] = project([maxLng, minLat], z);
    if (x1 - x0 <= size * 0.75 && y1 - y0 <= size * 0.75) break;
  }

  const [cx, cy] = project([(minLng + maxLng) / 2, (minLat + maxLat) / 2], z);
  const left = cx - size / 2;
  const top = cy - size / 2;

  const tiles = [];
  for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + size) / TILE); tx++) {
    for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + size) / TILE); ty++) {
      tiles.push({ tx, ty });
    }
  }

  const paths = rings(geometry).map((ring) => ring
    .map((pt, i) => {
      const [px, py] = project(pt, z);
      return `${i ? 'L' : 'M'}${(px - left).toFixed(1)},${(py - top).toFixed(1)}`;
    })
    .join('') + 'Z');

  return (
    <figure className="alert-chip">
      <div className="alert-chip-frame" style={{ width: size, height: size }}>
        {tiles.map(({ tx, ty }) => (
          <img
            key={`${tx}-${ty}`}
            src={tileUrl(z, tx, ty)}
            alt=""
            draggable={false}
            style={{ left: tx * TILE - left, top: ty * TILE - top }}
          />
        ))}
        <svg width={size} height={size} aria-hidden="true">
          <path d={paths.join(' ')} fill="none" stroke={color} strokeWidth="2" fillRule="evenodd" />
        </svg>
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

function AlertImagery({ geometry, beforeYear = 2020, afterYear = 2024, color = '#ff2d95', size = 132 }) {
  if (!geometry) return null;
  return (
    <div className="alert-imagery">
      <Chip geometry={geometry} size={size} tileUrl={eoxUrl(beforeYear)} label={`Before · ${beforeYear}`} color={color} />
      <Chip geometry={geometry} size={size} tileUrl={eoxUrl(afterYear)} label={`After · ${afterYear}`} color={color} />
      <p className="alert-imagery-credit">Sentinel-2 cloudless © EOX IT Services GmbH</p>
    </div>
  );
}

export default AlertImagery;
