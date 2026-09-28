#!/usr/bin/env bash
# Backend en MODO PRODUCCIÓN (imagen real `--target prod`, NODE_ENV=production)
# en localhost:3100, contra una base propia (securegate_prodtest) dentro del
# Postgres LOCAL del compose. Sirve para verificar CORS con allowlist, cookie
# `Secure`, cuentas demo desactivadas, etc. sin tocar la base de las demás pruebas.
#   ./prodmode.sh up | down
set -euo pipefail
cd "$(dirname "$0")/../.."
[[ -n "${DATABASE_URL:-}" ]] && { echo "ABORTO: unset DATABASE_URL (solo Postgres local)"; exit 1; }
nombre=securegate-backend-prodmode
case "${1:?up|down}" in
  down) docker rm -f "$nombre" >/dev/null 2>&1 || true
        docker exec securegate-db psql -U sguser -d postgres -qc "DROP DATABASE IF EXISTS securegate_prodtest WITH (FORCE)" ; exit 0 ;;
  up)   docker rm -f "$nombre" >/dev/null 2>&1 || true
        docker build -q --target prod -t securegate-backend:prodtest backend >/dev/null
        docker exec securegate-db psql -U sguser -d postgres -qc "DROP DATABASE IF EXISTS securegate_prodtest WITH (FORCE)" -c "CREATE DATABASE securegate_prodtest OWNER sguser"
        # validarEntorno() rechaza una DATABASE_URL que contenga la contraseña de desarrollo
        # en claro; %31%32%33 es "123" codificado y pg lo decodifica igual.
        docker run -d --name "$nombre" --network securegate_securegate-network -p 127.0.0.1:3100:3000 \
          -e NODE_ENV=production -e PORT=3000 -e TRUST_PROXY=1 -e TZ=America/Guatemala -e APP_TZ=America/Guatemala \
          -e ALLOWED_ORIGINS=https://app.sectest.example \
          -e JWT_SECRET="$(docker exec securegate-backend printenv JWT_SECRET)" \
          -e DATABASE_URL='postgresql://sguser:sgpassword%31%32%33@db:5432/securegate_prodtest' \
          -v "$PWD/database/init.sql:/app/database/init.sql:ro" \
          securegate-backend:prodtest >/dev/null
        for i in $(seq 1 40); do curl -fs http://localhost:3100/health >/dev/null && { echo "backend prod-mode listo en :3100"; exit 0; }; sleep 2; done
        docker logs --tail 30 "$nombre"; exit 1 ;;
esac
