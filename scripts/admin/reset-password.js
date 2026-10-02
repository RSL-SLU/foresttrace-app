#!/usr/bin/env node
/**
 * Set a new password for an existing ForestTrace account (admin or user).
 *
 * There is no self-service reset -- no mail provider is configured -- so this
 * is the recovery path. It writes the hash with the API's own hashPassword, so
 * the account signs in normally afterwards. Nothing else about the account
 * (role, name, history) changes.
 *
 * Usage:
 *   node scripts/admin/reset-password.js <email> --db foresttrace        # production
 *   node scripts/admin/reset-password.js <email> --db foresttrace_dev    # local development
 *
 * --db is required so a reset never lands in the wrong database by accident:
 * the API picks it from APP_MODE / VERCEL_ENV, and your local .env points at
 * the dev one. The password is prompted for (not echoed, not in shell history).
 *
 * Credentials: VERCEL_MONGODB_URI or MONGODB_URI from .env / .env.vercel.
 */

const readline = require('readline');

const args = process.argv.slice(2);
const email = (args.find((a) => !a.startsWith('--')) || '').trim().toLowerCase();
const dbIdx = args.indexOf('--db');
const dbName = dbIdx !== -1 ? args[dbIdx + 1] : null;

if (!email || !dbName) {
  console.error('Usage: node scripts/admin/reset-password.js <email> --db <foresttrace|foresttrace_preview|foresttrace_dev>');
  process.exit(1);
}

// Must be set before _db is loaded: it resolves the database name from env.
process.env.MONGODB_DB_NAME = dbName;
const { getCollection, getMongoUri, hashPassword } = require('../../api/_db');

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Swallow the typed characters instead of echoing them.
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

(async () => {
  if (!getMongoUri()) {
    console.error('Neither VERCEL_MONGODB_URI nor MONGODB_URI is configured.');
    process.exit(1);
  }

  const users = await getCollection('users');
  const user = await users.findOne({ email });
  if (!user) {
    console.error(`No account for ${email} in database "${dbName}".`);
    process.exit(1);
  }
  console.log(`Account: ${user.name || email} (${user.role || 'user'}) in "${dbName}"`);

  const password = await promptHidden('New password (min 6 chars): ');
  if (password.length < 6) {
    console.error('Password must be at least 6 characters.');
    process.exit(1);
  }
  const confirm = await promptHidden('Repeat new password: ');
  if (confirm !== password) {
    console.error('Passwords do not match.');
    process.exit(1);
  }

  await users.updateOne({ _id: user._id }, { $set: { passwordHash: hashPassword(password) } });
  console.log('Password updated. Sign in with the new password.');
  process.exit(0);
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
