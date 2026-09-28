#!/usr/bin/env bash
# sqlmap contra los parámetros de búsqueda del backend LOCAL (límites de producción intactos: el
# contenedor se reinicia entre objetivos para poner a cero el contador en memoria; no hay overrides).
#   SQLMAP=/ruta/a/venv/bin/sqlmap ./run-sqlmap.sh
set -uo pipefail
cd "$(dirname "$0")"
SQLMAP="${SQLMAP:-sqlmap}"; OUT=results/sqlmap; mkdir -p "$OUT"
BASE=http://localhost:3000
reiniciar() { docker restart securegate-backend >/dev/null; for i in $(seq 1 40); do curl -fs $BASE/health >/dev/null && break; sleep 1; done; sleep 2; }
# id | rol | url | parámetro(s)
objetivos=(
  "visitantes-dpi|agenteA1|$BASE/api/visitantes?dpi=1234|dpi"
  "visitantes-buscar-q|agenteA1|$BASE/api/visitantes/buscar?q=Visitante|q"
  "preauto-buscar|agenteA1|$BASE/api/preautorizaciones/buscar?dpi=ST-PRE&placa=P123|dpi,placa"
  "audit-logs|owner|$BASE/api/audit-logs?accion=LOGIN&usuario_id=x|accion,usuario_id"
  "reservas-estado|adminSucA1|$BASE/api/reservas?estado=confirmada|estado"
)
for o in "${objetivos[@]}"; do
  IFS='|' read -r id rol url param <<<"$o"
  reiniciar
  TOKEN="$(node zap-token.js "$rol")"
  echo "════ sqlmap $id ($rol) -p $param ════"
  "$SQLMAP" -u "$url" -p "$param" -H "Authorization: Bearer $TOKEN" --dbms=PostgreSQL --level=2 --risk=1 \
    --ignore-code=404 --technique=BEUST --time-sec=3 --batch --flush-session --delay=0.2 --timeout=15 --retries=1 \
    --output-dir="$OUT/$id" 2>&1 | grep -vE "^\s*$|\[INFO\] testing|legal disclaimer|starting @|ending @" | sed -E "s/Bearer [A-Za-z0-9._-]+/Bearer <oculto>/g" | tee "$OUT/$id.log" | tail -12
done
