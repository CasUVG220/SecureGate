# OCR 100 % local: se retira Google Cloud Vision (Sprint 10)

**Decisión del equipo.** SecureGate lee las placas con OCR local desde el Sprint 8 y el DPI (CUI y nombre) desde el Sprint 9.
El OCR de Google Cloud Vision quedaba solo como **respaldo remoto opcional** del DPI (y como el OCR de las páginas web de garita,
que ya no tienen ruta). Se elimina por completo: el producto se instala **sin ninguna cuenta ni cobro externo de OCR** y **las
imágenes del DPI no salen del equipo de la garita**. Las empresas dudaban por el costo por lectura de Google.

Este documento es el único lugar del repositorio donde quedan las notas históricas de ese servicio.

## Qué se conserva (no se borra ni se degrada)

- **El motor de OCR**: `ppu-paddle-ocr` (PP-OCRv5 sobre ONNX Runtime) en el sidecar (`desktop/sidecar-ocr`). Es un modelo general
  y preentrenado (no está entrenado «con DPI»); no se cambia ni se reentrena.
- **Las reglas de lectura del DPI** (`desktop/sidecar-ocr/src/dpi.js`), que es lo específico del DPI:
  - CUI: la línea con 13 dígitos (impreso 4-5-4); corrección de confusiones **por posición** (O/Q/D→0, I/L→1, Z→2, S→5, G→6,
    B→8), máximo 3 correcciones; validación de 13 dígitos, departamento 01–22 y municipio 01–40; el dígito verificador **no se
    inventa** (`verificador: 'no_verificado'`).
  - Nombres y apellidos: por las etiquetas bilingües («APELLIDOS / SURNAME», «NOMBRES / GIVEN NAMES») con coincidencia
    aproximada y, si faltan, por la posición de las líneas; corrección dígito→letra en los nombres.
  - Confianza por campo (la del OCR, rebajada por cada corrección o inferencia) con umbrales (CUI 0,80; nombres 0,65);
    `revision_obligatoria` y `motivos` (`cui_corregido`, `cui_invalido`, `cui_confianza_baja`, `nombres_por_posicion`…).
  - En el sidecar (`reconocerDpi`): enderezado de la foto torcida y segundo intento sin girar; el resultado nunca trae el texto
    crudo ni la imagen.
- **La pantalla de la garita**: el DPI y el nombre quedan siempre en el formulario, editables; una lectura dudosa exige que el
  agente la confirme contra el documento; `capturado_manualmente` y `origen_dpi` viajan al backend para la auditoría.
- **La placa**: expresión regular y correcciones de la placa guatemalteca (`desktop/sidecar-ocr/src/anpr/placa.js`, igual a
  `desktop/src/lib/placa.ts`), la captura por clic y el ANPR. No cambian.
- **Licencia de conducir**: **no existe** detección de licencia de conducir en el código (solo DPI). No había nada que conservar
  ni que retirar; queda como posible trabajo posterior.

## Qué se elimina

| Dónde | Qué hacía | Qué se hace |
|---|---|---|
| `backend/src/controllers/ocr.controller.ts` | Llamaba a `vision.googleapis.com/v1/images:annotate` (TEXT_DETECTION) con la clave en el header, mapeaba los errores de Google y extraía nombre/DPI y placa del texto | Se borra |
| `backend/src/routes/ocr.routes.ts` | `POST /api/ocr/dpi` y `POST /api/ocr/placa` (auditados como `OCR_DPI`, `OCR_PLACA`) | Se borra |
| `backend/src/routes/index.ts` | Montaba `/api/ocr` con un límite propio por usuario (`RATE_LIMIT_OCR_MAX`, bloqueo auditado como `OCR_ESCANEO`) | Se quitan la ruta y el límite |
| `backend/src/app.ts` | `/api/ocr` admitía cuerpos de 8 MB (imágenes) | Se quita de la lista |
| `GOOGLE_CLOUD_API_KEY` | En `.env.example`, `backend/.env.example`, `docker-compose.yml`, `docker-compose.prod.yml` y el README | Se quita (la validación de entorno no la leía). El equipo la quita del `.env` del servidor |
| Pruebas del backend | `ocr.controller.test.ts` (camino remoto); casos de `/api/ocr` en `auditoria`, `limites` y el contrato de rutas | Se borran esos casos, nada más |
| `backend/securitytest/09-ratelimit.js` | Escenario `RL-ocr` (32 llamadas al proxy de OCR) | Se quita el escenario; los resultados JSON ya guardados quedan como histórico |
| `desktop/src-tauri/src/ocr.rs` | `ocr_dpi`: local primero y, si dudaba o fallaba, hay red y el equipo lo permitía, mandaba la foto al backend (`/ocr/dpi`). Comandos `ocr_dpi_remoto`, `ocr_dpi_config`, `ocr_dpi_configurar` | `ocr_dpi` solo local; se borran el respaldo y sus comandos |
| `desktop/src-tauri/src/config.rs` | `dpi_remoto_respaldo` (permitir el respaldo en este equipo) | Se borra (un `config.json` viejo con el campo sigue cargando) |
| `desktop/src` (React) | Interruptor «Usar el servicio remoto si este equipo no logra leer el DPI», aviso «se usó el respaldo remoto», origen «leído por el servicio remoto», y el botón **Leer DPI** que exigía red | Se retiran; el DPI se lee sin internet |
| `frontend/src/services/api.ts`, `GaritaPage.tsx`, `SalidaPage.tsx` | Las páginas web de garita (sin ruta desde que los agentes usan la app de escritorio) escaneaban DPI y placa con el backend | Se quitan el escaneo remoto y sus llamadas; quedan con captura a mano |
| `scripts/eval-dpi` | Motor `vision` (comparar contra el backend, una llamada pagada por imagen) | Se borra el motor; queda el local |
| Documentación y textos comerciales | README (OCR «vía Google Cloud Vision»), `docs/ocr_dpi_local.md`, `desktop/README.md`, el landing («hay respaldo remoto») | Se reescriben: OCR 100 % local |

