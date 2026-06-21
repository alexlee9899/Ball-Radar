import nodemailer from 'nodemailer';

// Email sending abstraction.
// - dev (default): code is logged to the server console and returned to the API
//   caller as `devCode`, so you can test without a real mailbox.
// - smtp/prod: real send. We PREFER Resend's HTTP API (port 443 — reliable on
//   cloud hosts where SMTP ports are throttled/blocked). Falls back to generic
//   SMTP via nodemailer (with timeouts so it never hangs forever).

const EMAIL_MODE = process.env.EMAIL_MODE || 'dev';
const MAIL_FROM = process.env.MAIL_FROM || process.env.SMTP_USER || 'onboarding@resend.dev';

// Reuse SMTP_PASS as the Resend key when the host is Resend (no extra var needed).
const RESEND_API_KEY =
  process.env.RESEND_API_KEY ||
  ((process.env.SMTP_HOST || '').includes('resend.com') ? process.env.SMTP_PASS : null);
const useResendHttp = EMAIL_MODE !== 'dev' && !!RESEND_API_KEY;

let transporter: any = null;
if (EMAIL_MODE === 'smtp' && !useResendHttp) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

export function isDevMail() {
  return EMAIL_MODE === 'dev';
}

function buildContent(code, purpose) {
  const subject =
    purpose === 'reset' ? 'Ball Radar password reset code' : 'Ball Radar verification code';
  const text = `Your verification code is: ${code}\nValid for 10 minutes.\n\n— Ball Radar · Sydney Basketball Court Map`;
  const html = `<div style="font-family:sans-serif;background:#0a0e1a;color:#e0f7ff;padding:32px;border-radius:12px">
      <h2 style="color:#00f0ff">Ball Radar</h2>
      <p>${subject}</p>
      <p style="font-size:32px;letter-spacing:8px;color:#00f0ff;font-weight:bold">${code}</p>
      <p style="color:#7a8ba8">Valid for 10 minutes.</p>
    </div>`;
  return { subject, text, html };
}

async function sendViaResend(email, code, purpose) {
  const { subject, text, html } = buildContent(code, purpose);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: MAIL_FROM, to: email, subject, text, html }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Resend API ${res.status}: ${body}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function sendVerificationEmail(email, code, purpose = 'verify') {
  const { subject, text, html } = buildContent(code, purpose);

  if (isDevMail()) {
    console.log('═'.repeat(50));
    console.log(`📧 [DEV MAIL] to: ${email}`);
    console.log(`   subject: ${subject}`);
    console.log(`   code: ${code}`);
    console.log('═'.repeat(50));
    return { dev: true };
  }

  if (useResendHttp) {
    await sendViaResend(email, code, purpose);
    return { dev: false };
  }

  await transporter.sendMail({ from: MAIL_FROM, to: email, subject, text, html });
  return { dev: false };
}
