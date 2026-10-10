#!/usr/bin/env bash
# Genera nginx/nginx.conf a partir de nginx/nginx.conf.template sustituyendo el
# marcador de dominio. Lo invoca scripts/deploy.sh; también se puede correr solo:
#
#   DOMINIO=app.midominio.com ./scripts/render-nginx.sh
#
# De dónde sale el dominio (en este orden):
#   1. variable de entorno DOMINIO
#   2. DOMINIO=... en el archivo de entorno (ENV_FILE, por defecto .env)
#   3. el host de PUBLIC_URL (entorno o archivo de entorno), p. ej. https://app.midominio.com
#
# FALLA (sale con código ≠ 0 y no escribe nada) si:
#   - no hay dominio, es el literal "DOMINIO" o no parece un nombre de host válido;
#   - la plantilla no existe o no contiene el marcador;
#   - en el resultado queda cualquier marcador sin sustituir.
#
# Es bash puro (sin envsubst ni sed): el dominio ya validado no puede inyectar
# directivas de nginx porque solo admite letras, dígitos, guiones y puntos.
set -euo pipefail

cd "$(dirname "$0")/.."

PLANTILLA="${NGINX_PLANTILLA:-nginx/nginx.conf.template}"
SALIDA="${NGINX_SALIDA:-nginx/nginx.conf}"
ENV_FILE="${ENV_FILE:-.env}"
MARCADOR='${DOMINIO}'

fallar() { echo "ERROR (nginx): $*" >&2; exit 1; }

# Lee VAR de un archivo tipo .env (última aparición, sin comillas ni comentarios).
leer_env() {
  local var="$1" linea
  [ -f "$ENV_FILE" ] || return 0
  linea="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${var}=" "$ENV_FILE" | tail -n 1 || true)"
  [ -n "$linea" ] || return 0
  linea="${linea#*=}"
  linea="${linea%%#*}"                       # comentario al final de la línea
  linea="${linea#"${linea%%[![:space:]]*}"}"  # recorta espacios iniciales
  linea="${linea%"${linea##*[![:space:]]}"}"  # recorta espacios finales
  linea="${linea%\"}"; linea="${linea#\"}"
  linea="${linea%\'}"; linea="${linea#\'}"
  printf '%s' "$linea"
}

host_de_url() {
  local u="$1"
  u="${u#*://}"; u="${u%%/*}"; u="${u%%:*}"
  printf '%s' "$u"
}

DOMINIO_RESUELTO="${DOMINIO:-}"
[ -n "$DOMINIO_RESUELTO" ] || DOMINIO_RESUELTO="$(leer_env DOMINIO)"
if [ -z "$DOMINIO_RESUELTO" ]; then
  url="${PUBLIC_URL:-}"
  [ -n "$url" ] || url="$(leer_env PUBLIC_URL)"
  [ -z "$url" ] || DOMINIO_RESUELTO="$(host_de_url "$url")"
fi

[ -n "$DOMINIO_RESUELTO" ] || fallar "no hay dominio. Define DOMINIO (o PUBLIC_URL) en el entorno o en ${ENV_FILE}, p. ej. DOMINIO=app.midominio.com"
[ "$DOMINIO_RESUELTO" != "DOMINIO" ] || fallar "DOMINIO sigue siendo el literal 'DOMINIO'. Pon el dominio real, p. ej. DOMINIO=app.midominio.com"

DOMINIO_RESUELTO="$(printf '%s' "$DOMINIO_RESUELTO" | tr '[:upper:]' '[:lower:]')"
if ! printf '%s' "$DOMINIO_RESUELTO" | grep -Eq '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'; then
  fallar "'${DOMINIO_RESUELTO}' no es un nombre de dominio válido (ej. app.midominio.com; sin esquema, puerto ni ruta)."
fi

[ -f "$PLANTILLA" ] || fallar "no existe la plantilla ${PLANTILLA}"
contenido="$(cat "$PLANTILLA")"
case "$contenido" in
  *"$MARCADOR"*) ;;
  *) fallar "la plantilla ${PLANTILLA} no contiene el marcador ${MARCADOR}" ;;
esac

resultado="${contenido//"$MARCADOR"/$DOMINIO_RESUELTO}"

# Nada del marcador debe sobrevivir, ni la palabra suelta DOMINIO.
case "$resultado" in
  *'${DOMINIO}'*|*'$DOMINIO'*) fallar "quedó un marcador de dominio sin sustituir en el resultado; no se escribió ${SALIDA}" ;;
esac
if printf '%s' "$resultado" | grep -Eq '(^|[^A-Za-z0-9_])DOMINIO([^A-Za-z0-9_]|$)'; then
  fallar "quedó el literal DOMINIO sin sustituir en el resultado; no se escribió ${SALIDA}"
fi

tmp="$(mktemp "${SALIDA}.XXXXXX")"
printf '%s\n' "$resultado" > "$tmp"
chmod 644 "$tmp"
mv "$tmp" "$SALIDA"
echo ">> nginx: ${SALIDA} generado para ${DOMINIO_RESUELTO}"
