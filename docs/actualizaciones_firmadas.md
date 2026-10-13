# Actualizaciones firmadas de SecureGate Garita

> **Estado (T13): escrito y probado donde se pudo; NADA se ejecutó contra un release real ni en Windows.** Lo que sí corrió en la nube: las pruebas de la política de actualización (9 de Rust y 12 de pantalla), la inicialización del plugin con la configuración del repositorio (prueba con una app simulada) y `actionlint` sobre los flujos. Lo que **no** corrió: el flujo `release-desktop`, la firma, la descarga, la instalación y el reinicio en un Windows real. Cada paso de esta guía marcado **[sin ejecutar]** hay que verlo funcionar la primera vez.

## 1. Cómo funciona

```
 la app (cada 6 h)         GitHub Releases                      el agente
 ───────────────────       ────────────────────────────         ──────────────────
 busca latest.json  ─────► { version, notas, url, firma }
 ¿hay una versión mayor? ◄──
 muestra el aviso ─────────────────────────────────────────────► «Actualizar ahora»
                                                                  (confirma)
 descarga el instalador ◄── SecureGate-Garita_0.2.0_x64-setup.exe
 verifica la FIRMA con la llave pública que lleva DENTRO
 instala y reinicia (solo si no hay accesos sin enviar ni captura en curso)
```

- **Buscar** es automático: a los 30 s de abrir la app y cada 6 horas. Solo lee `latest.json`; no descarga ni instala nada.
- **Instalar** nunca es automático: lo pide una persona con el botón **Actualizar ahora** (con confirmación) y **Rust lo rechaza** si:
  - hay accesos en la cola offline sin enviar al servidor (`accesos_pendientes`), porque actualizar reinicia la app; o
  - hay una captura en curso (`captura_en_curso`: placa, DPI, QR o salida a medias).
  Mientras tanto la pantalla deja el botón bloqueado y dice por qué (`Hay 3 accesos sin enviar…`). La cola vive en la base cifrada y sobrevive al reinicio, pero un acceso a medias no.
- **Firma:** `tauri-plugin-updater` descarga el instalador y verifica su firma (minisign) con la **llave pública que va compilada dentro del instalador** (`plugins.updater.pubkey` en `desktop/src-tauri/tauri.conf.json`). Una firma que no coincide aborta antes de instalar. Esa llave **no se lee de ningún archivo del equipo**: un `config.json` editado no puede colar otra.
- **Dirección del manifiesto:** por defecto `plugins.updater.endpoints` (hoy el placeholder `https://github.com/chatio/SecureGate/releases/latest/download/latest.json`; **ajustarla si el repositorio de publicación es otro**). Un equipo puede apuntar a otra (canal de pruebas, espejo en la LAN) con `actualizador_endpoint` en su `config.json`; solo `https://` y sin credenciales. Cambiar la dirección no permite instalar nada sin una firma válida.
- **Apagado de fábrica:** en el repositorio `pubkey` va **vacía**. Con la llave vacía la función queda apagada: la app no hace ninguna petición ni muestra nada. La llave pública real la inyecta el flujo de publicación (`--config`) al compilar el instalador firmado.
- **Windows:** el instalador de actualización corre en modo `passive` (barra de progreso, sin preguntas) y la app se vuelve a abrir sola.

## 2. Generar las llaves (una sola vez) **[sin ejecutar]**

En un equipo de confianza (no en el servidor de CI):

```bash
cd desktop
npx tauri signer generate -w ~/.tauri/securegate-garita.key
```

Pide una **contraseña** (úsala: protege la llave si el archivo se filtra) y crea dos archivos:
`securegate-garita.key` (**PRIVADA**) y `securegate-garita.key.pub` (pública).

| Qué | Dónde se guarda | Nunca |
|---|---|---|
| **Llave privada** (`.key`) | Secreto del repositorio `TAURI_SIGNING_PRIVATE_KEY` (el contenido completo del archivo) **y** una copia cifrada fuera de línea (gestor de contraseñas del equipo o bóveda con acceso a dos personas) | en el repositorio, en un chat, en el correo, en un archivo del CI, en los registros |
| **Contraseña** de la llave | Secreto `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` y el gestor de contraseñas | junto a la llave |
| **Llave pública** (`.pub`) | Variable del repositorio `TAURI_UPDATER_PUBKEY` (el contenido del archivo). Es pública: no es un secreto | — |

