import React, { useCallback, useEffect, useRef } from 'react';
import { TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import { BIOMASS_BINS, createEmptyBiomassHistogram } from '../utils/biomassHistogram';
import { makeTileQueue, loadTileComposite } from '../utils/tileLoading';

const NATIVE_TILE_ZOOM_LEVELS = [6, 7, 8, 9, 10, 11, 12, 13, 14];
const TILE_ZOOM_LEVELS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
const TILE_ZOOM_RANGE = {
  min: Math.min(...TILE_ZOOM_LEVELS),
  max: Math.max(...TILE_ZOOM_LEVELS),
};
const NATIVE_TILE_ZOOM_RANGE = {
  min: Math.min(...NATIVE_TILE_ZOOM_LEVELS),
  max: Math.max(...NATIVE_TILE_ZOOM_LEVELS),
};

function wrapTileX(x, z) {
  const tilesPerAxis = 2 ** z;
  return ((x % tilesPerAxis) + tilesPerAxis) % tilesPerAxis;
}

function clampTileY(y, z) {
  const max = (2 ** z) - 1;
  if (y < 0) return 0;
  if (y > max) return max;
  return y;
}

function normalizeTileCoords(coords) {
  return {
    ...coords,
    x: wrapTileX(coords.x, coords.z),
    y: clampTileY(coords.y, coords.z),
  };
}

function RasterTileLayer({
  onStatsUpdate,
  onBiomassHistogramUpdate,
  onLoadingChange = null,
  opacity = 0.5,
  tileUrl,
  tms = true,
  layerId = '',
}) {
  const map = useMap();
  const lowResLayerRef = useRef(null);
  const highResLayerRef = useRef(null);
  const canvasLayerRef = useRef(null);
  const tileCountsRef = useRef(new Map());
  const biomassTileHistogramRef = useRef(new Map());
  const styleTagRef = useRef(null);
  const processedTileCacheRef = useRef(new Map());
  const activeTileRequestsRef = useRef(new Map());
  const onStatsUpdateRef = useRef(onStatsUpdate);
  const onBiomassHistogramUpdateRef = useRef(onBiomassHistogramUpdate);
  const onLoadingChangeRef = useRef(onLoadingChange);

  onStatsUpdateRef.current = onStatsUpdate;
  onBiomassHistogramUpdateRef.current = onBiomassHistogramUpdate;
  onLoadingChangeRef.current = onLoadingChange;

  useEffect(() => {
    if (!styleTagRef.current) {
      const style = document.createElement('style');
      style.id = 'tile-opacity-rule';
      document.head.appendChild(style);
      styleTagRef.current = style;
    }

    const rule = `img[src*="/tiles/"], canvas.leaflet-tile { opacity: ${opacity} !important; }`;
    styleTagRef.current.textContent = rule;
  }, [opacity, layerId]);

  const updateVisiblePercentage = useCallback(() => {
    let visibleRed = 0;
    let visibleTotal = 0;

    [lowResLayerRef.current, highResLayerRef.current, canvasLayerRef.current].forEach((layer) => {
      if (!layer || !layer._tiles) return;
      Object.values(layer._tiles).forEach((tile) => {
        if (!tile || !tile.coords) return;
        const key = `${tile.coords.z}/${tile.coords.x}/${tile.coords.y}`;
        const counts = tileCountsRef.current.get(key);
        if (!counts) return;
        visibleRed += counts.red;
        visibleTotal += counts.total;
      });
    });

    const percentage = visibleTotal > 0
      ? ((visibleRed / visibleTotal) * 100).toFixed(2)
      : '0.00';

    if (onStatsUpdateRef.current) onStatsUpdateRef.current(percentage);
  }, []);

  const handleTileLoad = useCallback((e) => {
    const img = e.tile;

    if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = img.naturalWidth;
      tmpCanvas.height = img.naturalHeight;
      const ctx = tmpCanvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, tmpCanvas.width, tmpCanvas.height).data;

      let redCount = 0;
      let totalCount = 0;

      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const a = pixels[i + 3];
        totalCount += 1;
        if (a > 0 && r === 255 && g === 0 && b === 0) {
          redCount += 1;
        }
      }

      if (e.coords) {
        const key = `${e.coords.z}/${e.coords.x}/${e.coords.y}`;
        tileCountsRef.current.set(key, { red: redCount, total: totalCount });
      }
      updateVisiblePercentage();
    }
  }, [updateVisiblePercentage]);

  const getTilePixelAreaHa = (coords) => {
    const tilesPerAxis = Math.pow(2, coords.z);
    const centerY = coords.y + 0.5;
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * centerY) / tilesPerAxis)));
    const metersPerPixel = (156543.03392 * Math.cos(latRad)) / tilesPerAxis;
    return (metersPerPixel * metersPerPixel) / 10000;
  };

  const emitBiomassHistogram = useCallback(() => {
    if (!onBiomassHistogramUpdateRef.current) return;
    const combined = createEmptyBiomassHistogram();
    biomassTileHistogramRef.current.forEach((tileBins) => {
      tileBins.forEach((tileBin, idx) => {
        combined[idx].area += tileBin.area;
        combined[idx].pixels += tileBin.pixels;
      });
    });
    onBiomassHistogramUpdateRef.current(combined);
  }, []);

  useEffect(() => {
    if (!map) return;
    const handleMove = () => updateVisiblePercentage();
    map.on('moveend', handleMove);
    map.on('zoomend', handleMove);
    return () => {
      map.off('moveend', handleMove);
      map.off('zoomend', handleMove);
    };
  }, [map, updateVisiblePercentage]);

  useEffect(() => {
    if (!map || layerId !== 'biomass-density') return;

    if (onLoadingChangeRef.current) onLoadingChangeRef.current(true);
    const activeTileRequests = activeTileRequestsRef.current;

    const biomassHistogram = biomassTileHistogramRef.current;
    biomassHistogram.clear();
    if (onBiomassHistogramUpdateRef.current) {
      onBiomassHistogramUpdateRef.current(createEmptyBiomassHistogram());
    }

    const tileLoadQueue = makeTileQueue(20);

    const getColorForIntensity = (rawIntensity) => {
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
    };

    const CanvasTileLayer = L.GridLayer.extend({
      createTile(coords, done) {
        const normalizedCoords = normalizeTileCoords(coords);
        const tileKey = `${normalizedCoords.z}/${normalizedCoords.x}/${normalizedCoords.y}`;
        const urlCache = processedTileCacheRef.current.get(tileUrl);

        if (urlCache && urlCache.has(tileKey)) {
          const { canvas: cachedCanvas, histogram } = urlCache.get(tileKey);
          const newCanvas = document.createElement('canvas');
          newCanvas.width = 256;
          newCanvas.height = 256;
          newCanvas.getContext('2d').drawImage(cachedCanvas, 0, 0);
          biomassTileHistogramRef.current.set(tileKey, histogram);
          emitBiomassHistogram();
          done(null, newCanvas);
          return newCanvas;
        }

        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        if (activeTileRequests.has(tileKey)) {
          activeTileRequests.get(tileKey).then((sharedCanvas) => {
            if (sharedCanvas) {
              ctx.drawImage(sharedCanvas, 0, 0);
            }
            done(null, canvas);
          });
          return canvas;
        }

        let resolveInFlight;
        const inFlightPromise = new Promise((resolve) => {
          resolveInFlight = resolve;
        });
        activeTileRequests.set(tileKey, inFlightPromise);

        const nativeZ = Math.min(normalizedCoords.z, NATIVE_TILE_ZOOM_RANGE.max);
        const zoomDiff = normalizedCoords.z - nativeZ;
        const scale = 2 ** zoomDiff;
        const nativeCoords = normalizeTileCoords({
          ...normalizedCoords,
          z: nativeZ,
          x: Math.floor(normalizedCoords.x / scale),
          y: Math.floor(normalizedCoords.y / scale),
        });
        const srcSize = 256 / scale;
        const srcX = (normalizedCoords.x % scale) * srcSize;
        const srcY = (normalizedCoords.y % scale) * srcSize;

        const img = new Image();
        img.crossOrigin = 'anonymous';

        img.onload = () => {
          ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, 256, 256);

          const imageData = ctx.getImageData(0, 0, 256, 256);
          const pixels = imageData.data;

          const tileHistogram = createEmptyBiomassHistogram();
          const pixelAreaHa = getTilePixelAreaHa(normalizedCoords);

          for (let i = 0; i < pixels.length; i += 4) {
            const g = pixels[i + 1];
            const a = pixels[i + 3];
            if (a === 0) continue;

            const agb = (g / 255) * 1000;
            for (let binIdx = 0; binIdx < BIOMASS_BINS.length; binIdx += 1) {
              const bin = BIOMASS_BINS[binIdx];
              if (agb >= bin.min && agb < bin.max) {
                tileHistogram[binIdx].pixels += 1;
                tileHistogram[binIdx].area += pixelAreaHa;
                break;
              }
            }

            const color = getColorForIntensity(g);
            pixels[i] = color.r;
            pixels[i + 1] = color.g;
            pixels[i + 2] = color.b;
          }

          biomassTileHistogramRef.current.set(tileKey, tileHistogram);
          emitBiomassHistogram();

          ctx.putImageData(imageData, 0, 0);
          if (!processedTileCacheRef.current.has(tileUrl)) {
            processedTileCacheRef.current.set(tileUrl, new Map());
          }
          processedTileCacheRef.current.get(tileUrl).set(tileKey, { canvas, histogram: tileHistogram });
          resolveInFlight(canvas);
          activeTileRequests.delete(tileKey);
          done(null, canvas);
        };

        img.onerror = () => {
          if (nativeCoords.z >= NATIVE_TILE_ZOOM_RANGE.max) {
            resolveInFlight(null);
            activeTileRequests.delete(tileKey);
            done(null, canvas);
            return;
          }

          let pending = 4;
          const half = 128;
          const onAllDone = () => {
            pending -= 1;
            if (pending !== 0) return;

            const imageData = ctx.getImageData(0, 0, 256, 256);
            const pixels = imageData.data;
            const tileHistogram = createEmptyBiomassHistogram();
            const pixelAreaHa = getTilePixelAreaHa(normalizedCoords);

            for (let i = 0; i < pixels.length; i += 4) {
              const g = pixels[i + 1];
              const a = pixels[i + 3];
              if (a === 0) continue;

              const agb = (g / 255) * 1000;
              for (let binIdx = 0; binIdx < BIOMASS_BINS.length; binIdx += 1) {
                const bin = BIOMASS_BINS[binIdx];
                if (agb >= bin.min && agb < bin.max) {
                  tileHistogram[binIdx].pixels += 1;
                  tileHistogram[binIdx].area += pixelAreaHa;
                  break;
                }
              }

              const color = getColorForIntensity(g);
              pixels[i] = color.r;
              pixels[i + 1] = color.g;
              pixels[i + 2] = color.b;
            }

            biomassTileHistogramRef.current.set(tileKey, tileHistogram);
            emitBiomassHistogram();
            ctx.putImageData(imageData, 0, 0);
            if (!processedTileCacheRef.current.has(tileUrl)) {
              processedTileCacheRef.current.set(tileUrl, new Map());
            }
            processedTileCacheRef.current.get(tileUrl).set(tileKey, { canvas, histogram: tileHistogram });
            resolveInFlight(canvas);
            activeTileRequests.delete(tileKey);
            done(null, canvas);
          };

          for (let dx = 0; dx < 2; dx += 1) {
            for (let dy = 0; dy < 2; dy += 1) {
              loadTileComposite(
                tileLoadQueue,
                ctx,
                tileUrl,
                nativeCoords.z + 1,
                nativeCoords.x * 2 + dx,
                nativeCoords.y * 2 + dy,
                dx * half,
                dy * half,
                half,
                NATIVE_TILE_ZOOM_RANGE.max,
                3,
                onAllDone,
              );
            }
          }
        };

        const url = L.Util.template(tileUrl, nativeCoords);
        img.src = url;

        return canvas;
      },
    });

    const canvasLayer = new CanvasTileLayer({
      minZoom: TILE_ZOOM_RANGE.min,
      maxZoom: TILE_ZOOM_RANGE.max,
      tms,
      zIndex: 10,
    });

    canvasLayerRef.current = canvasLayer;
    canvasLayer.addTo(map);

    const handleTileUnload = (event) => {
      if (!event.coords) return;
      const key = `${event.coords.z}/${event.coords.x}/${event.coords.y}`;
      biomassTileHistogramRef.current.delete(key);
      emitBiomassHistogram();
    };

    canvasLayer.on('tileunload', handleTileUnload);
    canvasLayer.once('tileload', () => {
      if (onLoadingChangeRef.current) onLoadingChangeRef.current(false);
    });

    return () => {
      tileLoadQueue.cancel();
      activeTileRequests.clear();
      if (onLoadingChangeRef.current) onLoadingChangeRef.current(false);
      canvasLayer.off('tileunload', handleTileUnload);
      map.removeLayer(canvasLayer);
      canvasLayerRef.current = null;
      biomassHistogram.clear();
      if (onBiomassHistogramUpdateRef.current) {
        onBiomassHistogramUpdateRef.current(createEmptyBiomassHistogram());
      }
    };
  }, [map, layerId, tileUrl, tms, emitBiomassHistogram]);

  useEffect(() => {
    if (!map || layerId !== 'clearcut-annual') return;

    tileCountsRef.current.clear();
    if (onLoadingChangeRef.current) onLoadingChangeRef.current(true);
    const activeTileRequests = activeTileRequestsRef.current;

    const tileLoadQueue = makeTileQueue(20);

    const CanvasTileLayer = L.GridLayer.extend({
      createTile(coords, done) {
        const normalizedCoords = normalizeTileCoords(coords);
        const tileKey = `${normalizedCoords.z}/${normalizedCoords.x}/${normalizedCoords.y}`;
        const urlCache = processedTileCacheRef.current.get(tileUrl);

        if (urlCache && urlCache.has(tileKey)) {
          const { canvas: cachedCanvas, counts } = urlCache.get(tileKey);
          const newCanvas = document.createElement('canvas');
          newCanvas.width = 256;
          newCanvas.height = 256;
          newCanvas.getContext('2d').drawImage(cachedCanvas, 0, 0);
          tileCountsRef.current.set(tileKey, counts);
          updateVisiblePercentage();
          done(null, newCanvas);
          return newCanvas;
        }

        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        if (activeTileRequests.has(tileKey)) {
          activeTileRequests.get(tileKey).then((sharedCanvas) => {
            if (sharedCanvas) {
              ctx.drawImage(sharedCanvas, 0, 0);
            }
            done(null, canvas);
          });
          return canvas;
        }

        let resolveInFlight;
        const inFlightPromise = new Promise((resolve) => {
          resolveInFlight = resolve;
        });
        activeTileRequests.set(tileKey, inFlightPromise);

        const nativeZ = Math.min(normalizedCoords.z, NATIVE_TILE_ZOOM_RANGE.max);
        const zoomDiff = normalizedCoords.z - nativeZ;
        const scale = 2 ** zoomDiff;
        const nativeCoords = normalizeTileCoords({
          ...normalizedCoords,
          z: nativeZ,
          x: Math.floor(normalizedCoords.x / scale),
          y: Math.floor(normalizedCoords.y / scale),
        });
        const srcSize = 256 / scale;
        const srcX = (normalizedCoords.x % scale) * srcSize;
        const srcY = (normalizedCoords.y % scale) * srcSize;

        const img = new Image();
        img.crossOrigin = 'anonymous';

        img.onload = () => {
          ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, 256, 256);

          const imageData = ctx.getImageData(0, 0, 256, 256);
          const pixels = imageData.data;

          let clearcutCount = 0;
          let totalCount = 0;

          for (let i = 0; i < pixels.length; i += 4) {
            const r = pixels[i];
            const a = pixels[i + 3];
            totalCount += 1;
            if (a > 0 && r > 200) {
              clearcutCount += 1;
            }
            if (a === 0) continue;
            const intensity = r / 255;
            pixels[i] = Math.round(255 * intensity);
            pixels[i + 1] = 0;
            pixels[i + 2] = 0;
          }

          tileCountsRef.current.set(tileKey, { red: clearcutCount, total: totalCount });

          ctx.putImageData(imageData, 0, 0);
          if (!processedTileCacheRef.current.has(tileUrl)) {
            processedTileCacheRef.current.set(tileUrl, new Map());
          }
          processedTileCacheRef.current.get(tileUrl).set(tileKey, {
            canvas,
            counts: { red: clearcutCount, total: totalCount },
          });
          resolveInFlight(canvas);
          activeTileRequests.delete(tileKey);
          done(null, canvas);
          updateVisiblePercentage();
        };

        img.onerror = () => {
          if (nativeCoords.z >= NATIVE_TILE_ZOOM_RANGE.max) {
            resolveInFlight(null);
            activeTileRequests.delete(tileKey);
            done(null, canvas);
            return;
          }

          let pending = 4;
          const half = 128;
          const onAllDone = () => {
            pending -= 1;
            if (pending !== 0) return;

            const imageData = ctx.getImageData(0, 0, 256, 256);
            const pixels = imageData.data;
            let clearcutCount = 0;
            let totalCount = 0;

            for (let i = 0; i < pixels.length; i += 4) {
              const r = pixels[i];
              const a = pixels[i + 3];
              totalCount += 1;
              if (a > 0 && r > 200) clearcutCount += 1;
              if (a === 0) continue;
              const intensity = r / 255;
              pixels[i] = Math.round(255 * intensity);
              pixels[i + 1] = 0;
              pixels[i + 2] = 0;
            }

            ctx.putImageData(imageData, 0, 0);
            tileCountsRef.current.set(tileKey, { red: clearcutCount, total: totalCount });
            if (!processedTileCacheRef.current.has(tileUrl)) {
              processedTileCacheRef.current.set(tileUrl, new Map());
            }
            processedTileCacheRef.current.get(tileUrl).set(tileKey, {
              canvas,
              counts: { red: clearcutCount, total: totalCount },
            });
            resolveInFlight(canvas);
            activeTileRequests.delete(tileKey);
            done(null, canvas);
            updateVisiblePercentage();
          };

          for (let dx = 0; dx < 2; dx += 1) {
            for (let dy = 0; dy < 2; dy += 1) {
              loadTileComposite(
                tileLoadQueue,
                ctx,
                tileUrl,
                nativeCoords.z + 1,
                nativeCoords.x * 2 + dx,
                nativeCoords.y * 2 + dy,
                dx * half,
                dy * half,
                half,
                NATIVE_TILE_ZOOM_RANGE.max,
                3,
                onAllDone,
              );
            }
          }
        };

        const url = L.Util.template(tileUrl, nativeCoords);
        img.src = url;

        return canvas;
      },
    });

    const canvasLayer = new CanvasTileLayer({
      minZoom: TILE_ZOOM_RANGE.min,
      maxZoom: TILE_ZOOM_RANGE.max,
      tms,
      zIndex: 10,
    });

    canvasLayerRef.current = canvasLayer;
    canvasLayer.addTo(map);

    const handleTileUnload = (event) => {
      if (!event.coords) return;
      const tileKey = `${event.coords.z}/${event.coords.x}/${event.coords.y}`;
      tileCountsRef.current.delete(tileKey);
    };

    canvasLayer.on('tileunload', handleTileUnload);
    canvasLayer.once('tileload', () => {
      if (onLoadingChangeRef.current) onLoadingChangeRef.current(false);
    });

    return () => {
      tileLoadQueue.cancel();
      activeTileRequests.clear();
      if (onLoadingChangeRef.current) onLoadingChangeRef.current(false);
      canvasLayer.off('tileunload', handleTileUnload);
      map.removeLayer(canvasLayer);
      canvasLayerRef.current = null;
    };
  }, [map, layerId, tileUrl, tms, updateVisiblePercentage]);

  if (layerId === 'biomass-density' || layerId === 'clearcut-annual') {
    return null;
  }

  return (
    <>
      <TileLayer
        ref={lowResLayerRef}
        url={tileUrl}
        minZoom={TILE_ZOOM_RANGE.min}
        maxZoom={12}
        maxNativeZoom={12}
        zIndex={10}
        tms={tms}
        crossOrigin="anonymous"
        eventHandlers={{
          tileload: (e) => {
            handleTileLoad(e);
          },
        }}
      />
      <TileLayer
        ref={highResLayerRef}
        url={tileUrl}
        minZoom={13}
        maxZoom={TILE_ZOOM_RANGE.max}
        maxNativeZoom={NATIVE_TILE_ZOOM_RANGE.max}
        zIndex={10}
        tms={tms}
        crossOrigin="anonymous"
        eventHandlers={{
          tileload: (e) => {
            handleTileLoad(e);
          },
        }}
      />
    </>
  );
}

export default RasterTileLayer;
