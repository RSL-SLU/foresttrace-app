#!/usr/bin/env node
/**
 * Email registered users about the new features (Disturbance Alerts, email
 * notifications, Google sign-in, NISAR plans), linking to the guide at
 * <site>/?docs=alerts. Template: renderFeatureAnnouncement in api/_mailer.js.
 *
 * Usage, in this order:
 *   node scripts/admin/announce-features.js --db foresttrace --dry-run          # who would get it
 *   node scripts/admin/announce-features.js --db foresttrace --to you@x.org     # one preview copy
 *   node scripts/admin/announce-features.js --db foresttrace --send             # everyone
 *
 * Options:
 *   --db <name>       required: foresttrace | foresttrace_preview | foresttrace_dev
 *   --dry-run         list recipients, send nothing
 *   --to <email>      send only to this address (a preview; not recorded)
 *   --send            send to every recipient not sent this announcement yet
 *   --app-url <url>   site the links go to (default APP_URL; localhost for foresttrace_dev)
 *
 * Recipients: every account with an email, except accounts still waiting on
 * their invitation (no password and no Google sign-in; the invitation covers
 * them). Each send is recorded on the user (announcements: [ANNOUNCEMENT_ID]),
 * so re-running --send only reaches people added or missed since.
 *
 * Needs RESEND_API_KEY and EMAIL_FROM in .env.
 */

const ANNOUNCEMENT_ID = 'features-2026-11-alerts';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };
const dbName = opt('--db');
const dryRun = args.includes('--dry-run');
const previewTo = (opt('--to') || '').trim().toLowerCase() || null;
const sendAll = args.includes('--send');

if (!dbName || [dryRun, Boolean(previewTo), sendAll].filter(Boolean).length !== 1) {
  console.error('Usage: node scripts/admin/announce-features.js --db <name> (--dry-run | --to <email> | --send) [--app-url https://...]');
  process.exit(1);
}

process.env.MONGODB_DB_NAME = dbName;
const { getCollection, getMongoUri, closeDb } = require('../../api/_db');
const { sendEmail, renderFeatureAnnouncement, isConfigured } = require('../../api/_mailer');
const { googleClientId } = require('../../api/_google');

const appUrl = (opt('--app-url')
  || (dbName === 'foresttrace_dev' ? 'http://localhost:3000' : process.env.APP_URL || '')).replace(/\/+$/, '');
if (!appUrl) {
  console.error(`Links need the site's address: pass --app-url https://... or set APP_URL in .env.`);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEND_INTERVAL_MS = 600;   // Resend allows 2 requests per second by default

(async () => {
  if (!getMongoUri()) {
    console.error('Neither VERCEL_MONGODB_URI nor MONGODB_URI is configured.');
    process.exit(1);
  }
  if (!dryRun && !isConfigured()) {
    console.error('RESEND_API_KEY is not set, so nothing can be sent.');
    process.exit(1);
  }
  const users = await getCollection('users');
  const googleEnabled = Boolean(googleClientId());
  console.log(`Database "${dbName}", links to ${appUrl}, Google sign-in ${googleEnabled ? 'mentioned' : 'not mentioned (GOOGLE_CLIENT_ID unset here)'}.`);

  if (previewTo) {
    const user = await users.findOne({ email: previewTo }, { projection: { name: 1 } });
    const message = renderFeatureAnnouncement({ name: user?.name, appUrl, googleEnabled });
    const sent = await sendEmail({ to: previewTo, ...message });
    console.log(`Preview "${message.subject}" sent to ${previewTo} (Resend id ${sent.id}). Not recorded; --send will still include this address.`);
    await closeDb();
    return;
  }

  const recipients = await users.find({
    email: { $exists: true, $ne: '' },
    announcements: { $ne: ANNOUNCEMENT_ID },
    $or: [{ passwordHash: { $exists: true } }, { googleSub: { $exists: true } }],
  }, { projection: { email: 1, name: 1 } }).sort({ createdAt: 1 }).toArray();

  const pendingInvites = await users.countDocuments({ passwordHash: { $exists: false }, googleSub: { $exists: false } });
  console.log(`${recipients.length} recipient(s) not yet sent "${ANNOUNCEMENT_ID}"; ${pendingInvites} account(s) skipped while their invitation is pending.`);

  if (dryRun) {
    recipients.forEach((u) => console.log(`  ${u.email}${u.name ? `  (${u.name})` : ''}`));
    console.log('Dry run: nothing sent.');
    await closeDb();
    return;
  }

  let sent = 0;
  let failed = 0;
  for (const [i, user] of recipients.entries()) {
    if (i) await sleep(SEND_INTERVAL_MS);
    try {
      const result = await sendEmail({ to: user.email, ...renderFeatureAnnouncement({ name: user.name, appUrl, googleEnabled }) });
      await users.updateOne({ _id: user._id }, { $addToSet: { announcements: ANNOUNCEMENT_ID } });
      sent++;
      console.log(`  sent  ${user.email}  (${result.id})`);
    } catch (err) {
      failed++;
      console.error(`  FAIL  ${user.email}: ${err.message}`);
    }
  }
  console.log(`Done: ${sent} sent, ${failed} failed.${failed ? ' Re-run --send to retry the failures only.' : ''}`);
  await closeDb();
})().catch(async (err) => {
  console.error(err.message || err);
  await closeDb().catch(() => {});
  process.exitCode = 1;
});
