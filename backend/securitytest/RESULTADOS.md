# Resultados — Pruebas de seguridad (Sprint 8)

Ambiente: **solo local** (`docker-compose.yml`): backend Node 20 + PostgreSQL 15.18 en contenedores,
sobre la misma máquina. No se tocó la VM de GCP ni Cloud SQL (el propio código de las pruebas se
niega a apuntar a un host que no sea `localhost`/`127.0.0.1`/`host.docker.internal`, y `stack.sh`
aborta si `DATABASE_URL` está definido en el shell).

Fecha de ejecución: 2026-09-29. Guía UVG CC3091: *«realice pruebas de seguridad, explique qué
herramienta usó, comunique resultados y cómo va a solventar los problemas»*.

**Resumen:** 18 hallazgos — **0 críticos, 1 alto (condicional), 2 medios, 13 bajos, 2 informativos**.
Se corrigieron 9 (8 completos y 1 parcial), cada uno con test y con la prueba que lo detectó
repetida. Los otros 9 quedan en `backend/DEUDA_TECNICA.md`. En las tablas de la sección 4 está el
detalle.

## 1. Herramientas usadas

| Herramienta | Versión | Para qué | Por qué esta |
|---|---|---|---|
| **OWASP ZAP** (`zaproxy/zap-stable`) | 2.17.0 | Baseline pasivo y **escaneo activo autenticado, un JWT por rol** (owner, admin_empresa, admin_sucursal, agente, residente) con el Automation Framework | Estándar abierto de DAST; el Automation Framework deja el plan versionado (`zap/plan-active.yaml`) y permite inyectar el `Authorization` de cada rol |
| **sqlmap** | 1.10.9 | Inyección SQL automatizada sobre 5 endpoints con parámetros de búsqueda (7 parámetros) | Referencia para SQLi; complementa los payloads manuales |
| **Scripts propios en Node** (`backend/securitytest/*.js`) | Node 25 (host) | Todo lo que ZAP no entiende: IDOR entre empresas, escalación de roles, JWT, invitaciones, suspensión, rate limit real, payloads SQLi, headers/CORS/errores | Cada comprobación guarda *request, esperado y real* en JSON; se pueden repetir tras el fix (`npm run securitytest`) |
| **npm audit** | npm 11.11 | Dependencias de `backend`, `frontend`, `desktop` | Viene con npm |
| **cargo audit** | 0.22.2 (1 277 avisos RustSec) | `desktop/src-tauri/Cargo.lock` (528 crates) | Base RustSec oficial |
| **gitleaks** | 8.30.1 (`--redact`) | Secretos en los 120 commits del historial | Detección por reglas + entropía; `--redact` para que ningún secreto llegue al reporte |
| **Artillery** | 2.0.34 | Volumen de los endpoints nuevos del Sprint 8 (sección 7 del reporte de carga) | La misma herramienta del Sprint 7 |

Cómo se hicieron los inventarios: `gen-openapi.js` recorre las **rutas reales registradas en el router de
Express** (misma técnica que `security.routes.contract.test.ts`) y genera `zap/openapi.json` con
**125 operaciones en 95 rutas**, con ejemplos que apuntan a los datos sembrados. Así ZAP ataca lo que el
código expone y no una lista escrita a mano.

## 2. Alcance, ajustes y limitaciones

**Datos de prueba** (`seed.js`, idempotente): 2 empresas (**A** con 2 sucursales, **B** con 1) más una
empresa sacrificial para ZAP, un usuario de cada rol en cada una (11 usuarios + 1 cobaya), y datos en cada
sucursal: residente, registro de acceso, pago, ticket con mensaje, anuncio, preautorización, invitación
QR, área, reserva, cargos y lista negra; licencias de garita activadas e invitaciones administrativas
creadas por la API. Instantáneas de la base (`snapshot.sh`) restauran el estado entre suites
destructivas; al terminar se restauró la instantánea `pristine` (la base local tal como estaba antes de las pruebas).

**Rate limiting — cómo se cumplió la regla.** Las pruebas de rate limit (`09-ratelimit.js`) y todas las
manuales corrieron con los límites de producción (`RATE_LIMIT_LOGIN_MAX=20`, `RATE_LIMIT_GENERAL_MAX=1000`;
son los valores por defecto del código, que es lo que usa `docker-compose.prod.yml`). Como el contador vive en
memoria, las suites largas ponen el contador a cero **reiniciando el contenedor** (mismo secreto y mismos
límites) cada ~850 peticiones, en vez de relajar la configuración. Solo el escaneo ZAP usó los
overrides (`./stack.sh zap`) y se restauraron al terminar (verificado con `printenv`: 20 / 1000).
Nota: `docker-compose.yml` trae `RATE_LIMIT_LOGIN_MAX` por defecto en **10**, distinto del 20 del código;
las pruebas se hicieron con 20 explícito, que es el de producción.

