# SecureGate — Revisión de seguridad y calidad (2026-09-20)

Alcance: `backend/`, `database/init.sql`, `docker-compose*.yml`, `nginx/`, `scripts/`,
`frontend/src/services`, `desktop/src-tauri` (config, licencia, BD local) y el sidecar OCR.
Método: lectura de código (no se ejecutó un pentest contra un despliegue vivo) más `npm audit`.
Todo lo marcado **CONFIRMADO** se verificó leyendo la ruta completa (router → middleware → controller → SQL).

> **Estado (rama `security/hardening-review`):** los hallazgos críticos, altos y casi todos
> los medios de este informe ya están corregidos. Ver la tabla «Estado de las correcciones»
> justo debajo; el resto del documento se conserva tal como se redactó (describe el problema
> original) para que sirva de referencia de qué se arregló y por qué.

## Estado de las correcciones

Verificado con: 531 tests unitarios del backend (283 de ellos recorren TODAS las rutas reales
por HTTP: sin token → 401, matriz de roles → 403), 124 del frontend, 79 del desktop (TS) y 65 de
Rust; y un recorrido **end-to-end de 109 comprobaciones contra un backend y un PostgreSQL 15
reales** (ataques entre empresas, sesiones, CSV, cuentas demo en modo producción, CORS).

