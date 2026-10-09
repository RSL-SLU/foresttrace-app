/**
 * Renders a story map: a self-contained HTML page with a scroll-driven map
 * (MapLibre) and charts (Chart.js), from the model's story JSON plus the
 * server-built facts (api/_storyFacts.js).
 *
 * Safety: the page can be shared publicly, so nothing from the model is ever
 * inserted as HTML. Text goes through esc(); data rides in a JSON script tag
 * with "<" escaped; charts and map focus are looked up by id in the facts, so
 * the model can only point at real data.
 */

const MAPLIBRE = 'https://cdn.jsdelivr.net/npm/maplibre-gl@5/dist';
const CHARTJS = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
const COG_PROTOCOL = 'https://cdn.jsdelivr.net/npm/@geomatico/maplibre-cog-protocol@0.9.2/dist/index.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const jsonForScript = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

function renderStoryHtml({ story, facts, author, createdAt, model }) {
  const datasets = Object.fromEntries(facts.datasets.map((d) => [d.id, d]));
  const places = Object.fromEntries(facts.places.map((p) => [p.id, p]));
  const firstFmu = facts.places.find((p) => p.kind === 'fmu');
  const date = new Date(createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Drop references to anything that doesn't exist rather than failing the page
  const sections = story.sections.map((s, i) => ({
    ...s,
    placeId: places[s.placeId] ? s.placeId : firstFmu?.id || null,
    chart: s.chart && datasets[s.chart.datasetId] ? s.chart : null,
    chartId: `chart-${i}`,
  }));
  const usedSources = [...new Set(sections
    .filter((s) => s.chart).map((s) => datasets[s.chart.datasetId].source)
    .concat(story.keyFacts.map((k) => datasets[k.sourceDatasetId]?.source).filter(Boolean)))];
  const demoData = facts.regions.some((r) => r.alerts?.demoData);

  const charts = sections.filter((s) => s.chart).map((s) => ({
    canvasId: s.chartId, type: s.chart.type, ...datasets[s.chart.datasetId],
  }));

  const page = {
    places,
    initialPlace: firstFmu?.id || null,
    charts,
    layers: facts.layers,
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(story.title)} · ForestTrace</title>
<meta name="description" content="${esc(story.dek)}">
<!-- Social previews. __FT_*__ are filled in when the page is served (api/storymaps.js servePage). -->
<link rel="canonical" href="__FT_STORY_URL__">
<meta property="og:type" content="article">
<meta property="og:site_name" content="ForestTrace">
<meta property="og:title" content="${esc(story.title)}">
<meta property="og:description" content="${esc(story.dek)}">
<meta property="og:url" content="__FT_STORY_URL__">
<meta property="og:image" content="__FT_IMAGE_URL__">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Satellite map of ${esc(facts.regions.map((r) => r.name).join(", "))} with the areas discussed in the story">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(story.title)}">
<meta name="twitter:description" content="${esc(story.dek)}">
<meta name="twitter:image" content="__FT_IMAGE_URL__">
<link rel="stylesheet" href="${MAPLIBRE}/maplibre-gl.css">
<style>
  :root { --ink:#1f2933; --muted:#5f6b76; --accent:#2f8f5b; --rule:#e3e7ea; --amber:#d97706; --pink:#ff2d95; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: Georgia, 'Times New Roman', serif; color:var(--ink); background:#fbfbf9; }
  .layout { display:grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .story { padding: 48px clamp(20px, 5vw, 64px) 96px; max-width: 720px; justify-self: end; width:100%; }
  .map-wrap { position: sticky; top:0; height:100vh; }
  #map { position:absolute; inset:0; }
  .kicker { font: 600 12px/1.4 system-ui, sans-serif; letter-spacing:.12em; text-transform:uppercase; color:var(--accent); margin:0 0 12px; }
  h1 { font-size: clamp(30px, 4vw, 44px); line-height:1.12; margin:0 0 14px; }
  .dek { font-size:20px; line-height:1.45; color:var(--muted); margin:0 0 18px; }
  .byline { font: 13px/1.5 system-ui, sans-serif; color:var(--muted); border-top:1px solid var(--rule); border-bottom:1px solid var(--rule); padding:10px 0; margin:0 0 28px; }
  .notice { font: 13px/1.5 system-ui, sans-serif; background:#fff7e6; border:1px solid #f5d38a; border-radius:8px; padding:10px 12px; margin:0 0 28px; }
  p { font-size:18px; line-height:1.7; margin:0 0 18px; }
  .lede { font-size:20px; }
  .facts { display:grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap:12px; margin: 8px 0 40px; }
  .fact { background:#fff; border:1px solid var(--rule); border-radius:10px; padding:14px; }
  .fact-value { font: 700 24px/1.2 system-ui, sans-serif; color:var(--accent); }
  .fact-label { font: 13px/1.4 system-ui, sans-serif; color:var(--muted); margin-top:4px; }
  .step { padding: 28px 0 36px; border-top:1px solid var(--rule); min-height: 60vh; }
  .step h2 { font-size:26px; line-height:1.25; margin:0 0 14px; }
  .step.active h2 { color: var(--accent); }
  figure { margin: 20px 0 0; background:#fff; border:1px solid var(--rule); border-radius:10px; padding:14px; }
  figure h3 { font: 600 15px/1.4 system-ui, sans-serif; margin:0 0 8px; }
  figcaption { font: 13px/1.5 system-ui, sans-serif; color:var(--muted); margin-top:8px; }
  .chart-box { position:relative; height:260px; }
  .back-matter { border-top:2px solid var(--ink); margin-top:24px; padding-top:20px; }
  .back-matter h2 { font: 700 16px/1.4 system-ui, sans-serif; text-transform:uppercase; letter-spacing:.06em; margin:24px 0 8px; }
  .back-matter p, .back-matter li { font-size:15px; line-height:1.6; }
  .legend { position:absolute; left:12px; bottom:28px; background:rgba(255,255,255,.92); border-radius:8px; padding:8px 10px; font: 12px/1.6 system-ui, sans-serif; }
  .legend span { display:inline-block; width:12px; height:12px; border-radius:2px; margin-right:6px; vertical-align:-1px; }
  .share { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin: 0 0 28px; font: 13px/1.4 system-ui, sans-serif; }
  .share-label { color:var(--muted); margin-right:4px; }
  .share a, .share button { display:inline-flex; align-items:center; padding:6px 12px; border:1px solid var(--rule); border-radius:999px; background:#fff; color:var(--ink); font: 600 13px/1.2 system-ui, sans-serif; text-decoration:none; cursor:pointer; }
  .share a:hover, .share button:hover { border-color: var(--accent); color: var(--accent); }
  .share-note { color:var(--muted); font-style:italic; }
  footer { font: 12px/1.5 system-ui, sans-serif; color:var(--muted); margin-top:40px; }
  footer a { color: var(--accent); }
  @media (max-width: 860px) {
    .layout { grid-template-columns: 1fr; }
    .map-wrap { position: sticky; top:0; height:42vh; z-index:2; order:-1; }
    .story { padding-top: 28px; justify-self: stretch; }
    .step { min-height: 40vh; }
  }
</style>
</head>
<body>
<div class="layout">
  <main class="story">
    <p class="kicker">ForestTrace story map</p>
    <h1>${esc(story.title)}</h1>
    <p class="dek">${esc(story.dek)}</p>
    <div class="byline">${esc(author)} · ${esc(date)} · Data: ForestTrace, Remote Sensing Lab, Saint Louis University</div>
    <div class="share" data-share></div>
    <div class="notice"><strong>AI-assisted draft.</strong> Written by ${esc(model)} from ForestTrace data; every chart is drawn from the underlying datasets. Verify figures before publication.${demoData ? ' Disturbance alerts in this story are <strong>demonstration data</strong>.' : ''}</div>

    <section class="step" data-place="${esc(page.initialPlace || '')}" style="border-top:none; min-height:auto;">
      <p class="lede">${esc(story.lede)}</p>
      ${story.keyFacts.length ? `<div class="facts">${story.keyFacts.map((k) => `
        <div class="fact"><div class="fact-value">${esc(k.value)}</div><div class="fact-label">${esc(k.label)}</div></div>`).join('')}
      </div>` : ''}
    </section>

    ${sections.map((s) => `
    <section class="step" data-place="${esc(s.placeId || '')}">
      <h2>${esc(s.heading)}</h2>
      ${s.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('\n      ')}
      ${s.chart ? `<figure>
        <h3>${esc(s.chart.title)}</h3>
        <div class="chart-box"><canvas id="${s.chartId}"></canvas></div>
        <figcaption>${esc(s.chart.caption)} Source: ${esc(datasets[s.chart.datasetId].source)}.</figcaption>
      </figure>` : ''}
    </section>`).join('')}

    <div class="back-matter">
      <h2>How this was made</h2>
      <p>${esc(story.methodology)}</p>
      ${story.caveats.length ? `<h2>Caveats</h2><ul>${story.caveats.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
      <h2>Sources</h2>
      <ul>${usedSources.map((s) => `<li>${esc(s)}</li>`).join('')}<li>Basemap imagery: Esri, Maxar, Earthstar Geographics</li></ul>
    </div>
    <div class="share" data-share style="margin-top:28px"></div>
    <footer>Created with ForestTrace · Remote Sensing Lab, Saint Louis University.</footer>
  </main>
  <div class="map-wrap">
    <div id="map" role="img" aria-label="Map of the area discussed in this story"></div>
    <div class="legend">
      ${facts.isWildfire ? `<div><span style="background:rgba(255,127,0,.85)"></span>Wildfire burned area (${esc(facts.year)})</div>` : ''}
      ${(facts.layers.cogs && facts.layers.cogs.some((c) => c.layerId === 'clearcut-accumulated')) || (facts.isClearcut && facts.layers.patches.length) ? `<div><span style="background:rgba(217,119,6,.75)"></span>Standing clearcut (${esc(facts.year)})</div>` : ''}
      ${facts.layers.cogs && facts.layers.cogs.some((c) => c.layerId === 'clearcut-annual') ? `<div><span style="background:rgba(220,38,38,.8)"></span>Annual clearcut (${esc(facts.year)})</div>` : ''}
      ${facts.hasCaribou ? `<div><span style="background:rgba(33,145,140,.8)"></span>Caribou habitat</div>` : ''}
      ${facts.layers.alerts.length ? '<div><span style="background:rgba(255,45,149,.75)"></span>Disturbance alerts (last 90 days)</div>' : ''}
      <div><span style="background:transparent;border:2px solid #fff"></span>Forest management unit</div>
    </div>
  </div>
</div>

<script id="story-data" type="application/json">${jsonForScript(page)}</script>
<script>
// Share bar. The URL comes from og:url, filled in when the page is served;
// a private story (or the owner's preview) shows a note instead of links.
(function () {
  var isPublic = __FT_PUBLIC__;
  var url = (document.querySelector('meta[property="og:url"]') || {}).content || '';
  var title = (document.querySelector('meta[property="og:title"]') || {}).content || document.title;
  var summary = (document.querySelector('meta[property="og:description"]') || {}).content || '';
  var e = encodeURIComponent;
  var links = [
    ['X', 'https://twitter.com/intent/tweet?text=' + e(title) + '&url=' + e(url)],
    ['Facebook', 'https://www.facebook.com/sharer/sharer.php?u=' + e(url)],
    ['LinkedIn', 'https://www.linkedin.com/sharing/share-offsite/?url=' + e(url)],
    ['Bluesky', 'https://bsky.app/intent/compose?text=' + e(title + ' ' + url)],
    ['WhatsApp', 'https://wa.me/?text=' + e(title + ' ' + url)],
    ['Email', 'mailto:?subject=' + e(title) + '&body=' + e(summary + '\\n\\n' + url)]
  ];
  document.querySelectorAll('[data-share]').forEach(function (bar) {
    if (!isPublic || !/^https?:/.test(url)) {
      bar.innerHTML = '<span class="share-note">This story is private. Make it public in My Story Maps to share it.</span>';
      return;
    }
    var label = document.createElement('span');
    label.className = 'share-label';
    label.textContent = 'Share';
    bar.appendChild(label);
    links.forEach(function (l) {
      var a = document.createElement('a');
      a.textContent = l[0];
      a.href = l[1];
      if (l[0] !== 'Email') { a.target = '_blank'; a.rel = 'noopener'; }
      bar.appendChild(a);
    });
    var copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'Copy link';
    copy.addEventListener('click', function () {
      navigator.clipboard.writeText(url).then(function () {
        copy.textContent = 'Link copied';
        setTimeout(function () { copy.textContent = 'Copy link'; }, 2000);
      });
    });
    bar.appendChild(copy);
  });
})();
</script>
<script src="${MAPLIBRE}/maplibre-gl.js"></script>
<script src="${COG_PROTOCOL}"></script>
<script src="${CHARTJS}"></script>
<script>
(function () {
  var page = JSON.parse(document.getElementById('story-data').textContent);
  var fc = function (features) { return { type: 'FeatureCollection', features: features || [] }; };

  if (window.MaplibreCOGProtocol && window.MaplibreCOGProtocol.cogProtocol) {
    try {
      maplibregl.addProtocol('cog', window.MaplibreCOGProtocol.cogProtocol);
    } catch (e) {
      console.warn('[StoryMap] COG protocol registration:', e);
    }
  }

  var map = new maplibregl.Map({
    container: 'map',
    attributionControl: { compact: true },
    style: {
      version: 8,
      sources: {
        imagery: { type: 'raster', tileSize: 256, attribution: 'Esri, Maxar, Earthstar Geographics',
          tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'] },
        labels: { type: 'raster', tileSize: 256,
          tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'] }
      },
      layers: [
        { id: 'imagery', type: 'raster', source: 'imagery' },
        { id: 'labels', type: 'raster', source: 'labels' }
      ]
    },
    center: [-92.8, 49.8], zoom: 7, cooperativeGestures: true
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

  function bboxPolygon(b) {
    return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]] } };
  }

  map.on('load', function () {
    map.addSource('fmu', { type: 'geojson', data: fc(page.layers.boundaries) });
    map.addSource('patches', { type: 'geojson', data: fc(page.layers.patches) });
    map.addSource('alerts', { type: 'geojson', data: fc(page.layers.alerts) });
    map.addSource('focus', { type: 'geojson', data: fc([]) });

    var isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    var hasCogProtocol = Boolean(window.MaplibreCOGProtocol && window.MaplibreCOGProtocol.cogProtocol);
    var cogs = page.layers.cogs || [];

    cogs.forEach(function (cog) {
      var targetUrl = (isLocal && cog.cogPath) ? (window.location.origin + cog.cogPath) : cog.url;
      var tileTarget = (isLocal && cog.tilePath) ? (window.location.origin + cog.tilePath) : cog.tileUrl;
      var sourceId = 'cog-' + cog.id;
      var layerId = 'cog-layer-' + cog.id;

      if (hasCogProtocol && targetUrl) {
        if (window.MaplibreCOGProtocol.setColorFunction) {
          if (cog.paletteType === 'wildfire') {
            window.MaplibreCOGProtocol.setColorFunction(targetUrl, function (pixel, color, metadata) {
              if (pixel[0] === metadata.noData) {
                color.set([0, 0, 0, 0]);
                return;
              }
              if (pixel[0] === 1) {
                color.set([255, 127, 0, 230]); // #FF7F00 Burned area
              } else {
                color.set([0, 0, 0, 0]);
              }
            });
          } else if (cog.paletteType === 'clearcut') {
            window.MaplibreCOGProtocol.setColorFunction(targetUrl, function (pixel, color, metadata) {
              if (pixel[0] === metadata.noData) {
                color.set([0, 0, 0, 0]);
                return;
              }
              if (pixel[0] === 2) {
                color.set([217, 119, 6, 220]); // #d97706 Standing clearcut
              } else {
                color.set([0, 0, 0, 0]);
              }
            });
          } else if (cog.paletteType === 'clearcut-annual') {
            window.MaplibreCOGProtocol.setColorFunction(targetUrl, function (pixel, color, metadata) {
              if (pixel[0] === metadata.noData) {
                color.set([0, 0, 0, 0]);
                return;
              }
              if (pixel[0] === 2) {
                color.set([220, 38, 38, 230]); // #dc2626 Annual clearcut
              } else {
                color.set([0, 0, 0, 0]);
              }
            });
          } else if (cog.paletteType === 'caribou') {
            var ramp = [
              [68, 1, 84, 180],
              [59, 82, 139, 180],
              [33, 145, 140, 180],
              [94, 201, 98, 180],
              [253, 231, 37, 180]
            ];
            window.MaplibreCOGProtocol.setColorFunction(targetUrl, function (pixel, color, metadata) {
              var v = pixel[0];
              if (v >= 1 && v <= 5) {
                color.set(ramp[v - 1]);
              } else {
                color.set([0, 0, 0, 0]);
              }
            });
          }
        }

        map.addSource(sourceId, {
          type: 'raster',
          url: 'cog://' + targetUrl,
          tileSize: 256
        });
        map.addLayer({
          id: layerId,
          type: 'raster',
          source: sourceId,
          paint: { 'raster-opacity': cog.opacity || 0.75 }
        }, 'labels');
      } else if (tileTarget) {
        map.addSource(sourceId, {
          type: 'raster',
          tiles: [tileTarget],
          tileSize: 256
        });
        map.addLayer({
          id: layerId,
          type: 'raster',
          source: sourceId,
          paint: { 'raster-opacity': cog.opacity || 0.75 }
        }, 'labels');
      }
    });

    map.addLayer({ id: 'patches', type: 'fill', source: 'patches', paint: { 'fill-color': '#d97706', 'fill-opacity': 0.55 } }, 'labels');
    map.addLayer({ id: 'alerts-fill', type: 'fill', source: 'alerts', paint: { 'fill-color': '#ff2d95', 'fill-opacity': 0.35 } }, 'labels');
    map.addLayer({ id: 'alerts-line', type: 'line', source: 'alerts', paint: { 'line-color': '#ff2d95', 'line-width': 1.5 } }, 'labels');
    map.addLayer({ id: 'fmu', type: 'line', source: 'fmu', paint: { 'line-color': '#ffffff', 'line-width': 2 } }, 'labels');
    map.addLayer({ id: 'focus', type: 'line', source: 'focus', paint: { 'line-color': '#fde047', 'line-width': 3, 'line-dasharray': [2, 1] } }, 'labels');
    focusOn(page.initialPlace, false);
  });

  map.on('error', function (e) {
    if (e && e.sourceId && e.sourceId.indexOf('cog-') === 0) {
      var cogId = e.sourceId.replace(/^cog-/, '');
      var cogs = page.layers.cogs || [];
      var cog = cogs.find(function (c) { return c.id === cogId; });
      if (cog && !cog._fellBack) {
        cog._fellBack = true;
        try {
          if (map.getLayer('cog-layer-' + cog.id)) map.removeLayer('cog-layer-' + cog.id);
          if (map.getSource('cog-' + cog.id)) map.removeSource('cog-' + cog.id);
          var isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
          var tileTarget = (isLocal && cog.tilePath) ? (window.location.origin + cog.tilePath) : cog.tileUrl;
          if (tileTarget) {
            var tileSourceId = 'tile-' + cog.id;
            map.addSource(tileSourceId, {
              type: 'raster',
              tiles: [tileTarget],
              tileSize: 256
            });
            map.addLayer({
              id: 'tile-layer-' + cog.id,
              type: 'raster',
              source: tileSourceId,
              paint: { 'raster-opacity': cog.opacity || 0.75 }
            }, 'labels');
          }
        } catch (err) {
          // ignore fallback errors
        }
      }
    }
  });

  var current = null;
  function focusOn(placeId, animate) {
    var place = page.places[placeId];
    if (!place || !place.bbox || placeId === current) return;
    current = placeId;
    var b = place.bbox;
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60, maxZoom: place.kind === 'fmu' ? 9 : 13, duration: animate === false ? 0 : 1600 });
    var src = map.getSource('focus');
    if (src) src.setData(fc(place.kind === 'fmu' ? [] : [bboxPolygon(b)]));
  }

  // Scroll-driven: the section in the middle of the viewport sets the map
  var steps = Array.prototype.slice.call(document.querySelectorAll('.step'));
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      steps.forEach(function (s) { s.classList.toggle('active', s === e.target); });
      if (map.loaded()) focusOn(e.target.getAttribute('data-place'));
    });
  }, { rootMargin: '-45% 0px -45% 0px' });
  steps.forEach(function (s) { observer.observe(s); });

  var palette = { clearcut_accumulated: '#d97706', clearcut_new: '#dc2626', clearcut_accuracy: '#2f8f5b', wildfire_area: '#ff7f00', caribou_core: '#21918c', alerts_monthly: '#c026d3' };
  page.charts.forEach(function (c) {
    var color = palette[c.id.split(':')[0]] || '#2f8f5b';
    new Chart(document.getElementById(c.canvasId), {
      type: c.type,
      data: { labels: c.labels, datasets: [{ label: c.title, data: c.values, backgroundColor: color, borderColor: color, borderWidth: 2, tension: 0.25, pointRadius: 3 }] },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false },
          tooltip: { callbacks: { label: function (ctx) { return ctx.parsed.y.toLocaleString('en-US') + ' ' + c.unit; } } } },
        scales: { y: { beginAtZero: true, title: { display: true, text: c.unit },
          ticks: { callback: function (v) { return Number(v).toLocaleString('en-US'); } } } }
      }
    });
  });
})();
</script>
</body>
</html>`;
}

module.exports = { renderStoryHtml, esc };