**Modo producción.** Para lo que depende de `NODE_ENV` (CORS con allowlist, cookie `Secure`, cuentas demo)
se construyó y levantó la imagen real `--target prod` (`prodmode.sh`) en `:3100`, con su propia base
(`securegate_prodtest`) dentro del Postgres local. Esa imagen **sí construye** (el informe de
septiembre decía que no se había podido).

**Limitaciones que conviene leer:**
- **Cobertura de ZAP reducida en endpoints con limitador propio.** El compose solo pasa al contenedor
  los dos overrides autorizados; `activar`, `heartbeat`, invitaciones públicas, OCR y `eliminar-definitivo`
  siguieron con su límite de producción durante ZAP y respondieron 429 a partir de cierto punto. Esos
  endpoints se cubrieron con las suites manuales (04, 05, 07, 09).
- El **baseline de ZAP** aporta poco en una API JSON: su spider no encuentra enlaces (la raíz responde 404) y solo
  analiza 3 URLs de forma pasiva. El valor está en el escaneo activo con OpenAPI.
- Cada escaneo activo estaba acotado a 12 min y **terminó solo en ~3,5 min por rol**: agotó las 125 operaciones.
- Tras los arreglos, ZAP se repitió solo para el baseline y el rol **owner** (la superficie más grande); los otros
  4 roles quedan como «antes» en `results/antes/`.
- El frontend no se probó dinámicamente (solo se revisó la configuración de nginx). La app de escritorio
  (Tauri) tampoco: solo `cargo audit`/`npm audit`.
- Los tokens «vencido», «firma alterada» y `alg:none` se fabrican leyendo el `JWT_SECRET` del contenedor local
  (nunca se imprime ni se guarda); es el método normal para probar que el servidor los rechaza.
- **No se reprodujeron** localmente los avisos de Vite del frontend; se documentan solo con lo que reporta `npm audit`.
- No se verificó qué compose corre la VM (no se contactó). Esto pesa en S-13 y S-12.

## 3. Resultados por prueba

Totales de las suites propias: **1 517 comprobaciones antes de los arreglos (487 anomalías) y 1 055 después
(5 anomalías)**. Casi todo el descenso es S-03: 462 de las 487 eran 500 por entradas mal formadas. El
número baja porque la suite SQLi solo registra las anomalías (1 814 peticiones enviadas en ambas corridas).

| Suite | Pruebas | Antes: fallas | Después: fallas | Qué queda |
|---|---|---|---|---|
| 01 IDOR | 648 | 7 | **0** | — |
| 02 Roles y mass assignment | 192 | 0 | 0 | — |
| 03 JWT y sesiones | 42 | 1 | 1 | S-06 (deuda) |
| 04 Invitaciones | 32 | 2 | **0** | — |
| 05 `eliminar-definitivo` | 20 | 2 | **0** | — |
| 06 Empresa suspendida | 30 | 4 | 4 | S-11 (deuda) |
| 07 SQL injection | 1 814 peticiones | 462 | **0** | — |
| 08 Headers, CORS, errores | 69 | 9 | **0** | — |
| 09 Rate limit real | 18 | 0 | 0 | — |

### a) ZAP baseline (`zap-baseline.*`)
Antes: 64 reglas pasan, **3 avisos**: Storable and Cacheable Content (10049), CSP: Failure to Define Directive
with No Fallback (10055), Permissions Policy Header Not Set (10063). Después: 66 pasan y **1 aviso
informativo** (10049 «Non-Storable Content»: es la consecuencia deseada de `no-store`). 0 FAIL en ambas.

### b) ZAP activo autenticado por rol (`zap-active-<rol>.*`, `results/antes/`)

| Alerta ZAP | owner | adminEmpA | adminSucA1 | agenteA1 | resA1 | Veredicto |
|---|---|---|---|---|---|---|
| Path Traversal (High, confianza Low) | 3 | 2 | 2 | 2 | 3 | **Falso positivo** (ver abajo) |
| Format String Error (Medium) | 13 | 7 | 15 | — | 6 | Falso positivo de ZAP, pero destapó S-03 |
| XSS persistente en respuesta JSON (Low) | 7 | 2 | 9 | 1 | 13 | Informativo (S-16) |
| Authentication Request / Session Mgmt / User Agent Fuzzer | 3/1/3 | 3/1/3 | 3/1/3 | 3/1/3 | 3/1/3 | Informativas |

- **Path Traversal:** ZAP sustituye el valor de un campo por el último segmento de la ruta (`empresas`,
  `accesos`) y marca «alta» sin evidencia. Comprobado a mano: `POST /api/empresas {"nit":"empresas"}` → 201 y el
  texto se guarda tal cual; no hay acceso a archivos.
- **Format String Error:** la «evidencia» es «el script cerró la conexión». Con el payload de ZAP el backend
  respondía **500** porque `nombre` (VARCHAR 150) y `nit` (VARCHAR 20) recibían más texto del permitido
  (SQLSTATE 22001). No hay format strings en JavaScript; sí un 500 evitable → S-03. Después del fix: 0 alertas.

