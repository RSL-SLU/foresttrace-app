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

// ForestTrace and SLU + Remote Sensing Lab logos, embedded (scripts/data/build-story-brand.js)
const { BRAND_BG, FORESTTRACE_LOGO, SLU_RSL_LOGO } = require('./_storyBrand');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const jsonForScript = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

// Basemap imagery by year, so a before/after or a year range shows the ground
// as it was: Sentinel-2 cloudless yearly mosaics (EOX, 2016 and 2018-2024, the
// same source the web app uses), the nearest earlier mosaic for other years,
// and current Esri imagery from 2025.
const EOX_YEARS = [2016, 2018, 2019, 2020, 2021, 2022, 2023, 2024];
const ESRI_TILES = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
// side 'after' takes the first mosaic at or after the year (so an "after the
// fire" view never shows imagery from before it); otherwise the nearest earlier.
function imageryFor(year, side = 'before') {
  const y = Number(year);
  if (!y || y >= 2025 || (side === 'after' && y > EOX_YEARS[EOX_YEARS.length - 1])) {
    return { label: 'Esri World Imagery (current)', year: 'current', tiles: [ESRI_TILES], attribution: 'Esri, Maxar, Earthstar Geographics' };
  }
  const pick = side === 'after'
    ? EOX_YEARS.find((v) => v >= y)
    : ([...EOX_YEARS].reverse().find((v) => v <= y) || EOX_YEARS[0]);
  const layer = pick === 2016 ? 's2cloudless_3857' : `s2cloudless-${pick}_3857`;
  return {
    label: `Sentinel-2 cloudless ${pick}`,
    year: pick,
    tiles: [`https://tiles.maps.eox.at/wmts/1.0.0/${layer}/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg`],
    attribution: `Sentinel-2 cloudless ${pick} by EOX IT Services GmbH (contains modified Copernicus Sentinel data)`,
  };
}

// Map sub-legends, one per story topic, shown while that step is read
const CARIBOU_CLASSES = [
  ['< 100 ha', '#440154', '#b2dfdb', 0.3], ['100 – 500 ha', '#3b528b', '#80cbc4', 0.8],
  ['500 – 1,000 ha', '#21918c', '#26a69a', 0.8], ['1,000 – 10,000 ha', '#5ec962', '#00897b', 0.8],
  ['> 10,000 ha', '#fde725', '#004d40', 0.8],
];
const ALERT_AGES = [['Last 7 days', '#ff2d95'], ['8–30 days', '#c026d3'], ['31–90 days', '#7c3aed'], ['Older', '#64748b']];

