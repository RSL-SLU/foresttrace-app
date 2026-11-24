/**
 * Outgoing email through Resend (https://resend.com), over its HTTP API with
 * Node's own fetch -- no SDK needed.
 *
 *   RESEND_API_KEY  required to send; without it messages are printed to the
 *                   console instead, so local development works offline
 *   EMAIL_FROM      sender; must be on the domain verified in Resend
 */

const EMAIL_FROM = process.env.EMAIL_FROM || 'ForestTrace <notifications@remotesensinglab.org>';

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function isConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

/**
 * Sends one message. `unsubscribeUrl`, when given, becomes the List-Unsubscribe
 * header, which Gmail and Yahoo require of senders of automated mail.
 * Returns { id } from Resend, or { simulated: true } when no key is set.
 */
async function sendEmail({ to, subject, html, text, unsubscribeUrl }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`\n[Mailer] RESEND_API_KEY unset; not sending.\n  To: ${to}\n  Subject: ${subject}\n\n${text}\n`);
    return { simulated: true };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [to],
      subject,
      html,
      text,
      ...(unsubscribeUrl ? {
        headers: {
          'List-Unsubscribe': `<${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      } : {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Resend: ${data.message || data.name || `HTTP ${res.status}`}`);
  }
  return { id: data.id };
}

// ---- Templates ------------------------------------------------------------

function layout({ title, bodyHtml, footerHtml }) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 12px;"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
  <tr><td style="background:#1e2530;padding:22px 28px;">
    <span style="color:#ffffff;font-size:18px;font-weight:700;">ForestTrace</span>
    <span style="color:#94a3b8;font-size:12px;margin-left:8px;">Remote Sensing Lab · Saint Louis University</span>
  </td></tr>
  <tr><td style="padding:28px;">${bodyHtml}</td></tr>
  <tr><td style="background:#f8fafc;padding:16px 28px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.5;color:#64748b;">${footerHtml}</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

const fmtDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/**
 * The digest a user gets when new alerts fall inside what they watch.
 *   alerts: [{ alertId, areaHa, region, regionLabel, firstDetected, status,
 *              confidence, vegLossPct, mock, link, matchedBy: [watch names] }]
 */
function renderAlertDigest({ name, alerts, appUrl, manageUrl, unsubscribeUrl, maxListed = 20 }) {
  const n = alerts.length;
  const subject = n === 1
    ? `New disturbance alert in ${alerts[0].matchedBy[0]}`
    : `${n} new disturbance alerts in your watched areas`;
  const listed = alerts.slice(0, maxListed);
  const anyMock = alerts.some((a) => a.mock);
  const totalHa = alerts.reduce((s, a) => s + (a.areaHa || 0), 0);

  const rows = listed.map((a) => `
    <tr><td style="padding:12px 0;border-top:1px solid #e2e8f0;">
      <a href="${escapeHtml(a.link)}" style="color:#0f172a;font-weight:600;font-size:14px;text-decoration:none;">${escapeHtml(a.areaHa?.toLocaleString('en-US'))} ha · ${escapeHtml(a.regionLabel)}</a>
      <div style="font-size:12px;color:#475569;margin-top:3px;">
        First detected ${escapeHtml(fmtDate(a.firstDetected))} ·
        ${a.status === 'confirmed' ? 'Confirmed' : 'Provisional'}, ${a.confidence === 'high' ? 'high' : 'low'} confidence ·
        up to ${escapeHtml(a.vegLossPct)}% vegetation loss
      </div>
      <div style="font-size:12px;color:#94a3b8;margin-top:2px;">Watched: ${a.matchedBy.map(escapeHtml).join(', ')}</div>
    </td></tr>`).join('');

  const more = n > listed.length
    ? `<p style="font-size:13px;color:#475569;margin:12px 0 0;">…and ${n - listed.length} more. <a href="${escapeHtml(appUrl)}" style="color:#7c3aed;">See all in ForestTrace</a>.</p>`
    : '';

  const bodyHtml = `
    <h1 style="margin:0 0 8px;font-size:18px;color:#0f172a;">${escapeHtml(subject)}</h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#334155;">
      ${name ? `Hello ${escapeHtml(name)}, ` : ''}${n === 1 ? 'a new vegetation-loss alert was' : `${n} new vegetation-loss alerts (${Math.round(totalHa).toLocaleString('en-US')} ha in total) were`}
      detected where you asked to be notified.
    </p>
    ${anyMock ? '<p style="margin:0 0 16px;padding:8px 12px;background:#fef3c7;border-radius:6px;font-size:12px;color:#92400e;">Test data: these alerts are demo records, not real detections.</p>' : ''}
    <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
    ${more}
    <p style="margin:24px 0 0;"><a href="${escapeHtml(appUrl)}" style="display:inline-block;background:#7c3aed;color:#ffffff;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">Open Disturbance Alerts</a></p>
    <p style="margin:16px 0 0;font-size:12px;color:#64748b;line-height:1.5;">
      Alerts follow NASA OPERA DIST-ALERT-HLS: provisional alerts can still change or be withdrawn once later satellite passes are in.
    </p>`;

  const footerHtml = `You get this because you watch areas or FMUs in ForestTrace.
    <a href="${escapeHtml(manageUrl)}" style="color:#64748b;">Manage what you watch</a> ·
    <a href="${escapeHtml(unsubscribeUrl)}" style="color:#64748b;">Stop alert emails</a>`;

  const text = [
    subject,
    '',
    ...listed.map((a) => `- ${a.areaHa} ha, ${a.regionLabel}; first detected ${fmtDate(a.firstDetected)}; ${a.status}, ${a.confidence} confidence; up to ${a.vegLossPct}% loss. Watched: ${a.matchedBy.join(', ')}\n  ${a.link}`),
    n > listed.length ? `...and ${n - listed.length} more.` : '',
    anyMock ? 'Test data: these alerts are demo records, not real detections.' : '',
    '',
    `Open ForestTrace: ${appUrl}`,
    `Stop alert emails: ${unsubscribeUrl}`,
  ].filter((l) => l !== null).join('\n');

  return { subject, html: layout({ title: subject, bodyHtml, footerHtml }), text };
}

