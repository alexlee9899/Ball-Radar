import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { one, all, run } from './db.js';
import { requireAdmin } from './auth.js';
import { uploadsDir } from './courts.js';

const router = Router();
router.use(requireAdmin);

async function audit(req, action, targetType, targetId, detail = '') {
  try {
    await run(
      `INSERT INTO audit_logs (admin_id, admin_name, action, target_type, target_id, detail)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.user.id, req.user.username, action, targetType, String(targetId ?? ''), detail]
    );
  } catch { /* never block on audit failure */ }
}
const n = async (sql) => Number((await one(sql)).n);

// GET /api/admin/overview — dashboard metrics
router.get('/overview', async (_req, res) => {
  const counts = {
    users: await n('SELECT COUNT(*) n FROM users'),
    admins: await n("SELECT COUNT(*) n FROM users WHERE role='admin'"),
    banned: await n('SELECT COUNT(*) n FROM users WHERE banned=TRUE'),
    courts: await n('SELECT COUNT(*) n FROM courts'),
    reviews: await n('SELECT COUNT(*) n FROM reviews'),
    photos: await n('SELECT COUNT(*) n FROM photos'),
    openReports: await n('SELECT COUNT(*) n FROM reports WHERE resolved=FALSE'),
  };
  const recentUsers = await all(
    'SELECT id, username, email, role, banned, verified, created_at FROM users ORDER BY id DESC LIMIT 6'
  );
  const recentCourts = await all(
    `SELECT c.id, c.name, c.indoor, c.created_at, u.username AS creator
       FROM courts c LEFT JOIN users u ON u.id=c.created_by ORDER BY c.id DESC LIMIT 6`
  );
  const signups = await all(
    `SELECT to_char(d::date,'MM-DD') AS day,
       (SELECT COUNT(*) FROM users WHERE created_at::date = d::date) AS count
       FROM generate_series(now()::date - interval '13 days', now()::date, interval '1 day') d
       ORDER BY d`
  );
  res.json({ counts, recentUsers, recentCourts, signups: signups.map((s) => ({ day: s.day, count: Number(s.count) })) });
});

// ---------- Reports ----------
router.get('/reports', async (req, res) => {
  const openOnly = req.query.status !== 'all';
  const rows = await all(
    `SELECT r.*, c.name AS court_name, u.username FROM reports r
       JOIN courts c ON c.id=r.court_id JOIN users u ON u.id=r.user_id
       ${openOnly ? 'WHERE r.resolved=FALSE' : ''} ORDER BY r.resolved ASC, r.id DESC LIMIT 300`
  );
  res.json({ reports: rows });
});
router.post('/reports/:id/resolve', async (req, res) => {
  const r = await run('UPDATE reports SET resolved=TRUE WHERE id=$1', [req.params.id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Report not found' });
  await audit(req, 'resolve_report', 'report', req.params.id);
  res.json({ message: 'Resolved' });
});
router.delete('/reports/:id', async (req, res) => {
  await run('DELETE FROM reports WHERE id=$1', [req.params.id]);
  await audit(req, 'delete_report', 'report', req.params.id);
  res.json({ message: 'Deleted' });
});

// ---------- Courts ----------
router.get('/courts', async (req, res) => {
  const q = `%${(req.query.q || '').toLowerCase()}%`;
  const rows = await all(
    `SELECT c.id, c.name, c.address, c.indoor, c.lat, c.lng, c.created_at, u.username AS creator,
       (SELECT COUNT(*) FROM reviews r WHERE r.court_id=c.id) AS reviews,
       (SELECT COUNT(*) FROM photos p WHERE p.court_id=c.id) AS photos,
       (SELECT ROUND(AVG(rating)::numeric,1) FROM reviews r WHERE r.court_id=c.id) AS rating
       FROM courts c LEFT JOIN users u ON u.id=c.created_by
       WHERE lower(c.name) LIKE $1 OR lower(c.address) LIKE $1
       ORDER BY c.id DESC LIMIT 200`,
    [q]
  );
  res.json({ courts: rows });
});
router.delete('/courts/:id', async (req, res) => {
  const files = await all('SELECT filename FROM photos WHERE court_id=$1', [req.params.id]);
  for (const f of files) { try { fs.unlinkSync(path.join(uploadsDir, f.filename)); } catch {} }
  const r = await run('DELETE FROM courts WHERE id=$1', [req.params.id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Court not found' });
  await audit(req, 'delete_court', 'court', req.params.id);
  res.json({ message: 'Court deleted' });
});
router.put('/courts/:id', async (req, res) => {
  const c = await one('SELECT * FROM courts WHERE id=$1', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Court not found' });
  const b = req.body || {};
  const row = await one(
    `UPDATE courts SET name=$1, description=$2, address=$3, indoor=$4, lighting=$5, free=$6
       WHERE id=$7 RETURNING id`,
    [b.name ?? c.name, b.description ?? c.description, b.address ?? c.address,
      b.indoor != null ? !!b.indoor : c.indoor, b.lighting != null ? !!b.lighting : c.lighting,
      b.free != null ? !!b.free : c.free, c.id]
  );
  await audit(req, 'edit_court', 'court', req.params.id);
  res.json({ ok: true, id: row.id });
});

// ---------- Reviews ----------
router.get('/reviews', async (req, res) => {
  const q = `%${(req.query.q || '').toLowerCase()}%`;
  const rows = await all(
    `SELECT r.id, r.rating, r.comment, r.created_at, u.username, c.id AS court_id, c.name AS court_name
       FROM reviews r JOIN users u ON u.id=r.user_id JOIN courts c ON c.id=r.court_id
       WHERE lower(r.comment) LIKE $1 OR lower(u.username) LIKE $1 OR lower(c.name) LIKE $1
       ORDER BY r.id DESC LIMIT 200`,
    [q]
  );
  res.json({ reviews: rows });
});
router.delete('/reviews/:id', async (req, res) => {
  const r = await run('DELETE FROM reviews WHERE id=$1', [req.params.id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Review not found' });
  await audit(req, 'delete_review', 'review', req.params.id);
  res.json({ message: 'Review deleted' });
});

// ---------- Photos ----------
router.get('/photos', async (_req, res) => {
  const rows = (await all(
    `SELECT p.id, p.filename, p.created_at, u.username, c.id AS court_id, c.name AS court_name
       FROM photos p JOIN users u ON u.id=p.user_id JOIN courts c ON c.id=p.court_id
       ORDER BY p.id DESC LIMIT 120`
  )).map((p) => ({ ...p, url: `/uploads/${p.filename}` }));
  res.json({ photos: rows });
});
router.delete('/photos/:id', async (req, res) => {
  const p = await one('SELECT * FROM photos WHERE id=$1', [req.params.id]);
  if (!p) return res.status(404).json({ error: 'Photo not found' });
  try { fs.unlinkSync(path.join(uploadsDir, p.filename)); } catch {}
  await run('DELETE FROM photos WHERE id=$1', [p.id]);
  await audit(req, 'delete_photo', 'photo', req.params.id);
  res.json({ message: 'Photo deleted' });
});

// ---------- Users ----------
router.get('/users', async (req, res) => {
  const q = `%${(req.query.q || '').toLowerCase()}%`;
  const rows = await all(
    `SELECT u.id, u.username, u.email, u.role, u.banned, u.verified, u.created_at,
       (SELECT COUNT(*) FROM courts c WHERE c.created_by=u.id) AS courts,
       (SELECT COUNT(*) FROM reviews r WHERE r.user_id=u.id) AS reviews
       FROM users u
       WHERE lower(u.username) LIKE $1 OR lower(u.email) LIKE $1
       ORDER BY u.id DESC LIMIT 200`,
    [q]
  );
  res.json({ users: rows });
});
router.post('/users/:id/role', async (req, res) => {
  const id = Number(req.params.id);
  const role = req.body?.role === 'admin' ? 'admin' : 'user';
  if (id === req.user.id && role !== 'admin')
    return res.status(400).json({ error: 'You cannot remove your own admin role' });
  const r = await run('UPDATE users SET role=$1 WHERE id=$2', [role, id]);
  if (!r.rowCount) return res.status(404).json({ error: 'User not found' });
  await audit(req, 'set_role', 'user', id, role);
  res.json({ message: `Role set to ${role}` });
});
router.post('/users/:id/ban', async (req, res) => {
  const id = Number(req.params.id);
  const banned = !!req.body?.banned;
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot ban yourself' });
  const target = await one('SELECT role FROM users WHERE id=$1', [id]);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.role === 'admin' && banned) return res.status(400).json({ error: 'Demote the admin before banning' });
  await run('UPDATE users SET banned=$1 WHERE id=$2', [banned, id]);
  await audit(req, banned ? 'ban_user' : 'unban_user', 'user', id);
  res.json({ message: banned ? 'User banned' : 'User unbanned' });
});
router.delete('/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot delete yourself' });
  const target = await one('SELECT role FROM users WHERE id=$1', [id]);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.role === 'admin') return res.status(400).json({ error: 'Demote the admin before deleting' });
  await run('DELETE FROM users WHERE id=$1', [id]);
  await audit(req, 'delete_user', 'user', id);
  res.json({ message: 'User deleted' });
});

// ---------- Audit log ----------
router.get('/audit', async (_req, res) => {
  const rows = await all('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200');
  res.json({ logs: rows });
});

export default router;
