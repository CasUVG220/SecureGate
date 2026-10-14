# Landing público (`/`)

Página de venta de SecureGate para administradores y juntas directivas de residenciales. Una sola acción: **pedir una
demo** (formulario en `#contacto`). Vive en el mismo frontend que la app, pero no comparten bundle, CSS ni fuentes.

| Qué | Dónde |
|---|---|
| Página y secciones | `frontend/src/landing/Landing.tsx`, `frontend/src/landing/secciones/*.tsx` |
| **Textos y datos** (todo lo que se lee) | `frontend/src/landing/contenido.ts` |
| **Precios** | `frontend/src/landing/planes.ts` |
| Medios (video, fotos, PDF) | `frontend/public/landing/` |
| Colores | `frontend/src/landing/tokens.ts` → `landing.css` (`--l-*`) → `tailwind.landing.config.ts` |
| Título, descripción, Open Graph, JSON-LD | `frontend/src/landing/seo.ts` (los inyecta `vite.config.ts` en `index.html`) |
| Formulario → backend | `POST /api/contacto` (`backend/src/routes/contacto.routes.ts`), tabla `contactos` |
| Capturas | `docs/landing/landing-390.png`, `landing-768.png`, `landing-1440.png` |

## Ruteo

`frontend/src/main.tsx` elige UNA vez al cargar el documento: en `/` monta el landing; en cualquier otra ruta, la app.
Los dos son chunks diferidos: el landing no descarga la app autenticada (ni `index.css` ni la fuente Outfit de Google),
y la app no descarga el landing. Comprobado en el build de producción:

| Ruta | Resultado |
|---|---|
| `/` (con o sin sesión) | Landing. Solo baja `Landing-*.js/css`; nada de `App-*`, nada de Google Fonts |
| `/personal`, `/residente` sin sesión | Pantalla de acceso de ese portal (como antes) |
| `/staff`, `/admin`, `/tenant`, `/resident`, `/portal` | Redirigen a su portal canónico (como antes) |
| `/personal` con sesión de residente, `/residente` con sesión de administración | Redirigen al portal del rol (como antes) |
| Ruta desconocida | `/personal` (como antes) |
| `/registro`, `/onboarding/<token>`, `/invitacion/<token>` | Sin cambios |

**Único cambio de comportamiento:** antes `/` redirigía al portal; ahora, con o sin sesión, muestra el landing. El botón
«Ingresar» de la barra lleva a `/personal` y desde ahí la sesión decide el portal, como siempre.

## Reemplazar el video y las imágenes

Los archivos van en `frontend/public/landing/` **con estos nombres exactos**. Mientras falte uno, la página muestra en
su lugar un hueco punteado con el nombre, la proporción y las medidas esperadas (no una imagen rota).

| Archivo | Dónde sale | Formato | Medidas | Peso máximo |
|---|---|---|---|---|
| `hero.mp4` | Video del hero | H.264, **sin audio**, 8–15 s que empalmen en bucle | 1920 × 1080 (16:9) | 3 MB |
| `hero.webm` | El mismo video (Chrome/Firefox lo prefieren) | VP9, sin audio | 1920 × 1080 | 2 MB |
| `hero-poster.jpg` | Primer cuadro del video; lo único que se ve con movimiento reducido. **Es el LCP** | JPEG progresivo | 1920 × 1080 | **140 KB** |
| `card-garita.jpg` | Tarjeta «Garita» | JPEG | 1200 × 1500 (4:5) | 180 KB |
| `card-portal.jpg` | Tarjeta «Portal del residente» | JPEG | 1200 × 1500 (4:5) | 180 KB |
| `card-admin.jpg` | Tarjeta «Administración» | JPEG | 1200 × 1500 (4:5) | 180 KB |
| `seccion-camaras.jpg` | «Lo que hace hoy», junto a las cámaras | JPEG | 1500 × 1000 (3:2) | 200 KB |
| `seccion-qr.jpg` | «Lo que hace hoy», junto al QR | JPEG | 1500 × 1000 (3:2) | 200 KB |
| `og.jpg` | Vista previa al compartir el enlace (WhatsApp, Facebook) | JPEG | 1200 × 630 | 300 KB |
| `ficha-tecnica.pdf` | Enlace «ficha técnica mínima» del paquete Licencia | PDF | — | — |

