const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');
const { zodOutputFormat } = require('@anthropic-ai/sdk/helpers/zod');
const { z } = require('zod');
const {
  getCollection, getUserFromRequest, getMongoUri, ObjectId,
} = require('./_db');
const { buildStoryFacts } = require('./_storyFacts');
const { renderStoryHtml } = require('./_storyRender');
const { renderStoryThumbnail } = require('./_storyThumb');
const { ensureUsername, slugBase } = require('./_usernames');

/**
 * Story maps for journalists: Claude writes a story from the data on screen,
 * the server renders it into a self-contained HTML page and stores it in
 * MongoDB (`story_maps`), owned by the user.
 *
 *   POST /api/storymaps?action=generate { context, angle, audience }   signed in
 *   GET  /api/storymaps?action=list                                    signed in
 *   GET  /api/storymaps?action=html&id=...                             owner
 *   GET  /api/storymaps?action=view&username=...&slug=...             public page
 *        (pretty URL /stories/<username>/<slug>, via vercel.json / index.js)
 *   GET  /api/storymaps?action=og&username=...&slug=...               preview image
 *        (/stories/<username>/<slug>/preview.jpg)
 *   GET  /api/storymaps?action=view&slug=<random id>                  older links
 *   POST /api/storymaps?action=update { id, isPublic }                 owner
 *   POST /api/storymaps?action=delete { id }                           owner
 *
 * The model writes prose and chooses which dataset to chart and which place
 * the map shows, by id. Every number on a chart and every map location comes
 * from api/_storyFacts.js, and the page escapes all model text.
 */

const MODEL = 'claude-sonnet-5';
const DAILY_LIMIT = 10;          // per user; bounds cost and abuse
const DAY = 24 * 60 * 60 * 1000;
const AUDIENCES = {
  news: 'a news article for a general audience (inverted pyramid, short paragraphs, plain language)',
  explainer: 'an explainer that walks a general reader through what the data shows and why it matters',
  brief: 'a short briefing for editors or policy staff: direct, factual, minimal background',
};

const StorySchema = z.object({
  title: z.string().describe('Headline, under 12 words, factual, no clickbait'),
  dek: z.string().describe('One-sentence subheadline'),
  lede: z.string().describe('Opening paragraph that states the main finding with its key figure'),
  keyFacts: z.array(z.object({
    label: z.string(),
    value: z.string().describe('A figure taken verbatim from a dataset, with its unit'),
    sourceDatasetId: z.string().describe('Id of the dataset this figure comes from'),
  })).describe('2 to 4 headline figures'),
  sections: z.array(z.object({
    heading: z.string(),
    paragraphs: z.array(z.string()),
    placeId: z.string().describe('Id of a place from PLACES for the map to show during this section'),
    chart: z.object({
      datasetId: z.string().describe('Id of a dataset from DATASETS'),
      type: z.enum(['bar', 'line']),
      title: z.string(),
      caption: z.string().describe('One sentence on what the chart shows'),
    }).nullable(),
  })).describe('3 to 6 sections'),
  methodology: z.string().describe('Plain-language note on how the data was produced'),
  caveats: z.array(z.string()).describe('Limitations a reader or editor must know'),
});

const SYSTEM_PROMPT = `You write data-driven story maps for journalists, from ForestTrace: a forest-monitoring platform by the Remote Sensing Lab at Saint Louis University covering boreal forests in Ontario, Canada.

You are given DATASETS (yearly series with units and sources), PLACES (map locations), a SUMMARY of the selected forest management units (FMUs), and the author's angle. Write a story that a reporter could edit and publish.

Accuracy rules -- these come before style:
- Use only figures that appear in DATASETS or SUMMARY. Do not estimate, extrapolate or invent numbers, dates, names, causes or quotes.
- You may round (e.g. 61,236.8 ha -> about 61,200 ha) and compute simple differences or percentage changes between two values in the data; when you do, say which two values you compared.
- Attribute figures to their source as listed. Clearcut figures come from an AI model applied to satellite imagery (Harmonized Landsat Sentinel-2); say so, and treat them as estimates. Use the accuracy dataset, when present, to describe how reliable the model is.
- Wildfire burned area figures come from the Canadian National Burned Area Composite (NBAC); attribute them to NBAC.
- When multiple disturbances (such as both clearcutting and wildfires) or wildlife habitat datasets are present, examine their cumulative or compounded impact across the landscape.
- Do not attribute clearcuts to any company, person or cause; the data cannot show who cut or why.
- "Standing clearcut area" is a 5-year rolling total; "newly detected clearcut" is new area per year. Do not mix them up.
- If alert data is marked demo data, say clearly that alerts are demonstration data and not real detections.
- If the data cannot support the author's angle, say so plainly instead of stretching it.

Structure:
- Refer to DATASETS and PLACES only by their exact ids. Each section's placeId must be a PLACES id; chart.datasetId must be a DATASETS id, or chart must be null. Choose a chart only where it supports the section.
- Plain text only in every field: no Markdown, no HTML.`;

