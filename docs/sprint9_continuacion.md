# Sprint 9 — Continuación (rama `s9-continuacion`)

Trabajo autónomo en la nube sobre `origin/main` @ `3f3b57b` (11/10/2026). Todo vive en `s9-continuacion` y termina en un PR en borrador hacia `main`.
No se tocó producción, la VM, Cloud SQL ni secretos. Las pruebas de base de datos corrieron **solo** contra un Postgres 16 desechable local
(puerto 55432, base `securegate_test`; la guía pide 15, la diferencia no afecta: el esquema es el mismo). No hay Docker, webcam ni Windows en este entorno.

> Cada decisión ante una ambigüedad se anota aquí. El entorno de pruebas se verificó **antes** de empezar: la integración corre de verdad
> (322 pruebas, 23 suites, ninguna omitida) y `cargo test --lib` también (97 pruebas, tras instalar las bibliotecas de Tauri con apt).

## Resumen de estado

| Tarea | Tema | Estado |
|---|---|---|
| T0 | Estabilizar la línea base (2 pruebas dependían de la hora del día) | HECHO |
| T1 | Pagos: un pago resta su monto del saldo | HECHO |
| T2 | Interfaz `ProveedorPago` y preparación de Visanet | HECHO (la integración real queda PENDIENTE de documentación y credenciales) |
| T3 | Conjunto sintético y evaluador del DPI | HECHO |
| T4 | Extractor local del DPI en el sidecar | HECHO (precisión real SIN medir: solo hay datos sintéticos) |
| T5 | Integración en el escritorio (Rust + UI) y privacidad | HECHO |
| T6 | Decisión de diseño del puente de video | HECHO |
| T7 | Modelo de cámaras, credenciales y puente local | HECHO (sin probar con hardware real; el `ffmpeg.exe` de Windows no se ejecutó) |
| T8 | Descubrimiento ONVIF, alta de cámaras y visor | HECHO (sin probar con hardware real) |

## Línea base (antes de tocar nada, con las 2 correcciones de T0)

| Suite | Resultado |
|---|---|
| Backend `npm test` (unitarias) | 35 suites · **701** pruebas · verde |
| Backend integración + regresión (`npm run test:ci`, Postgres 55432) | 23 suites · **322** pruebas · verde |
| Backend `tsc --noEmit` | limpio |
| Frontend `npm test` · `npm run build` | 57 archivos · **443** pruebas · build verde |
| Desktop `npm test` · `npm run build` | 15 archivos · **109** pruebas · build verde |
| Rust `cargo test --lib --locked` | **97** pruebas (2 ignoradas) · verde |

---

## T0 — Línea base estable · **HECHO**
Con la hora de Guatemala entre las 18:00 y las 24:00 (el día de UTC ya cambió) fallaban dos pruebas de integración que ya estaban en `main`:
- `I-14` (filtros de la bitácora): el filtro `desde`/`hasta` del `GET /api/audit-logs` interpretaba el día en la zona de la **sesión de la base (UTC)**, no en la de
  Guatemala; quien elegía «hoy» a las 19:00 no veía lo de hoy. Corregido en `audit.controller.ts` (`AT TIME ZONE 'America/Guatemala'`).
- `I-17` (espejo de invitaciones QR): el margen de un día se contaba con `CURRENT_DATE` (UTC). Ahora se cuenta en Guatemala (`sync.controller.ts`).

## T1 — Pagos: un pago resta su monto del saldo · **HECHO**
Regla, casos, concurrencia y datos históricos: **`docs/pagos_saldo.md`**.
- Backend: `utils/saldo.ts` (centavos enteros, `bloquearSaldo`, `restarDelSaldo`, `ExcedeSaldoError`) y `pagos.controller.ts` (efectivo, aprobación de
  transferencias, tarjeta, aviso temprano al subir el comprobante). 422 con `codigo: EXCEDE_SALDO` y el saldo en el cuerpo.
- Interfaz: la advertencia de la tarjeta pasó de «el pago liquida tu saldo y el excedente no se acredita» a **bloquear** el monto mayor al saldo y explicar el
  pago parcial; el formulario del residente y el del administrador avisan antes de enviar; tras un pago parcial con tarjeta el portal muestra el saldo que
  queda, no cero. Textos ES/EN.
