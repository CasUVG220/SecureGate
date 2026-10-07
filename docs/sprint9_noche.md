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
