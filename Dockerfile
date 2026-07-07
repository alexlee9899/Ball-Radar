# ===== Production image for Railway (single service) =====
# Stage 1: build the frontend. VITE_ vars are inlined at build time, so the
# Google Maps key must be passed as a build ARG (Railway → service Variables).
FROM node:22-bookworm-slim AS frontend
ARG VITE_GOOGLE_MAPS_API_KEY
ENV VITE_GOOGLE_MAPS_API_KEY=${VITE_GOOGLE_MAPS_API_KEY}
WORKDIR /fe
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build      # -> /fe/dist

# Stage 2: backend — compile TypeScript, then serve API + built frontend (./public)
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
COPY backend/package*.json ./
COPY backend/tsconfig.json ./
RUN npm install --omit=optional # devDeps (typescript) for the build; skips test-only embedded-postgres binaries
COPY backend/ ./
RUN npm run build               # tsc -> dist/
COPY --from=frontend /fe/dist ./public
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "dist/index.js"]
