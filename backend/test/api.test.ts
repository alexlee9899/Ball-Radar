import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';

// Unique suffix so reruns against a persistent DB don't collide on unique keys.
const uniq = Date.now();
const user = {
  email: `tester_${uniq}@example.com`,
  username: `tester_${uniq}`,
  password: 'hunter2',
};
let token = '';

// Register → verify (using the dev code echoed back) → returns a JWT.
async function makeVerifiedUser() {
  const reg = await request(app).post('/api/auth/register').send(user);
  expect(reg.status).toBe(200);
  expect(reg.body.devCode).toBeTruthy();
  const ver = await request(app)
    .post('/api/auth/verify')
    .send({ email: user.email, code: reg.body.devCode });
  expect(ver.status).toBe(200);
  return ver.body.token as string;
}

describe('health', () => {
  it('reports ok and echoes a correlation id', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});

describe('auth', () => {
  beforeAll(async () => {
    token = await makeVerifiedUser();
  });

  it('issues a token on verify', () => {
    expect(token.split('.')).toHaveLength(3); // JWT header.payload.signature
  });

  it('rejects login with a wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('logs in a verified user', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe(user.email);
  });

  it('returns the current user from /me with a bearer token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe(user.username);
  });

  it('rejects /me without a token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('courts', () => {
  let courtId = 0;

  it('lists courts', async () => {
    const res = await request(app).get('/api/courts');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.courts)).toBe(true);
  });

  it('lets a guest add a court with a nickname', async () => {
    const res = await request(app).post('/api/courts').send({
      name: `Test Court ${uniq}`,
      lat: -33.87,
      lng: 151.21,
      address: 'Sydney CBD',
      indoor: false,
      guestName: 'Guest Hooper',
    });
    expect(res.status).toBe(201);
    expect(res.body.court.name).toBe(`Test Court ${uniq}`);
    courtId = res.body.court.id;
    expect(courtId).toBeGreaterThan(0);

    // `creator` is computed via a JOIN, so it surfaces on the detail endpoint.
    const detail = await request(app).get(`/api/courts/${courtId}`);
    expect(detail.body.court.creator).toBe('Guest Hooper');
  });

  it('rejects a court outside Greater Sydney', async () => {
    const res = await request(app).post('/api/courts').send({
      name: 'Far Away',
      lat: 0,
      lng: 0,
      guestName: 'Guest',
    });
    expect(res.status).toBe(400);
  });

  it('rejects a court with no auth and no nickname', async () => {
    const res = await request(app)
      .post('/api/courts')
      .send({ name: 'Anon', lat: -33.87, lng: 151.21 });
    expect(res.status).toBe(401);
  });

  it('accepts a review and reflects it in the average', async () => {
    const res = await request(app)
      .post(`/api/courts/${courtId}/reviews`)
      .set('Authorization', `Bearer ${token}`)
      .send({ rating: 4, comment: 'Solid rims', tags: ['good-hoops'] });
    expect(res.status).toBeLessThan(300);

    const detail = await request(app).get(`/api/courts/${courtId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.court.avgRating).toBe(4);
    expect(detail.body.court.reviewCount).toBe(1);
  });
});

describe('nearby (geospatial)', () => {
  beforeAll(async () => {
    // A court near the CBD reference point so the radius query returns it.
    await request(app).post('/api/courts').send({
      name: `Nearby Court ${uniq}`,
      lat: -33.8688,
      lng: 151.2093,
      guestName: 'Geo Guest',
    });
  });

  it('400s without coordinates', async () => {
    const res = await request(app).get('/api/courts/nearby');
    expect(res.status).toBe(400);
  });

  it('returns courts sorted by distance with an engine label', async () => {
    const res = await request(app)
      .get('/api/courts/nearby')
      .query({ lat: -33.8688, lng: 151.2093, radius: 5000 });
    expect(res.status).toBe(200);
    expect(['postgis', 'haversine']).toContain(res.body.engine);
    expect(res.body.courts.length).toBeGreaterThan(0);
    expect(res.body.courts[0]).toHaveProperty('distanceM');
    // Sorted ascending by distance.
    const ds = res.body.courts.map((c: any) => c.distanceM);
    expect(ds).toEqual([...ds].sort((a, b) => a - b));
  });
});

describe('admin guard', () => {
  it('blocks a non-admin user from the admin API', async () => {
    const res = await request(app)
      .get('/api/admin/overview')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('blocks anonymous access to the admin API', async () => {
    const res = await request(app).get('/api/admin/overview');
    expect(res.status).toBe(401);
  });
});
