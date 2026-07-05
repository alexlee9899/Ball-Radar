// Vitest global setup. Runs (and is awaited) before any test module is imported,
// so DATABASE_URL is in place before db.ts evaluates its connection string.
//
// If DATABASE_URL is already set (e.g. GitHub Actions service container or a local
// `docker compose up db`), we use it as-is. Otherwise we spin up a throwaway
// embedded Postgres so `npm test` works with zero external dependencies.
import { afterAll } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.EMAIL_MODE = process.env.EMAIL_MODE || 'dev';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

let embedded: any = null;

if (!process.env.DATABASE_URL) {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const dataDir = mkdtempSync(join(tmpdir(), 'ballradar-pgtest-'));
  embedded = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'test',
    password: 'test',
    port: 54329,
    persistent: false,
  });
  await embedded.initialise();
  await embedded.start();
  await embedded.createDatabase('ballradar_test');
  process.env.DATABASE_URL = 'postgres://test:test@localhost:54329/ballradar_test';
}

// Import after DATABASE_URL is set, then build the schema.
const { initDb, initGeo, closePool } = await import('../src/db.js');
await initDb();
await initGeo(); // best-effort; falls back to haversine if PostGIS is absent

afterAll(async () => {
  await closePool().catch(() => {});
  if (embedded) await embedded.stop().catch(() => {});
});
