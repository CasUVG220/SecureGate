#!/usr/bin/env bash
# Prepara los datos de las pruebas de carga del Sprint 8 en el ambiente LOCAL
# (cuentas demo de database/seed-dev.sql):
#   - token de agente1 + residente_id                       → accesos / sync
#   - una licencia activada (token + fingerprint)           → heartbeat / sync / accesos
#   - N licencias emitidas sin activar (results/activar-codigos.csv) → activar
#
#   source backend/loadtest/setup-sprint8.sh [target_url] [n_codigos]
set -euo pipefail
TARGET="${1:-http://localhost:3000}"
N="${2:-300}"
case "$TARGET" in http://localhost*|http://127.0.0.1*) ;; *) echo "ABORTO: solo se permite el stack local" >&2; return 1 2>/dev/null || exit 1;; esac
DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
login() { curl -s -X POST "$TARGET/api/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}"; }

ADMIN=$(login sucursal@securegate.com sucursal123 | jq -r .token)
AGENTE_RESP=$(login agente1@securegate.com agente123)
export LOADTEST_TOKEN=$(echo "$AGENTE_RESP" | jq -r .token)
export LOADTEST_AGENTE_ID=$(echo "$AGENTE_RESP" | jq -r .usuario.id)
[ "$ADMIN" != null ] && [ "$LOADTEST_TOKEN" != null ] || { echo "login demo falló (¿SEED_DEMO?)" >&2; return 1 2>/dev/null || exit 1; }
export LOADTEST_RESIDENTE_ID=$(curl -s "$TARGET/api/residentes" -H "Authorization: Bearer $LOADTEST_TOKEN" | jq -r '.[0].id')

# Licencia activada para heartbeat / sync / accesos
export LOADTEST_FINGERPRINT=$(printf 'loadtest-fp-%s' "$RANDOM$RANDOM" | shasum -a 256 | cut -d' ' -f1)
COD=$(curl -s -X POST "$TARGET/api/licencias" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"etiqueta":"loadtest-activa"}' | jq -r .codigo_activacion)
export LOADTEST_LIC_TOKEN=$(curl -s -X POST "$TARGET/api/licencias/activar" -H 'Content-Type: application/json' \
  -d "{\"codigo\":\"$COD\",\"fingerprint\":\"$LOADTEST_FINGERPRINT\",\"nombre_dispositivo\":\"loadtest\"}" | jq -r .token_licencia)

# Pool de códigos sin activar (cada fila: código,fingerprint propio) para el escenario de activación
mkdir -p "$DIR/results"; : > "$DIR/results/activar-codigos.csv"
for i in $(seq 1 "$N"); do
  c=$(curl -s -X POST "$TARGET/api/licencias" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d "{\"etiqueta\":\"loadtest-pool-$i\"}" | jq -r .codigo_activacion)
  f=$(printf 'loadtest-pool-fp-%s-%s' "$i" "$RANDOM" | shasum -a 256 | cut -d' ' -f1)
  echo "$c,$f" >> "$DIR/results/activar-codigos.csv"
done
[ "$LOADTEST_LIC_TOKEN" != null ] && [ -n "$LOADTEST_RESIDENTE_ID" ] || { echo "no se pudo preparar la licencia/residente" >&2; return 1 2>/dev/null || exit 1; }
echo "agente=$LOADTEST_AGENTE_ID residente=$LOADTEST_RESIDENTE_ID licencia=(${#LOADTEST_LIC_TOKEN} chars) codigos=$(wc -l < "$DIR/results/activar-codigos.csv" | tr -d ' ')"
