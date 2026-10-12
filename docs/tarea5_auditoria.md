# Tarea 5 (CC3091) — Auditoría para pruebas de integración y regresión con CI

Fecha: 2026-10-06. Fase solo de lectura: no se modificó código, no se instalaron dependencias, no hubo commits.
Todo lo de abajo salió de leer el repo o de correr jest local; lo que no se verificó se marca como tal.

## 1. Estado del repo
- Rama `main`. Remotes: `origin` → CasUVG220/SecureGate, `chatio` → chatio/SecureGate. **`git push` sin argumentos iría a `origin`**; hay que empujar siempre a `chatio` de forma explícita.
- Sin cambios sin commitear en código: solo `Pruebas.md` y `Resultados-Pruebas.md` sin trackear (más `docs/` creado por esta auditoría).
- CI: no hay `.github/`, ni GitLab, CircleCI, Jenkins, Travis, Azure ni Bitbucket (búsqueda hasta 3 niveles).
- Node: `node:20-alpine` en las 3 etapas del Dockerfile (dev, build, prod). Los compose no fijan Node (solo construyen ese Dockerfile). Sin `engines` en package.json ni `.nvmrc`. Postgres: `postgres:15-alpine` en ambos compose.

## 2. Configuración de pruebas del backend
- `jest.config.js`: preset `ts-jest`, `testEnvironment: node`, `roots: [src]`, `testMatch: **/__tests__/**/*.test.ts`, `clearMocks: true`. Sin globalSetup, sin coverage, sin proyectos separados.
- Scripts: `test` = `jest`, `test:watch` = `jest --watch`. (Otros: loadtest:*, securitytest.)
- devDependencies de prueba: `jest ^29.7`, `ts-jest ^29.4`, `@types/jest`. **No hay `supertest`** (ni en package.json ni en node_modules). Tampoco pg-mem ni testcontainers.
- Carpeta: `backend/src/__tests__/`. **30 archivos, 594 tests** (conteo de jest).

## 3. Clasificación de los tests existentes
| Grupo | Archivos | Mock de pool | supertest | BD real |
|---|---|---|---|---|
| Unitarios con `jest.mock('../db/pool')` | 26 | sí | no | no |
| Unitarios de lógica pura / query inline mockeada | 4 (configQr, invitaciones.expiracion, ocr, profanityFilter) | no necesitan | no | no |
| Integración con BD real | **0** | — | — | — |

- Ninguno usa supertest ni toca Postgres real.
- Cercanos a HTTP: `security.routes.contract.test.ts` y `security.hardening.sprint8.test.ts` montan el router real (`routes/`) sobre un servidor `http` con el pool mockeado y llaman por HTTP. Sirven como **patrón** (arnés Express + fetch), pero no cubren SQL real.
- ¿Alguno sirve tal cual como integración? **No.** Todos siguen pasando en CI sin BD, y eso conviene conservarlo (suite unitaria rápida).

## 4. Testabilidad
- **`index.ts` NO exporta la app.** Al importarse: `validarEntorno()` (puede hacer `process.exit(1)`), `app.listen`, 3 `cron.schedule`, y `runMigrations()`. Habría que separar `app.ts` (construye y exporta `app`, sin listen/cron/exit) y `server.ts` (validar entorno, migrar, cron, listen).
- **Esquema:** SQL idempotente `database/init.sql` (658 líneas; CREATE IF NOT EXISTS, ALTER ... IF EXISTS, bloques DO). Se aplica (a) por `docker-entrypoint-initdb.d` solo en la primera inicialización del volumen y (b) por `runMigrations()` (`db/migrate.ts`) en **cada arranque** del backend, de una sola `client.query(sql)`. Con `SEED_DEMO=true` y no producción también aplica `database/seed-dev.sql`. No hay migraciones versionadas. En un Postgres limpio de CI **nada lo aplica solo** salvo que se llame `runMigrations()` o se use `psql -f`. Requiere extensiones `pgcrypto` y `btree_gist`.
- **Variables de entorno** que lee la app (solo nombres): `DATABASE_URL`, `JWT_SECRET`, `NODE_ENV`, `PORT`, `ALLOWED_ORIGINS` (obligatoria solo en producción), `TZ`/`APP_TZ`, `DB_POOL_MAX`, `INIT_SQL_PATH`, `SEED_SQL_PATH`, `SEED_DEMO`, `PAGOS_TARJETA_SIMULADA`, `EMAIL_TRANSPORT`, `APP_URL`, `GOOGLE_CLOUD_API_KEY`, `TRUST_PROXY`, `OWNER_EMAIL/NOMBRE/PASSWORD` (script), y `RATE_LIMIT_{GENERAL,LOGIN,LOGIN_CUENTA,SESION,ACTIVAR,HEARTBEAT,INVITACION,OCR,ELIMINAR}_MAX`. Mínimo para arrancar en pruebas: `DATABASE_URL` y `JWT_SECRET` (≥32 caracteres y fuera de la lista de valores públicos; si falta en no-producción se genera uno aleatorio).
- **TZ:** el backend corre con `TZ=America/Guatemala` y `APP_TZ=America/Guatemala` (compose). **Postgres: 15.18, zona del servidor UTC** (observado en el contenedor local), max_connections 100.

