import 'dotenv/config';
import bcrypt from 'bcryptjs';
import pool, { initDb, one, run } from './db.js';

// Well-known Sydney outdoor/indoor courts. Coordinates are approximate.
export const COURTS = [
  {
    name: 'Bradfield Park Court (Kirribilli)',
    description: 'Iconic court right under the Harbour Bridge with the Opera House behind it — the most photogenic outdoor court in Sydney. Busy on weekends, single half-court.',
    lat: -33.8474, lng: 151.2107,
    address: 'Bradfield Park, Milsons Point NSW 2061',
    indoor: false, hoops: 2, surface: 'Hard court (acrylic)', lighting: true, free: true,
  },
  {
    name: 'Victoria Park Courts (Camperdown)',
    description: 'Next to the University of Sydney. Two full courts, fresh surface and good vibe; quality pickup games most evenings.',
    lat: -33.8873, lng: 151.1916,
    address: 'Victoria Park, City Rd, Camperdown NSW 2050',
    indoor: false, hoops: 4, surface: 'Hard court (acrylic)', lighting: true, free: true,
  },
  {
    name: 'Prince Alfred Park Court (Surry Hills)',
    description: 'Outdoor full court beside Central Station. Easy to reach, lit at night, busy after work.',
    lat: -33.8857, lng: 151.2065,
    address: 'Prince Alfred Park, Chalmers St, Surry Hills NSW 2010',
    indoor: false, hoops: 2, surface: 'Hard court', lighting: true, free: true,
  },
  {
    name: 'Cook + Phillip Park Aquatic Centre (Indoor)',
    description: 'City-centre indoor hardwood court. Paid / bookable, the go-to on rainy days, decent standard of play.',
    lat: -33.8732, lng: 151.2133,
    address: '4 College St, Sydney NSW 2000',
    indoor: true, hoops: 2, surface: 'Indoor hardwood', lighting: true, free: false,
  },
  {
    name: 'Alexandria Park Courts',
    description: 'Inner-south community courts. Flat surface, quiet on weekdays (good for practice), regular runs on weekends.',
    lat: -33.9024, lng: 151.1953,
    address: 'Alexandria Park, Power Ave, Alexandria NSW 2015',
    indoor: false, hoops: 4, surface: 'Hard court', lighting: true, free: true,
  },
  {
    name: 'Rushcutters Bay Park Court',
    description: 'Half court by the bay with great views — good for relaxed shooting, not for full-court games.',
    lat: -33.8746, lng: 151.2300,
    address: 'Rushcutters Bay Park, Darling Point NSW 2027',
    indoor: false, hoops: 1, surface: 'Hard court', lighting: false, free: true,
  },
  {
    name: 'Bondi Beach Courts',
    description: 'Outdoor courts beside Bondi Beach. Sea breeze, lots of tourists, casual atmosphere.',
    lat: -33.8920, lng: 151.2772,
    address: 'Queen Elizabeth Dr, Bondi Beach NSW 2026',
    indoor: false, hoops: 2, surface: 'Hard court', lighting: false, free: true,
  },
  {
    name: 'Perry Park Recreation Centre (Indoor)',
    description: 'New indoor venue in Alexandria. Full hardwood court, bookable online, top-tier facilities.',
    lat: -33.9067, lng: 151.1972,
    address: '2A Maddox St, Alexandria NSW 2015',
    indoor: true, hoops: 2, surface: 'Indoor hardwood', lighting: true, free: false,
  },
];

// Idempotent: only seeds when the courts table is empty.
export async function seedCourts() {
  await initDb();
  const { count } = await one('SELECT COUNT(*)::int AS count FROM courts');
  if (count > 0) {
    console.log(`${count} courts already exist, skipping seed.`);
    return;
  }

  let sys = await one("SELECT * FROM users WHERE email='system@ballradar.local'");
  if (!sys) {
    sys = await one(
      `INSERT INTO users (email, username, password_hash, verified)
         VALUES ($1,$2,$3,TRUE) RETURNING id`,
      ['system@ballradar.local', 'Ball Radar', bcrypt.hashSync(Math.random().toString(36), 10)]
    );
  }

  for (const c of COURTS) {
    await run(
      `INSERT INTO courts (name, description, lat, lng, address, indoor, hoops, surface, lighting, free, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [c.name, c.description, c.lat, c.lng, c.address, c.indoor, c.hoops, c.surface, c.lighting, c.free, sys.id]
    );
  }
  console.log(`Seeded ${COURTS.length} Sydney courts.`);
}

// Allow running directly: `npm run seed`
if (import.meta.url === `file://${process.argv[1]}`) {
  seedCourts()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => { console.error(err); process.exit(1); });
}