Después de los arreglos (owner): Format String 13 → **0**; el resto igual.

### c) IDOR entre empresas y sucursales (`01-idor`)
Con el token de la empresa **A** (admin_empresa, admin_sucursal, agente, residente) sobre objetos de la empresa
**B**, y con los roles de la sucursal A1 sobre la **A2** (misma empresa). **92 peticiones por actor y objetivo
(40 lecturas + 52 escrituras)** sobre: residentes, registros_acceso, pagos, licencias_dispositivo,
invitaciones, empresas, sucursales, tickets, anuncios, preautorizaciones, QR, y además áreas, reservas,
cargos, lista negra, usuarios, reportes y configuración. 4 controles positivos (el dueño legítimo SÍ accede).
- **Lecturas:** la respuesta no debe contener ningún dato del objetivo (ids, nombres, correos).
- **Escrituras:** se toma un md5 de todas las filas del objetivo antes y después; no debe cambiar.

Resultado: **7 fallas → 2 hallazgos reales** (S-04, S-05; ver sección 4), 0 después. Todo lo demás
(las 92 peticiones × 7 combinaciones actor/objetivo) resistió, incluidas las creaciones con `sucursal_id`/`empresa_id`
ajenos en el body y `?sucursal_id=` en las listas.

### d) Escalación de roles y mass assignment (`02-roles`)
**184 llamadas** de roles inferiores a **83 endpoints** que exigen owner, admin_empresa, admin_sucursal o
personal: todas 403 antes del controlador. Mass assignment (8 pruebas): un admin de sucursal/empresa no puede
crear un `owner` ni un `admin_empresa` por `POST /usuarios`; `PUT /usuarios/me/preferencias` con
`{"rol":"owner","empresa_id":…}` no cambia el rol; `PUT /residentes/:id` con otra `sucursal_id`/`usuario_id` no
traslada al residente; el login ignora `rol`/`empresa_id` del body; el número de owners en la BD no cambió.
**0 fallas.**

### e) JWT (`03-jwt`)
| Prueba | Resultado |
|---|---|
| Token de **licencia** como token de usuario (5 rutas) | 403 en las 5 |
| Token de **usuario** como token de licencia (heartbeat, sync, accesos) | 403 en las 3 |
| Agente de A1 con licencia de B1 (sync, accesos) | 403; control con su propia licencia: 200 |
| Token vencido (usuario, owner, licencia) y `nbf` futuro | 403 |
| Firma alterada, firma vacía, payload cambiado a owner, secreto ajeno, secretos históricos del repo | 403 |
| `alg:none` (4 variantes), `RS256` con firma HMAC, `jku/kid` embebidos, HS512 con el secreto real | 403 (solo HS256) |
| Rol desconocido / sin rol / token en la URL / cabecera de 20 KB | 403 / 403 / 401 / 4xx |
| TTL del access token | 3 600 s; claims: id, nombre, email, rol, sucursal_id, empresa_id, iat, exp |
| Revocación al dar de baja a un usuario | token, refresh y login mueren al instante (401) |
| Rotación del refresh token | el anterior queda inválido (401) |
| **Detección de reutilización del refresh** | **No existe** (S-06) |
| Cookie de refresh en desarrollo / en producción | HttpOnly + SameSite=Strict / además `Secure` |

### f) Rate limit real, con los límites de producción (`09-ratelimit`)
| Límite | Petición que lo agota | Resultado |
|---|---|---|
| `/licencias/activar` 10 / 15 min por IP | 13 códigos inválidos | 404 ×10 y **429 desde el 11**; cabeceras `ratelimit-limit=10`, `retry-after=900` |
| ídem, rotando `X-Forwarded-For` | 5 más | 429 ×5 (no se evade; `trust proxy` = 0) |
| `/auth/login` por cuenta (10 fallos) | 12 contraseñas malas a una cuenta | 401 ×10 y **429 desde el 11**; también con el correo en MAYÚSCULAS |
| `/auth/login` por IP (20 fallos) | 22 cuentas distintas (password spraying) | 401 ×20 y **429 desde el 21**; XFF falso no evade |
| Éxitos no cuentan | 25 logins correctos | 200 ×25 |
| `/licencias/heartbeat` 60 | 62 | 403 ×60, **429 desde el 61** |
| `/auth/refresh` 120 | 122 | 401 ×120, **429 desde el 121** |
| `/ocr` 30 / min | 32 | **429 desde el 31** |
| General 1 000 / 15 min | 1 003 a `/api/status` | 200 ×1 000, **429 desde el 1 001**; `/health` exento |

Efectos secundarios de diseño, medidos: con el cupo agotado, un código **válido** o el titular con la
**contraseña correcta** también reciben 429 (S-10).