**Este repositorio no contiene ninguna llave privada y el código nunca la genera.** Si alguna vez aparece una en el historial: tratarla como robada (sección 6).

⚠ **Perder la llave privada** significa que **ningún equipo ya instalado podrá volver a actualizarse** (no se puede firmar con la pública que llevan): habría que reinstalar a mano en cada garita con una pública nueva. Por eso la copia fuera de línea.

## 3. Publicar una versión **[sin ejecutar]**

1. **Subir la versión** en los tres sitios, en un commit: `desktop/src-tauri/tauri.conf.json` (`version`), `desktop/src-tauri/Cargo.toml` (`version`) y `desktop/package.json`. Debe ser mayor que la anterior (semver).
2. Mezclar a `main` con el CI en verde (incluido el job **Escritorio · Windows**).
3. En GitHub → *Actions* → **Publicar escritorio (firmado)** → *Run workflow* → versión (`0.2.0`) y notas (lo que verá el agente).
   El flujo comprueba que la versión coincide con los archivos, que existen la llave pública (variable) y la privada (secreto), compila en Windows, **firma**, arma `latest.json` y crea un **release en BORRADOR** `desktop-v0.2.0` con: el instalador NSIS y su `.sig`, el MSI y su `.sig`, y `latest.json`.
4. **Probar antes de publicar** (sección 4) con el borrador.
5. Publicar el release a mano. Mientras sea borrador, `releases/latest/download/latest.json` no lo ve nadie; al publicarlo, los equipos lo encuentran en su siguiente búsqueda (hasta 6 h) — o antes si reinician la app (a los 30 s).
6. Para **retirar** una versión mala: despublicar el release (o publicar uno nuevo con versión mayor). Un `latest.json` más viejo no hace bajar de versión a nadie (el plugin solo instala versiones mayores).

## 4. Probar una actualización entre dos versiones en Windows **[sin ejecutar]** (≈ 30 min)

Necesitas un equipo Windows 10/11 de pruebas (puede ser una máquina virtual), dos versiones publicadas como borrador/prerelease firmadas con la **misma** llave (por ejemplo `0.2.0` y `0.2.1`), y acceso al servidor de pruebas del backend.

1. Instala **la versión anterior** con su instalador NSIS. Abre la app y actívala con un código de pruebas.
2. **Apunta ese equipo al canal de pruebas** (para no tocar a las garitas reales): cierra la app y agrega a `%APPDATA%\com.securegate.garita\config.json` la línea `"actualizador_endpoint": "https://github.com/<repo>/releases/download/desktop-v0.2.1/latest.json"` (la URL del `latest.json` del borrador/prerelease; si es un borrador no es accesible sin sesión: usa un prerelease o copia los archivos a un servidor https de pruebas).
3. Abre la app y espera **30 s**: debe aparecer *«Hay una versión nueva de SecureGate Garita: 0.2.1»*. Si no aparece, mira el registro (`%LOCALAPPDATA%\com.securegate.garita\logs`).
4. **Prueba de bloqueo con la cola pendiente:** desconecta la red del equipo, registra un acceso (queda «por sincronizar») y comprueba que el botón **Actualizar ahora** está bloqueado y dice *«Hay 1 acceso sin enviar…»*. Vuelve a conectar, espera a que diga *«Todo enviado»* y que el botón se habilite.
5. **Prueba de bloqueo con una captura en curso:** abre la lectura de placa (el diálogo del OCR) y comprueba que el botón se bloquea con *«Termina la captura en curso…»*; ciérrala y se libera.
6. Pulsa **Actualizar ahora** → confirma. Esperado: barra de progreso del instalador, la app se cierra y **vuelve a abrir sola** en la versión nueva (*Ayuda/estado → versión 0.2.1* o el título de la ventana/registro).
7. **Verifica que no se perdió nada:** la licencia sigue activa (no pide el código otra vez), la sesión/turno, el espejo de residentes, las cámaras configuradas, y la cola (si dejaste accesos sincronizados, siguen en «recientes»).
8. **Prueba negativa de la firma:** publica (o sirve) un `latest.json` con la `signature` alterada. Esperado: la app **no instala** y muestra el error; la versión instalada sigue funcionando.
9. Anota resultados y fallos en `docs/validacion_windows.md`.

