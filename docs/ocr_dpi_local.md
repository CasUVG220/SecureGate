# OCR local del DPI — 100 % en el equipo de la garita

El DPI se lee **en el propio equipo de la garita**, también sin internet. No hay OCR remoto: la foto del DPI **nunca sale del
equipo**, no hay costo por lectura ni cuentas de terceros. (Hasta el Sprint 10 existía un respaldo remoto opcional; se retiró:
ver `docs/ocr_local_decision.md`.)

## Cómo funciona

```
captura (WebView) ──base64──▶ Rust (ocr_dpi) ──pipe──▶ sidecar Node (ppu-paddle-ocr, ONNX en CPU)
                                                         │  1) enderezado          (src/enderezar.js)
                                                         │  2) OCR de líneas       (mismos modelos que la placa)
                                                         │  3) reglas del DPI      (src/dpi.js: extraerDpi)
                                                         │  4) segunda pasada      (src/dpi.js: completarNombres)
                                      ◀── campos ───────┘
                 Rust: ¿confiable? (CUI válido y presente, confianza del CUI ≥ 0,80, algún nombre)
                   ├ sí ──▶ formulario con los datos («DPI leído en este equipo»)
                   └ no ──▶ formulario con los datos marcados «Revisar» + la foto capturada; no se registra sin confirmar
```

- **Un solo comando** de Tauri: `ocr_dpi` (`desktop/src-tauri/src/ocr.rs`). No usa la red (una prueba de código lo vigila).
- **Nunca se acepta en silencio una lectura dudosa**: si el sidecar la marca, o si en Rust se ve que el CUI no es válido o
  falta, la confianza del CUI es baja o no salió ningún nombre, va con `revision_obligatoria` y sus motivos.
- **Pantalla** (`VisitanteForm`): el DPI y el nombre quedan siempre en el formulario, editables. Con una lectura dudosa:
  - los campos dudosos llevan la marca **«Revisar»** (visible y en la descripción accesible del campo; si ningún motivo dice
    qué campo, se marcan los dos);
  - se muestra la **foto capturada** para comparar (solo en memoria; se descarta al registrar o limpiar);
  - para registrar hay que marcar «Revisé el DPI y el nombre contra el documento»; el agente también puede corregir o
    escribirlo a mano.
- **Origen del dato**: `origen_dpi` = `local` | `manual`. Corregir el número a mano lo convierte en `manual`
  (`capturado_manualmente`), y así queda en la auditoría. Las filas anteriores al Sprint 10 pueden tener `remoto`.
- **Sin internet**: el botón «Leer DPI» funciona igual (solo necesita el OCR local).

## Las reglas del DPI (`desktop/sidecar-ocr/src/dpi.js`)

- **CUI**: 13 dígitos (impreso 4-5-4). Une los fragmentos que el OCR separa en una línea. **Correcciones por posición**: en el
  CUI O/Q/D→0, I/L/|→1, Z→2, S→5, G→6, B→8; en nombres 0→O, 1→I, 2→Z, 5→S, 6→G, 8→B. Toda corrección baja la confianza (×0,8) y
  **obliga a revisar**.
- **Validación**: 13 dígitos; los dos últimos pares = departamento (01–22) y municipio (01–40).
- **Nombres**: por las etiquetas «APELLIDOS / SURNAME» y «NOMBRES / GIVEN NAMES» con coincidencia aproximada; si no se leen, por
  orden (apellidos primero) con confianza ×0,7 y revisión.
- **Segunda pasada sobre los nombres** (`completarNombres`, Sprint 10): une las piezas que el OCR leyó por separado en la misma
  línea («REYES» + «ALVARADO»). Antes el apellido quedaba en la primera palabra y sin aviso.
- **Pendiente, no inventado**: (1) **dígito verificador del CUI** (no se conoce con certeza el algoritmo oficial; sale
  `verificador: "no_verificado"`); (2) **catálogo de municipios por departamento** (hoy solo la cota 01–40); (3) confirmar la
  disposición del documento real.
- **Limitaciones conocidas**: el modelo de reconocimiento es del alfabeto latino básico: **no produce Ñ ni tildes** («MUÑOZ» sale
  «MUNOZ»). A veces une dos palabras sin espacio («LUISLUCIA»): no se adivina dónde va el espacio (ver «Marcar más nombres para
  revisión», abajo).
- **Licencia de conducir**: no hay detección de licencia de conducir en el código; solo DPI.

Las reglas están fijadas por una **prueba de caracterización** (`src/dpi.caracterizacion.test.js`, 12 DPI sintéticos): con las
mismas líneas del OCR, la extracción tiene que dar exactamente lo grabado; de punta a punta, cero errores silenciosos.

## Privacidad (qué se promete y cómo se vigila)

- La **imagen** va en memoria (WebView → Rust → pipe → sidecar); **no se escribe a disco** ni se envía a ningún servidor.
  Pruebas: guardas de código en `ocr.rs` (sin red, sin disco, sin datos en los logs) y en el sidecar, y una prueba de punta a
  punta que comprueba que el sidecar no deja archivos con contenido.
- El **CUI y los nombres no van a los logs**: `ResultadoDpi` oculta esos campos en `Debug`; el único log del DPI
  (`linea_log_dpi`) lleva origen, banderas, conteos y milisegundos.
