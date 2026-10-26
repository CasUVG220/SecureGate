# SecureGate Garita — app de escritorio (Tauri 2)

App nativa para la PC de garita: activación por licencia + huella de hardware,
login de agente, espejo local cifrado (SQLCipher), cola de accesos offline,
webcam USB y OCR de placas 100 % local. El contexto de producto y las
decisiones de arquitectura están en `../PRODUCT.md`; cada módulo Rust en
`src-tauri/src/` documenta la suya en su cabecera.

## Requisitos

- Node 20+ y Rust estable (`rustup`).
- Windows: Visual Studio Build Tools (C++) y WebView2 (viene con Windows 11).
- macOS solo para desarrollo (Xcode CLT).

## Desarrollo

```bash
npm install
npm --prefix sidecar-ocr install
npm run sidecar:prepare          # copia node + modelos a src-tauri/ para el host actual
npm run tauri dev
```

La URL del backend se configura en la pantalla de activación (por defecto
`http://localhost:3000`, o la variable `SECUREGATE_API_URL` al primer arranque). Para probar la activación necesitas un código:
`POST /api/licencias` como admin de sucursal en el backend.

## Cámaras de la garita

La garita tiene **cuatro tareas** y cada una puede usar una cámara distinta
(`src/lib/camaras.ts`):

| Tarea | Para qué | Cómo funciona |
|---|---|---|
| **QR** | La invitación que el residente mandó al visitante | Escaneo continuo (jsQR): el agente no pulsa nada. Sólo lee códigos con prefijo `SGQR:` y UUID, para no consultar al servidor por cualquier etiqueta. **Funciona sin internet** con la copia local de las invitaciones de la sucursal (se baja en cada sincronización); ver `docs/qr_sin_conexion.md` para qué pasa si una invitación se revoca sin red. |
| **Placa** (entrada) | Placa del vehículo que entra | Captura a demanda → OCR local (sidecar). **Funciona sin internet.** |
| **DPI** | Documento del visitante | Captura a demanda → OCR local (sidecar). **Funciona sin internet** y la foto nunca sale del equipo (no hay OCR remoto). Una lectura dudosa llega con los campos marcados «Revisar» y la foto capturada para comparar; ver `docs/ocr_dpi_local.md`. |
| **Salida** | Placa del vehículo que sale | Captura → OCR local → busca el acceso abierto con esa placa y lo cierra. **Requiere conexión.** |

### Cámaras IP y celular (SCRUM-119 y SCRUM-120)

Además de las webcams USB, cada tarea puede usar una **cámara IP** (RTSP/ONVIF, de seguridad) o un **celular** que transmita por la red local.
Se agregan en **Cámaras de esta garita → Cámaras IP y celulares**: «Buscar cámaras en la red» (descubrimiento ONVIF), dirección, usuario y
contraseña, y **«Probar conexión»** antes de guardar. Después se asignan a cualquiera de las 4 tareas desde el mismo selector que las USB y
funcionan en las vistas de 1, 2 y 4. La captura de fotograma para el OCR usa **el mismo OCR** que la webcam.

- Diseño, números y alternativas: `docs/camaras_ip_diseno.md`. Todo corre en `src-tauri/src/camaras/`.
- **Seguridad:** solo se aceptan direcciones de redes privadas (anti-SSRF); la contraseña vive en el **llavero del sistema** (nunca en SQLite ni en el
  WebView ni en logs); la vista previa sale por un puente local (`127.0.0.1`, token efímero) y nunca por la dirección real de la cámara.
- **Si una cámara cae** la pantalla lo dice (reconectando / sin señal) y el agente puede seguir con la webcam de este equipo o la captura manual.
- **ffmpeg** (RTSP): un build mínimo LGPL de ~3 MB que se compila con `scripts/build-ffmpeg-min.sh windows|linux` y se empaqueta como sidecar. Sin él, las
  cámaras USB y los celulares MJPEG siguen funcionando; solo las RTSP no.
- **Sin probar con hardware real:** las pruebas usan servidores simulados (mediamtx + `testsrc2`, un servidor MJPEG propio y un respondedor ONVIF).

### Qué necesita red y por qué

