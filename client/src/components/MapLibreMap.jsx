import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Map, { Source, Layer, NavigationControl, Popup, useMap } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import { cogProtocol, locationValues, setColorFunction } from '@geomatico/maplibre-cog-protocol';
import { Protocol as PMTilesProtocol } from 'pmtiles';
import 'maplibre-gl/dist/maplibre-gl.css';
import { buildClassColorFunction } from '../utils/rasterClasses';
import { CLEARCUT_CLASSES, DEFAULT_VISIBLE_CLASSES, CLEARCUT_CLASS_ID } from '../utils/clearcutClasses';
import { ensureTintedProtocol, onTintActivity } from '../utils/tintedTileProtocol';
import { processTile } from '../utils/tileWorkerClient';
import { describeStatus } from '../utils/borealLayers';

// COG support is a URL protocol handler, not a layer type: once registered,
// any source whose url starts with cog:// is range-read straight from R2 with
// no tile server in between. Registered at module scope because MapLibre keeps
// one global protocol registry -- doing it per-mount would re-register on every
// remount and throw.
let cogProtocolRegistered = false;

// COG url -> { layerId, subtractUrl }, for layers drawn as outlines rather than
// fills (the ML clearcut estimates, laid over the filled ARI layers).
// setColorFunction sees one pixel at a time, and an edge needs its neighbours,
// so the outline is a pass over the finished tile instead -- the same one the
// tile worker runs.
//
// subtractUrl is another COG whose painted pixels are removed first: the ML
// annual layer draws accumulated(Y) minus accumulated(previous year), so a
// stand only appears in the year it entered the window.
const cogOutlineLayers = new window.Map();  // `Map` here is react-map-gl's

