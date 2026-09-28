#!/usr/bin/env bash
# Instantáneas del Postgres LOCAL (contenedor securegate-db) para restaurar el
# estado tras pruebas destructivas.
#   ./snapshot.sh save <nombre>      guarda results/snap/<nombre>.sql
#   ./snapshot.sh restore <nombre>   restaura (reinicia el backend después)
set -euo pipefail
cd "$(dirname "$0")"
dir="${ST_SNAP_DIR:-results/snap}"; mkdir -p "$dir"
accion="${1:?save|restore}"; nombre="${2:?nombre}"
case "$accion" in
  save)    docker exec securegate-db pg_dump -U sguser --clean --if-exists --no-owner securegate > "$dir/$nombre.sql"
           echo "instantánea '$nombre' guardada ($(wc -l < "$dir/$nombre.sql") líneas)" ;;
  restore) docker exec securegate-db psql -U sguser -d postgres -qc "DROP DATABASE IF EXISTS securegate WITH (FORCE)" -c "CREATE DATABASE securegate OWNER sguser"
           docker exec -i securegate-db psql -U sguser -d securegate -q -v ON_ERROR_STOP=0 < "$dir/$nombre.sql" > /dev/null
           docker restart securegate-backend > /dev/null
           for i in $(seq 1 40); do curl -fs http://localhost:3000/health >/dev/null && break; sleep 2; done
           echo "instantánea '$nombre' restaurada" ;;
esac