El QR y la salida van contra el servidor a propósito. La vigencia de un QR,
sus usos restantes y su revocación viven allí, y un espejo local dejaría
pasar uno ya gastado; la entrada que se cierra en una salida pudo registrarla
otra garita o la web, y el espejo local sólo guarda lo que salió de ESTE
equipo. Sin red, el camino manual (DPI + formulario) sigue funcionando
offline como siempre, que es la promesa que sí se mantiene.

**Decisión (SCRUM-111): la salida se queda en línea.** La cola offline
(`accesos_pendientes`) solo guarda ENTRADAS: no hay un espejo de los accesos
abiertos ni un endpoint idempotente para cerrar una salida pendiente, y una salida
encolada contra un acceso que otra garita ya cerró (o que aún no se sincroniza)
dejaría vehículos «dentro» para siempre o cerraría el acceso equivocado. Hacerla sin
red exigiría ese espejo y esa idempotencia; mientras tanto, sin conexión el agente
levanta la pluma con «Abrir talanquera» y registra la salida al volver la red. La
pantalla lo dice con texto visible en vez de apagar el botón sin explicar.

### Sin cámara

Si la cámara falta, está ocupada o el permiso se negó, nada se bloquea:

| Tarea | Alternativa manual |
|---|---|
| **QR** | «¿No se lee? Escribe el código»: acepta el texto que el residente ve bajo su QR (`SGQR:<id>`, o el id solo, con o sin guiones). También funciona sin internet, con la copia local. |
| **Placa** | «Escribir placa» lleva el cursor al campo de la placa del formulario. |
| **DPI** | Se escribe en el formulario (13 dígitos); queda marcado «capturado manualmente». |
| **Salida** | «Escribir placa» abre el diálogo de salida; o «Dar salida» en la lista **Registrados en este equipo**, que además se puede buscar por nombre, DPI, placa o casa. |

Cada botón apagado muestra debajo el motivo («No hay cámara disponible…»,
«Sin conexión…», «El OCR local no está disponible…»). Con la vista única en
«Salida», el panel derecho pasa a «Registrar salida» y deja de hablar de entradas.

### Disposición: 1, 2 ó 4 vistas

El agente elige cuántas vistas previas quiere a la vez con el selector
`1 · 2 · 4` de la cabecera del panel (o en el diálogo de configuración):

- **1** — una vista grande; se cambia de tarea con pestañas. Sólo una cámara
  encendida: es lo más ligero para el equipo.
- **2** — dos vistas lado a lado, cada una con su selector de tarea.
- **4** — las cuatro tareas a la vez, en 2×2.

No es sólo estético: **cada vista mantiene una cámara encendida**. Cuatro
cámaras UVC en el mismo hub USB pueden agotar el ancho de banda del bus y
alguna no abrirá (`NotReadableError`), así que 1 y 2 siguen siendo opciones
legítimas según el hardware de cada garita. Si hay menos cámaras conectadas
que vistas, la app lo avisa y varias mostrarán la misma imagen.

La asignación (qué dispositivo va a qué tarea) y la disposición se guardan en
el localStorage del equipo — son configuración de la garita, no del agente
que tiene el turno.

Con una sola cámara conectada, las cuatro tareas la comparten (el
comportamiento anterior). Si la cámara asignada se desconecta, la app lo
avisa en vez de leer con otra en silencio; con una sola cámara disponible
cae a esa para no dejar la garita a ciegas.

## Talanquera: hardware de apertura

`src-tauri/src/hardware/` es una capa de abstracción: la app habla sólo con
el trait `TalanqueraDriver` y cada relé es un adaptador. Detalle de
protocolos, decisiones y el patrón para añadir uno nuevo en la cabecera de
`hardware/mod.rs` y en PRODUCT.md.

- **Relé USB serial** (`serial.rs`): LCUS/CH340 por defecto (`A0 01 01 A2`),
  ASCII `ON1\r\n`, o hex personalizado. Auto-detecta el puerto por VID
  (CH340 → FTDI → CP210x → PL2303); si hay varios se elige en la UI.
- **Relé Ethernet** (`tcp.rs`): comando de texto libre por TCP o GET/POST
  HTTP; timeout 2 s con un reintento.