## 5. Reutilización de `backend/securitytest/`
| Pieza | Portable a jest + supertest | Depende de Docker/reinicios |
|---|---|---|
| `seed.js` | Casi todo: 2 empresas, 3 sucursales, 12 usuarios por rol (`crypt(..., gen_salt('bf',12))`), residentes y datos por sucursal con `pg.Client` directo. Licencias e invitaciones se crean por la API (`L.call` con fetch → cambiable a supertest). | Guarda que exige `127.0.0.1:5433`; escribe `results/fixtures.json`; costo bcrypt 12 (~0,2 s por login) |
| `lib.js` `call/login/tokens/Suite` | Sí (fetch→supertest) | — |
| `lib.js` `psql()` | Sí, reemplazando por `pg.Pool` | usa `docker exec securegate-db psql` |
| `lib.js` `jwtSecret()` | Sí (en el test se fija `JWT_SECRET`) | usa `docker exec ... printenv` |
| `lib.js` `reiniciarBackend()` | No hace falta: el limitador es en memoria y se resetea creando la app por archivo | `docker restart securegate-backend` cada ~850 peticiones |
| 01 idor, 02 roles, 04 invitaciones, 05 eliminar, 06 suspensión | Sí, las comprobaciones HTTP + verificación SQL | llaman `reiniciarBackend` al inicio |
| 03 jwt | Sí | usa secreto vía docker |
| 07 sqli, 08 headers (modo prod en `:3100` y BD `securegate_prodtest`), 09 ratelimit, ZAP, sqlmap, `stack.sh`, `snapshot.sh`, `prodmode.sh` | No para esta tarea | Sí: contenedores extra, reinicios, herramientas externas |
Ojo: la suite securitytest suma ~2.000 líneas y toma minutos; conviene portar solo los casos mapeados abajo.

## 6. Mapa de casos (archivo : línea, relativo a `backend/src/`)
Corrección importante: **no existe `POST /sync/garita`.** `sync/garita` es `GET /api/sync/garita` (snapshot: `routes/sync.routes.ts:10` → `controllers/sync.controller.ts:16`). El registro offline de la garita llega por `POST /api/accesos` (`routes/accesos.routes.ts:15`, con `verifyToken, requireStaff, licenciaOpcional`).

**I-1 Login y sesión**
- `POST /api/auth/login` → `routes/auth.routes.ts:58` → `login` `controllers/auth.controller.ts:91`; `POST /api/auth/refresh` (`routes:69`, controller `:153`); `POST /api/auth/logout` (`routes:70`, `:214`).
- `emitirSesion` `:68` inserta el refresh (cookie httpOnly `refresh_token`, hash SHA-256) en `refresh_tokens`.
- Tabla `refresh_tokens` (init.sql:192): `id, usuario_id, token_hash (UNIQUE), expires_at, revoked, ip_address, created_at`. Rota en refresh (revoca el viejo y crea nuevo, `:187`/`:199`).

**I-2 Invitaciones** (`routes/invitaciones.routes.ts`, controller `controllers/invitaciones.controller.ts`)
- Crear: `POST /api/invitaciones` (`routes:27`, `crearInvitacion` `:160`; solo admin_empresa/owner). Consultar: `GET /api/invitaciones/:token` (`routes:43`, `:243`; público con limitador). Aceptar: `POST /api/invitaciones/:token/aceptar` (`routes:44`, `:271`, transacción con `FOR UPDATE`, crea el usuario `:320` y marca `aceptada` `:329`, luego `emitirSesion`).
- Tablas: `invitaciones` (init.sql:600) y `usuarios`.
- `token_hash`: `generarToken()` = 32 bytes base64url (`:35`); en BD solo se guarda `hashToken()` = SHA-256 hex (`:33`, INSERT `:227`); el token en claro solo viaja en el enlace/correo. `token_hash VARCHAR(64) UNIQUE`.