### g) Invitaciones (`04-invitaciones`)
Reuso (2.º `aceptar`) → **409**; vencida → **410** (tras S-02); revocada o usada → **409**; reenviar invalida el
token anterior (404); tres aceptaciones simultáneas → un solo 200 y un solo usuario (`FOR UPDATE`); política de
contraseña (corta, común, sin números, >72 bytes) → 422; mass assignment al aceptar (`rol:"owner"`) ignorado;
quién puede invitar (admin_empresa a otro admin_empresa, a una sucursal de B, `rol_invitado:"owner"`) → 403/422.
**Fuerza bruta del token:** 40 tokens aleatorios de 256 bits → 404 ×30 y 429 desde el 31 (límite público de
30 / 15 min por IP, compartido con `aceptar`); espacio de búsqueda 2²⁵⁶. Entradas hostiles en el token
(SQLi, traversal, 5 000 caracteres, NUL, XSS) → 4xx.

### h) `eliminar-definitivo` con contraseña incorrecta (`05-eliminar`)
Sobre una empresa desechable: **5 intentos → 403 y el 6.º → 429**; la empresa sigue existiendo. `audit_logs`:
5 filas con `status_code = 403`, `usuario_id` del owner, IP y `registro_id` = la empresa; **la contraseña
intentada no se guarda** (0 filas con el texto). Sin contraseña → 400; contraseña de *otro* owner → 403;
`password` como objeto → 4xx sin borrar. Contraseña correcta → 200 y fila en auditoría con 200.
Hallazgos: S-07 (límite por IP y 429 sin auditar) y un 500 con `id` no UUID (S-03).

### i) Empresa suspendida (`06-suspension`)
Empresa con los 4 roles + licencia activada. Suspendida: **login → 423** (los 4 roles, con `codigo`, `motivo`);
**heartbeat → 423**; activar un código nuevo → 423; `sync/garita` y `POST /accesos` → 401/403/423;
**access tokens vivos → 401** («Sesión revocada»); contraseña equivocada → **401 (no 423)**, o sea que no revela
el estado de la empresa; el owner y las demás empresas no se ven afectados. Reactivada: login y la misma
licencia vuelven a funcionar. Dada de baja (`DELETE`): login y heartbeat denegados.
**Refresh → 401, no 423** para sesiones abiertas antes de suspender (suspender revoca los refresh tokens): el acceso se
corta, pero difiere del contrato documentado (S-11). La rama 423 de `/auth/refresh` sí funciona cuando el token sigue vigente
(comprobado suspendiendo directamente en la BD).

### j) SQL injection (`07-sqli` + sqlmap)
**Payloads manuales:** 1 814 peticiones sobre **67 puntos de inyección**: 30 parámetros de búsqueda/filtro (`dpi`,
`q`, `placa`, `desde/hasta`, `accion`, `estado`, `area_id`…), 11 parámetros de ruta y 26 cuerpos JSON (cada campo de
texto uno a uno), más 3 intentos de bypass del login. 16 payloads: comilla simple y doble, `' OR '1'='1`, `UNION SELECT`, `ORDER BY 100`,
`pg_sleep(3)` en 4 formas, `UPDATE empresas…`, `DROP TABLE st_canary`, `%`, NUL. Se buscó: error (5xx o texto de
PostgreSQL), tiempo (≥ 2,5 s), booleano (resultado distinto de una búsqueda sin coincidencias) y apilado
(tabla canario).
**Resultado: 0 inyecciones.** Ningún retardo, ningún texto de SQL en respuestas, canario intacto, ningún cambio
booleano; el login con `' OR '1'='1` da 401. Lo que sí hubo fueron **462 respuestas 500** por entradas mal
formadas (UUID/fecha inválidos, NUL, textos largos), todas con el mismo origen → S-03.
Revisión estática: el SQL dinámico solo interpola fragmentos internos (condiciones de tenant con `$n`); toda
entrada del usuario va parametrizada.
**sqlmap** (nivel 2, riesgo 1, técnicas B/E/U/S/T, PostgreSQL): `visitantes?dpi`, `visitantes/buscar?q`,
`preautorizaciones/buscar?dpi,placa`, `audit-logs?accion,usuario_id`, `reservas?estado` →
**«all tested parameters do not appear to be injectable»** en los 5 objetivos (7 parámetros).

