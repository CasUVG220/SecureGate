# Bitácora Tarea 5 (CC3091) — Pruebas de integración y regresión con CI

Fase: AUDITORÍA (solo lectura; sin cambios de código, sin dependencias nuevas, sin commits).
Horas en CST (America/Guatemala), tomadas del reloj del sistema. Corrección: una versión previa de
esta bitácora traía horas intermedias estimadas por error (19:35, 19:50, 19:55); se reemplazaron.
Como los pasos 1-6 se encadenaron en pocos minutos, se agrupan por bloque en vez de inventar minutos exactos.

| Hora | Paso | Detalle |
|---|---|---|
| 2026-10-06 19:20 | 0 | Inicio. Bitácora creada. |
| 19:20-19:22 | 1 | Rama `main`; remotes `origin` (CasUVG220) y `chatio`; sin CI (no hay .github ni GitLab/Circle/Jenkins). Árbol limpio salvo Pruebas.md y Resultados-Pruebas.md sin trackear. Node 20-alpine en las 3 etapas del Dockerfile; Postgres 15-alpine en ambos compose. |
| 19:20-19:22 | 2-3 | Config jest (ts-jest, roots src, testMatch `__tests__/**/*.test.ts`), 30 archivos de test, ninguno con supertest; ninguno toca BD real. |
| 19:20-19:22 | 4 | index.ts no exporta app y hace listen/cron/runMigrations/process.exit al importarse. Esquema = database/init.sql idempotente aplicado por runMigrations() al arrancar. |
| 19:20-19:22 | 5 | securitytest: seed.js usa pg directo + API HTTP; lib.js depende de `docker exec/restart`. |
| 19:20-19:22 | 6 | Mapa I-1..R-3 leído del código. Hallazgo: no existe `POST /sync/garita`; es `GET /api/sync/garita` (snapshot) y el envío offline va por `POST /api/accesos` con `id_cliente`. |
| 19:22 | 7 | PROBLEMA: el daemon de Docker estaba apagado. Se abrió Docker Desktop (local). Al arrancar, los contenedores existentes (securegate-db/backend/frontend) se levantaron solos por `restart: unless-stopped`, con el volumen `securegate_postgres_data` que ya tenía datos. No se creó ni borró ningún contenedor/volumen. La BD se consultó solo con SELECT/SHOW (versión, TZ). |
| 19:22 | 7 | `npx jest` en el host (Node v25.8.0, no el 20 del Dockerfile): 30 suites, 594 tests, todos pasan, 4.5 s (8.9 s de reloj con npx). No necesitaron BD. |
| 19:25 | 7 | Cierre: se cerró Docker Desktop para dejar el entorno como estaba (apagado). Reporte escrito en docs/tarea5_auditoria.md. |

## Problemas encontrados
1. Docker apagado al inicio; arrancarlo levantó la pila de desarrollo existente (con datos) por la política de reinicio.
2. Node local v25.8.0 distinto al de CI/Docker (20); la suite pasó igual, pero no es evidencia para Node 20.
3. Error mío corregido: horas estimadas en una versión previa de esta bitácora.

---
# Implementación (segunda sesión)

