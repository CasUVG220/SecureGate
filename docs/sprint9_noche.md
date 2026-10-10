# Sprint 9 — Bitácora del trabajo nocturno (rama `sprint9-noche`)

Trabajo autónomo sobre `origin/main` @ `ba5de8d` (10/10/2026). Remoto `origin` = `CasUVG220/SecureGate`.
Nada se fusionó ni se empujó a `main`; todo vive en `sprint9-noche` y termina en un PR en borrador.
Las pruebas de base de datos corrieron **solo** contra el Postgres desechable local (`sg-test-db`, puerto 55432,
`securegate_test`); no se tocó producción, la VM, Cloud SQL ni secretos.

> El QA `docs/qa_backlog_s9.md` (10/10/2026) entró como insumo. Cada ticket se verificó leyendo el código real;
> donde el QA estaba desactualizado se anota.

## Resumen de estado

| Ticket | Tema | Estado |
|---|---|---|
| SCRUM-118 | Seguridad urgente (audit, deploy, nginx, documentos) | **HECHO** |
| SCRUM-108 | H01 · contraste del botón principal en tema oscuro | **HECHO** |
| SCRUM-109 | H02 · editar y dar de baja personal (PUT /usuarios/:id + AgentesPage) | **HECHO** |
| SCRUM-110 | H03 · lista negra por placa | **HECHO** |
| SCRUM-111 | H04 · garita sin cámara | **HECHO** (la salida sin red se deja en línea, decisión documentada) |
| SCRUM-112 | H05+H07 · pagos, avisos y confirmaciones | **HECHO** |
| SCRUM-113 | H06+H08 · fechas, placa y glosario | **HECHO** |
| SCRUM-114 | H09+H10 · pasos tras las altas y avisos de visita | **HECHO** |
| SCRUM-115 | H11+H12 · reportes, anuncios y consistencia visual | **HECHO** (el logo se guarda dentro de la base como imagen pequeña: decisión documentada) |
| SCRUM-129 | Deuda de seguridad S-11, S-13, S-14, S-15 | **HECHO** (S-15 revisada, Tauri 2.12 pendiente de validar en Windows) |
| SCRUM-125 | RNF-10 · auditoría completa y límites de tasa | **HECHO** (los eventos de 2FA entraron con SCRUM-123) |
| SCRUM-123 | Verificación en dos pasos (TOTP) para administradores | **HECHO** (opcional por persona; hacerla obligatoria queda como siguiente paso documentado) |
| SCRUM-117 | Validación en Windows y deuda técnica mínima | **PARCIAL** (CI y revisión de `npm audit` hechos; la validación en Windows necesita un equipo y una persona) |
| SCRUM-126 | Espejo local de invitaciones QR (modo offline) | **HECHO** (revocar sin red: se rechaza al sincronizar, documentado) |
| SCRUM-124 | Reutilización del refresh token (S-06) y TIMESTAMPTZ (S-17) | **HECHO** (S-17 queda por probar sobre una copia de producción antes de desplegar; la suite de seguridad en vivo está actualizada pero no se ejecutó) |


## Línea base (antes de tocar nada)

| Suite | Resultado |
|---|---|
| Backend `npm test` (unitarias) | 30 suites · **594** pruebas · verde |
| Backend integración + regresión (`npm run test:ci`, Postgres 55432) | 6 suites · **25** pruebas · verde |
| Backend `tsc --noEmit` | limpio |
| Frontend `npm test` · `npm run build` | 22 archivos · **165** pruebas · build verde |
| Desktop `npm test` · `npm run build` | 11 archivos · **79** pruebas · build verde |

Comando de verificación usado después de cada ticket: unitarias + `test:ci` + `tsc` en backend; `npm test` y
`npm run build` en frontend y desktop.

---

## SCRUM-118 — Seguridad urgente · **HECHO**

**Commits:** `a5d1723` (audit fix) · `5e69327` (deploy.sh + guarda del backend) · `5c86212` (nginx plantilla + render) ·
`2b40a57` (pruebas) · `74cfa44` (cifras en documentos). También `dfbdde5` (se versionó `docs/qa_backlog_s9.md`, que estaba sin
seguimiento; si no lo quieres en el PR basta con descartar ese commit).
**Resultado de las suites tras el ticket:** backend 628 unitarias (+34), 25 integración/regresión, `tsc` limpio;
frontend 165 + build; desktop 79 + build. Todo verde.

### a) `npm audit fix` en backend
- Solo tocó `backend/package-lock.json` (sin cambios mayores): `proxy-addr` 2.0.7 → 2.0.8 (la crítica, suplantación de
  IP que afectaba a `req.ip`, o sea a límites de tasa y auditoría), `handlebars` 4.7.9 → 4.7.10 (crítica solo de
  desarrollo, vía `ts-jest`), más `@grpc/grpc-js`, `brace-expansion`, `http-cache-semantics`, `joi` y `moment`
  (transitivas de `artillery`, solo desarrollo).
- **Cifras de `npm audit` (hoy, tal cual):**

| Proyecto | Completo | `--omit=dev` |
|---|---|---|
| backend **antes** | `47 vulnerabilities (10 moderate, 35 high, 2 critical)` | `3 vulnerabilities (2 moderate, 1 critical)` |
| backend **después** | `40 vulnerabilities (8 moderate, 32 high)` | `2 moderate severity vulnerabilities` |
| frontend | `11 vulnerabilities (5 moderate, 6 high)` | `found 0 vulnerabilities` |
| desktop | `8 vulnerabilities (2 moderate, 6 high)` | `found 0 vulnerabilities` |

- Verificado: **0 críticas** con `npm audit --omit=dev`; las dos moderadas que quedan son `node-cron`→`uuid` (S-14,
  ticket SCRUM-129). Suites siguen verdes (594 + 25 + `tsc`).

### b) `scripts/deploy.sh`
- **Producción por defecto**: `COMPOSE_FILE` ahora vale `docker-compose.prod.yml`; el compose de desarrollo se pide
  explícitamente (`COMPOSE_FILE=docker-compose.yml ./scripts/deploy.sh`) y avisa.
- **Guarda de la pasarela simulada:** en cualquier despliegue que no sea el compose de desarrollo, el script falla
  (código 1, mensaje en español con el origen) si `PAGOS_TARJETA_SIMULADA` está activa en el entorno, en el archivo
  `.env` (con comillas/mayúsculas/comentarios) o como variable no comentada dentro del compose. Se tratan como
  «activa» `true`, `1`, `yes`, `on`, `si` (el backend solo reconoce `true`, pero la guarda falla hacia el lado seguro).
- **Defensa en profundidad (decisión mía, no pedida):** `backend/src/config/env.ts` → `validarEntorno()` aborta el
  arranque en `NODE_ENV=production` si la bandera está activa (`pagoSimuladoActivo()`), con el mismo criterio.
- Nuevo modo `--check`: valida guardas y genera nginx sin tocar git, `.env` ni Docker (lo usan las pruebas).
- `ENV_FILE` (por defecto `.env`) permite apuntar a otro archivo de entorno; `docker compose` recibe `--env-file`.

### c) `nginx` sin el literal `DOMINIO`
- `nginx/nginx.conf` → `nginx/nginx.conf.template` (4 marcadores `${DOMINIO}`: `server_name` ×2 y rutas del certificado).
- Nuevo `scripts/render-nginx.sh` (bash puro, sin `envsubst`/`sed`): toma el dominio de `DOMINIO`, o de `DOMINIO=` en
  el `.env`, o del host de `PUBLIC_URL`; lo normaliza a minúsculas y **exige un FQDN válido** (rechaza vacío, el
  literal `DOMINIO`, `localhost`, esquemas, puertos, espacios y cualquier cosa que pudiera inyectar directivas).
  Solo sustituye `${DOMINIO}` (las variables de nginx como `$host` quedan intactas) y **aborta sin escribir nada**
  si queda un marcador o la palabra `DOMINIO` en el resultado.
- `nginx/nginx.conf` (generado) está en `.gitignore`. `docker-compose.prod.yml` lo monta con `create_host_path: false`,
  así que si alguien levanta el compose sin generarlo, Compose aborta en vez de crear un directorio vacío y dejar a
  nginx en crash-loop.
- `nginx/certbot-init.sh` ahora lee `DOMINIO` y `EMAIL` del entorno y falla si faltan o siguen con el valor de relleno.
- **Aviso para quien despliegue:** si en la VM `nginx/nginx.conf` se editó a mano (con el dominio real), el próximo
  `git pull` se quejará de que ese archivo cambia; hacer `git checkout nginx/nginx.conf` antes (el dominio ahora viene
  de `DOMINIO`/`PUBLIC_URL`). No se tocó la VM.
- Pruebas: `backend/src/__tests__/deploy.guardas.test.ts` (34 pruebas) corre `deploy.sh --check` y `render-nginx.sh`
  sobre una copia temporal del repo: sin dominio, dominio inválido/literal, bandera activa en entorno/`.env`/compose,
  bandera en comentario (no estorba), dominio por `PUBLIC_URL`, marcador residual, compose de desarrollo.

### d) Documentos con las cifras reales
- `backend/DEUDA_TECNICA.md` (filas S-13 y S-14) y `backend/securitytest/RESULTADOS.md` (nueva sección «l-bis») con
  las salidas de `npm audit` de hoy. La cifra «3 moderadas» de S-13 estaba desactualizada (hoy 11 en el audit completo,
  0 en producción). Se volverán a actualizar al cerrar SCRUM-129.

### e) Historial de `ca9e7a2` y `ba5de8d` (demostración de la Tarea 5)
- `ca9e7a2` (6/10/2026 20:04 CST) **quitó** `ownershipClause`/`ownershipParams` de la consulta de alcance de
  `getDisponibilidad` en `reservas.controller.ts`: reintroducía el hallazgo S-04 (un usuario de una empresa podía leer
  nombre, tarifa y horarios de un área de **otra** empresa). Fue una regresión **deliberada** para demostrar que el CI
  la atrapa (R-1 falló con 4 pruebas; ver `docs/tarea5_bitacora.md`, Fase F).
- `ba5de8d` (20:07 CST) la **restableció** (es un `git revert` literal de `ca9e7a2`).
- **Verificado hoy:** `git diff ca9e7a2~1 ba5de8d` está **vacío**; el código actual de `main` es idéntico al anterior a
  la regresión y las pruebas R-1/R-2/R-3 pasan. **El estado actual es correcto.** Lo único a tener presente es que el
  historial publicado contiene esa regresión intencional durante ~3 minutos de commits; no hay que reescribirlo.

---

## SCRUM-108 — H01 · Botón principal ilegible en tema oscuro · **HECHO**

**Commits:** `4c9816f` (red de seguridad global + prueba) · `1370260` (migración de los sitios).
**Verificado contra el código:** el QA tenía razón en la causa: en oscuro `brand-300…800` son grises claros
(`index.css` ~137-138) y `tailwind.config.ts` mapea `blue/teal/cyan/indigo/purple → brand`. Había 24 sitios con
`bg-blue-600 … text-white` (el QA decía ≈35 coincidencias contando `hover:` y `from-`), más 3 botones con degradado
`from-blue-600` en `OwnerEmpresas`.

**Solución global (`frontend/src/index.css`):** en `html.dark`, cualquier elemento con un relleno **sólido** (sin `/alfa`) de
la familia de marca —`bg-*` o `from-*`, tonos 300-800, alias heredados incluidos— y `text-white` toma `--c-brand-ink`.
Es la misma tinta que usa `<Button>`. Como `desktop/src/index.css` importa el CSS del frontend, la app de escritorio la
hereda sin cambios.

