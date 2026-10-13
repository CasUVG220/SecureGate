# El celular como cámara (SCRUM-120)

Un celular con una aplicación que transmita **video por la red local** se usa como una cámara IP más: se agrega igual, se prueba igual y sirve para las 4 tareas
(QR, placa, DPI y salida). No necesita ffmpeg: el puente de video del escritorio lee el flujo **MJPEG por HTTP** directo (ver `docs/camaras_ip_diseno.md`).

## Cómo conectarlo (lo mismo que dice la guía en pantalla)
1. El celular y la computadora de la garita en la **misma red Wi-Fi** (no datos móviles, no red de invitados).
2. En el celular, abrir la aplicación y **iniciar el servidor / la transmisión**. Ella muestra una dirección, por ejemplo `http://192.168.1.60:8080`.
3. En la garita: **Cámaras de esta garita → Agregar cámara IP o celular → Celular como cámara**; la dirección va con la ruta del video, p. ej. `http://192.168.1.60:8080/video`.
4. Si la aplicación tiene usuario y contraseña, escribirlos en sus campos (quedan en el llavero del sistema, no se vuelven a mostrar).
5. **Probar conexión** → «Conexión correcta: se recibe imagen de …». Luego **Guardar** y asignarlo a una tarea.

Consejos: dejar el celular **cargando** y fijo; pedir que la red le **reserve siempre la misma dirección** (si cambia, hay que corregir la dirección y volver a probar); apagar el
ahorro de batería de la aplicación; con 2 o más celulares, usar nombres claros («Celular carril entrada»).

## Aplicaciones sugeridas y qué se probó
| Aplicación | Sistema | Dirección típica del video | Estado de la prueba |
|---|---|---|---|
| **IP Webcam** (Pavel Khlebovich) | Android | `http://IP:8080/video` (MJPEG); usuario y contraseña opcionales (HTTP básico) | **Sugerida.** **No se probó con la aplicación real** (no hay celular en el entorno de desarrollo): se probó con un servidor MJPEG simulado que reproduce lo que estas apps emiten |
| **DroidCam** | Android / iOS | `http://IP:4747/video` (MJPEG) | Sin probar; la dirección es la que documenta la propia aplicación y debe verificarse |
| Aplicaciones de cámara IP para iPhone | iOS | Varía | Sin verificar: no se sugiere ninguna hasta probarla |

**Lo que sí se probó (servidor MJPEG simulado, `desktop/src-tauri/src/camaras/pruebas_integracion.rs`):** flujo `multipart/x-mixed-replace` con y sin `Content-Length`, con otra frontera
(`myboundary`), con `Transfer-Encoding: chunked`; usuario y contraseña (HTTP básico) correctos e incorrectos (error claro, **sin reintentos** para no bloquear la cuenta);
redirección al mismo equipo (se sigue) y a otro equipo (se rechaza); 404; celular que corta la conexión (se **reconecta solo** con espera creciente y vuelve a dar imagen); puerto cerrado (error temporal).
**Lo que no se pudo probar:** una aplicación real, un celular real, el ahorro de batería, el cambio de red y las particularidades de cada fabricante. Antes de dar por bueno un modelo de celular hay que
hacer la prueba de 20 minutos de `docs/validacion_windows.md` con él.

## Seguridad
- Solo se aceptan direcciones de **redes privadas** (192.168.x.x, 10.x.x.x, 172.16–31.x.x): una dirección de internet se rechaza.
- La contraseña se guarda en el llavero del sistema y la dirección guardada no la lleva; la vista previa sale por el puente local con token efímero.
- Un celular en la red es un equipo más en esa red: usar una Wi-Fi de la garita protegida y no la de visitantes.

## Interfaz para el OCR continuo (Sprint 10) — sin ANPR
`FuenteFotogramas` (`fuente.rs`) es la interfaz que verá el OCR continuo: `ultimo()`, `estado()` y `suscribir()`; y `esperar_fotograma(fuente, desde_seq, espera, max_edad_ms)` entrega **el más reciente
y nuevo, saltándose los intermedios** (un OCR lento nunca acumula cola ni lee imágenes viejas). Hoy la usa la captura puntual del OCR (`camara_ip_fotograma`). **No se implementó reconocimiento continuo
de placas (ANPR)**: eso es el Sprint 10.
