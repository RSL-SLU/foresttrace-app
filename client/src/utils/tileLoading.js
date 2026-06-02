import L from 'leaflet';

const inFlightImageRequests = new Map();

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
  if (inFlightImageRequests.has(url)) {
    return inFlightImageRequests.get(url);
  }

  const promise = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
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
// Callback receives whether any source tile was successfully drawn.
export function loadTileComposite(queue, ctx, tileUrl, z, x, y, destX, destY, destSize, maxNativeZ, depth, callback) {
  queue.run((release) => {
    const safeX = wrapX(x, z);
    const safeY = clampY(y, z);
    const url = L.Util.template(tileUrl, { z, x: safeX, y: safeY });

    loadImageDeduped(url).then((img) => {
      release();
      if (img) {
        ctx.drawImage(img, 0, 0, 256, 256, destX, destY, destSize, destSize);
        callback(true);
        return;
      }

      if (depth <= 0 || z >= maxNativeZ) {
        callback(false);
        return;
      }

      let pending = 4;
      let anySuccess = false;
      const half = destSize / 2;
      const childDone = (childSuccess) => {
        if (childSuccess) anySuccess = true;
        pending -= 1;
        if (pending === 0) callback(anySuccess);
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

// Attempts to fill a missing tile from lower zoom parents by cropping and scaling.
// Callback receives true when a parent tile was found and drawn.
export function loadTileFromParentChain(queue, ctx, tileUrl, z, x, y, maxLevelsUp, callback) {
  const tryLevel = (levelUp) => {
    if (levelUp > maxLevelsUp || z - levelUp < 0) {
      callback(false);
      return;
    }

    queue.run((release) => {
      const parentZ = z - levelUp;
      const scale = 2 ** levelUp;
      const parentX = Math.floor(x / scale);
      const parentY = Math.floor(y / scale);
      const safeX = wrapX(parentX, parentZ);
      const safeY = clampY(parentY, parentZ);
      const url = L.Util.template(tileUrl, { z: parentZ, x: safeX, y: safeY });

      loadImageDeduped(url).then((img) => {
        release();

        if (!img) {
          tryLevel(levelUp + 1);
          return;
        }

        const srcSize = 256 / scale;
        const srcX = ((x % scale) + scale) % scale;
        const srcY = ((y % scale) + scale) % scale;

        ctx.drawImage(
          img,
          srcX * srcSize,
          srcY * srcSize,
          srcSize,
          srcSize,
          0,
          0,
          256,
          256,
        );

        callback(true);
      });
    });
  };

  tryLevel(1);
}