function clientFor() {
  // Resolves ANTHROPIC_API_KEY from the environment (Vercel env var / .env)
  return new Anthropic();
}
let makeClient = clientFor;

// Numbers in the prose that don't trace back to the facts, for the author to
// check before publishing. Advisory only: the model may legitimately compute a
// difference or percentage.
function uncheckedFigures(story, facts) {
  // A figure written as a round number ("about 57,000") may round a fact; an
  // exact-looking one ("12,345") has to match a fact to the unit.
  const exact = new Set();
  const hundreds = new Set();
  const thousands = new Set();
  const add = (n) => {
    if (!Number.isFinite(n)) return;
    exact.add(Math.round(n));
    hundreds.add(Math.round(n / 100) * 100);
    thousands.add(Math.round(n / 1000) * 1000);
  };
  const isKnown = (n) => {
    const r = Math.round(n);
    if (exact.has(r)) return true;
    if (r % 1000 === 0) return thousands.has(r);
    if (r % 100 === 0) return hundreds.has(r);
    return false;
  };
  facts.datasets.forEach((d) => { d.values.forEach(add); d.labels.forEach((l) => add(Number(l))); });
  facts.places.forEach((p) => add(p.areaHa));
  JSON.stringify(facts.regions).match(/-?\d+(\.\d+)?/g)?.forEach((n) => add(Number(n)));

  const text = [story.title, story.dek, story.lede, ...story.keyFacts.map((k) => k.value),
    ...story.sections.flatMap((s) => [s.heading, ...s.paragraphs])].join(' ');
  const flagged = new Set();
  for (const m of text.matchAll(/\d[\d,]*(\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ''));
    if (n < 10 || isKnown(n)) continue;
    flagged.add(m[0]);
  }
  return [...flagged].slice(0, 20);
}

async function generateStory({ facts, angle, audience }) {
  const forModel = {
    YEAR_ON_MAP: facts.year,
    MODULE: facts.module,
    ACTIVE_LAYERS: facts.activeLayers,
    SUMMARY: facts.regions,
    DATASETS: facts.datasets.map(({ id, title, unit, labels, values, source }) => ({ id, title, unit, source, data: Object.fromEntries(labels.map((l, i) => [l, values[i]])) })),
    PLACES: facts.places.map(({ id, kind, label }) => ({ id, kind, label })),
  };

  const client = makeClient();
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user',
      content: `Format: ${AUDIENCES[audience] || AUDIENCES.news}.\n`
        + `Author's angle: ${angle ? angle.slice(0, 1000) : 'none given -- lead with the most newsworthy finding in the data'}.\n\n`
        + `DATA:\n${JSON.stringify(forModel)}`,
    }],
    output_config: { format: zodOutputFormat(StorySchema) },
  });

  if (response.stop_reason === 'refusal') {
    const err = new Error('The model declined to write this story. Try a different angle.');
    err.status = 422;
    throw err;
  }
  if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
    const err = new Error('The story came back incomplete. Please try again.');
    err.status = 502;
    throw err;
  }
  return { story: response.parsed_output, usage: response.usage };
}

const newSlug = () => crypto.randomBytes(9).toString('base64url');

// "Clearcut and Wildfire Analysis on Wabigoon" -> "clearcut-and-wildfire-analysis-on-wabigoon",
// unique among the user's stories (-2, -3, ... on a repeat title).
async function uniqueUrlSlug(stories, userId, title) {
  let base = slugBase(title) || 'story';
  if (base.length > 80) base = base.slice(0, 80).replace(/-[^-]*$/, '') || base.slice(0, 80);
  for (let i = 1; i < 100; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    if (!await stories.findOne({ userId, urlSlug: candidate }, { projection: { _id: 1 } })) return candidate;
  }
  return `${base}-${newSlug().toLowerCase()}`;
}

// The site's own origin as the visitor (or a social crawler) reached it.
// Vercel sets x-forwarded-*; the dev proxy forwards them too (setupProxy xfwd).
function requestOrigin(req) {
  const h = req.headers || {};
  const host = String(h['x-forwarded-host'] || h.host || 'localhost').split(',')[0].trim();
  const proto = String(h['x-forwarded-proto'] || (host.startsWith('localhost') ? 'http' : 'https')).split(',')[0].trim();
  return `${proto}://${host}`;
}

