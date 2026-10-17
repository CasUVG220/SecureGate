# ANPR continuo (Sprint 10)

Reconocimiento continuo de placas para una cámara IP fija en el carril. El modo por clic («click-to-capture») sigue existiendo
y es el respaldo en todos lados. Este documento se escribió **antes** de programar (exploración y plan) y se completa tarea por
tarea; cada sección dice qué está hecho, qué quedó detrás de bandera y qué falta validar con hardware real.

> **Estado:** en curso. Ver «Estado por tarea» al final.

## 1. Exploración (resumen, sin cambios de código)

| Pieza | Dónde | Lo que importa para ANPR |
|---|---|---|
| `PRODUCT.md` | — | **No existe en el repo** (ya lo decían `docs/saas_nucleo.md` y `docs/sprint9_continuacion.md`). Se crea en la tarea 8 con lo verificable del README y lo nuevo de ANPR. |
| Puente de cámaras | `desktop/src-tauri/src/camaras/` (`docs/camaras_ip_diseno.md`) | `FuenteFotogramas` entrega el **último JPEG en memoria** y su estado; `esperar_fotograma` da el más nuevo sin colas. ffmpeg mínimo LGPL (RTSP→MJPEG 960 px, 10 fps) o proxy MJPEG. Credenciales en el llavero, SSRF validado. ANPR consume esta interfaz: **no abre otra conexión a la cámara**. |
| OCR local | `desktop/sidecar-ocr/src/server.js` | Proceso Node hijo de Tauri, JSON por líneas, `ppu-paddle-ocr` (PP-OCRv5 mobile det + rec «en») sobre `onnxruntime-node` 1.30 (CPU). Atiende en serie; nunca escribe a disco (`privacidad.test.js` lo vigila). Modelos fuera de git, descargados por `scripts/fetch-models.mjs` con SHA-256 fijo. |
| Regex de placa | `desktop/src/lib/placa.ts` | Prefijo 1–3 letras + 3 dígitos + 3 letras; corrección por posición O/0, I/1, B/8…; `correcciones > 0` ⇒ `requiereRevision`. Vive en TypeScript (WebView); el sidecar no la tenía. |
| Ciclo de vida del sidecar | `desktop/src-tauri/src/ocr.rs` | `asegurar_arrancado` lanza `node server.js --models …`, espera `{"evento":"listo"}`, correlaciona respuestas por `id`, 20 s de tope por inferencia. |
| Base local | `desktop/src-tauri/src/db.rs` | SQLCipher (AES-256, clave Argon2id de huella + licencia). Espejo: `residentes_local`, `blacklist_local` (DPI o placa), `preautorizaciones_local`, `invitaciones_qr_local`; cola `accesos_pendientes` (payload exacto del POST, `id_cliente` UUID). Migraciones idempotentes por columna. |
| Cola offline | `desktop/src-tauri/src/sync.rs` | Push cada 30 s con backoff 5 s→10 min; 2xx = sincronizado, 4xx de negocio = rechazado (visible), red/sesión = detener. Pull completo de `GET /sync/garita` cada 5 min. |
| Talanquera | `desktop/src-tauri/src/hardware/` | Trait `TalanqueraDriver` (relé USB, Ethernet TCP/HTTP, GPIO stub). Regla: un fallo de apertura **nunca** revierte un acceso registrado. |
| Snapshot | `backend/src/controllers/sync.controller.ts` | Doble llave (JWT de agente + licencia del equipo, misma sucursal). Pull completo, sin versionado. Empresa suspendida ⇒ 423 desde `verifyLicencia`. |
| `registros_acceso` | `database/init.sql` | `visitante_id NOT NULL` (todo acceso era de un visitante); `origen IN ('web','desktop')`; `id_cliente` único = idempotencia. Migraciones en el mismo `init.sql`, idempotentes (`DO $$ … EXCEPTION`). **No existe una tabla de vehículos de residentes** (`vehiculos` cuelga de `visitantes`). |
| Auditoría | `backend/src/middleware/audit.middleware.ts` | `auditLog({accion})` escribe al terminar con el código HTTP; detalle en `res.locals.auditoria`. Toda acción nueva va en `docs/acciones_sensibles.md` y en las traducciones de la web (lo vigilan `auditoria.cobertura.test.ts` y `auditoria.test.ts`). |
| Configuración por equipo | `desktop/src/lib/camaras.ts`, `ThemeContext.tsx`, `config_hardware` | Tema y disposición de cámaras en `localStorage` del WebView (del puesto, no del agente); talanquera y cámaras IP en SQLCipher (del equipo). |

Línea base antes de tocar nada (22/10/2026, este contenedor): backend unitarias 834/834; integración 426/427 (un fallo
intermitente en `contacto.int.test.ts` que no se repite al reintentar, preexistente); escritorio Vitest 168/168; frontend
576/576; `cargo test --lib` 205 (2 ignoradas); sidecar `node --test` 37 (1 omitida: necesita mediamtx).

## 2. Decisiones de arquitectura

1. **Proceso aparte para ANPR** (`sidecar-ocr/src/anpr/servidor.js`, mismo runtime Node empaquetado). El OCR por clic sigue en su
   proceso y con su cola: ANPR no le roba turnos ni puede tumbarlo. «Pausar ANPR» mata solo este proceso. Coste: RAM de un
   segundo motor de OCR (se mide en la tarea 7).
