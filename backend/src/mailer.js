import nodemailer from 'nodemailer';

// Email sending abstraction.
// DEV mode (default): code is logged to the server console and returned to the
// API caller as `devCode` so you can test without a real mailbox.
// PROD mode: set SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / MAIL_FROM
// environment variables and EMAIL_MODE=smtp to send real emails.

const EMAIL_MODE = process.env.EMAIL_MODE || 'dev';

let transporter = null;
if (EMAIL_MODE === 'smtp') {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

export function isDevMail() {
  return EMAIL_MODE !== 'smtp';
}

export async function sendVerificationEmail(email, code, purpose = 'verify') {
  const subject =
    purpose === 'reset' ? 'Ball Radar password reset code' : 'Ball Radar verification code';
  const text = `Your verification code is: ${code}\nValid for 10 minutes.\n\n— Ball Radar · Sydney Basketball Court Map`;

  if (isDevMail()) {
    console.log('═'.repeat(50));
    console.log(`📧 [DEV MAIL] to: ${email}`);
    console.log(`   subject: ${subject}`);
    console.log(`   code: ${code}`);
    console.log('═'.repeat(50));
    return { dev: true };
  }

  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: email,
    subject,
    text,
    html: `<div style="font-family:sans-serif;background:#0a0e1a;color:#e0f7ff;padding:32px;border-radius:12px">
      <h2 style="color:#00f0ff">Ball Radar</h2>
      <p>${subject}</p>
      <p style="font-size:32px;letter-spacing:8px;color:#00f0ff;font-weight:bold">${code}</p>
      <p style="color:#7a8ba8">Valid for 10 minutes.</p>
    </div>`,
  });
  return { dev: false };
}
