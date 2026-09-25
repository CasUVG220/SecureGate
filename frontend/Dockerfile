# Imagen del frontend, en tres etapas:
#
#   dev   → servidor de Vite con el código montado (docker-compose.yml).
#   build → `npm run build`; VITE_API_URL se hornea aquí (argumento de build).
#   prod  → archivos estáticos servidos por nginx SIN privilegios (puerto 8080).
#
# Antes producción también corría `npm run dev` (el servidor de desarrollo de
# Vite: sin minificar, con HMR, con la superficie de ataque de un dev server).

# ── dev ──────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS dev
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# ── build ────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL=
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

# ── prod ─────────────────────────────────────────────────────────────────────
FROM nginxinc/nginx-unprivileged:1.27-alpine AS prod
COPY nginx.spa.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