**Medición real (Chrome headless, no solo cálculo):** `bg-blue-600 text-white` heredado pasó de ≈1.1:1 a **16.1:1** en oscuro;
`bg-brand-500 text-brand-ink` 14.0:1 (oscuro) y 14.9:1 (claro); botón de peligro 4.83:1 (oscuro) y 6.47:1 (claro).

**Migración:** AreasComunes, ConfiguracionQr, ConfiguracionReservas, ConfigCargos (×3), Preaut (×2), ReservasAdmin (pestañas),
TicketChat (burbuja propia y «Enviar»), QrInviteModal, ResidentePage, SalidaPage, OwnerDashboard, OwnerEmpresas (×3 + pestañas),
EmpresaDetail (×3), GestionSucursales (×3 + filtro) y la insignia «Historial» de GaritaPage pasan a `<Button>` o a
`bg-brand-500 text-brand-ink`. Los botones de «cancelar» con texto gris sin forma pasan a `<Button variant="ghost">`.

**Decisiones**
- Los verdes de acción con texto blanco (`bg-emerald-600`: 3.77:1 en oscuro) suben a `emerald-700` (5.48:1) y su hover a 600;
  la insignia de tickets sin leer (`bg-danger-500`) y el `Button` de peligro pasan a `danger-600/700` (4.83:1 en oscuro).
  `active:` del botón de peligro usa 700 (no 800: en claro el 800 es un tinte pálido).
- La prueba mide las 3 familias de estado (éxito/peligro/advertencia): ≥ 4.5:1 en reposo y ≥ 3:1 en hover (en oscuro el hover
  aclara).

**Prueba automática (`frontend/src/styles/__tests__/contraste.test.ts`, 12 pruebas):** razón WCAG de los pares del sistema
en ambos temas; existe la red de seguridad y cubre toda la familia; y un recorrido con el parser de TypeScript que **falla**
si alguien escribe otra vez «relleno sólido de marca + `text-white`» (o un verde/rojo que no llegue a AA).
Importa `tailwind.config.ts` dinámicamente para no arrastrarlo al `tsconfig` de la app.

**Suites tras el ticket:** frontend 177 (+12) y build OK; desktop 79 y build OK; backend sin cambios.
**Pendiente:** confirmación visual humana en un equipo real (no hubo navegador con extensión conectado; la medición fue con
`Google Chrome --headless --dump-dom` sobre una página de muestra con el CSS compilado).

---

## SCRUM-109 — H02 · Editar y dar de baja agentes · **HECHO**

**Commits:** ver `git log --grep SCRUM-109` (backend, pruebas de integración, frontend).
**Verificado contra el código:** el QA acertó: `DELETE /usuarios/:id` ya existía con control de alcance, auditoría
(`USUARIO_DESACTIVADO`) y revocación de sesiones; faltaban la edición y toda la interfaz (ni `RowActions` ni funciones de API).

**Backend (`usuarios.controller.ts`, `usuarios.routes.ts`, `audit.middleware.ts`)**
- `PUT /api/usuarios/:id` con `nombre`, `email`, `rol` y `password` (todos opcionales, al menos uno). `requireAdminSucursal` +
  `auditLog('USUARIO_EDITADO')`.
- **Alcance idéntico al de la baja**: owner → cualquiera menos otro owner; admin de empresa → admin_sucursal/agente/residente de
  SU empresa; admin de sucursal → los mismos roles de SU sucursal. Fuera de alcance → **404** (no confirma que el UUID exista).
- **Decisiones:** (1) nadie se edita a sí mismo por esta ruta (mismo criterio que la baja: cambiar el propio rol/contraseña sin
  pedir la actual sería una vía de escalada o de robo de sesión); (2) el rol solo se mueve entre `agente` ↔ `admin_sucursal`
  (owner, admin_empresa y residente tienen su propio flujo; asignar cualquier otro → 400); (3) contraseña vacía = «no cambiar»;
  (4) un usuario ya dado de baja puede corregirse pero **no** reactivarse (no hay campo `activo`; «reactivar» no estaba pedido).
- **Sesiones:** cambiar la contraseña revoca todos los refresh tokens del usuario y su access token; cambiar el rol invalida el
  access token (lleva el rol viejo) pero deja el refresh para que el siguiente `/auth/refresh` traiga el rol nuevo.
  La baja ya revocaba los refresh tokens (verificado ahora con una prueba de integración).
- **Auditoría:** el middleware acepta `res.locals.auditoria` y lo guarda en `datos_nuevos`; para este endpoint:
  `{campos:[…], rol_anterior, rol_nuevo}` — nunca la contraseña. Los intentos rechazados (404) también quedan con su código HTTP.

**Frontend:** `AgentesPage` gana la columna **Acciones** con el menú «···» (`RowActions`, `inline={0}`) con **Editar** (Modal:
nombre, correo, rol, contraseña nueva opcional con mostrar/ocultar y requisitos) y **Dar de baja** (Modal de confirmación, tono
de peligro). No aparece en la fila propia, en filas ya dadas de baja ni en owners. Solo se envía lo que cambió. Nuevo
`PasswordInput` en el kit de UI (sincronizado con desktop), que reutilizarán SCRUM-114/115.

**Pruebas:** integración **I-4** (`integration/usuarios.int.test.ts`, 30 pruebas, Postgres real): edición dentro del alcance,
contraseña (revoca refresh/access), validaciones (400/404/409), **9 cruces entre empresas/sucursales/roles** (todos 404 y la
fila no cambia), owner contra owner, 403 para agente/residente, auditoría con usuario/IP/código, y baja con revocación de
refresh tokens. Además la ruta entró a la matriz de roles de `security.routes.contract.test.ts`. Frontend: `AgentesPage.test`
(9) y `PasswordInput.test` (6).

**Suites tras el ticket:** backend 631 unitarias, 55 integración/regresión, `tsc` limpio; frontend 192 y build; desktop 79 y build.

---

## SCRUM-110 — H03 · Lista negra por placa · **HECHO**

**Commits:** ver `git log --grep SCRUM-110` (backend, pruebas I-5, web + escritorio).
**Verificado contra el código:** el QA tenía razón: `checkBlacklist` solo miraba `visitantes.numero_dpi`, la tabla colgaba de
`visitante_id NOT NULL` y la página solo buscaba por DPI sin mensaje de «sin resultados».

**Decisión de modelo (la más simple y segura):** NO se crea una tabla nueva. Una fila de `visitante_blacklist` identifica **al
visitante (por DPI), a un vehículo (placa) o a ambos**: `visitante_id` pasa a admitir NULL, se agrega `placa` y un `CHECK` exige
que haya al menos uno. Razones: (1) reutiliza vigencia, motivo, aislamiento por sucursal, auditoría (`BLACKLIST_AGREGADO/REMOVIDO`)
y la pantalla que ya existen; (2) bloquear una placa que nunca pasó por la garita no exige inventar un visitante; (3) el bloqueo por
DPI no cambia (mismo SQL y mismas pruebas). La placa se guarda **normalizada** (`P123ABC`, `CHECK ^[A-Z0-9]{3,20}$`) y se compara
normalizada, así que `p-123 abc` y `P123ABC` son el mismo vehículo. Migración idempotente en `database/init.sql` (se aplica en cada
arranque; probada contra el Postgres desechable).

**Backend**
- `checkBlacklist(dpi, sucursal, placa?)`: DPI de sucursal → DPI vetado por el residente → placa. Si no llega placa, las consultas y
  parámetros son los de antes (los 3 tests unitarios existentes no cambiaron).
- `registrarAcceso`: misma respuesta **403 «Visitante en blacklist»** + `razon`, `fecha_fin` y el nuevo `motivo: 'dpi' | 'placa'`;
  se rechaza antes de crear el visitante, así que no deja filas.
- `POST /blacklist` acepta `visitante_id` o `placa` (o ambos); valida (placa 4-12 alfanuméricos, razón obligatoria, UUID), y rechaza
  duplicados vigentes con **409** (misma placa en otro formato, o el mismo visitante dos veces).
- `GET /visitantes?placa=` (junto a `?dpi=`, nunca los dos) con **el mismo alcance** por sucursal/empresa que el DPI.
- `GET /sync/garita` incluye los bloqueos por placa para el espejo offline del escritorio (antes el `INNER JOIN` los habría descartado).

**Web:** `BlacklistPage` reescrita sobre el kit (Modal, Input, Select, RowActions): selector **DPI / Placa**, etiqueta **«Buscar
visitante por DPI o placa»**, mensaje **«No se encontró ningún visitante con ese dato»** y, al buscar por placa sin resultados, el botón
«Bloquear solo la placa P-123ABC». Si se elige un visitante hallado por placa se ofrece «Bloquear también la placa» (marcada). El
bloqueo se quita con un Modal propio (ya no `window.confirm`) y el botón dejó de ser verde. Vocabulario «bloquear / quitar bloqueo».
La garita web distingue «vehículo» de «visitante» en el aviso.

**Escritorio (sin red):** `blacklist_local` gana `placa` (migración aditiva `ALTER TABLE` para bases existentes); el pull la guarda
normalizada y `evaluar_visitante` bloquea por DPI o por placa antes de encolar. Salvaguarda: un DPI vacío **nunca** coincide con un
bloqueo solo de vehículo (que se guarda con `numero_dpi = ''`), para no dar falsos positivos mientras el agente aún escribe.

**Pruebas:** integración **I-5** (`integration/blacklist.int.test.ts`, 20 pruebas, Postgres real): normalización de placa, 403 por placa
en 4 formatos sin escribir nada, vencidos/quitados, duplicados, CHECKs de la base, y **aislamiento** (A1≠B1≠A2, listado, DELETE ajeno
= 404, `sucursal_id` del body ignorado/403, búsqueda por DPI y placa por alcance, snapshot de sync por sucursal). Rust +6 (71),
frontend +16 (`BlacklistPage` 11, `placa` 5).

**Suites tras el ticket:** backend 631 unitarias, 75 integración/regresión, `tsc` limpio; frontend 208 y build; desktop 79 + 71 de
Rust y build.

---

## SCRUM-111 — H04 · Garita sin cámara · **HECHO**

**Commit:** `36d83c3`. **Verificado contra el código:** el QA acertó en todo: sin cámara el botón «Dar salida» quedaba apagado sin
decir por qué (solo `title`), no había manera de llegar a `SalidaDialog` sin una captura, la entrada manual del QR no existía, y el
panel derecho seguía mostrando «Registrar acceso / Registrar entrada» aunque la pestaña fuera Salida.

**Escritorio (`desktop/`)**
- **Escribir placa:** en el panel de *placa* enfoca el campo del formulario; en el de *salida* abre el diálogo de salida vacío.
- **Código QR a mano:** formulario «¿No se lee? Escribe el código» que acepta `SGQR:<id>` o el id solo (con/sin guiones, espacios,
  mayúsculas) → `idDeCodigoManual` (probado); formato inválido no llega al servidor.
- **Motivo visible:** `motivoDeshabilitado()` escribe bajo el botón «No hay cámara disponible…», «Abriendo la cámara…», «El OCR local no
  está disponible…» o «Sin conexión…»; «Registrar entrada» explica por qué está apagado (licencia/sesión o lista negra).
- **«Registrados en este equipo»:** buscador (nombre, DPI, casa, placa en cualquier formato; sin búsqueda muestra los 30 últimos y con
  búsqueda recorre los 150 que se traen) y **«Dar salida»** por fila usando el `registro_id` (ahora expuesto por Rust): no hace falta
  placa ni cámara, y sirve para quien entró a pie. Pendientes de enviar: botón apagado con el motivo; rechazados: sin botón.
- **Panel derecho en modo Salida** (`esModoSalida`: una vista + tarea Salida): título «Registrar salida», texto propio y botón
  «Escribir placa de salida»; el formulario de entrada queda montado pero oculto (no se pierde lo escrito).