### k) Headers, CORS, cookies y errores (`08-headers`)
| Comprobación | Desarrollo (:3000) | Producción (:3100) |
|---|---|---|
| CSP `default-src 'none'; frame-ancestors 'none'`, `nosniff`, HSTS ≥ 180 d, `X-Frame-Options`, `Referrer-Policy`, CORP, COOP | ✅ | ✅ |
| Sin `X-Powered-By` / `Server` | ✅ | ✅ |
| `Cache-Control: no-store` en login y datos personales | ❌ → ✅ (S-08) | ✅ |
| CORS con origen ajeno, sufijo, hermano, `http://`, `null`, mayúsculas | se refleja **en desarrollo** (documentado) | **ninguno** se refleja; solo el permitido, con `credentials` |
| Cookie de refresh | HttpOnly + SameSite=Strict | + `Secure` |
| Cuentas demo (`admin@securegate.com`/`admin123`) | activas (es el compose de desarrollo) | **desactivadas al arrancar** (401) |
| JSON malformado / body de 150 KB / 40 000 niveles de anidamiento | 400 / 413 / 4xx, sin stack | ídem |
| `.env`, `package.json`, `src/`, `.git/config`, `/api/../.env`, TRACE | 404 | 404 |
| Ruta inexistente | ❌ HTML «Cannot GET» → ✅ JSON (S-09) | ídem |
| `?dpi=a&dpi=b` y `?dpi[x]=1` | ❌ 500 → ✅ 400 (S-03) | ídem |
| Login: mismo mensaje con correo existente e inexistente | ✅ | ✅ |
| **Login: tiempo con correo existente vs inexistente** | ❌ **190 ms vs 2 ms** → ✅ **203 vs 199 ms** (S-01) | — |

Además, revisión estática de `nginx/nginx.conf`: `X-Forwarded-For` se **sobrescribe** con `$remote_addr`
(por eso el rate limit por IP no se evade en el despliegue con nginx), HSTS 2 años, CSP completa, TLS 1.2/1.3.

### l) Dependencias y secretos (`npm-audit-*`, `cargo-audit.*`, `gitleaks-historial.json`)
| Paquete | Antes | Después |
|---|---|---|
| `backend` (npm) | 4 moderadas (`node-cron`→`uuid`, `artillery`→`csv-parse`) | igual (S-14) |
| `frontend` (npm) | **14: 7 altas**, 5 moderadas, 2 bajas | **3 moderadas** (S-13) |
| `desktop` (npm) | 0 | 0 |
| `desktop/src-tauri` (cargo, 528 crates) | 0 vulnerabilidades, 7 avisos (6 sin mantenimiento, 1 de solidez) | igual (S-15) |
| gitleaks (120 commits) | 2 hallazgos | **falso positivo**: un token de prueba en `AceptarInvitacionPage.test.tsx:23` (2 commits) |

`.env.cloudsql` está en `.gitignore` y nunca entró al historial. gitleaks no ve secretos de baja entropía:
buscando los valores públicos conocidos con `git log -S`, `securegate_jwt_secret_dev` aparece en 4 commits,
`sgpassword123` en 6, `admin123` en 7 y `change_me_in_production` en 3 (desde marzo de 2026) → S-12.

## 4. Hallazgos

Severidad según el impacto real en este sistema (no la etiqueta de la herramienta).

| ID | Sev. | Hallazgo | Detectado por | Estado |
|---|---|---|---|---|
| S-13 | **Alta** (condicional) | Frontend: 14 vulnerabilidades npm, 7 altas (vite, postcss, undici, js-yaml, nanoid, brace-expansion, browserslist). | `npm audit` | ✅ 11 de 14 corregidas; quedan 3 moderadas |
| S-01 | **Media** | Enumeración de cuentas por tiempo de respuesta del login. | `08` | ✅ Corregido |
| S-12 | **Media** | Secretos públicos antiguos (JWT de desarrollo, contraseñas demo) siguen en el historial de git. | `git log -S` | ⏳ Acción manual (deuda) |
| S-02 | Baja | Una invitación vencida se sigue aceptando hasta 6 h después. | `04` | ✅ Corregido |
| S-03 | Baja | 500 en vez de 400 ante UUID/fecha inválidos, NUL, textos largos y parámetros repetidos. | `07`, `05`, `08`, ZAP | ✅ Corregido |
| S-04 | Baja | `GET /reservas/disponibilidad` muestra áreas y horarios de otra empresa a cualquier personal. | `01` | ✅ Corregido |
| S-05 | Baja | `POST /anuncios/:id/leer` deja a un residente escribir sobre un anuncio de otra empresa. | `01` | ✅ Corregido |
| S-06 | Baja | El refresh token no detecta reutilización. | `03` | ⏳ Deuda |
| S-07 | Baja | `eliminar-definitivo`: límite por IP y los intentos bloqueados no se auditan. | `05` | ✅ Corregido |
| S-08 | Baja | Respuestas con datos personales y el JWT sin `Cache-Control: no-store`. | `08`, ZAP 10049 | ✅ Corregido |
| S-09 | Baja | 404 HTML de Express que además pisa el CSP; `Permissions-Policy` ausente. | `08`, ZAP 10055/10063 | ✅ Corregido |
| S-10 | Baja | Bloqueo de login por cuenta: cualquiera que conozca el correo deja sin acceso al titular 15 min. | `09` | ⏳ Deuda (trade-off) |
| S-11 | Baja | Sesión abierta + empresa suspendida: `/auth/refresh` responde 401, no 423. | `06` | ⏳ Deuda (comentario corregido) |
| S-14 | Baja | Backend: 4 avisos npm moderados (sin ruta explotable / solo dev). | `npm audit` | ⏳ Deuda |
| S-15 | Baja | Rust: 7 crates sin mantenimiento (transitivos de Tauri). | `cargo audit` | ⏳ Deuda |
| S-17 | Baja | Desfase de 6 h en `TIMESTAMP` sin zona (raíz de S-02): `refresh_tokens` dura 6 d 18 h, no 7 d. | `04` + verificación en BD | ⏳ Deuda |
| S-16 | Info | ZAP: «XSS persistente en JSON» (no explotable en la API). | ZAP | ⏳ Sin acción en backend |
| S-18 | Info | `/health` muestra nombre y versión del servicio. | `08` | Aceptado |

