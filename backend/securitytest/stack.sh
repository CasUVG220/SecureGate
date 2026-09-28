#!/usr/bin/env bash
# Levanta (o reinicia) el stack LOCAL de docker-compose para las pruebas de
# seguridad del Sprint 8. NUNCA apunta a Cloud SQL ni a la VM de GCP.
#
#   ./stack.sh prod-limits   límites de producción (login 20, general 1000)  ← pruebas manuales
#   ./stack.sh zap           límites relajados (100000)                      ← SOLO escaneo ZAP
#   ./stack.sh down          apaga backend y db (conserva el volumen)
#
# El JWT_SECRET se conserva entre reinicios (se lee del contenedor en marcha)
# para que los tokens de prueba sigan valiendo tras cambiar los límites.
set -euo pipefail
cd "$(dirname "$0")/../.."

if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "ABORTO: DATABASE_URL está definido en el shell ($DATABASE_URL). Haz 'unset DATABASE_URL':" >&2
  echo "las pruebas de seguridad sólo corren contra el Postgres local del compose." >&2
  exit 1
fi

modo="${1:-prod-limits}"
if [[ "$modo" == "down" ]]; then docker compose stop backend db; exit 0; fi

secret="$(docker exec securegate-backend printenv JWT_SECRET 2>/dev/null || true)"
[[ -z "$secret" ]] && secret="$(openssl rand -hex 48)"
export JWT_SECRET="$secret"

case "$modo" in
  prod-limits) export RATE_LIMIT_LOGIN_MAX=20 RATE_LIMIT_GENERAL_MAX=1000 ;;
  # Solo estos dos overrides existen en docker-compose.yml (el resto de limitadores —activar, heartbeat,
  # invitaciones, ocr, eliminar, login por cuenta— sigue con su valor de producción también en modo zap).
  zap)         export RATE_LIMIT_LOGIN_MAX=100000 RATE_LIMIT_GENERAL_MAX=100000 ;;
  *) echo "modo desconocido: $modo" >&2; exit 2 ;;
esac

docker compose up -d --build db backend
for i in $(seq 1 60); do
  curl -fs http://localhost:3000/health >/dev/null && { echo "backend listo ($modo)"; exit 0; }
  sleep 2
done
echo "el backend no respondió a tiempo" >&2; docker compose logs --tail 40 backend; exit 1