- **Decisión sobre la salida SIN red: se deja EN LÍNEA.** La cola offline (`accesos_pendientes`) solo guarda **entradas**; no existe un
  espejo de accesos abiertos ni un endpoint idempotente para cerrar una salida encolada. Encolarla contra un acceso que otra garita ya
  cerró, o que aún no se sincroniza, dejaría vehículos «dentro» para siempre o cerraría el acceso equivocado. Hacerlo bien exige ese
  espejo + idempotencia (trabajo propio, con riesgo). Mitigación implementada: sin red el agente levanta la pluma con «Abrir talanquera» y
  la pantalla lo dice en texto; la salida se registra al volver la conexión. Documentado en `desktop/README.md`.

**Web (`frontend/`)**: sin cámara la garita muestra el aviso «el registro sigue funcionando», «Escribir placa» (enfoca el campo) y la
**entrada manual del código QR**. El modal de invitación del residente ahora **muestra y copia el código** bajo el QR (sin eso no hay
nada que teclear). `SalidaPage` ya permitía teclear la placa y tenía la lista de visitantes dentro; se agregó el texto de ayuda sin cámara.

**Pruebas:** desktop +21 (CameraPane manual, RecientesList, SalidaDialog con acceso conocido, `idDeCodigoManual`, `esModoSalida`),
frontend +6 (`GaritaPage.sinCamara`, `qr`), Rust 72 (+1: `registro_id` en recientes).
**Pendiente humano:** probar con una PC de garita real sin webcam y con el permiso de cámara denegado (Windows).

---

## SCRUM-112 — H05 + H07 · Pagos, avisos y confirmaciones · **HECHO**

**Commits:** `adb20a8` (backend) · `ce912f7` (dashboard) · `8515da7` (Toast/FormActions/sondeo) · `d85bbfb` (pantallas).
**Verificado contra el código** (el QA acertó en todo lo siguiente): no había advertencia de monto>saldo; los textos «Pago simulado… Visanet»
se pintaban siempre; cada intento de tarjeta rechazado se insertaba en `pagos`; `Toast` fijaba 4 s sin pausa ni variante persistente; el
ticket no se refrescaba; no había aviso de reservas por aprobar (el dashboard solo contaba pagos). «Anuncio creado» ya existía.

**Pagos (backend)**
- **Una tarjeta rechazada no es un pago:** `pagarConTarjeta` responde **402** y **no inserta nada**; el intento queda en `audit_logs`
  (`PAGO_TARJETA_SIMULADO`, usuario, IP, 402). Antes cada intento fallido era una fila `rechazado` que ensuciaba historial y reportes.
- **Nuevo `GET /pagos/tarjeta/estado`** → `{disponible, simulada}` (según `PAGOS_TARJETA_SIMULADA`). Cuando entre Visanet real la web deja de
  mostrar los avisos de prueba sin tocar la pantalla.
- **Reportes de ingresos:** `reportes.controller` (CSV de pagos) excluye `rechazado` (`?incluir_rechazados=1` los trae). La estadística
  «recaudado» ya sumaba solo `aprobado`. Los «pagos recientes» del residente y de su ficha excluyen rechazados.
- Lo que SÍ conserva un rechazo: un **comprobante de transferencia rechazado por el administrador** sigue existiendo (con su motivo) porque el
  residente necesita saberlo.

**Pagos (web)**
- `PagoTarjetaModal`: **advertencia** (no bloqueo) si monto > saldo, con ambas cifras y «Usar mi saldo (Q…)»; sin saldo avisa que no reduce
  ninguna deuda. Los textos «Pago simulado / Visanet / entorno de prueba» solo aparecen si `simulada` (prueba en la suite: con la bandera
  apagada el modal no contiene «simulad», «Visanet» ni «entorno de prueba»). Si la pasarela no está disponible, `ResidentePage` oculta el botón y
  explica que se puede pagar por transferencia. La insignia «Simulado» del historial también depende de la bandera.
- Historial del residente sin rechazados; los comprobantes rechazados quedan en una sección plegable «Comprobantes rechazados (n)» con el motivo.
  `PagosPage` (admin): «Todos (sin rechazados)» + contador de ocultos; «Rechazado» los muestra.

**Avisos y confirmaciones**
- `Toast` (kit de UI): **errores persistentes** (se cierran con su ✕), **acción opcional** («Ver anuncio», «Ver mi reserva», «Revisar ahora»; las
  confirmaciones con acción también persisten), pausa al pasar el cursor/foco (WCAG 2.2.1), máximo 4 a la vez.
- **Anuncios:** «Publicar anuncio» con un recuadro previo «Quién lo verá» (de inmediato / desde la fecha / hasta la fecha o sin fin / urgente en rojo);
  confirmación persistente con «Ver anuncio» que desplaza y resalta la fila nueva; botones fijos al pie del diálogo.
- **«Guardar» fijo al pie** (`FormActions`, `position: sticky`) en Configuración de QR y de Reservas, con «Hay cambios sin guardar»; el formulario de
  área común y el de anuncios pasaron al `Modal` con `footer`.
- **Solicitudes:** `usePolling` (10 s el chat, 15 s las listas del admin y del residente; solo con pestaña visible; sin apilar; sin esqueleto). La
  prueba atrapó un defecto mío: la detección de cambios dentro de `setState` no corría a tiempo, ahora usa una firma estado+mensajes.
- **Reservas por aprobar:** `GET /dashboard` suma `reservas_pendientes`; fila «Reservas por aprobar» (con acción) en el dashboard, insignia en el menú
  (se refresca cada 30 s), banner con «Ver solo pendientes» en la pantalla de reservas y toast cuando llega una nueva.

**Observaciones (no se cambiaron, para decisión del equipo):**
1. El modelo de pagos **«un pago liquida todo»** (`saldo_pendiente = 0` sin restar el monto, en tarjeta, efectivo y aprobación de transferencias): un pago
   parcial deja el saldo en cero y uno mayor registra un ingreso inflado. La advertencia de monto es solo de interfaz.
2. El CSV de pagos todavía lista los cargos de `metodo = 'reserva'` (deuda generada); la estadística ya los excluye para no contar doble.

**Pruebas:** integración **I-6** (`integration/pagos.int.test.ts`, 11): aprobada/rechazada (402 sin fila, saldo intacto, auditoría con IP), bandera apagada (501),
estado de la pasarela, CSV y estadística sin rechazados, «recientes» sin rechazados, aislamiento de `/pagos` entre empresas. Unitarias: tarjeta (402, estado),
dashboard (+ reservas). Frontend +29: `Toast`, `usePolling`, `TicketChat.sondeo`, `AnunciosPage`, `ConfiguracionBarraFija`, `DashboardPage`, `PagoTarjeta`,
`PagosPage`, `AdminReservasPage`.

**Suites tras el ticket:** backend 637 unitarias, 86 integración/regresión, `tsc` limpio; frontend 249 y build; desktop 100 + Rust 72 y build.

---

## SCRUM-113 — H06 + H08 · Glosario, fechas y placa · **HECHO**

**Commits:** `83c9ada` (placa en backend y escritorio) · `e9a05ad` (fechas y campo de placa en la web) · el de glosario/menú (ver `git log --grep SCRUM-113`).
**Verificado contra el código:** 32 llamadas `toLocale*String` (el QA decía 32; contadas hoy: 31 de fecha/hora + 4 de rangos en `charts/format.ts`), ninguna con zona;
las reservas usaban `timeZone: 'UTC'`; «hoy» se calculaba con `toISOString().slice(0, 10)` en 5 pantallas (**defecto real**: a partir de las 6 pm de
Guatemala el formulario arrancaba con la fecha de mañana); los ejemplos de placa eran `P123ABC` y `P-123ABC` y la placa se guardaba tal cual se tecleaba.

**Fechas — `frontend/src/utils/fecha.ts`**
- Toda hora en **America/Guatemala** (no en la del navegador), mes abreviado y escrito («1 nov 2026»; EN «Nov 1, 2026»), 24 h, tablas propias de meses y días
  (no dependen de cómo escriba ICU «sept.»/«nov.»), «—» ante vacío o inválido.
- Dos clases de valor: **instantes** (`formatearFecha`, `formatearFechaHora`, `formatearHora`…) y **días de calendario** de columnas DATE (`formatearDia`,
  `formatearDiaMes`, `formatearRangoDias`…), que se leen sin corrimiento de zona (`2026-12-10T00:00Z` sería el 9 en Guatemala).
- `hoyEnZona()` sustituye al cálculo en UTC. Los tres formateadores de `charts/format.ts` pasan por aquí.
- **Prueba de regresión** `sinToLocale.test.ts` (parser de TypeScript): falla si aparece `toLocaleDateString/TimeString/String` o `new Date().toISOString().slice(0, 10)`.
- Nota: los valores `TIMESTAMP` que escribe `NOW()` siguen desfasados 6 h por el defecto de raíz S-17 (Postgres en UTC, Node en America/Guatemala); este formateador
  muestra el instante que recibe y quedará exacto cuando se corrija S-17 (SCRUM-124, al final).

**Placa — una sola forma**
- Canónica (se guarda y se compara): `P123ABC`; presentación y entrada: `P-123ABC`.
- Backend: `utils/placa.ts`; accesos (`vehiculos`), preautorizaciones, invitaciones QR y la búsqueda de salida guardan la forma canónica y comparan **normalizando también
  la columna** (`regexp_replace(upper(placa), '[^A-Z0-9]', '', 'g')`), así que las filas viejas con guion o minúsculas siguen apareciendo. **No hay migración de datos**
  (decisión: cero riesgo en producción; un `UPDATE` único sería opcional). Placa absurda → 400. El OCR devuelve la forma canónica.
  Se corrigió además que `registrarAcceso` no pasaba la placa a `checkPreautorizacion`, por lo que una preautorización solo de placa nunca marcaba la entrada.
- Web: `PlacaInput` (mayúsculas + guion tras el prefijo, ejemplo único) en garita, salida, preautorizaciones, portal del residente e invitaciones QR; se envía normalizada y se
  muestra con guion. Escritorio: el espejo de preautorizaciones se guarda canónico, la evaluación local compara normalizado y la cola manda `P123ABC`.

**Glosario — `docs/glosario.md`**
- **Bloquear** (no «ban»), **Solicitud** (no «ticket»; la API sigue `tickets`), **Garitas y códigos de activación** (en la web de administración se dice «código», en la app de
  escritorio «licencia» es el *estado* del equipo), **Reportes** (no «Estadísticas»), **entradas** vs. **cobrado**, **Cargos y mora** (antes «Configuración»), **Reglas de QR**, formatos de
  fecha/placa/moneda. `glosario.test.ts` hace cumplir ban/ticket/estadísticas en ES y EN.
- **Entrada propia en el menú para «Reglas de QR»** (`config-qr`): ya no es una pestaña escondida dentro de cargos.

**Pruebas:** frontend +31 (`fecha` 18, `sinToLocale` 2, `glosario` 9, `PlacaInput` 4 y ajustes), integración **I-7** (`placas.int.test.ts`, 14), Rust 74 (+2).
**Suites tras el ticket:** backend 637 unitarias + 100 integración/regresión + `tsc`; frontend 282 + build; desktop 100 + Rust 74 + build. Todo verde.


---

## SCRUM-114 — H09 + H10 · Pasos siguientes tras las altas y aviso de visita · **HECHO**

