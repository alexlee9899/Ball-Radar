# Ball Radar frontend — PRODUCTION image (used by Railway).
# Build the Vite app (with build-time env injected), then serve the static files.
FROM node:22-bookworm-slim AS build
# Vite inlines these at build time -> must be ARG/ENV before `npm run build`.
ARG VITE_API_BASE_URL
ARG VITE_GOOGLE_MAPS_API_KEY
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_GOOGLE_MAPS_API_KEY=${VITE_GOOGLE_MAPS_API_KEY}
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build      # -> /app/dist

# Serve the static SPA. `serve -s` handles client-side routing fallback.
FROM node:22-bookworm-slim
WORKDIR /app
RUN npm install -g serve
COPY --from=build /app/dist ./dist
# Railway injects PORT; bind explicitly to 0.0.0.0 so the platform can reach it.
CMD ["sh", "-c", "serve -s dist -l tcp://0.0.0.0:${PORT:-3000}"]
