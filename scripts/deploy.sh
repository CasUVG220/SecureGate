#!/usr/bin/env bash
# Full deploy: pull latest code and restart all services.
set -euo pipefail

git pull origin main
docker compose down
docker compose up --build -d
docker compose ps
