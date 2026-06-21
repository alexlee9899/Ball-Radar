import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { one, all, run } from './db.js';
import { requireAuth, optionalAuth } from './auth.js';

// Resolve who is creating content: a logged-in user, or a guest with a nickname.
function contributor(req) {
  if (req.user) return { userId: req.user.id, guestName: null };
  const guestName = String(req.body?.guestName || '').trim().slice(0, 40);
  return { userId: null, guestName };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Configurable so Railway can point this at a persistent Volume mount.
export const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

// Photos are stored as bytes in Postgres (shared across dev + prod), so we keep the
// uploaded file in memory and write the buffer to the DB instead of to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpe?g|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image formats jpg/png/webp/gif are supported'));
  },
});

// Unique, safe stored name — also the DB lookup key and the public URL segment.
function makeFilename(originalname) {
  const ext = path.extname(originalname).toLowerCase() || '.jpg';
  return `court_${Date.now()}_${Math.round(Math.random() * 1e6)}${ext}`;
}

// Serve a photo's bytes straight from the DB. Falls through (next) to the static-disk
// handler in index.js for any legacy files uploaded before DB storage.
export async function servePhoto(req, res, next) {
  try {
    const row = await one('SELECT data, mime FROM photos WHERE filename=$1', [req.params.filename]);
    if (!row || !row.data) return next();
    res.setHeader('Content-Type', row.mime || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(row.data);
  } catch (err) {
    next(err);
  }
}

const router = Router();

async function courtWithStats(row) {
  const stats = await one(
    'SELECT AVG(rating) AS avg, COUNT(*) AS cnt FROM reviews WHERE court_id=$1', [row.id]
  );
  const photoRow = await one('SELECT COUNT(*) AS c FROM photos WHERE court_id=$1', [row.id]);
  const tagRows = await all('SELECT tags FROM reviews WHERE court_id=$1', [row.id]);
  const tagCount = {};
  for (const r of tagRows) {
    try {
      for (const t of JSON.parse(r.tags || '[]')) tagCount[t] = (tagCount[t] || 0) + 1;
    } catch {}
  }
  const topTags = Object.entries(tagCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t]) => t);
  return {
    ...row,
    indoor: !!row.indoor,
    lighting: !!row.lighting,
    free: !!row.free,
    avgRating: stats.avg != null ? Math.round(Number(stats.avg) * 10) / 10 : null,
    reviewCount: Number(stats.cnt),
    photoCount: Number(photoRow.c),
    topTags,
  };
}

// GET /api/courts — list all with stats
router.get('/', async (_req, res) => {
  const rows = await all(
    `SELECT c.*, COALESCE(u.username, c.guest_name) AS creator FROM courts c
       LEFT JOIN users u ON u.id = c.created_by ORDER BY c.id`
  );
  res.json({ courts: await Promise.all(rows.map(courtWithStats)) });
});