**Falsos positivos descartados:** ZAP «Path Traversal» (×3 por rol, comprobado a mano) y «Format String Error»;
gitleaks (token de prueba). **Sin hallazgos:** inyección SQL, escalación de roles, forja de JWT, IDOR entre
empresas (fuera de S-04/S-05), suspensión, fuerza bruta del token de invitación, CORS en producción.

### Evidencia y mitigación de cada hallazgo

**S-13 — Frontend: dependencias.** `npm audit`: 14 (7 altas), entre ellas Vite (`server.fs.deny` sin efecto con
queries, lectura de archivos por WebSocket, `.map` de dependencias optimizadas) y PostCSS (lectura de `.map`
arbitrarios). Son herramientas de desarrollo: **solo son explotables si el dev server de Vite está alcanzable**, y
`scripts/deploy.sh` usa por defecto `docker-compose.yml`, que lo sirve en el puerto 5173 (el de producción,
`docker-compose.prod.yml`, sirve estáticos con nginx). *No se verificó qué corre la VM.* **Fix:** `npm audit fix`
(sin saltos mayores): 14 → 3 moderadas; 165 tests y `vite build` pasan. Recomendación: desplegar con
`COMPOSE_FILE=docker-compose.prod.yml`.

**S-01 — Enumeración por tiempo.** `POST /api/auth/login` con contraseña incorrecta, 8 intentos por grupo:
correo existente **190 ms** (mín. 183), inexistente **2 ms** (máx. 3): la comparación `crypt()` estaba dentro del
`WHERE`, y sin fila no corría bcrypt. El mensaje 401 ya era idéntico. **Fix** (`auth.controller.ts`): se busca la
cuenta y se ejecuta **siempre un `crypt()`**, contra el hash real o contra un hash señuelo bcrypt de costo 12.
Después: **203 ms vs 199 ms**. Tests: `auth.login.timing.test.ts` (4).

**S-12 — Secretos históricos.** `securegate_jwt_secret_dev` (4 commits), `sgpassword123` (6), `admin123` (7),
`change_me_in_production` (3). Con el JWT de desarrollo se fabrica un token de owner **si producción aún lo usa**;
el informe de septiembre ya marcaba rotarlo como acción manual. No verificable desde el entorno local.
**Acción:** confirmar que `JWT_SECRET` y la contraseña de Cloud SQL son otros y rotarlos si no. Las cuentas demo
ya se desactivan solas en producción (verificado).

**S-02 — Invitación vencida sigue viva.** Invitación con `expira_en = NOW() - 1 min`:
`GET /api/invitaciones/:token` → **200** (esperado 410); `POST …/aceptar` → **200 y se crea el usuario**
(esperado 410). Causa: el backend corre con `TZ=America/Guatemala` y Postgres en UTC; `pg` lee el `TIMESTAMP` sin zona como
hora local, o sea 6 h en el futuro (`new Date` = 05:03Z con ahora = 23:04Z), y la caducidad se comparaba en
JS: vigencia real de 78 h en vez de 72. Con 7 h de vencida sí daba 410. Es un token de 256 bits y un solo uso,
de ahí la severidad. **Fix** (`invitaciones.controller.ts`): la vigencia la calcula Postgres
(`expira_en <= NOW() AS vencida`) y la fecha mostrada se convierte desde UTC. Test: `invitaciones.expiracion.test.ts`.

**S-03 — 500 ante datos inválidos.** 462 de las 1 814 peticiones de la suite SQLi, las 13 alertas «Format String» de ZAP (owner) y varias pruebas
más (`ELIM-id-no-uuid`, `ERR-*-hpp-*`) devolvían HTTP 500 con «Error en el servidor»: UUID o fecha inválidos (22P02,
22007), NUL (22021), texto más largo que el `VARCHAR` (22001), valores fuera de un `CHECK` (23514), y
`?dpi=a&dpi=b` (el arreglo llegaba a `.trim()`). No filtran internos, pero inflan los logs, disparan falsas
alarmas de disponibilidad y confunden al cliente. **Fix:** `serverError` (`utils/http.ts`, lo usan ~115 handlers)
mapea la clase 22 y 23502/23503/23514 a **400** y 23505 a **409**; el manejador central hace lo mismo; el
middleware `soloQueryTexto` rechaza parámetros repetidos o anidados con 400. Después: **462 → 0** en la suite y
Format String de ZAP **13 → 0**. Tests: `security.hardening.sprint8.test.ts`.