const storyPath = (doc) => (doc.username && doc.urlSlug
  ? `/stories/${encodeURIComponent(doc.username)}/${encodeURIComponent(doc.urlSlug)}`
  : `/api/storymaps?action=view&slug=${encodeURIComponent(doc.slug)}`);

// Pages carry placeholders for what depends on where and how they're served
// (see _storyRender.js); older stories without them pass through unchanged.
function servePage(doc, req) {
  const origin = requestOrigin(req);
  const url = origin + storyPath(doc);
  const image = doc.hasImage && doc.username && doc.urlSlug ? `${url}/preview.jpg` : '';
  const attr = (v) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return doc.html
    .split('__FT_STORY_URL__').join(attr(url))
    .split('__FT_IMAGE_URL__').join(attr(image))
    .split('__FT_PUBLIC__').join(doc.isPublic ? 'true' : 'false');
}

// The public story a request names: /stories/<username>/<slug>, or an old ?slug= link
async function findPublicStory(req, stories, projection) {
  const q = { ...(req.query || {}), ...(req.params || {}) };
  if (q.username && q.slug) {
    return stories.findOne({ username: String(q.username).toLowerCase(), urlSlug: String(q.slug).toLowerCase(), isPublic: true }, { projection });
  }
  return stories.findOne({ slug: String(q.slug || ''), isPublic: true }, { projection });
}

function notFoundPage() {
  return '<!doctype html><meta charset="utf-8"><title>Story not found · ForestTrace</title>'
    + '<body style="font-family:system-ui;padding:48px;color:#333"><h1>Story not found</h1>'
    + '<p>This story map doesn\'t exist or isn\'t shared publicly.</p></body>';
}

function storySummary(doc) {
  return {
    id: doc._id.toString(),
    title: doc.title,
    dek: doc.dek,
    slug: doc.slug,
    username: doc.username || null,
    urlSlug: doc.urlSlug || null,
    path: storyPath(doc),
    isPublic: Boolean(doc.isPublic),
    regions: doc.context?.regions || [],
    year: doc.context?.year ?? null,
    reviewNotes: doc.reviewNotes || [],
    createdAt: doc.createdAt,
  };
}

