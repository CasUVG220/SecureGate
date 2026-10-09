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

*(la tabla se completa ticket por ticket)*

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
