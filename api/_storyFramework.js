/**
 * ForestTrace story map framework: forest management / monitoring stories
 * written from the facts alone (api/_storyFacts.js), with no model call.
 *
 *   facts --analyze()--> signals --chooseRecipe()--> recipe --writeStory()--> story
 *
 * A RECIPE is a story type for forest monitoring. It fixes the questions the
 * story answers and the COMPONENTS the page uses (rendered by _storyRender.js,
 * after the RSL caribou story's vocabulary: hero + key stats, key questions,
 * numbered map steps, chart plates, a year player, folded notes, next cards).
 * Which recipe applies depends on the modules on the map and on the data.
 *
 * The output has the same shape the Claude path produces (StorySchema in
 * storymaps.js) plus optional kicker / recipe / questions, so the renderer
 * treats both alike and a Claude story can be decorated with the same
 * components (decorateStory).
 *
 * Every figure in the text comes straight from a dataset or the summary, so
 * nothing needs checking against the data afterwards.
 */

const fmt = (n, d = 0) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const ha = (n) => `${fmt(n)} ha`;
// One decimal under 10% and between 99% and 100%, so 99.6% never reads as 100%
const pct = (n) => { const a = Math.abs(n); return `${fmt(a, a < 10 || (a > 99 && a < 100) ? 1 : 0)}%`; };

/** Story types. `components` lists what the page renders, in order. */
const RECIPES = {
  trend: {
    label: 'Change over time',
    kicker: 'Forest change',
    components: ['hero', 'kstats', 'questions', 'steps', 'plates', 'compare', 'yearPlayer', 'notes', 'next'],
  },
  snapshot: {
    label: 'State of the forest',
    kicker: 'Forest monitoring',
    components: ['hero', 'kstats', 'steps', 'plates', 'notes', 'next'],
  },
  cumulative: {
    label: 'Harvest and fire together',
    kicker: 'Cumulative disturbance',
    components: ['hero', 'kstats', 'questions', 'steps', 'plates', 'yearPlayer', 'notes', 'next'],
  },
  habitat: {
    label: 'Habitat under pressure',
    kicker: 'Caribou habitat',
    components: ['hero', 'kstats', 'questions', 'steps', 'plates', 'yearPlayer', 'notes', 'next'],
  },
  watch: {
    label: 'Disturbance watch',
    kicker: 'Near real-time alerts',
    components: ['hero', 'kstats', 'steps', 'plates', 'notes', 'next'],
  },
};

// ── analysis ────────────────────────────────────────────────────────────────

/** Summary of one yearly series: ends, peak, low, change and a least-squares slope. */
function describeSeries(d, asOf) {
  if (!d || !d.labels.length) return null;
  // A single-year story is told as of its year: later years are left out
  const pts = d.labels.map((l, i) => ({ year: Number(l), v: Number(d.values[i]) || 0 }))
    .filter((p) => !asOf || p.year <= asOf);
  if (!pts.length) return null;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const peak = pts.reduce((a, b) => (b.v > a.v ? b : a));
  const low = pts.reduce((a, b) => (b.v < a.v ? b : a));
  let slope = 0;
  if (pts.length >= 3) {
    const mx = pts.reduce((s, p) => s + p.year, 0) / pts.length;
    const my = pts.reduce((s, p) => s + p.v, 0) / pts.length;
    const num = pts.reduce((s, p) => s + (p.year - mx) * (p.v - my), 0);
    const den = pts.reduce((s, p) => s + (p.year - mx) ** 2, 0);
    slope = den ? num / den : 0;
  }
  const change = last.v - first.v;
  const mean = pts.reduce((a, p) => a + p.v, 0) / pts.length || 1;
  const endDir = Math.abs(first.v ? (change / first.v) * 100 : 0) < 2 ? 'flat' : (change > 0 ? 'up' : 'down');
  const slopeDir = pts.length < 3 || Math.abs(slope) < 0.005 * mean ? 'flat' : (slope > 0 ? 'up' : 'down');
  // Endpoints and fitted trend disagreeing means the series swung: say so
  // rather than pick one and contradict the other in the same paragraph
  let direction = endDir;
  if (endDir === 'flat') direction = slopeDir;
  else if (slopeDir !== 'flat' && slopeDir !== endDir) direction = 'mixed';
  return {
    id: d.id, unit: d.unit, source: d.source, pts, first, last, peak, low, slope, change,
    changePct: first.v ? (change / first.v) * 100 : null,
    total: pts.reduce((s, p) => s + p.v, 0),
    direction,
  };
}

function datasetFor(facts, prefix, region) {
  return facts.datasets.find((d) => d.id === `${prefix}:${region}`) || null;
}

