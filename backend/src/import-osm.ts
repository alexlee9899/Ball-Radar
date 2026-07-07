import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import pool, { initDb, one, run } from './db.js';

// Load env from cwd, backend/.env and repo-root .env (DATABASE_URL etc.).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config();
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

// Importer that pulls REAL basketball courts from OpenStreetMap (Overpass API).
// Unlike the Google Places importer, this needs no API key. It targets the regions
// that were sparse on the map (Eastern/Botany + St George/Canterbury), but you can
// pass `all` to sweep all of Greater Sydney.
//
// Run against your DB:
//   docker compose exec backend npm run import:osm            # both sparse regions
//   docker compose exec backend npm run import:osm -- all     # all of Sydney
//   DATABASE_URL=... npm run import:osm                       # local/standalone

// [south, west, north, east]
type BBox = [number, number, number, number];

const REGIONS: Record<string, BBox> = {
  // Eastern beaches + Botany/Maroubra/Matraville/Malabar/Little Bay (screenshot 1)
  east: [-34.06, 151.18, -33.90, 151.27],
  // Inner-south / Canterbury-Bankstown / St George (screenshot 2)
  stgeorge: [-33.99, 151.06, -33.85, 151.17],
  // Whole Greater Sydney (matches backend validation bbox)
  all: [-34.4, 150.4, -33.3, 151.7],
};

const arg = (process.argv[2] || 'east+stgeorge').toLowerCase();
const selected: BBox[] =
  arg === 'all'
    ? [REGIONS.all]
    : arg.split('+').map((k) => REGIONS[k]).filter(Boolean);

if (!selected.length) {
  console.error(`Unknown region "${arg}". Use one of: east, stgeorge, all (or east+stgeorge).`);
  process.exit(1);
}

// Sydney sanity bounds (mirrors the backend's court validation).
const inSydney = (lat: number, lng: number) =>
  lat >= -34.4 && lat <= -33.3 && lng >= 150.4 && lng <= 151.7;

const INDOOR_RE = /indoor|centre|center|stadium|pcyc|ymca|recreation|leisure centre|arena|sports complex|gym|aquatic|pavilion/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

type Court = { name: string; lat: number; lng: number; address: string; indoor: boolean };

// Query Overpass for every basketball feature in a bbox (nodes, ways, relations).
async function overpass(bbox: BBox): Promise<any[]> {
  const [s, w, n, e] = bbox;
  const q = `[out:json][timeout:120];
    (
      nwr["sport"~"basketball"](${s},${w},${n},${e});
      nwr["leisure"="pitch"]["sport"~"basketball"](${s},${w},${n},${e});
    );
    out center tags;`;
  let lastErr: any;
  for (const url of OVERPASS_MIRRORS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'User-Agent': 'BallRadar/1.0 (court importer)' },
        body: q,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: any = await res.json();
      return data.elements || [];
    } catch (err: any) {
      lastErr = err;
      console.warn(`  overpass mirror failed (${url}): ${err.message} — trying next…`);
      await sleep(1500);
    }
  }
  throw new Error(`All Overpass mirrors failed: ${lastErr?.message}`);
}

// Reverse-geocode an unnamed court to a friendly "<Locality> Basketball Court".
// Nominatim asks for <=1 req/sec and a real User-Agent; we throttle in the caller.
async function localityName(lat: number, lng: number): Promise<string> {
  try {
    const u = new URL('https://nominatim.openstreetmap.org/reverse');
    u.searchParams.set('format', 'jsonv2');
    u.searchParams.set('lat', String(lat));
    u.searchParams.set('lon', String(lng));
    u.searchParams.set('zoom', '16');
    const res = await fetch(u, { headers: { 'User-Agent': 'BallRadar/1.0 (court importer)' } });
    const j: any = await res.json();
    const a = j.address || {};
    const spot = a.leisure || a.park || a.recreation_ground || a.neighbourhood ||
      a.suburb || a.village || a.town || a.city || '';
    return spot ? `${spot} Basketball Court` : 'Basketball Court';
  } catch {
    return 'Basketball Court';
  }
}

function isIndoor(tags: Record<string, string>): boolean {
  if (!tags) return false;
  if (tags.indoor === 'yes' || tags.covered === 'yes') return true;
  if (tags.leisure === 'sports_centre' || tags.building) return true;
  return INDOOR_RE.test(`${tags.name || ''} ${tags.leisure || ''} ${tags.amenity || ''}`);
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
  await initDb();
  const sysId = await systemUserId();

  console.log(`Searching OpenStreetMap for basketball courts in: ${arg}`);
  const raw: any[] = [];
  for (const bbox of selected) {
    const els = await overpass(bbox);
    console.log(`  bbox ${bbox.join(',')} → ${els.length} raw features`);
    raw.push(...els);
    await sleep(1200); // be polite between bbox queries
  }

  // Normalise + de-duplicate within the fetched set (by ~60m proximity).
  const courts: Court[] = [];
  for (const el of raw) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null || !inSydney(lat, lng)) continue;
    const tags = el.tags || {};
    if (courts.some((c) => Math.abs(c.lat - lat) < 0.0006 && Math.abs(c.lng - lng) < 0.0006)) continue;
    courts.push({
      name: (tags.name || '').trim(), // filled in below if empty
      lat, lng,
      address: [tags['addr:street'], tags['addr:suburb']].filter(Boolean).join(', '),
      indoor: isIndoor(tags),
    });
  }
  console.log(`Normalised to ${courts.length} unique courts. Naming unnamed ones…`);

  // Name the unnamed courts via reverse geocoding (throttled to ~1/sec).
  for (const c of courts) {
    if (!c.name) {
      c.name = await localityName(c.lat, c.lng);
      await sleep(1100);
    }
  }

  // Insert, skipping near-duplicates already in the DB (same spot within ~120m).
  let inserted = 0, skipped = 0;
  for (const c of courts) {
    const dup = await one(
      'SELECT 1 FROM courts WHERE abs(lat-$1)<0.0012 AND abs(lng-$2)<0.0012',
      [c.lat, c.lng]
    );
    if (dup) { skipped++; continue; }
    await run(
      `INSERT INTO courts (name, description, lat, lng, address, indoor, hoops, surface, lighting, free, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [c.name, 'Imported from OpenStreetMap.', c.lat, c.lng, c.address, c.indoor, 2, '', false, true, sysId]
    );
    inserted++;
  }

  const total = Number((await one('SELECT COUNT(*) n FROM courts')).n);
  console.log(`✅ Inserted ${inserted} new courts (${skipped} already existed). Courts table now has ${total} rows.`);
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => { console.error('Import failed:', err.message); process.exit(1); });
