# Conjunto sintético de DPI (FICTICIOS)

```bash
cd desktop/sidecar-ocr
node fixtures-dpi/generar.mjs                       # 60 imágenes en fixtures-dpi/salida/ (ignorada por git)
node fixtures-dpi/generar.mjs --n 200 --seed 42 --out /ruta/otra
```
Genera `img_NNNN.jpg` (1280×720, como una webcam) y `verdad_terreno.csv` (`archivo,cui,nombres,apellidos,variante,…`).
Las variantes rotan entre `limpia`, `luz_baja`, `luz_alta`, `angulo`, `ruido`, `desenfoque` y `mixta`; ~15 % de los nombres llevan tildes o Ñ a propósito.

- **Todo es inventado**: nombres de listas comunes combinados al azar, CUI aleatorio con departamento 01–22. La tarjeta dice «EJEMPLO FICTICIO». No se usó ni se buscó ningún DPI real.
- **Reproducible**: misma `--seed` → mismo CSV. El dibujo usa `@napi-rs/canvas` (ya viene con `ppu-paddle-ocr`) y las fuentes del sistema, así que los píxeles pueden variar entre sistemas operativos.
- **No versionar** las imágenes (se regeneran). Evaluación: `node scripts/eval-dpi/index.mjs --dir desktop/sidecar-ocr/fixtures-dpi/salida`.
- **No es evidencia de precisión real**: ver `docs/ocr_dpi_local.md`.
