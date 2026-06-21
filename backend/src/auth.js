import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { one, run } from './db.js';
import { sendVerificationEmail, isDevMail } from './mailer.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'ballradar-dev-secret-change-me';
const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

const router = Router();

function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function issueToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, username: user.username, role: user.role || 'user' },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function publicUser(user) {
  return { id: user.id, email: user.email, username: user.username, role: user.role || 'user' };
}

// Promote accounts whose email is in ADMIN_EMAILS (comma-separated) to admin on boot.
export async function syncAdmins() {
  const list = (process.env.ADMIN_EMAILS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return;
  const r = await run('UPDATE users SET role=$1 WHERE lower(email) = ANY($2)', ['admin', list]);
  if (r.rowCount) console.log(`   Promoted ${r.rowCount} admin account(s) from ADMIN_EMAILS`);
}

async function createAndSendCode(email, purpose) {
  const code = genCode();
  await run(
    'INSERT INTO email_codes (email, code, purpose, expires_at) VALUES ($1,$2,$3,$4)',
    [email, code, purpose, Date.now() + CODE_TTL_MS]
  );
  await sendVerificationEmail(email, code, purpose);
  return code;
}

// Returns seconds the caller must wait before requesting another code, or 0.
async function cooldownRemaining(email, purpose) {
  const row = await one(
    'SELECT expires_at FROM email_codes WHERE email=$1 AND purpose=$2 ORDER BY id DESC LIMIT 1',
    [email, purpose]
  );
  if (!row) return 0;
  const createdAt = Number(row.expires_at) - CODE_TTL_MS;
  const remaining = createdAt + RESEND_COOLDOWN_MS - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

async function consumeCode(email, code, purpose) {
  const row = await one(
    `SELECT * FROM email_codes
       WHERE email=$1 AND code=$2 AND purpose=$3 AND used=FALSE AND expires_at > $4
       ORDER BY id DESC LIMIT 1`,
    [email, code, purpose, Date.now()]
  );
  if (!row) return false;
  await run('UPDATE email_codes SET used=TRUE WHERE id=$1', [row.id]);
  return true;
}

// POST /api/auth/register  { email, username, password }
router.post('/register', async (req, res) => {
  const { email, username, password } = req.body || {};
  if (!email || !username || !password)
    return res.status(400).json({ error: 'Missing email / username / password' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Invalid email format' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const existing = await one('SELECT * FROM users WHERE email=$1', [email]);
  if (existing && existing.verified)
    return res.status(409).json({ error: 'This email is already registered' });
  if (await one('SELECT 1 FROM users WHERE username=$1 AND email<>$2', [username, email]))
    return res.status(409).json({ error: 'Username is already taken' });

  const wait = await cooldownRemaining(email, 'verify');
  if (wait > 0) return res.status(429).json({ error: `Please wait ${wait}s before requesting another code` });

  const hash = bcrypt.hashSync(password, 10);
  if (existing) {
    await run('UPDATE users SET username=$1, password_hash=$2 WHERE id=$3', [username, hash, existing.id]);
  } else {
    await run('INSERT INTO users (email, username, password_hash) VALUES ($1,$2,$3)', [email, username, hash]);
  }

  let code;
  try {
    code = await createAndSendCode(email, 'verify');
  } catch (e) {
    console.error('Email send failed:', e.message);
    return res.status(502).json({ error: 'Failed to send verification email, please try again later' });
  }
  res.json({
    message: 'Verification code sent to your email',
    ...(isDevMail() ? { devCode: code, devNote: 'Dev mode: code is also printed in the backend log' } : {}),
  });
});

// POST /api/auth/verify  { email, code }
router.post('/verify', async (req, res) => {
  const { email, code } = req.body || {};
  if (!email || !code) return res.status(400).json({ error: 'Missing email / code' });
  if (!(await consumeCode(email, code, 'verify')))
    return res.status(400).json({ error: 'Invalid or expired code' });

  const user = await one('SELECT * FROM users WHERE email=$1', [email]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  await run('UPDATE users SET verified=TRUE WHERE id=$1', [user.id]);
  user.verified = true;

  res.json({ token: issueToken(user), user: publicUser(user) });
});

// POST /api/auth/login  { email, password }
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = await one('SELECT * FROM users WHERE email=$1', [email || '']);
  if (!user || !bcrypt.compareSync(password || '', user.password_hash))
    return res.status(401).json({ error: 'Incorrect email or password' });
  if (!user.verified)
    return res.status(403).json({ error: 'Email not verified, please verify first', needVerify: true });
  if (user.banned)
    return res.status(403).json({ error: 'This account has been suspended' });

  res.json({ token: issueToken(user), user: publicUser(user) });
});

// POST /api/auth/resend  { email }
router.post('/resend', async (req, res) => {
  const { email } = req.body || {};
  const user = await one('SELECT * FROM users WHERE email=$1', [email || '']);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const wait = await cooldownRemaining(email, 'verify');
  if (wait > 0) return res.status(429).json({ error: `Please wait ${wait}s before requesting another code` });
  let code;
  try {
    code = await createAndSendCode(email, 'verify');
  } catch (e) {
    console.error('Email send failed:', e.message);
    return res.status(502).json({ error: 'Failed to send verification email, please try again later' });
  }
  res.json({ message: 'Verification code resent', ...(isDevMail() ? { devCode: code } : {}) });
});

// POST /api/auth/forgot  { email } — request a password-reset code
router.post('/forgot', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Missing email' });
  const user = await one('SELECT * FROM users WHERE email=$1', [email]);
  // Always respond generically to avoid email enumeration.
  const generic = { message: 'If that email is registered, a reset code has been sent' };
  if (!user || !user.verified) return res.json(generic);
  const wait = await cooldownRemaining(email, 'reset');
  if (wait > 0) return res.status(429).json({ error: `Please wait ${wait}s before requesting another code` });
  let code;
  try {
    code = await createAndSendCode(email, 'reset');
  } catch (e) {
    console.error('Email send failed:', e.message);
    return res.status(502).json({ error: 'Failed to send reset email, please try again later' });
  }
  res.json({ ...generic, ...(isDevMail() ? { devCode: code } : {}) });
});

// POST /api/auth/reset  { email, code, password } — set a new password
router.post('/reset', async (req, res) => {
  const { email, code, password } = req.body || {};
  if (!email || !code || !password)
    return res.status(400).json({ error: 'Missing email / code / password' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (!(await consumeCode(email, code, 'reset')))
    return res.status(400).json({ error: 'Invalid or expired code' });

  const user = await one('SELECT * FROM users WHERE email=$1', [email]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  await run('UPDATE users SET password_hash=$1, verified=TRUE WHERE id=$2',
    [bcrypt.hashSync(password, 10), user.id]);
  user.verified = true;
  res.json({ token: issueToken(user), user: publicUser(user) });
});

// Middleware
export function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Login required' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired, please log in again' });
  }
}

// Sets req.user if a valid token is present, but does not require one.
export function optionalAuth(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (token) { try { req.user = jwt.verify(token, JWT_SECRET); } catch { /* ignore */ } }
  next();
}

// Admin guard: valid token + role=admin + not banned (fresh DB check).
export function requireAdmin(req, res, next) {
  requireAuth(req, res, async () => {
    const u = await one('SELECT id, role, banned FROM users WHERE id=$1', [req.user.id]);
    if (!u || u.role !== 'admin' || u.banned)
      return res.status(403).json({ error: 'Admin access required' });
    next();
  });
}

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
