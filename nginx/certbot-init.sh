#!/usr/bin/env bash
# Se corre UNA vez en el servidor (fuera de Docker) para emitir el certificado inicial.
#
#   DOMINIO=app.midominio.com EMAIL=admin@midominio.com ./nginx/certbot-init.sh
#
# Falla si falta alguna de las dos variables o si siguen con el valor de relleno.
set -euo pipefail

DOMINIO="${DOMINIO:-}"
EMAIL="${EMAIL:-}"

if [ -z "$DOMINIO" ] || [ "$DOMINIO" = "DOMINIO" ]; then
  echo "ERROR: define DOMINIO con el dominio real, p. ej. DOMINIO=app.midominio.com" >&2
  exit 1
fi
if [ -z "$EMAIL" ] || [ "$EMAIL" = "EMAIL" ]; then
  echo "ERROR: define EMAIL con un correo de contacto real para Let's Encrypt" >&2
  exit 1
fi

certbot certonly \
  --standalone \
  -d "$DOMINIO" \
  --email "$EMAIL" \
  --agree-tos \
  -n
