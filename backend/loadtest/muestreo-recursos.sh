#!/usr/bin/env bash
# Muestrea cada ~1 s el CPU/memoria de backend y db (docker stats) y las conexiones a Postgres
# (pg_stat_activity) hasta que exista el archivo de parada. Uso (lo lanza run-sprint8.sh):
#   muestreo-recursos.sh <etiqueta> <archivo-parada>
set -uo pipefail
ETQ="$1"; STOP="$2"; OUT="$(cd "$(dirname "$0")" && pwd)/results/recursos-$ETQ.csv"
echo "t_s,backend_cpu_pct,backend_mem_mib,db_cpu_pct,db_mem_mib,pg_conexiones,pg_activas" > "$OUT"
T0=$(date +%s)
while [ ! -e "$STOP" ]; do
  S=$(docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}' securegate-backend securegate-db 2>/dev/null)
  B=$(echo "$S" | awk '$1=="securegate-backend"{gsub("%","",$2); print $2","$3}' | sed 's/MiB//;s/GiB/*1024/')
  D=$(echo "$S" | awk '$1=="securegate-db"{gsub("%","",$2); print $2","$3}' | sed 's/MiB//;s/GiB/*1024/')
  P=$(docker exec securegate-db psql -U sguser -d securegate -Atc "select count(*), count(*) filter (where state='active') from pg_stat_activity where datname='securegate' and pid<>pg_backend_pid()" 2>/dev/null | tr '|' ',')
  echo "$(( $(date +%s) - T0 )),$B,$D,$P" >> "$OUT"
done
