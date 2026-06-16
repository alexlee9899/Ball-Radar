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

# Stage 2: backend runtime, also serves the built frontend from ./public
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --omit=dev
COPY backend/ ./
COPY --from=frontend /fe/dist ./public
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "src/index.js"]