**S-04 — Áreas de otra empresa.** `GET /api/reservas/disponibilidad?area_id=<área de B>&fecha=2030-01-01` con el
token de un admin de empresa A, de un admin de sucursal A1 y de un agente A1 → **200**
`{"area":{"nombre":"ST-area-B1","tarifa_tipo":"gratis",…},"ocupados":[…]}`. El control de alcance solo existía
para residentes. **Fix** (`reservas.controller.ts`): el personal debe tener el área en su alcance
(`ownershipClause`); después → **403**. Tests: `security.aislamiento.hallazgos.test.ts`.

**S-05 — Escritura cruzada en anuncios.** `POST /api/anuncios/<anuncio de B>/leer` con un residente de A →
**200** `{"leido":true}` y una fila nueva en `anuncio_lecturas` (infla el contador de lecturas del admin de B y
confirma que el id existe). **Fix** (`anuncios.controller.ts`): la lectura solo se inserta si el anuncio es de la
sucursal del residente y no va dirigido a otro; después → **404**. Tests: mismo archivo.

**S-06 — Refresh sin detección de reutilización.** Reusar el refresh ya rotado → 401 (correcto), pero el refresh
**nuevo sigue vivo**: un refresh robado y usado primero deja al atacante con sesión. Conocido (M6 de
`SECURITY_REVIEW.md`). No se arregló: requiere `revoked_at` y una ventana de gracia para no cerrar la sesión a
quien renueva desde dos pestañas (ver `DEUDA_TECNICA.md`).

**S-07 — `eliminar-definitivo`.** 7 intentos con contraseña mala: 403 ×5, 429 ×2. Filas en `audit_logs`: 5 (403) y
**0 de los 2 bloqueados** (el limitador corre antes que `auditLog`). Un segundo owner desde la misma IP recibía
429 (límite **por IP**): con un JWT de owner robado se obtienen 5 intentos de contraseña **por cada IP distinta**,
y un tercero en la IP del owner le agota el cupo. **Fix** (`empresas.routes.ts`, `audit.middleware.ts`): cupo
**por usuario** y los 429 quedan auditados. Después: 2 de 2 filas con 429 y el segundo owner recibe 403.
Tests: `security.hardening.sprint8.test.ts` (3).

**S-08 — Sin `Cache-Control`.** `POST /api/auth/login` (devuelve el JWT) y `GET /api/residentes/me`: solo `ETag`, sin
`Cache-Control` (ZAP 10049). **Fix:** `Cache-Control: no-store` y `Pragma: no-cache` en toda respuesta
(`hardening.middleware.ts`). Tests: 1.

**S-09 — 404 de Express.** `GET /api/no-existe` devolvía `<pre>Cannot GET /api/no-existe</pre>` y ese manejador
sustituye el CSP de helmet por `default-src 'none'` solo (ZAP 10055); sin `Permissions-Policy` (10063).
**Fix:** 404 en JSON (`No encontrado`) y `Permissions-Policy` restrictiva. Tests: 3.

**S-10 — Bloqueo por cuenta.** Con 10 fallos contra un correo, el titular con la **contraseña correcta** también recibe
429 durante 15 min. Sin límite por cuenta se pierde la defensa contra fuerza bruta distribuida, y las
alternativas cambian la política de seguridad → deuda.

**S-11 — Refresh 401 vs 423.** Sesiones abiertas antes de suspender: `/auth/refresh` → 401 porque suspender
revoca los refresh tokens; el contrato documentado decía 423. El acceso se corta correctamente; solo se pierde
el motivo hasta el siguiente login. Se corrigió el comentario del código; el cambio de comportamiento
requiere tocar frontend y desktop → deuda.

**S-14, S-15, S-16, S-17, S-18:** ver `backend/DEUDA_TECNICA.md`.

## 5. Mitigaciones priorizadas

1. **Confirmar la rotación de secretos en producción (S-12)** — 1 h, acción manual, la única con riesgo de toma de
   control si falla. Verificar también qué compose corre la VM (S-13): debe ser `docker-compose.prod.yml`.
2. **Desplegar el fix de login (S-01)**: cierra la enumeración de cuentas, la base de cualquier ataque
   dirigido (relacionado con S-10).
3. **Aplicar `npm audit fix` en frontend (S-13)** — hecho; falta subir `vitest` de versión mayor.
4. **Cerrar los cruces de tenant (S-04, S-05)** — hecho; sugerencia: añadir la comprobación de alcance a la
   plantilla de controladores nuevos, porque los guards de rol no la cubren.
