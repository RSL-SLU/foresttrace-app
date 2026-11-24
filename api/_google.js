const crypto = require('crypto');

/**
 * "Sign in with Google": verifies the ID token the Google Identity Services
 * button hands the browser (a JWT signed by Google, RS256), without an SDK.
 *
 *   GOOGLE_CLIENT_ID  the OAuth client ID (falls back to REACT_APP_GOOGLE_CLIENT_ID,
 *                     the same value the client renders the button with)
 *
 * Checks, per Google's guide (developers.google.com/identity/gsi/web/guides/verify-google-id-token):
 * signature against Google's published keys, iss, aud == our client ID, exp.
 */

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const CLOCK_SKEW_S = 60;

let certCache = { keys: null, expiresAt: 0 };

function googleClientId() {
  return process.env.GOOGLE_CLIENT_ID || process.env.REACT_APP_GOOGLE_CLIENT_ID || null;
}

async function googleKeys({ refresh = false } = {}) {
  if (!refresh && certCache.keys && Date.now() < certCache.expiresAt) return certCache.keys;
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error(`Could not fetch Google signing keys (HTTP ${res.status})`);
  const { keys } = await res.json();
  // Google rotates keys; its Cache-Control says how long these are good for.
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') || '')?.[1]) || 3600;
  certCache = { keys, expiresAt: Date.now() + maxAge * 1000 };
  return keys;
}

const decodePart = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

/**
 * The token's claims ({ sub, email, email_verified, name, ... }) if it is a
 * valid Google ID token for `audience`; throws otherwise. `keys` overrides
 * the fetched key set (tests).
 */
async function verifyGoogleIdToken(idToken, audience, { keys, now = Date.now() } = {}) {
  if (!audience) throw new Error('Google sign-in is not configured (GOOGLE_CLIENT_ID).');
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('Malformed Google credential.');
  const [h, p, s] = parts;

  let header;
  let claims;
  try {
    header = decodePart(h);
    claims = decodePart(p);
  } catch (_) {
    throw new Error('Malformed Google credential.');
  }
  if (header.alg !== 'RS256') throw new Error('Unexpected Google credential algorithm.');

  let keySet = keys || await googleKeys();
  let jwk = keySet.find((k) => k.kid === header.kid);
  if (!jwk && !keys) {
    // A key newer than our cache: refetch once.
    keySet = await googleKeys({ refresh: true });
    jwk = keySet.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new Error('Google credential signed with an unknown key.');

  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const valid = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, 'base64url'));
  if (!valid) throw new Error('Google credential signature is invalid.');

  const nowS = Math.floor(now / 1000);
  if (!ISSUERS.has(claims.iss)) throw new Error('Google credential has the wrong issuer.');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(audience)) throw new Error('Google credential was issued for another app.');
  if (!claims.exp || claims.exp + CLOCK_SKEW_S < nowS) throw new Error('Google credential has expired. Try again.');
  if (claims.iat && claims.iat - CLOCK_SKEW_S > nowS) throw new Error('Google credential is not valid yet.');
  if (!claims.sub) throw new Error('Google credential has no account id.');
  return claims;
}

module.exports = { verifyGoogleIdToken, googleClientId };
