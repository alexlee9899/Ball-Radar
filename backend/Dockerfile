# Ball Radar backend — TypeScript API service (Railway + docker-compose).
# pg/tsx are pure JS, so no native build toolchain is needed.
FROM node:22-bookworm-slim

WORKDIR /app

# Install deps first for layer caching. --omit=optional skips embedded-postgres'
# native binaries (test-only; the app never imports it) so the image stays lean.
COPY package*.json ./
RUN npm install --omit=optional

# App source (overridden by bind mount in docker-compose dev)
COPY . .

# Compile TypeScript -> dist/ for production.
RUN npm run build

EXPOSE 4000

# Production start runs the compiled JS. docker-compose overrides this with
# `npm run dev` (tsx watch) for hot reload against the TS source.
# Schema init runs automatically on boot (see src/index.ts).
CMD ["node", "dist/index.js"]