function renderStoryHtml({ story, facts, author, createdAt, model }) {
  // Legend helpers: which raster layers made it onto the map, and the period
  const hasCog = (layerId) => (facts.layers.cogs || []).some((c) => c.layerId === layerId);
  const span = facts.span || String(facts.year);
  const datasets = Object.fromEntries(facts.datasets.map((d) => [d.id, d]));
  const places = Object.fromEntries(facts.places.map((p) => [p.id, p]));
  const firstFmu = facts.places.find((p) => p.kind === 'fmu');
  const date = new Date(createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Drop references to anything that doesn't exist rather than failing the
  // page. A chart names one dataset (datasetId), several (datasetIds: one
  // series per region), or -- framework stories only -- carries its own
  // values computed from the facts (share donuts).
  const regionName = (id) => (facts.regions.find((r) => r.id === String(id).split(':')[1]) || {}).name || id;
  const compares = Object.fromEntries((facts.compares || []).map((c) => [c.id, c]));
  const validChart = (c) => {
    if (!c) return null;
    if (Array.isArray(c.values) && story.engine === 'template') return c;
    const ids = (c.datasetIds || [c.datasetId]).filter((id) => datasets[id]);
    return ids.length ? { ...c, datasetIds: ids } : null;
  };
  const sections = story.sections.map((s, i) => {
    const chart = validChart(s.chart);
    const first = chart && !chart.values ? datasets[chart.datasetIds[0]] : null;
    return {
      ...s,
      placeId: places[s.placeId] ? s.placeId : firstFmu?.id || null,
      chart,
      chartId: `chart-${i}`,
      chartUnit: chart ? (chart.values ? chart.unit : first.unit) : '',
      chartSource: chart ? (chart.values ? chart.source : first.source) : '',
      compare: s.compareId && compares[s.compareId] ? { ...compares[s.compareId], el: `cmp-${i}` } : null,
    };
  });
  const usedSources = [...new Set(sections
    .filter((s) => s.chart).map((s) => s.chartSource)
    .concat(story.keyFacts.map((k) => datasets[k.sourceDatasetId]?.source).filter(Boolean)))];
  const demoData = facts.regions.some((r) => r.alerts?.demoData);

  // Charts as label + series lists. Several datasets share a union of years;
  // a region missing a year gets a gap, not a zero.
  const charts = sections.filter((s) => s.chart).map((s) => {
    const c = s.chart;
    if (c.values) {
      return { canvasId: s.chartId, type: c.type, title: c.title, unit: c.unit, labels: c.labels, colors: c.colors || null,
        horizontal: Boolean(c.horizontal), series: [{ label: c.title, key: '', values: c.values }] };
    }
    const ds = c.datasetIds.map((id) => datasets[id]);
    const labels = [...new Set(ds.flatMap((d) => d.labels))].sort();
    return {
      canvasId: s.chartId,
      type: ds.length > 1 ? 'line' : c.type,
      title: c.title,
      unit: ds[0].unit,
      labels,
      series: ds.map((d) => ({
        label: regionName(d.id),
        key: d.id.split(':')[0],
        values: labels.map((l) => { const k = d.labels.indexOf(l); return k < 0 ? null : d.values[k]; }),
      })),
    };
  });

  // Framework components (api/_storyFramework.js). Claude stories without
  // them still render: every block is optional.
  const isTemplate = story.engine === 'template';
  const questions = (story.questions || []).filter((q) => q && q.q && q.a);
  const PER_YEAR = ['clearcut-annual', 'clearcut-ml-annual', 'wildfire-burned'];
  const playerYears = [...new Set((facts.layers.cogs || [])
    .filter((c) => PER_YEAR.includes(c.layerId)).map((c) => c.year))].sort((a, b) => a - b);

  // Imagery for the story year, each player year, and each compare side
  const baseImagery = imageryFor(facts.year);
  const imageryByYear = Object.fromEntries(playerYears.map((y) => [y, imageryFor(y)]));
  const compareList = sections.filter((s) => s.compare).map((s) => ({
    ...s.compare,
    left: { ...s.compare.left, imagery: imageryFor(s.compare.left.year) },
    right: { ...s.compare.right, imagery: imageryFor(s.compare.right.year, 'after') },
  }));
  const fills = sections.filter((s) => s.regionFill).map((s) => s.regionFill);
  const usesEox = [baseImagery, ...Object.values(imageryByYear), ...compareList.flatMap((c) => [c.left.imagery, c.right.imagery])]
    .some((im) => im.year !== 'current');

  const swatch = (color, label, opacity = 1) => `<div><span style="background:${color};opacity:${opacity}"></span>${esc(label)}</div>`;
  const caribouTeal = (facts.layers.cogs || []).some((c) => c.paletteType === 'caribou' && c.singleHue);
  const aiOn = hasCog('clearcut-ml-annual') || hasCog('clearcut-ml-accumulated');
  function topicLegend(sec) {
    const cmpAi = sec.compare && sec.compare.left.cog && sec.compare.left.cog.paletteType === 'ai-status';
    const clearcutItems = () => [
      (hasCog('clearcut-accumulated') || (sec.compare && !cmpAi)) ? swatch('#d97706', 'Standing clearcut (official inventory)') : '',
      hasCog('clearcut-annual') ? swatch('#dc2626', 'Clearcut in that year') : '',
      (aiOn || cmpAi) ? swatch('#f59e0b', 'AI estimate, provisional') + swatch('#991b1b', 'AI estimate, confirmed by harvest record') + swatch('#7e22ce', 'AI estimate, confirmed by persistence') : '',
    ].join('');
    switch (sec.topic) {
      case 'habitat':
        return `<p class="leg-title">Core caribou habitat · patch size</p>${CARIBOU_CLASSES.map(([label, viridis, teal, op]) => swatch(caribouTeal ? teal : viridis, label, op)).join('')}<p class="leg-note">Larger patches support caribou; the faint class is speckle.</p>`;
      case 'clearcut':
      case 'newCuts':
        return `<p class="leg-title">Clearcuts</p>${clearcutItems()}`;
      case 'fire':
        return `<p class="leg-title">Wildfire</p>${swatch('#facc15', 'Burned area (NBAC)')}`;
      case 'combined':
        return `<p class="leg-title">Harvest and fire</p>${clearcutItems()}${swatch('#facc15', 'Burned area (NBAC)')}`;
      case 'alerts':
        return `<p class="leg-title">Disturbance alerts · age</p>${ALERT_AGES.map(([l, c]) => swatch(c, l)).join('')}`;
      case 'overview':
        return sec.chart && sec.chart.colors
          ? `<p class="leg-title">Areas (as in the chart)</p>${sec.chart.labels.map((l, i) => swatch(sec.chart.colors[i], l, 0.75)).join('')}`
          : '';
      default:
        return '';
    }
  }

  // More than three areas: say how many instead of listing every name in
  // the eyebrow, the map tag and the image description (the charts list them)
  const names = facts.regions.map((r) => r.name);
  const areaSummary = names.length > 3 ? `${names.length} forest management units` : names.join(', ');

  const page = {
    imagery: baseImagery,
    imageryByYear,
    fills,
    regionLabels: facts.regions.filter((r) => r.labelPoint).map((r) => ({ id: r.id, name: r.name, point: r.labelPoint })),
    playerYears,
    perYearLayers: PER_YEAR,
    compares: compareList,
    places,
    initialPlace: firstFmu?.id || null,
    // Opening zoom (Canada -> Ontario -> the story's area) lands here
    heroPlace: places['area:all'] ? 'area:all' : (firstFmu?.id || null),
    heroLabel: names.length > 3 ? `${names.length} FMUs` : names.join(' · '),
    charts,
    year: facts.year,
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
<meta property="og:image:alt" content="Satellite map of ${esc(areaSummary)} with the areas discussed in the story">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(story.title)}">
<meta name="twitter:description" content="${esc(story.dek)}">
<meta name="twitter:image" content="__FT_IMAGE_URL__">
<link rel="stylesheet" href="${MAPLIBRE}/maplibre-gl.css">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..700&family=IBM+Plex+Mono:wght@400;500&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&display=swap">
<style>
  /* Story map framework components (api/_storyFramework.js), after the RSL
     caribou story's vocabulary: eyebrow labels, condensed display type,
     kstats, key questions, numbered steps, plates, folded notes, next cards,
     an imagery badge and a year player on the map. */
  :root {
    --ground:#f4f5f1; --surface:#fbfbf9; --line:#d9dcd2; --line-2:#c3c7bb;
    --ink:#171a14; --ink-2:#4a4f45; --ink-3:#6c7166; --accent:#1a7539; --accent-soft:#e2eee2;
    --f-display:"Archivo","Arial Narrow","Helvetica Neue",Arial,sans-serif;
    --f-body:"Source Serif 4",Georgia,"Times New Roman",serif;
    --f-mono:"IBM Plex Mono",ui-monospace,Consolas,monospace;
  }
  * { box-sizing:border-box; }
  body { margin:0; font-family:var(--f-body); color:var(--ink); background:var(--ground); }
  .layout { display:grid; grid-template-columns:minmax(0, 1fr) minmax(0, 1fr); }
  .story { padding:48px clamp(20px, 5vw, 64px) 96px; max-width:720px; justify-self:end; width:100%; }
  .map-wrap { position:sticky; top:0; height:100vh; }
  #map { position:absolute; inset:0; }
  .eyebrow { font:500 .72rem/1.4 var(--f-mono); letter-spacing:.08em; text-transform:uppercase; color:var(--ink-3); margin:0 0 12px; }
  .eyebrow b { color:var(--accent); font-weight:500; }
  h1, h2, h3 { font-family:var(--f-display); text-wrap:balance; margin:0; }
  h1 { font-stretch:76%; font-weight:700; font-size:clamp(2.2rem, 4.6vw, 3.4rem); line-height:.96; text-transform:uppercase; margin-bottom:16px; }
  h2 { font-stretch:86%; font-weight:650; font-size:1.6rem; line-height:1.12; }
  .dek { font-size:1.2rem; line-height:1.5; color:var(--ink-2); margin:0 0 18px; }
  .byline { font:.75rem/1.5 var(--f-mono); color:var(--ink-3); border-top:1px solid var(--line); border-bottom:1px solid var(--line); padding:10px 0; margin:0 0 22px; }
  .notice { font:.85rem/1.5 var(--f-body); background:var(--accent-soft); border-left:3px solid var(--accent); padding:10px 12px; margin:0 0 28px; }
  .notice.ai { background:#fff7e6; border-left-color:#d97706; }
  p { font-size:1.08rem; line-height:1.7; margin:0 0 16px; max-width:65ch; }
  .lede { font-size:1.2rem; }
  .kstats { display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:1px; background:var(--line); border:1px solid var(--line); margin:8px 0 36px; }
  .kstat { background:var(--surface); padding:14px 14px 12px; display:grid; gap:4px; align-content:start; }
  .kstat .v { font:700 1.7rem/1 var(--f-display); font-stretch:82%; color:var(--accent); }
  .kstat .k { font-size:.88rem; line-height:1.35; color:var(--ink-2); }
  .kstat small { font:.7rem/1.3 var(--f-mono); color:var(--ink-3); }
  .qa { list-style:none; margin:0 0 40px; padding:0; border-top:1px solid var(--line); }
  .qa li { display:grid; grid-template-columns:auto 1fr; gap:4px 14px; padding:14px 0; border-bottom:1px solid var(--line); }
  .qa .qn { font:500 .68rem/1.6 var(--f-mono); letter-spacing:.08em; text-transform:uppercase; color:var(--ink-3); grid-row:span 3; padding-top:2px; }
  .qa .qt { font:650 1.05rem/1.3 var(--f-display); font-stretch:88%; }
  .qa .a { font-size:1rem; line-height:1.5; color:var(--ink-2); }
  .howlink { font:.75rem/1.4 var(--f-mono); color:var(--accent); text-decoration:none; }
  .howlink:hover { text-decoration:underline; }
  .step { padding:28px 0 36px; border-top:1px solid var(--line); min-height:60vh; scroll-margin-top:24px; }
  .step-no { display:inline-flex; align-items:center; gap:10px; font:.72rem/1 var(--f-mono); letter-spacing:.08em; text-transform:uppercase; color:var(--ink-3); margin-bottom:12px; }
  .step-no::before { content:attr(data-n); display:grid; place-items:center; width:24px; height:24px; border-radius:50%; border:1.5px solid var(--line-2); color:var(--ink-2); font-size:.72rem; transition:background .3s, color .3s, border-color .3s; }
  .step.active .step-no::before { background:var(--accent); border-color:var(--accent); color:#fff; }
  .step h2 { margin-bottom:14px; }
  .plate { margin:20px 0 0; background:var(--surface); border:1px solid var(--line); border-radius:3px; overflow:hidden; }
  .plate-head { display:flex; flex-wrap:wrap; align-items:baseline; gap:4px 14px; padding:10px 14px 9px; border-bottom:1px solid var(--line); }
  .plate-title { font:620 1rem/1.3 var(--f-display); font-stretch:88%; }
  .plate-meta { margin-left:auto; font:.7rem/1.3 var(--f-mono); color:var(--ink-3); }
  .chart-box { position:relative; height:240px; padding:10px 12px 4px; }
  .plate-foot { padding:8px 14px 10px; border-top:1px solid var(--line); font-size:.85rem; line-height:1.45; color:var(--ink-2); }
  .chart-box.donut { height:260px; }
  .beat { transition:color .3s; }
  .beat[data-place].active-beat { color:var(--ink); }
  .cmp { position:relative; height:340px; background:#0d110a; }
  .cmp-map { position:absolute; inset:0; }
  .cmp-right { clip-path:inset(0 0 0 50%); }
  /* The divider is the control: a wide invisible grab strip around a 2px
     line, with a round handle in the middle (drag, or arrow keys) */
  .cmp-line { position:absolute; top:0; bottom:0; left:50%; width:28px; margin-left:-14px; z-index:3; cursor:ew-resize; touch-action:none; }
  .cmp-line::before { content:''; position:absolute; top:0; bottom:0; left:13px; width:2px; background:#fff; box-shadow:0 0 0 1px rgba(0,0,0,.35); }
  .cmp-handle { position:absolute; top:50%; left:50%; width:32px; height:32px; margin:-16px 0 0 -16px; border-radius:50%; background:#fff; box-shadow:0 1px 6px rgba(0,0,0,.45); display:grid; place-items:center; outline-offset:2px; }
  .cmp-handle::before { content:'‹ ›'; font:600 15px/1 var(--f-mono); color:var(--ink-2); }
  .cmp-handle:focus-visible { outline:2px solid var(--accent); }
  .cmp.dragging, .cmp.dragging * { cursor:ew-resize; user-select:none; }
  .yr-tag { position:absolute; top:10px; z-index:2; font:500 .7rem/1 var(--f-mono); letter-spacing:.04em; color:#fff; background:rgba(13,17,10,.72); padding:5px 7px; border-radius:2px; pointer-events:none; }
  .yr-tag.l { left:10px; }
  .yr-tag.r { right:10px; }
  /* compare slider on the main map */
  .map-after { position:absolute; inset:0; clip-path:inset(0 0 0 50%); z-index:1; }
  .map-after[hidden], .cmp-line[hidden], .yr-tag[hidden] { display:none; }
  .map-wrap .yr-tag { top:66px; z-index:4; }
  .cmp-hint { font-size:.95rem; line-height:1.55; color:var(--ink-2); background:var(--surface); border:1px solid var(--line); border-left:3px solid var(--accent); padding:10px 12px; margin:18px 0 0; }
  .cmp-hint .eyebrow { display:block; margin:0 0 4px; }
  /* legends: per-topic sub-legend above the general one */
  .legend-stack { position:absolute; left:12px; bottom:28px; z-index:4; display:flex; flex-direction:column; gap:8px; max-width:280px; }
  .legend-stack .legend { position:static; }
  .topic-legend { background:rgba(251,251,249,.96); border:1px solid var(--line); border-left:3px solid var(--accent); border-radius:3px; padding:8px 10px; font:12px/1.6 var(--f-body); }
  .topic-legend span { display:inline-block; width:12px; height:12px; border-radius:2px; margin-right:6px; vertical-align:-1px; }
  .leg-title { font:600 .66rem/1.3 var(--f-mono); letter-spacing:.08em; text-transform:uppercase; color:var(--ink-3); margin:0 0 4px; }
  .leg-note { font-size:.75rem; line-height:1.35; color:var(--ink-3); margin:4px 0 0; }
  /* FMU names, shown once zoomed in */
  .fmu-label { font:600 .68rem/1.1 var(--f-mono); letter-spacing:.08em; text-transform:uppercase; color:#fff; text-shadow:0 0 3px rgba(0,0,0,.95), 0 0 8px rgba(0,0,0,.7); pointer-events:none; white-space:nowrap; opacity:0; transition:opacity .3s; }
  .fmu-label.on { opacity:1; }
  .map-wrap.globe { background:#0b0f0a; }
  /* brand card: ForestTrace | Saint Louis University + Remote Sensing Lab */
  .brand-card { position:absolute; right:10px; bottom:34px; z-index:4; display:flex; align-items:center; gap:10px; padding:6px 10px; border:1px solid var(--line); border-radius:3px; box-shadow:0 1px 6px rgba(0,0,0,.25); }
  .brand-card img { display:block; height:44px; width:auto; }
  .brand-card a { display:block; border-radius:2px; }
  .brand-card a:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  .brand-rule { width:1px; height:36px; background:var(--line-2); }
  .back-matter { border-top:2px solid var(--ink); margin-top:24px; padding-top:18px; }
  .note-fold { border-bottom:1px solid var(--line); padding:12px 0; }
  .note-fold summary { cursor:pointer; font:650 1rem/1.3 var(--f-display); font-stretch:88%; list-style:none; }
  .note-fold summary::-webkit-details-marker { display:none; }
  .note-fold summary::before { content:'+'; display:inline-block; width:1.2em; font-family:var(--f-mono); color:var(--accent); }
  .note-fold[open] summary::before { content:'–'; }
  .note-fold p, .note-fold li { font-size:.95rem; line-height:1.6; }
  .note-fold p { margin-top:8px; }
  .note-fold ul { padding-left:1.2em; margin:8px 0 0; }
  .next-band { display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:10px; margin:28px 0 0; }
  .next-card { display:grid; gap:6px; align-content:start; padding:14px; background:var(--surface); border:1px solid var(--line); border-radius:3px; color:inherit; text-decoration:none; }
  .next-card:hover { border-color:var(--accent); }
  .next-card .eyebrow { margin:0; }
  .next-card b { font:650 1rem/1.25 var(--f-display); font-stretch:88%; }
  .next-card span:last-child { font-size:.85rem; color:var(--ink-2); }
  .legend { position:absolute; left:12px; bottom:28px; background:rgba(251,251,249,.94); border:1px solid var(--line); border-radius:3px; padding:8px 10px; font:12px/1.6 var(--f-body); max-width:280px; }
  .legend span { display:inline-block; width:12px; height:12px; border-radius:2px; margin-right:6px; vertical-align:-1px; }
  .scale-tag { position:absolute; left:12px; top:38px; z-index:2; font:600 .72rem/1 var(--f-mono); letter-spacing:.08em; text-transform:uppercase; color:#fff; background:var(--accent); padding:6px 9px; border-radius:2px; transition:opacity .3s; }
  .scale-tag[hidden] { display:block; opacity:0; }
  .sat-badge { position:absolute; left:12px; top:12px; z-index:2; font:.66rem/1 var(--f-mono); letter-spacing:.04em; text-transform:uppercase; color:#fff; background:rgba(13,17,10,.62); padding:5px 8px; border-radius:2px; }
  .tl { position:absolute; right:12px; bottom:104px; z-index:2; display:flex; align-items:center; gap:6px; background:rgba(251,251,249,.95); border:1px solid var(--line); border-radius:3px; padding:6px 8px; max-width:calc(100% - 320px); overflow-x:auto; }
  .tl button { font:500 .72rem/1 var(--f-mono); border:1px solid var(--line-2); background:transparent; color:var(--ink-2); padding:6px 8px; border-radius:2px; cursor:pointer; white-space:nowrap; }
  .tl button[aria-pressed="true"] { background:var(--accent); border-color:var(--accent); color:#fff; }
  .tl .tl-play { width:30px; padding:6px 0; }
  .share { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin:0 0 24px; font:.8rem/1.4 var(--f-mono); }
  .share-label { color:var(--ink-3); margin-right:4px; text-transform:uppercase; letter-spacing:.08em; }
  .share a, .share button { display:inline-flex; align-items:center; padding:6px 12px; border:1px solid var(--line-2); border-radius:2px; background:var(--surface); color:var(--ink); font:500 .75rem/1.2 var(--f-mono); text-decoration:none; cursor:pointer; }
  .share a:hover, .share button:hover { border-color:var(--accent); color:var(--accent); }
  .share-note { color:var(--ink-3); font-style:italic; font-family:var(--f-body); }
  footer { font:.72rem/1.5 var(--f-mono); color:var(--ink-3); margin-top:40px; }
  footer a { color:var(--accent); }
  @media (max-width: 860px) {
    .layout { grid-template-columns:1fr; }
    .map-wrap { position:sticky; top:0; height:42vh; z-index:2; order:-1; }
    .story { padding-top:28px; justify-self:stretch; }
    .step { min-height:40vh; }
    /* Phone: card bottom-left (the legends are hidden here), year player
       above it, imagery credit collapsed to its (i) button */
    .brand-card { left:8px; right:auto; bottom:8px; gap:6px; padding:4px 6px; }
    .brand-card img { height:24px; }
    .brand-rule { height:20px; }
    .tl { left:8px; right:8px; max-width:none; bottom:52px; }
    .sat-badge { max-width:calc(100% - 64px); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .legend { display:none; }
  }
</style>
</head>
<body>
<div class="layout">
  <main class="story">
    <p class="eyebrow"><b>${esc(story.kicker || 'ForestTrace story map')}</b> · ${esc(areaSummary)} · ${esc(span)}</p>
    <h1>${esc(story.title)}</h1>
    <p class="dek">${esc(story.dek)}</p>
    <div class="byline">${esc(author)} · ${esc(date)} · Data: ForestTrace, Remote Sensing Lab, Saint Louis University</div>
    <div class="share" data-share></div>
    ${isTemplate
      ? `<div class="notice"><strong>Built from the data.</strong> Assembled automatically by ForestTrace from the datasets listed under Sources; every figure is taken directly from them.${demoData ? ' Disturbance alerts in this story are <strong>demonstration data</strong>.' : ''}</div>`
      : `<div class="notice ai"><strong>AI-assisted draft.</strong> Written by ${esc(model)} from ForestTrace data; every chart is drawn from the underlying datasets. Verify figures before publication.${demoData ? ' Disturbance alerts in this story are <strong>demonstration data</strong>.' : ''}</div>`}

    <section class="step" data-place="${esc(page.initialPlace || '')}" style="border-top:none; min-height:auto;">
      <p class="lede">${esc(story.lede)}</p>
      ${story.keyFacts.length ? `<div class="kstats">${story.keyFacts.map((k) => `
        <div class="kstat"><span class="v">${esc(k.value)}</span><span class="k">${esc(k.label)}</span>${k.delta ? `<small>${esc(k.delta)}</small>` : ''}</div>`).join('')}
      </div>` : ''}
      ${questions.length ? `<p class="eyebrow">Key questions</p><ol class="qa">${questions.map((q, i) => `
        <li><span class="qn">Question ${i + 1}</span><span class="qt">${esc(q.q)}</span><span class="a">${esc(q.a)}</span>${q.section >= 0 && sections[q.section] ? `<a class="howlink" href="#step-${q.section + 1}">${esc(sections[q.section].heading)} →</a>` : ''}</li>`).join('')}
      </ol>` : ''}
    </section>
${sections.map((s, i) => `
    <section class="step" id="step-${i + 1}" data-step="${i + 1}" data-topic="${esc(s.topic || '')}" data-place="${esc(s.placeId || '')}"${s.compare ? ` data-compare="${compareList.findIndex((c) => c.id === s.compare.id)}"` : ''}${s.regionFill ? ` data-fill="${fills.indexOf(s.regionFill)}"` : ''}>
      <span class="step-no" data-n="${i + 1}">Step ${i + 1} of ${sections.length}</span>
      <h2>${esc(s.heading)}</h2>
      ${(s.beats || s.paragraphs.map((p) => ({ text: p }))).map((b) => `<p class="beat"${b.placeId && places[b.placeId] ? ` data-place="${esc(b.placeId)}"` : ''}>${esc(b.text)}</p>`).join('\n      ')}
      ${s.chart ? `<figure class="plate">
        <div class="plate-head"><span class="plate-title">${esc(s.chart.title)}</span><span class="plate-meta">${esc(s.chartUnit)}</span></div>
        <div class="chart-box"><canvas id="${s.chartId}"></canvas></div>
        <figcaption class="plate-foot">${esc(s.chart.caption)} Source: ${esc(s.chartSource)}.</figcaption>
      </figure>` : ''}
      ${s.compare ? `<p class="cmp-hint"><span class="eyebrow">On the map</span> ${esc(s.compare.title)}: drag the divider to compare <b>${esc(s.compare.left.label)}</b> and <b>${esc(s.compare.right.label)}</b>, each over imagery from its year. ${esc(s.compare.caption.replace(/ Drag the divider on the map to compare\.$/, ''))}</p>` : ''}
    </section>`).join('')}

    <div class="back-matter">
      <details class="note-fold" id="how" open><summary>How this was made</summary><p>${esc(story.methodology)}</p></details>
      ${story.caveats.length ? `<details class="note-fold" id="caveats"><summary>Caveats</summary><ul>${story.caveats.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></details>` : ''}
      <details class="note-fold" id="sources"><summary>Sources</summary><ul>${usedSources.map((src) => `<li>${esc(src)}</li>`).join('')}<li>Basemap imagery: Esri, Maxar, Earthstar Geographics${usesEox ? '; Sentinel-2 cloudless yearly mosaics by EOX IT Services GmbH (contains modified Copernicus Sentinel data)' : ''}</li></ul></details>
      <nav class="next-band" aria-label="More">
        <a class="next-card" href="#how"><span class="eyebrow">Method</span><b>How the figures were made</b><span>Data sources and processing behind every number.</span></a>
        ${story.caveats.length ? '<a class="next-card" href="#caveats"><span class="eyebrow">Limits</span><b>What the data can’t tell you</b><span>Caveats to keep in mind before citing these figures.</span></a>' : ''}
        <a class="next-card" href="__FT_ORIGIN__/"><span class="eyebrow">Explore</span><b>Open the map</b><span>See the same layers for any forest management unit.</span></a>
      </nav>
    </div>
    <div class="share" data-share style="margin-top:28px"></div>
    <footer>Created with ForestTrace · Remote Sensing Lab, Saint Louis University.</footer>
  </main>
  <div class="map-wrap">
    <div id="map" role="img" aria-label="Map of the area discussed in this story"></div>
    <div id="map-after" class="map-after" hidden></div>
    <div class="cmp-line" id="cmp-line" hidden><span class="cmp-handle" id="cmp-handle" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50" aria-label="Compare years: drag, or use the arrow keys"></span></div>
    <span class="yr-tag l" id="yr-l" hidden></span><span class="yr-tag r" id="yr-r" hidden></span>
    <span class="sat-badge" id="sat-badge">Imagery: ${esc(baseImagery.label)} · data ${esc(span)}</span>
    <span class="scale-tag" id="scale-tag" aria-live="polite">Canada</span>
    ${playerYears.length > 1 ? `<div class="tl" id="tl" role="group" aria-label="Year shown on the map">
      <button type="button" class="tl-play" id="tl-play" aria-label="Play years">▶</button>
      <button type="button" data-year="all" aria-pressed="true">All</button>
      ${playerYears.map((y) => `<button type="button" data-year="${y}" aria-pressed="false">${y}</button>`).join('')}
    </div>` : ''}
    <div class="legend-stack">
    ${sections.map((sec, i) => { const html = topicLegend(sec); return html ? `<div class="topic-legend" data-step="${i + 1}" hidden>${html}</div>` : ''; }).join('')}
    <div class="legend">
      ${facts.isWildfire ? `<div><span style="background:rgba(250,204,21,.85)"></span>Wildfire burned area (${esc(span)})</div>` : ''}
      ${hasCog('clearcut-accumulated') || (facts.isClearcut && facts.layers.patches.length) ? `<div><span style="background:rgba(217,119,6,.75)"></span>Standing clearcut (${esc(facts.year)})</div>` : ''}
      ${hasCog('clearcut-annual') ? `<div><span style="background:rgba(220,38,38,.8)"></span>${facts.yearRange ? 'Clearcuts' : 'Annual clearcut'} (${esc(span)})</div>` : ''}
      ${hasCog('clearcut-ml-annual') || hasCog('clearcut-ml-accumulated') ? `<div><span style="background:rgba(245,158,11,.75)"></span>AI estimate, provisional${facts.aiMinConfidence ? ` (${esc(facts.aiMinConfidence)}%+ confidence)` : ''}</div><div><span style="background:rgba(153,27,27,.9)"></span>AI estimate, confirmed</div>` : ''}
      ${facts.hasCaribou ? `<div><span style="background:rgba(33,145,140,.8)"></span>Caribou habitat</div>` : ''}
      ${facts.layers.alerts.length ? '<div><span style="background:rgba(255,45,149,.75)"></span>Disturbance alerts (last 90 days)</div>' : ''}
      <div><span style="background:transparent;border:2px solid #fff"></span>Forest management unit</div>
    </div>
    </div>
    <div class="brand-card" style="background:${BRAND_BG}">
      <a href="__FT_ORIGIN__/" target="_blank" rel="noopener" title="Explore the data on ForestTrace"><img src="${FORESTTRACE_LOGO}" alt="ForestTrace"></a>
      <span class="brand-rule" aria-hidden="true"></span>
      <img src="${SLU_RSL_LOGO}" alt="Remote Sensing Lab, Saint Louis University">
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
  var isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  var cogUrlOf = function (cog) { return (isLocalHost && cog.cogPath) ? (window.location.origin + cog.cogPath) : cog.url; };

  // Colour functions per product, keyed by COG URL (the protocol's registry).
  // Shared by the main map and the compare plates; colours match the web app.
  var CARIBOU_VIRIDIS = [[68, 1, 84, 70], [59, 82, 139, 200], [33, 145, 140, 200], [94, 201, 98, 200], [253, 231, 37, 200]];
  var CARIBOU_TEAL = [[178, 223, 219, 70], [128, 203, 196, 200], [38, 166, 154, 200], [0, 137, 123, 200], [0, 77, 64, 200]];
  var AI_COLORS = { 1: [245, 158, 11], 2: [153, 27, 27], 4: [126, 34, 206] };
  function registerColor(cog, url) {
    var P = window.MaplibreCOGProtocol;
    if (!P || !P.setColorFunction) return;
    var clear = [0, 0, 0, 0];
    var classColor = function (cls, rgba) {
      return function (pixel, color, metadata) {
        color.set(pixel[0] !== metadata.noData && pixel[0] === cls ? rgba : clear);
      };
    };
    if (cog.paletteType === 'wildfire') {
      // Yellow: stories sit on satellite imagery (charcoal disappears there)
      P.setColorFunction(url, classColor(1, [250, 204, 21, 210]));
    } else if (cog.paletteType === 'clearcut') {
      P.setColorFunction(url, classColor(2, [217, 119, 6, 220]));
    } else if (cog.paletteType === 'clearcut-annual') {
      P.setColorFunction(url, classColor(2, [220, 38, 38, 230]));
    } else if (cog.paletteType === 'ai-status') {
      // Mirrors statusColorFn (client/src/utils/borealLayers.js): bands
      // STATUS, CONFIDENCE, DETECTION_YEAR, CONFIRMATION_YEAR; a status
      // confirmed after the viewed year still reads as provisional, and
      // provisional pixels under the author's confidence threshold are hidden.
      var minConf = cog.minConfidence || 0;
      var viewYear = cog.viewYear || page.year;
      P.setColorFunction(url, function (pixel, color) {
        var st = pixel[0];
        if (st === 2 || st === 4) st = pixel[3] > viewYear ? 1 : st;
        if (st !== 1 && st !== 2 && st !== 4) { color.set(clear); return; }
        if (st === 1) {
          var conf = pixel[1] === 65535 ? 0 : Math.min(100, pixel[1]);
          if (conf < minConf) { color.set(clear); return; }
          color.set(AI_COLORS[1].concat([Math.round(255 * (0.15 + 0.8 * conf / 100))]));
          return;
        }
        color.set(AI_COLORS[st].concat([235]));
      });
    } else if (cog.paletteType === 'caribou') {
      // Viridis on its own, single-hue teal alongside other modules
      // (client/src/utils/caribouClasses.js); class 1 is faint speckle
      var ramp = cog.singleHue ? CARIBOU_TEAL : CARIBOU_VIRIDIS;
      P.setColorFunction(url, function (pixel, color) {
        var v = pixel[0];
        color.set(v >= 1 && v <= 5 ? ramp[v - 1] : clear);
      });
    }
  }

  if (window.MaplibreCOGProtocol && window.MaplibreCOGProtocol.cogProtocol) {
    try {
      maplibregl.addProtocol('cog', window.MaplibreCOGProtocol.cogProtocol);
    } catch (e) {
      console.warn('[StoryMap] COG protocol registration:', e);
    }
  }

  // The opening globe only with GPU-accelerated WebGL: a context that refuses
  // a major performance caveat, not a known software renderer, a device with
  // memory to spare, and no reduced-motion preference. Everyone else gets the
  // flat Canada -> Ontario -> area zoom.
  var GLOBE_OK = (function () {
    try {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
      if (navigator.deviceMemory && navigator.deviceMemory < 4) return false;
      var c = document.createElement('canvas');
      var opts = { failIfMajorPerformanceCaveat: true };
      var gl = c.getContext('webgl2', opts) || c.getContext('webgl', opts);
      if (!gl) return false;
      var info = gl.getExtension('WEBGL_debug_renderer_info');
      var renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
      var lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      return !/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i.test(renderer);
    } catch (e) {
      return false;
    }
  })();

  var map = new maplibregl.Map({
    container: 'map',
    attributionControl: { compact: true },
    style: {
      version: 8,
      sources: {
        imagery: { type: 'raster', tileSize: 256, attribution: page.imagery.attribution, tiles: page.imagery.tiles },
        labels: { type: 'raster', tileSize: 256,
          tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'] }
      },
      layers: [
        { id: 'imagery', type: 'raster', source: 'imagery' },
        { id: 'labels', type: 'raster', source: 'labels' }
      ]
    },
    center: GLOBE_OK ? [-60, 40] : [-96, 60], zoom: GLOBE_OK ? 1.3 : 2.4, cooperativeGestures: true
  });
  if (GLOBE_OK) {
    document.querySelector('.map-wrap').classList.add('globe');
    // MapLibre flattens the globe to Mercator as it zooms in, so the steps
    // after the opening are unaffected
    map.on('style.load', function () {
      if (map.setProjection) map.setProjection({ type: 'globe' });
      if (map.setSky) map.setSky({ 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0] });
    });
  }
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  // On narrow screens the expanded credit runs under the year player and the
  // brand card: start it collapsed (its (i) button still opens it)
  if (window.matchMedia && window.matchMedia('(max-width: 860px)').matches) {
    map.once('load', function () {
      document.querySelectorAll('.maplibregl-ctrl-attrib.maplibregl-compact-show').forEach(function (el) {
        el.classList.remove('maplibregl-compact-show');
        el.removeAttribute('open');
      });
    });
  }

  function bboxPolygon(b) {
    return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]] } };
  }

  map.on('load', function () {
    map.addSource('fmu', { type: 'geojson', data: fc(page.layers.boundaries) });
    // Overview fills (each area in its chart colour), under every data layer
    map.addLayer({ id: 'fmu-fill', type: 'fill', source: 'fmu', paint: { 'fill-color': '#9ca3af', 'fill-opacity': 0, 'fill-opacity-transition': { duration: 700, delay: 0 } } }, 'labels');
    map.addSource('patches', { type: 'geojson', data: fc(page.layers.patches) });
    map.addSource('alerts', { type: 'geojson', data: fc(page.layers.alerts) });
    map.addSource('focus', { type: 'geojson', data: fc([]) });

    var isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    var hasCogProtocol = Boolean(window.MaplibreCOGProtocol && window.MaplibreCOGProtocol.cogProtocol);
    var cogs = page.layers.cogs || [];

    cogs.forEach(function (cog) {
      if (cog.lazy) return;   // added when the story zooms into its area (loadRegionLayers)
      var targetUrl = (isLocal && cog.cogPath) ? (window.location.origin + cog.cogPath) : cog.url;
      var sourceId = 'cog-' + cog.id;
      var layerId = 'cog-layer-' + cog.id;

      if (hasCogProtocol && targetUrl) {
        registerColor(cog, targetUrl);

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
      }
    });

    map.addLayer({ id: 'patches', type: 'fill', source: 'patches', paint: { 'fill-color': '#d97706', 'fill-opacity': 0.55 } }, 'labels');
    map.addLayer({ id: 'alerts-fill', type: 'fill', source: 'alerts', paint: { 'fill-color': '#ff2d95', 'fill-opacity': 0.35 } }, 'labels');
    map.addLayer({ id: 'alerts-line', type: 'line', source: 'alerts', paint: { 'line-color': '#ff2d95', 'line-width': 1.5 } }, 'labels');
    map.addLayer({ id: 'fmu', type: 'line', source: 'fmu', paint: { 'line-color': '#ffffff', 'line-width': 2 } }, 'labels');
    map.addLayer({ id: 'focus', type: 'line', source: 'focus', paint: { 'line-color': '#fde047', 'line-width': 3, 'line-dasharray': [2, 1] } }, 'labels');
    // A marker for the story's area while the map is zoomed out
    var hb = page.places[page.heroPlace] && page.places[page.heroPlace].bbox;
    if (hb) {
      map.addSource('hero-dot', { type: 'geojson', data: fc([{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [(hb[0] + hb[2]) / 2, (hb[1] + hb[3]) / 2] } }]) });
      map.addLayer({ id: 'hero-dot-halo', type: 'circle', source: 'hero-dot', paint: { 'circle-radius': 16, 'circle-color': '#fde047', 'circle-opacity': 0.25 } });
      map.addLayer({ id: 'hero-dot', type: 'circle', source: 'hero-dot', paint: { 'circle-radius': 6, 'circle-color': '#fde047', 'circle-stroke-color': '#171a14', 'circle-stroke-width': 1.5 } });
    }
    addLabels(map);
    mapReady = true;
    heroReady = true;
    updateHero();
    if (pendingStep) { var p0 = pendingStep; pendingStep = null; applyStep(p0); }
  });

  // COGs only: a raster that fails to load is dropped, not swapped for a PNG
  // pyramid, which for a missing region-year was a few hundred 404s.
  // Only a file that isn't there (404) drops its layer. Tile requests also
  // fail when cancelled or slow while the map moves -- that must not remove a
  // layer for the rest of the story.
  map.on('error', function (e) {
    var msg = e && e.error ? String(e.error.status || '') + ' ' + String(e.error.message || '') : '';
    if (!/\\b404\\b|not found/i.test(msg)) return;
    if (e && e.sourceId && e.sourceId.indexOf('cog-') === 0) {
      var cogId = e.sourceId.replace(/^cog-/, '');
      try {
        if (map.getLayer('cog-layer-' + cogId)) map.removeLayer('cog-layer-' + cogId);
        if (map.getSource('cog-' + cogId)) map.removeSource('cog-' + cogId);
      } catch (err) {
        // already gone
      }
    }
  });

  var current = null;
  // Layers of areas past the first 12 (cog.lazy), added the first time the
  // story zooms into that area, then kept in step with the year player
  var lazyLoaded = {};
  function loadRegionLayers(region) {
    if (!region || lazyLoaded[region] || !mapReady) return;
    lazyLoaded[region] = true;
    var added = false;
    (page.layers.cogs || []).forEach(function (c) {
      if (c.lazy && c.region === region) { addCog(map, c, c.id); added = true; }
    });
    if (added && !cmpState) applyYear(tlYear);
  }
  // The FMU a place belongs to: the FMU/range itself or a clearcut patch in
  // it; null for overviews, alerts and drawn areas (no single FMU)
  var focusRegion = null;
  function regionOfPlace(placeId, place) {
    if (!place) return null;
    if (place.kind === 'fmu' || place.kind === 'range' || place.kind === 'clearcut_patch') return placeId.split(':')[1];
    return null;
  }
  function focusOn(placeId, animate) {
    var place = page.places[placeId];
    if (!place || !place.bbox || placeId === current) return;
    current = placeId;
    focusRegion = regionOfPlace(placeId, place);
    loadRegionLayers(focusRegion);
    showLabelFor(focusRegion);
    updateCompare();
    var b = place.bbox;
    var wide = place.kind === 'fmu' || place.kind === 'range' || place.kind === 'overview';
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60, maxZoom: wide ? 9 : 13, duration: animate === false ? 0 : 1600 });
    var src = map.getSource('focus');
    if (src) src.setData(fc(wide ? [] : [bboxPolygon(b)]));
  }

  // Opening zoom, tied to scrolling through the hero (title, lede, key stats,
  // questions): Canada -> Ontario -> the story's area, the way the caribou
  // story opens. Past the hero the steps take over. Scroll-linked rather than
  // animated, so it never moves on its own (and respects reduced motion).
  var heroReady = false;
  var heroDone = false;
  var heroEnd = document.querySelector('.step');
  var tag = document.getElementById('scale-tag');
  var CANADA = [[-141, 41.7], [-52.6, 70]];
  var ONTARIO = [[-95.2, 41.7], [-74.3, 56.9]];
  var heroCams = null;
  // Globe stage (capable GPUs only): spins until the reader scrolls or drags
  // the map. GLOBE.lng is wherever the spin has got to.
  var GLOBE = { lng: -60, lat: 40, zoom: 1.3 };
  var spinning = false;
  var userMoved = false;
  function spin() {
    if (!spinning) return;
    GLOBE.lng = ((GLOBE.lng + 0.08 + 540) % 360) - 180;
    map.jumpTo({ center: [GLOBE.lng, GLOBE.lat], zoom: GLOBE.zoom });
    requestAnimationFrame(spin);
  }
  function setSpin(on) {
    on = on && GLOBE_OK && !userMoved;
    if (on === spinning) return;
    spinning = on;
    if (on) requestAnimationFrame(spin);
  }
  map.on('dragstart', function () { userMoved = true; setSpin(false); });
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var ease = function (t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };
  function heroCameras() {
    var b = page.places[page.heroPlace] && page.places[page.heroPlace].bbox;
    if (!b) return null;
    var pad = { top: 60, bottom: 60, left: 60, right: 60 };
    var cam = function (bounds, maxZoom) {
      var c = map.cameraForBounds(bounds, { padding: pad, maxZoom: maxZoom });
      return c ? { lng: c.center.lng !== undefined ? c.center.lng : c.center[0], lat: c.center.lat !== undefined ? c.center.lat : c.center[1], zoom: c.zoom } : null;
    };
    var cams = [cam(CANADA, 4), cam(ONTARIO, 6), cam([[b[0], b[1]], [b[2], b[3]]], 9)];
    if (!cams.every(Boolean)) return null;
    return GLOBE_OK ? [GLOBE].concat(cams) : cams;
  }
  function heroProgress() {
    if (!heroEnd) return 1;
    // 0 at the top of the page, 1 once the end of the intro reaches mid-screen
    var end = heroEnd.getBoundingClientRect().bottom + window.scrollY - window.innerHeight * 0.55;
    return end > 0 ? Math.max(0, Math.min(1, window.scrollY / end)) : 1;
  }
  function updateHero() {
    if (!heroReady) return;
    var p = heroProgress();
    if (p >= 1) {
      setSpin(false);
      if (!heroDone) {
        heroDone = true;
        current = null;
        if (tag) tag.hidden = true;
        if (map.getLayer('hero-dot')) { map.setLayoutProperty('hero-dot', 'visibility', 'none'); map.setLayoutProperty('hero-dot-halo', 'visibility', 'none'); }
        focusOn(page.heroPlace, false);
      }
      return;
    }
    heroDone = false;
    showLabelFor(null);   // no FMU names during the opening
    heroCams = heroCams || heroCameras();
    if (!heroCams) return;
    // Globe: spins at the top, then globe -> Canada (30%), Canada -> Ontario
    // (to 60%), Ontario -> the area. Flat: Canada -> Ontario (40%) -> area.
    setSpin(p === 0);
    if (GLOBE_OK && p === 0) {
      if (tag) { tag.hidden = false; tag.textContent = 'Canada'; }
      return;
    }
    var stops = GLOBE_OK ? [0, 0.3, 0.6, 1] : [0, 0.4, 1];
    var seg = 0;
    while (seg < stops.length - 2 && p >= stops[seg + 1]) seg += 1;
    var t = ease((p - stops[seg]) / (stops[seg + 1] - stops[seg]));
    var a = heroCams[seg];
    var c = heroCams[seg + 1];
    // From the globe, take the shortest way round from wherever the spin stopped
    var aLng = a.lng;
    if (a === GLOBE) { while (aLng - c.lng > 180) aLng -= 360; while (c.lng - aLng > 180) aLng += 360; }
    map.jumpTo({ center: [lerp(aLng, c.lng, t), lerp(a.lat, c.lat, t)], zoom: lerp(a.zoom, c.zoom, t) });
    current = null;
    if (map.getLayer('hero-dot')) {
      var show = p < 0.85 ? 'visible' : 'none';
      map.setLayoutProperty('hero-dot', 'visibility', show);
      map.setLayoutProperty('hero-dot-halo', 'visibility', show);
    }
    if (tag) {
      tag.hidden = false;
      tag.textContent = p < (GLOBE_OK ? 0.45 : 0.25) ? 'Canada' : (p < (GLOBE_OK ? 0.8 : 0.7) ? 'Ontario' : page.heroLabel);
    }
  }
  var heroTick = false;
  window.addEventListener('scroll', function () {
    if (heroTick) return;
    heroTick = true;
    requestAnimationFrame(function () { heroTick = false; updateHero(); });
  }, { passive: true });
  window.addEventListener('resize', function () { heroCams = null; updateHero(); });

  // Scroll-driven: the step or beat (paragraph) in the middle of the
  // viewport sets the map, so one topic can visit several areas in turn
  var steps = Array.prototype.slice.call(document.querySelectorAll('.step'));
  var beats = Array.prototype.slice.call(document.querySelectorAll('.beat[data-place]'));
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      var step = e.target.closest('.step');
      steps.forEach(function (s) { s.classList.toggle('active', s === step); });
      applyStep(step);
      if (step === heroEnd && !heroDone) return;   // the opening zoom drives the map here
      if (mapReady) focusOn(e.target.getAttribute('data-place') || (step && step.getAttribute('data-place')));
    });
  }, { rootMargin: '-45% 0px -45% 0px' });
  steps.concat(beats).forEach(function (s) { observer.observe(s); });

  // FMU names at their centres: only the FMU the story is looking at, so
  // overviews and zoomed-out views stay free of overlapping names
  var wrap = document.querySelector('.map-wrap');
  function addLabels(m) {
    (page.regionLabels || []).forEach(function (r) {
      var wrapper = document.createElement('div');
      var el = document.createElement('div');
      el.className = 'fmu-label' + (r.id === focusRegion && heroDone ? ' on' : '');
      el.setAttribute('data-id', r.id);
      el.textContent = r.name;
      wrapper.appendChild(el);
      new maplibregl.Marker({ element: wrapper }).setLngLat(r.point).addTo(m);
    });
  }
  function showLabelFor(regionId) {
    document.querySelectorAll('.fmu-label').forEach(function (el) {
      el.classList.toggle('on', Boolean(regionId) && el.getAttribute('data-id') === regionId && heroDone);
    });
  }

  function setImagery(m, im) {
    var src = m.getSource('imagery');
    if (src && src.setTiles) src.setTiles(im.tiles);
  }
  var badge = document.getElementById('sat-badge');
  function setBadge(text) { if (badge) badge.textContent = text; }

  function addCog(m, cog, key) {
    var url = cogUrlOf(cog);
    registerColor(cog, url);
    if (m.getSource('cog-' + key)) return;
    m.addSource('cog-' + key, { type: 'raster', url: 'cog://' + url, tileSize: 256 });
    m.addLayer({ id: 'cog-layer-' + key, type: 'raster', source: 'cog-' + key, paint: { 'raster-opacity': cog.opacity || 0.8 } }, m.getLayer('labels') ? 'labels' : undefined);
  }
  function removeCog(m, key) {
    if (m.getLayer('cog-layer-' + key)) m.removeLayer('cog-layer-' + key);
    if (m.getSource('cog-' + key)) m.removeSource('cog-' + key);
  }

  // Year shown by the player ('all' = every year); kept so a compare can
  // hand the map back exactly as it found it
  var tlYear = 'all';
  function applyYear(y) {
    tlYear = y;
    if (cmpState) return;
    (page.layers.cogs || []).forEach(function (c) {
      if (page.perYearLayers.indexOf(c.layerId) < 0) return;
      var id = 'cog-layer-' + c.id;
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', (y === 'all' || c.year === Number(y)) ? 'visible' : 'none');
    });
    var im = y === 'all' ? page.imagery : (page.imageryByYear[y] || page.imagery);
    setImagery(map, im);
    setBadge('Imagery: ' + im.label + (y === 'all' ? '' : ' · data ' + y));
  }

  // Compare slider on the main map, while a step that compares years is
  // read: the main map shows the "before" year (its imagery and layer), an
  // overlay map clipped by the divider shows the "after" year, kept in step.
  var afterEl = document.getElementById('map-after');
  var cmpLine = document.getElementById('cmp-line');
  var cmpHandle = document.getElementById('cmp-handle');
  var yrL = document.getElementById('yr-l');
  var yrR = document.getElementById('yr-r');
  var cmpState = null;
  var cmpPos = 50;
  function setCmp(v) {
    cmpPos = Math.max(0, Math.min(100, v));
    afterEl.style.clipPath = 'inset(0 0 0 ' + cmpPos + '%)';
    cmpLine.style.left = cmpPos + '%';
    cmpHandle.setAttribute('aria-valuenow', String(Math.round(cmpPos)));
  }
  // The story layers a compare replaces: the same product as the compared
  // one. Everything else stays on both sides as context.
  var COMPARED = {
    habitat: ['caribou-habitat'],
    clearcut: ['clearcut-accumulated', 'clearcut-annual', 'clearcut-ml-accumulated', 'clearcut-ml-annual'],
    fire: ['wildfire-burned'],
  };
  var isCompared = function (cmp, c) { return (COMPARED[cmp.topic] || []).indexOf(c.layerId) >= 0; };
  // A context layer belongs on a side only if its data existed by that side's
  // year: a 2021 burn must not appear on a 2016 view
  var YEARLESS_VECTORS = ['patches', 'alerts-fill', 'alerts-line'];
  var upTo = function (c, year) { return !c.year || !Number(year) || c.year <= Number(year); };
  var isShown = function (c) {
    return page.perYearLayers.indexOf(c.layerId) < 0 || tlYear === 'all' || c.year === Number(tlYear);
  };
  function enterCompare(cmp) {
    if (!cmp || (cmpState && cmpState.cmp === cmp)) return;
    exitCompare();
    (page.layers.cogs || []).forEach(function (c) {
      var hide = isCompared(cmp, c) || !upTo(c, cmp.left.year);
      if (hide && map.getLayer('cog-layer-' + c.id)) map.setLayoutProperty('cog-layer-' + c.id, 'visibility', 'none');
    });
    // The story-year clearcut patches and recent alerts are from after the
    // "before" year too; hidden for the comparison
    YEARLESS_VECTORS.forEach(function (id) { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none'); });
    setImagery(map, cmp.left.imagery);
    if (cmp.left.cog) addCog(map, cmp.left.cog, 'cmp-left');
    afterEl.hidden = false;
    var after = new maplibregl.Map({
      container: afterEl,
      style: { version: 8, sources: { imagery: { type: 'raster', tileSize: 256, tiles: cmp.right.imagery.tiles } },
        layers: [{ id: 'imagery', type: 'raster', source: 'imagery' }] },
      center: map.getCenter(), zoom: map.getZoom(), attributionControl: false, cooperativeGestures: true
    });
    after.on('load', function () {
      (page.layers.cogs || []).forEach(function (c) {
        if (!isCompared(cmp, c) && isShown(c) && upTo(c, cmp.right.year)) addCog(after, c, 'ctx-' + c.id);
      });
      if (cmp.right.cog) addCog(after, cmp.right.cog, 'cmp-right');
      after.addSource('fmu', { type: 'geojson', data: fc(page.layers.boundaries) });
      after.addLayer({ id: 'fmu', type: 'line', source: 'fmu', paint: { 'line-color': '#ffffff', 'line-width': 2 } });
      addLabels(after);
    });
    var syncing = false;
    var onMain = function () {
      if (syncing) return;
      syncing = true;
      after.jumpTo({ center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() });
      syncing = false;
    };
    after.on('move', function () {
      if (syncing) return;
      syncing = true;
      map.jumpTo({ center: after.getCenter(), zoom: after.getZoom(), bearing: after.getBearing(), pitch: after.getPitch() });
      syncing = false;
    });
    map.on('move', onMain);
    cmpLine.hidden = false;
    yrL.hidden = false;
    yrR.hidden = false;
    yrL.textContent = cmp.left.label + ' · imagery ' + cmp.left.imagery.year;
    yrR.textContent = cmp.right.label + ' · imagery ' + cmp.right.imagery.year;
    setBadge('Imagery: ' + cmp.left.imagery.label + ' | ' + cmp.right.imagery.label);
    cmpState = { cmp: cmp, after: after, onMain: onMain };
    setCmp(50);
  }
  function exitCompare() {
    if (!cmpState) return;
    map.off('move', cmpState.onMain);
    cmpState.after.remove();
    cmpState = null;
    afterEl.hidden = true;
    cmpLine.hidden = true;
    yrL.hidden = true;
    yrR.hidden = true;
    removeCog(map, 'cmp-left');
    YEARLESS_VECTORS.forEach(function (id) { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible'); });
    (page.layers.cogs || []).forEach(function (c) {
      if (map.getLayer('cog-layer-' + c.id)) map.setLayoutProperty('cog-layer-' + c.id, 'visibility', 'visible');
    });
    applyYear(tlYear);
  }
  // Drag the divider (mouse, touch, pen), or arrow keys on the handle
  var fromPointer = function (e) {
    var r = wrap.getBoundingClientRect();
    setCmp(((e.clientX - r.left) / r.width) * 100);
  };
  cmpLine.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    cmpLine.setPointerCapture(e.pointerId);
    wrap.classList.add('dragging');
    fromPointer(e);
  });
  cmpLine.addEventListener('pointermove', function (e) {
    if (cmpLine.hasPointerCapture(e.pointerId)) fromPointer(e);
  });
  var endDrag = function (e) {
    if (cmpLine.hasPointerCapture(e.pointerId)) cmpLine.releasePointerCapture(e.pointerId);
    wrap.classList.remove('dragging');
  };
  cmpLine.addEventListener('pointerup', endDrag);
  cmpLine.addEventListener('pointercancel', endDrag);
  cmpHandle.addEventListener('keydown', function (e) {
    var stepBy = e.shiftKey ? 10 : 2;
    if (e.key === 'ArrowLeft') { setCmp(cmpPos - stepBy); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { setCmp(cmpPos + stepBy); e.preventDefault(); }
    else if (e.key === 'Home') { setCmp(0); e.preventDefault(); }
    else if (e.key === 'End') { setCmp(100); e.preventDefault(); }
  });

  // What a step brings to the map besides its places: its sub-legend, the
  // overview's area colours (faded in and out) and a year comparison
  var activeStep = null;
  var pendingStep = null;
  // Set once the style and layers are in; map.loaded() is false whenever
  // tiles are still arriving, which would park steps indefinitely
  var mapReady = false;
  function applyStep(step) {
    if (!mapReady) { pendingStep = step; return; }
    if (step === activeStep) return;
    activeStep = step;
    var n = step ? step.getAttribute('data-step') : null;
    document.querySelectorAll('.topic-legend').forEach(function (el) { el.hidden = el.getAttribute('data-step') !== n; });
    var fi = step ? step.getAttribute('data-fill') : null;
    var fill = fi !== null && fi !== '' ? page.fills[Number(fi)] : null;
    if (map.getLayer('fmu-fill')) {
      var pairs = fill ? Object.keys(fill).reduce(function (a, k) { return a.concat([k, fill[k]]); }, []) : [];
      if (pairs.length) // Areas without data for the chart stay unfilled (outline only); grey is
      // for the ones folded into the chart's "Other" slice
      map.setPaintProperty('fmu-fill', 'fill-color', ['match', ['get', 'regionId']].concat(pairs, ['rgba(0, 0, 0, 0)']));
      map.setPaintProperty('fmu-fill', 'fill-opacity', pairs.length ? 0.45 : 0);
    }
    var ci = step ? step.getAttribute('data-compare') : null;
    stepCompare = ci !== null && ci !== '' ? page.compares[Number(ci)] : null;
    updateCompare();
  }
  // A step's compare is on only while the map is on its FMU (the beat about
  // that area), not during the step's overview of every area
  var stepCompare = null;
  function updateCompare() {
    if (stepCompare && heroDone && current === stepCompare.placeId) enterCompare(stepCompare);
    else exitCompare();
  }

  var palette = { clearcut_accumulated: '#d97706', clearcut_new: '#dc2626', clearcut_accuracy: '#2f8f5b', wildfire_area: '#ca8a04', caribou_core: '#21918c', alerts_monthly: '#c026d3' };
  // Year player: per-year layers (annual clearcut, AI annual, wildfire) shown
  // for one year or all at once; Play steps through the years.
  var tl = document.getElementById('tl');
  if (tl) {
    var playTimer = null;
    var playBtn = document.getElementById('tl-play');
    var stopPlay = function () {
      if (playTimer) clearInterval(playTimer);
      playTimer = null;
      playBtn.textContent = '▶';
      playBtn.setAttribute('aria-label', 'Play years');
    };
    var setYear = function (y) {
      tl.querySelectorAll('[data-year]').forEach(function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-year') === String(y)));
      });
      applyYear(y);
    };
    tl.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b === playBtn) {
        if (playTimer) { stopPlay(); return; }
        var i = 0;
        playBtn.textContent = '❚❚';
        playBtn.setAttribute('aria-label', 'Pause');
        setYear(page.playerYears[0]);
        playTimer = setInterval(function () {
          i += 1;
          if (i >= page.playerYears.length) { stopPlay(); setYear('all'); return; }
          setYear(page.playerYears[i]);
        }, 1400);
        return;
      }
      stopPlay();
      setYear(b.getAttribute('data-year'));
    });
  }

  // Several regions on one chart get distinct colours and a legend; one
  // series keeps its topic colour (palette above)
  var SERIES = ['#1a7539', '#d97706', '#2563eb', '#c026d3', '#0d9488', '#78716c'];
  if (window.Chart) {
    Chart.defaults.font.family = '"IBM Plex Mono", ui-monospace, monospace';
    Chart.defaults.font.size = 11;
  }
  page.charts.forEach(function (c) {
    var el = document.getElementById(c.canvasId);
    if (!el) return;
    if (c.type === 'doughnut') {
      el.parentNode.classList.add('donut');
      new Chart(el, {
        type: 'doughnut',
        data: { labels: c.labels, datasets: [{ data: c.series[0].values, backgroundColor: c.colors || SERIES, borderColor: '#fbfbf9', borderWidth: 2 }] },
        options: {
          maintainAspectRatio: false, cutout: '58%',
          plugins: { legend: { position: 'right' },
            tooltip: { callbacks: { label: function (ctx) {
              var total = ctx.dataset.data.reduce(function (a, v) { return a + v; }, 0);
              return ctx.label + ': ' + ctx.parsed.toLocaleString('en-US') + ' ' + c.unit + ' (' + Math.round((ctx.parsed / total) * 100) + '%)';
            } } } }
        }
      });
      return;
    }
    var multi = c.series.length > 1;
    if (c.horizontal) {
      // One bar per area, ranked: height grows with the list
      el.parentNode.style.height = Math.max(240, c.labels.length * 18 + 50) + 'px';
      new Chart(el, {
        type: 'bar',
        data: { labels: c.labels, datasets: [{ label: c.title, data: c.series[0].values, backgroundColor: '#1a7539' }] },
        options: {
          indexAxis: 'y', maintainAspectRatio: false,
          plugins: { legend: { display: false },
            tooltip: { callbacks: { label: function (ctx) { return ctx.parsed.x.toLocaleString('en-US') + ' ' + c.unit; } } } },
          scales: { x: { beginAtZero: true, title: { display: true, text: c.unit },
            ticks: { callback: function (v) { return Number(v).toLocaleString('en-US'); } } } }
        }
      });
      return;
    }
    new Chart(el, {
      type: c.type,
      data: { labels: c.labels, datasets: c.series.map(function (sr, i) {
        var col = multi ? SERIES[i % SERIES.length] : (palette[sr.key] || '#1a7539');
        return { label: sr.label, data: sr.values, backgroundColor: col, borderColor: col, borderWidth: 2, tension: 0.25, pointRadius: 3, spanGaps: true };
      }) },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: multi, position: 'bottom' },
          tooltip: { callbacks: { label: function (ctx) { return (multi ? ctx.dataset.label + ': ' : '') + ctx.parsed.y.toLocaleString('en-US') + ' ' + c.unit; } } } },
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
