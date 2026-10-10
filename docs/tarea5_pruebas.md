# Pruebas de integración y regresión (Tarea 5, CC3091)

Pruebas con **Postgres real** (sin mocks de `pg`) que ejercitan la API de Express con supertest. Corren en
local y en GitHub Actions (`.github/workflows/ci-integracion.yml`). Las pruebas unitarias existentes
(`npm test`, 594) no cambian y siguen sin necesitar base de datos.

## Cómo correrlas en local
Requisitos: Docker, Node 20 (el del Dockerfile; con nvm: `nvm install 20 && nvm use 20`).

```bash
# 1) Postgres descartable (se borra al detenerlo; NO usa la base ni el volumen de desarrollo)
docker run -d --rm --name sg-test-db -p 127.0.0.1:55432:5432 --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=securegate_test postgres:15

# 2) Pruebas (desde backend/). Los scripts ya fijan TZ=America/Guatemala.
cd backend && npm ci
npm test                    # unitarias (594), sin base de datos
npm run test:integration    # I-1, I-2, I-3
npm run test:regression     # R-1, R-2, R-3
npm run test:ci             # integración + regresión, un solo reporte

# 3) Al terminar
docker stop sg-test-db
```
Variables (todas con valor de prueba por defecto en `src/__tests__/helpers/env.ts`; no hay secretos reales):
`DATABASE_URL` (por defecto `postgresql://postgres:postgres@127.0.0.1:55432/securegate_test`) y `JWT_SECRET`.
Reportes JUnit en `backend/reports/` (ignorado por git).

**Guarda de seguridad:** las pruebas se niegan a correr si el host de `DATABASE_URL` no es `localhost`/`127.0.0.1`
o si la base no termina en `_test` (`helpers/guardaBd.ts`, validada en el `globalSetup` y en cada archivo).
El `globalSetup` **vacía el esquema `public`** de esa base, aplica `database/init.sql` con `runMigrations()`
(la misma función que usa el backend al arrancar) y verifica que existan las tablas y columnas clave; si falta
algo falla con un mensaje claro (porque `runMigrations` nunca lanza).

**Zona horaria:** Node con `TZ=America/Guatemala` y Postgres en UTC. R-2 lo comprueba y falla con mensaje claro
si el entorno no es ese, para no pasar en vacío.

## Las 6 pruebas
| ID | Archivo | Componentes | Condición | Datos | Resultado esperado |
|---|---|---|---|---|---|
| I-1 Login y sesión | `integration/auth.sesion.int.test.ts` | `/api/auth/login`, `/refresh` → auth.controller → `usuarios`, `refresh_tokens` | Usuario activo; credenciales válidas, contraseña mala, correo inexistente | admin_sucursal A1 y agente A1 del seed | 200 + JWT + cookie httpOnly; en BD solo el hash SHA-256 del refresh; mismo 401 para contraseña mala y correo inexistente; refresh rota (el anterior 401, el nuevo 200) |
| I-2 Invitaciones | `integration/invitaciones.int.test.ts` | `/api/invitaciones` (crear, consultar público, aceptar) → `invitaciones`, `usuarios` | admin_empresa A invita a admin_sucursal de A2; el body de aceptar intenta `rol:"owner"` y otra empresa | empresa A, sucursal A2, correo único | `token_hash` = SHA-256 y el token nunca en BD; el usuario nace `admin_sucursal` en A2/empresa A; 2.º aceptar 409 |
| I-3 Garita offline | `integration/garita.offline.int.test.ts` | `/api/licencias/activar`, `/api/accesos` (+`X-Licencia-Token`), `/api/sync/garita` → `licencias_dispositivo`, `registros_acceso`, `residentes` | Licencia sembrada sin activar; agente de A1; cola offline con `id_cliente` y `registrado_en` pasado | licencias A1/B1, residente A1 | 201 y luego 200 `duplicado` con **una** fila; `recibido_en` ≈ ahora aunque `registrado_en` sea de hace 1 h; JWT de usuario como licencia 403; sync sin licencia 401; snapshot solo de A1 (no de B1); licencia de otra sucursal 403 |
| R-1 Aislamiento multi-tenant | `regression/aislamiento.reg.test.ts` | `/api/reservas/disponibilidad` (`ownershipClause`), `/api/anuncios/:id/leer` → `areas_comunes`, `anuncio_lecturas` | Personal y residente de A piden recursos de B; controles positivos de lo propio | áreas A1/A2/B1, anuncios A1/B1 | Área de B: 403 (admin_empresa A, admin_sucursal A1, agente A1); lo propio 200; anuncio de B → 404 sin fila en `anuncio_lecturas`; el propio 200 con fila |
| R-2 Vigencia de invitaciones | `regression/vigencia.invitaciones.reg.test.ts` | `/api/invitaciones/:token` y `/aceptar` (`expira_en <= NOW()` en SQL) → `invitaciones`, `usuarios` | `expira_en = NOW() - 1 minuto` por SQL, bajo TZ America/Guatemala y Postgres UTC | dos invitaciones (vencida y vigente) | Vencida: GET 410, aceptar 410, sin usuario; vigente: 200 y 200; el entorno de TZ se verifica |
| R-3 Suspensión de empresa | `regression/suspension.reg.test.ts` | `/api/empresas/:id/suspender` y `/reactivar` (owner), login, heartbeat, `verifyToken` → `empresas`, `refresh_tokens` | Empresa A con sesión y licencia vivas se suspende; B intacta | empresas A y B, licencia A1 activada | Suspendida: login 423, contraseña errada 401, heartbeat 423, access token vivo 401, refresh 401, B opera; reactivada: login 200 y heartbeat 200 |