| ID | Estado | Qué se hizo |
|---|---|---|
| C1 | ✅ | Seeds demo movidos a `database/seed-dev.sql` (sólo con `SEED_DEMO=true` y fuera de producción). En producción el arranque **desactiva** las cuentas demo que conserven su contraseña pública. Nuevo `npm run owner:crear` para el primer owner. |
| C2 | ✅ | Sin `JWT_SECRET` por defecto: en producción el backend **no arranca** si falta, es < 32 caracteres o es un valor público (`config/env.ts`); en desarrollo genera uno aleatorio. `deploy.sh` crea uno persistente en `.env`. Postgres dev sólo en `127.0.0.1`. CORS sin allowlist ya no se acepta en producción. **Acción manual: rotar el secreto en la VM (invalida sesiones y licencias).** |
| C3 | ✅ | `/ocr` (auth + staff + rate limit, clave de Google en header), `/cargos` y `/configuracion-cargos` (auth + admin + filtro de tenant). |
| C4 | ✅ | `POST /pagos/tarjeta` responde 501 salvo `PAGOS_TARJETA_SIMULADA=true` (sólo en el compose de desarrollo). `aprobarPago` con `FOR UPDATE` y sin resucitar pagos rechazados; `createPago` con alcance. |
| A1 | ✅ | `deleteUsuario` con jerarquía + alcance; cierra refresh tokens **y el access token al instante**; `refresh` exige `activo = TRUE`. |
| A2 | ✅ | `updateSucursal`/`deleteSucursal`/`assignAdminSucursal`/`getEmpresaStats`/`assignAdminEmpresa` con alcance y roles permitidos. |
| A3 | ✅ | `requireStaff`/`requireAdminSucursal` en reportes, dashboard, blacklist, preautorizaciones, residentes (alta/baja), accesos, visitantes, QR verificar, cargos. |
| A4 | ✅ | `resolverSucursal`: sin fallback; el body se valida contra el alcance del usuario. |
| A5 | ✅ | `POST /accesos`: `requireStaff`, agente = el de la sesión, residente dentro del alcance, sesión y licencia de la misma sucursal, longitudes validadas, sin foto ajena. |
| A6 | ✅ | `/visitantes` sólo devuelve visitantes vistos en el alcance del que consulta; comodines `LIKE` escapados. (La tabla sigue siendo global: ver «pendiente».) |
| A7 | ✅ | Cargos programados con alcance + `FOR UPDATE` (dos «aplicar» simultáneos ya no duplican el cargo). |
| A8 | ✅ | `verifyToken` rechaza tokens con `typ`, fija `HS256` y exige un rol conocido; `requireStaff` es lista blanca. |
| M2 | ✅ | `sync/garita` compara la sucursal del agente con la de la licencia. |
| M3 | ✅ parcial | Se eliminó `detail: String(error)` de las 115 respuestas 500 (`serverError` lo manda al log). `/api/status` ya no filtra nada. Falta un logger estructurado (pino) con `requestId`. |
| M4 | ✅ parcial | Política de contraseñas (8–72 bytes, letras+números, no comunes), bcrypt costo 12. Falta igualar el tiempo de respuesta cuando el correo no existe. |
| M5 | ✅ | `trust proxy` configurable (`TRUST_PROXY`), sin leer `X-Forwarded-For` a mano; límite de login por IP **y por cuenta** (sólo cuentan los fallidos); refresh/logout con cupo propio; nginx sobrescribe `X-Forwarded-For`. |
| M6 | ✅ parcial | Revocación inmediata de access tokens (usuario y empresa). Pendiente: detección de reutilización del refresh token y sacar el access token de `localStorage`. |
| M7 | ✅ | Cuerpo de 100 kb por defecto (8 MB sólo en OCR, áreas y transferencia); errores 400/413 JSON. |
| M8 | ✅ | CSV: fórmulas neutralizadas; fechas validadas. |
| M9 | ✅ | `auditLog` escribe al terminar, con código HTTP, `registro_id`, correo intentado en login; más acciones auditadas (usuarios, sucursales, residentes, cargos, preautorizaciones). |
| M10 | ✅ parcial | Dockerfiles multi-etapa (backend compilado y no-root; frontend estático con nginx sin privilegios), `cap_drop`/`no-new-privileges`, nginx con CSP, `always`, rate limit, TLS «intermediate». Validado: `tsc` + arranque del `dist`, `nginx -t`, `docker compose config`. **No se pudo construir la imagen** (Docker Hub no respondió en este entorno): haz un `docker build --target prod` antes de desplegar. |
| M11 | ✅ | Documentado (README + cabecera del script): Cloud SQL usa backups automáticos + PITR. Falta **probar una restauración**. |
| M12 | ✅ parcial | Backend: `npm audit fix` + `overrides.qs`; quedan 2 moderadas (`node-cron`→`uuid`, sin ruta explotable: no se llama a `uuid` con `buf`; el arreglo es un salto mayor de `node-cron`). Frontend y desktop: 0. |
| D1 | ✅ | `app_configurar_api_url`: `https://` obligatorio (http sólo localhost/red privada), rechaza `usuario@host`, y **no permite cambiar la URL con una licencia guardada** (hay que desvincular). |
| D3 | ✅ | Un reloj más de 6 h por detrás del último contacto bloquea con `reloj_alterado` en vez de alargar la gracia. |
| D5 | ✅ parcial | `hardware_abrir`/`hardware_probar`/`hardware_config_set` exigen sesión de agente y dejan en el log quién los usó. Pendiente: tabla de auditoría local y acotar el scope de `tauri-plugin-shell`. |
| Bajas | ✅ | Escape HTML en el correo de invitación; el enlace ya no se imprime en logs de producción; `checkPreautorizacion` sin comodín; `saldo_pendiente_actualizado` real; promesas rechazadas de handlers async ya no tumban el proceso (`utils/asyncErrors.ts`); `runMigrations` no rechaza sin base. |

**Pendiente (no se tocó a propósito):** M1 (atar la licencia a una clave del equipo), D2 (clave de
SQLCipher derivable en el mismo perfil), D4 (auto-actualización firmada, Sprint 9), `visitantes`
por tenant, refresh-token reuse detection, access token fuera de `localStorage`, locks de cron
para varias réplicas, RLS de Postgres, 2FA para owner/admin de empresa y todo el apartado «Qué
agregar». Son cambios de arquitectura que merecen su propio PR.

**Compatibilidad — qué notará el equipo:**
- Contraseñas nuevas: mínimo 8, con letras y números (las cuentas existentes siguen entrando).
- El login cuenta sólo intentos fallidos: 20 por IP y 10 por correo cada 15 min.
- Un residente ya no ve `/dashboard`, `/blacklist`, `/reportes` ni `/preautorizaciones`.
- En producción el pago con tarjeta responde 501 hasta integrar la pasarela real.
- El primer deploy con el `JWT_SECRET` nuevo invalida las sesiones y **las licencias de garita** (hay que reactivarlas con un código nuevo).