**Commits:** `fbbd44f` (banderas «sin administrador» en el backend) · `774cc20` (alta única, siguiente paso, contraseña, menú) · `37be0b8` (primeros pasos de la sucursal) · `023bf63` (fechas y duplicados del aviso en el backend) · `620aef9` (texto del escritorio) · `038f88f` («Avisar de una visita» en la web, glosario).
**Verificado contra el código** (el QA acertó en todo): dos altas de empresa (`OwnerDashboard` y `OwnerEmpresas`, cada una con su modal), rótulo «Administración global» reutilizado en `ADMIN_EMPRESA_NAV`,
ningún ojo de contraseña en `owner/` ni `admin_empresa/`, tabla de preautorizaciones sin placa, dos formularios de preautorización y `fecha_fin` «opcional» en el formulario pero ignorada por el servidor.

**H09 — después de crear**
- **Un solo formulario de empresa** (`components/EmpresaModal.tsx`: alta y edición) para el panel y para la lista del owner. Al crear no se cierra de golpe: pasa a un segundo paso «Empresa creada» con
  **Invitar administrador** o **Ahora no**. Lo mismo al crear una **sucursal** (`GestionSucursales`).
- **«Invitar administrador»** (`components/InvitarAdminModal.tsx`) se extrajo del panel de invitaciones y sirve a dos entradas: el panel (se elige a quién) y el paso siguiente (el alcance ya está
  decidido y solo se escribe el correo). Se fue un `window.prompt` (copiar el enlace: ahora está visible y seleccionado).
- **Aviso «Sin administrador» / «Invitación pendiente»** en las listas de empresas y sucursales, con la acción **Invitar administrador** en la fila. `GET /api/empresas` y `GET /api/sucursales`
  devuelven `tiene_admin` e `invitacion_pendiente` (administrador activo / invitación vigente, no revocada ni vencida). Prueba de integración **I-8** (`altas.int.test.ts`).
- **Bienvenida con el primer paso** en los paneles vacíos: sin empresas (owner), sin sucursales (administrador de empresa) y sin residentes (administrador de sucursal: «Primeros pasos» con tres accesos
  directos). `GET /api/dashboard` devuelve `total_residentes` dentro de la misma consulta de la mora (sin recorrido extra).
- **Contraseña con ojo y requisitos visibles** (`PasswordInput`) en los formularios de usuario nuevo del owner y del administrador de empresa; sin cumplirlos no se envía.
- **«Administración global» solo para el owner**: el administrador de empresa ve **Mi empresa** (`navForRole` se exporta y una prueba lo vigila).
- Los rótulos «Admin», «Asignar Admin», «Admin Sucursal» pasan a **administrador** (glosario).

**H10 — aviso de visita**
- **Hallazgo:** el desajuste de `fecha_fin` no era un olvido sino dos conceptos mezclados en una tabla. Una fila **con** `fecha_fin` es una visita avisada; una fila **sin** ella es un «visitante guardado» de
  la libreta del residente (así la usa el portal: «Visitantes guardados», con `fecha_fin === null`) y **no autoriza nada**: `checkPreautorizacion`, `buscarPreautorizacion` y la evaluación local del escritorio
  ya lo exigían. El único sitio que los trataba como permanentes era el padrón de la garita (`/sync/garita`: `fecha_fin IS NULL OR …`), que ahora los excluye.
- **Decisión sobre `fecha_fin`:** **obligatoria** en el aviso. El alta del administrador responde 400 sin ella (antes creaba una fila muerta sin avisar a nadie); el residente sigue pudiendo guardar a alguien sin fecha
  (libreta). Ambas altas validan `AAAA-MM-DD` (incluidas fechas imposibles; una de ellas tumbaba con 500 en mi primera versión y la prueba lo cazó) y `fin ≥ inicio`.
- **Sin duplicados:** un aviso idéntico (mismo DPI y placa normalizada, mismas fechas) → **409** con el id del existente. Dos pasajeros distintos en el mismo carro no se pisan. Un visitante guardado no se repite
  aunque se guarde otro día. Antes, «Preautorizar hoy» creaba una fila nueva en cada clic y el residente nunca veía el resultado.
- **Un solo flujo «Avisar de una visita»** (`components/AvisarVisitaModal.tsx`) para el administrador (elige la casa) y para el residente: las dos fechas empiezan en hoy, «Hasta» sigue a «Desde» hasta que se toca,
  DPI o placa (basta uno). Desde un visitante guardado abre el formulario con sus datos (ya no crea nada a ciegas).
- **Lista del administrador** («Visitas avisadas»): columna de **placa**, fechas como rango, estado *Hoy / Próxima / Vencida*; los guardados y las vencidas no estorban (las vencidas se piden aparte).
  **Portal del residente:** «Visitas avisadas» y «Visitantes guardados» son listas distintas.
- **Glosario:** preautorización → **aviso de visita**; la prueba del glosario vigila «preautoriz*» y «admin» abreviado en ES y EN; reglas del aviso en `docs/glosario.md`. En el escritorio la garita dice
  «Visita avisada por el residente hasta el 12 oct 2026».

**Observaciones:** (1) el padrón de la garita ya no baja los visitantes guardados (cambio de comportamiento deliberado y sin efecto visible: el escritorio nunca los usaba);
(2) las búsquedas `fecha_fin >= CURRENT_DATE` comparan con la fecha de Postgres (UTC), no la de Guatemala: entre las 6 pm y la medianoche locales un aviso que vence «hoy» ya no se reconoce — es el defecto raíz S-17
(SCRUM-124); (3) siguen en pie los `window.confirm` de eliminar (SCRUM-115).

**Pruebas:** backend integración **I-8** (5) e **I-9** (10), unitarias +1; frontend +24 (alta de empresa/sucursal, invitar, bienvenida, contraseña, navegación por rol, primeros pasos, aviso de visita, lista del administrador, pestaña del residente);
desktop +2. **Suites tras el ticket:** backend 638 unitarias + 115 integración/regresión + `tsc`; frontend 325 + build; desktop 102 + Rust 74 + build. Todo verde.


---

## SCRUM-115 — H11 + H12 · Reportes, anuncios y consistencia visual · **HECHO**

**Commits:** `cfe5774` (diálogos nativos y acciones destructivas · Jira SCRUM-151) · `467f5bb` (reportes, «entradas», Lecturas y anuncios del residente · SCRUM-152) · `1e46a19` (pulido visual · SCRUM-153).
**Criterios de aceptación del ticket (leídos en Jira, solo lectura):** 3–4 cifras arriba en reportes, «entradas» por «ingresos», explicar LECTURAS; página de anuncios del residente; sustituir los diálogos nativos y separar las acciones
destructivas; paleta uniforme, textos cortados, concordancia y botones duplicados; «Tipo» como lista y logo como archivo. **Verificado contra el código:** 19 sitios con `window.confirm`/`prompt` (el QA decía 20), «Logo URL» en pie, «1 sucursales»
en `ae.managementCounts`, «+ + Nueva sucursal» en `EmpresaDetail` (icono y texto), `Editar` y `Eliminar` como botones hermanos en Anuncios, «Remover ban» ya estaba renombrado y no era verde.

**SCRUM-151 — diálogos y acciones destructivas**
- `ConfirmDialog` + `useConfirmacion()` en el kit de UI (sincronizado al escritorio): `if (!(await confirmar({ title, message, confirmLabel, tone })))`. El botón nombra la acción y lo destructivo va en rojo. Cada texto dice lo que **de verdad**
  pasa (se leyó cada endpoint: baja suave de sucursal/área/cargo, borrado del residente solo si no tiene historial, la baja de empresa apaga sucursales, personal, equipos de garita y sesiones…).
- 17 confirmaciones y 2 `prompt` migrados: el motivo del rechazo de una reserva es un `Modal` con campo opcional; si el portapapeles falla, el código de activación queda en un aviso persistente (no en un `prompt`).
- **Separación visual:** `RowActions` ya no muestra una acción destructiva en línea junto a otras (va al menú, tras una línea); `Anuncios` pasa de dos botones hermanos a `RowActions`. Prueba `sinDialogosNativos` (parser de TypeScript).
- Se corrigieron frases partidas («¿Eliminar esta sucursal? "Torre"?») y el «Preautorizar»/«Admin» de los diálogos.

**SCRUM-152 — reportes y anuncios**
- Reportes: arriba **cuatro** cifras (la que manda con su gráfico + tres filas); «solicitudes resueltas» pasó a Comunidad. Un periodo de **un solo día** ya no dibuja un gráfico vacío (área de un punto) sino una columna con la raya del periodo anterior.
- «ingreso(s)» → «entrada(s)» / «cobrado» en reportes, lista negra y garita; «Registro de accesos» → «Reporte de entradas» (como dice el glosario). La prueba del glosario lo vigila.
- Anuncios (administrador): **Lecturas** dice qué cuenta («3 de 45», residentes que lo abrieron) y un cero explica por qué (nadie lo ha abierto / aún no vigente / ya venció). `GET /api/anuncios` devuelve `total_residentes`.
- **Anuncios del residente:** página propia (`MisAnunciosPage`) con comunicados de la comunidad separados de los avisos dirigidos a la persona (el endpoint ya traía `es_personal`), texto entero, marcar leído uno/todos, filtro «sin leer»; la campana rotula lo personal, enlaza
  a la página y se mantiene sincronizada con ella (evento de ventana que cada lado ignora cuando es suyo).
- Observación: la barra inferior móvil del residente queda en cinco columnas («no dan para más»); los anuncios se alcanzan por la campana y por el menú.

**SCRUM-153 — pulido visual**
- **Logo como archivo:** se elige una imagen (PNG/JPG/WebP), el navegador la reescala a 256 px (conserva transparencia en PNG), hay vista previa y «Quitar logo». **Decisión:** el proyecto no tiene almacenamiento de archivos (ni S3 ni multer) y ya guarda base64 en columnas TEXT
  (comprobantes, fotos de áreas), así que el logo se guarda como *data URI* en `empresas.logo_url`. La columna pasa de `VARCHAR(500)` a `TEXT` con una migración idempotente (solo la primera vez) y un `CHECK` de tamaño; **se probó el salto contra el esquema viejo en el Postgres desechable**
  (antes `character varying(500)`, después `text`, segunda corrida sin errores). El servidor acepta URL http(s) (las que ya existían) o imagen ≤ 200 KB, **sin SVG**; `PUT` puede quitar el logo; el margen de cuerpo es 400 KB solo para `/api/empresas`. Prueba **I-10**.
- «Tipo» de sucursal es una lista; un tipo antiguo escrito a mano se conserva como opción (no se pierde al editar).
- **Concordancia:** `plural()` con claves `.one`/`.other` («1 equipo activo», «1 sigue abierta», «Cargo aplicado a 1 residente»); los conteos de listas pasan a «Etiqueta: n». Pruebas que impiden claves sin pareja y que listan los casos sospechosos.
- **Paleta:** ~290 clases heredadas (`red-`, `emerald-`, `amber-`, `blue-`…) pasan a los nombres de token; Tailwind ya las aliaba, así que **no hay cambio visual**. Prueba `sinPaletaSuelta`.
- **Textos cortados:** todo texto truncado lleva su valor completo en un tooltip; la verificación de pagos dejó de pegar «...» a nombres de dos palabras.
- **Botones duplicados:** con la lista vacía, el botón de crear vive en el estado vacío y no se repite en la cabecera (8 pantallas); se quitan los «+» dobles.
- Detalle de empresa (owner): asignar administrador se elige de una lista de personas, ya no se pega un UUID; el rol de la barra superior se escribe completo.

**Pruebas:** frontend +64 (confirmaciones, RowActions, ConfirmDialog, anuncios, reportes, gráfico de un punto, logo, tipo, plural, paleta, diálogos nativos); backend integración **I-10** (6). **Suites tras el ticket:** backend 638 unitarias + 121 integración/regresión + `tsc`;
frontend 385 + build; desktop 102 + Rust 74 + build. Todo verde.


