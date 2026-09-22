# Imagen del backend, en tres etapas:
#
#   dev   → ts-node con el código montado desde el host (docker-compose.yml).
#   build → compila TypeScript a dist/.
#   prod  → SOLO dependencias de producción y JS compilado, sin ts-node, sin
#           artillery/jest, corriendo como el usuario sin privilegios `node`
#           (docker-compose.prod.yml usa `target: prod`).
#
# Antes había una sola etapa: `npm install` de TODO (incluido artillery),
# `ts-node` en producción y el proceso corriendo como root.

# ── dev ──────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS dev
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
EXPOSE 3000
CMD ["npx", "ts-node", "src/index.ts"]

# ── build ────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc -p tsconfig.json

# ── prod ─────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS prod
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1
CMD ["node", "dist/index.js"]

# La etapa por defecto (la última) es `prod`; el compose de desarrollo pide
# `target: dev` explícitamente.
