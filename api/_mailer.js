const crypto = require('crypto');

/**
 * ForestTrace Mailer Utility
 * 
 * Supports:
 * 1. Resend API (HTTP POST via Node's native fetch - no extra npm packages required)
 * 2. Local development fallback: Prints OTP code prominently to terminal console
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'ForestTrace <notifications@foresttrace.remotesensinglab.org>';

/**
 * Generates a cryptographically random 6-digit numeric OTP code
 */
function generateOtpCode() {
  return crypto.randomInt(100000, 999999).toString();
}

/**
 * Generates a SHA-256 hash of a code for secure storage in MongoDB
 */
function hashCode(code) {
  return crypto.createHash('sha256').update(String(code).trim()).digest('hex');
}

/**
 * HTML Email Template Generator
 */
function renderEmailTemplate({ title, greeting, leadText, code, footerNote }) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 520px; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.08), 0 2px 4px -2px rgba(0, 0, 0, 0.06); border: 1px solid #e2e8f0;">
          
          <!-- Header -->
          <tr>
            <td style="background-color: #1e2530; padding: 28px 32px; text-align: center;">
              <span style="font-size: 28px; display: inline-block; margin-bottom: 6px;">🌲</span>
              <h1 style="margin: 0; color: #ffffff; font-size: 20px; font-weight: 700; letter-spacing: -0.3px;">ForestTrace</h1>
              <p style="margin: 4px 0 0; color: #94a3b8; font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.8px;">Remote Sensing Lab • Saint Louis University</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 32px 32px 24px;">
              <h2 style="margin: 0 0 16px; font-size: 18px; font-weight: 700; color: #0f172a;">${title}</h2>
              <p style="margin: 0 0 14px; font-size: 14px; line-height: 1.6; color: #334155;">
                ${greeting}
              </p>
              <p style="margin: 0 0 24px; font-size: 14px; line-height: 1.6; color: #334155;">
                ${leadText}
              </p>

              <!-- Code Box -->
              <div style="background-color: #f8fafc; border: 2px dashed #cbd5e1; border-radius: 10px; padding: 18px 24px; text-align: center; margin: 24px 0;">
                <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #64748b; font-weight: 700; margin-bottom: 6px;">Verification Code</div>
                <div style="font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #2e7d32;">${code}</div>
                <div style="font-size: 12px; color: #94a3b8; margin-top: 6px;">Valid for 10 minutes</div>
              </div>

              <p style="margin: 20px 0 0; font-size: 13px; line-height: 1.5; color: #64748b;">
                ${footerNote || 'If you did not request this verification code, you can safely disregard this email.'}
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 18px 32px; border-top: 1px solid #e2e8f0; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #94a3b8; line-height: 1.5;">
                ForestTrace Geospatial Platform • Remote Sensing Lab<br>
                Saint Louis University
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Sends a verification email.
 * If RESEND_API_KEY is configured, delivers real email via Resend HTTP API.
 * Otherwise, outputs formatted banner in the Node console for dev testing.
 */
async function sendEmail({ to, subject, html, text, code, purpose }) {
  const normalizedTo = to.trim().toLowerCase();

  // If Resend API key is present, send via Resend
  if (RESEND_API_KEY) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: EMAIL_FROM,
          to: [normalizedTo],
          subject,
          html,
          text: text || `Your verification code is: ${code}. Valid for 10 minutes.`,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        console.error('[Mailer] Resend API error:', data);
        throw new Error(data.message || 'Failed to send email via Resend');
      }

      console.log(`[Mailer] Verification email sent to ${normalizedTo} (ID: ${data.id})`);
      return { success: true, messageId: data.id };
    } catch (err) {
      console.error('[Mailer] Delivery exception:', err.message);
      // If delivery fails, also log code to console so local dev remains unblocked
      logDevCode(normalizedTo, code, purpose, err.message);
      throw err;
    }
  }

  // Local Development Fallback: Log prominently to console
  logDevCode(normalizedTo, code, purpose);
  return { success: true, simulated: true };
}

function logDevCode(to, code, purpose, failureReason) {
  const border = '═'.repeat(60);
  console.log(`\n╔${border}╗`);
  console.log(`║               🌲 FORESTTRACE AUTH CODE                    ║`);
  console.log(`╠${border}╣`);
  console.log(`║  To:      ${(to || '').padEnd(48)}║`);
  console.log(`║  Purpose: ${(purpose || 'Authentication').padEnd(48)}║`);
  console.log(`║  CODE:    \x1b[32m\x1b[1m${(code || '').padEnd(8)}\x1b[0m                                        ║`);
  if (failureReason) {
    console.log(`║  Note:    Resend failed (${failureReason.slice(0, 30)}...) ║`);
  } else {
    console.log(`║  Note:    (RESEND_API_KEY unset - logging in dev mode)    ║`);
  }
  console.log(`╚${border}╝\n`);
}

/**
 * Sends a 6-digit sign-up email confirmation code
 */
async function sendSignupVerificationEmail(email, code, name) {
  const greeting = name ? `Hello ${name},` : 'Hello,';
  const html = renderEmailTemplate({
    title: 'Verify your ForestTrace Account',
    greeting,
    leadText: 'Thank you for registering with ForestTrace. Please enter the following 6-digit verification code to confirm your email and complete your registration.',
    code,
    footerNote: 'This code will expire in 10 minutes. If you did not create a ForestTrace account, you can safely ignore this email.',
  });

  return sendEmail({
    to: email,
    subject: `Your ForestTrace Verification Code: ${code}`,
    html,
    code,
    purpose: 'Sign Up Verification',
  });
}

/**
 * Sends a 6-digit passwordless login authentication code
 */
async function sendLoginCodeEmail(email, code, name) {
  const greeting = name ? `Hello ${name},` : 'Hello,';
  const html = renderEmailTemplate({
    title: 'Your ForestTrace Sign-In Code',
    greeting,
    leadText: 'You requested a one-time code to sign in to your ForestTrace geospatial monitoring workspace.',
    code,
    footerNote: 'This code is valid for 10 minutes and can only be used once. If you did not request this login code, please review your account security.',
  });

  return sendEmail({
    to: email,
    subject: `Your ForestTrace Sign-In Code: ${code}`,
    html,
    code,
    purpose: 'Passwordless Sign In',
  });
}

module.exports = {
  generateOtpCode,
  hashCode,
  sendSignupVerificationEmail,
  sendLoginCodeEmail,
};

