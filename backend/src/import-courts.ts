import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import pool, { initDb, one, run } from './db.js';

// Load env from backend/.env AND the repo-root .env, so the Google key is found no
// matter which directory this is run from (the browser key lives in the root .env).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config();                                                     // process.cwd()/.env
dotenv.config({ path: path.join(__dirname, '..', '.env') });        // backend/.env
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });  // repo-root .env

// One-off importer: pulls real Sydney basketball courts from the Google Places
// API (Text Search) and inserts them with real coordinates. Idempotent — skips
// courts that already exist near the same spot.
//
// Run (locally against your DB):
//   DATABASE_URL=... GOOGLE_MAPS_API_KEY=... node src/import-courts.js 100
// Or inside the Docker backend / Railway where DATABASE_URL is already set.

const KEY = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY;
const TARGET = Number(process.argv[2] || 100);

// Greater Sydney bounding box (matches the backend's validation).
const BBOX = { south: -34.4, north: -33.3, west: 150.4, east: 151.7 };
const inSydney = (lat, lng) =>
  lat >= BBOX.south && lat <= BBOX.north && lng >= BBOX.west && lng <= BBOX.east;

// Search centres covering Greater Sydney so we get broad coverage, not just the CBD.
const CENTRES = [
  [-33.8688, 151.2093], // CBD
  [-33.8915, 151.2767], // Bondi / Eastern beaches
  [-33.8983, 151.1784], // Inner West (Marrickville)
  [-33.8820, 151.2300], // Eastern suburbs (Paddington)
  [-33.8400, 151.2100], // Lower North Shore
  [-33.7700, 151.2760], // Northern Beaches (Manly/Dee Why)
  [-33.8150, 151.0030], // Parramatta
  [-33.7510, 150.9090], // Blacktown
  [-33.9200, 150.9230], // Liverpool
  [-33.9170, 151.0350], // Bankstown
  [-34.0480, 151.1430], // Sutherland Shire
  [-33.7340, 151.0500], // Hills (Castle Hill)
  [-33.8130, 151.1780], // Ryde
  [-33.7040, 151.1000], // Hornsby
  [-33.7510, 150.6940], // Penrith
  [-34.0730, 150.8140], // Campbelltown / Macarthur
  [-33.9700, 150.8560], // Camden / Narellan
  [-33.8330, 151.0690], // Sydney Olympic Park / Homebush
];

const INDOOR_RE = /indoor|centre|center|stadium|pcyc|ymca|recreation|leisure|arena|sports complex|gym|aquatic/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function textSearch(params) {
  const u = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  u.searchParams.set("key", KEY as string);
  const res = await fetch(u);
  return res.json();
}

async function collect() {
  const byId = new Map();
  for (const [lat, lng] of CENTRES) {
    let token = null, page = 0;
    do {
      let data;
      if (!token) {
        data = await textSearch({ query: 'basketball court', location: `${lat},${lng}`, radius: '9000' });
        // A failed first page is a real problem (bad key, API disabled, billing, etc.).
        if (data.status && !['OK', 'ZERO_RESULTS'].includes(data.status)) {
          throw new Error(`Places API: ${data.status} ${data.error_message || ''}`);
        }
      } else {
        // Next-page requests must send ONLY the page token, and the token needs a
        // moment to activate — retry a few times on INVALID_REQUEST, then give up on
        // this zone's extra pages (not the whole import).
        let tries = 0;
        do {
          await sleep(2000 + tries * 1500);
          data = await textSearch({ pagetoken: token });
          tries++;
        } while (data.status === 'INVALID_REQUEST' && tries < 4);
        if (data.status && !['OK', 'ZERO_RESULTS'].includes(data.status)) break;
      }
      for (const r of data.results || []) {
        const loc = r.geometry?.location;
        if (!loc || !inSydney(loc.lat, loc.lng)) continue;
        if (!byId.has(r.place_id)) {
          byId.set(r.place_id, {
            name: r.name,
            address: r.formatted_address || '',
            lat: loc.lat, lng: loc.lng,
            indoor: INDOOR_RE.test(`${r.name} ${r.formatted_address || ''}`),
          });
        }
      }
      token = data.next_page_token || null;
      page++;
    } while (token && page < 3);
    process.stdout.write(`  scanned centre ${lat},${lng} — total unique so far: ${byId.size}\n`);
    if (byId.size >= TARGET * 1.5) break; // plenty; stop early
  }
  return Array.from(byId.values());
}

async function systemUserId() {
  let sys = await one("SELECT id FROM users WHERE email='system@ballradar.local'");
  if (!sys) {
    sys = await one(
      `INSERT INTO users (email, username, password_hash, verified)
         VALUES ($1,$2,$3,TRUE) RETURNING id`,
      ['system@ballradar.local', 'Ball Radar', bcrypt.hashSync(Math.random().toString(36), 10)]
    );
  }
  return sys.id;
}

async function main() {
  if (!KEY) throw new Error('Set GOOGLE_MAPS_API_KEY (a key with Places API enabled, no HTTP-referrer restriction).');
  await initDb();
  const sysId = await systemUserId();

  console.log('Searching Google Places across Greater Sydney…');
  const found = await collect();
  console.log(`Found ${found.length} unique courts. Inserting up to ${TARGET}…`);

  let inserted = 0;
  for (const c of found) {
    if (inserted >= TARGET) break;
    // skip near-duplicates (same name within ~120m)
    const dup = await one(
      'SELECT 1 FROM courts WHERE lower(name)=lower($1) AND abs(lat-$2)<0.0012 AND abs(lng-$3)<0.0012',
      [c.name, c.lat, c.lng]
    );
    if (dup) continue;
    await run(
      `INSERT INTO courts (name, description, lat, lng, address, indoor, hoops, surface, lighting, free, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [c.name, '', c.lat, c.lng, c.address, c.indoor, 2, '', false, true, sysId]
    );
    inserted++;
  }

  const total = Number((await one('SELECT COUNT(*) n FROM courts')).n);
  console.log(`✅ Inserted ${inserted} new courts. Courts table now has ${total} rows.`);
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => { console.error('Import failed:', err.message); process.exit(1); });
