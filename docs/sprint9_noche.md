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
