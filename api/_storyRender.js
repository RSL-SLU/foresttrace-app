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
    <footer>Created with ForestTrace · Remote Sensing Lab, Saint Louis University.</footer>
  </main>
  <div class="map-wrap">
    <div id="map" role="img" aria-label="Map of the area discussed in this story"></div>
    <div class="legend">
      <div><span style="background:rgba(217,119,6,.75)"></span>Clearcut patches (${esc(facts.year)})</div>
      ${facts.layers.alerts.length ? '<div><span style="background:rgba(255,45,149,.75)"></span>Disturbance alerts (last 90 days)</div>' : ''}
      <div><span style="background:transparent;border:2px solid #fff"></span>Forest management unit</div>
    </div>
  </div>
</div>

<script id="story-data" type="application/json">${jsonForScript(page)}</script>
<script src="${MAPLIBRE}/maplibre-gl.js"></script>
<script src="${CHARTJS}"></script>
<script>
(function () {
  var page = JSON.parse(document.getElementById('story-data').textContent);
  var fc = function (features) { return { type: 'FeatureCollection', features: features || [] }; };

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
    map.addLayer({ id: 'patches', type: 'fill', source: 'patches', paint: { 'fill-color': '#d97706', 'fill-opacity': 0.55 } });
    map.addLayer({ id: 'alerts-fill', type: 'fill', source: 'alerts', paint: { 'fill-color': '#ff2d95', 'fill-opacity': 0.35 } });
    map.addLayer({ id: 'alerts-line', type: 'line', source: 'alerts', paint: { 'line-color': '#ff2d95', 'line-width': 1.5 } });
    map.addLayer({ id: 'fmu', type: 'line', source: 'fmu', paint: { 'line-color': '#ffffff', 'line-width': 2 } });
    map.addLayer({ id: 'focus', type: 'line', source: 'focus', paint: { 'line-color': '#fde047', 'line-width': 3, 'line-dasharray': [2, 1] } });
    focusOn(page.initialPlace, false);
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