| Hora | Fase | Detalle |
|---|---|---|
| 2026-10-06 19:32 | 0 | `git fetch chatio` y `git fetch origin` fallan: "Repository not found". `gh` autenticado como RobloxScriDev (scopes repo/workflow) pero `gh repo view` no resuelve ni chatio/SecureGate ni CasUVG220/SecureGate. chatio/main y origin/main locales (refs en caché, no verificadas contra el remoto) apuntan ambos a 7dd6c70 = main local. PROBLEMA ABIERTO: sin acceso al remoto no se puede empujar ni ver Actions. Se continúa con fases locales (A–D, G). |
| 19:42 | 0 | Reintento de remotos (a pedido del usuario): `git ls-remote chatio/origin` responde; ambos `main` = 7dd6c70 (no difieren). `gh` ahora autenticado como CasUVG220; `gh repo view chatio/SecureGate` → privado, permiso WRITE. La API de permisos de Actions responde 404 (probablemente requiere admin): si Actions está habilitado se sabrá al empujar el workflow. Rama `tarea5-ci` creada desde chatio/main con `pushRemote=chatio`. |
| 19:42 | 0 | Node 20.20.2 instalado con nvm (`nvm install 20`; efecto lateral: el alias default de nvm pasó a 20). Docker Desktop abierto; daemon aún arrancando (500 transitorio). |
| 19:46 | A | app.ts / config/arranque.ts / index.ts separados. Node 20.20.2: `tsc --noEmit` limpio y `npm test` 594/594 (2,6 s). Commit local. Pendiente: arrancar index.ts contra la BD de prueba para confirmar que el arranque real no cambió. |
| 19:52 | B | PROBLEMA: Docker Desktop responde 500 / se cuelga ~10 min tras abrirlo. Se reinicia la app. (Mientras tanto se escribieron configs de jest, guarda de BD y globalSetup.)
| 19:57 | B | Docker reiniciado OK (19:56). BD de prueba: `docker run --rm --name sg-test-db -p 127.0.0.1:55432:5432 --tmpfs ... postgres:15` (15.19, UTC). Infra (config, guarda, globalSetup con DROP SCHEMA + runMigrations + verificación, seed bf4, helpers) lista. Primer fallo: login 401 porque normalizeEmail() baja a minúsculas y el seed guardó mayúsculas → seed usa minúsculas. I-1 pasa 3/3 con Node 20 y TZ=America/Guatemala. |
| 19:58 | C | I-2 (invitaciones) y I-3 (garita offline) escritas y pasando contra Postgres real. Hallazgo para el informe: `GET /api/sync/garita` sin X-Licencia-Token responde 401 (no 403 como decía el enunciado); con un JWT de usuario como licencia responde 403. `POST /api/accesos` sin licencia es válido (petición web). Las pruebas afirman el comportamiento real. |
| 20:00 | C | R-1, R-2, R-3 escritas. Dos fallos propios corregidos: (1) `SHOW timezone` devuelve la columna `TimeZone` → uso current_setting('TimeZone'); (2) tras suspender, `/auth/refresh` con cookie previa da 401 y no 423 (la suspensión revoca todos los refresh en BD antes; la rama 423 de refresh, auth.controller:185-189, casi no se alcanza) → la prueba afirma 401. `npm run test:ci` con Node 20 + TZ=America/Guatemala: 6 suites, 25 tests verdes en 4,6 s. `npm test` 594/594 y tsc limpio. |

## Fase D — prueba en frío (2026-10-06, Node 20, TZ=America/Guatemala, Postgres 15 en UTC)
Cada ruptura se aplicó con un script, se corrió `npm run test:regression`, se revirtió con `git checkout -- <archivo>` y se confirmó árbol limpio y `test:ci` 25/25 verde (20:00:54).

| Hora | Ruptura (archivo) | Prueba que falló | Aserción |
|---|---|---|---|
| 20:00:17 | R-1: `reservas.controller.ts:95-96` sin `ownershipClause` (y sin sus params) | `R-1 … disponibilidad con adminEmpA/adminSucA1/agenteA1 › el área de otra empresa (B1) → 403` y `admin_sucursal A1 no ve el área … (A2)` (4 fallos; los controles positivos siguen pasando) | `expect(r.status).toBe(403)` — Received: 200 (`aislamiento.reg.test.ts:44`, `:59`) |
| 20:00:22 | R-1: `anuncios.controller.ts:189` sin `a.sucursal_id = $3` | `R-1 … residente de A marca leído un anuncio de B → 404 y sin fila en anuncio_lecturas` | `expect(r.status).toBe(404)` — Received: 200 (`:64`) |
| 20:00:27 | R-2: `invitaciones.controller.ts:89` `FALSE AS vencida` | `R-2 … invitación vencida hace 1 minuto → GET 410, aceptar 410 y no se crea el usuario` | `expect(consulta.status).toBe(410)` — Received: 200 (`vigencia.invitaciones.reg.test.ts:63`) |
| 20:00:31 | R-3: `auth.controller.ts:145` sin `if (bloqueo) return responderBloqueo(...)` | `R-3 … suspendida: login 423, …` | `expect(r.status).toBe(423)` — Received: 200 (`suspension.reg.test.ts:58`) |
| 20:00:36 | R-3: `licencia.middleware.ts:96` `if (false)` | misma prueba R-3 (falla en el heartbeat; el login seguía en 423) | `expect((await heartbeat(licA1)).status).toBe(423)` — Received: 200 (`:66`) |

Nota: para romper R-1 hubo que quitar también los parámetros (`ownershipParams`), si no Postgres responde 500 por parámetros de más y la regresión se vería como otro error.
| 20:01 | E | Workflow .github/workflows/ci-integracion.yml + .github/scripts/resumen-junit.js. actionlint (docker rhysd/actionlint) sin errores; PyYAML no instalado en el host, no se usó. Pasos de CI simulados en local con Node 20: integración 9/9, regresión 16/16, resumen OK. |
| 20:02 | A | Verificación de arranque real: `ts-node src/index.ts` (Node 20) contra la BD de prueba responde /health 200 y 404 en rutas inexistentes; migraciones y listen siguen en index.ts. |
| 20:04 | E/F | Push `git push chatio tarea5-ci` OK. Actions habilitado. Corrida 1 (verde): https://github.com/chatio/SecureGate/actions/runs/37560033083 — job 1m27s (workflow 1m32s). Avisos no críticos: Node.js 20 deprecado en acciones (checkout/setup-node/upload-artifact v4 corren forzadas en Node 24). |