---

## SCRUM-129 — Deuda técnica de seguridad (S-11, S-13, S-14, S-15) · **HECHO**

**Commits:** `95a50eb` (S-11) · `6803dbc` (S-14) · `691bcf3` (S-13) · `4939452` (documentos). Criterios leídos en Jira (solo lectura); cifras de `npm audit`/`cargo audit` tomadas hoy, tal cual.

**S-11 — `/auth/refresh` responde 423 con el motivo (backend, web y escritorio)**
- **Verificado contra el código:** el backend *sí* tenía la rama 423 (`bloqueoDeUsuario` en `refresh`), pero en el flujo real nunca se alcanzaba: suspender una empresa **revoca** los refresh tokens de sus usuarios y la consulta
  descartaba los revocados (`rt.revoked = FALSE`), así que el cliente recibía un 401 mudo. La prueba de regresión R-3 incluso documentaba «refresh 401». Los tests unitarios con base simulada pasaban porque el token seguía vigente.
- **Backend:** el token se busca sin filtrar por `revoked`; con la empresa suspendida o dada de baja → **423 + motivo** (se limpia la cookie y, si hacía falta, se revoca); token vencido o usuario dado de baja → 401 sin consultar ni revelar la empresa;
  token revocado con la empresa en regla → 401. R-3 pasa a esperar 423 (y, tras reactivar, la cookie vieja → 401). 4 pruebas unitarias nuevas y la de «usuario desactivado» adaptada al mecanismo nuevo.
- **Web:** `refreshToken` ya guardaba el aviso en 423 y la pantalla de acceso lo mostraba, pero nada lo probaba; ahora una prueba cubre petición 401 → refresh 423 → sesión cerrada → aviso con el motivo (una sola lectura).
- **Escritorio (Rust + React):** el 423 marca la sesión «requiere login», guarda el texto del servidor (`Sesion.bloqueo`, con `#[serde(default)]`: las sesiones guardadas por versiones anteriores se siguen leyendo) y la pantalla de acceso lo muestra
  («… suspendidas: Falta de pago. La garita puede seguir registrando entradas en este equipo»). Clasificador `clasificar_refresh` con pruebas en Rust; prueba de la pantalla en vitest. El login con 423 ahora lleva el código `empresa_suspendida`.

**S-14 — node-cron 4.x:** 3.0.3 → **4.6.0**. `npm audit --omit=dev` del backend: de `2 moderate` a **`found 0 vulnerabilities`**. Se quitó `@types/node-cron` (la 4.x trae sus tipos). Las tres tareas diarias se movieron a `src/jobs/programacion.ts` y una prueba comprueba que cada expresión
es válida en la versión instalada, que las de zona disparan a la hora de Guatemala aunque el contenedor esté en UTC y que una corrida fallida se registra sin tumbar nada. Node 20 (Docker y CI) cumple el mínimo de la 4.x.

**S-13 — vitest:** 4.1.10 → **4.1.11** en frontend y escritorio (cierra `GHSA-82fw-gwwq-j7x9`, `@vitest/mocker`). **Decisión:** no se sube a la 5.x (la última): exige Node ≥ 22.12 y el CI y los Dockerfile usan Node 20, así que obligaría a cambiar de runtime. El aviso del ticket
(«subir de versión mayor») ya no hacía falta: la corrección salió en el mismo major. Quedan 8 avisos de **desarrollo** (`tailwindcss` 3 y su cadena) que solo cierra Tailwind 4 → documentado.

**S-15 — `cargo audit` (cargo-audit 0.22.2, 528 crates, 1 296 avisos):** **0 vulnerabilidades**, 7 avisos tras corregir uno (6 sin mantenimiento —`proc-macro-error`, cinco `unic-*`— y 1 de solidez, `glib` 0.18.5): todos transitivos de Tauri/GTK. `cargo update -p yoke-derive` (0.8.3 yanked → 0.8.4)
cierra el octavo. **Revisión de Tauri:** `cargo update --dry-run` lo subiría a 2.12.2 (`wry` 0.57, `tao` 0.37, 86 paquetes) y eliminaría los cinco `unic-*`, pero cambia la capa WebView2 de Windows y no hay equipo Windows para probar el instalador → **no aplicado**, queda
para la validación en Windows (SCRUM-157; ver «Pendientes para humanos»).

**Cifras `npm audit` después del ticket:** backend `38 vulnerabilities (6 moderate, 32 high)` / producción `found 0`; frontend `8 (2 moderate, 6 high)` / producción `found 0`; desktop `8 (2 moderate, 6 high)` / producción `found 0` (antes, completo: 40 / 11 / 8; producción backend 2).
`backend/DEUDA_TECNICA.md` y `backend/securitytest/RESULTADOS.md` (sección l-ter) actualizados con estas salidas.

**Pruebas:** backend unitarias +8 (646), integración sin cambios en cantidad (121; R-3 actualizada); frontend +4 (389); desktop vitest +3 (105), Rust +3 (77). **Todo verde** (backend, `tsc`, frontend + build, desktop + build, Rust).


---

## SCRUM-125 — RNF-10 · Auditoría completa de acciones sensibles y límites de tasa · **HECHO**

**Commits:** `c8e8f27` (lista de acciones y cobertura · Jira SCRUM-179) · `4a5addf` (límites con rastro y límites nuevos · SCRUM-180) · `d54c96e` (panel de auditoría y decisión S-10).
**Criterios de aceptación (Jira, solo lectura):** lista de acciones sensibles y prueba de que cada una guarda usuario, fecha e IP (meta 100 %); los intentos bloqueados por límite de tasa también auditados; decisión documentada sobre S-10;
el panel de auditoría muestra las acciones nuevas y se puede filtrar por ellas. **Verificado contra el código** (el QA no tenía el texto de RNF-10, así que se tomó la definición de los criterios): de 76 rutas que modifican algo, 59 se auditaban; faltaban 17.
La `auditLog` de cada ruta iba **después** de los guards de rol y de los limitadores, así que un rechazo por rol o por límite nunca llegaba a la bitácora (se había arreglado a mano solo para el borrado definitivo, S-07).

**Lista y cobertura (SCRUM-179)**
- `docs/acciones_sensibles.md`: las **75 acciones** auditadas (qué son, ruta, quién, límite de tasa) y las **4 exenciones** con su porqué (`refresh` bueno, preferencias propias, acuse de lectura, latido del equipo).
- **Huecos cerrados:** `LOGOUT`, `REFRESH_RECHAZADO` (solo los rechazos: token desconocido, vencido, revocado, usuario dado de baja, empresa suspendida), `PAGO_TRANSFERENCIA_ENVIADA`, borrado de avisos del residente, `OCR_DPI`/`OCR_PLACA`, `ANUNCIO_EDITADO`,
  `TICKET_CREADO`/`CERRADO`/`MENSAJE_ENVIADO` (el texto del chat **no** se guarda en la bitácora), `LICENCIA_ACTIVADA`, las tres tareas manuales del owner y la descarga de CSV con datos personales (`REPORTE_*_EXPORTADO`).
- **`ACCESO_DENEGADO`:** un 403 de un guard de rol (alguien con sesión probando rutas de administración) deja huella en el propio guard, con guard, método, ruta y rol. Los 401 sin sesión no (ruido anónimo).
- **Rutas sin sesión atribuyen a la persona** cuando se sabe quién es: login correcto, logout y aceptar una invitación (vía `res.locals.auditoriaUsuarioId`) y a la sucursal al activar un equipo; con contraseña errada solo queda el correo intentado.
- **Pruebas:** `auditoria.cobertura.test.ts` recorre el router REAL (el middleware lleva una marca) y falla si una ruta que modifica algo no se audita ni está exenta, o si la lista documentada y el código dejan de coincidir;
  `auditoria.int.test.ts` (I-11) ejecuta **cada una de las 75 acciones** contra Postgres con el rol correcto y exige fila con usuario (cuando hay sesión), fecha (medida en la base, no en JS: ver S-17) e IP, con el `status_code` real
  y 2xx en las que deben salir bien; la última prueba comprueba que la tabla cubre todas las acciones del código. **Cobertura: 100 %.**

**Límites de tasa (SCRUM-180)**
- **`crearLimitador()`** (fábrica común): cada 429 deja una fila con la acción que se intentaba, la persona (si hay sesión), la IP y el límite en `datos_nuevos`. Migrados: login (por IP y por cuenta, con el correo intentado y sin la contraseña),
  refresh/logout, invitaciones públicas, activar equipos, heartbeat, borrado definitivo, OCR y el general por IP. El borrado definitivo conserva su comportamiento (S-07).
- **El general por IP audita UNA fila por IP y minuto** (con la cuenta de lo callado): es anónimo, y una inundación de bloqueos no debe ser una inundación de escrituras en la base. Los de ruta auditan cada bloqueo (ya están acotados por el general).
- **Límites nuevos por persona** (no por IP; un tercero tras el mismo NAT no agota el cupo ajeno): crear solicitudes 10/15 min, chat 40/min, pago con tarjeta 10/15 min (vector de «card testing»), comprobantes de transferencia 10/15 min;
  el OCR pasa de por IP a por usuario. Pruebas **I-12** y **I-13**.
- **Decisión S-10 (bloqueo de login por cuenta): se mantiene**, con alternativas descartadas y compensaciones documentadas en `backend/DEUDA_TECNICA.md` (bloqueos auditados y filtrables, solo cuenta fallos, no corta sesiones abiertas, 2FA para administradores).

**Panel de auditoría**
- La lista de acciones del filtro salía de un arreglo escrito a mano con 11 de ~75; ahora la sirve `GET /api/audit-logs/acciones` (las que existen, con su cantidad), agrupada por tema y con nombre legible en español e inglés.
  Filtros nuevos: **resultado** (correctas / rechazadas / bloqueadas por límite / con error) y **persona o correo intentado** (en el servidor; antes filtraba solo la página cargada). El detalle muestra el límite que frenó un intento, la ruta de un acceso denegado
  y cuántos bloqueos calló el límite general. Fechas con `utils/fecha`. Una prueba exige que cada acción documentada tenga nombre en ambos idiomas y grupo. Prueba **I-14**.

**Observaciones:** (1) `registrarAuditoria` ahora nunca lanza, ni con un pool que falle de forma síncrona; (2) se corrigió que varias pruebas unitarias no simulaban `res.locals`/`req.headers`, que Express siempre trae;
(3) las lecturas de alto volumen (listados, el padrón de la garita) siguen sin auditarse a propósito, como documenta la lista; (4) cuando se haga SCRUM-123, sus eventos de 2FA entran en la lista y en `auditoria.int.test.ts` (la prueba final lo obliga).

**Pruebas:** backend unitarias +9 (655), integración **I-11 a I-14** (+100: 216 en total); frontend +16 (403). **Suites tras el ticket:** backend 655 unitarias + 216 integración/regresión + `tsc`; frontend 403 + build; desktop 105 + Rust 77 + build. Todo verde.


---

## SCRUM-123 — Verificación en dos pasos (TOTP) para administradores · **HECHO**

**Commits:** `37a512f` (backend) · `a146c85` (web) · `630d7c4` (escritorio). **Criterios de aceptación (Jira, solo lectura):** activar escaneando un QR con una app de autenticación y confirmando un código; el login de los administradores pide el segundo factor cuando está activo
(el equipo decide y documenta si es obligatorio); códigos de recuperación de un solo uso guardados con hash; intentos limitados por usuario y cada evento en `audit_logs`; pruebas de integración. Diseño, operación y límites en **`docs/verificacion_dos_pasos.md`**.