- **GPIO** (`gpio.rs`): stub "no soportado" (ver por qué en el archivo).

La configuración se guarda en `config_hardware` de la SQLite cifrada
(diálogo "Configuración de hardware", con "Probar apertura"). Sin driver,
la app funciona igual. Al registrar entrada o salida se abre sola; si falla,
el acceso queda registrado y el agente ve "abre manual". Botón "Abrir
talanquera" en la cabecera para abrir sin registrar.

Para probar sin relé físico: `nc -l 6722` (o `python3 -m http.server 8080`)
y configurar un relé Ethernet apuntando a `127.0.0.1`.

## Cámara: qué necesita cada plataforma

La captura corre en el WebView con `getUserMedia` (`src/hooks/useCamera.ts`).
Lo que cambia por sistema es que el SO deje llegar la petición:

| Plataforma | Qué hace falta | Dónde |
|---|---|---|
| **macOS** (desarrollo) | `NSCameraUsageDescription`. Sin esa clave TCC niega la cámara **sin mostrar diálogo** y `getUserMedia` rechaza con `NotAllowedError`; con ella macOS pregunta la primera vez y lo recuerda. Tauri fusiona el archivo con el Info.plist que genera: `tauri dev` lo embebe en el binario (`tauri-codegen`), `tauri build` lo copia al `.app`. | `src-tauri/Info.plist` |
| **Windows** (producción) | WebView2 dispara `PermissionRequested` al pedir la cámara. `wry` sólo auto-concede el portapapeles; sin handler, WebView2 muestra su propio diálogo "localhost quiere usar tu cámara" en cada arranque. Se concede desde Rust, sólo para `COREWEBVIEW2_PERMISSION_KIND_CAMERA`. | `src-tauri/src/camera.rs` |
| **Ambas** | CSP con `media-src mediastream:` para que el `<video>` acepte el stream. | `src-tauri/tauri.conf.json` |

**No hay nada que declarar en `src-tauri/capabilities/`**: el ACL de Tauri 2
gobierna qué comandos IPC y plugins puede invocar el WebView, no los permisos
del navegador embebido (cámara, micrófono, geolocalización). Buscar un permiso
`core:…:camera` ahí es una pista falsa.

Si la cámara falla por cualquier motivo, la vista previa muestra el error
concreto (`NotAllowedError`, `NotFoundError`, `NotReadableError`…) traducido a
qué hacer (`src/lib/camara.ts`) y el formulario manual sigue disponible.

Para volver a probar el diálogo de macOS como "primera vez":
`tccutil reset Camera com.securegate.garita`.

## Design system

Es el mismo de la web y se comparte en dos niveles:

- **Tokens, Tailwind y CSS base — importados, no copiados.**
  `tailwind.config.ts` hace `import base from '../frontend/tailwind.config'`
  y `src/index.css` hace `@import '../../frontend/src/index.css'`. Un cambio
  de paleta, radio o tipografía en la web llega aquí en el siguiente build.
- **Componentes React (`src/components/ui/`) — copia byte a byte** de
  `frontend/src/components/ui` hecha por `npm run ui:sync`. No se importan
  desde `../frontend` porque resolverían `react` desde
  `frontend/node_modules` (dos copias de React → "Invalid hook call"). Un
  test (`src/components/ui/__tests__/sync.test.ts`) falla si la copia se
  desfasa; `npm run ui:check` hace lo mismo desde la terminal. Convertirlo en
  un paquete compartido queda para S9.
- Lo que la web no tiene vive fuera de `ui/`: `components/shared/Alert.tsx`,
  `components/shared/Logo.tsx`, `components/auth/AuthShell.tsx` y las clases
  `.sg-camera*` en `src/index.css`.
- Tema claro/oscuro: `src/context/ThemeContext.tsx`, misma mecánica que la web
  (clase `dark` en `<html>`, default oscuro), pero la preferencia es **del
  equipo** (localStorage del WebView), no del usuario: una garita la comparten
  varios agentes por turno.
- La fuente Outfit va empaquetada (`@fontsource/outfit`): la web la carga de
  Google Fonts, pero una garita puede estar sin internet.

## Tests