---

## Resumen ejecutivo

Los patrones de base están bien pensados (`tenantFilter`/`ownershipClause`, refresh tokens
hasheados y rotados, invitaciones con token hasheado, reservas con `FOR UPDATE`, SQLCipher,
Credential Manager). El problema es que **se aplican de forma desigual**: la mitad de las
rutas sólo tienen `verifyToken` (cualquier usuario logueado, incluido un residente) y varios
`UPDATE`/`DELETE` no llevan filtro de tenant. Hay además dos problemas de configuración que
por sí solos permiten tomar el sistema completo.

| Sev. | # | Hallazgo |
|---|---|---|
| Crítica | C1 | Credenciales demo (`admin@securegate.com / admin123`, owner) se re-siembran en **cada arranque** |
| Crítica | C2 | El compose que usa `deploy.sh` lleva `JWT_SECRET` fijo y público + `NODE_ENV=development` (CORS abierto con credenciales) |
| Crítica | C3 | `/api/ocr/*` y `/api/cargos/*` **sin autenticación** |
| Crítica | C4 | `POST /pagos/tarjeta` liquida la deuda con cualquier "tarjeta" (pasarela simulada, pero con efecto real) |
| Alta | A1 | `DELETE /usuarios/:id` sin filtro de tenant (un admin de sucursal puede desactivar al owner) |
| Alta | A2 | `POST /sucursales/:id/admin` y `PUT/DELETE /sucursales/:id` sin filtro de tenant (escalada de privilegios entre empresas) |
| Alta | A3 | Rutas de "admin" alcanzables por residentes (residentes, reportes, dashboard, blacklist, preautorizaciones) |
| Alta | A4 | `resolveSucursalId` confía en el body y cae a "la primera sucursal de la BD" |
| Alta | A5 | `POST /accesos` acepta cualquier `residente_id`/`agente_id` sin validar tenant |
| Alta | A6 | `/api/visitantes` es global: cualquier usuario busca DPIs de todos los tenants |
| Alta | A7 | Cargos programados: `updateCargo`/`deleteCargo`/`getHistorial` sin tenant |
| Media | M1–M12 | Ver sección Media |

---

## Críticas

### C1 — Cuentas demo con contraseña conocida en producción
`database/init.sql:313-335` siembra `admin@securegate.com/admin123` (**owner**),
`empresa@…/empresa123`, `sucursal@…/sucursal123`, `agente1@…/agente123`, `r1@…/res123`.
`backend/src/db/migrate.ts` ejecuta **todo** `init.sql` en cada arranque del backend, también
contra Cloud SQL. El `ON CONFLICT (email) DO NOTHING` sólo protege mientras el owner real
conserve ese correo: si lo cambia o lo borra, el backdoor se re-crea solo.

**Fix:** sacar los seeds de `init.sql` a `database/seed-dev.sql`, ejecutarlo sólo si
`NODE_ENV !== 'production'`. Crear el primer owner de producción con un script de un solo uso
que lea la contraseña de una variable de entorno. Rotar/borrar hoy esas cuentas en Cloud SQL.

### C2 — `JWT_SECRET` público y compose de desarrollo en el despliegue
`docker-compose.yml:47` fija `JWT_SECRET: securegate_jwt_secret_dev`; `scripts/deploy.sh` lo usa
(`docker compose up`, no `-f docker-compose.prod.yml`). PRODUCT.md confirma que la VM expone
3000/5173 directo (nginx fue removido). Consecuencias si eso es lo que corre:
- Cualquiera con el repo forja un JWT de `owner` (`jwt.sign({rol:'owner',…}, 'securegate_jwt_secret_dev')`) y
  tiene control total. También puede forjar tokens de licencia.
- `NODE_ENV=development` ⇒ `index.ts:49` refleja **cualquier** `Origin` con `credentials: true`, y la cookie
  de refresh pierde `secure`.
- Postgres publicado en `0.0.0.0:5433` con `sguser/sgpassword123`.