## Qué se conserva del pasado (sin migrar datos)

- `registros_acceso.origen_dpi` admite `'local' | 'remoto' | 'manual'` (restricción CHECK de `database/init.sql`). Las filas
  viejas con `'remoto'` se quedan como están; el backend sigue **aceptando** `'remoto'` para no rechazar un acceso viejo que una
  garita tenga en su cola sin red, pero ninguna parte del sistema lo produce ya.
- La bitácora (`audit_logs`) conserva sus filas `OCR_DPI`, `OCR_PLACA` y `OCR_ESCANEO`; la web sigue sabiendo mostrarlas.
- No se tocaron facturación, planes ni precios.

## Lo que NO es OCR y queda (aparece si se busca «google»)

Una búsqueda de «google» en el repositorio todavía encuentra cosas que no tienen que ver con el OCR. Quitarlas rompería otras
partes y no es parte de esta decisión:

- **Google Fonts**: la web carga la fuente Outfit de `fonts.googleapis.com` (`frontend/src/main.tsx`, la CSP de
  `nginx/nginx.conf.template`, `docs/landing.md`); la app de escritorio ya la trae empaquetada (`desktop/src/index.css`).
- **Google Authenticator** como ejemplo de app de autenticación (verificación en dos pasos: `backend/src/utils/twofa.ts`, textos
  de la web, `docs/verificacion_dos_pasos.md`) y **Google Sheets** como ejemplo de hoja de cálculo en Reportes.
- **Infraestructura del servidor en Google Cloud**: respaldos a Cloud Storage (`scripts/backup-postgres.sh`,
  `GOOGLE_APPLICATION_CREDENTIALS` en el README), migración a Cloud SQL (`scripts/migrate-to-cloudsql.sh`) y la nota de NTP de
  la VM. Es el hospedaje del backend, no el OCR.
- **Evidencia generada por herramientas**, que no se edita a mano: los resultados ya guardados de
  `backend/securitytest/results/` (`09-ratelimit.json` y su copia en `antes/` registran la prueba de límite del proxy de OCR
  del 29/09/2026) y `gitleaks-historial.json` (copia de mensajes de commits viejos). Editarlos falsearía la evidencia; se
  regeneran solos la próxima vez que se corra `npm run securitytest` (que ya no tiene esa prueba). El historial de git tampoco
  se reescribe.

Los informes históricos escritos a mano (`SECURITY_REVIEW.md`, `docs/qa_backlog_s9.md`, `docs/sprint9_continuacion.md`)
conservan lo que pasó, pero ahora nombran «el OCR remoto del proveedor» y remiten a este documento, que es el único que guarda
los nombres del servicio y de la variable.

Una búsqueda de «vision» como **palabra** (`git grep -wi vision`) solo encuentra este documento y esa evidencia generada;
buscada como trozo de palabra encuentra también «revisión», «provisional» o «aprovisionamiento».
Las dos búsquedas encuentran además `desktop/src/lib/__tests__/textos.ocr.test.ts`: es la prueba que vigila que ningún texto
de la app de escritorio vuelva a nombrar el OCR remoto, así que lleva el término como regla.

## Garantía: pruebas de caracterización

Antes de borrar nada se fijó el comportamiento del camino local del DPI con 12 DPI **sintéticos y ficticios**
(`desktop/sidecar-ocr/fixtures-dpi/generar.mjs`, semilla 2026):

- `desktop/sidecar-ocr/src/dpi.caracterizacion.test.js`:
  1. con las líneas del OCR grabadas (`fixtures-dpi/caracterizacion.json`), las reglas del DPI dan **exactamente** el CUI, los
     nombres, la validez, la revisión y los motivos grabados (sin modelos: corre en cualquier equipo);
  2. punta a punta con los modelos (enderezado + OCR + reglas): **cero errores silenciosos** y al menos la exactitud grabada
     (11 de 12 CUI exactos, 1 a revisión; un documento de margen entre CPU distintas).
- Las pruebas del extractor (`dpi.test.js`) y las de la app (`ocr.rs::tests_dpi`, formulario del visitante) siguen igual.

Se vuelve a grabar (`node fixtures-dpi/caracterizar.mjs`) solo si una regla cambia **a propósito**, explicándolo en el commit.