function renderTestEmail({ name, appUrl }) {
  const subject = 'ForestTrace alert emails are working';
  const bodyHtml = `
    <h1 style="margin:0 0 8px;font-size:18px;color:#0f172a;">${subject}</h1>
    <p style="margin:0;font-size:14px;line-height:1.6;color:#334155;">
      ${name ? `Hello ${escapeHtml(name)}, ` : ''}this is a test message. When a new disturbance alert falls inside an area or FMU you watch, you'll get an email like this one listing it.
    </p>
    <p style="margin:20px 0 0;"><a href="${escapeHtml(appUrl)}" style="color:#7c3aed;">Open ForestTrace</a></p>`;
  return {
    subject,
    html: layout({ title: subject, bodyHtml, footerHtml: 'Sent because you asked for a test email in ForestTrace.' }),
    text: `${subject}\n\nThis is a test message from ForestTrace.\n${appUrl}`,
  };
}

/**
 * Invitation for an account an administrator created (create-user.js --invite).
 *   fmuLabels: names of the FMUs the account watches, if any
 *   googleEnabled: whether "Continue with Google" is offered on the site
 */
function renderInvite({ name, email, role, setPasswordUrl, expiresAt, appUrl, fmuLabels = [], googleEnabled = false }) {
  const subject = 'Your ForestTrace account is ready';
  const roleLine = role && role !== 'user'
    ? ` with <strong>${escapeHtml(role)}</strong> access`
    : '';
  const fmuHtml = fmuLabels.length
    ? `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#334155;">You'll get an email when new disturbance alerts are detected in
       ${fmuLabels.map((l) => `<strong>${escapeHtml(l)}</strong>`).join(', ')}. You can change this, or draw your own areas to watch, under Disturbance Alerts.</p>`
    : '';
  const googleHtml = googleEnabled
    ? `<p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#475569;">If ${escapeHtml(email)} is a Google account, you can skip the password and use <strong>Continue with Google</strong> on the sign-in screen instead.</p>`
    : '';

  const bodyHtml = `
    <h1 style="margin:0 0 8px;font-size:18px;color:#0f172a;">${subject}</h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#334155;">
      ${name ? `Hello ${escapeHtml(name)}, ` : 'Hello, '}an administrator created a ForestTrace account for you${roleLine}.
      Your sign-in email is <strong>${escapeHtml(email)}</strong>.
    </p>
    ${fmuHtml}
    <p style="margin:20px 0 0;"><a href="${escapeHtml(setPasswordUrl)}" style="display:inline-block;background:#2f8f5b;color:#ffffff;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">Choose your password</a></p>
    <p style="margin:12px 0 0;font-size:12px;color:#64748b;line-height:1.5;">
      The link works once and expires on ${escapeHtml(fmtDate(expiresAt))}. Afterwards, sign in at
      <a href="${escapeHtml(appUrl)}" style="color:#2f8f5b;">${escapeHtml(appUrl.replace(/^https?:\/\//, ''))}</a>.
    </p>
    ${googleHtml}`;

  const text = [
    subject,
    '',
    `An administrator created a ForestTrace account for you${role && role !== 'user' ? ` (${role})` : ''}. Sign-in email: ${email}`,
    fmuLabels.length ? `You'll be emailed about new disturbance alerts in: ${fmuLabels.join(', ')}.` : '',
    '',
    `Choose your password (works once, expires ${fmtDate(expiresAt)}):`,
    setPasswordUrl,
    googleEnabled ? `\nIf this is a Google account, you can use "Continue with Google" instead.` : '',
    '',
    `ForestTrace: ${appUrl}`,
  ].join('\n').replace(/\n{3,}/g, '\n\n');

  return {
    subject,
    html: layout({
      title: subject,
      bodyHtml,
      footerHtml: 'You get this because an administrator added your email to ForestTrace. If you weren’t expecting it, you can ignore it: the account stays unused without a password.',
    }),
    text,
  };
}

module.exports = { sendEmail, isConfigured, renderAlertDigest, renderTestEmail, renderInvite, escapeHtml };
