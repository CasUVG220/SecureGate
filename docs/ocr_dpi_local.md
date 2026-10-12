# OCR local del DPI (SCRUM-121) — diseño, privacidad y cómo decidir si reemplaza a Vision

## Qué cambió
Antes la foto del DPI iba **siempre** al backend (`POST /api/ocr/dpi` → Google Vision, un costo por llamada y requiere internet). Ahora el equipo de garita lo lee **primero en el propio equipo**:

```
captura (WebView) ──base64──▶ Rust ──pipe──▶ sidecar Node (ppu-paddle-ocr, ONNX en CPU)
                                              │  1) enderezado   (src/enderezar.js)
                                              │  2) OCR de líneas (mismos modelos que la placa)
                                              │  3) extractor    (src/dpi.js)  → CUI, nombres, apellidos, confianza, correcciones
                              ◀── campos ─────┘
            ┌ suficiente? (CUI válido, confianza ≥ 0,80, algún nombre) ── sí ──▶ pantalla (origen «local»)
 ocr_dpi ───┤
            └ no: ¿hay red Y el equipo permite el respaldo? ── sí ──▶ POST /ocr/dpi (Vision) ──▶ pantalla (origen «remoto»)
                                                            └ no ──▶ resultado local dudoso (o captura manual)
```
- Comandos Tauri (`desktop/src-tauri/src/ocr.rs`): **`ocr_dpi`** (el que usa la pantalla: local primero y respaldo), `ocr_dpi_local` (solo local, sin red), `ocr_dpi_remoto` (solo Vision), `ocr_dpi_config` / `ocr_dpi_configurar` (la bandera).
- **Bandera por equipo** `dpi_remoto_respaldo` (`config.json` del equipo; **encendida por defecto**): se cambia en *Cámaras de esta garita → Lectura del DPI*. Apagada, la foto del DPI **nunca sale del equipo**.
- El backend `/api/ocr/dpi` y Vision **no se tocaron**.
- La pantalla **siempre** deja el DPI y el nombre en el formulario, visibles y editables. Si hubo correcciones, el CUI es inválido o la confianza es baja, el agente debe marcar «Revisé el DPI y el nombre contra el documento» para poder registrar. La lectura remota siempre pide esa confirmación (Vision no informa confianza).
- **Origen del dato**: `origen_dpi` = `local` | `remoto` | `manual`, igual que antes se marcaba `capturado_manualmente`. Viaja en la cola offline (SQLite cifrado, columna `origen_dpi`) y se guarda en el servidor (`registros_acceso.origen_dpi`, NULL en lo anterior). Teclear el número a mano convierte el origen en `manual`.
- La captura manual quedó intacta (se prueba que no pide confirmación extra).

## El extractor (`desktop/sidecar-ocr/src/dpi.js`)
- **CUI**: 13 dígitos (impreso 4-5-4). Une los fragmentos que el OCR separa en una línea. **Correcciones por posición**: en el CUI O/Q/D→0, I/L/|→1, Z→2, S→5, G→6, B→8; en nombres 0→O, 1→I, 2→Z, 5→S, 6→G, 8→B. Toda corrección baja la confianza (×0,8) y **obliga a revisar**.
- **Validación**: 13 dígitos; los dos últimos pares = departamento (01–22) y municipio (01–40).
- **Nombres**: por las etiquetas «APELLIDOS / SURNAME» y «NOMBRES / GIVEN NAMES» con coincidencia aproximada; si no se leen, por orden (apellidos primero) con confianza ×0,7 y revisión.
- **Pendiente, no inventado**: (1) **dígito verificador del CUI** (no se conoce con certeza el algoritmo oficial; sale `verificador: "no_verificado"`); (2) **catálogo de municipios por departamento** (hoy solo la cota 01–40); (3) confirmar la disposición del documento real.
- **Limitación conocida**: el modelo de reconocimiento es del alfabeto latino básico: **no produce Ñ ni tildes** («MUÑOZ» sale «MUNOZ»). Los espacios entre palabras también fallan a veces («LUISLUCIA»). Es una razón más para la revisión humana, y cambiar a un modelo con acentos es una de las palancas si el conjunto real lo exige.

## Privacidad (qué se promete y cómo se vigila)
- La **imagen** va en memoria (WebView → Rust → pipe → sidecar); **no se escribe a disco** ni en Rust ni en el sidecar. Pruebas: guardas de código en `ocr.rs` y en el sidecar (sin `fs::write`, `writeFile`, `console.log`…) y una prueba de punta a punta que corre el sidecar con un directorio temporal propio y comprueba que **no queda ningún archivo con contenido** (solo dos marcas vacías o sin datos de las bibliotecas de imagen: `mat-debug-<pid>.log` y `.ses`).
- El **CUI y los nombres no van a los logs**: `ResultadoDpi` oculta esos campos en `Debug`; el único log del DPI (`linea_log_dpi`) lleva origen, banderas, conteos y milisegundos. El sidecar no escribe nada por stderr con datos del documento (se prueba con un DPI ficticio: el CUI y los nombres no aparecen en stderr).
- La respuesta del sidecar **no incluye el texto crudo** del documento; la remota se reduce a CUI y nombre (se descarta `texto_completo`).
- Con el respaldo apagado la foto no sale del equipo; encendido, sale **solo** si el local no bastó y hay red.

