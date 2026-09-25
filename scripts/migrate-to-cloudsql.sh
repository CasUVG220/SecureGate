#!/usr/bin/env bash
#
# SecureGate — Migración de PostgreSQL (contenedor en la VM) a Cloud SQL
#
# Idempotente por pasos: cada paso comprueba si ya está hecho antes de actuar,
# así se puede relanzar tras un fallo sin duplicar nada. Nunca borra la base
# de origen.
#
#   1. Verifica proyecto y APIs (sqladmin).
#   2. Crea la instancia Cloud SQL para PostgreSQL 15 (si no existe).
#   3. Crea la base y el usuario de la app (si no existen).
#   4. Dump del origen (pg_dump --format=custom) a ./backups/.
#   5. Restore en Cloud SQL a través del Cloud SQL Auth Proxy local.
#   6. Verifica conteos tabla por tabla origen vs destino.
#   7. Imprime el DATABASE_URL y CLOUD_SQL_CONNECTION_NAME para el backend.
#
# Modo "solo estructura" (SCHEMA_ONLY=1): pasos 1-3, luego aplica
# database/init.sql sobre la instancia vacía (paso 5 sin restore) y salta el
# dump y la verificación. Es el modo usado en Sprint 8: aún no había datos
# de producción que conservar.
#
# Uso (migración con datos):
#   SOURCE_DATABASE_URL=postgresql://sguser:sgpassword123@localhost:5433/securegate \
#   DB_PASSWORD='una-contraseña-larga' \
#   ./scripts/migrate-to-cloudsql.sh
#
# Uso (solo estructura):
#   SCHEMA_ONLY=1 DB_PASSWORD='una-contraseña-larga' ./scripts/migrate-to-cloudsql.sh
#
# Variables (con valores por defecto):
#   PROJECT_ID            securegate-503823
#   REGION                northamerica-south1  (misma región que la VM securegateserver)
#   INSTANCE              securegate-pg
#   TIER                  db-f1-micro   (25 conexiones; db-g1-small = 50)
#   DB_NAME               securegate
#   DB_USER               sguser
#   DB_PASSWORD           (REQUERIDO en el primer run; crea el usuario)
#   SOURCE_DATABASE_URL   (REQUERIDO para los pasos 4-6) URL del Postgres actual.
#                         Desde la VM: postgresql://sguser:PASS@localhost:5433/securegate
#   SOURCE_VM/SOURCE_ZONE Si se dan, abre un túnel SSH (gcloud compute ssh) al
#                         puerto 5433 de la VM y SOURCE_DATABASE_URL puede
#                         apuntar a localhost:${SOURCE_TUNNEL_PORT:-5443}.
#   SCHEMA_ONLY=1         instancia + schema (init.sql), sin migrar datos
#   SKIP_DATA=1           sólo infraestructura (pasos 1-3 y 7), ni schema
#   PROXY_PORT            5439 (puerto local del Cloud SQL Auth Proxy)
#
# Requisitos: gcloud (autenticado, con permisos de Cloud SQL Admin en el
# proyecto), pg_dump/pg_restore/psql 15+, y cloud-sql-proxy
# (https://cloud.google.com/sql/docs/postgres/sql-proxy#install) o Docker.
#
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-securegate-503823}"
REGION="${REGION:-northamerica-south1}"
INSTANCE="${INSTANCE:-securegate-pg}"
TIER="${TIER:-db-f1-micro}"
DB_NAME="${DB_NAME:-securegate}"
DB_USER="${DB_USER:-sguser}"
DB_PASSWORD="${DB_PASSWORD:-}"
SOURCE_DATABASE_URL="${SOURCE_DATABASE_URL:-}"
SKIP_DATA="${SKIP_DATA:-0}"
SCHEMA_ONLY="${SCHEMA_ONLY:-0}"
PROXY_PORT="${PROXY_PORT:-5439}"
SOURCE_VM="${SOURCE_VM:-}"
SOURCE_ZONE="${SOURCE_ZONE:-}"
SOURCE_TUNNEL_PORT="${SOURCE_TUNNEL_PORT:-5443}"
BACKUP_DIR="${BACKUP_DIR:-$(cd "$(dirname "$0")/.." && pwd)/backups}"

