# eval-dpi — evalúa el OCR local del DPI contra una carpeta con verdad terreno

```bash
# 1) Conjunto sintético (ficticio) para regresiones y tiempos
node desktop/sidecar-ocr/fixtures-dpi/generar.mjs --out /tmp/dpi
# 2) Evaluar (necesita los modelos: node desktop/sidecar-ocr/scripts/fetch-models.mjs)
node scripts/eval-dpi/index.mjs --dir /tmp/dpi
# 3) Conjunto REAL, con consentimiento y FUERA del repositorio (procedimiento en docs/ocr_dpi_local.md)
node scripts/eval-dpi/index.mjs --dir /ruta/cifrada/dpi-reales --real
node --test scripts/eval-dpi/eval.test.mjs     # pruebas de las métricas
```
La carpeta lleva las imágenes y `verdad_terreno.csv` (`archivo,cui,nombres,apellidos[,variante]`; separador `,` o `;`). El OCR corre en
este mismo proceso, sin red: no se envía nada a ningún servicio. El reporte (`.md` + `.json`, sin datos personales: aciertos y tiempos; con
un conjunto real tampoco lleva los nombres de los archivos) queda en `scripts/eval-dpi/reportes/` (ignorada por git). Métricas: exactitud del
CUI y por campo, tasa de revisión manual, **errores silenciosos** (CUI mal sin marcar), nombres mal sin marcar, tiempo por captura p50/p95 y
la meta RNF-03 (p95 < 5 s). Detalle: `docs/ocr_dpi_local.md`.
