const crypto = require('crypto');
const { getCollection, ObjectId } = require('./_db');

/**
 * One-time links to set a password: the invitation from
 * scripts/admin/create-user.js --invite (and, later, "forgot password").
 *
 * Only a SHA-256 of the token is stored (collection `password_tokens`), so a
 * database read doesn't yield working links. A token works once, until it
 * expires; issuing a new one for a user voids that user's older ones.
 */

const DAY = 24 * 60 * 60 * 1000;
const hash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

let indexesReady = null;
async function tokens() {
  const col = await getCollection('password_tokens');
  indexesReady ??= Promise.all([
    col.createIndex({ tokenHash: 1 }, { unique: true }),
    col.createIndex({ userId: 1 }),
    // Mongo deletes them a while after they expire
    col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]).catch((err) => { indexesReady = null; throw err; });
  await indexesReady;
  return col;
}

/** A fresh token (the secret for the link) for this user. */
async function createPasswordToken(userId, { purpose = 'invite', days = 7 } = {}) {
  const col = await tokens();
  const id = String(userId);
  await col.deleteMany({ userId: id, usedAt: null });
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + days * DAY);
  await col.insertOne({ userId: id, tokenHash: hash(token), purpose, createdAt: new Date(), expiresAt, usedAt: null });
  return { token, expiresAt };
}

/** The token's record if it is unused and unexpired, else null. Doesn't use it up. */
async function findPasswordToken(token) {
  if (!token || String(token).length < 20) return null;
  const col = await tokens();
  return col.findOne({ tokenHash: hash(token), usedAt: null, expiresAt: { $gt: new Date() } });
}

/**
 * Uses the token up and returns its user id, or null if it was invalid,
 * expired or already used. Atomic, so two submits can't both succeed.
 */
async function consumePasswordToken(token) {
  if (!token || String(token).length < 20) return null;
  const col = await tokens();
  const result = await col.findOneAndUpdate(
    { tokenHash: hash(token), usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
    { returnDocument: 'after' },
  );
  const doc = result?.value ?? result;   // driver v4 returns { value }, v5+ the document
  return doc && ObjectId.isValid(doc.userId) ? doc.userId : null;
}

module.exports = { createPasswordToken, findPasswordToken, consumePasswordToken };
