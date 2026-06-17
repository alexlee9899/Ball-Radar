# Ball Radar backend — API service (works on Railway and via docker-compose).
# pg is pure JS, so no native build toolchain is needed.
FROM node:22-bookworm-slim

WORKDIR /app

# Install deps first for layer caching
COPY package*.json ./
RUN npm install

# App source (overridden by bind mount in docker-compose dev)
COPY . .

EXPOSE 4000

# Production start. docker-compose overrides this with `npm run dev` for hot reload.
# Schema init (CREATE TABLE IF NOT EXISTS) runs automatically on boot (see src/index.js).
CMD ["npm", "start"]