## 5. Certificado de firma de código de Windows (trámite) — **pendiente, lo debe hacer una persona**

No confundir las dos firmas:

| | Firma del actualizador (minisign) | Firma de código de Windows (Authenticode) |
|---|---|---|
| Para qué | que la app solo instale actualizaciones hechas por SecureGate | que Windows (SmartScreen, antivirus) confíe en el instalador y muestre «SecureGate» como editor |
| Quién la da | nosotros mismos (`tauri signer generate`) | una autoridad certificadora comercial |
| Costo | gratis | de pago, anual |
| Estado | implementada (sin probar) | **no existe todavía** |

Sin certificado de código el instalador funciona, pero Windows muestra *«Windows protegió tu PC»* (SmartScreen) y el editor sale como «desconocido»; el agente debe pulsar «Más información → Ejecutar de todas formas». La reputación de SmartScreen se construye con el tiempo y las descargas; un certificado EV la da de inmediato. Las actualizaciones por el actualizador no pasan por SmartScreen de la misma forma, pero el primer instalador sí.

Pasos del trámite (verificar vigencia de requisitos y precios con el proveedor elegido; esto es una guía, no una cotización):
1. **Decidir tipo:** OV (validación de organización) o EV (validación extendida; reputación inmediata en SmartScreen). Desde 2023 las autoridades exigen que la llave del certificado viva en **hardware** (token USB/HSM) o en un **servicio de firma en la nube**, así que ya no se entrega un `.pfx` descargable.
2. **Elegir proveedor** (DigiCert, Sectigo, SSL.com, GlobalSign y revendedores; o el servicio de firma gestionado de Microsoft/Azure si la empresa es elegible). Comparar: precio anual, soporte de firma en la nube desde un flujo de CI, y plazos.
3. **Reunir documentos de la empresa** (los pide el proveedor para validar la organización): constitución legal de la entidad y patente de comercio, NIT/RTU, dirección física verificable y teléfono de la empresa en un directorio, identificación del representante legal, y un correo del dominio de la empresa. Suele tardar **de unos días a varias semanas** (más con EV).
4. **Decidir dónde firmar:** token USB (firma manual en un equipo concreto; no sirve para el CI hospedado) o firma en la nube (sirve para GitHub Actions con un secreto del proveedor).
5. **Integrarlo con Tauri:** en `bundle.windows` se configura `signCommand` (para herramientas de firma en la nube) o `certificateThumbprint` (certificado instalado en el equipo de compilación). Ajustar el flujo `release-desktop` (hoy firma solo para el actualizador).
6. **Probar:** instalar el instalador firmado en un Windows limpio y comprobar que el editor se muestra y que SmartScreen no bloquea (o solo avisa en los primeros días con OV).

Mientras no haya certificado, documentar el aviso de SmartScreen en la guía de instalación para las garitas.

## 6. Si se compromete la llave privada o la contraseña

1. Revocar el secreto en GitHub y generar un par nuevo (sección 2).
2. **Los equipos instalados con la pública vieja no aceptarán firmas del par nuevo**: hay que reinstalar a mano (instalador nuevo con la pública nueva) en cada garita. Por eso conviene tener un inventario de equipos.
3. Despublicar los releases firmados con la llave comprometida.
4. Revisar quién tuvo acceso a los secretos del repositorio.

## 7. Endurecimiento pendiente (para decidir tras la primera prueba real)

- `plugins.updater.requireSignedVersion: true`: exige que la firma lleve la versión para la que se firmó (evita que alguien con control del manifiesto reutilice la firma de un instalador viejo). **No se activó** porque depende de que el CLI de Tauri que firme la deje en la firma (hay que probarlo con el CLI real) y de re-firmar los releases anteriores.
- Que el actualizador solo corra con la garita sin turno abierto, o fuera de horario pico (hoy: cuando no hay cola ni captura).
- Canal beta y despliegue gradual (por ahora todos los equipos ven el release publicado al mismo tiempo).
- macOS/Linux: fuera de alcance (las garitas son Windows).