log() { echo "[$(date '+%H:%M:%S')] $*"; }
die() { echo "[$(date '+%H:%M:%S')] ERROR: $*" >&2; exit 1; }

command -v gcloud >/dev/null || die "gcloud no está instalado"
gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q . || die "gcloud no está autenticado (gcloud auth login)"

# ── 1. Proyecto y APIs ───────────────────────────────────────────────────────
log "Proyecto: $PROJECT_ID"
gcloud projects describe "$PROJECT_ID" --format='value(projectId)' >/dev/null \
  || die "No tienes acceso al proyecto $PROJECT_ID (o no existe). Ajusta PROJECT_ID."
gcloud config set project "$PROJECT_ID" --quiet >/dev/null
if ! gcloud services list --enabled --format='value(config.name)' | grep -q '^sqladmin.googleapis.com$'; then
  log "Habilitando sqladmin.googleapis.com…"
  gcloud services enable sqladmin.googleapis.com
fi

# ── 2. Instancia ─────────────────────────────────────────────────────────────
if gcloud sql instances describe "$INSTANCE" --format='value(name)' >/dev/null 2>&1; then
  log "Instancia $INSTANCE ya existe."
else
  log "Creando instancia $INSTANCE ($TIER, PostgreSQL 15, $REGION)… (tarda ~5-10 min)"
  # - Sin IP pública: el acceso es vía Auth Proxy (IAM). Nada expuesto a Internet.
  #   Cloud SQL exige IP pública O privada; sin VPC configurada se usa la
  #   pública pero SIN redes autorizadas: sólo el proxy puede entrar.
  # - Backups automáticos + PITR: es la base de producción.
  # - Zona única y disco HDD en el tier más barato: suficiente para el volumen
  #   actual; se puede subir sin migrar.
  gcloud sql instances create "$INSTANCE" \
    --database-version=POSTGRES_15 \
    --tier="$TIER" \
    --region="$REGION" \
    --edition=ENTERPRISE \
    --availability-type=ZONAL \
    --storage-type=HDD --storage-size=10GB --storage-auto-increase \
    --backup-start-time=07:00 --enable-point-in-time-recovery \
    --maintenance-window-day=SUN --maintenance-window-hour=08 \
    --database-flags=max_connections=50 \
    --quiet
fi
CONNECTION_NAME="$(gcloud sql instances describe "$INSTANCE" --format='value(connectionName)')"
log "connectionName: $CONNECTION_NAME"

# ── 3. Base y usuario ────────────────────────────────────────────────────────
if gcloud sql databases describe "$DB_NAME" --instance="$INSTANCE" >/dev/null 2>&1; then
  log "Base $DB_NAME ya existe."
else
  log "Creando base ${DB_NAME}…"
  gcloud sql databases create "$DB_NAME" --instance="$INSTANCE" --charset=UTF8 --quiet
fi
if gcloud sql users list --instance="$INSTANCE" --format='value(name)' | grep -qx "$DB_USER"; then
  log "Usuario $DB_USER ya existe."
  [ -n "$DB_PASSWORD" ] || die "DB_PASSWORD es requerido para conectarse como $DB_USER"
else
  [ -n "$DB_PASSWORD" ] || die "DB_PASSWORD es requerido para crear el usuario $DB_USER"
  log "Creando usuario ${DB_USER}…"
  gcloud sql users create "$DB_USER" --instance="$INSTANCE" --password="$DB_PASSWORD" --quiet
fi

CLOUD_URL="postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${PROXY_PORT}/${DB_NAME}"
INIT_SQL="$(cd "$(dirname "$0")/.." && pwd)/database/init.sql"

