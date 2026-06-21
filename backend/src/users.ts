import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { one, all, run } from './db.js';
import { requireAuth, JWT_SECRET } from './auth.js';

const router = Router();

// Read the user from a token if present, but don't require it.
function optionalUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET) as any; } catch { return null; }
}

function badgesFor(counts) {
  const b: string[] = [];
  if (counts.courts >= 1) b.push('🗺️ Mapper');
  if (counts.courts >= 5) b.push('🏟️ Local Legend');
  if (counts.reviews >= 3) b.push('✍️ Reviewer');
  if (counts.photos >= 3) b.push('📸 Photographer');
  return b;
}

// GET /api/users/leaderboard — top contributors (must be declared before /:id)
router.get('/leaderboard', async (_req, res) => {
  const rows = await all(`
    SELECT u.id, u.username,
      (SELECT COUNT(*) FROM courts c  WHERE c.created_by = u.id) AS courts,
      (SELECT COUNT(*) FROM reviews r WHERE r.user_id   = u.id) AS reviews,
      (SELECT COUNT(*) FROM photos p  WHERE p.user_id   = u.id) AS photos
    FROM users u
    WHERE u.verified = TRUE
  `);
  const leaderboard = rows
    .map((r) => {
      const counts = { courts: Number(r.courts), reviews: Number(r.reviews), photos: Number(r.photos) };
      return {
        id: r.id, username: r.username, ...counts,
        score: counts.courts * 3 + counts.reviews + counts.photos,
        badges: badgesFor(counts),
      };
    })
    .filter((u) => u.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
  res.json({ leaderboard });
});

// GET /api/users/:id — public profile + contributions
router.get('/:id', async (req, res) => {
  const me = optionalUser(req);
  const user = await one('SELECT id, username, created_at FROM users WHERE id=$1', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const n = async (sql) => Number((await one(sql, [user.id])).n);
  const counts = {
    courts: await n('SELECT COUNT(*) n FROM courts WHERE created_by=$1'),
    reviews: await n('SELECT COUNT(*) n FROM reviews WHERE user_id=$1'),
    photos: await n('SELECT COUNT(*) n FROM photos WHERE user_id=$1'),
    followers: await n('SELECT COUNT(*) n FROM follows WHERE following_id=$1'),
    following: await n('SELECT COUNT(*) n FROM follows WHERE follower_id=$1'),
  };

  const courts = await all(
    'SELECT id, name, indoor, lat, lng, created_at FROM courts WHERE created_by=$1 ORDER BY id DESC LIMIT 50',
    [user.id]
  );
  const reviews = await all(
    `SELECT r.id, r.rating, r.comment, r.created_at, c.id AS court_id, c.name AS court_name
       FROM reviews r JOIN courts c ON c.id = r.court_id
       WHERE r.user_id=$1 ORDER BY r.id DESC LIMIT 50`,
    [user.id]
  );
  const photos = (await all(
    `SELECT p.id, p.filename, p.court_id, c.name AS court_name
       FROM photos p JOIN courts c ON c.id = p.court_id
       WHERE p.user_id=$1 ORDER BY p.id DESC LIMIT 50`,
    [user.id]
  )).map((p) => ({ ...p, url: `/uploads/${p.filename}` }));

  let isFollowing = false;
  if (me && me.id !== user.id) {
    isFollowing = !!(await one(
      'SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=$2', [me.id, user.id]
    ));
  }

  res.json({
    user, counts, badges: badgesFor(counts),
    courts, reviews, photos,
    isFollowing, isMe: !!(me && me.id === user.id),
  });
});

// POST /api/users/:id/follow
router.post('/:id/follow', requireAuth, async (req, res) => {
  const target = Number(req.params.id);
  if (target === req.user!.id) return res.status(400).json({ error: 'You cannot follow yourself' });
  if (!(await one('SELECT 1 FROM users WHERE id=$1', [target])))
    return res.status(404).json({ error: 'User not found' });
  await run(
    'INSERT INTO follows (follower_id, following_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [req.user!.id, target]
  );
  res.json({ following: true });
});

// DELETE /api/users/:id/follow
router.delete('/:id/follow', requireAuth, async (req, res) => {
  await run('DELETE FROM follows WHERE follower_id=$1 AND following_id=$2',
    [req.user!.id, Number(req.params.id)]);
  res.json({ following: false });
});

export default router;
