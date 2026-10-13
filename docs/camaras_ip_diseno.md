# Cámaras IP y celular: decisión de diseño del puente de video (T6, SCRUM-119 y SCRUM-120)

> Escrito **antes** de programar. Los números salieron de pruebas hechas el 11/10/2026 en un contenedor Linux de 4 vCPU (Xeon 2,1 GHz) con un servidor RTSP de prueba (mediamtx 1.12.0) y ffmpeg `testsrc2`. **Nada se midió en Windows ni con una cámara real**: eso queda marcado en cada punto.

## 1. El problema
La garita hoy usa cámaras USB por `getUserMedia` (WebView). Hace falta usar también **cámaras IP** (RTSP/ONVIF, las típicas de seguridad) y **el celular como cámara** (apps que sirven MJPEG por HTTP), asignables a cualquiera de las 4 tareas (QR, placa, DPI, salida), con vistas de 1, 2 o 4 a la vez y la captura de fotograma para el OCR **igual que con la webcam**.

Restricciones que mandan:
- **El WebView no reproduce RTSP** (ni `<video>` ni `<img>`): hace falta un puente que lo convierta a algo que sí muestre (`<img>` con MJPEG sí funciona en WebView2/Chromium).
- **Equipo de garita de 6 a 8 GB de RAM**, ya cargado con WebView2 (~300 MB), el OCR local (~520 MB de RSS medidos con el sidecar) y el sistema.
- Windows es el destino; el instalador ya lleva Node (~60 MB) y modelos.
- **Seguridad**: las credenciales de la cámara no pueden llegar al WebView ni a SQLite; el puente no puede ser un hueco SSRF ni abrirse a la red.
- No hay cámaras en la nube de desarrollo: todo debe poder probarse con servidores simulados.

## 2. Opciones evaluadas y números

### A. ffmpeg como sidecar (RTSP → fotogramas JPEG)
Un proceso `ffmpeg` por cámara: `ffmpeg -rtsp_transport tcp -i <rtsp> -an -vf fps=10,scale=640:-2 -c:v mjpeg -q:v 6 -f mjpeg pipe:1`. Rust lee los JPEG del pipe.

**Peso y licencia (medidos)**

| Binario | Tamaño | Licencia |
|---|---|---|
| Build estático popular para Windows (ffmpeg-static b6.1.1, igual que gyan/BtbN) | **82,8 MB** (29,6 MB comprimido) | **GPL v3** (`--enable-gpl --enable-version3`, trae x264/x265/…) |
| **Build mínimo propio** (`desktop/scripts/build-ffmpeg-min.sh`: RTSP/TCP, decodifica H.264/H.265/MJPEG, escala, codifica MJPEG; sin x264) cruzado a Windows con mingw-w64 | **3,3 MB** (`ffmpeg.exe`, PE32+ x86-64 verificado; **no se pudo ejecutar** aquí, no hay Wine ni Windows) | **LGPL 2.1+** (`--disable-gpl`) |
| Mismo build mínimo, nativo Linux (**sí se ejecutó**) | 3,5 MB | LGPL 2.1+ |

La diferencia (25× menos) viene de no incluir códecs que no se usan. Como el decodificador H.264/H.265 y el codificador MJPEG de ffmpeg son nativos (LGPL), **no hace falta x264/x265** (esos solo codifican). Cumplimiento LGPL: el binario va como **programa aparte** (sidecar reemplazable, no enlazado con la app); hay que publicar el script, la versión y el SHA-256 del fuente, y el texto de la licencia. *No es asesoría legal; revisarlo antes de distribuir.* Con el build GPL de 83 MB habría obligaciones de GPL sobre ese binario y +30 MB en el instalador sin ganar nada.

**Recursos (medidos con el build mínimo nativo, 20 s por prueba, cámara simulada H.264 por mediamtx; CPU en % de UN núcleo)**

| Caso | CPU | RAM pico |
|---|---|---|
| 1 flujo 720p15 → MJPEG 640 px a 10 fps | **5 %** | **40 MB** |
| 2 flujos 720p15 simultáneos | **10 %** | **79 MB** (suma) |
| 1 flujo 1080p25 → MJPEG 960 px a 10 fps | 10 % | 65 MB |
| 1 flujo 720p15 a 5 fps («ahorro») | 4 % | 39 MB |
| Captura de **un** fotograma 1080p desde RTSP (conectar + esperar keyframe + JPEG) | — | **1,25 s** (casi todo es esperar al primer fotograma clave; con GOP de 1 s) |
| H.265 720p15 (decodificación) | funciona (se ven avisos `Could not find ref` al empezar a mitad de un GOP: inocuos) | — |

Estimación para 6–8 GB (a confirmar en un equipo real, ver T9): app Tauri + WebView2 ~300–500 MB, OCR ~520 MB, 2 ffmpeg ~80–160 MB ⇒ **≈ 1,0–1,2 GB propios**. Una CPU de laptop de garita puede ser 2–3× más lenta que este Xeon: aun así el puente ocuparía < 30 % de un núcleo con 2 cámaras.