/** Per-region signals the recipes write from. */
function analyze(facts) {
  // Range stories are already trimmed to the range (buildStoryFacts)
  const asOf = facts.yearRange ? null : facts.year;
  const series = (prefix, r, on) => (on ? describeSeries(datasetFor(facts, prefix, r.id), asOf) : null);
  return facts.regions.map((r) => {
    // Only modules on the map: the facts carry every series a region has
    const s = {
      region: r,
      standing: series('clearcut_accumulated', r, facts.isClearcut),
      newCut: series('clearcut_new', r, facts.isClearcut),
      accuracy: series('clearcut_accuracy', r, facts.isClearcut),
      fire: series('wildfire_area', r, facts.isWildfire),
      caribou: series('caribou_core', r, facts.hasCaribou),
      alerts: facts.hasAlerts ? r.alerts || null : null,
      patches: facts.isClearcut ? r.clearcutPatches || null : null,
    };
    if (s.fire) s.fire.yearsWithFire = s.fire.pts.filter((p) => p.v > 0).length;
    return s;
  });
}

function chooseRecipe(facts, signals) {
  const lead = signals[0] || {};
  const clearcut = facts.isClearcut && (lead.standing || lead.newCut);
  const fire = facts.isWildfire && lead.fire;
  const caribou = facts.hasCaribou && lead.caribou;
  if (caribou) return 'habitat';
  if (clearcut && fire) return 'cumulative';
  if (facts.hasAlerts && !clearcut && !fire && lead.alerts) return 'watch';
  const series = lead.standing || lead.fire || lead.newCut;
  if (facts.yearRange || (series && series.pts.length >= 4)) return 'trend';
  return 'snapshot';
}

// ── writing helpers ─────────────────────────────────────────────────────────