## Cómo armar el conjunto REAL (con consentimiento)
Los resultados sintéticos **no son evidencia** de precisión real (ver abajo). Para decidir hace falta un conjunto de DPI reales fotografiados como en la garita:
1. **Consentimiento escrito** de cada persona (para qué se usa, quién ve la foto, cuánto se guarda y cómo pedir que se borre). Sin consentimiento no entra. Idealmente voluntarios del equipo y de la comunidad, no visitantes reales de una garita.
2. Mínimo **150 documentos** (idealmente 300) con **variedad**: personas con 1 y con 2+ nombres, apellidos con Ñ/tilde y compuestos («DE LEON»), DPI nuevos y viejos, plástico gastado, y fotos con la webcam real **de la garita** en sus condiciones (contraluz, noche, reflejos, ángulo, desenfoque, dedo tapando).
3. Un CSV `verdad_terreno.csv` (`archivo,cui,nombres,apellidos,variante`) transcrito **dos veces por personas distintas** y reconciliado. Es el único archivo con datos personales en texto: tratarlo como dato personal.
4. **Dónde vive**: en un disco cifrado de una sola persona responsable, **nunca en el repositorio** (`fixtures-dpi/salida/` y los reportes ya están en `.gitignore`), nunca en el CI ni en servicios externos distintos del que se está evaluando. Al terminar la evaluación, borrar las fotos y conservar solo el reporte (que no lleva datos personales).
5. Correr Vision sobre ese mismo conjunto cuesta una llamada por imagen: presupuestarla.

## Criterio de corte (Vision → local)
Se considera que el OCR local **puede ser la lectura principal** cuando, sobre el **conjunto real**:
- **Exactitud del CUI local ≥ exactitud del CUI de Vision** (la métrica que decide), y
- **errores silenciosos = 0 %** (un CUI mal que *no* quedó marcado para revisión), y
- **p95 por captura < 5 s** en un equipo de 6–8 GB (RNF-03).
Las exactitudes de nombres, la tasa de revisión manual y los espacios/tildes se **informan** y alimentan mejoras, pero no bloquean el corte porque el agente confirma esos campos. Si el local queda por debajo, Vision sigue siendo el respaldo y se evalúa un modelo de reconocimiento con acentos o un ajuste de umbrales (`UMBRAL_CONFIANZA_*` en `dpi.js` y `ocr.rs`). **Vision no se quita** en ningún caso en este sprint.

## Cómo correr la evaluación
```bash
# 1) Modelos (una vez):  node desktop/sidecar-ocr/scripts/fetch-models.mjs   (y npm --prefix desktop/sidecar-ocr ci --ignore-scripts)
# 2) Sintético (regresiones y tiempos; NO es evidencia):
node desktop/sidecar-ocr/fixtures-dpi/generar.mjs --out /tmp/dpi --n 60
node scripts/eval-dpi/index.mjs --dir /tmp/dpi
# 3) Real, local vs Vision (necesita backend con GOOGLE_CLOUD_API_KEY y el JWT de un agente):
node scripts/eval-dpi/index.mjs --dir /ruta/segura/conjunto-real --motor ambos --backend https://<servidor> --token <JWT>
node --test scripts/eval-dpi/ ; npm --prefix desktop/sidecar-ocr test      # pruebas
```
Salida: `scripts/eval-dpi/reportes/eval-dpi-<fecha>.md|json` con exactitud del CUI y por campo, tasa de revisión, errores silenciosos y p50/p95.

## Resultado sobre el conjunto sintético (60 imágenes ficticias, semilla 20261011, 4 vCPU)
| Métrica | Local |
|---|---|
| Exactitud del CUI | 95 % (57/60) |
| Nombres / apellidos (sin tildes) | 78 % / 75 % |
| Revisión manual | 11,7 % |
| Errores silenciosos | **0** |
| Tiempo p50 / p95 | 536 / 632 ms |
**Esto NO es evidencia de precisión real**: son tarjetas dibujadas, limpias, con letra tipográfica y fondo uniforme, hechas para ejercitar el extractor; las fotos de garita (reflejos del plástico, desgaste, fondo, tipografía real, dedos) son mucho más difíciles. Solo sirve como prueba de regresión y para medir tiempo.
