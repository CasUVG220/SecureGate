#!/usr/bin/env bash
# Run once on the host (not inside Docker) to obtain the initial certificate.
# Replace DOMINIO and EMAIL before executing.
set -euo pipefail

DOMINIO="DOMINIO"
EMAIL="EMAIL"

certbot certonly \
  --standalone \
  -d "$DOMINIO" \
  --email "$EMAIL" \
  --agree-tos \
  -n