const period = (s) => `${s.first.year}–${s.last.year}`;
const list = (names) => (names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

function changeWords(s, noun) {
  if (s.changePct === null) return `${noun} went from ${ha(s.first.v)} in ${s.first.year} to ${ha(s.last.v)} in ${s.last.year}`;
  if (s.change === 0) return `${noun} held at ${ha(s.last.v)} from ${s.first.year} to ${s.last.year}`;
  return `${noun} ${s.change > 0 ? 'rose' : 'fell'} ${pct(s.changePct)}, from ${ha(s.first.v)} in ${s.first.year} to ${ha(s.last.v)} in ${s.last.year}`;
}

function trendWords(s) {
  if (s.pts.length < 3) return '';
  if (s.direction === 'flat') return 'Across the period the trend is roughly flat.';
  if (s.direction === 'mixed') {
    return `It did not move in a straight line: it peaked at ${ha(s.peak.v)} in ${s.peak.year}, with a low of ${ha(s.low.v)} in ${s.low.year}.`;
  }
  return `The fitted trend ${s.direction === 'up' ? 'rises' : 'falls'} by about ${ha(Math.abs(s.slope))} a year.`;
}

const DIRECTION = {
  flat: 'Roughly steady', mixed: 'Up and down', up: 'Increasing', down: 'Decreasing',
};

/**
 * One series summed across regions, over the years every region has, so a
 * topic can open with the total before visiting each area. Null when the
 * regions share fewer than two years (the sum would mislead).
 */
function aggregate(seriesList, id) {
  const present = seriesList.filter(Boolean);
  if (present.length < 2) return present[0] || null;
  const years = present[0].pts.map((p) => p.year)
    .filter((y) => present.every((s) => s.pts.some((p) => p.year === y)));
  if (years.length < 2) return null;
  const values = years.map((y) => present.reduce((sum, s) => sum + s.pts.find((p) => p.year === y).v, 0));
  return describeSeries({ id, unit: present[0].unit, source: present[0].source, labels: years.map(String), values });
}

/** A region's series clipped to the years of a total, so the parts and the whole describe one window. */
function clipTo(series, total) {
  if (!series || !total || series === total) return series;
  const years = new Set(total.pts.map((p) => p.year));
  const pts = series.pts.filter((p) => years.has(p.year));
  return pts.length >= 2
    ? describeSeries({ id: series.id, unit: series.unit, source: series.source, labels: pts.map((p) => String(p.year)), values: pts.map((p) => p.v) })
    : series;
}

const placeFor = (facts, regionId) => (facts.places.find((p) => p.id === `fmu:${regionId}` || p.id === `range:${regionId}`) || {}).id;
const overviewPlace = (facts) => (facts.places.find((p) => p.kind === 'overview') || {}).id;
const compareFor = (facts, topic, regionId) => (facts.compares || []).find((c) => c.topic === topic && c.region === regionId);

/** A section: beats are paragraphs that each move the map to their own place. */
function section(topic, heading, beats, extra = {}) {
  const kept = beats.filter((b) => b && b.text);
  if (!kept.length) return null;
  return {
    topic,
    heading,
    beats: kept,
    paragraphs: kept.map((b) => b.text),
    placeId: kept[0].placeId,
    chart: null,
    ...extra,
  };
}

// Up to this many areas get their own beat and their own chart series; past
// it (a story over many FMUs) the top ones are described, the rest summed up,
// and the chart becomes a ranked bar of the latest values.
const MANY = 6;
const SHOWN_WHEN_MANY = 3;

/** The rows to describe one by one, and a summary beat for the others. */
function capRows(rows, valueOf, noun, facts, unit = ha) {
  if (rows.length <= MANY) return { shown: rows, rest: null };
  const sorted = rows.slice().sort((a, b) => valueOf(b) - valueOf(a));
  const others = sorted.slice(SHOWN_WHEN_MANY);
  const vals = others.map(valueOf);
  return {
    shown: sorted.slice(0, SHOWN_WHEN_MANY),
    rest: {
      text: `The other ${others.length} areas each have between ${unit(Math.min(...vals))} and ${unit(Math.max(...vals))} of ${noun}, ${unit(vals.reduce((a, v) => a + v, 0))} together.`,
      placeId: overviewPlace(facts),
    },
  };
}

// Charts drawn from several datasets (one series per region); with many
// areas, a ranked horizontal bar of each area's latest value instead
const multiChart = (seriesList, type, title, caption, names) => {
  const present = seriesList.filter(Boolean);
  if (!present.length) return null;
  if (present.length === 1) return { datasetId: present[0].id, type, title, caption };
  if (present.length <= MANY) return { datasetIds: present.map((s) => s.id), type: 'line', title, caption };
  const named = seriesList.map((s, i) => (s ? { s, name: names[i] } : null)).filter(Boolean);
  const rows = named.map(({ s, name }) => ({ name, v: s.last.v, year: s.last.year })).sort((a, b) => b.v - a.v);
  return {
    type: 'bar',
    horizontal: true,
    title: `${title}, latest year by area`,
    caption: `${caption} Latest year for each area (${[...new Set(rows.map((r) => r.year))].join(', ')}).`,
    labels: rows.map((r) => r.name),
    values: rows.map((r) => Math.round(r.v)),
    unit: present[0].unit,
    source: present[0].source,
  };
};

// ── topics: one section each, across every region ───────────────────────────

const TOPICS = {
  /** Multi-region opener: how the areas compare, as a share donut. */
  overview(facts, signals, recipe) {
    if (signals.length < 2) return null;
    const pick = {
      habitat: ['caribou', 'core caribou habitat', (s) => s.last.v],
      cumulative: ['standing', 'standing clearcut', (s) => s.last.v],
      watch: null,
    }[recipe] || (signals.some((s) => s.standing) ? ['standing', 'standing clearcut', (s) => s.last.v]
      : ['fire', 'burned area', (s) => s.total]);
    if (!pick) return null;
    const [key, noun, valueOf] = pick;
    const rows = signals.filter((s) => s[key]).map((s) => ({ name: s.region.name, v: valueOf(s[key]), s: s[key] }))
      .sort((a, b) => b.v - a.v);
    if (rows.length < 2) return null;
    const total = rows.reduce((a, r) => a + r.v, 0);
    if (!total) return null;
    const lead = rows[0];
    // A donut stays readable with about six slices: the rest become "Other"
    const slices = rows.length > MANY
      ? rows.slice(0, MANY - 1).concat([{ name: `Other ${rows.length - MANY + 1} areas`, v: rows.slice(MANY - 1).reduce((a, r) => a + r.v, 0) }])
      : rows;
    return section('overview', `${rows.length} areas at a glance`, [
      { text: `${rows.length > MANY ? `Of the ${signals.length} forest management units in this story, ${rows.length} have ${noun} on record.` : `This story follows ${list(rows.map((r) => r.name))}.`} ${lead.name} accounts for the largest share: ${ha(lead.v)}, ${pct((lead.v / total) * 100)} of the ${ha(total)} across ${rows.length > 2 ? `all ${rows.length}` : 'both'}.`, placeId: overviewPlace(facts) },
    ], {
      chart: {
        type: 'doughnut',
        title: `Share of ${noun} by area`,
        caption: `Each slice is one area's ${noun}${key === 'fire' ? ' over the period' : `, ${lead.s.last.year}`}.`,
        labels: slices.map((r) => r.name),
        values: slices.map((r) => Math.round(r.v)),
        unit: 'ha',
        source: lead.s.source,
      },
    });
  },

  clearcut(facts, signals) {
    const rows = signals.filter((s) => s.standing);
    if (!rows.length) return null;
    const total = aggregate(rows.map((s) => s.standing), 'clearcut_accumulated:all');
    const lead = rows.slice().sort((a, b) => b.standing.last.v - a.standing.last.v)[0];
    const beats = [];
    if (rows.length > 1 && total) {
      beats.push({ text: `${changeWords(total, `Across the ${rows.length} areas, standing clearcut area`)}. ${trendWords(total)}`.trim(), placeId: overviewPlace(facts) });
    }
    const cappedCut = capRows(rows, (s) => s.standing.last.v, 'standing clearcut', facts);
    cappedCut.shown.forEach((s) => {
      const own = rows.length > 1 ? clipTo(s.standing, total) : s.standing;
      beats.push({
        text: rows.length > 1
          ? `In ${s.region.name}, ${changeWords(own, 'standing clearcut')}.${own.direction === 'mixed' ? ` ${trendWords(own)}` : ''}`
          : `${changeWords(own, `Standing clearcut area in ${s.region.name}`)}. ${trendWords(own)}`.trim(),
        placeId: placeFor(facts, s.region.id),
      });
    });
    if (cappedCut.rest) beats.push(cappedCut.rest);
    beats.push({ text: '“Standing” counts every clearing still visible within a five-year window: how much of the forest is open at once, not how much was cut in a single year.', placeId: placeFor(facts, lead.region.id) });
    const dir = (total || lead.standing).direction;
    const cmp = compareFor(facts, 'clearcut', lead.region.id);
    return section('clearcut', { flat: 'How much forest is open', mixed: 'Clearcutting rose and fell', up: 'Clearcutting expanded', down: 'Clearcutting eased' }[dir], beats, {
      chart: multiChart(rows.map((s) => s.standing), 'bar', 'Standing clearcut area', 'Five-year rolling total of clearcut area detected by the AI model.', rows.map((s) => s.region.name)),
      compareId: cmp ? cmp.id : null,
    });
  },

  newCuts(facts, signals) {
    const rows = signals.filter((s) => s.newCut);
    if (!rows.length) return null;
    const cappedNew = capRows(rows, (s) => s.newCut.peak.v, 'new clearcut in their peak year', facts);
    const beats = cappedNew.shown.map((s) => ({
      text: `${rows.length > 1 ? `In ${s.region.name}, newly` : 'Newly'} detected clearcuts peaked at ${ha(s.newCut.peak.v)} in ${s.newCut.peak.year}; the quietest year was ${s.newCut.low.year}, at ${ha(s.newCut.low.v)}.`,
      placeId: placeFor(facts, s.region.id),
    }));
    if (cappedNew.rest) beats.push(cappedNew.rest);
    // Zoom in on the single largest patch mapped, to show what a cut looks like
    const patches = facts.places.filter((p) => p.kind === 'clearcut_patch');
    const biggest = patches.sort((a, b) => (b.areaHa || 0) - (a.areaHa || 0))[0];
    const withPatches = rows.find((s) => s.patches && biggest && biggest.id.startsWith(`patch:${s.region.id}:`));
    if (biggest && withPatches) {
      beats.push({
        text: `Zoomed in: the largest clearcut patch mapped in ${withPatches.patches.year} covers ${ha(biggest.areaHa)}, in ${withPatches.region.name}. That year the model mapped ${fmt(withPatches.patches.count)} patches there.`,
        placeId: biggest.id,
      });
    }
    return section('newCuts', 'Where new cuts appeared', beats, {
      chart: multiChart(rows.map((s) => s.newCut), 'bar', 'Newly detected clearcut area per year', 'Area first detected as clearcut in each year.', rows.map((s) => s.region.name)),
    });
  },

  fire(facts, signals) {
    const rows = signals.filter((s) => s.fire && s.fire.total > 0);
    if (!rows.length) {
      const any = signals.find((s) => s.fire);
      return any ? section('fire', 'Fire on the landscape', [{ text: `No burned area was recorded in ${list(signals.filter((s) => s.fire).map((s) => s.region.name))} over ${period(any.fire)}.`, placeId: overviewPlace(facts) || placeFor(facts, any.region.id) }]) : null;
    }
    const sorted = rows.slice().sort((a, b) => b.fire.total - a.fire.total);
    const beats = [];
    if (rows.length > 1) {
      const sum = rows.reduce((a, s) => a + s.fire.total, 0);
      beats.push({ text: `Wildfire burned ${ha(sum)} across ${rows.length > MANY ? `${rows.length} areas` : list(rows.map((s) => s.region.name))}. ${sorted[0].region.name} burned the most.`, placeId: overviewPlace(facts) });
    }
    const cappedFire = capRows(sorted, (s) => s.fire.total, 'burned area', facts);
    cappedFire.shown.forEach((s) => beats.push({
      text: rows.length > 1
        ? `${s.region.name}: ${ha(s.fire.total)} over ${period(s.fire)}; the worst year was ${s.fire.peak.year}, with ${ha(s.fire.peak.v)} burned.`
        : `Wildfire burned ${ha(s.fire.total)} in ${s.region.name} over ${period(s.fire)}, across ${s.fire.yearsWithFire} separate fire ${s.fire.yearsWithFire === 1 ? 'year' : 'years'}. The worst year was ${s.fire.peak.year}, with ${ha(s.fire.peak.v)} burned.`,
      placeId: placeFor(facts, s.region.id),
    }));
    if (cappedFire.rest) beats.push(cappedFire.rest);
    const cmp = compareFor(facts, 'fire', sorted[0].region.id);
    return section('fire', 'Fire on the landscape', beats, {
      chart: rows.length > MANY
        ? { type: 'bar', horizontal: true, title: 'Area burned by area', caption: 'Total burned area over the period, by forest management unit (NBAC).',
          labels: sorted.map((s) => s.region.name), values: sorted.map((s) => Math.round(s.fire.total)), unit: 'ha', source: sorted[0].fire.source }
        : multiChart(rows.map((s) => s.fire), 'bar', 'Area burned per year', 'Burned area from the National Burned Area Composite (NBAC).', rows.map((s) => s.region.name)),
      compareId: cmp ? cmp.id : null,
    });
  },

  combined(facts, signals) {
    const rows = signals.map((s) => {
      if (!s.fire || !s.newCut) return null;
      const years = s.newCut.pts.filter((p) => s.fire.pts.some((f) => f.year === p.year)).map((p) => p.year);
      if (years.length < 2) return null;
      const cut = s.newCut.pts.filter((p) => years.includes(p.year)).reduce((a, p) => a + p.v, 0);
      const burned = s.fire.pts.filter((p) => years.includes(p.year)).reduce((a, p) => a + p.v, 0);
      return cut + burned && burned ? { s, cut, burned, from: years[0], to: years[years.length - 1] } : null;
    }).filter(Boolean);
    if (!rows.length) return null;
    const cut = rows.reduce((a, r) => a + r.cut, 0);
    const burned = rows.reduce((a, r) => a + r.burned, 0);
    const shownRows = rows.length > MANY ? rows.slice().sort((a, b) => (b.cut + b.burned) - (a.cut + a.burned)).slice(0, SHOWN_WHEN_MANY) : rows;
    const beats = shownRows.map((r) => ({
      text: `${rows.length > 1 ? `${r.s.region.name}, ` : ''}${r.from}–${r.to}: newly detected clearcuts added ${ha(r.cut)} and wildfire burned ${ha(r.burned)}, so harvest made up ${pct((r.cut / (r.cut + r.burned)) * 100)} of the area disturbed in years with both.`,
      placeId: placeFor(facts, r.s.region.id),
    }));
    beats.push({ text: 'A stand can burn and later be logged, or the reverse, so the combined figure is an upper bound on the area disturbed.', placeId: overviewPlace(facts) || placeFor(facts, rows[0].s.region.id) });
    return section('combined', 'Harvest and fire, side by side', beats, {
      chart: {
        type: 'doughnut',
        title: 'Disturbed area: harvest vs fire',
        caption: 'Newly detected clearcut and burned area, summed over years with both records.',
        labels: ['Clearcut (new)', 'Burned'],
        values: [Math.round(cut), Math.round(burned)],
        unit: 'ha',
        source: 'ForestTrace AI clearcut model (HLS); NBAC',
        colors: ['#dc2626', '#ca8a04'],
      },
    });
  },

  habitat(facts, signals) {
    const rows = signals.filter((s) => s.caribou);
    if (!rows.length) return null;
    const total = aggregate(rows.map((s) => s.caribou), 'caribou_core:all');
    const lead = rows.slice().sort((a, b) => (a.caribou.changePct ?? 0) - (b.caribou.changePct ?? 0))[0];
    const beats = [];
    if (rows.length > 1 && total) {
      beats.push({ text: `${changeWords(total, `Across the ${rows.length} areas, core caribou habitat`)}. ${trendWords(total)}`.trim(), placeId: overviewPlace(facts) });
    }
    const cappedHab = capRows(rows, (s) => s.caribou.last.v, 'core habitat', facts);
    cappedHab.shown.forEach((s) => {
      const own = rows.length > 1 ? clipTo(s.caribou, total) : s.caribou;
      beats.push({
        text: rows.length > 1
          ? `In ${s.region.name}, ${changeWords(own, 'core habitat')}.`
          : `${changeWords(own, `Core caribou habitat in ${s.region.name}`)}. ${trendWords(own)}`.trim(),
        placeId: placeFor(facts, s.region.id),
      });
    });
    if (cappedHab.rest) beats.push(cappedHab.rest);
    beats.push({ text: 'Core habitat is undisturbed forest in patches large enough to support caribou; small fragments are left out.', placeId: placeFor(facts, lead.region.id) });
    const cmp = compareFor(facts, 'habitat', lead.region.id);
    return section('habitat', (total || lead.caribou).direction === 'down' ? 'Habitat is shrinking' : 'Habitat over time', beats, {
      chart: multiChart(rows.map((s) => s.caribou), 'line', 'Core caribou habitat', 'Area of core caribou habitat in each year.', rows.map((s) => s.region.name)),
      compareId: cmp ? cmp.id : null,
    });
  },

  alerts(facts, signals) {
    const rows = signals.filter((s) => s.alerts);
    if (!rows.length) return null;
    const alertPlace = facts.places.find((p) => p.kind === 'alert');
    const cappedAlerts = capRows(rows, (s) => s.alerts.last30Days, 'alerts in the last 30 days', facts, (n) => fmt(n));
    const beats = cappedAlerts.shown.map((s) => ({
      text: `${rows.length > 1 ? `${s.region.name}: ` : `In ${s.region.name}, `}satellite alerts flagged ${fmt(s.alerts.last30Days)} disturbances in the last 30 days (${ha(s.alerts.areaHaLast30Days)}) and ${fmt(s.alerts.last90Days)} in the last 90; ${fmt(s.alerts.confirmed)} are confirmed by repeated vegetation loss.`,
      placeId: placeFor(facts, s.region.id),
    }));
    if (cappedAlerts.rest) beats.push(cappedAlerts.rest);
    if (alertPlace) beats.push({ text: `Zoomed in: ${alertPlace.label.charAt(0).toLowerCase()}${alertPlace.label.slice(1)}.`, placeId: alertPlace.id });
    beats.push({
      text: rows.some((s) => s.alerts.demoData) ? 'These alerts are demonstration data, not real detections.' : 'Provisional alerts are seen only once or twice and may still clear.',
      placeId: overviewPlace(facts) || placeFor(facts, rows[0].region.id),
    });
    const ids = rows.map((s) => `alerts_monthly:${s.region.id}`).filter((id) => facts.datasets.some((d) => d.id === id));
    return section('alerts', 'What the satellites flagged recently', beats, {
      chart: ids.length ? (ids.length === 1
        ? { datasetId: ids[0], type: 'bar', title: 'Alerts per month', caption: 'Disturbance alerts by month of first detection.' }
        : { datasetIds: ids, type: 'line', title: 'Alerts per month', caption: 'Disturbance alerts by month of first detection.' }) : null,
    });
  },

  accuracy(facts, signals) {
    const s = signals.find((x) => x.accuracy);
    if (!s) return null;
    return section('accuracy', 'How reliable the clearcut figures are', [{
      text: `The clearcut figures are AI estimates from satellite imagery. Checked against held-out harvest records in ${s.region.name}, the model’s F1 score was ${fmt(s.accuracy.last.v)}% in ${s.accuracy.last.year} (100% would be perfect agreement).`,
      placeId: placeFor(facts, s.region.id),
    }], {
      chart: s.accuracy.pts.length > 1 ? { datasetId: s.accuracy.id, type: 'line', title: 'Clearcut model accuracy (F1)', caption: 'Agreement between the model and held-out harvest records.' } : null,
    });
  },
};

// Which topics each recipe tells, in order
const RECIPE_TOPICS = {
  trend: ['overview', 'clearcut', 'newCuts', 'fire', 'habitat', 'accuracy'],
  snapshot: ['overview', 'clearcut', 'newCuts', 'fire', 'habitat', 'alerts', 'accuracy'],
  cumulative: ['overview', 'combined', 'clearcut', 'fire', 'newCuts', 'accuracy'],
  habitat: ['overview', 'habitat', 'clearcut', 'fire', 'combined', 'accuracy'],
  watch: ['overview', 'alerts', 'clearcut'],
};

// ── key stats, headline, questions ──────────────────────────────────────────

function totals(signals) {
  return {
    standing: aggregate(signals.map((s) => s.standing), 'clearcut_accumulated:all'),
    caribou: aggregate(signals.map((s) => s.caribou), 'caribou_core:all'),
    fireTotal: signals.reduce((a, s) => a + (s.fire ? s.fire.total : 0), 0),
    fireSeries: signals.map((s) => s.fire).filter((f) => f && f.total > 0),
    newCut: signals.map((s) => s.newCut).filter(Boolean),
    alerts: signals.map((s) => s.alerts).filter(Boolean),
    accuracy: (signals.find((s) => s.accuracy) || {}).accuracy,
  };
}

function keyFacts(recipe, t, multi) {
  const out = [];
  const add = (series, label) => {
    if (!series) return;
    const delta = series.pts.length > 1 && series.changePct !== null
      ? `${series.change >= 0 ? '+' : '−'}${pct(series.changePct)} since ${series.first.year}` : '';
    out.push({ label, value: ha(series.last.v), sourceDatasetId: series.id, delta });
  };
  const where = multi ? ', all areas with data' : '';
  if (recipe === 'habitat') add(t.caribou, `core caribou habitat, ${t.caribou?.last.year}${where}`);
  if (recipe === 'watch' && t.alerts.length) {
    out.push({ label: `alerts in the last 30 days${where}`, value: fmt(t.alerts.reduce((a, x) => a + x.last30Days, 0)), sourceDatasetId: '', delta: '' });
    out.push({ label: `confirmed alerts (180 days)${where}`, value: fmt(t.alerts.reduce((a, x) => a + x.confirmed, 0)), sourceDatasetId: '', delta: '' });
  }
  add(t.standing, `standing clearcut, ${t.standing?.last.year}${where}`);
  if (t.fireTotal > 0) {
    const peak = t.fireSeries.map((f) => f.peak).sort((a, b) => b.v - a.v)[0];
    out.push({ label: `burned${where}`, value: ha(t.fireTotal), sourceDatasetId: t.fireSeries[0].id, delta: `worst year ${peak.year}` });
  }
  if (t.newCut.length && out.length < 3) {
    const peak = t.newCut.map((s) => s.peak).sort((a, b) => b.v - a.v)[0];
    out.push({ label: `new clearcut in the peak year, ${peak.year}`, value: ha(peak.v), sourceDatasetId: t.newCut[0].id, delta: multi ? 'largest single area-year' : '' });
  }
  return out.slice(0, 3);
}

function headline(recipe, t, facts, signals) {
  const name = facts.regions[0].name;
  const count = (key) => signals.filter((s) => s[key]).length;
  const whereFor = (key) => (count(key) > 1 ? `${count(key)} forest areas` : (signals.find((s) => s[key]) || { region: { name } }).region.name);
  const where = facts.regions.length > 1 ? `${facts.regions.length} forest areas` : name;
  if (recipe === 'habitat' && t.caribou) {
    return t.caribou.direction === 'down'
      ? `${whereFor('caribou')} lost ${pct(t.caribou.changePct)} of core caribou habitat since ${t.caribou.first.year}`
      : `Core caribou habitat in ${whereFor('caribou')}, ${period(t.caribou)}`;
  }
  if (recipe === 'cumulative') return `Harvest and wildfire in ${where}, ${facts.span || facts.year}`;
  if (recipe === 'watch') return `${fmt(t.alerts.reduce((a, x) => a + x.last30Days, 0))} forest disturbance alerts in ${where} this month`;
  if (t.standing && t.standing.pts.length > 1 && t.standing.changePct !== null) {
    return `Clearcut area in ${whereFor('standing')} ${t.standing.change >= 0 ? 'up' : 'down'} ${pct(t.standing.changePct)} since ${t.standing.first.year}`;
  }
  if (t.fireTotal > 0) return `${ha(t.fireTotal)} burned in ${whereFor('fire')}`;
  return `Forest monitoring in ${where}, ${facts.span || facts.year}`;
}

function questionsFor(recipe, t, sections) {
  // Each question links to the section that answers it
  const at = (topic) => sections.findIndex((x) => x.topic === topic);
  const qs = [];
  if (t.standing) {
    qs.push({ q: 'Is clearcutting increasing or decreasing?', a: `${DIRECTION[t.standing.direction]}: ${ha(t.standing.first.v)} in ${t.standing.first.year}, ${ha(t.standing.last.v)} in ${t.standing.last.year}.`, section: at('clearcut') });
  }
  if (t.fireTotal > 0) {
    const peak = t.fireSeries.map((f) => f.peak).sort((a, b) => b.v - a.v)[0];
    qs.push({ q: 'How much did wildfire burn?', a: `${ha(t.fireTotal)} in total; the worst single year was ${peak.year}.`, section: at('fire') });
  }
  if (t.caribou) {
    qs.push({ q: 'What is happening to caribou habitat?', a: `${{ flat: 'Roughly stable', mixed: 'Up and down', down: 'Shrinking', up: 'Growing' }[t.caribou.direction]}: ${ha(t.caribou.first.v)} in ${t.caribou.first.year}, ${ha(t.caribou.last.v)} in ${t.caribou.last.year}.`, section: at('habitat') });
  }
  if (t.accuracy) {
    qs.push({ q: 'How reliable are the clearcut figures?', a: `F1 ${fmt(t.accuracy.last.v)}% against held-out harvest records (${t.accuracy.last.year}).`, section: at('accuracy') });
  }
  return recipe === 'snapshot' || recipe === 'watch' ? [] : qs.slice(0, 3);
}

function methodologyFor(facts) {
  const parts = [];
  if (facts.isClearcut) parts.push('Clearcut areas are estimated by ForestTrace’s AI model from Harmonized Landsat Sentinel-2 imagery and checked against Ontario’s harvest records; “standing” area is a five-year rolling total.');
  if (facts.isWildfire) parts.push('Burned area comes from the Canadian National Burned Area Composite (NBAC).');
  if (facts.hasCaribou) parts.push('Caribou core habitat is mapped by ForestTrace from forest cover and disturbance, keeping undisturbed patches large enough to support caribou.');
  if (facts.hasAlerts) parts.push('Disturbance alerts follow NASA OPERA DIST-ALERT-HLS, which flags vegetation loss within days of a satellite pass.');
  parts.push('This story was assembled automatically from those datasets; every figure is taken directly from them. Totals across areas add the years all of them have.');
  return parts.join(' ');
}

function caveatsFor(facts, signals) {
  const c = [];
  if (facts.isClearcut) c.push('Clearcut figures are model estimates and carry error; see the accuracy section where available.');
  if (facts.isClearcut && facts.isWildfire) c.push('Areas that both burned and were harvested may be counted in both totals.');
  if ((facts.compares || []).some((x) => x.topic === 'fire')) c.push('Before/after views use today’s basemap imagery; only the overlay changes between the two sides.');
  if (signals.some((s) => s.alerts?.demoData)) c.push('Disturbance alerts shown are demonstration data, not real detections.');
  c.push('The data show where the forest changed, not who changed it or why.');
  return c;
}

const AUDIENCE_LIMITS = { brief: 3, news: 5, explainer: 7 };

/**
 * Writes a story from the facts, no model involved. Organised by TOPIC, not
 * by region: each section covers every selected area, and its beats move the
 * map between them (overview, each area, a zoom-in where it helps).
 * @returns story in StorySchema shape + { kicker, recipe, questions, engine, beats, compareId }
 */
function writeStory(facts, { audience = 'news' } = {}) {
  const signals = analyze(facts);
  const recipe = chooseRecipe(facts, signals);
  const multi = signals.length > 1;
  const sections = RECIPE_TOPICS[recipe]
    .map((topic) => TOPICS[topic](facts, signals, recipe))
    .filter(Boolean)
    .slice(0, AUDIENCE_LIMITS[audience] || 5);
  if (audience === 'explainer') {
    sections.forEach((sec) => {
      if (sec.chart && sec.chart.type !== 'doughnut') {
        const tail = { text: 'The chart shows every year in the record, so a single unusual year can be read against the rest.', placeId: sec.placeId };
        sec.beats.push(tail);
        sec.paragraphs.push(tail.text);
      }
    });
  }

  const t = totals(signals);
  const first = sections.find((sec) => sec.topic !== 'overview') || sections[0];
  return {
    engine: 'template',
    recipe,
    kicker: RECIPES[recipe].kicker,
    title: headline(recipe, t, facts, signals),
    dek: `${RECIPES[recipe].label} in ${list(facts.regions.map((r) => r.name))}, from ForestTrace satellite monitoring${facts.yearRange ? `, ${facts.span}` : ''}.`,
    lede: first ? first.paragraphs[0] : `ForestTrace monitoring data for ${list(facts.regions.map((r) => r.name))}.`,
    keyFacts: keyFacts(recipe, t, multi),
    questions: questionsFor(recipe, t, sections),
    sections,
    methodology: methodologyFor(facts),
    caveats: caveatsFor(facts, signals),
  };
}

/**
 * Adds the framework's recipe, kicker and data-derived key questions to a
 * story written by Claude, so both engines get the same components.
 */
function decorateStory(story, facts) {
  const signals = analyze(facts);
  const recipe = chooseRecipe(facts, signals);
  return {
    ...story,
    engine: story.engine || 'claude',
    recipe,
    kicker: story.kicker || RECIPES[recipe].kicker,
    questions: story.questions || questionsFor(recipe, totals(signals), story.sections || []),
  };
}

module.exports = { writeStory, decorateStory, analyze, chooseRecipe, RECIPES };