**Fix:** arrancar el backend con `process.exit(1)` si `JWT_SECRET` falta, mide < 32 chars o es uno
de los valores conocidos; `deploy.sh` debe usar el compose de prod; no publicar `5433`; usar
`docker-compose.override.yml` para lo de dev. **Rotar `JWT_SECRET`** (invalida todas las sesiones y licencias
emitidas; hay que reactivar las garitas) — hacerlo ya si la VM corre el compose de dev.

### C3 — Rutas sin autenticación
`backend/src/routes/index.ts:56,59` monta `/cargos` y `/ocr` **sin** `verifyToken`, y sus routers tampoco lo
aplican (`cargos.routes.ts`, `ocr.routes.ts`):
- `POST /api/ocr/dpi|placa` → proxy anónimo hacia Google Vision con **tu** API key (consumo de cuota/costo; límite
  del body 50 MB). Además la key viaja en la query string (`ocr.controller.ts:35`) y termina en logs; Google acepta
  el header `x-goog-api-key`.
- `GET/POST/PUT /api/cargos/configuracion*` → cualquiera lee **todas** las configuraciones de cargos de todos los
  tenants, crea otras y edita las existentes por id.
- `PATCH /api/cargos/:id/aplicar` → cualquiera aplica cargos automáticos y **sube el saldo** de un residente.
- `GET/POST/PUT/DELETE /api/configuracion-cargos` sólo tiene `verifyToken`: un residente puede editar tarifas de
  cualquier sucursal (`cargos.controller.ts` no filtra tenant en el `UPDATE`).

**Fix:** `router.use('/cargos', verifyToken, requireAdminSucursal, cargosRouter)`,
`router.use('/ocr', verifyToken, requireStaff, ocrLimiter, ocrRouter)`; filtrar por `ownershipClause` en
`updateConfiguracion`/`deleteConfiguracion`/`aplicarCargo`. Añadir un test de "contrato" que recorra
`router.stack` y falle si una ruta no tiene `verifyToken` (más abajo, en *Qué agregar*).

### C4 — Pago con tarjeta simulado que sí cancela la deuda
`pagos.controller.ts:238-297`: `POST /pagos/tarjeta` con `ultimos4: "0000"` devuelve `aprobado` y ejecuta
`saldo_pendiente = 0, estado_pago = 'al_dia'`. No compara `monto` contra el saldo. Cualquier residente se
perdona la deuda con una petición. `es_simulado=TRUE` sólo queda como etiqueta en la fila.

**Fix inmediato:** `if (process.env.PAYMENTS_MODE !== 'simulado') return 501`, y en modo simulado que **no** liquide
(deja el pago `pendiente` o marca `es_simulado` y no toca el saldo). Cuando llegue Visanet: liquidar sólo tras el
webhook firmado, comparando monto y `pago_id`.
Relacionado: `createPago`/`aprobarPago` también ponen el saldo en 0 sin importar el `monto` (pago parcial = deuda
borrada) y `aprobarPago` no bloquea la fila (doble clic = dos liquidaciones).

---

## Altas

### A1 — Desactivar a cualquier usuario del sistema
`usuarios.controller.ts:60`: `UPDATE usuarios SET activo = FALSE WHERE id = $1` sin `ownership`. Un
`admin_sucursal` de la empresa X puede desactivar al `owner` o a admins de otras empresas (necesita el UUID, que
`getUsuarios`/`invitaciones` revelan). Además no revoca `refresh_tokens`, y **`refresh` (auth.controller.ts:134) no
comprueba `u.activo`**: un usuario desactivado sigue renovando su sesión 7 días.
**Fix:** filtro de tenant + no permitir tocar roles ≥ al propio + `UPDATE refresh_tokens SET revoked=TRUE` +
`AND u.activo = TRUE` en `refresh`.

### A2 — Escalada entre empresas por sucursales
`sucursales.controller.ts`: `updateSucursal` y `deleteSucursal` (líneas 64-104) no verifican que la sucursal sea de la
empresa del admin; `assignAdminSucursal` (:106) hace `UPDATE usuarios SET sucursal_id=$1, rol='admin_sucursal' WHERE id=$2`
con **cualquier** `usuario_id`: un `admin_empresa` puede degradar/reasignar al owner, o ascender a un residente ajeno.
`getEmpresaStats` (`empresas.controller.ts:383`) deja a un `admin_empresa` leer métricas de otra empresa.
**Fix:** `WHERE id=$n AND empresa_id = $user.empresa_id` (owner exento) y limitar `assign*` a usuarios de la misma empresa
con rol menor.