function bitmapPixels(bitmap) {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Renders one COG tile to pixels, with the outline pass for outline layers. */
async function renderCogTile(params) {
  const current = await cogProtocol(params);
  const imageData = bitmapPixels(current.data);

  // Same shape cogProtocol parses: cog://<cog url>[#hash]/z/x/y
  const match = params.url.match(/^cog:\/\/(.+)\/(\d+)\/(\d+)\/(\d+)$/);
  const entry = match && cogOutlineLayers.get(match[1]);
  if (!entry) return imageData;

  const [z, x, y] = [match[2], match[3], match[4]];
  if (entry.subtractUrl) {
    const previous = await cogProtocol({ ...params, url: `cog://${entry.subtractUrl}/${z}/${x}/${y}` });
    const before = bitmapPixels(previous.data).data;
    const px = imageData.data;
    for (let i = 3; i < px.length; i += 4) {
      if (before[i] > 0) px[i] = 0;
    }
  }

  const { imageData: outlined } = await processTile(
    entry.layerId, imageData, { z: +z, x: +x, y: +y },
  );
  return outlined;
}

// Rendered tiles, keyed by the full cog:// tile URL -- COG, layer (the #hash)
// and z/x/y, i.e. exactly the pixels. Overlay sources are year-scoped (see
// rasterLayers' id), so MapLibre drops its own cache on every year change; and
// the COG library keeps only 16 open files, fewer than a playback loop cycles
// through, so revisiting a year re-downloaded its byte ranges. Serving from
// here skips the range reads, the decode and the outline pass.
//
// ImageData, not ImageBitmap: MapLibre takes ownership of the bitmap it is
// handed, so each hit wraps the cached pixels in a fresh one. Same approach as
// the tint cache in tintedTileProtocol.js.
const MAX_CACHED_COG_TILES = 800;   // ~210 MB worst case at 256x256 RGBA
const cogTileCache = new window.Map();
const cogTilesInFlight = new window.Map();

async function cogTile(params) {
  if (params.type !== 'image') return cogProtocol(params);

  const key = params.url;
  let pixels = cogTileCache.get(key);
  if (pixels) {
    // Re-insert so eviction order is least-recently-used.
    cogTileCache.delete(key);
    cogTileCache.set(key, pixels);
  } else {
    let work = cogTilesInFlight.get(key);
    if (!work) {
      work = renderCogTile(params).finally(() => cogTilesInFlight.delete(key));
      cogTilesInFlight.set(key, work);
    }
    pixels = await work;
    cogTileCache.set(key, pixels);
    if (cogTileCache.size > MAX_CACHED_COG_TILES) {
      cogTileCache.delete(cogTileCache.keys().next().value);
    }
  }
  return { data: await createImageBitmap(pixels) };
}

function ensureCogProtocol() {
  if (cogProtocolRegistered) return;
  maplibregl.addProtocol('cog', cogTile);
  cogProtocolRegistered = true;
}

// Same idea as the COG protocol above, for vector tiles: a pmtiles:// source
// range-reads one archive file directly, no tile server. Registered once at
// module scope for the same reason.
let pmtilesProtocolRegistered = false;
function ensurePmtilesProtocol() {
  if (pmtilesProtocolRegistered) return;
  const protocol = new PMTilesProtocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
  pmtilesProtocolRegistered = true;
}

// MapLibre ships no default basemap, so the style is built by hand. These are
// the same XYZ endpoints the Leaflet build used -- MapLibre substitutes {z}/{x}/{y}
// by name, so the EOX/Esri {z}/{y}/{x} ordering carries over unchanged.
// Same reasoning as RASTER_PAINT below, but the basemap needs it stated
// separately because these layers are declared in the style object rather than
// as <Layer> children, and a layer with no paint block silently takes
// MapLibre's 300ms fade default.
//
// The fade binds the *parent* tile's texture while a tile loads, and an evicted
// parent has none -- MapLibre then throws "Cannot read properties of undefined
// (reading 'bind')" out of its render loop. Retuning the basemap with setTiles
// on a year change is precisely the situation that exposes it: every tile
// reloads at once with parents already released.
const BASEMAP_PAINT = { 'raster-fade-duration': 0 };
const BASEMAP_SAT_SOURCE_ID = 'basemap-satellite';
const BASEMAP_LIGHT_SOURCE_ID = 'basemap-light';
const BASEMAP_LIGHT_REF_SOURCE_ID = 'basemap-light-reference';
const BASEMAP_SAT_LAYER_ID = 'basemap-satellite-layer';
const BASEMAP_LIGHT_LAYER_ID = 'basemap-light-layer';
const BASEMAP_LIGHT_REF_LAYER_ID = 'basemap-light-reference-layer';

const EMPTY_STYLE = {
  version: 8,
  // MapLibre refuses to render text/symbol layers without a glyph source. None
  // of our layers use symbols today, but omitting this makes any later label
  // layer fail with a non-obvious "glyphs" error rather than just not drawing.
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
  sources: {},
  layers: [],
};

/**
 * Builds the basemap portion of the style.
 *
 * Kept as a plain object rather than <Source> children because the basemap has
 * to sit underneath every overlay: MapLibre orders layers by their position in
 * style.layers, and declarative <Layer> children append, so a basemap added that
 * way would paint over the rasters it's supposed to sit behind.
 */
function buildBasemapStyle({ basemapMode, satelliteUrl, satelliteAttribution, lightBasemap }) {
  const satelliteVisible = basemapMode === 'satellite';
  return {
    ...EMPTY_STYLE,
    sources: {
      [BASEMAP_SAT_SOURCE_ID]: {
        type: 'raster',
        tiles: [satelliteUrl],
        tileSize: 256,
        attribution: satelliteAttribution,
      },
      [BASEMAP_LIGHT_SOURCE_ID]: {
        type: 'raster',
        tiles: [lightBasemap.baseUrl],
        tileSize: 256,
        attribution: lightBasemap.attribution,
      },
      [BASEMAP_LIGHT_REF_SOURCE_ID]: {
        type: 'raster',
        tiles: [lightBasemap.referenceUrl],
        tileSize: 256,
      },
    },
    layers: [
      {
        id: BASEMAP_SAT_LAYER_ID,
        type: 'raster',
        source: BASEMAP_SAT_SOURCE_ID,
        paint: BASEMAP_PAINT,
        layout: { visibility: satelliteVisible ? 'visible' : 'none' },
      },
      {
        id: BASEMAP_LIGHT_LAYER_ID,
        type: 'raster',
        source: BASEMAP_LIGHT_SOURCE_ID,
        paint: BASEMAP_PAINT,
        layout: { visibility: satelliteVisible ? 'none' : 'visible' },
      },
      {
        // Labels/roads ride above the light base but below overlays.
        id: BASEMAP_LIGHT_REF_LAYER_ID,
        type: 'raster',
        source: BASEMAP_LIGHT_REF_SOURCE_ID,
        paint: BASEMAP_PAINT,
        layout: { visibility: satelliteVisible ? 'none' : 'visible' },
      },
    ],
  };
}

/**
 * Terra Draw, wired to the map instance the same way geoman's controls were.
 *
 * Setup is async (the drawing libs are code-split), which makes teardown the
 * tricky part: under StrictMode the effect mounts, unmounts and remounts, so a
 * naive version starts a second TerraDraw on a map that already has the first
 * one's sources and throws `Source "td-polygon" already exists`. Cleanup
 * therefore both flags cancellation *and* waits on the in-flight import, so an
 * instance created after unmount is still torn down instead of leaking.
 */
// Modes offered in the toolbar, in the order they appear. Labels carry a
// monochrome glyph rather than an emoji so the stack reads as one control
// surface -- the coloured axe on the Sources pill is deliberately the odd one
// out, because that button does something categorically different.
const DRAW_MODES = [
  { id: 'select', glyph: '\u2196', label: 'Select' },
  // A pin is the cheapest thing a user can mean by "here", and until now the
  // toolbar had no way to say it -- every question about a location required
  // enclosing it in an area first.
  { id: 'point', glyph: '\u2022', label: 'Pin' },
  { id: 'rectangle', glyph: '\u25AD', label: 'Rectangle' },
  { id: 'polygon', glyph: '\u2B20', label: 'Polygon' },
  { id: 'circle', glyph: '\u25EF', label: 'Circle' },
];

function DrawingTools({ onCreate, onChange, onAsk, proposedFeatures, enabled, modeRef }) {
  const { current: mapRef } = useMap();
  const drawRef = useRef(null);
  const onCreateRef = useRef(onCreate);
  onCreateRef.current = onCreate;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Drives the Ask button's presence. Kept locally rather than read from the
  // parent's drawn-feature state so the button appears the instant a shape is
  // finished, without a round trip through App.
  const [shapeCount, setShapeCount] = useState(0);
  const [mode, setMode] = useState('select');
  if (modeRef) modeRef.current = enabled ? mode : 'static';
  // Set once terra-draw has started. The setup is async, so the mode effect
  // would otherwise run against a null instance on first render and never
  // re-run -- leaving the toolbar visually active but inert.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const mapInstance = mapRef?.getMap?.();
    if (!mapInstance) return undefined;

    let cancelled = false;
    let draw = null;

    const started = (async () => {
      const {
        TerraDraw, TerraDrawPolygonMode, TerraDrawRectangleMode,
        TerraDrawCircleMode, TerraDrawSelectMode, TerraDrawRenderMode,
        TerraDrawPointMode,
      } = await import('terra-draw');
      const { TerraDrawMapLibreGLAdapter } = await import('terra-draw-maplibre-gl-adapter');

      if (cancelled) return;

      // The adapter registers its render layers into the map's style, so
      // starting before the style exists leaves terra-draw storing features it
      // can never paint -- a shape completes, fires 'finish', and stays
      // invisible. Nothing throws, which is what makes it confusing.
      if (!mapInstance.isStyleLoaded()) {
        await new Promise((resolve) => {
          const done = () => {
            if (mapInstance.isStyleLoaded()) {
              mapInstance.off('styledata', done);
              resolve();
            }
          };
          // 'load' never re-fires once it has fired, so a style that is still
          // settling after a basemap swap needs 'styledata' as well.
          mapInstance.once('load', done);
          mapInstance.on('styledata', done);
          done();
        });
      }

      if (cancelled) return;

      draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map: mapInstance, lib: maplibregl }),
        modes: [
          new TerraDrawPointMode(),
          new TerraDrawPolygonMode(),
          new TerraDrawRectangleMode(),
          new TerraDrawCircleMode(),
          // Display-only mode for geometry the assistant proposed. Render mode
          // rather than a drawing mode on purpose: these features cannot be
          // selected, dragged or edited, so a proposal can never be mistaken
          // for something the user drew -- and amber keeps them visually
          // separate from the user's own shapes.
          new TerraDrawRenderMode({
            modeName: 'ai',
            styles: {
              polygonFillColor: '#f59e0b',
              polygonFillOpacity: 0.18,
              polygonOutlineColor: '#f59e0b',
              polygonOutlineWidth: 2,
            },
          }),
          new TerraDrawSelectMode({
            flags: {
              point: { feature: { draggable: true } },
              polygon: { feature: { draggable: true, coordinates: { draggable: true, deletable: true } } },
              rectangle: { feature: { draggable: true } },
              circle: { feature: { draggable: true } },
            },
          }),
        ],
      });
      draw.start();
      draw.on('finish', (id) => {
        const feature = draw.getSnapshot().find((f) => f.id === id);
        if (feature && onCreateRef.current) onCreateRef.current(feature);
      });
      // 'change' rather than 'finish' for the snapshot: finish fires only on
      // completing a shape, so edits, deletions and Clear would leave whatever
      // consumes this holding stale geometry.
      draw.on('change', () => {
        // The assistant's own proposals live in the same store, so they have to
        // be filtered out here: publishing them would feed them back as shapes
        // the user drew, and the next question would carry the model's guess
        // back to the model as if it were the user's area of interest.
        const userShapes = draw.getSnapshot().filter((f) => f.properties?.mode !== 'ai');
        setShapeCount(userShapes.length);
        if (onChangeRef.current) onChangeRef.current(userShapes);
      });
      drawRef.current = draw;
      setReady(true);
    })();

    return () => {
      cancelled = true;
      setReady(false);
      started.finally(() => {
        if (draw) {
          try {
            draw.stop();
          } catch {
            // stop() throws if the map/style was already torn down underneath
            // it; nothing left to clean up in that case.
          }
        }
        if (drawRef.current === draw) drawRef.current = null;
      });
    };
  }, [mapRef]);

  useEffect(() => {
    const draw = drawRef.current;
    if (!draw || !ready) return;
    // 'static' is terra-draw's inert mode -- the instance stays alive so any
    // drawn features survive the toggle, it just stops responding to the map.
    try {
      draw.setMode(enabled ? mode : 'static');
    } catch (err) {
      // setMode throws for an unregistered mode, and throwing from an effect
      // takes the whole render down. That happens routinely under hot reload:
      // the instance is built once per map (deps are [mapRef]), so editing the
      // mode list swaps in a toolbar offering modes the live instance has never
      // heard of. A reload fixes it; crashing over it does not.
      console.warn(`[MapLibreMap] mode "${mode}" unavailable — reload if you just edited the mode list`, err);
    }
  }, [enabled, mode, ready]);

  // Mirror the assistant's proposals into the store. Replaced wholesale on each
  // change rather than appended, so a new answer supersedes the last one instead
  // of layering proposals the user never asked to keep.
  useEffect(() => {
    const draw = drawRef.current;
    if (!draw || !ready) return;

    const existing = draw.getSnapshot()
      .filter((f) => f.properties?.mode === 'ai')
      .map((f) => f.id);
    if (existing.length) draw.removeFeatures(existing);

    if (!proposedFeatures?.length) return;
    try {
      // addFeatures reports per-feature validation rather than throwing, so
      // ignoring the return is how a proposal ends up counted in the transcript
      // but absent from the map.
      const results = draw.addFeatures(proposedFeatures) || [];
      const failed = results.filter((r) => r && r.valid === false);
      if (failed.length) {
        console.warn(
          `[MapLibreMap] terra-draw rejected ${failed.length}/${proposedFeatures.length} proposed features:`,
          failed.map((r) => r.reason || r),
        );
      }
    } catch (err) {
      console.warn('[MapLibreMap] could not add proposed features', err);
    }
  }, [proposedFeatures, ready]);

  const clearAll = useCallback(() => {
    const draw = drawRef.current;
    if (!draw) return;
    // Clears the user's shapes and the assistant's proposals alike -- "Clear"
    // meaning "everything drawn" is what the button looks like it does.
    draw.clear();
    setShapeCount(0);
    // clear() empties the store without emitting 'change', so the snapshot has
    // to be pushed by hand or consumers keep the shapes that were just removed.
    if (onChangeRef.current) onChangeRef.current([]);
  }, []);

  if (!enabled) return null;

  return (
    <div className="map-draw-tools">
      {DRAW_MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          className={`map-draw-btn${mode === m.id ? ' map-draw-btn--active' : ''}`}
          aria-pressed={mode === m.id}
          title={m.label}
          onClick={() => setMode(m.id)}
        >
          <span className="map-draw-glyph" aria-hidden="true">{m.glyph}</span>
          <span className="map-draw-label">{m.label}</span>
        </button>
      ))}
      <button
        type="button"
        className="map-draw-btn map-draw-btn--danger"
        title="Remove all drawn shapes"
        onClick={clearAll}
      >
        <span className="map-draw-glyph" aria-hidden="true">{'\u2715'}</span>
        <span className="map-draw-label">Clear</span>
      </button>

      {/* Only once there is something to ask about. A permanently-visible button
          that does nothing until you draw would be worse than absent: it invites
          a click that silently fails. Rendered last so it sits closest to where
          the eye lands after finishing a shape. */}
      {shapeCount > 0 && onAsk && (
        <button
          type="button"
          className="map-draw-btn map-draw-btn--ask map-draw-btn--wide"
          title="Ask the Forestry AI Agent about this area"
          onClick={onAsk}
        >
          <span className="map-draw-glyph" aria-hidden="true">{'\u2728'}</span>
          <span className="map-draw-label">Ask AI</span>
        </button>
      )}
    </div>
  );
}

