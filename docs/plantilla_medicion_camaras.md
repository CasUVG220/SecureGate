# Plantilla: CPU y RAM con cámaras IP / celular en un equipo de 6 a 8 GB

Complementa `docs/validacion_windows.md` (RNF-03 y RNF-13). Dura unos 15 minutos. **Sin ejecutar todavía en un equipo real.**

## Datos del equipo (llenar)
| Campo | Valor |
|---|---|
| Equipo / modelo |  |
| Windows (versión y compilación) |  |
| CPU (modelo, núcleos) |  |
| RAM total / libre al empezar |  |
| Disco (SSD/HDD) |  |
| Versión de SecureGate Garita |  |
| Cámaras reales usadas (marca, modelo, códec, resolución) |  |
| Celular y aplicación (si se usó) |  |

## Procedimiento
1. Abrir SecureGate Garita, iniciar sesión y dejarla 2 minutos en reposo.
2. Con las cámaras **simuladas** (para comparar con la nube) o las **reales**: 
   - Simuladas: `node desktop/scripts/medir-recursos.mjs app --pid <PID de securegate-garita> --mediamtx <ruta a mediamtx> --publicador ffmpeg` (PID: `Get-Process securegate-garita`).
     Necesita `mediamtx` y un `ffmpeg` con libx264 solo para publicar las cámaras de prueba; la app usa su propio ffmpeg mínimo.
   - Reales: agregar la cámara, asignarla a una tarea, dejar la vista de 1 y luego de 2 cámaras 2 minutos cada una y mirar el Administrador de tareas (CPU y Memoria del grupo
     «SecureGate Garita», «Microsoft Edge WebView2», el OCR (node) y ffmpeg).
3. Hacer **10 lecturas de placa** con una cámara de red y anotar el tiempo de cada una (de pulsar «Leer placa» a ver el resultado).
4. Quitar la cámara de la red (desconectar el cable o apagar la cámara) y anotar: ¿cuánto tardó la pantalla en decir «Se perdió la señal»?, ¿se puede seguir con la webcam o la captura manual?, ¿se recupera sola al volver?

## Resultados (llenar)
| Escenario | CPU total (%) | RAM total (MB) | Observaciones |
|---|---|---|---|
| Reposo |  |  |  |
| 1 cámara de red en vivo |  |  |  |
| 2 cámaras de red en vivo |  |  |  |
| 2 cámaras + una lectura de placa |  |  |  |

| Lectura de placa (n = 10) | p50 (ms) | p95 (ms) | Fallos |
|---|---|---|---|
| Con cámara de red |  |  |  |

## Criterio sugerido (a confirmar por el equipo)
- RAM total de SecureGate (app + WebView + OCR + ffmpeg) **< 1,5 GB** con 2 cámaras y que el equipo no empiece a usar el disco como memoria.
- CPU total **< 40 %** con 2 cámaras en vivo; **< 5 s** por lectura (RNF-03).
- Caída de cámara: aviso en pantalla en **< 15 s**, con el resto de la garita funcionando.

## Referencia (nube, Linux, 4 vCPU, cámaras simuladas; ver `docs/camaras_ip_diseno.md`)
1 flujo 720p15 → MJPEG: ~5–7 % de un núcleo y ~40–50 MB; 2 flujos: ~10–14 % y ~80–95 MB (solo los procesos ffmpeg del puente).

## ANPR continuo (Sprint 10): reconocimiento de placas por carril

Complementa lo anterior cuando la garita tiene carriles con ANPR (ver `docs/anpr_continuo.md`, «Tarea 7»). Dura unos 20 minutos.

### Procedimiento
1. **Pipeline sin ventana** (en el mismo equipo, con Rust instalado o desde el CI de Windows): `node desktop/scripts/medir-anpr.mjs pipeline --release`.
   Mide aparte el proceso de Rust y el del sidecar con los clips sintéticos de `test-fixtures/anpr` (reposo, 1 y 2 carriles), los ms por
   etapa, la latencia y la exactitud; deja el reporte en `desktop/scripts/reportes/anpr-<fecha>.md`.
2. **App completa**: `node desktop/scripts/medir-anpr.mjs app --pid <PID de securegate-garita> --segundos 60` y seguir las indicaciones
   (ANPR en pausa, reposo con carriles activos, 1 carril con tráfico, 2 carriles con tráfico). Incluye WebView2, los sidecars y ffmpeg.
3. Con tráfico real: anotar, de los eventos del ANPR, los segundos desde la primera lectura legible y si la placa fue la correcta.

### Resultados medidos (nube, Linux, Intel Xeon @ 2,80 GHz × 4 vCPU, 15,7 GB; pipeline sin ventana, Rust release, clips sintéticos 960×540 a 10 fps)

| Escenario | CPU total de la máquina (%) | RAM pico Rust + sidecar (MB) | Latencia p95 (ms) | Exactitud |
|---|---|---|---|---|
| Reposo, 2 carriles, calle vacía | 0,7 | 32 + 345 | — | sin eventos falsos |
| 1 carril con tráfico | 7,2 | 54 + 390 | 1432 | 6/6 vehículos con la decisión correcta, 0 placas equivocadas |
| 2 carriles con tráfico a la vez | 10,6 | 55 + 402 | 944 | 6/6 vehículos con la decisión correcta, 0 placas equivocadas |

Reporte: `anpr-2026-10-22T21-35-15` (detalle por etapa en `docs/anpr_continuo.md` §12). Sin WebView: la pantalla no está incluida.

### Resultados en el equipo de la garita (llenar; **pendiente, Windows 6–8 GB**)

| Escenario | CPU total (%) | RAM total (MB) | Latencia p95 (ms) | Observaciones |
|---|---|---|---|---|
| Pipeline: reposo, 2 carriles | pendiente | pendiente | — | |
| Pipeline: 1 carril con tráfico | pendiente | pendiente | pendiente | |
| Pipeline: 2 carriles con tráfico | pendiente | pendiente | pendiente | |
| App: ANPR en pausa | pendiente | pendiente | — | |
| App: reposo con carriles activos | pendiente | pendiente | — | |
| App: 1 carril con tráfico real | pendiente | pendiente | pendiente | |
| App: 2 carriles con tráfico real | pendiente | pendiente | pendiente | |
| Cámaras reales: día / noche / lluvia (exactitud) | — | — | pendiente | |