**Recortes (dejar lo importante al centro):**
- Hero: en escritorio el bloque se recorta a **3:2** y lleva un corte diagonal a la izquierda (13 % arriba); en teléfono va
  de borde a borde con un corte suave abajo.
- Tarjetas: la de la garita se ve completa (4:5) con la esquina superior derecha cortada; la del portal es más alta
  (se recorta por los lados); la de administración es cuadrada y se recorta arriba y abajo (punto de enfoque al 30 %
  desde arriba). En teléfono las tres se ven cuadradas.

**Textos alternativos:** cada imagen tiene su `alt` en `contenido.ts` (`HERO.video.alt`, `TARJETAS[].alt`,
`QUE_HACE.imagenes.*.alt` y `pie`). Hoy describen lo que la foto **debería** mostrar: si la foto que pongas muestra otra
cosa, cambiá el texto.

**Cómo preparar el video** (ffmpeg, desde el archivo original):

```bash
ffmpeg -i original.mov -an -vf "scale=1920:-2,fps=30" -c:v libx264 -crf 26 -preset slow -pix_fmt yuv420p -movflags +faststart hero.mp4
ffmpeg -i original.mov -an -vf "scale=1920:-2,fps=30" -c:v libvpx-vp9 -crf 38 -b:v 0 -row-mt 1 hero.webm
ffmpeg -ss 0 -i hero.mp4 -frames:v 1 -q:v 5 hero-poster.jpg     # luego comprimilo hasta ≤ 140 KB
```

El póster tiene que ser el primer cuadro del video: el video aparece encima con un fundido cuando empieza a reproducirse.

**Publicar los cambios:**
- En desarrollo (Vite) basta con copiar los archivos.
- En producción los archivos se copian **dentro de la imagen** del frontend al compilar: hay que volver a construir y
  desplegar el frontend. nginx los sirve con una hora de caché (`frontend/nginx.spa.conf`, `location /landing/`), y un
  archivo que falta responde 404 (no `index.html`).
- No hay variantes por tamaño (`srcset`): Vite copia `public/` tal cual. Por eso los topes de peso de la tabla.

## Editar textos

Todo está en `frontend/src/landing/contenido.ts`, por sección (`HERO`, `TARJETAS`, `COMO_FUNCIONA`, `QUE_HACE`,
`PRECIOS`, `PREGUNTAS`, `CONTACTO`, `PIE`). Reglas, que además vigila `src/landing/__tests__/Landing.test.tsx`:

- **Vos** en todo el landing («pedí», «escribinos», «elegí»), sin mezclar con tú. Los nombres de las cosas son los del
  glosario de la app (`docs/glosario.md`): «invitación con QR», «aviso de visita», «verificación en dos pasos».
- Sin emojis, sin superlativos («el mejor», «revolucionario»…), sin testimonios, logos de clientes ni cifras de clientes.
- Solo lo que el sistema hace hoy. Una frase que no dice algo verificable, se borra.
- Lo que falta se deja en `null` (o en `pendiente`, en las preguntas) y la página lo pinta como `[POR CONFIRMAR: …]`.
  Nunca se rellena con un dato inventado.
- Contacto directo: `CONTACTO.whatsapp` (solo dígitos, con código de país: `502` + los 8 del número) y
  `CONTACTO.correo`. Con el WhatsApp puesto, el botón «Abrir WhatsApp» se activa solo (`https://wa.me/<número>`).
- Razón social del pie: `PIE.razonSocial`.