/**
 * Paint shared by both overlay kinds.
 *
 * raster-fade-duration is 0 deliberately. The cross-fade binds the *parent*
 * tile's texture while a tile loads, and a parent that has been evicted from the
 * cache has none -- MapLibre then throws "Cannot read properties of undefined
 * (reading 'bind')" out of its render loop. Tiles served by an async protocol
 * (COG range reads, or the fetch-plus-worker tint) arrive slowly and out of
 * order, which is what makes that window wide enough to hit. These are
 * semi-transparent data overlays, so the fade bought us nothing anyway.
 */
const RASTER_PAINT = (opacity) => ({
  'raster-opacity': opacity,
  'raster-resampling': 'nearest',
  'raster-fade-duration': 0,
});

/**
 * Shows the satellite imagery for the current year, one source per year.
 *
 * The satellite URL is per-year (EOX publishes one s2cloudless layer per
 * season). Putting it in the style object made react-map-gl call setStyle(),
 * tearing down every source and layer; swapping it with setTiles avoided that
 * but emptied the source's tile cache, so every year change -- and every step
 * of playback -- redrew the whole basemap from scratch.
 *
 * Each year's imagery now gets its own source and layer, added on first use
 * and then only shown or hidden. MapLibre keeps a hidden source's tiles in its
 * out-of-view cache, so returning to a year is instant. The style's own
 * satellite source is simply whichever year the map was created with.
 *
 * `prefetchUrls` are shown at zero opacity so their tiles load for the current
 * view before playback reaches them -- the same buffering the overlays do.
 */