**Cómo queda**
- **Quién:** owner, administrador de empresa y de sucursal (rutas `/api/auth/2fa/*` con `requireAdminSucursal`; el personal de garita y los residentes reciben 403 auditado). **Opcional por persona.**
- **Activar:** *Mi cuenta* (menú nuevo para los tres roles) → QR + clave en texto → primer código **y contraseña** → quedan activos y se muestran **una sola vez** 10 códigos de recuperación (copiar, descargar `.txt`, y no se puede cerrar sin confirmar que se guardaron).
- **Entrar:** la contraseña correcta responde `200 { requiere_2fa, desafio }` **sin sesión**; la pantalla de acceso pide el código (o uno de recuperación) y `POST /api/auth/2fa/verificar` canjea el desafío (JWT de 5 min con `typ: '2fa'`, que `verifyToken` rechaza como sesión) por la sesión completa.
  Se vuelve a comprobar que la cuenta y la empresa siguen vigentes (423/401) y se exige aunque la persona cambie de rol después.
- **Desactivar** pide contraseña **y** código; **regenerar códigos** pide un código de la app y anula los anteriores.
- **Perdió el teléfono y los códigos:** su superior se la restablece desde *Personal* (acción nueva en el menú de la fila, con confirmación; borra el segundo factor y cierra sus sesiones; mismo alcance que la baja → `DELETE /api/usuarios/:id/2fa`). El **owner** no tiene superior en la
  aplicación: `npm run cuenta:restablecer-2fa` en el servidor (deja la misma fila de auditoría con `via: consola`).

**Decisiones (todas tomadas sin consultar, como pedía la noche)**
1. **TOTP propio sobre `crypto`, sin librería.** Se instaló `otplib` 13.5 (mantenida, 0 vulnerabilidades) y se comprobó que **no carga en Jest**: depende de `@scure/base`, un paquete solo-ESM que Node 20.20 deja `require`ar pero Jest no, y no quise
  depender de ese comportamiento en la imagen Docker ni tocar la configuración de transformación de pruebas. El RFC 6238 cabe en ~40 líneas: se probó con **los vectores oficiales** del RFC 4226 (apéndice D) y RFC 6238 (apéndice B) y contra `otplib` con **900 comparaciones aleatorias sin una diferencia**
  (códigos y verificación, en los dos sentidos), y luego se quitó la dependencia (`package-lock.json` de vuelta a su estado, `npm audit --omit=dev`: `found 0 vulnerabilities`). Menos superficie de cadena de suministro y ninguna dependencia nueva.
2. **Opcional, no obligatoria.** Obligarla exige una *sesión restringida* («solo para configurar el segundo factor») que cambia cómo se emiten y validan las sesiones en toda la API, y activarla de golpe a quien ya trabaja dejaría gente fuera el primer día. Siguiente paso recomendado: `TWOFA_OBLIGATORIO` + esa sesión + plazo de gracia.
3. **Secreto cifrado en reposo** (AES-256-GCM con el usuario como dato autenticado) con la llave de `TWOFA_KEY` si existe y, si no, derivada de `JWT_SECRET` (HKDF): **no exige variable nueva**. Para rotar `JWT_SECRET` sin perder los secretos se fija antes `TWOFA_KEY` con el valor actual (misma llave derivada). `TWOFA_KEY` se agregó, vacía, a los dos
  `docker-compose` y a los `.env.example`, y el arranque la valida (≥ 32 caracteres). *(Los compose de la VM tienen cambios locales: ver «Pendientes para humanos».)*
4. **Códigos de recuperación como HMAC-SHA256 con llave del servidor** (son de 50 bits: un hash sin llave se adivinaría fuera de línea con la base filtrada) y consumo atómico (`UPDATE … WHERE usado_en IS NULL`).
5. **Intentos limitados por PERSONA en la base** (5 fallos en 15 min → 15 min bloqueada, con `Retry-After`), con la misma cuenta para ingreso, confirmar, desactivar y regenerar, más límites de tasa por IP y por usuario (`crearLimitador`, bloqueos auditados). Un código TOTP vale una sola vez (`ultimo_paso`, reclamado de forma atómica: dos
   peticiones simultáneas con el mismo código no entran las dos; hay una prueba). Una contraseña errada al desactivar no gasta intentos del segundo factor. Solo alcanza a quien ya conoce la contraseña, así que no sirve para bloquear cuentas ajenas a ciegas (compensación de S-10).
6. **Las rutas con sesión responden 400, nunca 401**, ante un código o contraseña errados: el cliente trata todo 401 como «sesión vencida», refresca y manda a la pantalla de acceso.
7. **Tablas nuevas con `TIMESTAMPTZ`** (`usuario_2fa`, `usuario_2fa_recuperacion`): lo correcto desde el inicio, sin heredar la deuda S-17 del resto del esquema.
8. **Escritorio:** la app de la garita no tiene segundo paso (los agentes no la usan). Si un administrador con la verificación activa entra allí, ve «Tu cuenta tiene la verificación en dos pasos, que esta app no admite. Inicia sesión desde la versión web» en vez de un error de formato.

**Revisión final del ticket (después de abrir el PR).** Al repasar el diseño con ojos frescos aparecieron dos huecos y se cerraron en un commit aparte:
- **Activar pide la contraseña** (igual que desactivar). Sin ella, quien solo tuviera una sesión robada podía activar la verificación con **su** teléfono y dejar fuera al titular (re-autenticación ante cambios de seguridad de la cuenta). Una contraseña errada o ausente no gasta intentos del segundo factor ni llega a la bitácora; 2 pruebas de integración y 2 de pantalla.
- **Degradar a un administrador a agente le quita la verificación** (desde *Personal*): la app de escritorio no tiene segundo paso y la web no admite agentes, así que quien conservaba el segundo factor activo quedaba atrapado sin poder entrar a ningún lado hasta que alguien se lo restableciera. Queda en la bitácora (`dos_pasos_quitada`). Bajar de rol por SQL **no** lo quita (el ingreso lo sigue exigiendo). De paso se probó que **eliminar definitivamente una empresa** con un administrador que tiene la verificación activa no se atora (las filas caen en cascada).

**Auditoría (RNF-10):** 6 acciones nuevas —`TWOFA_INICIADO`, `TWOFA_ACTIVADO`, `TWOFA_DESACTIVADO`, `TWOFA_CODIGOS_REGENERADOS`, `TWOFA_VERIFICACION`, `TWOFA_RESTABLECIDO`— en `docs/acciones_sensibles.md`, con nombre en español e inglés y detalle legible en el panel del owner
(«Contraseña correcta; falta el código de dos pasos», «Entró con un código de recuperación», «Motivo: persona bloqueada por demasiados intentos»; de paso, el panel ya explica también los motivos de `REFRESH_RECHAZADO`). Cada una tiene su caso en la prueba I-11 (la prueba final lo exige) y **ningún secreto, código ni contraseña** llega a la bitácora (hay una prueba que lo busca).

**Pruebas:** backend unitarias **+37** (`twofa.test.ts`: vectores del RFC, tolerancia de reloj, anti-reutilización, cifrado, códigos, desafío; `validarTwofaKey`) → 692; integración **+50** → 266 (**I-15**: 42 casos —activar, ingreso, códigos de recuperación, bloqueo por persona, desactivar, roles, restablecer, secretos fuera de la bitácora—; **I-16**: 2 casos de límites de tasa; 6 casos nuevos en I-11);
frontend **+33** → 436 (segundo paso del acceso, Mi cuenta, restablecer desde Personal, panel de auditoría, navegación por rol); escritorio vitest +1 (106), Rust +1 (78). **Todo verde** (backend, `tsc`, frontend + build, desktop + build, Rust). `npm run lint` del frontend: 6 avisos que ya estaban cuando empezó este ticket y ninguno en archivos de este ticket (4 eran de tickets anteriores de la rama y se corrigieron al final; ver «Pendientes para humanos»).

**Pendiente / límites conocidos:** (1) no es obligatoria; (2) sin aviso por correo al activar/desactivar/restablecer (la bitácora sí lo registra); (3) solo TOTP (llaves físicas/passkeys serían un segundo método); (4) el reloj del servidor debe estar sincronizado (NTP); (5) rotar `JWT_SECRET` exige fijar antes `TWOFA_KEY` (S-12).


---

## SCRUM-117 — Validación en Windows y deuda técnica mínima · **PARCIAL**

**Commits:** `1369be8` (CI · subtarea Jira SCRUM-158). **Criterios de aceptación (Jira, solo lectura) y estado:**

| Criterio | Estado |
|---|---|
| La app de escritorio se instala y corre en Windows 10/11 con 6–8 GB de RAM, webcam USB y OCR de placas (SCRUM-157) | **PENDIENTE DE HUMANOS** — no hay equipo Windows en esta sesión; ver «Pendientes para humanos» |
| Se mide y registra el tiempo del OCR de placa y la RAM en ese equipo | **PENDIENTE DE HUMANOS** (depende del anterior) |
| `npm audit --omit=dev` del backend revisado y corregido | **HECHO** — hoy: backend, frontend y escritorio `found 0 vulnerabilities` en producción. El hallazgo del QA (3 en backend, 1 crítica en `proxy-addr`) ya estaba cerrado por `npm audit fix` en SCRUM-118 y por `node-cron` 4.x en SCRUM-129. Con las de desarrollo: backend 38 · frontend 8 · escritorio 8 (herramientas de pruebas de carga y Tailwind 3; ver SCRUM-129) |
| El CI fija `ubuntu-24.04` y suma un job con las pruebas unitarias (SCRUM-158) | **HECHO** |

**CI (`.github/workflows/ci-integracion.yml`)**
- **`ubuntu-24.04` fijo** en todos los jobs (`ubuntu-latest` es un alias que GitHub mueve de versión; el propio aviso de la Tarea 5 decía que pasaba a Ubuntu 26 el 19-oct-2026).
- **`unitarias`** (matriz backend / frontend / desktop): `npm ci` → `npm test` → compilación de tipos (`tsc --noEmit` / `npm run build`). Un fallo en un paquete no oculta los otros (`fail-fast: false`).
  El backend corre con `TZ=America/Guatemala` (producción); frontend y escritorio, en **UTC** (la del runner) a propósito: las pantallas no pueden depender de la zona del navegador.
- **`desktop-rust`**: `cargo test --lib --locked` de la parte nativa del escritorio (78 pruebas). Tauri compila contra GTK/WebKit en Linux (paquetes de Tauri 2 para Ubuntu 24.04) y exige archivos que no se versionan (`dist/`, el runtime de Node del sidecar y sus recursos): el job los crea vacíos porque `cargo test` no los ejecuta.
  **Solo corre en pull requests, a mano y en `main`:** compilar Tauri tarda (≈ 8 min con 8 núcleos) y este workflow ya se dispara por `push` *y* por `pull_request`, así que sin la condición cada PR lo pagaría dos veces.
- **Cómo se validó sin poder correrlo en GitHub:** `actionlint` (sin errores) y **cada job réplicado en un contenedor Linux** con los mismos comandos: frontend (Node 20 amd64) 436 pruebas + build; escritorio web (amd64, UTC) 106 + build; backend (amd64, TZ Guatemala) 692 + `tsc`;
  Rust (Ubuntu 24.04, Rust 1.99 estable) 78 pruebas. Los `package-lock.json` instalan sin problema en Linux.

**Hallazgo que destapó el CI:** una prueba del frontend (`ReservasPage`, «horarios ocupados con el buffer») alimentaba un instante **sin zona** (`'2026-12-10T13:30:00'`) y solo pasaba si el proceso corría en `America/Guatemala` (en UTC mostraba 07:30). El servidor manda instantes con `Z`; la prueba ahora hace lo mismo
y el frontend completo pasa en UTC, Guatemala y Tokio. No era un defecto de la pantalla (en producción siempre llega con zona), sino de la prueba.

