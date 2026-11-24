const { getCollection } = require('./_db');

/**
 * Keeps scripted sign-ups out (each account can spend AI and email quota).
 * Three layers, cheapest first:
 *
 *   1. Honeypot: a form field people never see. Naive bots fill every field.
 *   2. Cloudflare Turnstile: a free, mostly invisible challenge. On when
 *      TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are set
 *      (dash.cloudflare.com > Turnstile > Add widget, with the site's domains).
 *   3. Per-IP rate limit on new accounts (MongoDB `rate_limits`, auto-expiring),
 *      which also covers Google sign-ups and works with no setup.
 */

const SIGNUPS_PER_HOUR = 5;
const SIGNUPS_PER_DAY = 20;
const HOUR = 60 * 60 * 1000;
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const turnstileSiteKey = () => (process.env.TURNSTILE_SECRET_KEY && process.env.TURNSTILE_SITE_KEY) || null;

/** The caller's IP. Vercel and the dev proxy set x-forwarded-for; the first entry is the client. */
function clientIp(req) {
  const h = req.headers || {};
  const fwd = String(h['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || String(h['x-real-ip'] || '').trim() || req.socket?.remoteAddress || 'unknown';
}

const isLocal = (ip) => ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'unknown'].includes(ip);

async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || !process.env.TURNSTILE_SITE_KEY) return true;   // not configured: layer off
  if (!token) return false;
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      body: new URLSearchParams({ secret, response: String(token), ...(isLocal(ip) ? {} : { remoteip: ip }) }),
    });
    const data = await res.json();
    if (!data.success) console.warn('[Bot guard] Turnstile rejected:', data['error-codes']);
    return data.success === true;
  } catch (err) {
    // Cloudflare unreachable: fail closed, but say so in the log.
    console.error('[Bot guard] Turnstile verification failed:', err.message);
    return false;
  }
}

let indexReady = null;
async function limits() {
  const col = await getCollection('rate_limits');
  indexReady ??= Promise.all([
    col.createIndex({ key: 1, at: -1 }),
    col.createIndex({ at: 1 }, { expireAfterSeconds: 24 * 60 * 60 }),
  ]).catch((err) => { indexReady = null; throw err; });
  await indexReady;
  return col;
}

/** Too many new accounts from this IP lately? Local requests are never limited. */
async function signupRateLimited(ip) {
  if (isLocal(ip)) return false;
  const col = await limits();
  const key = `signup:${ip}`;
  const now = Date.now();
  const [hour, day] = await Promise.all([
    col.countDocuments({ key, at: { $gt: new Date(now - HOUR) } }),
    col.countDocuments({ key, at: { $gt: new Date(now - 24 * HOUR) } }),
  ]);
  return hour >= SIGNUPS_PER_HOUR || day >= SIGNUPS_PER_DAY;
}

/** Call once an account has actually been created. */
async function recordSignup(ip) {
  if (isLocal(ip)) return;
  const col = await limits();
  await col.insertOne({ key: `signup:${ip}`, at: new Date() });
}

/**
 * Checks for the email sign-up form. Resolves null when the request may
 * proceed, else { status, error } to send back.
 *   body.website         the honeypot (must be empty)
 *   body.turnstileToken  from the Turnstile widget
 */
async function checkSignup(req) {
  const body = req.body || {};
  const ip = clientIp(req);
  if (String(body.website || '').trim()) {
    console.warn(`[Bot guard] Honeypot filled from ${ip}`);
    // Deliberately bland: nothing to tell a bot what tripped.
    return { status: 400, error: 'Sign-up could not be completed. Please try again.' };
  }
  if (!await verifyTurnstile(body.turnstileToken, ip)) {
    return { status: 400, error: 'Please complete the “I’m human” check and try again.' };
  }
  if (await signupRateLimited(ip)) {
    return { status: 429, error: 'Too many accounts have been created from your network recently. Please try again later.' };
  }
  return null;
}

module.exports = { checkSignup, signupRateLimited, recordSignup, clientIp, turnstileSiteKey };