TUNNEL_PID=""
PROXY_PID=""
cleanup() {
  [ -n "$PROXY_PID" ] && kill "$PROXY_PID" 2>/dev/null || true
  [ -n "$TUNNEL_PID" ] && kill "$TUNNEL_PID" 2>/dev/null || true
  docker rm -f sg-migrate-proxy >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Levanta el Cloud SQL Auth Proxy en 127.0.0.1:$PROXY_PORT y espera a que responda.
abrir_proxy() {
  mkdir -p "$BACKUP_DIR"
  if command -v cloud-sql-proxy >/dev/null; then
    # --gcloud-auth: usa la cuenta activa de gcloud, sin ADC aparte.
    cloud-sql-proxy --gcloud-auth --port="$PROXY_PORT" "$CONNECTION_NAME" >"$BACKUP_DIR/proxy.log" 2>&1 &
    PROXY_PID=$!
  elif command -v docker >/dev/null; then
    docker rm -f sg-migrate-proxy >/dev/null 2>&1 || true
    docker run -d --name sg-migrate-proxy -p "127.0.0.1:${PROXY_PORT}:5432" \
      -v "$HOME/.config/gcloud:/gcloud:ro" -e CLOUDSDK_CONFIG=/gcloud \
      gcr.io/cloud-sql-connectors/cloud-sql-proxy:2.25.4 \
      --address=0.0.0.0 --port=5432 --credentials-file=/gcloud/application_default_credentials.json "$CONNECTION_NAME" >/dev/null
  else
    die "Instala cloud-sql-proxy o Docker para conectarte a la instancia"
  fi
  log "Esperando al Cloud SQL Auth Proxy en :${PROXY_PORT}…"
  for i in $(seq 1 30); do
    pg_isready -h 127.0.0.1 -p "$PROXY_PORT" >/dev/null 2>&1 && break
    sleep 1
    [ "$i" = 30 ] && die "El proxy no respondió (revisa permisos roles/cloudsql.client y $BACKUP_DIR/proxy.log)"
  done
}

# init.sql es idempotente: deja el esquema exactamente al día (y además lo
# vuelve a aplicar el backend al arrancar, ver backend/src/db/migrate.ts).
aplicar_schema() {
  log "Aplicando database/init.sql en Cloud SQL…"
  psql "$CLOUD_URL" -q -v ON_ERROR_STOP=1 -f "$INIT_SQL" >/dev/null
  log "Tablas en $DB_NAME: $(psql "$CLOUD_URL" -Atc "SELECT count(*) FROM pg_tables WHERE schemaname='public'")"
}

if [ "$SKIP_DATA" = "1" ]; then
  log "SKIP_DATA=1: se omite schema y migración de datos."
elif [ "$SCHEMA_ONLY" = "1" ]; then
  command -v psql >/dev/null || die "psql no está en PATH"
  abrir_proxy
  aplicar_schema
else
  [ -n "$SOURCE_DATABASE_URL" ] || die "SOURCE_DATABASE_URL es requerido para migrar datos (o usa SCHEMA_ONLY=1)"
  command -v pg_dump >/dev/null && command -v pg_restore >/dev/null && command -v psql >/dev/null \
    || die "pg_dump/pg_restore/psql no están en PATH"

  # ── 4. Dump ────────────────────────────────────────────────────────────────
  mkdir -p "$BACKUP_DIR"
  if [ -n "$SOURCE_VM" ]; then
    [ -n "$SOURCE_ZONE" ] || die "SOURCE_ZONE es requerido junto con SOURCE_VM"
    log "Abriendo túnel SSH a $SOURCE_VM ($SOURCE_ZONE): localhost:$SOURCE_TUNNEL_PORT → VM:5433"
    gcloud compute ssh "$SOURCE_VM" --zone="$SOURCE_ZONE" --quiet -- -N -L "${SOURCE_TUNNEL_PORT}:localhost:5433" &
    TUNNEL_PID=$!
    for i in $(seq 1 30); do
      pg_isready -h 127.0.0.1 -p "$SOURCE_TUNNEL_PORT" >/dev/null 2>&1 && break
      sleep 1
      [ "$i" = 30 ] && die "El túnel SSH no respondió"
    done
  fi
  DUMP="$BACKUP_DIR/securegate-pre-cloudsql-$(date +%Y%m%d-%H%M%S).dump"
  log "pg_dump del origen → $DUMP"
  pg_dump --format=custom --no-owner --no-privileges --file="$DUMP" "$SOURCE_DATABASE_URL"
  log "Dump: $(du -h "$DUMP" | cut -f1)"

  # ── 5. Proxy + restore ─────────────────────────────────────────────────────
  abrir_proxy
  TABLAS_DESTINO="$(psql "$CLOUD_URL" -Atc "SELECT count(*) FROM pg_tables WHERE schemaname='public'")"
  if [ "$TABLAS_DESTINO" != "0" ]; then
    log "La base destino ya tiene $TABLAS_DESTINO tablas; se omite el restore (borra la base o usa otra para repetirlo)."
  else
    log "pg_restore en Cloud SQL…"
    # pgcrypto: Cloud SQL lo permite; el dump lo trae como CREATE EXTENSION.
    # --no-owner/--no-privileges: los roles del contenedor no existen aquí.
    pg_restore --no-owner --no-privileges --exit-on-error --dbname="$CLOUD_URL" "$DUMP"
    aplicar_schema
  fi

  # ── 6. Verificación ────────────────────────────────────────────────────────
  log "Verificando conteos origen vs destino…"
  DIFF=0
  while read -r tabla; do
    [ -n "$tabla" ] || continue
    o="$(psql "$SOURCE_DATABASE_URL" -Atc "SELECT count(*) FROM \"$tabla\"")"
    d="$(psql "$CLOUD_URL" -Atc "SELECT count(*) FROM \"$tabla\"")"
    if [ "$o" = "$d" ]; then printf '  %-36s %8s ✓\n' "$tabla" "$o"; else printf '  %-36s %8s ≠ %s ✗\n' "$tabla" "$o" "$d"; DIFF=1; fi
  done < <(psql "$SOURCE_DATABASE_URL" -Atc "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1")
  [ "$DIFF" = 0 ] || die "Hay diferencias de conteo: NO cambies DATABASE_URL hasta revisarlas."
  log "Datos migrados sin pérdida."