**I-3 Sync de garita**
- `POST /api/licencias` (admin_sucursal) crea la licencia; `POST /api/licencias/activar` (`routes/licencias.routes.ts:23`, `activarLicencia` `controllers/licencias.controller.ts:124`, UPDATE condicional `fingerprint IS NULL` `:164-167`) devuelve `token_licencia` (JWT `typ:'licencia'`, 365 d). Heartbeat `POST /api/licencias/heartbeat` (`routes:41`, controller `:204`).
- Middlewares: JWT de usuario `verifyToken` (`middleware/auth.middleware.ts:36`); licencia `verifyLicencia` (`middleware/licencia.middleware.ts:110`), `licenciaOpcional` (`:126`) y `validarLicencia` (`:56`, header `X-Licencia-Token`).
- Accesos: tabla `registros_acceso` (columnas `id_cliente`, `registrado_en`, `recibido_en`, `origen`, `licencia_id`; init.sql:554-586).
- Idempotencia: validación UUID y búsqueda previa por `id_cliente` → 200 `{duplicado:true}` (`controllers/accesos.controller.ts:64-77`); carrera cubierta por el índice único parcial `idx_registros_acceso_id_cliente` (init.sql:585) y el catch `23505` (`:370`).
- `recibido_en`: lo sella el servidor con `NOW()` en el INSERT (`accesos.controller.ts:250-251`); `registrado_en` es el reloj del dispositivo.

**R-1 Aislamiento multi-tenant**
- `GET /api/reservas/disponibilidad` (`routes/reservas.routes.ts:18`, `getDisponibilidad` `controllers/reservas.controller.ts:62`); para staff valida alcance con `ownershipClause('a', 2)` en `:95-98` (definida en `utils/tenant.ts:37`).
- `POST /api/anuncios/:id/leer` (`routes/anuncios.routes.ts:10`, `marcarLeido` `controllers/anuncios.controller.ts:167`); filtro de sucursal en `:189` (`AND a.sucursal_id = $3`).

**R-2 Vigencia de invitaciones**
- `(i.expira_en <= NOW()) AS vencida` en `SELECT_INVITACION`, `invitaciones.controller.ts:89`; `estadoEfectivo` `:78-85` lo usa en consultar (`:250`), aceptar (`:295`), revocar (`:376`), reenviar (`:401`). Otra comprobación: `expira_en > NOW()` en `:215`. Ojo: `expira_en` es `TIMESTAMP` sin zona.

**R-3 Suspensión de empresa**
- `utils/suspension.ts`: `evaluarEmpresa` `:34`, `bloqueoDeUsuario` `:46`, `responderBloqueo` `:67` (HTTP 423).
- Se aplica en: login (`auth.controller.ts:144-145`), refresh (`:185-189`, además revoca el refresh), activar licencia (`licencias.controller.ts:156-160`), y heartbeat y `/sync` + `/accesos` vía `validarLicencia` (`licencia.middleware.ts:92-98`). Al suspender: `suspenderEmpresa` (`empresas.controller.ts:80`) llama `revocarSesionesDeEmpresa` (`:58`), que revoca los refresh y marca la revocación en memoria (`utils/revocacion.ts`), leída por `verifyToken` (`auth.middleware.ts:57`).

**Línea a romper para la demo (borrar o cambiar → la regresión falla)**
| Caso | Cambio | Efecto esperado |
|---|---|---|
| R-1 disponibilidad | `reservas.controller.ts:95`: quitar `AND ${ownershipClause('a', 2)}` | admin de otra empresa recibe 200 en vez de 403 |
| R-1 anuncios | `anuncios.controller.ts:189`: borrar `AND a.sucursal_id = $3` | residente de otra empresa recibe 200/inserta lectura ajena |
| R-2 | `invitaciones.controller.ts:89`: cambiar `<=` por `>` o poner `FALSE AS vencida` | invitación vencida se acepta (esperado 410) |
| R-3 login | `auth.controller.ts:145`: borrar `if (bloqueo) return ...` | login de empresa suspendida da 200 (esperado 423) |
| R-3 refresh | `auth.controller.ts:185-189` | refresh sigue vivo con empresa suspendida |
| R-3 licencia | `licencia.middleware.ts:96-98`: borrar el `if (bloqueo)` | heartbeat/sync siguen operando |
| I-3 idempotencia | `accesos.controller.ts:71-76`: borrar el bloque `previo` (y el índice único quedaría como red: daría 200 por el catch) | reenvío crea duplicado; para romperlo del todo, quitar también el catch `:370` |
| I-2 hash | `invitaciones.controller.ts:227`: guardar `token` en claro | consultar por token deja de encontrarla (404) |
| I-1 | `auth.controller.ts:187` o `:193`: quitar el UPDATE de revocación | refresh viejo reutilizable |

