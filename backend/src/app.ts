import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'crypto';
import * as Sentry from '@sentry/node';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import authRouter from './auth.js';
import courtsRouter, { uploadsDir, servePhoto } from './courts.js';
import usersRouter from './users.js';
import adminRouter from './admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Error tracking (no-op unless SENTRY_DSN is set).
if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV || 'development' });
}

export const app = express();

app.set('trust proxy', 1);

// Structured request logging with a correlation id (x-request-id, echoed back).
app.use(
  pinoHttp({
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
    genReqId: (req, res) => {
      const id = (req.headers['x-request-id'] as string) || randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    redact: ['req.headers.authorization', 'req.headers.cookie'],
    autoLogging: { ignore: (req) => req.url === '/api/health' },
  })
);

// CORS: allow all by default; set CORS_ORIGIN (comma-separated) to lock down.
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
  : true;
app.use(cors({ origin: corsOrigins }));
app.use(express.json());

app.get('/uploads/:filename', servePhoto);        // photo bytes from the DB
app.use('/uploads', express.static(uploadsDir));  // legacy on-disk fallback

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
const frontendDist = process.env.FRONTEND_DIST || path.join(__dirname, '..', 'public');
if (fs.existsSync(path.join(frontendDist, 'index.html'))) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// Error handler: log with the request id and report to Sentry.
app.use((err: any, req: any, res: any, _next: any) => {
  if (process.env.SENTRY_DSN) Sentry.captureException(err);
  req.log?.error({ err }, 'request error');
  res.status(err.status || 400).json({ error: err.message || 'Request failed', requestId: req.id });
});

export default app;
