#!/usr/bin/env bash
# Corre los 4 escenarios del Sprint 8 en secuencia, con muestreo de recursos, contra el stack LOCAL.
# Requisito: backend levantado con el override de carga (solo local, límites relajados):
#   docker compose -f docker-compose.yml -f backend/loadtest/docker-compose.loadtest.yml up -d backend
# Al terminar: docker compose up -d backend   (vuelve a los límites de producción)
set -uo pipefail
cd "$(dirname "$0")/.."
[ "$(docker exec securegate-backend printenv RATE_LIMIT_ACTIVAR_MAX 2>/dev/null)" = "100000" ] || { echo "Falta el override docker-compose.loadtest.yml" >&2; exit 1; }
source loadtest/setup-sprint8.sh
for e in activar heartbeat sync accesos-idcliente; do
  echo "=== $e"
  STOP="$(mktemp -u)"; loadtest/muestreo-recursos.sh "$e" "$STOP" & MP=$!
  npm run -s loadtest:$e 2>&1 | grep -E "http.codes|errors\.|vusers.failed"
  touch "$STOP"; wait $MP; rm -f "$STOP"
done
