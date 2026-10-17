# Fixtures del ANPR (Sprint 10)

Clips e imágenes de prueba del reconocimiento continuo de placas. **Todo es sintético salvo la carrocería de dos vehículos**, que
sale de dos fotos de dominio público (CC0). No hay personas, caras ni placas reales: las fotos originales ya tenían la placa en
blanco y encima se dibuja una placa guatemalteca inventada.

| Archivo | Qué es |
|---|---|
| `fuentes/crown_plata.jpg` | «Toyota Crown ARS220 Unmarked car rear», de [Ypy31](https://commons.wikimedia.org/wiki/User:Ypy31), **CC0 1.0** ([ficha en Wikimedia Commons](https://commons.wikimedia.org/w/index.php?curid=155063744)). Miniatura de 1280 px tal como la sirve Commons, sin cambios. SHA-256 `db8b5d78…2ae8ac8`. |
| `fuentes/crown_negro.jpg` | «Toyota Crown ARS220 escort car rear», de [Ypy31](https://commons.wikimedia.org/wiki/User:Ypy31), **CC0 1.0** ([ficha](https://commons.wikimedia.org/w/index.php?curid=158448911)). Miniatura de 1280 px, sin cambios. SHA-256 `1b0cf63e…4b160d`. |
| `generar.mjs` | Script determinista que arma la escena (muro, asfalto, carriles y poste dibujados por código), pega la foto del vehículo con bordes difuminados, dibuja la placa sintética encima de la placa en blanco y codifica con ffmpeg (H.264, 960×540, 10 fps, como el puente de cámaras de la app). |
| `clips/*.mp4` | Salida del script. Ver `verdad_terreno.json`. |
| `imagenes/*.jpg` | Tres cuadros sueltos para las pruebas del detector (vehículo en el ROI, carril vacío, vehículo en el carril vecino). |
| `verdad_terreno.json` | ROI de la escena y, por clip, qué vehículos pasan y con qué placa (o `null` si la placa es ilegible a propósito). |

Se buscaron las fotos con la API de [Openverse](https://openverse.org) filtrando por `license=cc0,pdm`; se descartaron las que
mostraban personas (aunque estuvieran difuminadas). CC0 no exige atribución; se deja igual para que el origen sea verificable.

## Clips

| Clip | Qué prueba |
|---|---|
| `entrada_p123abc` | Un vehículo entra, se detiene 1,5 s en la talanquera y sale (plateado, `P-123ABC`). |
| `entrada_c458dfg` | Lo mismo con otro vehículo y otra placa (negro, `C-458DFG`). |
| `detenido_m771klm` | El vehículo se queda 20 s detenido dentro del ROI: debe haber **un** solo evento. |
| `dos_seguidos` | Dos vehículos con 2 s entre uno y otro: dos pistas, dos eventos. |
| `vacio` | Carril vacío con ruido y una nube (baja el brillo): ni movimiento ni vehículos. |
| `carril_vecino` | Un vehículo pasa por el carril de la derecha, fuera del ROI: no cuenta. |
| `ilegible` | Placa con el texto muy borroso: debe acabar en verificación del agente, nunca en una placa inventada. |

## Regenerar

```bash
(cd desktop/sidecar-ocr && npm ci)      # @napi-rs/canvas
node test-fixtures/anpr/generar.mjs     # necesita ffmpeg con libx264 en el PATH
```

La tipografía de las placas es DejaVu Sans (si falta se usa la del sistema y los píxeles cambian un poco). Los clips del repo se
generaron el 22/10/2026 en Linux con ffmpeg 6.1.

## Límites

Son escenas sintéticas: sin perspectiva real, sin noche, lluvia, faros ni contraluz, y siempre placa trasera. Sirven para probar
la lógica (movimiento, ROI, seguimiento, consenso, decisión) y para medir; **no** reemplazan la validación con una cámara real
(ver `docs/anpr_continuo.md`, «Qué falta validar con hardware real»).