// GET /api/courts/:id — detail with reviews + photos
router.get('/:id', async (req, res) => {
  const row = await one(
    `SELECT c.*, COALESCE(u.username, c.guest_name) AS creator FROM courts c
       LEFT JOIN users u ON u.id = c.created_by WHERE c.id=$1`,
    [req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Court not found' });

  const reviews = (await all(
    `SELECT r.*, COALESCE(u.username, r.guest_name) AS username FROM reviews r
       LEFT JOIN users u ON u.id = r.user_id WHERE r.court_id=$1 ORDER BY r.id DESC`,
    [row.id]
  )).map((r) => ({ ...r, tags: JSON.parse(r.tags || '[]') }));

  const photos = (await all(
    `SELECT p.id, p.user_id, p.filename, p.created_at, u.username FROM photos p
       JOIN users u ON u.id = p.user_id WHERE p.court_id=$1 ORDER BY p.id DESC`,
    [row.id]
  )).map((p) => ({ ...p, url: `/uploads/${p.filename}` }));

  const reports = await all(
    `SELECT r.id, r.type, r.note, r.created_at, u.username FROM reports r
       JOIN users u ON u.id = r.user_id WHERE r.court_id=$1 AND r.resolved=FALSE ORDER BY r.id DESC`,
    [row.id]
  );

  res.json({ court: await courtWithStats(row), reviews, photos, reports });
});

// POST /api/courts — add a court (logged-in user OR guest with a nickname)
router.post('/', optionalAuth, async (req, res) => {
  const { name, description = '', lat, lng, address = '', indoor = false,
    hoops = 2, surface = '', lighting = false, free = true,
    water = false, toilets = false, parking = false, shade = false, fenced = false } = req.body || {};
  const { userId, guestName } = contributor(req);
  if (!userId && !guestName)
    return res.status(401).json({ error: 'Log in or enter a nickname to add a court' });
  if (!name || typeof lat !== 'number' || typeof lng !== 'number')
    return res.status(400).json({ error: 'Missing name / lat / lng' });
  if (lat < -34.4 || lat > -33.3 || lng < 150.4 || lng > 151.7)
    return res.status(400).json({ error: 'Coordinates are outside Greater Sydney' });

  const inserted = await one(
    `INSERT INTO courts (name, description, lat, lng, address, indoor, hoops, surface, lighting, free,
       water, toilets, parking, shade, fenced, created_by, guest_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
    [name, description, lat, lng, address, !!indoor, hoops, surface, !!lighting, !!free,
      !!water, !!toilets, !!parking, !!shade, !!fenced, userId, guestName]
  );
  res.status(201).json({ court: await courtWithStats(inserted) });
});

// PUT /api/courts/:id — edit a court (auth, creator only)
router.put('/:id', requireAuth, async (req, res) => {
  const court = await one('SELECT * FROM courts WHERE id=$1', [req.params.id]);
  if (!court) return res.status(404).json({ error: 'Court not found' });
  if (court.created_by !== req.user.id)
    return res.status(403).json({ error: 'You can only edit courts you added' });

  const b = req.body || {};
  const lat = b.lat != null ? b.lat : court.lat;
  const lng = b.lng != null ? b.lng : court.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number')
    return res.status(400).json({ error: 'lat / lng must be numbers' });
  if (lat < -34.4 || lat > -33.3 || lng < 150.4 || lng > 151.7)
    return res.status(400).json({ error: 'Coordinates are outside Greater Sydney' });

  const next = {
    name: b.name ?? court.name,
    description: b.description ?? court.description,
    address: b.address ?? court.address,
    surface: b.surface ?? court.surface,
    hoops: b.hoops ?? court.hoops,
    indoor: b.indoor != null ? !!b.indoor : court.indoor,
    lighting: b.lighting != null ? !!b.lighting : court.lighting,
    free: b.free != null ? !!b.free : court.free,
    water: b.water != null ? !!b.water : court.water,
    toilets: b.toilets != null ? !!b.toilets : court.toilets,
    parking: b.parking != null ? !!b.parking : court.parking,
    shade: b.shade != null ? !!b.shade : court.shade,
    fenced: b.fenced != null ? !!b.fenced : court.fenced,
    lat, lng,
  };
  if (!next.name) return res.status(400).json({ error: 'name cannot be empty' });

  const row = await one(
    `UPDATE courts SET name=$1, description=$2, address=$3, surface=$4, hoops=$5,
       indoor=$6, lighting=$7, free=$8, water=$9, toilets=$10, parking=$11, shade=$12, fenced=$13,
       lat=$14, lng=$15 WHERE id=$16 RETURNING *`,
    [next.name, next.description, next.address, next.surface, next.hoops,
      next.indoor, next.lighting, next.free, next.water, next.toilets, next.parking, next.shade, next.fenced,
      next.lat, next.lng, court.id]
  );
  res.json({ court: await courtWithStats(row) });
});

// DELETE /api/courts/:id — delete a court + its photo files (auth, creator only)
router.delete('/:id', requireAuth, async (req, res) => {
  const court = await one('SELECT * FROM courts WHERE id=$1', [req.params.id]);
  if (!court) return res.status(404).json({ error: 'Court not found' });
  if (court.created_by !== req.user.id)
    return res.status(403).json({ error: 'You can only delete courts you added' });

  const files = await all('SELECT filename FROM photos WHERE court_id=$1', [court.id]);
  for (const f of files) {
    try { fs.unlinkSync(path.join(uploadsDir, f.filename)); } catch {}
  }
  await run('DELETE FROM courts WHERE id=$1', [court.id]); // cascades reviews + photos
  res.json({ message: 'Court deleted' });
});

// POST /api/courts/:id/reviews — add/update review (logged-in user OR guest with a nickname)
router.post('/:id/reviews', optionalAuth, async (req, res) => {
  const court = await one('SELECT id FROM courts WHERE id=$1', [req.params.id]);
  if (!court) return res.status(404).json({ error: 'Court not found' });

  const { rating, comment = '', tags = [] } = req.body || {};
  const { userId, guestName } = contributor(req);
  if (!userId && !guestName)
    return res.status(401).json({ error: 'Log in or enter a nickname to review' });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    return res.status(400).json({ error: 'Rating must be an integer from 1 to 5' });
  if (!Array.isArray(tags)) return res.status(400).json({ error: 'tags must be an array' });
  const tagsJson = JSON.stringify(tags.slice(0, 8));

  if (userId) {
    // one review per user per court (upsert)
    await run(
      `INSERT INTO reviews (court_id, user_id, rating, comment, tags)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (court_id, user_id) DO UPDATE SET
           rating=EXCLUDED.rating, comment=EXCLUDED.comment, tags=EXCLUDED.tags, created_at=now()`,
      [court.id, userId, rating, comment, tagsJson]
    );
  } else {
    await run(
      `INSERT INTO reviews (court_id, user_id, rating, comment, tags, guest_name)
         VALUES ($1, NULL, $2, $3, $4, $5)`,
      [court.id, rating, comment, tagsJson, guestName]
    );
  }
  res.status(201).json({ message: 'Review submitted' });
});

// DELETE /api/courts/:id/reviews — delete own review (auth)
router.delete('/:id/reviews', requireAuth, async (req, res) => {
  const result = await run('DELETE FROM reviews WHERE court_id=$1 AND user_id=$2',
    [req.params.id, req.user.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'You have not reviewed this court yet' });
  res.json({ message: 'Review deleted' });
});

// POST /api/courts/:id/photos — upload photo (auth). Bytes are stored in the DB.
router.post('/:id/photos', requireAuth, upload.single('photo'), async (req, res) => {
  const court = await one('SELECT id FROM courts WHERE id=$1', [req.params.id]);
  if (!court) return res.status(404).json({ error: 'Court not found' });
  if (!req.file) return res.status(400).json({ error: 'Missing image file (field name: photo)' });

  const filename = makeFilename(req.file.originalname);
  await run('INSERT INTO photos (court_id, user_id, filename, data, mime) VALUES ($1,$2,$3,$4,$5)',
    [court.id, req.user.id, filename, req.file.buffer, req.file.mimetype]);
  res.status(201).json({ url: `/uploads/${filename}` });
});

// DELETE /api/courts/:id/photos/:photoId — delete a photo (auth, uploader or court creator)
router.delete('/:id/photos/:photoId', requireAuth, async (req, res) => {
  const photo = await one('SELECT * FROM photos WHERE id=$1 AND court_id=$2',
    [req.params.photoId, req.params.id]);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });
  const court = await one('SELECT created_by FROM courts WHERE id=$1', [req.params.id]);
  if (photo.user_id !== req.user.id && court?.created_by !== req.user.id)
    return res.status(403).json({ error: 'Not allowed to delete this photo' });

  try { fs.unlinkSync(path.join(uploadsDir, photo.filename)); } catch {}
  await run('DELETE FROM photos WHERE id=$1', [photo.id]);
  res.json({ message: 'Photo deleted' });
});

// POST /api/courts/:id/reports — report a problem (auth)
const REPORT_TYPES = ['broken_hoop', 'locked', 'surface', 'lighting', 'other'];
router.post('/:id/reports', requireAuth, async (req, res) => {
  const court = await one('SELECT id FROM courts WHERE id=$1', [req.params.id]);
  if (!court) return res.status(404).json({ error: 'Court not found' });
  const { type = 'other', note = '' } = req.body || {};
  const t = REPORT_TYPES.includes(type) ? type : 'other';
  await run('INSERT INTO reports (court_id, user_id, type, note) VALUES ($1,$2,$3,$4)',
    [court.id, req.user.id, t, String(note).slice(0, 300)]);
  res.status(201).json({ message: 'Report submitted' });
});

export default router;