- Decisiones: (1) un monto con más de dos decimales es 400; (2) los cargos de reserva se saldan solo cuando el saldo llega a 0 (un pago parcial no elige a cuál
  cargo se aplica); (3) el comprobante se rechaza al subirlo **y** se vuelve a comprobar al aprobarlo; (4) el pago con tarjeta ahora abre transacción antes de
  autorizar (así se bloquea el saldo); una tarjeta rechazada hace `ROLLBACK`, sigue sin guardar nada.
- Pruebas nuevas: I-6 pasó de 11 a 29 casos (parcial/exacto/mayor × 3 métodos, centavos exactos, cargos de reserva, 3 pruebas de concurrencia, coherencia de
  reportes); unitarias del controlador (+4); pantalla (`PagoTarjeta`, `PagosPage`, nueva `ResidentePagosSaldo`).

## T2 — Interfaz de pasarela y preparación de Visanet · **HECHO**
- `backend/src/services/pagos/` (`proveedor.ts`, `simulado.ts`, `visanet.ts`, `index.ts`): interfaz `ProveedorPago`, la simulada de siempre y un adaptador de Visanet
  que lanza `ProveedorNoConfiguradoError`. El controlador (`pagarConTarjeta`) solo usa la interfaz; con la simulada todo se comporta igual (las pruebas que ya existían
  siguen verdes). Con `PAGOS_PROVEEDOR=visanet`: 503 controlado, nada se guarda, auditoría con `{proveedor, motivo}`.
- **Investigación (honesta):** la búsqueda abierta no encontró documentación pública de desarrollador. Lo único verificado: VisaNet Guatemala ahora es **NeoNet** (26/10/2023).
  No se inventó ningún endpoint, firma, 3-D Secure ni webhook. Todo lo demás está en `docs/visanet_integracion.md` (qué se sabe, qué falta, checklist del trámite del comercio con
  documentos, credenciales de sandbox, URLs de retorno y webhook, IPs).
- Decisión: la pasarela simulada ahora guarda su identificador (`SIM-<ult4>-A|R`) en `pagos.referencia`; es el único cambio visible respecto a antes.
- No se tocó `PAGOS_TARJETA_SIMULADA` ni `scripts/deploy.sh`.
- Pendiente para humanos: ver "Pendientes para humanos" (credenciales, contrato, documentación oficial de NeoNet).
- **Indicación del equipo durante la corrida:** todavía no hay autorización de Visanet; dejar la pasarela simulada y el adaptador «no configurado» como maquetas funcionales es lo esperado. No se avanzó más en esa integración.

> **Pruebas intermitentes ya existentes (no causadas por estas tareas):** `refresh.reuso.int` (I-19, ventana de gracia de 10 s) y `I-11 RESERVA_RECHAZADA`
> (la fecha de la reserva se elige al azar y a veces choca) fallaron una vez cada una bajo carga y pasan al repetir en solitario y en la suite completa (2 corridas verdes seguidas).
> Quedan como deuda: fijar la fecha de esas pruebas.

## T3 — Conjunto sintético y evaluador del DPI · **HECHO**
- `desktop/sidecar-ocr/fixtures-dpi/generar.mjs`: genera imágenes de DPI **ficticios** (tarjeta dibujada con `@napi-rs/canvas`, ya presente como dependencia de `ppu-paddle-ocr`) en
  escenas de webcam con 7 variantes (limpia, luz baja/alta, ángulo, ruido, desenfoque, mixta) + `verdad_terreno.csv`, con semilla. Sin imágenes versionadas (`salida/` está en `.gitignore`).
- `scripts/eval-dpi/index.mjs`: evaluador (motores `local`, `vision`, `ambos`). Métricas: exactitud del CUI y por campo (sin tildes y estricta), tasa de revisión manual, **errores silenciosos**,
  tiempo p50/p95 por captura y meta RNF-03. Vision se invoca por el backend real (`/api/ocr/dpi`, necesita `--backend` y `--token`; **no se ejecutó aquí**: no hay clave de Google ni backend desplegado).
