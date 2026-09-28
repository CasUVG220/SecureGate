#!/usr/bin/env bash
# OWASP ZAP contra el backend LOCAL (docker-compose). Nunca contra la VM ni Cloud SQL.
#   ./run-zap.sh baseline
#   ./run-zap.sh active [minutos-por-rol] [rol ...]     roles: owner adminEmpA adminSucA1 agenteA1 resA1
# Requiere el stack en modo relajado: ./stack.sh zap   (y luego ./stack.sh prod-limits)
# Entre roles se restaura la instantánea "seeded": el escaneo activo crea/borra datos.
set -euo pipefail
cd "$(dirname "$0")"
RES="$PWD/results"; mkdir -p "$RES"; chmod -R a+rwX "$RES" zap
IMG=zaproxy/zap-stable
TARGET="http://host.docker.internal:3000"
modo="${1:?baseline|active}"; shift || true

case "$modo" in
  baseline)
    docker run --rm -v "$PWD:/zap/wrk:rw" -t "$IMG" zap-baseline.py -t "$TARGET" -m 3 \
      -r results/zap-baseline.html -J results/zap-baseline.json -w results/zap-baseline.md -I ;;
  active)
    minutos="${1:-15}"; shift || true
    roles=("$@"); [[ ${#roles[@]} -eq 0 ]] && roles=(owner adminEmpA adminSucA1 agenteA1 resA1)
    for rol in "${roles[@]}"; do
      echo "════ ZAP activo — rol $rol (${minutos} min) ════"
      ./snapshot.sh restore seeded
      TOKEN="$(node zap-token.js "$rol")"
      # El Automation Framework no resuelve ${VAR} en parámetros numéricos: se renderiza el plan aquí.
      sed -e "s|\${ST_TOKEN}|$TOKEN|g" -e "s|\${ST_ROLE}|$rol|g" -e "s|\${ST_MINUTOS}|$minutos|g" -e "s|\${ST_TARGET}|$TARGET|g" \
        zap/plan-active.yaml > zap/plan-run.yaml
      docker run --rm -v "$PWD:/zap/wrk:rw" -t "$IMG" zap.sh -cmd -autorun /zap/wrk/zap/plan-run.yaml || true
      rm -f zap/plan-run.yaml   # contiene el JWT del rol
    done ;;
esac