fi

# ── 7. Salida ────────────────────────────────────────────────────────────────
cat <<EOF

════════════════════════════════════════════════════════════════════════════
Cloud SQL listo. Para el backend (docker-compose.prod.yml en la VM):

  export CLOUD_SQL_CONNECTION_NAME='$CONNECTION_NAME'
  export DATABASE_URL='postgresql://${DB_USER}:<DB_PASSWORD>@cloud-sql-proxy:5432/${DB_NAME}'
  export DB_POOL_MAX=10        # db-f1-micro: 25 conexiones en total
  docker compose -f docker-compose.prod.yml up -d --build backend cloud-sql-proxy

La service account de la VM necesita el rol roles/cloudsql.client:
  gcloud projects add-iam-policy-binding $PROJECT_ID \\
    --member="serviceAccount:\$(gcloud compute instances describe <VM> --zone <ZONA> --format='value(serviceAccounts[0].email)')" \\
    --role=roles/cloudsql.client

Para desarrollo local contra Cloud SQL: corre 'cloud-sql-proxy --port $PROXY_PORT $CONNECTION_NAME'
y exporta DATABASE_URL='postgresql://${DB_USER}:<DB_PASSWORD>@host.docker.internal:${PROXY_PORT}/${DB_NAME}'
antes de 'docker compose up'.
════════════════════════════════════════════════════════════════════════════
EOF