- Corrida de extremo a extremo con el sidecar actual (que aún no extrae DPI): 60 imágenes, 0 % de exactitud esperado, 100 % a revisión, p50 421 ms / p95 536 ms. **Los modelos sí se pudieron descargar**
  (el espejo de GitHub funciona; Hugging Face no) y el sidecar corre aquí de verdad: la T4 se mide con OCR real.
- Pruebas: 7 del evaluador (`node --test scripts/eval-dpi/`) y 3 del generador (`npm --prefix desktop/sidecar-ocr test`). Se arregló el script de pruebas del sidecar: `node --test src/` no
  funciona en Node 22 (pasó a `node --test`, que descubre `*.test.js`).
- `onnxruntime-node` no pudo instalarse con scripts (`ECONNRESET` bajando binarios); con `npm ci --ignore-scripts` basta (trae el binario de CPU de Linux).

## T4 — Extractor local del DPI en el sidecar · **HECHO**
- `desktop/sidecar-ocr/src/dpi.js` (función pura sobre las líneas del OCR), `src/enderezar.js` y la operación `dpi` del sidecar (`server.js`, `reconocerDpi`). Devuelve CUI (13 dígitos, con formato 4-5-4),
  nombres, apellidos, **confianza por campo**, la lista de **correcciones** y `revision_obligatoria` con sus `motivos`. **No devuelve el texto crudo** ni la imagen.
- Correcciones por posición: en el CUI O/Q/D→0, I/L/|→1, Z→2, S→5, G→6, B→8; en nombres 0→O, 1→I, 2→Z, 5→S, 6→G, 8→B. Cualquier corrección baja la confianza y **obliga a revisar**.
  Validación: 13 dígitos exactos, departamento 01–22 y municipio 01–40.
- **Pendiente (no se inventó):** (1) el **dígito verificador del CUI** (posición 9): no conozco con certeza el algoritmo oficial; el resultado trae `verificador: "no_verificado"`; (2) el **catálogo de municipios por
  departamento** (se usa la cota 01–40; reemplazar por el catálogo oficial de RENAP); (3) confirmar con DPI reales la disposición supuesta (apellidos sobre nombres, etiquetas bilingües, CUI en 4-5-4).
- Hallazgos con el OCR real sobre el conjunto sintético: el detector junta renglones cuando el documento está torcido más de ~6° (letras sueltas, CUI «no encontrado»), así que se agregó un
  **enderezado** (perfil de proyección sobre una copia reducida, ~40 ms; en memoria, sin escribir a disco); el CUI sale en 3 fragmentos («7093» «67348» «1002») y se **unen por línea**; el modelo es del alfabeto
  latino básico: **no produce Ñ ni tildes** (se informa aparte la comparación estricta). Sobre los espacios entre palabras: con `spaceRecovery` parte nombres («G LO RIA»), sin él los pega («LUISLUCIA»);
  se eligió **sin él** (acierta más campos) y la pantalla siempre deja revisar.
- **Resultado sobre 60 imágenes SINTÉTICAS** (semilla 20261011; **NO es evidencia de precisión con DPI reales**): CUI exacto **95 %** (57/60), nombres 78 %, apellidos 75 %, revisión manual 11.7 %,
  **errores silenciosos 0** (los 3 CUI mal quedaron marcados: 14 dígitos o 1 dígito corrido), tiempo p50 536 ms / p95 632 ms por captura en 4 vCPU (meta RNF-03 de 5 s: **cumple con holgura**; en el equipo de 6–8 GB falta medirlo).
- Pruebas: 34 del sidecar (`npm --prefix desktop/sidecar-ocr test`: extractor, cada corrección, validación, enderezado y una de punta a punta que se omite sin modelos).
- Nota de entorno: los modelos ONNX se bajaron del espejo de GitHub (Hugging Face no es alcanzable desde aquí); el hash coincide con el fijado.