Pros: soporta **H.264, H.265 y MJPEG** (las cámaras IP modernas usan H.265 con frecuencia), RTSP maduro (TCP interleaved, autenticación Basic/Digest, reconexión), una sola pieza para probar en la nube. Contras: otro ejecutable que empaquetar y actualizar; la línea de comandos lleva la URL con credenciales (ver §5).

### B. Biblioteca nativa en Rust (sin ffmpeg)
`retina` 0.4.21 (cliente RTSP en Rust puro, MIT/Apache-2.0) + decodificador H.264. No existe un decodificador H.264 en Rust puro listo para producción; las salidas son `openh264` (BSD-2, pero la licencia de patentes de Cisco cubre solo el binario que ellos distribuyen y obliga a bajarlo; compilarlo del fuente no tiene esa cobertura) o `ffmpeg-next`/`ffmpeg-sidecar` (que vuelven a ffmpeg). **No cubre H.265.** Alternativa solo-Windows: Media Foundation (`windows` crate) — H.264 viene con Windows, H.265 exige la extensión «HEVC Video Extensions» de la tienda (de pago en algunas ediciones), y **no se puede probar nada de eso en la nube**. Riesgo alto, semanas de trabajo, cero pruebas posibles aquí. **Descartada**; queda como posible optimización futura de `retina` solo para leer RTSP si algún día se quiere prescindir de ffmpeg para H.264.

### C. MJPEG/HTTP directo para el celular
Apps como «IP Webcam» (Android) entregan `multipart/x-mixed-replace` por HTTP (`http://IP:8080/video`). El WebView lo mostraría en un `<img>` **sin ffmpeg**. Pero apuntar el `<img>` directo al celular implica (1) abrir la CSP a cualquier IP privada, (2) poner la **contraseña en la URL dentro del WebView**, y (3) no tener captura de fotograma sin ensuciar el `<canvas>` (origen cruzado) ni reconexión ni estado. **Decisión: el puente también lo proxea en Rust** (`reqwest` en streaming + partir los JPEG): cero ffmpeg para el celular, y todo lo demás (SSRF, token, credenciales fuera del WebView, estado, captura) queda igual que para RTSP.

### D. Otras descartadas
- **mediamtx / go2rtc como sidecar** (RTSP → HLS/WebRTC/MJPEG): 15–16 MB más, otro lenguaje, latencia de HLS (2–6 s) o WebRTC con ICE/puertos; resuelve más de lo que se pide. *Sí* se usa mediamtx **en las pruebas** (servidor RTSP de prueba), no en producción.
- **GStreamer / libVLC**: 50–150 MB y más superficie.
- **HLS con `<video>`**: latencia y archivos temporales en disco (imágenes de la garita en disco: no).
- **WebRTC directo** desde la cámara: pocas cámaras lo soportan.

## 3. Decisión
1. **RTSP (cámaras IP/ONVIF): sidecar `ffmpeg` mínimo LGPL propio** (≈3,3 MB), compilado con `desktop/scripts/build-ffmpeg-min.sh` (versión fijada y SHA-256 del fuente verificado) y empaquetado como `externalBin`.
2. **MJPEG por HTTP (celular y cámaras que lo ofrecen): proxy en Rust** (sin ffmpeg).
3. Ambas fuentes alimentan **el mismo puente** dentro de la app (Rust), que guarda **el último fotograma en memoria** y lo sirve de dos formas:
   - **vista previa**: servidor HTTP **solo en `127.0.0.1`**, puerto aleatorio, con **token efímero** (ruta `/v/<id>?t=<token>`), `multipart/x-mixed-replace` para un `<img>`;
   - **captura para el OCR**: comando Tauri `camara_ip_fotograma(id)` → JPEG en base64 (**no** se lee el `<img>` en un `<canvas>`: evita el problema del origen cruzado y mantiene la ruta idéntica a la de la webcam: la imagen llega al mismo `ocr_placa`/`ocr_dpi`).
4. Una interfaz limpia **`FuenteFotogramas`** (`ultimo_fotograma()`, `estado()`) que sirve a la vista previa, a la captura y, más adelante, al OCR continuo del Sprint 10 (sin implementar ANPR).

```
 cámara RTSP ──TCP──▶ ffmpeg (sidecar, 1 por cámara) ──JPEG por pipe──┐
 celular MJPEG ─HTTP─▶ proxy reqwest (en Rust) ───────────────────────┤
                                                                       ▼
                                   Puente (Rust): último fotograma en memoria + estado + reconexión
                                        │                                   │
                       127.0.0.1:<puerto>/v/<id>?t=<token>        comando camara_ip_fotograma(id)
                                        │                                   │
                                  <img> en el WebView               base64 → OCR (igual que la webcam)
```