## 7. Ejecución local
- Docker Desktop estaba apagado. Lo abrí; al arrancar, los contenedores existentes (`securegate-db`, `-backend`, `-frontend`) se levantaron solos por `restart: unless-stopped`, con el volumen `securegate_postgres_data` que ya tenía datos. **No creé ni borré contenedores o volúmenes**; consulté la BD solo con SELECT/SHOW (Postgres 15.18, UTC).
- `npx jest` en `backend/` (host, **Node v25.8.0**, no el 20 del Dockerfile): **30 suites, 594 tests, 594 pasan, 0 fallan; 4,5 s** (jest) / ~8,9 s de reloj.
- La suite no usa la BD, así que el compose no era necesario para esto. Para correr integración en limpio faltan: aplicar `init.sql`, `JWT_SECRET`, `DATABASE_URL`, supertest, y exportar la app.
- Entorno restaurado: Docker Desktop cerrado (estaba apagado al inicio). Repo sin cambios salvo `docs/`.
- No se ejecutó securitytest (requiere el stack completo y reinicios; fuera de alcance de esta fase).

## Riesgos y bloqueos para GitHub Actions con service container Postgres 15
1. **app no exportable** (index.ts): bloqueo para supertest; hay que partir app/server. Mientras tanto, importar index.ts hace `listen`, cron y `process.exit`.
2. **supertest no instalado**; hay que agregarlo (devDependency) y fijar el lockfile.
3. **Esquema no se aplica solo** en un Postgres vacío: hace falta un paso `psql -f database/init.sql` o llamar `runMigrations()`; `runMigrations` nunca lanza (traga errores), así que un esquema roto pasaría silencioso y los tests fallarían después con errores confusos.
4. **Mezcla con la suite unitaria:** `testMatch` actual recogería también los tests de integración en `npm test`, que fallarían sin BD. Hay que separarlos (nombre o proyecto de jest) y definir script aparte.
5. **TZ y regresión R-2:** el bug original (S-02) surge con Node en `America/Guatemala` y Postgres en UTC. El runner de GitHub es UTC por defecto: si no se fija `TZ=America/Guatemala` en el paso de tests, la regresión pasaría aunque el código se rompa. Verificar también que el service container quede en UTC.
6. **Estado en memoria:** limitadores de tasa (login por cuenta 10 fallos/15 min, general 1000) y `revocacion.ts` viven en el proceso; hay que instanciar app por archivo o subir `RATE_LIMIT_*_MAX` para tests, y ojo con tests en paralelo del mismo archivo/BD (usar `--runInBand` o BD por worker) y limpieza entre tests.
7. **Node:** CI debe usar Node 20 (Dockerfile); aquí corrió con v25.8.0, sin evidencia en 20. Sin `.nvmrc`/`engines`.
8. **Costo de bcrypt 12** en el seed y en `crypt`: sembrar muchos usuarios es lento (~0,2 s c/u); reducir costo en datos de prueba.
9. **Extensiones** `pgcrypto` y `btree_gist` requeridas por init.sql; vienen en la imagen oficial postgres:15, pero el service container necesita `--health-cmd pg_isready` y el usuario debe poder crear extensiones (no verificado en Actions).
10. **Seguridad de secretos/BD:** `JWT_SECRET` de CI generado o en GitHub Secrets (no usar valores de la lista pública); no apuntar tests a la BD de desarrollo local (5433) ni a Cloud SQL; seed.js de securitytest tiene guardas de host que habría que replicar.
11. **Remotes:** empujar solo a `chatio`; `origin` es CasUVG220. Configurar el flujo de CI/PR en chatio/SecureGate.
12. **I-3 y el nombre "sync/garita":** el plan debe aclarar que el ingreso offline es `POST /api/accesos` + `X-Licencia-Token`; `GET /api/sync/garita` es el snapshot de descarga.
13. **Datos que dependen de fecha** (reservas `2030-01-01`, `CURRENT_DATE`): pueden volverse frágiles con el tiempo.
14. **Pendiente de verificar:** que `init.sql` aplique limpio con `psql -f` en un Postgres vacío (solo vi que lo aplica `runMigrations` por query única); que no haya otros tests que dependan del reloj; tiempo de integración en Actions.
