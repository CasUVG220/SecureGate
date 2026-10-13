# Validación en Windows (plantilla de 20 minutos)

> **Sin ejecutar.** Nadie ha probado SecureGate Garita en un Windows real (ni el CI de Windows corrió todavía). Esta plantilla es lo que hay que llenar la primera vez, en un equipo parecido al de una garita (6–8 GB de RAM). Complementa `docs/plantilla_medicion_camaras.md` (cámaras de red) y `docs/actualizaciones_firmadas.md` (actualizaciones).

**Requisitos que mide** (los textos originales de los RNF no están en este repositorio; estas son las metas que se usaron en el desarrollo, **a confirmar por el equipo**):

| RNF | Qué se mide | Meta usada |
|---|---|---|
| **RNF-03** | tiempo de cada lectura de placa/DPI, de pulsar «Leer» a ver el resultado | **p95 < 5 s** |
| **RNF-13** | memoria en un equipo de 6–8 GB | **app + WebView + OCR + ffmpeg < 1,5 GB**, y el equipo no empieza a usar el disco como memoria |

## 0. Antes (2 min)
| Dato | Valor |
|---|---|
| Equipo / modelo | |
| Windows (versión y compilación: `winver`) | |
| CPU (modelo, núcleos) | |
| RAM total / libre al empezar (Administrador de tareas → Rendimiento) | |
| Disco (SSD/HDD) y espacio libre | |
| WebView2 instalado antes de empezar (sí/no) | |
| Versión de SecureGate Garita / instalador usado (NSIS o MSI) | |
| Quién lo probó y cuándo | |

Descargar el instalador del último run verde de **Escritorio · Windows** (artefacto `instaladores-windows`) o del release.

## 1. Instalación y arranque (5 min)
| Paso | Esperado | ✔/✘ | Notas |
|---|---|---|---|
| Ejecutar el instalador NSIS | Aparece el aviso de SmartScreen (sin certificado de código, ver `actualizaciones_firmadas.md` §5); «Más información → Ejecutar de todas formas» | | |
| Instalación sin permisos de administrador (NSIS, por usuario) | Instala en `%LOCALAPPDATA%` sin pedir contraseña de administrador | | |
| Si falta WebView2, el instalador lo instala solo | Sí, sin pedir nada | | |
| Abrir la app (acceso directo del menú Inicio) | La ventana abre en **< 10 s** y muestra «Activar este equipo» | | |
| Tiempo hasta ver la pantalla | s | | |
| Activar con un código de pruebas | Entra al login del agente | | |
| Iniciar sesión como agente | Llega a la pantalla de la garita; la tira de estado dice «En línea» | | |
| Desinstalar y volver a instalar | Conserva (o pide de nuevo) la activación según lo esperado; sin archivos huérfanos | | |
| Probar también el MSI en otro equipo/VM | Instala por equipo en *Archivos de programa* | | |

## 2. Lecturas de placa y DPI — RNF-03 (6 min)
Con una cámara USB o de red y placas/DPI **de prueba (fotos o documentos ficticios)**:

| # | Tarea (placa/DPI) | Tiempo (s) | ¿Leyó bien? |
|---|---|---:|---|
| 1 | | | |
| 2 | | | |
| 3 | | | |
| 4 | | | |
| 5 | | | |
| 6 | | | |
| 7 | | | |
| 8 | | | |
| 9 | | | |
| 10 | | | |

| p50 (s) | p95 (s) (el 10.º más lento ≈ p95 con n = 10) | Lecturas fallidas | ¿Cumple RNF-03 (< 5 s)? |
|---:|---:|---:|---|
| | | | |

La **primera** lectura tras abrir la app puede tardar más (carga del modelo): anótala aparte.

## 3. Memoria y CPU — RNF-13 (5 min)
En el Administrador de tareas → pestaña *Detalles* (o `Get-Process`), sumar los procesos del grupo: `securegate-garita`, `msedgewebview2` (varios), `node` (OCR) y `ffmpeg` (solo con cámaras de red).

| Escenario | RAM total (MB) | CPU total (%) | ¿Usa disco como memoria? | Notas |
|---|---:|---:|---|---|
| App recién abierta, sin turno | | | | |
| Turno abierto, 2 min en reposo | | | | |
| Después de 10 lecturas de OCR | | | | |
| Con 1 cámara de red (si hay) | | | | |
| Con 2 cámaras de red (si hay) | | | | |

¿Cumple RNF-13 (< 1,5 GB y sin paginación)? ____ Memoria libre del equipo al final: ____ MB.

## 4. Offline y actualización (2 min)
| Paso | Esperado | ✔/✘ |
|---|---|---|
| Desconectar la red y registrar 2 accesos | Quedan «por sincronizar»; la garita sigue | |
| Con la cola pendiente, ¿«Actualizar ahora» (si hay una versión nueva) está bloqueado? | Sí, con el motivo a la vista | |
| Reconectar | Se envían solos; «Todo enviado» | |
| Reiniciar el equipo con accesos pendientes | No se pierden | |

La prueba completa de actualización entre dos versiones está en `docs/actualizaciones_firmadas.md` §4.

## 5. Qué revisar del CI de Windows la primera vez
El flujo `Escritorio · Windows` **nunca se ha corrido**. En su primera corrida real, revisar a mano:
- el paso **Perl y NASM** (¿están en el runner o se instalaron con `choco`?);
- el tiempo de **Compilar el instalador** (SQLCipher + OpenSSL "vendored" compilan lento) y que cabe en el límite de 90 min;
- **Preparar el sidecar de OCR**: descarga del runtime de Node y de los modelos (necesita red);
- **Instalación silenciosa (NSIS / MSI)**: que el nombre del `.exe` instalado coincide con el filtro `securegate` y que `node*.exe` y `ffmpeg*.exe` están junto a él;
- **Arranque**: si la app "muere a los 20 s" en el runner por falta de sesión de escritorio o de WebView2 (podría ser un falso negativo del runner y no de la app);
- que el artefacto `instaladores-windows` se descarga y su tamaño es razonable (≈ 100 MB).

## Resultado

| ¿Se puede entregar a una garita real? | Sí / No / Con reservas |
|---|---|
| Problemas encontrados (con captura de pantalla o registro) | |
| Cambios necesarios antes de la primera garita | |