### A3 — Endpoints de administración abiertos a residentes
Sólo `verifyToken`, sin `requireStaff`/`requireAdminSucursal`:
- `GET /reportes/accesos|pagos` — CSV con **DPI y nombre de todos los visitantes** y estado de pagos de toda la sucursal.
- `GET /dashboard` — visitantes recientes con casa.
- `GET /blacklist` — DPIs, razones y quién los vetó.
- `GET/DELETE /preautorizaciones*`, `GET /preautorizaciones/buscar` — preautorizaciones de todos los vecinos; un
  residente puede borrar las de otro (`ownershipClause` permite cualquier rol de la misma sucursal).
- `POST /preautorizaciones` — con cualquier `residente_id` (sin verificar tenant).
- `POST /residentes` y `DELETE /residentes/:id` — **un residente puede crear y borrar residentes**.
- `PATCH /accesos/:id/salida` (sin `auditLog` además).
- `GET /cargos-programados`, `GET /:id/historial`.
- `GET /invitaciones-qr/verificar/:id`.
**Fix:** poner el guard correcto por ruta. Regla práctica: todo lo que no sea `/mis`, `/me` o `/mis-*` exige `requireStaff`
como mínimo.

### A4 — `resolveSucursalId` (utils/tenant.ts:55)
Prioridad JWT → **body** → "primera sucursal activa de toda la BD". Para `owner` y `admin_empresa` (sin `sucursal_id`
en el JWT) el body no se valida y, si falta, el dato cae en un tenant cualquiera. Usado en: residentes, anuncios,
áreas, blacklist, configQr, configReservas (y `crearLicencia`, que sí valida después).
Ejemplo real: un `admin_empresa` publica un anuncio sin `sucursal_id` → se publica a los residentes de **otra empresa**.
**Fix:** eliminar el fallback; si viene `sucursal_id` en el body verificar `ownership` contra la sucursal; si no viene y
el usuario no tiene sucursal → 400.

### A5 — `POST /accesos` sin validar tenant ni rol
`accesos.controller.ts:34-…`: `residente_id` y `agente_id` vienen del body; sólo se comprueba que existan. Un agente de la
sucursal A puede registrar una visita contra un residente de la B (y disparar el **cargo por mora**, que sube su saldo).
`agente_id` es suplantable (auditoría falsa). El `visitante` devuelto es la fila global (`SELECT * FROM visitantes`) con
la `foto` que subió otro tenant. Sin `requireStaff`, un residente también puede registrar entradas.
**Fix:** `requireStaff`; ignorar `agente_id` del body (`req.user.id`); `SELECT … FROM residentes WHERE id=$1 AND sucursal_id=$2`.

### A6 — `visitantes` es una tabla global
`visitantes.routes.ts` (`GET /` y `/buscar`): `ILIKE '%…%'` sobre DPI y nombre de **todos** los tenants para cualquier
usuario autenticado. Con 3 caracteres se enumeran DPIs (dato personal sensible; ver Ley de protección de datos GT en
discusión y buenas prácticas). **Fix:** exigir staff y restringir a visitantes con `registros_acceso` en la sucursal
(o añadir `sucursal_id` a `visitantes`, que es lo correcto: la unicidad global de DPI además filtra información entre
condominios).

### A7 — Cargos programados sin tenant
`cargos_programados.controller.ts`: `updateCargo` (:57), `deleteCargo` (:81), `getHistorial` (:186) no filtran; `getCargos`
devuelve **todos** los tenants cuando el usuario no tiene `sucursal_id` (owner/admin_empresa). `aplicarCargo` no bloquea
la fila: dos peticiones simultáneas duplican el cargo (SELECT de dedupe y INSERT no son atómicos). **Fix:** `ownershipClause`
+ `SELECT … FOR UPDATE` sobre el cargo.

