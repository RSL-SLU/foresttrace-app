import L from 'leaflet';

const inFlightImageRequests = new Map();
const failedImageRequests = new Map();
const FAILED_REQUEST_TTL_MS = 5000;

function wrapX(x, z) {
  const tilesPerAxis = 2 ** z;
  return ((x % tilesPerAxis) + tilesPerAxis) % tilesPerAxis;
}

function clampY(y, z) {
  const max = (2 ** z) - 1;
  if (y < 0) return 0;
  if (y > max) return max;
  return y;
}

function loadImageDeduped(url) {
  const now = Date.now();
  const failedAt = failedImageRequests.get(url);
  if (failedAt && now - failedAt < FAILED_REQUEST_TTL_MS) {
    return Promise.resolve(null);
  }

  if (inFlightImageRequests.has(url)) {
    return inFlightImageRequests.get(url);
  }

  const promise = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      failedImageRequests.delete(url);
      resolve(img);
    };
    img.onerror = () => {
      failedImageRequests.set(url, Date.now());
      resolve(null);
    };
    img.src = url;
  }).finally(() => {
    inFlightImageRequests.delete(url);
  });

  inFlightImageRequests.set(url, promise);
  return promise;
}

// Per-layer queue factory. Each canvas layer creates its own queue so stale
// requests from panned-away tiles are cancelled when the layer is removed.
export function makeTileQueue(max) {
  let active = 0;
  const pending = [];
  let cancelled = false;

  function release() {
    active -= 1;
    if (!cancelled && pending.length) {
      active += 1;
      pending.shift()(release);
    }
  }

  return {
    run(task) {
      if (cancelled) return;
      if (active < max) {
        active += 1;
        task(release);
      } else {
        pending.push(task);
      }
    },
    cancel() {
      cancelled = true;
      pending.length = 0;
    },
  };
}

// Fetches a tile and draws it scaled into ctx at (destX, destY, destSize x destSize).
// On 404, recursively tries the 4 child tiles at z+1.
export function loadTileComposite(queue, ctx, tileUrl, z, x, y, destX, destY, destSize, maxNativeZ, depth, callback) {
  queue.run((release) => {
    const safeX = wrapX(x, z);
    const safeY = clampY(y, z);
    const url = L.Util.template(tileUrl, { z, x: safeX, y: safeY });

    loadImageDeduped(url).then((img) => {
      release();
      if (img) {
        ctx.drawImage(img, 0, 0, 256, 256, destX, destY, destSize, destSize);
        callback();
        return;
      }

      if (depth <= 0 || z >= maxNativeZ) {
        callback();
        return;
      }

      let pending = 4;
      const half = destSize / 2;
      const childDone = () => {
        pending -= 1;
        if (pending === 0) callback();
      };

      for (let dx = 0; dx < 2; dx += 1) {
        for (let dy = 0; dy < 2; dy += 1) {
          loadTileComposite(
            queue,
            ctx,
            tileUrl,
            z + 1,
            x * 2 + dx,
            y * 2 + dy,
            destX + dx * half,
            destY + dy * half,
            half,
            maxNativeZ,
            depth - 1,
            childDone,
          );
        }
      }
    });
  });
}
