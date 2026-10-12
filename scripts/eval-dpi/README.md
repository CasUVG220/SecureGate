# eval-dpi — evalúa el OCR de DPI contra una carpeta con verdad terreno

```bash
# 1) Conjunto sintético (ficticio) para probar el flujo y medir tiempos
node desktop/sidecar-ocr/fixtures-dpi/generar.mjs --out /tmp/dpi
# 2) Evaluar el extractor local (necesita los modelos: node desktop/sidecar-ocr/scripts/fetch-models.mjs)
node scripts/eval-dpi/index.mjs --dir /tmp/dpi
# 3) Comparar contra Google Vision (camino real: backend /api/ocr/dpi; cuesta una llamada por imagen)
node scripts/eval-dpi/index.mjs --dir /ruta/conjunto-real --motor ambos --backend https://tu-backend --token <JWT de un agente>
node --test scripts/eval-dpi/        # pruebas de las métricas
```
La carpeta lleva las imágenes y `verdad_terreno.csv` (`archivo,cui,nombres,apellidos[,variante]`). El reporte (`.md` + `.json`, sin datos personales:
solo nombres de archivo y aciertos) queda en `scripts/eval-dpi/reportes/` (ignorada por git). Métricas: exactitud del CUI y por campo, tasa de revisión manual,
**errores silenciosos** (CUI mal sin marcar), tiempo por captura p50/p95 y la meta RNF-03 (p95 < 5 s). Detalle y criterio de corte: `docs/ocr_dpi_local.md`.