### A8 — Un token de licencia sirve como JWT de usuario
`auth.middleware.ts:38` no comprueba `typ`. Un JWT de licencia (`typ:'licencia'`, sin `rol`) pasa `verifyToken`, y como
`requireStaff` sólo excluye `rol==='residente'`, `undefined` **pasa**. Quien robe el token de una garita obtiene acceso de
"staff" a rutas que sólo piden `requireStaff`. **Fix:** `if (decoded.typ) return 403` y `algorithms: ['HS256']`;
además `requireStaff` debería ser lista blanca (`['agente','admin_sucursal',…].includes(rol)`).

---

## Medias

- **M1 — La licencia no está atada a la máquina en el servidor.** `verifyLicencia` no exige `fingerprint`; el hash del
  fingerprint viaja dentro del propio token, así que un token copiado funciona desde otro equipo (el comentario de
  `licencia.middleware.ts:53` dice lo contrario). Y el fingerprint no es secreto (MachineGuid + CPU). Mejora real:
  generar un par de claves en el equipo al activar (guardado en Credential Manager / TPM), registrar la clave pública y
  pedir una firma corta por petición (o por heartbeat). El token robado deja de servir.
- **M2 — `sync/garita` no compara la sucursal del agente con la de la licencia** (`sync.routes.ts`).
- **M3 — `detail: String(error)` en 60+ respuestas 500** filtra mensajes de Postgres (nombres de tabla/columna/constraint).
  Ya está en la deuda técnica; hacerlo con un `errorHandler` central y un logger estructurado (pino) con `requestId`.
  `/api/status` además es público y devuelve nombre de la BD y el error crudo.
- **M4 — Contraseñas:** mínimo 6 caracteres; `gen_salt('bf')` sin costo (=6 rondas) en `usuarios.controller.ts:126` y
  `invitaciones.controller.ts:297` (en `residentes` se usa 10). Subir a 12, mínimo 10 caracteres + lista de contraseñas
  comunes, y `createUsuario`/`createResidente` aceptan cualquier contraseña sin validar. `crypt()` sólo corre cuando el
  email existe → diferencia de tiempo que enumera correos.
- **M5 — Rate limit:** por IP y sin `app.set('trust proxy', …)`. Detrás de nginx/Cloud LB todos comparten IP (o, con XFF
  spoofeable, ninguno la comparte). `clientIp()` y `auditLog` leen `X-Forwarded-For` a ciegas → IP falsificable en
  auditoría. Añadir bloqueo por cuenta (p. ej. 5 fallos → 15 min) además del de IP. `/auth/refresh` y `/logout` comparten
  el límite de login (10/15 min).
- **M6 — Sesiones:** access token de 1 h sin revocación; no hay detección de reutilización de refresh token (si alguien
  usa uno ya rotado, hay que revocar toda la familia); cambiar de rol/desactivar no invalida el JWT vigente.
  El access token vive en `localStorage` (`frontend/src/services/api.ts`): cualquier XSS lo roba. Mantenerlo sólo en
  memoria y recuperarlo con `/auth/refresh` al cargar.
- **M7 — Límite de cuerpo 50 MB global** (`index.ts:84`) antes de autenticar ⇒ DoS trivial con el rate limit general de
  1000/15 min. Dejar 100 kb por defecto y 5 MB sólo en las rutas de foto/OCR (y no guardar `foto` como base64 en la BD).
- **M8 — CSV injection** (`reportes.controller.ts:5`): un visitante llamado `=HYPERLINK(...)` se ejecuta al abrirlo en
  Excel. Prefijar `'` a celdas que empiezan con `= + - @ \t \r`.
- **M9 — Auditoría pobre** (`audit.middleware.ts`): se registra **antes** de ejecutar y sin resultado; el `LOGIN` no guarda
  quién intentó entrar (no hay `req.user`) ni si falló; nunca se llena `registro_id`; no hay valores antes/después. Loguear
  en `res.on('finish')` con status, email intentado y entidad. Es lo primero que pedirá un cliente empresarial.