## Estructura
```
backend/
  jest.config.js                 # unitarias (excluye integration/, regression/, helpers/)
  jest.integration.config.ts     # integración + regresión (--runInBand, timeout 30 s, JUnit)
  src/app.ts                     # app de Express sin efectos (la importan las pruebas)
  src/index.ts, config/arranque.ts  # punto de entrada: validar entorno, migrar, cron, listen
  src/__tests__/
    helpers/ {guardaBd, env, globalSetup, db, auth, seed}.ts
    integration/*.int.test.ts    # I-1, I-2, I-3
    regression/*.reg.test.ts     # R-1, R-2, R-3
  reports/                       # JUnit (no versionado)
.github/workflows/ci-integracion.yml
.github/scripts/resumen-junit.js # resumen para $GITHUB_STEP_SUMMARY
```
Aislamiento: cada archivo de test carga módulos nuevos (limitadores de tasa y `utils/revocacion.ts` en memoria
quedan por archivo) y siembra datos con sufijo aleatorio; los límites de tasa se suben por variables de entorno.
Las contraseñas del seed usan `crypt(..., gen_salt('bf', 4))` (producción usa 12) para que sea rápido.

## CI (GitHub Actions)
Eventos: `push` (cualquier rama), `pull_request` a `main` y `workflow_dispatch`; permisos `contents: read`;
`concurrency` por ref. Todos los jobs corren en **`ubuntu-24.04` fijo** (no `ubuntu-latest`: GitHub mueve ese alias de versión
y una migración del runner no debe romper el CI; se sube a propósito, SCRUM-158).

1. **`integracion-regresion`** — service container `postgres:15` (healthcheck `pg_isready`, base `securegate_test`),
   `TZ=America/Guatemala`, Node 20 con caché de npm, `npm ci`, y pasos separados **Pruebas de integración** y **Pruebas de regresión**
   (`if: always()`); sube `backend/reports/` como artefacto `reportes-junit` y escribe el resumen en `$GITHUB_STEP_SUMMARY`.
2. **`unitarias`** (matriz: backend, frontend, desktop) — `npm ci`, `npm test` y la compilación de tipos (`tsc --noEmit` / `npm run build`);
   sin base de datos. El backend corre con `TZ=America/Guatemala` (como en producción); el frontend y la parte web del escritorio, en **UTC**
   (la del runner), para que una prueba que solo pase en la zona de Guatemala falle en el CI.
3. **`desktop-rust`** — `cargo test --lib --locked` de la parte nativa del escritorio. Tauri compila contra GTK/WebKit en Linux y exige
   tres cosas que no se versionan (`dist/`, el runtime de Node del sidecar y sus recursos): el job las crea vacías porque `cargo test` no las ejecuta.

El workflow queda rojo si falla cualquier prueba de cualquiera de los jobs. Cómo se validó el workflow sin poder ejecutarlo en GitHub: `actionlint`
(sin errores) y la réplica de cada job en contenedores Linux (Node 20 amd64 y Ubuntu 24.04); ver `docs/sprint9_noche.md`, SCRUM-117.

## Evidencia de regresión
Ver "Fase D" y "Fase F" en `docs/tarea5_bitacora.md`: cada regresión se rompió a propósito, la prueba correspondiente
falló y volvió a pasar al revertir; la demo en CI usa la rama `demo/regresion`.