5. **Errores 4xx correctos (S-03), caducidad en SQL (S-02), límite por usuario en la acción más destructiva
   (S-07), cabeceras y 404 (S-08, S-09)** — hecho.
6. **Deuda con esfuerzo medio:** detección de reutilización del refresh (S-06, ~1 día), zona horaria de los
   `TIMESTAMP` (S-17, ~1 día), bloqueo de login menos abusable (S-10, ~2 días).
7. **Mantenimiento:** `node-cron` 4.x (S-14), actualizar Tauri (S-15).

## 6. Resultado después del fix

Mismo ambiente, misma base sembrada, mismos límites de producción. `backend`: **594 tests** (antes 559: +35 nuevos,
0 rotos; los 10 que fallaron al cambiar el login se actualizaron porque mockeaban la consulta antigua),
`tsc --noEmit` limpio; `frontend`: 165 tests y build.

| Hallazgo | Prueba que lo detectó | Antes | Después |
|---|---|---|---|
| S-01 | `AUTH-timing-enumeracion` | 190 ms vs 2 ms | **203 ms vs 199 ms** |
| S-02 | `INV-expirada-consulta` / `-aceptar` | 200 / 200 (usuario creado) | **410 / 410** |
| S-03 | 462 peticiones de `07-sqli`; ZAP «Format String» | 462 × 500; 13 alertas (owner) | **0 × 500; 0 alertas** |
| S-03 | `ERR-dev-hpp-array` / `ELIM-id-no-uuid` | 500 / 500 | **400 / 400** |
| S-04 | `IDOR-*-GET-reservas-disponibilidad` (5) | 200 con datos ajenos | **403** |
| S-05 | `IDOR-*-resA1-POST-anuncios-leer` (2) | 200, fila creada | **404** |
| S-07 | `ELIM-audit-bloqueados-por-limitador` | 0 de 2 en `audit_logs` | **2 de 2 (status 429)** |
| S-07 | `ELIM-limite-por-ip` | 2.º owner: 429 | **403 (cupo por usuario)** |
| S-08 | `HDR-cache-control-*` | ausente | **`no-store`** |
| S-09 | `ERR-*-ruta-inexistente`; ZAP 10055 y 10063 | HTML «Cannot GET»; 2 avisos | **JSON 404; 0 avisos** |
| S-13 | `npm audit` frontend | 14 (7 altas) | **3 moderadas** |
| — | ZAP baseline | 64 pasan / 3 avisos | **66 pasan / 1 informativo** |
| — | Suite completa 01–09 | 487 anomalías | **5** (S-06 ×1, S-11 ×4: deuda) |

Regresiones descartadas: IDOR 648/0, roles 192/0, rate limit 18/0, headers 69/0; el ZAP activo del owner sigue
sin altas ni medias reales.

## 7. Volumen de los endpoints nuevos del Sprint 8

Ver `backend/loadtest/RESULTADOS.md` (Artillery sobre `/licencias/activar`, `/licencias/heartbeat`,
`/sync/garita` y `POST /accesos` con `id_cliente`, con el pool en `max: 20`, más muestreo de CPU, memoria y conexiones).

## 8. Archivos generados

`backend/securitytest/`
- `01-idor.js` … `09-ratelimit.js` — las 9 suites; `lib.js` (cliente HTTP con guarda «solo local»), `seed.js`,
  `snapshot.sh`, `stack.sh`, `prodmode.sh`, `gen-openapi.js`, `run-zap.sh`, `run-sqlmap.sh`, `run-deps.sh`,
  `redactar.js`, `resumen.js`, `run-all.js` (`npm run securitytest` desde `backend/`).
- `zap/openapi.json` (125 operaciones), `zap/routes.json`, `zap/plan-active.yaml`.
- `results/01-idor.json` … `09-ratelimit.json` (+ `.log`) — request, esperado y real de cada prueba.
- `results/zap-baseline.{html,json,md}`, `results/zap-active-owner.{html,json}` (después del fix).
- `results/antes/` — todas las suites, el baseline y los 5 escaneos activos ZAP **antes** de los arreglos, y las
  auditorías npm previas.
- `results/npm-audit-{backend,frontend,desktop}.json`, `results/cargo-audit.{json,txt}`, `results/gitleaks-historial.json`
  (redactado), `results/sqlmap/*.log`.
- Los JWT y cabeceras `Authorization` se eliminan de todos los artefactos con `redactar.js`.

Otros archivos: `backend/DEUDA_TECNICA.md`; tests nuevos en `backend/src/__tests__/`
(`auth.login.timing`, `invitaciones.expiracion`, `security.aislamiento.hallazgos`, `security.hardening.sprint8`);
código: `utils/http.ts`, `middleware/hardening.middleware.ts`, `middleware/audit.middleware.ts`, `index.ts`,
`controllers/{auth,invitaciones,reservas,anuncios,empresas}.controller.ts`, `routes/empresas.routes.ts`,
`frontend/package-lock.json`.