- **M10 — Infra:** contenedores corren como root, `ts-node` en producción, `npm install` (no `ci`), el frontend sirve el
  dev server de Vite en producción, imágenes sin fijar. Multi-stage build (`tsc` → `node dist`), `USER node`,
  `npm ci --omit=dev`, servir el frontend estático detrás de nginx. `nginx.conf` sin CSP, sin límites por `location`, sin
  `limit_req`, `ssl_ciphers HIGH:!aNULL:!MD5` genérico (usar el perfil Mozilla "intermediate"), `X-XSS-Protection` obsoleto.
- **M11 — Backups:** `scripts/backup-postgres.sh` hace `docker exec securegate-db` y ya no hay contenedor en producción
  (Cloud SQL). Activar backups automáticos + PITR en Cloud SQL, **probar una restauración**, y cifrar con CMEK si se
  guardan dumps en GCS.
- **M12 — Dependencias** (`npm audit --omit=dev`, backend): `body-parser <1.20.6` (DoS), `qs` (DoS), `ip-address` (alta),
  `uuid`/`node-cron`. `npm audit fix` resuelve casi todo sin cambios de API. Falta correr `npm audit` en `frontend/` y
  `cargo audit` en `desktop/src-tauri`, y habilitar Dependabot.

## Bajas / higiene

- `helmet()` + `helmet.contentSecurityPolicy()` duplicados; `sanitizeBody` (`validate.middleware.ts`) está sin usar
  (y escapar HTML en la entrada no es la defensa correcta; escapar al **renderizar**). El HTML del correo de invitación
  (`invitaciones.controller.ts`, `html:`) interpola `invitado_por_nombre` y `empresa_nombre` sin escapar: se vuelve
  inyección cuando exista transporte real de email.
- El enlace de invitación se imprime completo en consola (`email.ts`, transporte `log`): en producción sale en los logs.
- `runMigrations().finally(() => listen)` arranca aunque las migraciones fallen (esquema a medias); y ejecutar todo
  `init.sql` en cada arranque no escala ni deja historial → migrar a migraciones numeradas (`node-pg-migrate`/`drizzle-kit`).
- Los cron corren en cada réplica del backend; si algún día hay 2 instancias, cada job se ejecuta doble (usar
  `pg_advisory_lock`).
- `saldo_pendiente_actualizado` en `registrarAcceso` devuelve 0 cuando no hay cargo porque el `SELECT` no trae
  `saldo_pendiente`.
- `checkPreautorizacion` (`preautorizaciones.controller.ts:8`) trata `numero_dpi IS NULL` como comodín: una preautorización
  sólo con placa autoriza a **cualquier** DPI de ese residente.
- QR grupal sin `fecha_fin` ni `usos_maximos` = acceso permanente; imponer una vigencia máxima por configuración.
- Falta índice en `registros_acceso`/`pagos` (ya en la deuda) y `CHECK (monto > 0)` a nivel BD.
- `GET /residentes/:id/pago` y demás consultas por id devuelven 404 vs 403 distinto según el caso (enumeración de ids);
  unificar.

## App de escritorio (Tauri)

Lo mejor del repo: SQLCipher + Argon2id, secretos en Credential Manager que nunca llegan al WebView, CSP estricta, sin
permiso de shell para el frontend. Pendientes:
- **D1 — `app_configurar_api_url` (`lib.rs`) es invocable desde el WebView sin autenticación y acepta `http://`.** Si hay
  XSS/JS inyectado, redirige la app a un servidor del atacante y Rust le entrega **JWT + token de licencia** en los headers.
  Fijar la URL en build (`option_env!`), o exigir `https://` (excepto `localhost` en debug) y bloquear el cambio una vez
  activada la licencia.
- **D2 — La clave de SQLCipher se deriva de datos que están en la misma máquina** (fingerprint + token de licencia + sal en
  el mismo almacén). Protege contra copiar el archivo a otro equipo, **no** contra un usuario local con el mismo perfil de
  Windows. Está bien como está si se documenta así; para más: DPAPI-NG/TPM.
- **D3 — Reloj:** la gracia offline de 72 h usa `Utc::now()` local; retroceder el reloj extiende la gracia indefinidamente.
  Guardar un contador monótono/`servidor_ahora` y detectar retrocesos.