async function handler(req, res) {
  if (!getMongoUri()) return res.status(503).json({ error: 'Database service unavailable' });

  // req.params.action: the /stories/... routes in index.js (Express 5 query is read-only)
  const action = (req.query?.action || req.params?.action || req.body?.action || '').toLowerCase();
  const user = getUserFromRequest(req);

  try {
    const stories = await getCollection('story_maps');

    // Public link: no account needed, only for stories the owner has shared
    if (req.method === 'GET' && action === 'view') {
      const doc = await findPublicStory(req, stories, { ogImage: 0, story: 0 });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (!doc) return res.status(404).send(notFoundPage());
      res.setHeader('Cache-Control', 'public, max-age=60');
      return res.status(200).send(servePage(doc, req));
    }

    // Preview image for social cards. Public stories only, like the page.
    if (req.method === 'GET' && action === 'og') {
      const doc = await findPublicStory(req, stories, { ogImage: 1 });
      const image = doc?.ogImage?.buffer ? Buffer.from(doc.ogImage.buffer) : doc?.ogImage;
      if (!image) return res.status(404).json({ error: 'No preview image.' });
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.status(200).send(image);
    }

    if (!user?.id) return res.status(401).json({ error: 'Sign in to use story maps.' });
    const ownerQuery = (id) => {
      if (!ObjectId.isValid(String(id))) return null;
      return { _id: new ObjectId(String(id)), userId: user.id };
    };

    if (req.method === 'GET' && action === 'list') {
      const docs = await stories.find({ userId: user.id }, { projection: { html: 0, story: 0, ogImage: 0 } })
        .sort({ createdAt: -1 }).limit(100).toArray();
      // Stories made before pretty URLs: give them a username + URL slug now
      if (docs.some((d) => !d.urlSlug || !d.username)) {
        const users = await getCollection('users');
        const owner = await users.findOne({ _id: new ObjectId(user.id) });
        const username = owner ? await ensureUsername(users, owner) : null;
        for (const d of docs.filter((x) => !x.urlSlug || !x.username)) {
          if (!username) break;
          d.username = username;
          d.urlSlug = d.urlSlug || await uniqueUrlSlug(stories, user.id, d.title);
          await stories.updateOne({ _id: d._id }, { $set: { username: d.username, urlSlug: d.urlSlug } });
        }
      }
      return res.status(200).json({ stories: docs.map(storySummary) });
    }

    if (req.method === 'GET' && action === 'html') {
      const q = ownerQuery(req.query?.id);
      const doc = q && await stories.findOne(q, { projection: { html: 1, username: 1, urlSlug: 1, slug: 1, isPublic: 1, hasImage: 1 } });
      if (!doc) return res.status(404).json({ error: 'Story not found.' });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(servePage(doc, req));
    }

    if (req.method === 'POST' && action === 'update') {
      const q = ownerQuery(req.body?.id);
      if (!q) return res.status(400).json({ error: 'Story id is required.' });
      const result = await stories.findOneAndUpdate(q,
        { $set: { isPublic: Boolean(req.body?.isPublic), updatedAt: new Date() } },
        { returnDocument: 'after', projection: { html: 0, story: 0, ogImage: 0 } });
      const doc = result?.value ?? result;
      if (!doc) return res.status(404).json({ error: 'Story not found.' });
      return res.status(200).json({ story: storySummary(doc) });
    }

    if (req.method === 'POST' && action === 'delete') {
      const q = ownerQuery(req.body?.id);
      if (!q) return res.status(400).json({ error: 'Story id is required.' });
      const result = await stories.deleteOne(q);
      return result.deletedCount
        ? res.status(200).json({ success: true })
        : res.status(404).json({ error: 'Story not found.' });
    }

    if (req.method === 'POST' && action === 'generate') {
      const recent = await stories.countDocuments({ userId: user.id, createdAt: { $gte: new Date(Date.now() - DAY) } });
      if (recent >= DAILY_LIMIT) {
        return res.status(429).json({ error: `Limit of ${DAILY_LIMIT} story maps per day reached. Try again tomorrow.` });
      }

      const { context = {}, angle = '', audience = 'news' } = req.body || {};
      const facts = await buildStoryFacts(context);
      if (!facts.regions.length || (!facts.datasets.length && !facts.places.length)) {
        return res.status(400).json({ error: 'Select at least one forest management unit with data on the map first.' });
      }

      const { story, usage } = await generateStory({ facts, angle: String(angle), audience });
      const createdAt = new Date();

      const users = await getCollection('users');
      const owner = await users.findOne({ _id: new ObjectId(user.id) });
      const username = owner ? await ensureUsername(users, owner) : null;
      const urlSlug = await uniqueUrlSlug(stories, user.id, story.title);

      // Social preview: the story's first map view. Optional -- a story
      // without one still shares, just without an image on the card.
      let ogImage = null;
      const firstView = facts.places.find((p) => p.kind === 'fmu') || facts.places[0];
      if (firstView?.bbox) {
        try {
          ogImage = await renderStoryThumbnail(firstView.bbox, facts.layers);
        } catch (err) {
          console.error('[Story maps] preview image failed:', err.message);
        }
      }
      const html = renderStoryHtml({
        story, facts, createdAt, model: 'Claude Sonnet 5 (Anthropic)',
        author: user.name || 'ForestTrace user',
      });
      const doc = {
        userId: user.id,
        userEmail: user.email,
        title: story.title,
        dek: story.dek,
        slug: newSlug(),
        username,
        urlSlug,
        ogImage,
        hasImage: Boolean(ogImage),
        isPublic: false,
        html,
        story,
        context: { regions: facts.regions.map((r) => r.id), year: facts.year, module: facts.module, moduleId: facts.moduleId, angle, audience },
        reviewNotes: uncheckedFigures(story, facts),
        model: MODEL,
        usage: usage ? { input: usage.input_tokens, output: usage.output_tokens } : null,
        createdAt,
        updatedAt: createdAt,
      };
      const { insertedId } = await stories.insertOne(doc);
      await stories.createIndex({ username: 1, urlSlug: 1 }).catch(() => {});
      return res.status(201).json({ story: storySummary({ ...doc, _id: insertedId }) });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      console.error('[Story maps] Anthropic authentication failed -- is ANTHROPIC_API_KEY set?');
      return res.status(503).json({ error: 'The story writer is not configured on the server.' });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'The story writer is busy. Please try again in a minute.' });
    }
    if (err instanceof Anthropic.APIError) {
      console.error('[Story maps] Anthropic API error', err.status, err.message);
      return res.status(502).json({ error: 'The story writer failed. Please try again.' });
    }
    console.error('[Story maps Error]', err);
    return res.status(err.status || 500).json({ error: err.message || 'Story map service error' });
  }
}

module.exports = handler;
// For tests: swap the Anthropic client factory
module.exports.__setClientFactory = (fn) => { makeClient = fn || clientFor; };
module.exports.StorySchema = StorySchema;
