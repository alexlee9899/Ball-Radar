# 🏀 Ball Radar

[![CI](https://github.com/alexlee9899/Ball-Radar/actions/workflows/ci.yml/badge.svg)](https://github.com/alexlee9899/Ball-Radar/actions/workflows/ci.yml)

**Find a hoop. Rate the vibe. Never show up to a locked gate again.**

Ball Radar is a court-sharing map for Sydney ballers. Drop pins on real courts, rate them, leave reviews, slap on tags like `Lights` or `Competitive`, and upload photos so the next person knows whether they're walking into a pristine hardwood floor or a rim with no net and a suspicious puddle. Think of it as Yelp, but exclusively for places to hoop — and with a cyberpunk paint job.

> Built for people whose group chat has said "anyone know a good court?" one too many times.

---

## ✨ What it does

- **📧 Email sign-up with a verification code** — because "trust me bro" is not an auth strategy. Passwords are bcrypt-hashed, sessions are JWT.
- **🔑 Forgot your password?** Reset it with an emailed code and you're back in. No tears.
- **🗺️ Google Maps with neon war-paint** — cyan pins for outdoor, magenta for indoor. Click one, get the whole story.
- **📍 "Nearby" button** — geolocates you and sorts courts by distance, so you stop driving 40 minutes to a half-court.
- **🏷️ Ratings, reviews & tags** — 1–5 stars, free-text opinions, and quick tags. One review per person per court (no ballot stuffing).
- **📸 Photo uploads** — show the court, not your imagination of it.
- **✏️ Add / edit / delete courts** — you made it, you own it. Delete it and the photos go too (no orphaned junk).
- **🔎 Search & filters** — by name, address, indoor/outdoor, free-only, has-lights, or distance.
- **☀️🌙 Day & Night themes** — neon cyberpunk after dark, soft black-and-white by day. Your retinas, your call.
- **🛡️ Actually-not-naive security** — rate-limited auth, a 60-second cooldown so nobody spams the code button.
- Ships pre-loaded with **8 legit Sydney courts** (yes, including the famous one under the Harbour Bridge).

---

## 🧰 Tech stack

- **Frontend:** React 18 + Vite + Google Maps JS API
- **Backend:** Node + Express + PostgreSQL (`pg`) + JWT + bcrypt + multer + nodemailer
- **Email:** Resend (over SMTP)
- **Ships in:** Docker, deploys to Railway

---

## 🚀 Quick start (Docker — zero Node drama)

You only need [Docker Desktop](https://www.docker.com/products/docker-desktop/). From the project root:

```bash
cp .env.example .env      # then drop in your Google Maps key
docker compose up --build
```

- Frontend → http://localhost:5173
- Backend  → http://localhost:4000

First boot installs everything and seeds the 8 starter courts automatically. Code changes hot-reload. Your data lives in named volumes, so a restart won't nuke it.

> ⚠️ The Google Maps key (`VITE_GOOGLE_MAPS_API_KEY`) goes in the **root** `.env`, and it's baked in at build time — change it and you'll need to recreate the frontend container:
> `docker compose up -d --force-recreate frontend`

No map showing up? That's almost always a missing/empty key. The app will literally tell you so.

---

## 🗝️ Google Maps key

1. [Google Cloud Console](https://console.cloud.google.com/) → create/select a project.
2. Enable **Maps JavaScript API** and **Geocoding API** (the latter powers "find by address").
3. Create an API key, restrict it to your domain (`http://localhost:5173/*` for local).
4. Paste it into `.env` as `VITE_GOOGLE_MAPS_API_KEY` and restart.

Without a key the court list and everything else still works — you just get a friendly "plug in a key" panel instead of a map.

---

## ☁️ Deploy to Railway

Single-service deploy is wired up (`Dockerfile` builds the frontend, the backend serves it). The short version:

1. Add a **PostgreSQL** database in your Railway project.
2. Deploy the repo — Railway uses the root `Dockerfile` automatically.
3. Set the variables: `DATABASE_URL` (reference the Postgres one), `JWT_SECRET`, `VITE_GOOGLE_MAPS_API_KEY` (build-time!), and your `SMTP_*` / `MAIL_FROM` for email.
4. Mount a **Volume** at `/app/uploads` so photos survive deploys.

That's it. First boot creates the schema and seeds the courts.

---

## 🗂️ Project structure

```
ball-radar/
├─ backend/
│  └─ src/  index.js · auth.js · courts.js · db.js · mailer.js · seed.js
└─ frontend/
   └─ src/  main.jsx · App.jsx · api.js · styles.css
```

---

## 📜 API cheat sheet

| Method | Path | What it does |
|---|---|---|
| POST | `/api/auth/register` | Sign up, get a code |
| POST | `/api/auth/verify` | Verify code → token |
| POST | `/api/auth/login` | Log in |
| POST | `/api/auth/forgot` · `/reset` | Forgot / reset password |
| GET | `/api/courts` | All courts (with ratings & top tags) |
| GET | `/api/courts/:id` | One court + reviews + photos |
| POST/PUT/DELETE | `/api/courts/:id` | Add / edit / delete a court |
| POST/DELETE | `/api/courts/:id/reviews` | Leave / remove your review |
| POST/DELETE | `/api/courts/:id/photos` | Upload / delete a photo |
| GET | `/api/courts/nearby?lat=&lng=&radius=` | Nearest courts (PostGIS, haversine fallback) |

## 🧪 Tests & CI

The backend ships an integration suite (Vitest + Supertest) covering auth, courts, the geospatial `nearby` endpoint, and the admin guard.

```bash
cd backend
npm test          # spins up a throwaway embedded Postgres automatically
```

Set `DATABASE_URL` to run against an existing database instead (this is how CI runs it, against a PostGIS service container so the spatial path is exercised). Every push and PR runs `typecheck → tests` for the backend and a production `build` for the frontend via GitHub Actions — see the badge up top.

---

Made with sweat, questionable jump shots, and a lot of neon. Go find a court. 🏀