- **D4 — Auto-actualización firmada** (planificada Sprint 9): tauri-plugin-updater con clave pública embebida y firma en CI;
  firmar el instalador (Authenticode) para evitar SmartScreen y manipulación.
- **D5** `tauri-plugin-shell` está registrado (`lib.rs`): si sólo se usa para el sidecar, limitar el scope a ese binario
  en `capabilities`; `hardware_abrir` y `hardware_config_set` permiten abrir la talanquera a cualquiera que ejecute JS en el
  WebView → proteger con la sesión del agente y registrar cada apertura (quién/cuándo/motivo) en la cola de auditoría.
- Sidecar OCR: sin problemas (100 % local, sin red, imagen en memoria). Limitar el tamaño del base64 que acepta.

---

## Qué agregar (por valor/esfuerzo)

1. **Test de contrato de rutas** (1 hora, evita la clase entera de C3/A3): recorrer `router.stack`, y exigir que cada
   `POST/PUT/PATCH/DELETE` y cada `GET` no público lleve `verifyToken`, con una lista blanca explícita de rutas públicas.
   Y un test de aislamiento de tenants por controller (usuario de empresa B intenta leer/editar ids de A ⇒ 403/404).
2. **Autenticación en dos pasos (TOTP)** obligatoria para `owner` y `admin_empresa`; hoy la contraseña sola controla
   eliminación de empresas y creación de admins.
3. **Política de contraseñas + recuperación segura** ("olvidé mi contraseña" con token hasheado de un solo uso, ya que
   existe el patrón en invitaciones) y cambio de contraseña que revoque sesiones.
4. **Logging estructurado + `errorHandler` central + `requestId`**, y alertas (Cloud Logging) para: picos de 401/403, login
   fallidos por cuenta, licencias que se activan o fallan, aperturas manuales de talanquera.
5. **Bitácora de auditoría visible para admin_empresa** (hoy sólo el owner) con filtros y exportación; registrar cambios de
   rol, saldos y aperturas.
6. **Panel de dispositivos/licencias** con último heartbeat, versión de la app, alertas de "garita sin conexión > X h" y
   reasignar/transferir licencia sin pasar por revocar.
7. **Notificaciones a residentes** (push/WhatsApp/correo) cuando su QR/preautorización se usa — es la función que más valor
   percibido da y usa datos que ya existen. Requiere proveedor real de email (hoy sólo `log`).
8. **Retención y derechos de datos:** purga programada de `registros_acceso`/fotos (p. ej. 12–24 meses), exportación y
   borrado por persona, aviso de privacidad en el registro de visitantes. Es requisito legal y vendible a empresas.
9. **Multi-tenant a prueba de errores humanos:** Row-Level Security en PostgreSQL (`SET LOCAL app.sucursal_id`) como segunda
   barrera; habría neutralizado A1–A7 aunque el código olvide filtrar.
10. **CI/CD con puertas:** `npm audit`/`cargo audit`, `eslint-plugin-security`, `semgrep` o CodeQL, tests obligatorios,
    escaneo de secretos (`gitleaks`) y build de imágenes reproducible.
11. **Pasarela de pago real** (Visanet/Recurrente) con webhooks firmados e idempotencia, y conciliación de transferencias
    (comprobante con tamaño/tipo limitado y almacenado en GCS, no en la fila).
12. **Reporte de "salud" del condominio** para el admin (mora, visitas por hora, incidentes) — ya tienen los datos en
    `dashboard`/`reportes`.

---

## Orden de ataque sugerido

1. **Hoy:** rotar `JWT_SECRET` y las cuentas demo (C1, C2); poner `verifyToken` a `/ocr` y `/cargos` (C3); apagar
   `/pagos/tarjeta` (C4).
2. **Esta semana:** A1–A8 (son cambios de 1–5 líneas por handler: añadir `ownershipClause`/guards) + tests de aislamiento.
3. **Sprint 9 (junto con "endurecimiento" de PRODUCT.md):** M1, M3–M9, D1–D4, TOTP, logging estructurado, RLS.
4. **Sprint 10:** pasarela real, notificaciones, retención de datos.