## T5 — Integración en el escritorio y privacidad · **HECHO**
Diseño, privacidad, cómo armar el conjunto real con consentimiento, el criterio de corte y cómo evaluar: **`docs/ocr_dpi_local.md`**.
- Rust (`ocr.rs`): `ocr_dpi_local`, `ocr_dpi_remoto` (respaldo; ahora devuelve `ResultadoDpi` y descarta `texto_completo`), **`ocr_dpi`** (política: local primero; remoto solo si el local falló o dudó **Y** hay red **Y** el equipo lo permite),
  `ocr_dpi_config`/`ocr_dpi_configurar`. Bandera por equipo `dpi_remoto_respaldo` en `config.json` (encendida por defecto; los `config.json` anteriores siguen cargando). `Debug` de `ResultadoDpi` oculta CUI y nombres; `linea_log_dpi` solo banderas.
- Origen del dato `origen_dpi` (`local`/`remoto`/`manual`): cola SQLite cifrada (migración idempotente), payload y **backend** (`registros_acceso.origen_dpi`, columna nueva en `init.sql`, prueba en I-3). Valor desconocido → NULL; `capturado_manualmente` sin origen → `manual`.
  Decisión: se tocó `POST /api/accesos` (no `/ocr/dpi`) para que el origen quede en el servidor y no solo en el equipo.
- UI: `GaritaPage` usa `api.ocr.dpi`; `VisitanteForm` muestra de dónde salió el dato y por qué revisar (frases sin jerga, sin repetir el número ni el nombre) y exige la casilla de confirmación cuando hay revisión obligatoria; la captura manual no cambió.
  Interruptor del respaldo remoto en *Cámaras de esta garita → Lectura del DPI*. La lista de recientes indica el origen.
- Pruebas: Rust **108** (+11: política del respaldo, sin red, parseo, privacidad del log, guarda de código sin disco, migración, config); vitest **121** (+12); sidecar **37** (incluye punta a punta de privacidad con un DPI ficticio); integración I-3 (+1).
- Hallazgo: las bibliotecas de imagen del OCR dejan en el directorio temporal `mat-debug-<pid>.log` (vacío) y `.ses` (marca de tiempo + UUID); no contienen datos y la prueba de privacidad las tolera explícitamente y exige que nada más quede.
- Sin probar con hardware real: la webcam y el flujo en Windows (el OCR local sí se ejerció con el modelo real en Linux).

## T6 — Decisión de diseño del puente de video · **HECHO**
Documento: **`docs/camaras_ip_diseno.md`** (comparación, números, decisión, riesgos, alternativas descartadas).
- **Decisión:** RTSP por un **sidecar ffmpeg mínimo LGPL propio** (3,3 MB `ffmpeg.exe` frente a 82,8 MB y GPLv3 del build popular, medidos); MJPEG/HTTP del celular **por proxy en Rust** (sin ffmpeg); ambos alimentan un **puente** que guarda el último fotograma en memoria y lo sirve por `127.0.0.1` con token efímero (vista previa) y por comando Tauri (captura para el OCR).
- **Medido** (Linux, 4 vCPU, mediamtx + ffmpeg `testsrc2`): 1 flujo 720p15→MJPEG 640 px a 10 fps = 5 % de un núcleo y 40 MB; 2 flujos = 10 % y 79 MB; 1080p25 = 10 % y 65 MB; captura de 1 fotograma 1080p desde RTSP = 1,25 s; H.265 funciona. Estimado para 6–8 GB: ≈1,0–1,2 GB propios con 2 cámaras.
- Se escribió y se **probó** `desktop/scripts/build-ffmpeg-min.sh` (Linux nativo ejecutado; Windows cruzado con mingw-w64: ejecutable PE válido de 3,3 MB, **no ejecutado**: no hay Windows ni Wine).
- Hallazgos útiles para T7: ffmpeg 6.1 no tiene `-rw_timeout` para RTSP (se usa un vigilante de inactividad propio); sigue redirecciones RTSP por su cuenta (`Status 30x: Redirecting to …` en stderr) → se vigila y se mata; mediamtx se descarga como asset de GitHub Releases (sirve de servidor RTSP de prueba).
- Alternativas descartadas: biblioteca nativa en Rust (sin decodificador H.264 libre de riesgo ni H.265, y sin forma de probarla aquí), mediamtx/go2rtc, GStreamer, libVLC, HLS y WebRTC directo.

