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