**Verificado en GitHub (PR #1, 10/10/2026):** el workflow corrió completo y sus 5 jobs terminaron en verde en la primera ejecución —integración y regresión 1 min 56 s · unitarias backend 1 min 12 s · frontend 1 min 27 s · escritorio (web) 54 s · **Rust 7 min 9 s** sin caché (se había estimado 20–25 min; el máximo del job queda en 40)—. Antes, los `push` a la rama ya habían corrido los jobs de Node en verde (el de Rust se omite en `push` fuera de `main`, como se diseñó).

**Pendiente:** validar el instalador en Windows (SCRUM-157).


---

## SCRUM-126 — Espejo local de invitaciones QR (modo offline) · **HECHO**

**Commits:** `362022c` (backend · SCRUM-181/183) · `21d2ea0` (escritorio · SCRUM-181/182). **Criterios de aceptación (Jira, solo lectura) y cómo se cumplen** (diseño y tabla de escenarios en **`docs/qr_sin_conexion.md`**):

| Criterio | Cómo |
|---|---|
| Snapshot de las invitaciones vigentes en la base local, actualizado en cada sincronización | `GET /api/sync/garita` trae `invitaciones_qr`; el escritorio las guarda en `invitaciones_qr_local` (SQLite cifrado) y **reemplaza la copia completa en cada sincronización** (al arrancar, cada 5 min y a mano) |
| Sin internet, un QR válido se acepta; uno vencido, revocado o agotado se rechaza | `validar_qr_local`: las mismas reglas y el mismo orden que `verificarInvitacion` del backend (revocada → bloqueada → aún no vigente → vencida → agotada) con los mensajes del servidor; la fecha es la del día local |
| El uso viaja en la cola con `invitacion_qr_id` y se descuenta en el servidor sin duplicados | Columna nueva `accesos_pendientes.invitacion_qr_id` (con migración que rellena las filas anteriores) y el mismo id en el `payload`; `POST /api/accesos` ya descontaba con la fila bloqueada y era idempotente por `id_cliente`: ahora **lo prueba I-17** (reenvío ×3, carrera entre dos reintentos, un solo uso, 3 de 3) |
| Documentado qué pasa si un QR se revoca mientras la garita está sin red | `docs/qr_sin_conexion.md`: se acepta con la copia vieja; al subir el servidor responde 409 y la fila queda **`rechazado`** con el motivo, sin descontar ni registrar; tabla con los demás escenarios (agotada en otra garita, bloqueada, vencida, invitación nueva…) |

**Verificado contra el código (el QA estaba en lo cierto):** no había tabla de invitaciones en el SQLite, y la interfaz **apagaba** el escáner y el código manual sin red (`CameraPane`, `requiere: 'red'`). Cambié eso además de agregar la validación, o la copia no habría servido para nada.

**Decisiones**
1. **El servidor manda cuando responde.** La copia solo se usa si no hay red o el servidor contesta 5xx; un 404/409 del servidor se respeta (una copia puede estar vieja). `garita_verificar_qr` ya no cae en error: cae a la copia.
2. **Qué lleva la copia:** las de la sucursal **de la licencia** (no la del agente) que aún pueden servir por fecha con **un día de margen** (el servidor compara `CURRENT_DATE` en UTC, que cambia a las 18:00 de Guatemala; la garita decide con su fecha local) y, de las revocadas, **solo las del último mes** (así puede decir «revocada» en vez de «no encontrada»
   sin que el espejo crezca para siempre). Las fechas viajan como texto `AAAA-MM-DD` (`to_char`), no como instantes: no dependen de la zona del servidor.
3. **Los usos de este equipo cuentan aunque el servidor no los sepa:** copia + los pendientes + los subidos *después* de pedir la copia (`qr_snapshot_desde`, que se toma ANTES de pedirla: lo que se sincroniza durante la petición se cuenta de más, nunca de menos). Los rechazados no cuentan. Resultado: un QR de un solo uso no se acepta dos veces en el mismo equipo, ni con dos paneles a la vez
   (`encolar_acceso` lo vuelve a comprobar con el candado de la base; una invitación que la copia no conoce no se frena aquí: decide el servidor).
4. **Cambio de reglas en el servidor (necesario para que sea correcto):** las **fechas** de vigencia se miden al **día de `registrado_en`** (acotado a `NOW()`, en la zona de la app) y no al día en que se sincroniza. Sin esto, una entrada hecha sin red el último día de una invitación se **rechazaba** al subir al día siguiente, aunque era válida cuando ocurrió. Lo que no viaja en el tiempo
   es el **estado** (revocada, agotada, bloqueada): no hay `revoked_at` para saber *cuándo* ocurrió, así que se mide al sincronizar. Sin `registrado_en` (la web) todo sigue igual. Un reloj adelantado no gana vigencia (se acota a `NOW()`; hay prueba).
5. **Lo que se queda en el servidor:** coincidencia de DPI de las individuales (y su bloqueo tras fallos) y placa obligatoria (`requiere_placa`) se comprueban al sincronizar; la copia no lleva esa configuración.
6. **Una entrada que el servidor rechaza al sincronizar hoy no se registra** (igual que los rechazos por lista negra de la cola). Es la limitación más importante: la persona ya entró. Recomendación en el documento: registrarla igual con una marca «revisar» y listar los rechazos de la cola en el panel de administración.
7. `bloqueado_hasta` hereda el desfase de S-17 (columna `TIMESTAMP`).

**Pruebas:** backend integración **+16** (I-17) → 282; escritorio vitest **+3** → 109; Rust **+18** → 96 (cada motivo de rechazo y su orden, fronteras de fecha, id en mayúsculas/espacios, bloqueo temporal, suma de los usos locales, `encolar_acceso`, reemplazo de la copia, servidor anterior sin invitaciones, migración de una cola anterior).
Dos pruebas que **afirmaban que el QR exigía red** (`CameraPanelTabs`, `CameraPane.manual`) se reescribieron para afirmar lo contrario. **Todo verde** (backend 692 + 282 + `tsc`; frontend 436 + build; escritorio 109 + build; Rust 96).

**Pendiente:** probar el flujo sin red en un equipo real con cámara (la lógica está probada; el escáner con la cámara no se puede ejercitar aquí) y decidir la recomendación 6.


---

## SCRUM-124 — Reutilización del refresh token (S-06) y zona horaria de TIMESTAMP (S-17) · **HECHO**

**Commits:** `9cb8b19` (S-06 backend · SCRUM-176) · `2f8ea74` (S-06 web y escritorio) · `dc935b0` (S-17 · SCRUM-177) · `6249b1c` (R-2 y re-ejecución · SCRUM-178). S-17 va al final y en commits aparte, como se pidió: si no cabía, se revertía y se dejaba S-06 solo. **Cupo: cabía.**

| Criterio (Jira, solo lectura) | Estado |
|---|---|
| Reusar un refresh token rotado revoca la sesión (con la ventana de gracia definida) y queda auditado | **HECHO** (S-06) |
| Migración a TIMESTAMPTZ de las columnas afectadas, probada primero sobre una copia de la base | **HECHO** sobre una copia del **esquema** con datos sintéticos en el Postgres desechable (I-19). **Falta** probarla sobre una copia de la base de **producción** (no se toca Cloud SQL): procedimiento en `docs/s17_timestamptz.md` |
| `refresh_tokens` dura 7 días exactos y no 6 d 18 h | **HECHO** (I-20 lo mide en SQL y en Node) |
| R-1 a R-3 y las suites de seguridad siguen pasando (R-2 se re-ejecuta: cambia su causa raíz) | **HECHO** R-1, R-2 (reescrita) y R-3 verdes; la suite de seguridad **en vivo** (`npm run securitytest`) está actualizada pero **no se ejecutó**: reinicia el contenedor `securegate-backend` y siembra la base `securegate-db` del stack local de docker-compose, y eso es entorno de la persona, no el Postgres desechable. Pendiente humano |

### S-06 · detección de reutilización del refresh token

- **Diseño.** Cada inicio de sesión abre una *familia* (`refresh_tokens.familia_id`); renovar **rota** el token dentro de ella en una sola sentencia atómica (el viejo queda revocado con `rotado_en`, `revoked_at` y `reemplazado_por`; el nuevo hereda la familia). Un token **ya rotado** que se presenta otra vez **pasada la gracia**
  cierra la familia entera, corta los access tokens vigentes de la persona (cualquiera de las dos partes —dueño o ladrón— tiene que iniciar sesión de nuevo), responde `401 sesion_comprometida` y deja `REFRESH_REUTILIZADO` (persona, IP, cuántos tokens se cerraron).
- **Ventana de gracia: 10 s** (`REFRESH_GRACIA_SEGUNDOS`). Dos pestañas que renuevan a la vez leyeron la misma cookie antes de que la primera respuesta la reemplazara: eso no es robo y no debe cerrar la sesión. Dentro de la gracia cada petición recibe **su propio sucesor** en la misma familia; las dos peticiones simultáneas se resuelven en SQL (una reclama el token, la otra no devuelve fila y recibe el suyo). Hay prueba de la carrera real con dos peticiones en paralelo.
- **Qué NO es robo:** cierre de sesión, cambio de contraseña, baja del usuario o suspensión de la empresa revocan sin `rotado_en`: dan el 401 de siempre (`REFRESH_RECHAZADO`) y no cierran nada más. Un token de la familia que la detección ya cerró (lo trae el dueño legítimo) recibe `sesion_comprometida` **sin** otro evento de robo, para que se entere de por qué pierde la sesión.
- **Quien pierde la sesión lo sabe:** la web guarda el aviso (`sg_aviso_sesion`) y la pantalla de acceso lo muestra una vez; el escritorio muestra el texto del servidor (la garita sigue registrando entradas).
- **Auditoría:** acción nueva `REFRESH_REUTILIZADO` en `docs/acciones_sensibles.md`, con nombre en español e inglés en el panel y su caso en la prueba I-11 (la prueba final lo exige). Cada presentación del token viejo queda auditada (la segunda ya no tiene nada que cerrar).
- **Pruebas:** I-18 (9 casos: familia heredada, reutilización fuera de la gracia, otra sesión de la misma persona intacta, gracia, carrera simultánea, gracia acotada por entorno, cierre de sesión y cambio de contraseña no son robo), 8 unitarias, y la I-1 se adaptó (el token viejo da 401 *pasada la gracia*).
- **Revisión final.** (1) *Familia ya cerrada:* un token hermano rotado hace un instante (dentro de su gracia) podía emitir un sucesor en una familia que la detección de robo acababa de cerrar; ahora la guarda está en el propio `INSERT` (`WHERE NOT EXISTS … cierre_motivo = 'reutilizacion'`) y también cubre la carrera «la familia se cerró entre la lectura y la rotación». Se comprobó con una mutación que la prueba nueva **falla sin la guarda**.
  (2) *Riesgo asumido, documentado:* una respuesta de renovación que se pierde y se reintenta pasados 10 s cierra la sesión; en la garita con red inestable el equipo sigue registrando sin conexión pero no sincroniza hasta volver a iniciar sesión. Ajustable con `REFRESH_GRACIA_SEGUNDOS`; el análisis y la receta están en **`docs/refresh_tokens.md`**.
- `S-06` pasa a ✅ en `backend/DEUDA_TECNICA.md`.

### S-17 · todas las columnas TIMESTAMP → TIMESTAMPTZ

- **Qué estaba mal (medido):** la bitácora y las demás fechas llegaban **6 h adelantadas**, el refresh token duraba **6 d 18 h**, un bloqueo temporal de la lista negra terminaba 6 h antes, el bloqueo de un QR por DPI duraba ~6 h 15 min en vez de 15, y la API devolvía `expira_en` de las invitaciones por un rodeo (`expira_en_utc`, S-02).
- **Migración** (sección final de `database/init.sql`, idempotente, en cada arranque): convierte **toda** columna `timestamp without time zone` del esquema (51 hoy), no una lista a mano, para que ninguna se quede atrás. Los datos que ya existen **conservan su instante**: `AT TIME ZONE 'UTC'` porque así los leía el SQL al comparar contra `NOW()` (ninguna comparación en SQL cambia de resultado);
  solo `refresh_tokens.expires_at` y `visitante_blacklist.fecha_fin` se leen como Guatemala porque las escribió Node con un `Date` en hora local. Desde ahora un `Date` de Node viaja con su zona y se guarda bien sin ninguna conversión.
- **Defensas:** cada columna en su propio sub-bloque (una vista que dependa de ella, por ejemplo, la deja como estaba con un `WARNING` y **las demás migraciones del arranque no se pierden**: `init.sql` corre como una sola transacción y un error suelto las descartaría todas; hay prueba). **Bug encontrado y corregido de paso:** `init.sql` volvía a ensanchar `visitante_blacklist.fecha_inicio/fecha_fin` a `TIMESTAMP`
  **en cada arranque**, lo que habría deshecho la conversión (y corrido las fechas 6 h cada reinicio); ahora solo lo hace si siguen siendo `DATE`.
- **Código:** se quita el rodeo `expira_en_utc` de las invitaciones (con `TIMESTAMPTZ` el `AT TIME ZONE 'UTC'` del rodeo habría *roto* la hora) y el mes de un pago pendiente se mide en la zona de la app (`fecha_pago AT TIME ZONE …`). Nada más hizo falta: el resto del SQL se comporta igual porque la sesión de Postgres sigue en UTC.
- **Pruebas:** **I-19** (10 casos) arma el esquema **anterior** en un esquema aparte del Postgres desechable, le mete filas con horas de reloj conocidas y corre la migración como lo hará un despliegue sobre una base con datos (instantes, NULL, defaults, idempotencia, un arranque completo más, columna imposible de convertir). **I-20** (7 casos) hace acciones reales por HTTP y compara el instante que devuelve la API con el momento en que ocurrieron;
  **las 7 fallan con el esquema viejo** (se comprobó arrancando con un `init.sql` sin la sección S-17) **y pasan con el nuevo**. **R-2** se reescribió: su causa raíz cambió; la prueba nueva falla con el esquema viejo y pasa con el nuevo. R-1 y R-3 sin cambios, verdes.
- **Lo que NO cambia (queda documentado en `docs/s17_timestamptz.md`):** las consultas que agrupan por día u hora (`DATE(…)`, `EXTRACT(HOUR …)`, `TO_CHAR(…)`, `CURRENT_DATE`) siguen usando la zona de la sesión de Postgres, UTC: el tablero de entradas por hora, el mapa de calor y la hora del reporte CSV muestran horas UTC (ya era así y no lo introdujo este ticket).
  Con `TIMESTAMPTZ` el arreglo es de una línea por consulta, o de una vez fijando la zona de sesión del pool; se dejó fuera para no cambiar de golpe tableros y reportes. `S-17` pasa a ✅ en `DEUDA_TECNICA.md`.

**Suites tras el ticket:** backend **699** unitarias + **311** integración/regresión + `tsc`; frontend **439** + build; escritorio **109** + build + Rust **97**. Todo verde. *(La revisión final posterior suma 2 unitarias y 7 de integración en el backend y 2 en el frontend: ver «Resultado final».)* (Una corrida completa cayó en tiempos de espera de vitest de 5 s mientras otra aplicación de la máquina saturaba la CPU —carga 13—; con el tiempo de espera ampliado y la máquina más libre las mismas suites pasan completas.)


---

## Resultado final

Rama `sprint9-noche` (desde `main` actualizado), **65 commits**, 262 archivos (+20 693 / −2 912) respecto de `origin/main`. Nada se fusionó ni se empujó a `main`; un solo PR en borrador.

**Tickets:** HECHOS SCRUM-118, 108, 109, 110, 111, 112, 113, 114, 115, 129, 125, 123, 126 y 124 · PARCIAL SCRUM-117 (CI y revisión de `npm audit` hechos; la validación en Windows necesita un equipo) · BLOQUEADOS ninguno · OMITIDOS por instrucción: cámaras IP, teléfono como cámara, OCR de DPI local, auto-actualización, Visanet, pruebas de usabilidad, pruebas en Windows, landing y despliegue.

| Suite | Línea base | Al final |
|---|---:|---:|
| Backend `npm test` (unitarias) | 30 suites · 594 | 35 suites · **701** |
| Backend integración + regresión (`test:ci`, Postgres desechable) | 6 suites · 25 | 23 suites · **318** |
| Backend `tsc --noEmit` | limpio | limpio |
| Frontend `npm test` · build | 22 archivos · 165 | 57 archivos · **441** · build verde |
| Escritorio `npm test` · build | 11 archivos · 79 | 15 archivos · **109** · build verde |
| Escritorio Rust (`cargo test --lib`) | 65 | **97** |

**`npm audit`** (completo → solo producción `--omit=dev`): backend 40 → 38 · producción 2 → **0**; frontend 11 → 8 · producción **0**; escritorio 8 → 8 · producción **0**. Lo que queda son herramientas de desarrollo (pruebas de carga y la cadena de Tailwind 3); ver SCRUM-129.

**CI en GitHub:** el PR #1 corrió los 5 jobs del workflow (integración y regresión, unitarias de backend, frontend y escritorio, y Rust) y **todos pasaron** en la primera ejecución.

**Nota sobre las corridas:** durante la noche otra aplicación de la máquina (un juego) saturó la CPU (carga de 20 a 25) y varias corridas completas de vitest cayeron en sus tiempos de espera de 5 s sin ningún fallo real; frontend y escritorio se repitieron con menos procesos y tiempos ampliados y pasan completos. Las réplicas de los jobs del CI en contenedores Linux (sin esa carga) pasan con los valores por omisión, y la última corrida completa —ya con la máquina tranquila— también (frontend en 11 s).

---

## Pendientes para humanos

Lo que **no se pudo hacer** esta noche y por qué. Casi todo necesita un equipo, una cuenta o una decisión que una sesión autónoma no tiene. Ordenado por lo que conviene hacer primero.

### Antes de desplegar (riesgo si se omite)

1. **Probar la migración S-17 sobre una copia de la base de producción** (SCRUM-177). Se probó sobre una copia del *esquema* con datos sintéticos (I-19), no sobre datos reales: no se toca Cloud SQL. Procedimiento corto en `docs/s17_timestamptz.md`: restaurar un `pg_dump` en un Postgres local, arrancar el backend de esta rama contra él y comprobar que el log diga
   `Esquema al día.` sin ningún `S-17: no se pudo convertir`. Tomar un respaldo de producción antes de desplegar.
2. **Cambios locales de la VM en `docker-compose.yml` / `nginx.conf`:** esta rama agrega la línea `TWOFA_KEY` a los dos `docker-compose` (SCRUM-123) y quita el literal `DOMINIO` de nginx (SCRUM-118). Si la VM tiene esos archivos modificados a mano, un `git pull` va a chocar: revisar con `git status` y `git stash`/resolver **antes** de hacer pull ahí.
3. **Rotación de secretos (S-12):** sigue pendiente. Si se rota `JWT_SECRET`, **primero** hay que fijar `TWOFA_KEY` con el valor *actual* de `JWT_SECRET`; si no, los administradores con la verificación en dos pasos activa dejan de poder entrar hasta que alguien les restablezca el segundo factor.
4. **Correr la suite de seguridad en vivo** (`cd backend && npm run securitytest`): `securitytest/03-jwt.js` se actualizó para la gracia y la detección de reutilización del refresh token, pero **no se ejecutó**: esa suite reinicia el contenedor `securegate-backend` y siembra la base `securegate-db` del stack local de docker-compose, que es entorno de la persona. Después regenerar `RESULTADOS.md`.

### Necesitan un equipo o una persona

5. **Windows (SCRUM-157):** instalar y correr la app de escritorio en Windows 10/11 de 6–8 GB con webcam USB y OCR de placas; medir el tiempo del OCR de placa y la RAM; compilar el instalador (`nsis`/`msi`). Sin equipo Windows no se puede. De paso validar `tauri 2.12.2` (revisado en SCRUM-129, **no aplicado**: cambia la capa WebView2 y elimina los cinco avisos `unic-*`).
6. **Hardware real:** probar la garita **sin webcam** y con el permiso de cámara denegado (SCRUM-111), el **QR sin red** con cámara real (SCRUM-126: la lógica está probada, el escáner con la cámara no se puede ejercitar sin hardware) y mirar el **tema oscuro** del botón principal en un navegador real (SCRUM-108: se midió el contraste, pero no hubo navegador con extensión conectado).
7. **CI en `main` tras fusionar** (SCRUM-158): en el PR #1 los 5 jobs pasaron en GitHub (ver SCRUM-117); queda solo mirar la primera corrida sobre `main` (ahí `desktop-rust` también corre en cada `push`) y, si el repositorio exige comprobaciones para fusionar, agregar los nombres de los jobs nuevos.

### Decisiones de producto que quedaron abiertas

8. **Verificación en dos pasos obligatoria** (SCRUM-123): se dejó opcional por persona. Hacerla obligatoria necesita una sesión restringida «solo para configurar el segundo factor» y un plazo de gracia; también falta un aviso por correo al activar, desactivar o restablecer (cuando haya correo transaccional en producción).
9. **Entradas por QR que el servidor rechaza al sincronizar** (SCRUM-126): hoy no se registran (igual que los rechazos por lista negra). Recomendación documentada en `docs/qr_sin_conexion.md`: registrarlas igual con una marca «revisar» y listar los rechazos de la cola en el panel de administración.
10. **Salida sin red** (SCRUM-111): se dejó en línea a propósito (hace falta un espejo de accesos abiertos y un endpoint idempotente para cerrarla). Diseño y razones en la sección de ese ticket.
11. **Horas UTC en tableros y reportes** (consecuencia de S-17): las agregaciones por día/hora y la hora del CSV siguen en la zona de la sesión de Postgres (UTC), 6 h adelantadas respecto a Guatemala; ya era así. Con `TIMESTAMPTZ` se arregla en una línea por consulta o fijando la zona de sesión del pool (`docs/s17_timestamptz.md`).
12. **Normalización de placas ya guardadas** (SCRUM-110): hay un `UPDATE` único opcional descrito en la sección del ticket para dejar en su forma canónica las placas anteriores.

### Fuera de alcance por instrucción (necesitan personas o credenciales)

Cámaras IP, teléfono como cámara, OCR de DPI local, auto-actualización de la app, Visanet (pasarela de pago real), repetir las pruebas de usabilidad con personas, pruebas en Windows, landing y el despliegue real. Solo se escribieron los documentos y diseños de lo que sí cabía en `docs/`.

### Dos observaciones del repositorio

- Hay un `git stash` **antiguo y ajeno** en este repositorio (`stash@{0}: WIP on main: 44eba69 feat: Pre-authorization of visitors`). Esta sesión no lo creó ni lo tocó; conviene decidir si todavía hace falta.
- `npm run lint` del frontend tiene **2 problemas que ya existían en `main`** (un error de React 19 en `OwnerDashboard.tsx` y una directiva sin uso en `PreautPage.tsx`); no se tocaron. (Durante el trabajo aparecieron 4 más en archivos nuevos o editados aquí —`ConfirmDialog.test.tsx`, `MisAnunciosPage.tsx`, `ConfiguracionQrPage.tsx`, `ConfiguracionReservasPage.tsx`— y se corrigieron.)
