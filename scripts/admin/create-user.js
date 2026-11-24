#!/usr/bin/env node
/**
 * Create a ForestTrace account, and optionally have it watch FMUs for
 * disturbance alert emails (Disturbance Alerts > Email notifications).
 *
 * Usage:
 *   node scripts/admin/create-user.js <email> --db foresttrace_dev --fmus wabigoon,dryden
 *   node scripts/admin/create-user.js <email> --db foresttrace --name "Jane Doe" --role analyst
 *   node scripts/admin/create-user.js <email> --db foresttrace_dev --google-only
 *
 * Options:
 *   --db <name>         required: foresttrace | foresttrace_preview | foresttrace_dev
 *   --name <text>       display name (default: the part of the email before @)
 *   --username <slug>   public username for story links (default: derived from the email)
 *   --role <role>       user (default) | analyst | admin
 *   --fmus <a,b,...>    FMU ids to watch, added to any already watched
 *   --google-only       no password: the account signs in with "Sign in with Google"
 *
 * The password is prompted for (not echoed, not in shell history), unless
 * --google-only. If the account already exists, nothing about it changes
 * except that --fmus are added -- use reset-password.js for passwords.
 *
 * Credentials: VERCEL_MONGODB_URI or MONGODB_URI from .env / .env.vercel.
 */

const readline = require('readline');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };
// The email is the one argument that is neither a flag nor a flag's value.
const VALUE_FLAGS = new Set(['--db', '--name', '--username', '--role', '--fmus']);
const email = (args.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(args[i - 1])) || '').trim().toLowerCase();
const dbName = opt('--db');
const role = opt('--role') || 'user';
const googleOnly = args.includes('--google-only');
const fmuArg = (opt('--fmus') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !dbName) {
  console.error('Usage: node scripts/admin/create-user.js <email> --db <foresttrace|foresttrace_preview|foresttrace_dev> [--name "..."] [--username slug] [--role user|analyst|admin] [--fmus a,b] [--google-only]');
  process.exit(1);
}
if (!['user', 'analyst', 'admin'].includes(role)) {
  console.error(`Unknown role "${role}": use user, analyst or admin.`);
  process.exit(1);
}

// Must be set before _db is loaded: it resolves the database name from env.
process.env.MONGODB_DB_NAME = dbName;
const { getCollection, getMongoUri, hashPassword } = require('../../api/_db');
const { normalizeUsername, validateUsername, ensureUsername, ensureIndex } = require('../../api/_usernames');
const { ensureWatchIndexes, FMU_LABELS } = require('../../api/_alertNotify');

const unknownFmus = fmuArg.filter((f) => !FMU_LABELS[f]);
if (unknownFmus.length) {
  console.error(`Unknown FMU id(s): ${unknownFmus.join(', ')}. Valid ids are in client/src/data/ontarioFmus.json (e.g. wabigoon).`);
  process.exit(1);
}

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
  await ensureIndex(users);

  let user = await users.findOne({ email });
  if (user) {
    console.log(`Account exists: ${user.name || email} (${user.role || 'user'}) in "${dbName}". Leaving it as is.`);
  } else {
    const wantedUsername = opt('--username');
    if (wantedUsername) {
      const problem = validateUsername(wantedUsername);
      if (problem) { console.error(problem); process.exit(1); }
      if (await users.findOne({ username: normalizeUsername(wantedUsername) }, { projection: { _id: 1 } })) {
        console.error(`Username "${wantedUsername}" is taken.`);
        process.exit(1);
      }
    }

    let passwordHash;
    if (!googleOnly) {
      const password = await promptHidden(`Password for ${email} (min 6 chars): `);
      if (password.length < 6) { console.error('Password must be at least 6 characters.'); process.exit(1); }
      if (await promptHidden('Repeat password: ') !== password) { console.error('Passwords do not match.'); process.exit(1); }
      passwordHash = hashPassword(password);
    }

    const doc = {
      email,
      name: (opt('--name') || '').trim() || email.split('@')[0],
      ...(wantedUsername ? { username: normalizeUsername(wantedUsername) } : {}),
      ...(passwordHash ? { passwordHash } : {}),
      role,
      createdAt: new Date(),
      createdBy: 'scripts/admin/create-user.js',
    };
    const { insertedId } = await users.insertOne(doc);
    user = { ...doc, _id: insertedId };
    const username = await ensureUsername(users, user);
    console.log(`Created ${role} ${email} (username "${username}") in "${dbName}"${googleOnly ? '; signs in with Google only' : ''}.`);
  }

  if (fmuArg.length) {
    await ensureWatchIndexes();
    const watches = await getCollection('alert_watches');
    const userId = user._id.toString();
    const existing = await watches.findOne({ userId, kind: 'fmus' });
    const fmus = [...new Set([...(existing?.fmus || []), ...fmuArg])];
    await watches.updateOne(
      { userId, kind: 'fmus' },
      { $set: { fmus, updatedAt: new Date() }, $setOnInsert: { userId, kind: 'fmus', createdAt: new Date() } },
      { upsert: true },
    );
    console.log(`Watching for alert emails: ${fmus.map((f) => FMU_LABELS[f]).join(', ')}.`);
    if (user.alertEmails === false) console.log('Note: this account has alert emails turned off; it can turn them on in the app.');
  }
  process.exit(0);
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
