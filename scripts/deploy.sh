#!/usr/bin/env bash
# Despliegue completo: actualiza el código y reinicia todos los servicios.
#
# POR DEFECTO despliega PRODUCCIÓN (docker-compose.prod.yml: dominio + TLS, frontend
# estático detrás de nginx, base en Cloud SQL). Para desarrollo/staging sin dominio:
#   COMPOSE_FILE=docker-compose.yml ./scripts/deploy.sh
#
# Uso:
#   ./scripts/deploy.sh            despliega
#   ./scripts/deploy.sh --check    solo valida las guardas de producción y genera la
#                                  configuración de nginx; no toca git, .env ni Docker
#
# Guardas de producción (cualquier compose distinto de docker-compose.yml):
#   - PAGOS_TARJETA_SIMULADA no puede estar activa (entorno, archivo de entorno ni
#     compose): es un mock que deja las deudas en cero con una tarjeta falsa.
#   - nginx se genera con scripts/render-nginx.sh; sin dominio válido (DOMINIO o
#     PUBLIC_URL) o con un marcador sin sustituir, el despliegue falla antes de
#     levantar nada.
set -euo pipefail

cd "$(dirname "$0")/.."

SOLO_VALIDAR=0
for arg in "$@"; do
  case "$arg" in
    --check) SOLO_VALIDAR=1 ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "ERROR: argumento desconocido: $arg (usa --check o --help)" >&2; exit 2 ;;
  esac
done

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env}"
export ENV_FILE

# Lee VAR de un archivo tipo .env (última aparición, sin comillas ni comentarios).
leer_env() {
  local var="$1" linea
  [ -f "$ENV_FILE" ] || return 0
  linea="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${var}=" "$ENV_FILE" | tail -n 1 || true)"
  [ -n "$linea" ] || return 0
  linea="${linea#*=}"
  linea="${linea%%#*}"
  linea="${linea#"${linea%%[![:space:]]*}"}"
  linea="${linea%"${linea##*[![:space:]]}"}"
  linea="${linea%\"}"; linea="${linea#\"}"
  linea="${linea%\'}"; linea="${linea#\'}"
  printf '%s' "$linea"
}

# true / 1 / yes / on / si (sin importar mayúsculas) cuentan como activado.
activado() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    true|1|yes|on|si|sí) return 0 ;;
    *) return 1 ;;
  esac
}

[ -f "$COMPOSE_FILE" ] || { echo "ERROR: no existe el archivo de compose '$COMPOSE_FILE'." >&2; exit 1; }

ES_DESARROLLO=0
[ "$COMPOSE_FILE" = "docker-compose.yml" ] && ES_DESARROLLO=1

if [ "$ES_DESARROLLO" -eq 0 ]; then
  # ── Guarda: la pasarela de tarjeta simulada JAMÁS en producción ──────────────
  origen=""
  if activado "${PAGOS_TARJETA_SIMULADA:-}"; then
    origen="la variable de entorno PAGOS_TARJETA_SIMULADA"
  elif activado "$(leer_env PAGOS_TARJETA_SIMULADA)"; then
    origen="el archivo $ENV_FILE"
  elif grep -Eqi '^[[:space:]]*PAGOS_TARJETA_SIMULADA:[[:space:]]*"?(true|1|yes|on|si)"?[[:space:]]*(#.*)?$' "$COMPOSE_FILE"; then
    origen="el archivo $COMPOSE_FILE"
  fi
  if [ -n "$origen" ]; then
    {
      echo "ERROR: PAGOS_TARJETA_SIMULADA está activada en $origen y este despliegue es de PRODUCCIÓN ($COMPOSE_FILE)."
      echo "       La pasarela simulada aprueba cualquier tarjeta y deja en cero el saldo de los residentes."
      echo "       Quita esa variable (o ponla en false) y vuelve a correr el despliegue."
      echo "       Si lo que quieres es un entorno de desarrollo: COMPOSE_FILE=docker-compose.yml ./scripts/deploy.sh"
    } >&2
    exit 1
  fi

  # ── nginx: el dominio sale de una variable y no puede quedar sin sustituir ───
  ./scripts/render-nginx.sh
else
  echo ">> AVISO: usando el compose de DESARROLLO (cuentas demo y pago con tarjeta simulado activos)." >&2
  echo ">>        Para producción: ./scripts/deploy.sh (usa docker-compose.prod.yml por defecto)." >&2
fi

if [ "$SOLO_VALIDAR" -eq 1 ]; then
  echo ">> Validación correcta ($COMPOSE_FILE). Con --check no se despliega nada."
  exit 0
fi

# JWT_SECRET persistente. Antes estaba escrito en docker-compose.yml (público en
# el repositorio): cualquiera podía fabricar tokens de owner. Ahora se genera
# una sola vez, se guarda en .env (ignorado por git) y se reutiliza en cada
# deploy para no invalidar sesiones ni licencias de garita.
touch "$ENV_FILE"
if ! grep -qE '^JWT_SECRET=.{32,}' "$ENV_FILE"; then
  if ! command -v openssl >/dev/null 2>&1; then
    echo "ERROR: falta openssl para generar JWT_SECRET; defínelo a mano en $ENV_FILE" >&2
    exit 1
  fi
  sed -i.bak '/^JWT_SECRET=/d' "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  echo "JWT_SECRET=$(openssl rand -hex 48)" >> "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo ">> Se generó un JWT_SECRET nuevo en $ENV_FILE (las sesiones y licencias emitidas antes quedan invalidadas)."
fi

git pull origin main
# `git pull` pudo traer una plantilla de nginx nueva: se vuelve a generar.
[ "$ES_DESARROLLO" -eq 1 ] || ./scripts/render-nginx.sh

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" down
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up --build -d
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