## Fase F — demostración en CI (chatio/SecureGate; horas CST = UTC-6)
| # | Rama / commit | Resultado | Duración | URL |
|---|---|---|---|---|
| 1 | `tarea5-ci` — "docs(tarea5): bitácora de implementación y prueba en frío" | **VERDE** (integración 9/9, regresión 16/16) | workflow 1 m 32 s; job 1 m 27 s | https://github.com/chatio/SecureGate/actions/runs/37560033083 |
| 2 | `demo/regresion` — "Introduce regresión (demo): quita ownershipClause de reservas/disponibilidad" | **ROJO**: solo falla el paso "Pruebas de regresión"; integración en verde. 4 fallos de R-1 | workflow 2 m 30 s; job 1 m 50 s | https://github.com/chatio/SecureGate/actions/runs/37560231136 |
| 3 | `demo/regresion` — "Corrige la regresión (demo): restablece ownershipClause en reservas/disponibilidad" | **VERDE** | workflow 1 m 16 s; job 1 m 12 s | https://github.com/chatio/SecureGate/actions/runs/37560460617 |

Corrida 2, pruebas fallidas (todas en `aislamiento.reg.test.ts`, aserción `expect(r.status).toBe(403)` → Expected 403, Received 200):
- `R-1 aislamiento multi-tenant › disponibilidad con adminEmpA › el área de otra empresa (B1) → 403`
- `R-1 aislamiento multi-tenant › disponibilidad con adminSucA1 › el área de otra empresa (B1) → 403`
- `R-1 aislamiento multi-tenant › disponibilidad con agenteA1 › el área de otra empresa (B1) → 403`
- `R-1 aislamiento multi-tenant › admin_sucursal A1 no ve el área de la otra sucursal de su empresa (A2)`
Totales: `Tests: 4 failed, 12 passed, 16 total` (regresión). Los diffs de código de la demo: el commit 3 es un `git revert` del 2; `git diff tarea5-ci demo/regresion -- backend` queda vacío.

## Tiempos por fase (hora del reloj; aproximados al minuto)
| Fase | Inicio–fin | Notas |
|---|---|---|
| 0. Remotos, rama, Node 20 | 19:32–19:42 | `git fetch` falló al inicio (cuenta sin acceso); tras reintento del usuario, remotos OK. `nvm install 20` tardó varios minutos. |
| A. app.ts / servidor | 19:44–19:46 | tsc limpio, `npm test` 594/594 |
| B. Infraestructura | 19:47–19:57 | ~10 min perdidos en Docker Desktop colgado (500) hasta reiniciarlo (19:56) |
| C. Pruebas I-1..R-3 | 19:57–20:00 | `test:ci` 25/25 |
| D. Prueba en frío | 20:00–20:01 | 5 rupturas, todas detectadas |
| E. Workflow | 20:01–20:03 | actionlint sin errores; push 20:02:13; verde 20:03:51 |
| F. Demo en CI | 20:04–20:09 | 3 corridas |
| G. Documentación | 20:09– | docs/tarea5_pruebas.md y correcciones a la auditoría |

## Problemas y soluciones (implementación)
1. `git fetch` "Repository not found" por cuenta de `gh` sin acceso → el usuario cambió de cuenta (CasUVG220, permiso WRITE); se reintentó y funcionó.
2. Node 20 no estaba instalado (host con 25) → `nvm install 20` (efecto lateral: alias default de nvm = 20).
3. Docker Desktop se colgó (HTTP 500) ~10 min tras abrirlo → se reinició la app. Al abrirlo también reinicia los contenedores de desarrollo por `restart: unless-stopped`; no se tocaron.
4. Login 401 en I-1: `normalizeEmail()` pasa a minúsculas y el seed guardaba mayúsculas → correos del seed en minúsculas.
5. R-2: `SHOW timezone` devuelve la columna `TimeZone` → `current_setting('TimeZone')`.
6. R-3: tras suspender, refresh da 401 y no 423 (los refresh ya están revocados) → la prueba afirma 401. También hay un `sleep(1100)` por la resolución de segundos del `iat` (utils/revocacion.ts).
7. El enunciado decía "sin licencia → 403": el código responde 401 en `/sync/garita` y permite `/accesos` sin licencia (web); las pruebas afirman lo real.
8. Break de R-1: hay que quitar también `ownershipParams` o sale 500 en vez de 200.
9. Un `git push` falló una vez por red ("Could not resolve host"); se reintentó con el mismo comando explícito.
10. Aviso no crítico del CI: Node.js 20 deprecado en las acciones v4 (corren forzadas en Node 24) y `ubuntu-latest` migrará a Ubuntu 26 el 19-oct-2026.