## Editar precios

`frontend/src/landing/planes.ts`, solo las tres constantes de datos:

```ts
export const HOGARES = [50, 100, 200, 500, 1000] as const;   // tramos publicados
export const CASETAS = [1, 1, 2, 3, 5];                      // casetas con que se calculó cada tramo
export const PLANES = { compra: [[primerPago, mensualidad], …], alquiler: …, licencia: … };
```

- Montos en quetzales enteros, **con IVA incluido**. La tabla los formatea con `Intl.NumberFormat('es-GT', { style:
  'currency', currency: 'GTQ' })`.
- La tabla, las notas («Cálculo con 1, 1, 2, 3 y 5 casetas…»), el texto del botón y el JSON-LD de buscadores salen de
  aquí. No hay montos escritos en otro lado.
- «Más de 1,000» no tiene monto publicado: la página dice «Cotización a medida» y el formulario queda con ese tramo.
- `PAQUETE_DESTACADO` está en `null`: ningún paquete dice «el más pedido». Ponerle `'alquiler'` (u otro) solo cuando
  haya datos que lo respalden; la columna gana el rótulo y una línea de acento.
- Lo que incluye cada paquete (equipo, instalación, mantenimiento, contrato mínimo) está en `PRECIOS` de `contenido.ts`.
- `__tests__/planes.test.ts` comprueba la forma de los datos, el formato de moneda y que la mensualidad crezca con los
  hogares; si un cambio de precios rompe esto último a propósito, ajustá la prueba.

## Formulario y backend

`POST /api/contacto` (público, sin sesión):

| Caso | Respuesta |
|---|---|
| Datos válidos | **201** `{ ok, mensaje }` (nunca devuelve correos) y una fila en `contactos` |
| Datos inválidos | **400** `{ error, campos: { campo: "mensaje en español" } }`; no guarda nada |
| Campo trampa `sitio_web` lleno (robot) | **201** idéntico al éxito; no guarda nada |
| Más de 5 por hora desde la misma IP | **429**; no guarda nada |

- Validación con `express-validator`, con las mismas reglas que el navegador (`componentes/validacionContacto.ts`).
- Auditoría `CONTACTO_RECIBIDO` (`docs/acciones_sensibles.md`): id del contacto y tramo; nunca nombre, teléfono ni correo.
  Los rechazos (400, trampa, 429) también quedan.
- **No manda correos.** El aviso al equipo comercial es un TODO en `backend/src/controllers/contacto.controller.ts`.
  Mientras tanto, los contactos se leen en la base:

```sql
SELECT created_at AT TIME ZONE 'America/Guatemala' AS fecha, nombre, residencial, hogares, telefono, email, mensaje
  FROM contactos ORDER BY created_at DESC LIMIT 50;
```

## Variables de entorno nuevas

| Variable | Dónde | Para qué | Por omisión |
|---|---|---|---|
| `VITE_SITE_URL` | Frontend, **al compilar** (argumento de build en `frontend/Dockerfile`; `docker-compose.prod.yml` le pasa `PUBLIC_URL`) | URL absoluta de `og:image`, `og:url` y `canonical`. Sin ella la imagen de la vista previa queda relativa y WhatsApp/Facebook no la muestran | vacía |
| `RATE_LIMIT_CONTACTO_MAX` | Backend | Formularios por hora y por IP | `5` |

No hay variables nuevas obligatorias: con las de siempre (`PUBLIC_URL` en producción) basta.

## Desarrollo local

- Dependencias nuevas del frontend: `@fontsource/schibsted-grotesk`, `@fontsource/instrument-sans`,
  `@fontsource/ibm-plex-mono`. El contenedor `frontend` del `docker-compose.yml` guarda `node_modules` en un volumen
  anónimo, así que hay que recrearlo: `docker compose up -d --build --renew-anon-volumes frontend`.