2. **Los fotogramas los entrega Rust** desde `FuenteFotogramas` (JPEG en base64 por stdin). El sidecar contesta con el fps que
   quiere (1 fps en reposo, 5 fps con movimiento) y Rust lo respeta: en reposo no se decodifica nada de más.
3. **Detector: YOLOX-Nano** (Megvii, **Apache-2.0**), ONNX oficial 416×416. Ultralytics YOLOv5/v8/v11 son AGPL-3.0 y
   YOLOv6/v7/v9 GPL-3.0: descartados por licencia. Clases COCO útiles: `car`→carro, `motorcycle`→moto, `bus`→bus,
   `truck`→camión. COCO no separa «camioneta»: una pickup sale como `car` o `truck`; la clase es informativa y no cambia la decisión.
4. **Regex de placa en el sidecar**: copia en JS de `desktop/src/lib/placa.ts`, con una prueba de paridad en Vitest que compara
   ambas sobre el mismo corpus (si una cambia sin la otra, falla).
5. **La decisión es de Rust** contra el espejo SQLCipher: funciona sin internet y reusa la cola `accesos_pendientes`.
6. **Evidencia** (recorte de placa y de la parte baja del vehículo, JPEG): el sidecar la devuelve en memoria, Rust la guarda
   **cifrada en SQLCipher** y la purga a los 7 días; se sube al backend después de sincronizar el acceso. El sidecar sigue sin
   escribir a disco.
7. **Modelo de datos**: tabla nueva `vehiculos_residentes` (placa normalizada, vigencia, versión para sincronizar cambios);
   `registros_acceso.visitante_id` pasa a admitir NULL **solo** cuando el acceso es de un vehículo de residente (CHECK).
8. **Configuración por carril** en SQLCipher (`carriles_anpr`, del equipo como la talanquera y las cámaras), con la bandera
   global «Pausar ANPR» en `meta`. Carril nuevo: `apagado`; al habilitarlo el modo por defecto es `automatico` (decisión del equipo).
9. **Actuador**: trait `ActuadorBarrera` con `Simulado` (registro + señal en la UI), `ReleHttp` (URL, método, timeout, un solo
   reintento; solo direcciones privadas, mismo validador SSRF que las cámaras) y un adaptador a la talanquera ya configurada.
   Un fallo del actuador es una alerta, nunca deshace el registro.

## 3. Barandas (sección 0 del sprint)

Se auto-autoriza **solo si todo** se cumple: placa en `vehiculos_autorizados_local` activa y vigente hoy, residente activo en el
espejo, fuera de lista negra, licencia utilizable (empresa no suspendida), consenso alcanzado y **ninguna** corrección por
posición en las lecturas ganadoras. Lista negra ⇒ alerta visible y sonora, nunca abre. Desconocida, ilegible o corregida ⇒
verificación del agente con la evidencia. Un evento por pista; 60 s de enfriamiento por placa. Modo por carril
`apagado | verificacion | automatico`.

## 4. Plan por tarea

| # | Entregable | Pruebas |
|---|---|---|
| 1 | `anpr/reloj.js`, `anpr/roi.js`, `anpr/movimiento.js`: diferencia de grises suavizada dentro del ROI, histéresis, fps de reposo | `node --test` con fotogramas sintéticos y reloj falso |
| 2 | `anpr/detector.js` (letterbox, decodificación YOLOX, NMS, filtro ROI), `fetch-models.mjs` con YOLOX-Nano y SHA-256, `test-fixtures/anpr/` | post-proceso con tensores fijos; detección real sobre los clips (se omite sin modelos) |
| 3 | `anpr/tracker.js`: IoU + centroide, pérdida tolerada, máquina de estados, una decisión por pista, enfriamiento | trayectorias sintéticas (a)–(e) |
| 4 | `anpr/consenso.js`, `anpr/placa.js`, `anpr/evidencia.js`, `anpr/carril.js`, `anpr/servidor.js` | lecturas simuladas; regresión del OCR por clic |
| 5 | Migración + `vehiculos_residentes` + `/sync/garita` versionado + `POST /accesos/anpr*`; Rust `anpr/` (decisión, actuador, eventos, motor) | Jest unitarias + integración (Postgres); `cargo test` de cada rama |
| 6 | Panel ANPR en la garita, lista de eventos, «Corregir», alertas, configuración por carril con ROI dibujable, «Pausar ANPR» | Vitest/RTL, accesibilidad básica |
| 7 | `desktop/scripts/medir-anpr.mjs` | reporte reproducible |
| 8 | E2E con clip de ffmpeg, CI, documentación final | — |

## 5. Deuda técnica encontrada (para el informe)

Se llena con cada `refactor(...)` que haga falta.

## 6. Estado por tarea

| Tarea | Estado | Bandera | Pendiente |
|---|---|---|---|
| 1 Movimiento y ROI | pendiente | — | — |
| 2 Detector | pendiente | — | — |
| 3 Tracker | pendiente | — | — |
| 4 Consenso y evidencia | pendiente | — | — |
| 5 Decisión y actuador | pendiente | — | — |
| 6 Interfaz | pendiente | — | — |
| 7 Medición | pendiente | — | — |
| 8 Pruebas integradas y docs | pendiente | — | — |
