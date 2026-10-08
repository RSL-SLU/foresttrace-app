/**
 * Public usernames: the first segment of shareable story URLs
 * (/stories/<username>/<story>), so they must be URL-safe, unique and stable.
 *
 * Stored lowercase in users.username. Accounts created before usernames
 * existed get one derived from their email the next time they sign in or
 * create a story (ensureUsername).
 */

// 3-30 chars: lowercase letters, digits, single hyphens; no leading/trailing hyphen
const USERNAME_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,29}$/;

// Words that read as part of the site rather than as a person
const RESERVED = new Set([
  'admin', 'administrator', 'api', 'app', 'stories', 'story', 'static', 'www',
  'foresttrace', 'support', 'help', 'about', 'news', 'settings', 'login',
  'signup', 'register', 'user', 'users', 'public', 'null', 'undefined',
]);

let indexReady = null;
function ensureIndex(users) {
  // Sparse: older accounts have no username until ensureUsername runs
  indexReady ??= users.createIndex({ username: 1 }, { unique: true, sparse: true }).catch(() => {});
  return indexReady;
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

/** An error message, or null when the username is acceptable. */
function validateUsername(value) {
  const u = normalizeUsername(value);
  if (!USERNAME_RE.test(u)) {
    return 'Username must be 3–30 characters: lowercase letters, numbers and single hyphens.';
  }
  if (RESERVED.has(u)) return 'That username is reserved. Please choose another.';
  return null;
}

function slugBase(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The user's username, assigning a unique one derived from their email if missing. */
async function ensureUsername(users, doc) {
  if (doc.username) return doc.username;
  await ensureIndex(users);

  let base = slugBase(doc.email.split('@')[0]).slice(0, 24) || 'user';
  if (base.length < 3 || RESERVED.has(base)) base = `${base}-user`.replace(/^-/, '');
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    if (validateUsername(candidate)) continue;
    try {
      const r = await users.updateOne({ _id: doc._id, username: { $exists: false } }, { $set: { username: candidate } });
      if (r.modifiedCount) return candidate;
      // Someone else set it concurrently -- read it back
      const fresh = await users.findOne({ _id: doc._id }, { projection: { username: 1 } });
      if (fresh?.username) return fresh.username;
    } catch (err) {
      if (err?.code !== 11000) throw err;   // duplicate key: taken, try the next suffix
    }
  }
  throw new Error('Could not assign a username');
}

module.exports = {
  normalizeUsername, validateUsername, ensureUsername, ensureIndex, slugBase,
};