- La tabla `contactos` la crea `database/init.sql` al arrancar el backend (es idempotente, como el resto del esquema).

## Diseño (por qué se ve así)

- **Colores:** salen de los tokens de la app (`src/styles/tokens.ts`): neutros pizarra del tema claro para texto y
  grises, el lienzo claro de la app como fondo y el azul noche del tema **oscuro** de la app para la única sección
  oscura («Cómo funciona»). El logo es el de la app (chip carbón, escudo blanco). La app no tiene color de acento (su
  marca es carbón a propósito), así que el único color propio del landing es el cian `#00B8D9` de la propuesta
  **[POR CONFIRMAR: hex real de la marca]**. Se usa poco: botón primario, el subrayado de «Todo registrado», el estado
  activo de la barra y de la regla de hogares. Sobre claro nunca va como texto (2.4:1): el botón lleva texto tinta (7.5:1).
  `__tests__/tokens.test.ts` mide el contraste AA de cada pareja que usa la página.
- **Tipografía:** Schibsted Grotesk 700/800 en titulares, Instrument Sans 400–600 en el cuerpo e IBM Plex Mono en cifras
  y rótulos técnicos; autoalojadas, subconjunto latino, `font-display: swap`. Escala cerrada de nueve pasos en
  `tailwind.landing.config.ts` (no hay tamaños sueltos).
- **Firma visual:** el corte diagonal (la talanquera a medio subir) en el video, las tarjetas y el borde de la sección
  oscura; cuadrícula técnica tenue con cruces de registro detrás del hero; contorno desplazado en vez de sombras.
- **Movimiento:** una entrada orquestada en el hero y un fundido hacia arriba por bloque con IntersectionObserver; solo
  `transform` y `opacity`. Con `prefers-reduced-motion: reduce` no hay animaciones ni video (queda el póster). El video
  tiene botón de pausa (WCAG 2.2.2).
- **Accesibilidad:** un solo `h1`, encabezados sin saltos, enlace «Saltar al contenido», `lang="es"`, anillo de foco
  visible en los 29 elementos enfocables (recorrido con Tab comprobado), preguntas con `<details>` nativo, precios en
  una `<table>` con encabezados, regla de hogares con radios nativos, errores del formulario con `aria-invalid` y
  `aria-describedby`, y el resultado del envío en una región `aria-live` que recibe el foco.

## Rendimiento medido

Build de producción, 412 px, red 4G lenta emulada (150 ms, 1.6 Mbps), CPU 4× más lenta, sin caché; mediana de 3:

| Caso | LCP |
|---|---|
| Sin medios (el LCP es el titular) | 1.57 s |
| Póster de 140 KB | 2.27 s |
| Póster de 226 KB | 2.68 s (pasa del objetivo de 2.5 s) |

El póster se precarga desde `main.tsx` solo en `/`. Chunks del landing: 13.8 KB de JS y 7.7 KB de CSS (gzip), más las
fuentes (woff2 de 15 a 25 KB cada una, se bajan solo las que se usan). React (61 KB gzip) es común a las dos entradas.

## Pendientes `[POR CONFIRMAR]`

Visibles en la página hasta que se completen:

- Hex real del acento de la marca (hoy `#00B8D9`, en `tokens.ts` y `landing.css`).
- Número de WhatsApp y correo de contacto (`CONTACTO`).
- Razón social (`PIE`).
- Contrato mínimo de Compra y de Licencia (`PRECIOS.filas.contrato`).
- Preguntas: tiempo de instalación por caseta; qué cuenta como hogar; cómo se pide factura; dónde se alojan los datos y
  cuánto se conservan al terminar el contrato; frecuencia del mantenimiento y tiempo de respuesta.
- Ficha técnica mínima del paquete Licencia (hoy un PDF provisional).
- Todos los medios de la tabla de arriba.
- Si «Alquiler» se marca como «el más pedido» (`PAQUETE_DESTACADO`).
