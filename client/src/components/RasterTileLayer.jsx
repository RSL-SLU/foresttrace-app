import React, { useCallback, useEffect, useRef } from 'react';
import { TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import { BIOMASS_BINS, createEmptyBiomassHistogram } from '../utils/biomassHistogram';
import { makeTileQueue, loadTileComposite, loadTileFromParentChain } from '../utils/tileLoading';

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
const RASTER_TILE_CLASS = 'foresttrace-raster-tile';
const USE_BIOMASS_CANVAS_PIPELINE = false;

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

function hasOpaquePixels(ctx) {
  const imageData = ctx.getImageData(0, 0, 256, 256);
  const pixels = imageData.data;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] > 0) return true;
  }
  return false;
}

function isStaleTileZoom(map, tileZ) {
  const tileZoom = map && typeof map._tileZoom === 'number' ? map._tileZoom : null;
  return tileZoom !== null && tileZoom !== tileZ;
}

function tileDebug(event, payload) {
  if (typeof window === 'undefined' || !window.__FORESTTRACE_TILE_DEBUG__) return;
  console.log('[TileDebug]', event, payload);
}

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

    const rule = `.${RASTER_TILE_CLASS} { opacity: ${opacity} !important; }`;
    styleTagRef.current.textContent = rule;
  }, [opacity, layerId]);

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

    if ((layerId === 'clearcut-accumulated' || layerId === 'clearcut-annual') && img?.dataset?.clearcutProcessed === 'true') {
      return;
    }

    if (layerId === 'biomass-density' && img?.dataset?.biomassProcessed === 'true') {
      return;
    }

    if (layerId === 'wildfire-burned' && img?.dataset?.wildfireProcessed === 'true') {
      return;
    }

    if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = img.naturalWidth;
      tmpCanvas.height = img.naturalHeight;
      const ctx = tmpCanvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, tmpCanvas.width, tmpCanvas.height).data;

      let redCount = 0;
      let totalCount = 0;
      const tileHistogram = layerId === 'biomass-density' ? createEmptyBiomassHistogram() : null;
      const pixelAreaHa = layerId === 'biomass-density' && e.coords
        ? getTilePixelAreaHa(e.coords)
        : 0;

      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const a = pixels[i + 3];
        totalCount += 1;

        if (layerId === 'clearcut-accumulated' || layerId === 'clearcut-annual') {
          if (a > 0 && r > 200) {
            redCount += 1;
          }
          if (a === 0) continue;
          const intensity = r / 255;
          if (layerId === 'clearcut-annual') {
            // Yellow tint (#FFD700)
            pixels[i]     = Math.round((r * 0.35) + (255 * intensity * 0.65));
            pixels[i + 1] = Math.round(215 * intensity);
            pixels[i + 2] = Math.round(b * 0.05);
          } else {
            // Red tint for accumulated
            pixels[i]     = Math.round((r * 0.35) + (255 * intensity * 0.65));
            pixels[i + 1] = Math.round(g * 0.18);
            pixels[i + 2] = Math.round(b * 0.18);
          }
          continue;
        }

        if (layerId === 'wildfire-burned') {
          if (a > 0 && r > 200) {
            redCount += 1;
          }
          if (a === 0) continue;
          const intensity = r / 255;
          // Fire red (#F8420B). Distinct from the clearcut-accumulated red
          // (255,46,46), which is pinker, and from the clearcut-annual yellow.
          pixels[i]     = Math.round(248 * intensity);
          pixels[i + 1] = Math.round(66 * intensity);
          pixels[i + 2] = Math.round(11 * intensity);
          continue;
        }

        if (layerId === 'biomass-density') {
          if (a === 0) continue;

          const agb = (g / 255) * 1000;
          if (tileHistogram) {
            for (let binIdx = 0; binIdx < BIOMASS_BINS.length; binIdx += 1) {
              const bin = BIOMASS_BINS[binIdx];
              if (agb >= bin.min && agb < bin.max) {
                tileHistogram[binIdx].pixels += 1;
                tileHistogram[binIdx].area += pixelAreaHa;
                break;
              }
            }
          }

          const color = getColorForBiomassIntensity(g);
          pixels[i] = color.r;
          pixels[i + 1] = color.g;
          pixels[i + 2] = color.b;
          continue;
        }

        if (a > 0 && r === 255 && g === 0 && b === 0) {
          redCount += 1;
        }
      }

      if (layerId === 'clearcut-accumulated' || layerId === 'clearcut-annual') {
        ctx.putImageData(new ImageData(pixels, tmpCanvas.width, tmpCanvas.height), 0, 0);
        img.dataset.clearcutProcessed = 'true';
        img.src = tmpCanvas.toDataURL('image/png');
      }

      if (layerId === 'wildfire-burned') {
        ctx.putImageData(new ImageData(pixels, tmpCanvas.width, tmpCanvas.height), 0, 0);
        img.dataset.wildfireProcessed = 'true';
        img.src = tmpCanvas.toDataURL('image/png');
      }

      if (layerId === 'biomass-density') {
        ctx.putImageData(new ImageData(pixels, tmpCanvas.width, tmpCanvas.height), 0, 0);
        img.dataset.biomassProcessed = 'true';
        img.src = tmpCanvas.toDataURL('image/png');

        if (e.coords && tileHistogram) {
          const key = `${e.coords.z}/${e.coords.x}/${e.coords.y}`;
          biomassTileHistogramRef.current.set(key, tileHistogram);
          emitBiomassHistogram();
        }
      }

      if (e.coords && layerId !== 'biomass-density') {
        const key = `${e.coords.z}/${e.coords.x}/${e.coords.y}`;
        tileCountsRef.current.set(key, { red: redCount, total: totalCount });
      }

      if (layerId !== 'biomass-density') {
        updateVisiblePercentage();
      }
    }
  }, [emitBiomassHistogram, layerId, updateVisiblePercentage]);

  const handleClearcutTileError = useCallback((e) => {
    if (!e.coords) return;
    const key = `${e.coords.z}/${e.coords.x}/${e.coords.y}`;
    tileCountsRef.current.delete(key);
    updateVisiblePercentage();
  }, [updateVisiblePercentage]);

  const handleClearcutTileUnload = useCallback((e) => {
    if (!e.coords) return;
    const key = `${e.coords.z}/${e.coords.x}/${e.coords.y}`;
    tileCountsRef.current.delete(key);
    updateVisiblePercentage();
  }, [updateVisiblePercentage]);

  const handleBiomassTileError = useCallback((e) => {
    if (!e.coords) return;
    const key = `${e.coords.z}/${e.coords.x}/${e.coords.y}`;
    biomassTileHistogramRef.current.delete(key);
    emitBiomassHistogram();
  }, [emitBiomassHistogram]);

  const handleBiomassTileUnload = useCallback((e) => {
    if (!e.coords) return;
    const key = `${e.coords.z}/${e.coords.x}/${e.coords.y}`;
    biomassTileHistogramRef.current.delete(key);
    emitBiomassHistogram();
  }, [emitBiomassHistogram]);

  const getTilePixelAreaHa = (coords) => {
    const tilesPerAxis = Math.pow(2, coords.z);
    const centerY = coords.y + 0.5;
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * centerY) / tilesPerAxis)));
    const metersPerPixel = (156543.03392 * Math.cos(latRad)) / tilesPerAxis;
    return (metersPerPixel * metersPerPixel) / 10000;
  };

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
    if (!map || layerId !== 'biomass-density' || !USE_BIOMASS_CANVAS_PIPELINE) return;

    if (onLoadingChangeRef.current) onLoadingChangeRef.current(true);
    const activeTileRequests = activeTileRequestsRef.current;

    const biomassHistogram = biomassTileHistogramRef.current;
    biomassHistogram.clear();
    if (onBiomassHistogramUpdateRef.current) {
      onBiomassHistogramUpdateRef.current(createEmptyBiomassHistogram());
    }

    const tileLoadQueue = makeTileQueue(8);
    const handleZoomStart = () => {
      activeTileRequests.clear();
    };
    map.on('zoomstart', handleZoomStart);

    const CanvasTileLayer = L.GridLayer.extend({
      createTile(coords, done) {
        const normalizedCoords = normalizeTileCoords(coords);
        const tileKey = `${normalizedCoords.z}/${normalizedCoords.x}/${normalizedCoords.y}`;
        tileDebug('biomass:create', { tileKey, tileZoom: map?._tileZoom, mapZoom: map?.getZoom?.() });
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

            const color = getColorForBiomassIntensity(g);
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
          const finalizeBiomassTile = (shouldCache = true) => {
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

              const color = getColorForBiomassIntensity(g);
              pixels[i] = color.r;
              pixels[i + 1] = color.g;
              pixels[i + 2] = color.b;
            }

            biomassTileHistogramRef.current.set(tileKey, tileHistogram);
            emitBiomassHistogram();
            ctx.putImageData(imageData, 0, 0);
            if (shouldCache) {
              if (!processedTileCacheRef.current.has(tileUrl)) {
                processedTileCacheRef.current.set(tileUrl, new Map());
              }
              processedTileCacheRef.current.get(tileUrl).set(tileKey, { canvas, histogram: tileHistogram });
            }
            resolveInFlight(canvas);
            activeTileRequests.delete(tileKey);
            done(null, canvas);
          };

          const drawFromCachedParent = () => {
            const urlCache = processedTileCacheRef.current.get(tileUrl);
            if (!urlCache) return false;

            for (let levelUp = 1; levelUp <= 4; levelUp += 1) {
              const parentZ = normalizedCoords.z - levelUp;
              if (parentZ < TILE_ZOOM_RANGE.min) break;

              const scale = 2 ** levelUp;
              const parentX = Math.floor(normalizedCoords.x / scale);
              const parentY = Math.floor(normalizedCoords.y / scale);
              const parentKey = `${parentZ}/${parentX}/${parentY}`;
              const cachedParent = urlCache.get(parentKey);
              if (!cachedParent?.canvas) continue;

              const srcSize = 256 / scale;
              const srcX = (((normalizedCoords.x % scale) + scale) % scale) * srcSize;
              const srcY = (((normalizedCoords.y % scale) + scale) % scale) * srcSize;

              ctx.drawImage(
                cachedParent.canvas,
                srcX,
                srcY,
                srcSize,
                srcSize,
                0,
                0,
                256,
                256,
              );

              return true;
            }

            return false;
          };

          const failTile = () => {
            if (drawFromCachedParent()) {
              tileDebug('biomass:cache-parent-rescue', { tileKey });
              finalizeBiomassTile(false);
              return;
            }

            tileDebug('biomass:fail', {
              tileKey,
              tileZoom: map?._tileZoom,
              mapZoom: map?.getZoom?.(),
            });
            resolveInFlight(null);
            activeTileRequests.delete(tileKey);
            done(null, canvas);
          };

          if (isStaleTileZoom(map, normalizedCoords.z)) {
            failTile();
            return;
          }

          loadTileFromParentChain(
            tileLoadQueue,
            ctx,
            tileUrl,
            nativeCoords.z,
            nativeCoords.x,
            nativeCoords.y,
            3,
            (parentSuccess) => {
              if (isStaleTileZoom(map, normalizedCoords.z)) {
                failTile();
                return;
              }

              if (parentSuccess && hasOpaquePixels(ctx)) {
                tileDebug('biomass:parent-rescue', { tileKey });
                finalizeBiomassTile(true);
                return;
              }

              if (nativeCoords.z >= NATIVE_TILE_ZOOM_RANGE.max) {
                failTile();
                return;
              }

              let pending = 4;
              let anyCompositeSuccess = false;
              const half = 128;
              const onAllDone = (childSuccess) => {
                if (childSuccess) anyCompositeSuccess = true;
                pending -= 1;
                if (pending !== 0) return;

                if (isStaleTileZoom(map, normalizedCoords.z)) {
                  failTile();
                  return;
                }

                if (!anyCompositeSuccess && !hasOpaquePixels(ctx)) {
                  failTile();
                  return;
                }

                tileDebug('biomass:child-rescue', { tileKey, anyCompositeSuccess });

                finalizeBiomassTile(false);
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
                    1,
                    onAllDone,
                  );
                }
              }
            },
          );
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
      className: RASTER_TILE_CLASS,
    });

    canvasLayerRef.current = canvasLayer;
    canvasLayer.addTo(map);

    const handleZoomEndRefresh = () => {
      // Re-request currently visible tiles after zoom settles to recover
      // from transient misses during animation.
      activeTileRequests.clear();
      canvasLayer.redraw();
    };
    map.on('zoomend', handleZoomEndRefresh);

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
      map.off('zoomstart', handleZoomStart);
      map.off('zoomend', handleZoomEndRefresh);
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

  if (layerId === 'biomass-density' && USE_BIOMASS_CANVAS_PIPELINE) {
    return null;
  }

  if (layerId === 'biomass-density') {
    return (
      <>
        <TileLayer
          ref={lowResLayerRef}
          url={tileUrl}
          minZoom={TILE_ZOOM_RANGE.min}
          maxZoom={12}
          maxNativeZoom={12}
          zIndex={10}
          className={RASTER_TILE_CLASS}
          tms={tms}
          crossOrigin="anonymous"
          keepBuffer={1}
          pmIgnore={true}
          eventHandlers={{
            loading: () => {
              if (onLoadingChangeRef.current) onLoadingChangeRef.current(true);
            },
            load: () => {
              if (onLoadingChangeRef.current) onLoadingChangeRef.current(false);
            },
            tileload: (e) => {
              handleTileLoad(e);
            },
            tileerror: (e) => {
              handleBiomassTileError(e);
            },
            tileunload: (e) => {
              handleBiomassTileUnload(e);
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
          className={RASTER_TILE_CLASS}
          tms={tms}
          crossOrigin="anonymous"
          keepBuffer={1}
          pmIgnore={true}
          eventHandlers={{
            loading: () => {
              if (onLoadingChangeRef.current) onLoadingChangeRef.current(true);
            },
            load: () => {
              if (onLoadingChangeRef.current) onLoadingChangeRef.current(false);
            },
            tileload: (e) => {
              handleTileLoad(e);
            },
            tileerror: (e) => {
              handleBiomassTileError(e);
            },
            tileunload: (e) => {
              handleBiomassTileUnload(e);
            },
          }}
        />
      </>
    );
  }

  if (layerId === 'clearcut-accumulated' || layerId === 'clearcut-annual' || layerId === 'wildfire-burned') {
    return (
      <TileLayer
        ref={highResLayerRef}
        url={tileUrl}
        minZoom={TILE_ZOOM_RANGE.min}
        maxZoom={TILE_ZOOM_RANGE.max}
        maxNativeZoom={NATIVE_TILE_ZOOM_RANGE.max}
        zIndex={10}
        className={RASTER_TILE_CLASS}
        tms={tms}
        crossOrigin="anonymous"
        keepBuffer={1}
        eventHandlers={{
          loading: () => {
            if (onLoadingChangeRef.current) onLoadingChangeRef.current(true);
          },
          load: () => {
            if (onLoadingChangeRef.current) onLoadingChangeRef.current(false);
            updateVisiblePercentage();
          },
          tileload: (e) => {
            handleTileLoad(e);
          },
          tileerror: (e) => {
            handleClearcutTileError(e);
          },
          tileunload: (e) => {
            handleClearcutTileUnload(e);
          },
        }}
      />
    );
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
        className={RASTER_TILE_CLASS}
        tms={tms}
        crossOrigin="anonymous"
        keepBuffer={1}
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
        className={RASTER_TILE_CLASS}
        tms={tms}
        crossOrigin="anonymous"
        keepBuffer={1}
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
