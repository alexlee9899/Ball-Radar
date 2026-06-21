import 'dotenv/config'; // load backend/.env before anything reads process.env
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import authRouter, { syncAdmins } from './auth.js';
import courtsRouter, { uploadsDir, servePhoto } from './courts.js';
import usersRouter from './users.js';
import adminRouter from './admin.js';
import { initDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;

app.set('trust proxy', 1); // correct client IP behind a proxy (rate limiting)
// CORS: allow all by default; set CORS_ORIGIN (comma-separated) to lock to your frontend domain(s).
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
  : true;
app.use(cors({ origin: corsOrigins }));
app.use(express.json());
app.get('/uploads/:filename', servePhoto);        // photo bytes from the DB (shared dev+prod)
app.use('/uploads', express.static(uploadsDir));  // legacy on-disk fallback

// Rate limiting on auth endpoints (anti brute-force / code spamming)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'Ball Radar API' }));
app.use('/api/auth', authLimiter, authRouter);
app.use('/api/courts', courtsRouter);
app.use('/api/users', usersRouter);
app.use('/api/admin', adminRouter);

// Serve the built frontend in production (single-service deploy).
// FRONTEND_DIST defaults to ../public, where the Docker image copies the Vite build.
const frontendDist = process.env.FRONTEND_DIST || path.join(__dirname, '..', 'public');
if (fs.existsSync(path.join(frontendDist, 'index.html'))) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
  console.log(`   Serving frontend static files: ${frontendDist}`);
}

// error handler (multer etc.)
app.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message || 'Request failed' });
});

// Ensure schema exists before accepting traffic. Seed data is NOT auto-inserted
// anymore (prod already has it); bootstrap an empty DB manually with `npm run seed`.
initDb()
  .then(() => syncAdmins())
  .catch((err) => console.error('Database init failed:', err))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`🏀 Ball Radar API running at http://localhost:${PORT}`);
      console.log(`   Email mode: ${process.env.EMAIL_MODE === 'smtp' ? 'SMTP (real send)' : 'DEV (code printed in this log)'}`);
    });
  });