function satelliteIds(url) {
  const key = url.replace(/[^a-z0-9]+/gi, '-');
  return { sourceId: `${BASEMAP_SAT_SOURCE_ID}--${key}`, layerId: `${BASEMAP_SAT_LAYER_ID}--${key}` };
}

function SatelliteYearSync({ url, attribution, prefetchUrls, enabled }) {
  const { current: mapRef } = useMap();
  const prefetchKey = prefetchUrls.join('|');

  useEffect(() => {
    const map = mapRef?.getMap?.();
    if (!map || !url) return undefined;

    const apply = () => {
      const base = map.getSource(BASEMAP_SAT_SOURCE_ID);
      if (!base) return;

      // Layer id for a year's imagery, creating it (hidden, under the light
      // basemap and so under every overlay) the first time it's needed.
      const layerFor = (tilesUrl) => {
        if (base.tiles?.[0] === tilesUrl) return BASEMAP_SAT_LAYER_ID;
        const { sourceId, layerId } = satelliteIds(tilesUrl);
        if (!map.getSource(sourceId)) {
          map.addSource(sourceId, { type: 'raster', tiles: [tilesUrl], tileSize: 256, attribution });
        }
        if (!map.getLayer(layerId)) {
          map.addLayer({
            id: layerId,
            type: 'raster',
            source: sourceId,
            paint: BASEMAP_PAINT,
            layout: { visibility: 'none' },
          }, BASEMAP_LIGHT_LAYER_ID);
        }
        return layerId;
      };

      const current = layerFor(url);
      const buffered = new Set(enabled ? prefetchUrls.map(layerFor) : []);
      buffered.delete(current);

      map.getLayersOrder()
        .filter((id) => id.startsWith(BASEMAP_SAT_LAYER_ID))
        .forEach((id) => {
          const shown = enabled && (id === current || buffered.has(id));
          map.setLayoutProperty(id, 'visibility', shown ? 'visible' : 'none');
          if (shown) map.setPaintProperty(id, 'raster-opacity', id === current ? 1 : 0);
        });
    };

    if (map.isStyleLoaded()) apply();
    else map.once('styledata', apply);
    return () => {
      map.off('styledata', apply);
    };
    // prefetchKey stands in for prefetchUrls, whose identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRef, url, attribution, prefetchKey, enabled]);

  return null;
}

// Basemap mode is switched by layer visibility, not by replacing mapStyle. This
// keeps overlay and terra-draw sources alive across toggles.
// Disturbance Alerts layers, bottom to top
const ALERT_LAYER_IDS = ['alerts-fill', 'alerts-line-confirmed', 'alerts-line-provisional', 'alerts-selected', 'alerts-points'];
const ALERT_INTERACTIVE_LAYERS = ['alerts-fill', 'alerts-points'];
// Below this zoom alerts show as dots (see alertPoints)
const ALERT_POINT_MAXZOOM = 10.5;

/**
 * Keeps the alert layers above every overlay. Declarative <Layer>s are
 * appended when they mount, and the raster sources are remounted on every
 * year change (their ids carry the year), so without this a year change
 * would bury the alerts under the clearcut rasters.
 */
function AlertsOnTop({ enabled, signature }) {
  const { current: mapRef } = useMap();

  useEffect(() => {
    const map = mapRef?.getMap?.();
    if (!map || !enabled) return undefined;
    const raise = () => {
      ALERT_LAYER_IDS.forEach((id) => {
        if (map.getLayer(id)) map.moveLayer(id);
      });
    };
    raise();
    // Layers added in this same commit may land after this effect runs
    map.once('idle', raise);
    return () => map.off('idle', raise);
  }, [mapRef, enabled, signature]);

  return null;
}

function BasemapModeSync({ basemapMode }) {
  const { current: mapRef } = useMap();

  useEffect(() => {
    const map = mapRef?.getMap?.();
    if (!map) return undefined;

    const apply = () => {
      const satelliteVisible = basemapMode === 'satellite';
      const setVis = (layerId, visible) => {
        if (!map.getLayer(layerId)) return;
        map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
      };
      // Satellite layers (one per year) are shown by <SatelliteYearSync>.
      setVis(BASEMAP_LIGHT_LAYER_ID, !satelliteVisible);
      setVis(BASEMAP_LIGHT_REF_LAYER_ID, !satelliteVisible);
    };

    if (map.isStyleLoaded()) apply();
    else map.once('styledata', apply);

    return () => {
      map.off('styledata', apply);
    };
  }, [mapRef, basemapMode]);

  return null;
}

/**
 * Reports tile activity the way <RasterTileLayer> does on the Leaflet path.
 *
 * Bound to the map directly rather than through react-map-gl props, because it
 * exposes onIdle but has no prop for 'dataloading' -- an onDataLoading prop is
 * silently ignored, which leaves the spinner permanently hidden rather than
 * obviously broken.
 *
 * 'dataloading' and 'idle' bracket a load for every source, so this covers COGs
 * and PNG tiles alike -- including the tinted wildfire and biomass layers, whose
 * fetch-plus-worker round trip keeps the map non-idle until the tint completes.
 * The parent debounces the hide, so 'dataloading' firing per request is fine.
 */
function LoadingReporter({ onLoadingChange, sourceIds }) {
  const { current: mapRef } = useMap();

  useEffect(() => {
    const map = mapRef?.getMap?.();
    if (!map || !onLoadingChange) return undefined;

    // Asked of the map rather than inferred from events.
    //
    // Event-based tracking worked for the COG layers and silently missed the
    // PNG ones: a `url: cog://` source fetches TileJSON through the protocol
    // and so raises sourcedataloading, while a source declared with an inline
    // `tiles:` array has no metadata step and never raises it at all. That is
    // why clearcut reported progress and wildfire did not. isSourceLoaded
    // answers the real question -- "are this source's tiles for the current view
    // all in?" -- the same way for both.
    //
    // The ids come from props, NOT from map.getStyle(): getStyle serialises the
    // whole style on every call, and calling it per tile event was enough to
    // make panning visibly stutter.
    let last = '';
    let timer = null;
    // Layer ids the tint protocol says are fetching. MapLibre does not report
    // those sources as busy, so they are merged in from the authority that
    // actually knows -- without this, the PNG-backed layers (wildfire, biomass)
    // load in silence.
    let tinting = [];

    const recompute = () => {
      timer = null;
      const ids = sourceIds.filter((id) => {
        if (tinting.some((layerId) => id.startsWith(`raster-${layerId}-`))) return true;
        // Not added yet (or just removed): pending. Checked up front because
        // isSourceLoaded doesn't throw for an unknown id -- it fires an error
        // event, which MapLibre logs, so the catch below never sees it.
        if (!map.getSource(id)) return true;
        try {
          return !map.isSourceLoaded(id);
        } catch {
          // Thrown for a source the style hasn't added yet -- pending, so it
          // counts as loading.
          return true;
        }
      });
      const key = ids.join('|');
      if (key === last) return;
      last = key;
      onLoadingChange(ids.length > 0, ids);
    };

    // Coalesced: these events fire per tile, and both the check and the state
    // push are wasted if another tile lands a millisecond later.
    const schedule = () => {
      if (timer === null) timer = setTimeout(recompute, 120);
    };

    const unsubscribeTint = onTintActivity((active) => {
      tinting = active;
      schedule();
    });

    map.on('sourcedata', schedule);
    map.on('dataloading', schedule);
    map.on('idle', schedule);
    map.on('moveend', schedule);
    return () => {
      if (timer !== null) clearTimeout(timer);
      unsubscribeTint();
      map.off('sourcedata', schedule);
      map.off('dataloading', schedule);
      map.off('idle', schedule);
      map.off('moveend', schedule);
    };
  }, [mapRef, onLoadingChange, sourceIds]);

  return null;
}

/**
 * MapLibre replacement for the Leaflet <MapContainer> stack.
 *
 * Renders raster overlays two ways during the migration: `rasterLayers` keeps the
 * existing PNG pyramids working unchanged, while `cogLayers` reads COGs directly.
 * Both can be on at once, which is what makes it possible to cut over one module
 * at a time and compare them on the same screen instead of trusting a swap.
 */
function MapLibreMap({
  center,
  zoom,
  minZoom,
  maxZoom,
  basemapMode,
  satelliteUrl,
  satelliteAttribution,
  satellitePrefetchUrls = [],
  lightBasemap,
  regionsData = null,
  rangeBoundaries = null,
  rasterLayers = [],
  cogLayers = [],
  vectorLayers = [],
  rasterOpacity = 0.5,
  onShapeCreate = null,
  onDrawChange = null,
  onAskAboutDrawing = null,
  onLoadingChange = null,
  proposedFeatures = null,
  drawingEnabled = false,
  onMapReady = null,
  mapRef = null,
  // Disturbance Alerts: FeatureCollection whose features carry `id`, `status`
  // and `ageColor` properties (App.js adds the color); null hides the layer.
  alertsGeoJson = null,
  selectedAlertId = null,
  onAlertClick = null,
}) {
  ensureCogProtocol();
  ensurePmtilesProtocol();
  ensureTintedProtocol();

  // Feature clicked on a vector (PMTiles) layer -- {lngLat, properties} or null.
  // Local to this component: nothing outside the map needs to know what's
  // currently popped up.
  const [clickedFeature, setClickedFeature] = useState(null);
  // Decoded pixel under a click on a layer declaring `inspect` (the AI status
  // layers) -- {lngLat, name, title, detail} or null.
  const [pixelInfo, setPixelInfo] = useState(null);
  const drawModeRef = useRef('static');
  const cogLayersRef = useRef(cogLayers);
  cogLayersRef.current = cogLayers;

  const vectorLayerIds = useMemo(
    () => [
      ...vectorLayers.map((l) => `vector-layer-${l.id}`),
      ...(alertsGeoJson ? ALERT_INTERACTIVE_LAYERS : []),
    ],
    [vectorLayers, alertsGeoJson],
  );

  // Ref so the memoised click handler always calls the current callback
  const onAlertClickRef = useRef(onAlertClick);
  onAlertClickRef.current = onAlertClick;

  // Reads the clicked pixel from the visible inspectable COGs (one per FMU)
  // and decodes it. A click outside every raster, or on nodata, reads as
  // "No data"; a 0 STATUS as "checked, nothing detected".
  const inspectPixel = useCallback(async (lngLat) => {
    const targets = cogLayersRef.current.filter((l) => l.inspect && l.opacity === undefined);
    if (!targets.length || (drawModeRef.current !== 'static' && drawModeRef.current !== 'select')) {
      setPixelInfo(null);
      return;
    }
    const reads = await Promise.all(targets.map((l) => locationValues(
      l.url, { latitude: lngLat.lat, longitude: lngLat.lng },
    ).then((values) => ({ layer: l, info: describeStatus(values, l.inspect.year), values }))
      .catch(() => null)));
    const found = reads.filter(Boolean);
    const hit = found.find((r) => r.values[0] > 0 && r.info.detail !== undefined)
      || found.find((r) => r.values[0] === 0);
    const { layer, info } = hit || { layer: targets[0], info: describeStatus([], 0) };
    setPixelInfo({ lngLat, name: layer.inspect.name, ...info });
  }, []);

  const handleMapClick = useCallback((e) => {
    if (!e.features || e.features.length === 0) {
      setClickedFeature(null);
      inspectPixel(e.lngLat);
      return;
    }
    setPixelInfo(null);
    // Alerts take precedence: they're the layer being read when it's on, and
    // they open in the side panel rather than a popup.
    const alert = e.features.find((f) => ALERT_INTERACTIVE_LAYERS.includes(f.layer?.id));
    if (alert) {
      setClickedFeature(null);
      onAlertClickRef.current?.(alert.properties.id);
      return;
    }
    const feature = e.features[0];
    setClickedFeature({ lngLat: e.lngLat, properties: feature.properties });
  }, [inspectPixel]);

  // One point per alert, from its precomputed centroid: polygons a few hundred
  // hectares across shrink to nothing at FMU zoom, so below ALERT_POINT_MAXZOOM
  // alerts are drawn as dots instead.
  const alertPoints = useMemo(() => alertsGeoJson && ({
    type: 'FeatureCollection',
    features: alertsGeoJson.features
      .filter((f) => Array.isArray(f.properties.centroid))
      .map((f) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: f.properties.centroid },
        properties: { id: f.properties.id, ageColor: f.properties.ageColor, status: f.properties.status },
      })),
  }), [alertsGeoJson]);

  // The popup belongs to the layer it was read from. Once that layer is gone
  // (Inspect switched off, Accumulated off, ARI source off) or its year window
  // moves, the popup describes something no longer on the map -- close it
  // rather than leave a stale harvest year behind.
  const vectorLayerSignature = vectorLayers
    .map((l) => `${l.id}:${JSON.stringify(l.filter ?? null)}`)
    .join('|');
  useEffect(() => {
    setClickedFeature(null);
  }, [vectorLayerSignature]);
  // Same for a decoded pixel: it described one year's raster
  const inspectSignature = cogLayers
    .filter((l) => l.inspect && l.opacity === undefined)
    .map((l) => l.url)
    .join('|');
  useEffect(() => {
    setPixelInfo(null);
  }, [inspectSignature]);

  // Held in a ref so a year change does not rebuild the style.
  const satelliteRef = useRef({ url: satelliteUrl, attribution: satelliteAttribution });
  satelliteRef.current = { url: satelliteUrl, attribution: satelliteAttribution };

  const mapStyle = useMemo(
    () => buildBasemapStyle({
      basemapMode,
      satelliteUrl: satelliteRef.current.url,
      satelliteAttribution: satelliteRef.current.attribution,
      lightBasemap,
    }),
    // Basemap mode toggles are applied by <BasemapModeSync>; keeping style
    // identity stable avoids style teardown that drops terra-draw sources.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lightBasemap],
  );

  // Class colors are applied by a per-pixel function keyed on the COG's URL, so
  // it has to be registered before MapLibre requests the first tile -- hence
  // useMemo during render rather than an effect after it. Without this the
  // protocol falls back to raw band values (0-5) and the layer paints as
  // near-black rather than the class palette.
  //
  // The layer's own color overrides the class palette for the clearcut class:
  // accumulated and annual are the same class ID in different rasters, so the
  // taxonomy color alone would paint both the same and make the two layers
  // indistinguishable when stacked. Falls back to the palette when a layer
  // declares no color.
  const cogSignature = cogLayers
    .map((l) => `${l.url}:${l.color || ''}:${l.outline || ''}:${l.subtractUrl || ''}`)
    .join('|');
  useMemo(() => {
    cogLayers.forEach((layer) => {
      if (layer.outline) {
        // Keyed by url#layer, matching the Source url below: ML accumulated and ML
        // annual read the same accumulated COG for a year, differently.
        cogOutlineLayers.set(`${layer.url}#${layer.outline}`, {
          layerId: layer.outline,
          subtractUrl: layer.subtractUrl,
        });
      }
      // Each layer brings its own class table. Clearcut's 6-class U-Net labels and
      // wildfire's single burned class are unrelated vocabularies that happen to
      // share this renderer, so defaulting to one of them would let a layer paint
      // by another module's numbering.
      const palette = layer.palette || CLEARCUT_CLASSES;
      const visibleClasses = layer.visibleClasses || DEFAULT_VISIBLE_CLASSES;
      // Which class the layer's colour overrides. Clearcut paints class 2,
      // wildfire class 1, so this cannot be a literal or the override lands on a
      // class the raster never contains and the layer renders in the palette's
      // own colour instead of its own.
      //
      // An explicit null means "override nothing": caribou's five-step ramp IS
      // the information, so repainting one of its classes would destroy the
      // reading. Undefined still means the clearcut default.
      const colorClass = layer.colorClass === undefined ? CLEARCUT_CLASS_ID : layer.colorClass;
      const overrides = (layer.color && colorClass !== null)
        ? { [colorClass]: layer.color }
        : {};
      // Layers declared with layer.cog bring their own (multi-band,
      // year-aware) color function; everything else gets the class palette.
      const colorFunction = layer.colorFunction || buildClassColorFunction({
        palette,
        visibleClasses,
        alpha: 255,
        colorOverrides: overrides,
      });
      setColorFunction(layer.url, colorFunction);
      // The subtracted year needs one too, or the protocol renders it as a
      // photo and every pixel reads as painted. Only its alpha is used, so
      // sharing this layer's function is fine even if that year is also on
      // the map in another color -- outlines are recolored by the worker.
      if (layer.subtractUrl) setColorFunction(layer.subtractUrl, colorFunction);
    });
    // cogSignature stands in for the layer list: the array identity changes on
    // every render, but the registration only needs redoing when a URL or color does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cogSignature]);

  // The overlay source ids, straight from the layer descriptors. Joined into
  // the dependency key so the reporter re-binds when layers change but not on
  // every render.
  const overlaySourceIds = useMemo(
    () => [
      ...rasterLayers.map((l) => `raster-${l.id}`),
      ...cogLayers.map((l) => `cog-${l.id}`),
      ...vectorLayers.map((l) => `vector-${l.id}`),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rasterLayers.map((l) => l.id).join('|'), cogLayers.map((l) => l.id).join('|'), vectorLayers.map((l) => l.id).join('|')],
  );

  const handleLoad = useCallback((e) => {
    if (mapRef) mapRef.current = e.target;
    // Dev-only handle. Two rendering faults in a row have come down to "is the
    // layer there at all", which is one console line to answer with the map in
    // hand and guesswork without it. Stripped from production builds.
    if (process.env.NODE_ENV !== 'production') window.__foresttraceMap = e.target;
    if (onMapReady) onMapReady(e.target);
  }, [mapRef, onMapReady]);

  return (
    <Map
      initialViewState={{ longitude: center[1], latitude: center[0], zoom }}
      minZoom={minZoom}
      maxZoom={maxZoom}
      mapStyle={mapStyle}
      style={{ width: '100%', height: '100%' }}
      onLoad={handleLoad}
      onClick={handleMapClick}
      interactiveLayerIds={vectorLayerIds}
      attributionControl={{ compact: true }}
    >
      <NavigationControl position="bottom-left" showCompass={false} />

      <LoadingReporter onLoadingChange={onLoadingChange} sourceIds={overlaySourceIds} />
      <BasemapModeSync basemapMode={basemapMode} />
      <SatelliteYearSync
        url={satelliteUrl}
        attribution={satelliteAttribution}
        prefetchUrls={satellitePrefetchUrls}
        enabled={basemapMode === 'satellite'}
      />

      {regionsData && (
        <Source id="regions" type="geojson" data={regionsData}>
          <Layer
            id="regions-fill"
            type="fill"
            paint={{ 'fill-color': '#1baf7a', 'fill-opacity': 0.05 }}
          />
          <Layer
            id="regions-outline"
            type="line"
            paint={{
              'line-color': basemapMode === 'satellite' ? '#ffffff' : '#333333',
              'line-width': 1.5,
            }}
          />
        </Source>
      )}

      {rasterLayers.map((layer) => (
        <Source
          key={layer.id}
          id={`raster-${layer.id}`}
          type="raster"
          tiles={[layer.tileUrl]}
          tileSize={256}
          scheme={layer.tms ? 'tms' : 'xyz'}
          minzoom={layer.minZoom ?? 6}
          maxzoom={layer.maxZoom ?? 14}
        >
          <Layer
            id={`raster-layer-${layer.id}`}
            type="raster"
            // opacity 0 marks a buffered year: mounted so its tiles load, not
            // drawn until the timeline reaches it.
            paint={RASTER_PAINT(layer.opacity ?? rasterOpacity)}
          />
        </Source>
      ))}

      {cogLayers.map((layer) => (
        <Source
          key={layer.id}
          id={`cog-${layer.id}`}
          type="raster"
          // Outline layers carry their id as the hash so renderCogTile can
          // tell them apart; the protocol strips it before reading the COG.
          url={layer.outline ? `cog://${layer.url}#${layer.outline}` : `cog://${layer.url}`}
          tileSize={256}
        >
          <Layer
            id={`cog-layer-${layer.id}`}
            type="raster"
            paint={RASTER_PAINT(layer.opacity ?? rasterOpacity)}
          />
        </Source>
      ))}

      {vectorLayers.map((layer) => (
        <Source key={layer.id} id={`vector-${layer.id}`} type="vector" url={`pmtiles://${layer.url}`}>
          {/* Invisible: exists only so interactiveLayerIds has a fill to hit-test
              clicks against (a click anywhere inside a stand should register, not
              just on its border pixel). A visible fill here shaded the accumulated/
              annual raster underneath, which is the whole thing this layer is meant
              to annotate -- borders read the boundaries without hiding the color. */}
          <Layer
            id={`vector-layer-${layer.id}`}
            type="fill"
            source-layer={layer.sourceLayer}
            filter={layer.filter}
            paint={{ 'fill-color': layer.color || '#FF1493', 'fill-opacity': 0 }}
          />
          <Layer
            id={`vector-outline-${layer.id}`}
            type="line"
            source-layer={layer.sourceLayer}
            filter={layer.filter}
            paint={{ 'line-color': layer.color || '#FF1493', 'line-width': 1.5 }}
          />
        </Source>
      ))}

      {/* Disturbance Alerts. Colored by age; solid outline = confirmed,
          dashed = provisional (line-dasharray can't be data-driven, hence two
          line layers). <AlertsOnTop> keeps these above the rasters. */}
      {alertsGeoJson && (
        <Source id="disturbance-alerts" type="geojson" data={alertsGeoJson}>
          <Layer
            id="alerts-fill"
            type="fill"
            paint={{ 'fill-color': ['get', 'ageColor'], 'fill-opacity': 0.3 }}
          />
          <Layer
            id="alerts-line-confirmed"
            type="line"
            filter={['==', ['get', 'status'], 'confirmed']}
            paint={{ 'line-color': ['get', 'ageColor'], 'line-width': 2 }}
          />
          <Layer
            id="alerts-line-provisional"
            type="line"
            filter={['!=', ['get', 'status'], 'confirmed']}
            paint={{ 'line-color': ['get', 'ageColor'], 'line-width': 2, 'line-dasharray': [2, 1.5] }}
          />
          <Layer
            id="alerts-selected"
            type="line"
            filter={['==', ['get', 'id'], selectedAlertId || '']}
            paint={{ 'line-color': '#fde047', 'line-width': 4 }}
          />
        </Source>
      )}
      {alertPoints && (
        <Source id="disturbance-alert-points" type="geojson" data={alertPoints}>
          <Layer
            id="alerts-points"
            type="circle"
            maxzoom={ALERT_POINT_MAXZOOM}
            paint={{
              'circle-radius': ['case', ['==', ['get', 'id'], selectedAlertId || ''], 8, 5],
              'circle-color': ['get', 'ageColor'],
              'circle-stroke-color': ['case', ['==', ['get', 'id'], selectedAlertId || ''], '#fde047', '#ffffff'],
              'circle-stroke-width': 1.5,
            }}
          />
        </Source>
      )}
      <AlertsOnTop enabled={Boolean(alertsGeoJson)} signature={overlaySourceIds.join('|')} />

      {clickedFeature && (
        <Popup
          longitude={clickedFeature.lngLat.lng}
          latitude={clickedFeature.lngLat.lat}
          onClose={() => setClickedFeature(null)}
          closeOnClick={false}
        >
          <div style={{ fontSize: 13 }}>
            <strong>Harvested: {clickedFeature.properties.YRDEP}</strong>
            <br />
            Clearcut (DEPHARV): {clickedFeature.properties.IS_DEPHARV ? 'yes' : 'no'}
            <br />
            Harvest type: {clickedFeature.properties.IS_HARVTYP ? 'yes' : 'no'}
          </div>
        </Popup>
      )}

      {pixelInfo && (
        <Popup
          longitude={pixelInfo.lngLat.lng}
          latitude={pixelInfo.lngLat.lat}
          onClose={() => setPixelInfo(null)}
          closeOnClick={false}
        >
          <div className="pixel-info">
            <div className="pixel-info-layer">{pixelInfo.name}</div>
            <strong>{pixelInfo.title}</strong>
            {pixelInfo.detail && <div>{pixelInfo.detail}</div>}
          </div>
        </Popup>
      )}

      {/* Caribou range outlines. Must stay AFTER both raster blocks: MapLibre
          paints layers in the order they are added, so declared any earlier the
          outline sits under the habitat it annotates and is invisible wherever
          that habitat is opaque. Line-only, no fill, for the same reason.

          Colour is data-driven off a property resolved in App: MapLibre has no
          per-feature style callback, so seven ranges in one source cannot be
          styled by a function the way Leaflet's onEachFeature does it. */}
      {rangeBoundaries && (
        <Source id="caribou-ranges" type="geojson" data={rangeBoundaries}>
          <Layer
            id="caribou-ranges-outline"
            type="line"
            paint={{
              'line-color': ['coalesce', ['get', '_lineColor'], '#333333'],
              'line-width': 2,
              'line-opacity': 1,
            }}
          />
        </Source>
      )}

      <DrawingTools
        onCreate={onShapeCreate}
        onChange={onDrawChange}
        onAsk={onAskAboutDrawing}
        proposedFeatures={proposedFeatures}
        enabled={drawingEnabled}
        modeRef={drawModeRef}
      />
    </Map>
  );
}

export default MapLibreMap;
