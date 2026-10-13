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
