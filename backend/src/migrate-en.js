import 'dotenv/config';
import pool, { initDb, run } from './db.js';
import { COURTS } from './seed.js';

// One-time migration: update the original seed courts (which may still hold the
// old Chinese name/description) to their English versions. Matched by address,
// which is stable, so user-added courts are left untouched.
async function migrate() {
  await initDb();
  let updated = 0;
  for (const c of COURTS) {
    const result = await run(
      'UPDATE courts SET name=$1, description=$2, surface=$3 WHERE address=$4',
      [c.name, c.description, c.surface, c.address]
    );
    updated += result.rowCount;
  }
  console.log(`Updated ${updated} seed courts to English.`);
}

migrate()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