## 4. Seguridad (se detalla y se prueba en T7)
- **SSRF**: solo se aceptan hosts en rangos **privados** (RFC1918 10/8, 172.16/12, 192.168/16) y **link-local** (169.254/16, fe80::/10); se rechazan localhost/loopback (salvo el puente propio), IP públicas, 0.0.0.0, multicast, y nombres que **resuelvan a una IP pública** (se resuelve, se valida *cada* IP y se **conecta a la IP ya validada**: evita DNS rebinding). Redirecciones: en HTTP se re-validan o se rechazan si cambian de host; en RTSP ffmpeg las sigue por su cuenta (`Status 30x: Redirecting to …` en el log, nivel INFO del fuente `rtsp.c`), así que el puente **vigila ese texto en stderr y mata el proceso** al verlo.
- **Credenciales**: usuario y contraseña viven en el **keyring del sistema** (Credential Manager en Windows), nunca en SQLite ni en el WebView ni en logs; la URL guardada no lleva `usuario:clave@`. *Riesgo conocido:* ffmpeg recibe la URL completa por línea de comandos, visible para otros procesos **del mismo usuario** mientras corre. Se acepta y se documenta; mitigación futura: un proxy RTSP local que inyecte la autenticación.
- **Puente local**: solo `127.0.0.1`, **token efímero** por ejecución (≥128 bits, comparación en tiempo constante), validación de `Host` y de `Origin` (los orígenes de la app) contra CSRF/DNS-rebinding desde un navegador del equipo; otros equipos no lo alcanzan. La CSP del WebView solo suma `img-src http://127.0.0.1:*`.
- Los logs **nunca** llevan la URL con credenciales (se enmascara) ni fotogramas.

## 5. Confiabilidad
- **Reconexión con backoff exponencial** (1, 2, 4, 8, … hasta 30 s, con un poco de aleatoriedad) y estado visible: `conectada` / `reconectando` / `caida`.
- **Vigilante de inactividad**: si no llega un fotograma en 10 s, se mata y se reconecta (los tiempos de espera propios de ffmpeg para RTSP no son fiables entre versiones; `-rw_timeout` ni siquiera existe como opción de RTSP en 6.1).
- **Una cámara que cae no tumba la garita**: la pantalla muestra el error y el agente sigue con la webcam USB o la captura manual (como ya pasa hoy si falta la cámara).
- Los procesos `ffmpeg` se terminan al cerrar la app o al quitar la cámara; se enciende un flujo solo mientras alguna vista lo muestra o hay una captura en curso (ahorra CPU: en 1 vista, una sola cámara encendida).

## 6. Riesgos y qué falta verificar
| Riesgo | Mitigación / pendiente |
|---|---|
| El `ffmpeg.exe` mínimo **no se ejecutó en Windows** (solo se compiló y se verificó el formato PE) | Prueba de humo en CI de Windows (T13) y plantilla de validación (T9/T13). El mismo build en Linux sí se probó con H.264 y H.265 |
| Cámaras reales: autenticación Digest, perfiles, H.265 con particularidades, `rtsps://` | No hay cámaras en la nube; marcar «sin probar con hardware real». `rtsps` (TLS) **no** está habilitado en el build mínimo; si hace falta se agrega `--enable-protocol=tls` con una biblioteca TLS (más peso y más superficie) |
| Redirección RTSP vigilada solo por texto del log | Prueba con un servidor RTSP que redirige (simulado) y respaldo: el SSRF de la URL original ya está validado |
| Credenciales visibles en la línea de comandos (mismo usuario) | Documentado; proxy RTSP local como mejora |
| Un celular cambia de IP (DHCP) | La guía de T9 dice cómo reservarla; la cámara se puede editar y probar de nuevo |
| 4 vistas con 4 flujos | ~20 % de un núcleo en este Xeon (**extrapolado** de las pruebas con 2 flujos); medir en equipo real (T9) y ofrecer «modo ahorro» (5 fps) |

## 7. Cómo se prueba en la nube (T7–T9)
- Servidor RTSP de prueba: **mediamtx** (asset de GitHub Releases, descargable aquí) + `ffmpeg -f lavfi -i testsrc2 … -f rtsp` publicando; servidor **MJPEG simulado propio** (Node/Rust) para el celular; ONVIF/WS-Discovery **simulado** (respondedor UDP propio).
- Pruebas unitarias de SSRF, credenciales (nunca llegan al frontend), reconexión/backoff con reloj inyectado, vigilante y redirección; y de punta a punta (si hay `ffmpeg` y mediamtx): descubrir/alta → fotograma → mismo OCR de placa/DPI.
- Todo lo que dependa de una cámara física, de Windows o de WebView2 real queda marcado **«sin probar con hardware real»**.

## 8. Estado de la implementación (T7–T9, 11/10/2026)
- Puente, SSRF, llavero, supervisor y comandos: `desktop/src-tauri/src/camaras/` (T7). ONVIF, alta, visor y captura para el OCR: T8. Celular y medición: T9 (`docs/celular_como_camara.md`, `desktop/scripts/medir-recursos.mjs`, `docs/plantilla_medicion_camaras.md`).
- **Interfaz para el OCR continuo del Sprint 10**: `FuenteFotogramas` + `esperar_fotograma` (entrega el más reciente y nuevo, sin colas). **ANPR no está implementado.**
- Medición del puente con el script (mismo escenario que §2, 960 px de salida): 1 flujo 7,1 % de un núcleo y 48 MB; 2 flujos 14,2 % y 95 MB (Xeon 2,1 GHz). Falta repetirla en un equipo real de 6 a 8 GB.
