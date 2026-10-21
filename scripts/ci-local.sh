#!/usr/bin/env bash
# CI local: corre, en este equipo, lo mismo que los jobs de .github/workflows/ci-integracion.yml (más las pruebas del sidecar).
#
#   bash scripts/ci-local.sh            # todo
#   bash scripts/ci-local.sh sidecar    # solo algunos: backend backend-int frontend desktop rust sidecar anpr-e2e
#
# `anpr-e2e` (no corre por defecto: necesita Postgres, cargo, node, ffmpeg y los modelos del sidecar y tarda unos minutos):
# el ANPR de punta a punta (clip → garita → backend) y las mediciones con sus barandas, como el job `anpr-e2e` del CI.
#
# Requisitos: Node 20+, dependencias instaladas (`npm ci` en cada paquete), Rust con las bibliotecas de Tauri, y para
# `backend-int` un Postgres de prueba (DATABASE_URL a una base *_test en localhost; ver docs/tarea5_pruebas.md).
# Sale con error si algún paso falla, pero corre todos antes de salir y deja un resumen.
set -u
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
PASOS=("$@")
[ ${#PASOS[@]} -eq 0 ] && PASOS=(backend backend-int frontend desktop rust sidecar)
RESUMEN=()
FALLO=0

correr() { # nombre, directorio, comando…
  local nombre="$1" dir="$2"; shift 2
  local t0=$SECONDS
  echo "▶ $nombre"
  if (cd "$RAIZ/$dir" && "$@"); then RESUMEN+=("✓ $nombre ($((SECONDS - t0)) s)"); else RESUMEN+=("✗ $nombre ($((SECONDS - t0)) s)"); FALLO=1; fi
}

for p in "${PASOS[@]}"; do
  case "$p" in
    backend)
      correr "backend · unitarias" backend env TZ=America/Guatemala npx jest
      correr "backend · tipos" backend npx tsc --noEmit ;;
    backend-int)
      correr "backend · integración" backend npm run test:integration
      correr "backend · regresión" backend npm run test:regression ;;
    frontend)
      correr "frontend · unitarias" frontend env TZ=UTC npx vitest run
      correr "frontend · compilar" frontend npm run build ;;
    desktop)
      correr "desktop · unitarias" desktop env TZ=UTC npx vitest run
      correr "desktop · kit de UI" desktop npm run ui:check
      correr "desktop · compilar" desktop npm run build
      correr "desktop · scripts" desktop node --test scripts/medir-recursos.test.mjs scripts/medir-anpr.test.mjs ;;
    rust)
      mkdir -p "$RAIZ/desktop/dist" "$RAIZ/desktop/src-tauri/resources/sidecar-ocr" "$RAIZ/desktop/src-tauri/binaries"
      for b in node ffmpeg; do f="$RAIZ/desktop/src-tauri/binaries/$b-x86_64-unknown-linux-gnu"; [ -e "$f" ] || touch "$f"; done
      correr "desktop · Rust" desktop/src-tauri cargo test --lib --locked ;;
    sidecar)
      correr "sidecar · node --test" desktop/sidecar-ocr npm test ;;
    anpr-e2e)
      correr "ANPR · contrato placas de residentes (web → sync → garita)" backend env TZ=America/Guatemala SG_CONTRATO_GARITA=1 npx jest -c jest.integration.config.ts --runInBand --testPathPattern anpr.contrato
      correr "ANPR · clip → garita → backend" backend env TZ=America/Guatemala SG_E2E_ANPR=1 npx jest -c jest.integration.config.ts --runInBand --testPathPattern anpr.e2e
      correr "ANPR · barandas con clips reales" desktop/src-tauri cargo test --lib --locked anpr::pruebas_reales::medicion -- --ignored --test-threads 1 ;;
    *) echo "paso desconocido: $p"; FALLO=1 ;;
  esac
done

echo
printf '%s\n' "${RESUMEN[@]}"
exit $FALLO