```bash
npm test                                          # Vitest: placa, tiempo, cámara, tema, CameraPanel, sync del kit
cargo test --manifest-path src-tauri/Cargo.toml   # Rust: fingerprint, cifrado, cola, gracia
cargo test --manifest-path src-tauri/Cargo.toml integracion -- --ignored   # contra backend real (SG_TEST_API_URL)
npm run sidecar:bench                             # tiempo de inferencia del OCR
```

## Build para Windows

```bash
npm run sidecar:prepare:windows   # descarga node.exe + node_modules win32-x64 + modelos
npm run tauri build               # genera NSIS y MSI en src-tauri/target/release/bundle/
```

## Actualizaciones firmadas y CI de Windows

- Las actualizaciones las verifica `tauri-plugin-updater` con la llave pública del instalador; instalar es siempre una decisión del agente y se bloquea con accesos sin enviar o una captura en curso. Guía completa (llaves, publicar, probar, certificado de firma de código): [`docs/actualizaciones_firmadas.md`](../docs/actualizaciones_firmadas.md).
- El flujo `Escritorio · Windows` (`.github/workflows/desktop-windows.yml`) compila el instalador en un runner de Windows, lo instala en silencio y comprueba que arranca; `Publicar escritorio (firmado)` (`release-desktop.yml`, manual) crea el release en borrador. **Ninguno se ha ejecutado todavía.** Plantilla para validar en un equipo real: [`docs/validacion_windows.md`](../docs/validacion_windows.md).
- `npm run sidecar:prepare:windows` también funciona desde Windows (usa Node para el SHA-256 y prueba `unzip`, `tar` y PowerShell para descomprimir).

## Estructura

```
src/                     React (UI de garita)
  pages/                 ActivacionPage → LoginPage → GaritaPage (por estado, sin router)
  components/ui/         kit de la web, copia sincronizada (npm run ui:sync)
  components/shared/     Alert, Logo (propios de la app, mismas clases que la web)
  components/auth/       AuthShell: marco de activación y login
  components/garita/     CameraPanel (1/2/4 vistas) + CameraPane, CamarasConfigDialog,
                         PlacaOcrDialog, SalidaDialog, VisitanteForm, EstadoStrip, RecientesList
  hooks/useCamaras       dispositivos conectados y su asignación por tarea
  hooks/useCamarasLayout cuántas vistas y qué tarea ocupa cada una
  hooks/useQrScanner     escaneo continuo de QR sobre el <video> abierto
  context/ThemeContext   tema claro/oscuro persistente por equipo
  lib/camara.ts          errores de getUserMedia → mensaje para el agente
  lib/placa.ts           regex + corrección de placas guatemaltecas
  lib/tauri.ts           tipos y wrappers de los comandos Rust
tailwind.config.ts       reexporta ../frontend/tailwind.config (mismos tokens)
src-tauri/Info.plist     NSCameraUsageDescription (macOS)
src-tauri/src/           Rust, un módulo por dominio
  camera.rs              permiso de cámara en WebView2 (Windows)
  hardware/              talanquera: trait + adaptadores serial, tcp, gpio (stub)
  hardware_cmd.rs        comandos Tauri y persistencia de config_hardware
  fingerprint.rs         huella de hardware (MachineGuid + CPU, sin MAC)
  secure_store.rs        Windows Credential Manager / Keychain
  license.rs             activación, heartbeat, gracia 72 h, kill switch
  auth.rs                sesión del agente (JWT + refresh). Una cuenta con verificación en dos pasos (administradores) no entra
                         aquí: se le indica que use la versión web. Un refresh token que el servidor ve usado dos veces cierra la
                         sesión (`sesion_comprometida`); la garita sigue registrando sin conexión (docs/refresh_tokens.md)
  db.rs                  SQLite + SQLCipher, clave Argon2id
  garita.rs              espejo local, evaluación de visitante, validación de invitaciones QR sin red (docs/qr_sin_conexion.md), cola
  sync.rs                pull del espejo, push con backoff, purga
  ocr.rs                 arranque y protocolo del sidecar de OCR
sidecar-ocr/             proceso Node con ppu-paddle-ocr (ONNX Runtime nativo)
scripts/prepare-sidecar.mjs   empaqueta el sidecar para Tauri
```