- La respuesta del sidecar **no incluye el texto crudo** del documento.

## Banco de prueba (60 DPI sintéticos)

```bash
# Modelos (una vez): node desktop/sidecar-ocr/scripts/fetch-models.mjs  (y npm --prefix desktop/sidecar-ocr ci --ignore-scripts)
node desktop/sidecar-ocr/fixtures-dpi/generar.mjs --out /tmp/dpi        # 60 DPI FICTICIOS, semilla 20261011
node scripts/eval-dpi/index.mjs --dir /tmp/dpi                           # reporte en scripts/eval-dpi/reportes/ (ignorado por git)
node --test scripts/eval-dpi/eval.test.mjs                               # pruebas de las métricas
```

Medido el 27/10/2026 en este repositorio (Linux, Intel Xeon 2,1 GHz × 4, 15,7 GB; sin otros procesos pesados):

| Métrica | Antes de la segunda pasada | Ahora |
|---|---|---|
| CUI exacto | 95 % (57/60) | 95 % (57/60) |
| Enviados a revisión | 11,7 % (7/60) | 11,7 % (7/60) |
| **Errores silenciosos** (CUI mal y sin marcar) | **0** | **0** |
| Nombres / apellidos exactos (sin tildes) | 78,3 % / 75 % | 81,7 % / 80 % |
| Nombre completo exacto (sin tildes) | 61,7 % (37/60) | 66,7 % (40/60) |
| Nombre completo mal y **sin** marcar | 20 | 17 |
| Tiempo por captura p50 / p95 | 819 / 979 ms | 771 / 936 ms |

Los 3 CUI que no salieron exactos (un DPI torcido y dos desenfocados) fueron a revisión. **Esto NO es evidencia de precisión
real**: son tarjetas dibujadas, limpias, con letra tipográfica y fondo uniforme; las fotos de garita (reflejos del plástico,
desgaste, fondo, tipografía real, dedos) son mucho más difíciles. Sirve como prueba de regresión y para medir tiempos.

### Marcar más nombres para revisión (medido, no activado)

Los 17 nombres mal y sin marcar son casi todos dos palabras pegadas («RICARDODANIELA», «VASQUEZESTRADA»). Se probó marcar para
revisión los apellidos de una sola palabra y las palabras de 11 letras o más: los nombres mal sin marcar bajan de 17 a 3, pero
los DPI enviados a revisión suben de **11,7 % a 35 %** (21/60). No se activó: es una decisión de producto (más toques del agente)
que conviene tomar con el conjunto **real**, donde el problema puede ser menor o mayor que con la letra sintética. El nombre
siempre está a la vista del agente en el formulario; lo que se audita como identidad es el CUI.

## Prueba con DPI REALES (pendiente; con consentimiento)

Los resultados sintéticos no son evidencia de precisión real. Para medirla hace falta un conjunto de DPI reales fotografiados
como en la garita. **No hay resultados con datos reales todavía: no se estiman ni se inventan.**

1. **Consentimiento escrito** de cada persona: para qué se usa la foto, quién la ve, cuánto tiempo se guarda y cómo pedir que se
   borre. Sin consentimiento no entra. Idealmente voluntarios del equipo y de la comunidad, no visitantes de una garita.
2. Mínimo **150 documentos** (idealmente 300) con **variedad**: personas con 1 y con 2+ nombres, apellidos con Ñ/tilde y
   compuestos («DE LEON»), DPI nuevos y viejos, plástico gastado, y fotos con la cámara real **de la garita** en sus condiciones
   (contraluz, noche, reflejos, ángulo, desenfoque, dedo tapando).
3. Un `verdad_terreno.csv` con `archivo,cui,nombres,apellidos` (y opcional `variante`), transcrito **dos veces por personas
   distintas** y reconciliado. Se acepta `,` o `;` (Excel en español) y comillas. Es el único archivo con datos personales en
   texto: tratarlo como dato personal.
4. **Dónde vive**: en un disco cifrado de una sola persona responsable, **fuera del repositorio**. El script se niega a correr si
   la carpeta está dentro del repositorio, y no envía nada a ningún servicio (el OCR corre en el mismo proceso, sin red).
5. **Correr** en el equipo de la garita o en uno equivalente:

   ```bash
   node scripts/eval-dpi/index.mjs --dir /ruta/cifrada/dpi-reales --real
   ```

   El reporte (`scripts/eval-dpi/reportes/eval-dpi-<fecha>.md|json`) **no lleva imágenes, nombres de archivo ni datos de las
   personas**: cada documento sale como `doc_001`, `doc_002`… y solo con aciertos y tiempos. Es lo único que se comparte.
6. **Al terminar**, borrar las fotos y el CSV, y conservar solo el reporte.

**Qué mirar en el reporte real**: errores silenciosos (deben ser **0**: un CUI mal que no se marcó para revisión), p95 por captura
**< 5 s** en un equipo de 6–8 GB (RNF-03), exactitud del CUI, tasa de revisión y nombres mal sin marcar. Si algo no alcanza, las
palancas son locales: umbrales (`UMBRAL_CONFIANZA_*` en `dpi.js` y `ocr.rs`), reglas de lectura, preprocesamiento de la imagen y
la marca de nombres de arriba. No se agregan servicios externos.
