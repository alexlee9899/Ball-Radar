# Ball Radar frontend — Vite dev server
FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 5173

# --host makes Vite listen on 0.0.0.0 (reachable from the host)
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
