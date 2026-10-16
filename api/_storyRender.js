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
        series: [{ label: c.title, key: '', values: c.values }] };
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

  const page = {
    playerYears,
    perYearLayers: PER_YEAR,
    compares: sections.filter((s) => s.compare).map((s) => s.compare),
    places,
    initialPlace: firstFmu?.id || null,
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
<meta property="og:image:alt" content="Satellite map of ${esc(facts.regions.map((r) => r.name).join(", "))} with the areas discussed in the story">
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
  .cmp-line { position:absolute; top:0; bottom:0; left:50%; width:2px; margin-left:-1px; background:#fff; box-shadow:0 0 0 1px rgba(0,0,0,.35); pointer-events:none; z-index:2; }
  .yr-tag { position:absolute; top:10px; z-index:2; font:500 .7rem/1 var(--f-mono); letter-spacing:.04em; color:#fff; background:rgba(13,17,10,.72); padding:5px 7px; border-radius:2px; pointer-events:none; }
  .yr-tag.l { left:10px; }
  .yr-tag.r { right:10px; }
  .cmp-range { display:block; width:calc(100% - 28px); margin:10px 14px 2px; accent-color:var(--accent); }
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
  .sat-badge { position:absolute; left:12px; top:12px; z-index:2; font:.66rem/1 var(--f-mono); letter-spacing:.04em; text-transform:uppercase; color:#fff; background:rgba(13,17,10,.62); padding:5px 8px; border-radius:2px; }
  .tl { position:absolute; right:12px; bottom:28px; z-index:2; display:flex; align-items:center; gap:6px; background:rgba(251,251,249,.95); border:1px solid var(--line); border-radius:3px; padding:6px 8px; max-width:calc(100% - 320px); overflow-x:auto; }
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
    .tl { left:12px; right:12px; max-width:none; bottom:8px; }
    .legend { display:none; }
  }
</style>
</head>
<body>
<div class="layout">
  <main class="story">
    <p class="eyebrow"><b>${esc(story.kicker || 'ForestTrace story map')}</b> · ${esc(facts.regions.map((r) => r.name).join(', '))} · ${esc(span)}</p>
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
    <section class="step" id="step-${i + 1}" data-place="${esc(s.placeId || '')}">
      <span class="step-no" data-n="${i + 1}">Step ${i + 1} of ${sections.length}</span>
      <h2>${esc(s.heading)}</h2>
      ${(s.beats || s.paragraphs.map((p) => ({ text: p }))).map((b) => `<p class="beat"${b.placeId && places[b.placeId] ? ` data-place="${esc(b.placeId)}"` : ''}>${esc(b.text)}</p>`).join('\n      ')}
      ${s.chart ? `<figure class="plate">
        <div class="plate-head"><span class="plate-title">${esc(s.chart.title)}</span><span class="plate-meta">${esc(s.chartUnit)}</span></div>
        <div class="chart-box"><canvas id="${s.chartId}"></canvas></div>
        <figcaption class="plate-foot">${esc(s.chart.caption)} Source: ${esc(s.chartSource)}.</figcaption>
      </figure>` : ''}
      ${s.compare ? `<figure class="plate compare" id="${s.compare.el}">
        <div class="plate-head"><span class="plate-title">${esc(s.compare.title)}</span><span class="plate-meta">drag to compare</span></div>
        <div class="cmp">
          <div class="cmp-map cmp-left"></div><div class="cmp-map cmp-right"></div>
          <div class="cmp-line"></div>
          <span class="yr-tag l">${esc(s.compare.left.label)}</span><span class="yr-tag r">${esc(s.compare.right.label)}</span>
        </div>
        <input class="cmp-range" type="range" min="0" max="100" value="50" aria-label="Compare ${esc(s.compare.left.label)} and ${esc(s.compare.right.label)}">
        <figcaption class="plate-foot">${esc(s.compare.caption)}</figcaption>
      </figure>` : ''}
    </section>`).join('')}

    <div class="back-matter">
      <details class="note-fold" id="how" open><summary>How this was made</summary><p>${esc(story.methodology)}</p></details>
      ${story.caveats.length ? `<details class="note-fold" id="caveats"><summary>Caveats</summary><ul>${story.caveats.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></details>` : ''}
      <details class="note-fold" id="sources"><summary>Sources</summary><ul>${usedSources.map((src) => `<li>${esc(src)}</li>`).join('')}<li>Basemap imagery: Esri, Maxar, Earthstar Geographics</li></ul></details>
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
    <span class="sat-badge">Esri World Imagery · ${esc(span)} data</span>
    ${playerYears.length > 1 ? `<div class="tl" id="tl" role="group" aria-label="Year shown on the map">
      <button type="button" class="tl-play" id="tl-play" aria-label="Play years">▶</button>
      <button type="button" data-year="all" aria-pressed="true">All</button>
      ${playerYears.map((y) => `<button type="button" data-year="${y}" aria-pressed="false">${y}</button>`).join('')}
    </div>` : ''}
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
    focusOn(page.initialPlace, false);
  });

  // COGs only: a raster that fails to load is dropped, not swapped for a PNG
  // pyramid, which for a missing region-year was a few hundred 404s.
  map.on('error', function (e) {
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
  function focusOn(placeId, animate) {
    var place = page.places[placeId];
    if (!place || !place.bbox || placeId === current) return;
    current = placeId;
    var b = place.bbox;
    var wide = place.kind === 'fmu' || place.kind === 'range' || place.kind === 'overview';
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60, maxZoom: wide ? 9 : 13, duration: animate === false ? 0 : 1600 });
    var src = map.getSource('focus');
    if (src) src.setData(fc(wide ? [] : [bboxPolygon(b)]));
  }

  // Scroll-driven: the step or beat (paragraph) in the middle of the
  // viewport sets the map, so one topic can visit several areas in turn
  var steps = Array.prototype.slice.call(document.querySelectorAll('.step'));
  var beats = Array.prototype.slice.call(document.querySelectorAll('.beat[data-place]'));
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      var step = e.target.closest('.step');
      steps.forEach(function (s) { s.classList.toggle('active', s === step); });
      if (map.loaded()) focusOn(e.target.getAttribute('data-place') || (step && step.getAttribute('data-place')));
    });
  }, { rootMargin: '-45% 0px -45% 0px' });
  steps.concat(beats).forEach(function (s) { observer.observe(s); });

  // Compare plates: two synced maps, the right one clipped by the slider.
  // Built when scrolled near, so a long story doesn't start four maps at once.
  function initCompare(cmp) {
    var root = document.getElementById(cmp.el);
    if (!root || root.getAttribute('data-ready')) return;
    root.setAttribute('data-ready', '1');
    var place = page.places[cmp.placeId];
    var b = place && place.bbox;
    var make = function (container, side) {
      var m = new maplibregl.Map({
        container: container,
        style: { version: 8, sources: { imagery: { type: 'raster', tileSize: 256,
          tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'] } },
          layers: [{ id: 'imagery', type: 'raster', source: 'imagery' }] },
        bounds: b ? [[b[0], b[1]], [b[2], b[3]]] : undefined,
        fitBoundsOptions: { padding: 24 },
        attributionControl: false,
        cooperativeGestures: true
      });
      m.on('load', function () {
        if (side.cog) {
          var url = cogUrlOf(side.cog);
          registerColor(side.cog, url);
          m.addSource('c', { type: 'raster', url: 'cog://' + url, tileSize: 256 });
          m.addLayer({ id: 'c', type: 'raster', source: 'c', paint: { 'raster-opacity': side.cog.opacity || 0.8 } });
        }
        m.addSource('fmu', { type: 'geojson', data: fc(page.layers.boundaries) });
        m.addLayer({ id: 'fmu', type: 'line', source: 'fmu', paint: { 'line-color': '#ffffff', 'line-width': 1.5 } });
      });
      return m;
    };
    var left = make(root.querySelector('.cmp-left'), cmp.left);
    var right = make(root.querySelector('.cmp-right'), cmp.right);
    var syncing = false;
    var link = function (a, c) {
      a.on('move', function () {
        if (syncing) return;
        syncing = true;
        c.jumpTo({ center: a.getCenter(), zoom: a.getZoom(), bearing: a.getBearing(), pitch: a.getPitch() });
        syncing = false;
      });
    };
    link(left, right);
    link(right, left);
    var range = root.querySelector('.cmp-range');
    var rightEl = root.querySelector('.cmp-right');
    var line = root.querySelector('.cmp-line');
    var set = function () {
      rightEl.style.clipPath = 'inset(0 0 0 ' + range.value + '%)';
      line.style.left = range.value + '%';
    };
    range.addEventListener('input', set);
    set();
  }
  if ((page.compares || []).length) {
    var cmpObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var cmp = page.compares.find(function (c) { return c.el === e.target.id; });
        if (cmp) initCompare(cmp);
        cmpObserver.unobserve(e.target);
      });
    }, { rootMargin: '300px 0px' });
    page.compares.forEach(function (c) {
      var el = document.getElementById(c.el);
      if (el) cmpObserver.observe(el);
    });
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
      (page.layers.cogs || []).forEach(function (c) {
        if (page.perYearLayers.indexOf(c.layerId) < 0) return;
        var id = 'cog-layer-' + c.id;
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', (y === 'all' || c.year === Number(y)) ? 'visible' : 'none');
      });
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
