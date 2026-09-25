#!/usr/bin/env bash
#
# SecureGate — Backup diario de PostgreSQL a Google Cloud Storage
#
# ¡OJO! Sólo sirve para el Postgres EN CONTENEDOR (docker-compose.yml, o el
# perfil `local-db` de producción). Desde el Sprint 8 la base de producción es
# Cloud SQL, que NO tiene contenedor `securegate-db`: allí usa los backups
# automáticos y la recuperación a un punto en el tiempo de Cloud SQL
#   gcloud sql instances patch securegate-pg --backup-start-time=03:00 \
#     --enable-point-in-time-recovery
# y prueba una restauración periódicamente.
#
# Hace pg_dump del contenedor de la base de datos, lo comprime con timestamp,
# lo sube a un bucket de GCS, limpia los backups locales antiguos y mantiene
# una retención de los últimos 30 backups en el bucket.
#
# Uso:
#   ./scripts/backup-postgres.sh
#
# Variables de entorno (con valores por defecto para este proyecto):
#   DB_CONTAINER   Nombre del contenedor de Postgres   (default: securegate-db)
#   DB_USER        Usuario de Postgres                 (default: sguser)
#   DB_NAME        Base de datos a respaldar           (default: securegate)
#   GCS_BUCKET     Bucket destino, sin gs://           (REQUERIDO, ej: securegate-backups)
#   BACKUP_DIR     Carpeta local temporal              (default: /var/backups/securegate)
#   RETENTION      Cantidad de backups a conservar     (default: 30)
#   LOCAL_MAX_AGE  Días de retención local             (default: 1)
#
# Autenticación GCS: la VM e2-micro usa la service account adjunta (metadata),
# o exporta GOOGLE_APPLICATION_CREDENTIALS con la ruta al JSON de la SA.
#
set -euo pipefail

# ── Configuración ────────────────────────────────────────────────────────────
DB_CONTAINER="${DB_CONTAINER:-securegate-db}"
DB_USER="${DB_USER:-sguser}"
DB_NAME="${DB_NAME:-securegate}"
GCS_BUCKET="${GCS_BUCKET:-}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/securegate}"
RETENTION="${RETENTION:-30}"
LOCAL_MAX_AGE="${LOCAL_MAX_AGE:-1}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
die() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $*" >&2; exit 1; }

# ── Validaciones ─────────────────────────────────────────────────────────────
[ -n "$GCS_BUCKET" ] || die "GCS_BUCKET no está definido. Ej: export GCS_BUCKET=securegate-backups"
command -v docker >/dev/null 2>&1 || die "docker no está instalado o no está en PATH"
command -v gsutil >/dev/null 2>&1 || die "gsutil no está instalado (instala google-cloud-sdk)"
docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER" \
  || die "El contenedor '$DB_CONTAINER' no está corriendo"

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="backup_${TIMESTAMP}.sql.gz"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_FILE}"

# ── 1. Dump + compresión ─────────────────────────────────────────────────────
log "Generando dump de '${DB_NAME}' desde el contenedor '${DB_CONTAINER}'…"
# 'set -o pipefail' hace que un fallo de pg_dump aborte aunque gzip devuelva 0.
if ! docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$BACKUP_PATH"; then
  rm -f "$BACKUP_PATH"
  die "pg_dump falló; se eliminó el archivo parcial"
fi
# Verifica que el .gz no esté vacío/corrupto
gzip -t "$BACKUP_PATH" || { rm -f "$BACKUP_PATH"; die "El backup generado está corrupto"; }
log "Backup local creado: ${BACKUP_PATH} ($(du -h "$BACKUP_PATH" | cut -f1))"

# ── 2. Subida a GCS ──────────────────────────────────────────────────────────
log "Subiendo a gs://${GCS_BUCKET}/…"
gsutil cp "$BACKUP_PATH" "gs://${GCS_BUCKET}/${BACKUP_FILE}" \
  || die "Falló la subida a GCS"
log "Subido: gs://${GCS_BUCKET}/${BACKUP_FILE}"

# ── 3. Limpieza de backups locales (> LOCAL_MAX_AGE días) ─────────────────────
log "Eliminando backups locales con más de ${LOCAL_MAX_AGE} día(s)…"
find "$BACKUP_DIR" -name 'backup_*.sql.gz' -type f -mtime "+${LOCAL_MAX_AGE}" -print -delete || true

# ── 4. Retención en GCS (conservar los RETENTION más recientes) ──────────────
log "Aplicando retención de ${RETENTION} backups en el bucket…"
# Lista ordenada por nombre; el timestamp en el nombre es lexicográfico = cronológico.
mapfile -t REMOTE_BACKUPS < <(gsutil ls "gs://${GCS_BUCKET}/backup_*.sql.gz" 2>/dev/null | sort)
TOTAL="${#REMOTE_BACKUPS[@]}"
log "Backups en el bucket: ${TOTAL}"

if [ "$TOTAL" -gt "$RETENTION" ]; then
  TO_DELETE=$(( TOTAL - RETENTION ))
  log "Eliminando los ${TO_DELETE} backup(s) más antiguo(s)…"
  for ((i = 0; i < TO_DELETE; i++)); do
    log "  rm ${REMOTE_BACKUPS[$i]}"
    gsutil rm "${REMOTE_BACKUPS[$i]}" || log "  (aviso) no se pudo eliminar ${REMOTE_BACKUPS[$i]}"
  done
else
  log "Sin backups que eliminar (retención = ${RETENTION})."
fi

log "Backup completado correctamente."
