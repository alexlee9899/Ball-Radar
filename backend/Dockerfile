# Ball Radar backend — dev image (used by docker-compose).
# pg is pure JS, so no native build toolchain is needed.
FROM node:22-bookworm-slim

WORKDIR /app

# Install deps first for layer caching
COPY package*.json ./
RUN npm install

# App source (overridden by bind mount in docker-compose dev)
COPY . .

EXPOSE 4000

# Schema init + seed happen automatically on boot (see src/index.js)
CMD ["npm", "run", "dev"]