## T7 — Modelo de cámaras, credenciales y puente local · **HECHO**
Código en `desktop/src-tauri/src/camaras/` (diseño en `docs/camaras_ip_diseno.md`). **Sin probar con hardware real**: ninguna cámara física ni Windows participaron.
- **`ssrf.rs`**: solo redes privadas (10/8, 172.16/12, 192.168/16) y link-local (169.254/16 salvo 169.254.169.254, el servicio de metadatos); IPv6 ULA/link-local. Rechaza localhost/loopback (salvo el puente propio, con puerto exacto), IP públicas, 0.0.0.0, multicast, broadcast, CGNAT, esquemas
  distintos de rtsp/http/https, `usuario:clave@` en la URL, nombres que resuelvan a UNA sola IP pública, y redirecciones a otro host. Se conecta a la **IP ya validada** (contra DNS rebinding) y se revalida en cada reconexión. Hallazgo: con esquemas «no especiales» como `rtsp://` la biblioteca
  `url` NO normaliza `2130706433` / `0x7f.0.0.1` / `127.1`: se re-analiza el host como `http://` para verlas como la IP real.
- **`credenciales.rs`**: usuario y clave **solo en el llavero** del sistema (`camara:<id>`); `Debug` ocultos; el frontend recibe `con_credenciales: bool`; no hay comando que las devuelva. **`modelo.rs`**: tabla `camaras` en el SQLite cifrado (tipo usb/ip/celular, nombre, URL, tareas, `device_id`) con un `CHECK` que impide `usuario@` en la URL y sin columnas
  de credenciales (se prueba). Una tarea usa una sola cámara.
- **`fuente.rs`**: interfaz `FuenteFotogramas` (último fotograma + estado + suscripción; base del OCR continuo del Sprint 10, **sin ANPR**), `Supervisor` con **reconexión con backoff exponencial** (1, 2, 4… 30 s ± jitter), estados `conectando / conectada / reconectando / caída`, **vigilante de inactividad** (10 s sin imagen → reconecta),
  y errores **permanentes** (credenciales malas, redirección, 404) que no se reintentan (reintentar bloquearía la cuenta de la cámara). Conector **RTSP** (ffmpeg como sidecar, vigila `Redirecting to` en stderr y mata el proceso) y **MJPEG/HTTP** (celular; `reqwest` con redirecciones manuales y misma IP).
- **`puente.rs`**: servidor en **127.0.0.1**, puerto aleatorio, **token efímero** de 256 bits (comparación en tiempo constante), valida `Host` (anti DNS-rebinding) y `Origin`, solo GET, encabezados ≤ 8 KB, 16 conexiones; `/v/<id>` (multipart para `<img>`) y `/f/<id>` (un JPEG). Comandos: `camaras_listar/guardar/eliminar/asignar/probar/puente_info/encender/apagar/estado` y
  `camara_ip_fotograma` (el JPEG para el OCR). CSP: solo se agregó `img-src http://127.0.0.1:*`.
- **Pruebas (+45 de Rust, 182 en total)**: 13 de SSRF (cada rechazo, trucos de URL, redirecciones), credenciales (llavero, tabla, JSON, Debug), 22 del divisor JPEG/backoff/supervisor (con reloj pausado: espera exponencial, caída, recuperación, vigilante, error permanente), 12 del puente (token, Host, Origin, métodos, rutas, 431/400, multipart),
  y 11 de integración: servidor **MJPEG simulado** (auth, redirecciones, 404, cortes, reconexión) y **ffmpeg mínimo real + mediamtx + cámara `testsrc2`** (JPEG válidos de 640×360, reconexión tras caer y volver, ruta inexistente = error permanente, puerto cerrado = temporal). Estas 4 se **omiten solas** si faltan `SG_FFMPEG` (por defecto
  `binaries/ffmpeg-<triple>`), `SG_MEDIAMTX` o un `ffmpeg` con libx264; aquí corrieron con mediamtx 1.12.0 (asset de GitHub Releases).
