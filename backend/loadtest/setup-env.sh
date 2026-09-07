#!/usr/bin/env bash
# Obtiene un token de agente y un residente_id válidos del ambiente semilla,
# y los deja como variables de entorno para que estres-accesos.yml los lea
# vía {{ $processEnvironment.* }}.
#
# Uso:
#   source backend/loadtest/setup-env.sh [target_url]
#
# (con "source", no "./", para que las variables queden en tu shell actual)

set -euo pipefail

TARGET="${1:-http://localhost:3000}"

LOGIN_RESPONSE=$(curl -s -X POST "$TARGET/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"agente1@securegate.com","password":"agente123"}')

LOADTEST_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.token')
LOADTEST_AGENTE_ID=$(echo "$LOGIN_RESPONSE" | jq -r '.usuario.id')

if [ "$LOADTEST_TOKEN" = "null" ] || [ -z "$LOADTEST_TOKEN" ]; then
  echo "Error: no se pudo hacer login como agente1@securegate.com" >&2
  echo "$LOGIN_RESPONSE" >&2
  return 1 2>/dev/null || exit 1
fi

RESIDENTES_RESPONSE=$(curl -s "$TARGET/api/residentes" \
  -H "Authorization: Bearer $LOADTEST_TOKEN")

LOADTEST_RESIDENTE_ID=$(echo "$RESIDENTES_RESPONSE" | jq -r '.[0].id')

if [ "$LOADTEST_RESIDENTE_ID" = "null" ] || [ -z "$LOADTEST_RESIDENTE_ID" ]; then
  echo "Error: no se encontró ningún residente en /api/residentes" >&2
  echo "$RESIDENTES_RESPONSE" >&2
  return 1 2>/dev/null || exit 1
fi

export LOADTEST_TOKEN
export LOADTEST_AGENTE_ID
export LOADTEST_RESIDENTE_ID

echo "LOADTEST_AGENTE_ID=$LOADTEST_AGENTE_ID"
echo "LOADTEST_RESIDENTE_ID=$LOADTEST_RESIDENTE_ID"
echo "LOADTEST_TOKEN=(${#LOADTEST_TOKEN} chars, exportado)"
