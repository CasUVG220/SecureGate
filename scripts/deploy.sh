#!/usr/bin/env bash
# Full deploy: pull latest code and restart all services.
#
# Por defecto usa docker-compose.yml (desarrollo/staging, sin dominio ni TLS).
# Para producción con dominio: COMPOSE_FILE=docker-compose.prod.yml ./scripts/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

# JWT_SECRET persistente. Antes estaba escrito en docker-compose.yml (público en
# el repositorio): cualquiera podía fabricar tokens de owner. Ahora se genera
# una sola vez, se guarda en .env (ignorado por git) y se reutiliza en cada
# deploy para no invalidar sesiones ni licencias de garita.
touch .env
if ! grep -qE '^JWT_SECRET=.{32,}' .env; then
  if ! command -v openssl >/dev/null 2>&1; then
    echo "ERROR: falta openssl para generar JWT_SECRET; defínelo a mano en .env" >&2
    exit 1
  fi
  sed -i.bak '/^JWT_SECRET=/d' .env && rm -f .env.bak
  echo "JWT_SECRET=$(openssl rand -hex 48)" >> .env
  chmod 600 .env
  echo ">> Se generó un JWT_SECRET nuevo en .env (las sesiones y licencias emitidas antes quedan invalidadas)."
fi

if [ "$COMPOSE_FILE" = "docker-compose.yml" ]; then
  echo ">> AVISO: usando el compose de DESARROLLO (cuentas demo y pago con tarjeta simulado activos)." >&2
  echo ">>        Para producción: COMPOSE_FILE=docker-compose.prod.yml ./scripts/deploy.sh" >&2
fi

git pull origin main
docker compose -f "$COMPOSE_FILE" down
docker compose -f "$COMPOSE_FILE" up --build -d
docker compose -f "$COMPOSE_FILE" ps