- Riesgos que quedan: la URL con credenciales va a ffmpeg por línea de comandos (visible para el mismo usuario de Windows mientras corre; mejora: proxy RTSP local); la validación de redirecciones RTSP depende del texto del log de ffmpeg; `rtsps://` no soportado (el ffmpeg mínimo no lleva TLS).
- `ffmpeg` mínimo: `tauri.conf.json` lo declara como `externalBin`; el CI de Rust crea un archivo vacío para compilar (como el de Node) y `prepare-sidecar` avisa si falta.

## T8 — Descubrimiento ONVIF, alta de cámaras y visor · **HECHO** (sin probar con hardware real)
- **Rust `camaras/onvif.rs`**: WS-Discovery (`Probe` a 239.255.255.250:3702 pidiendo `NetworkVideoTransmitter`, ~3 s). De cada respuesta solo se toma el **nombre** y el **modelo** de los scopes; la **IP sale del origen del paquete, nunca del XML** (una respuesta falsa no puede mandar a otra dirección);
  se descartan respuestas de IP no privadas, se acota el tamaño/texto y se deduplica. Comando `camaras_descubrir`. Sugiere `rtsp://<ip>:554/`: **no obtiene la ruta del video** (eso exige llamadas SOAP autenticadas al servicio de medios de cada cámara; queda como mejora). Una máquina con varias tarjetas de red solo manda el `Probe` por la ruta por defecto.
- **UI (escritorio)**: *Cámaras de esta garita → Cámaras IP y celulares*: lista, **Agregar / Editar / Quitar** (con confirmación propia, sin `window.confirm`), «Buscar cámaras en la red», dirección, usuario, contraseña (campo con «Mostrar»; al editar **no se vuelven a mostrar**: vacío = conservar, casilla para quitarlas) y **«Probar conexión»**:
  «Guardar» exige una prueba correcta con los datos actuales (cualquier cambio la invalida) y existe «Guardar sin probar» para una cámara apagada. El selector de cada tarea incluye las cámaras de red; **funcionan en las vistas de 1, 2 y 4**; la tarea se la quita a la cámara anterior (una tarea, una cámara).
- **Visor** (`CameraPane` + `useCamaraRed`): enciende la cámara en el puente, vigila su estado (cada 1,5 s), muestra el `<img>` del puente con token (**nunca la dirección real ni credenciales**) y se apaga al cerrar el panel (con cuenta de usos si dos paneles comparten cámara). **Captura para el OCR**: `camara_ip_fotograma` entrega el JPEG y la pantalla lo manda al mismo `ocr.placa`/`ocr.dpi`; el **QR** también funciona
  (se pide un fotograma cada ~700 ms y se pasa por jsQR).
- **Si una cámara cae**: la garita dice «Se perdió la señal de la cámara… Reintentando en N s» / «La cámara no responde» / «No se pudo usar la cámara» (contraseña mala: no se reintenta), y el agente puede **usar la webcam de este equipo** (y volver) o la **captura manual**, que nunca se quitó.
- **Pruebas**: Rust +11 (ONVIF: scopes, IP del origen, respuestas falsas, deduplicación, filtro de IP, respondedor UDP simulado); sidecar: **de punta a punta** una cámara RTSP simulada (mediamtx + la foto de una placa repetida) → ffmpeg mínimo con los **mismos argumentos que el puente** → el **mismo OCR local**: «123AB» se lee en el fotograma de la cámara igual que en la foto original (se omite sin mediamtx);
  vitest +31 (visor: en vivo, captura, error de captura, conectando, reconectando, caída permanente, cámara que no enciende, apagado con cuenta de usos; alta: prueba obligatoria, credenciales solo de ida, edición, rechazo de Rust, descubrimiento; configuración: lista, selector, confirmación; y **guardas** que impiden que una credencial de cámara aparezca en los tipos que devuelve Rust o en otro componente).
- Decisión: el `useCamara` USB y su localStorage no cambiaron; la asignación de cámaras de red vive en Rust (`tareas`) y el resolvedor de pantalla mira primero ahí. Nota de pruebas: un `beforeEach` que *devuelve* una función la ejecuta al terminar (con `mockReset()` eso llamaba al mock): se escriben con llaves.
- Pendiente (hardware real): cámaras reales con Digest, perfiles ONVIF raros, H.265 de fabricantes concretos, `rtsps://` (no soportado), y la ruta del video por ONVIF (GetStreamUri).
