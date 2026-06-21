import pg from 'pg';

// Connection. On Railway use the internal DATABASE_URL (no SSL); for an
// external/public Postgres that requires TLS, set DATABASE_SSL=true.
const connectionString =
  process.env.DATABASE_URL ||
  'postgres://hoop:hoop@localhost:5432/ballradar';

const pool = new pg.Pool({
  connectionString,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

// Thin helpers so route code stays compact.
export function query(text, params) {
  return pool.query(text, params);
}
export async function one(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] || null;
}
export async function all(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}
export async function run(text, params) {
  return pool.query(text, params); // use result.rowCount / result.rows
}

// Create schema if missing (safe to run on every boot).
export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      verified BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS email_codes (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT 'verify',  -- verify | reset
      expires_at BIGINT NOT NULL,              -- epoch ms
      used BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS courts (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      address TEXT DEFAULT '',
      indoor BOOLEAN NOT NULL DEFAULT FALSE,
      hoops INTEGER DEFAULT 2,
      surface TEXT DEFAULT '',
      lighting BOOLEAN NOT NULL DEFAULT FALSE,
      free BOOLEAN NOT NULL DEFAULT TRUE,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id SERIAL PRIMARY KEY,
      court_id INTEGER NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',                  -- JSON array of strings
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (court_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS photos (
      id SERIAL PRIMARY KEY,
      court_id INTEGER NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Photo bytes live in the DB so uploads are shared across dev + prod
    -- (and survive Railway redeploys). Existing rows keep data = NULL.
    ALTER TABLE photos ADD COLUMN IF NOT EXISTS data BYTEA;
    ALTER TABLE photos ADD COLUMN IF NOT EXISTS mime TEXT;

    -- amenities (added to existing courts table on boot)
    ALTER TABLE courts ADD COLUMN IF NOT EXISTS water    BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE courts ADD COLUMN IF NOT EXISTS toilets  BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE courts ADD COLUMN IF NOT EXISTS parking  BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE courts ADD COLUMN IF NOT EXISTS shade    BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE courts ADD COLUMN IF NOT EXISTS fenced   BOOLEAN NOT NULL DEFAULT FALSE;

    -- follow graph
    CREATE TABLE IF NOT EXISTS follows (
      follower_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (follower_id, following_id)
    );

    -- problem reports (broken hoop, locked gate, etc.)
    CREATE TABLE IF NOT EXISTS reports (
      id SERIAL PRIMARY KEY,
      court_id INTEGER NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'other',
      note TEXT DEFAULT '',
      resolved BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- admin role + moderation flags
    ALTER TABLE users ADD COLUMN IF NOT EXISTS role   TEXT    NOT NULL DEFAULT 'user';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT FALSE;

    -- guest contributions: courts/reviews can be created without an account (nickname only)
    ALTER TABLE courts  ADD COLUMN IF NOT EXISTS guest_name TEXT;
    ALTER TABLE reviews ADD COLUMN IF NOT EXISTS guest_name TEXT;
    ALTER TABLE reviews ALTER COLUMN user_id DROP NOT NULL;

    -- admin audit trail
    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      admin_name TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      detail TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

export default pool;
