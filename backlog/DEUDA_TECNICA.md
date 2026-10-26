# Deuda Técnica — SecureGate (Sprint 7)

> Documento de análisis y planificación. No se realizó ningún cambio de código a partir de este informe — es un registro formal de deuda técnica para el sprint académico.

## Metodología

Se auditó el repositorio completo (backend Node/TypeScript/Express + PostgreSQL, frontend React/Vite/TypeScript) mediante lectura de código, `grep` estructurado sobre `backend/src` y `frontend/src`, comparación cruzada de controllers/páginas contra archivos de test existentes, y ejecución real de `npm audit` / `npm outdated` en ambos paquetes. Todos los hallazgos citan archivo:línea verificado; no se reporta nada sin evidencia directa en el código.

---

## 1. Deuda técnica identificada

### 1.1 Migración incompleta al design system (Prioridad: **Media**)

El refactor visual sí construyó una base sólida: las clases utilitarias `sg-page`, `sg-card`, `sg-btn`, `sg-input`, `sg-tab`, `sg-status` están definidas en `frontend/src/index.css:261-420`, y `frontend/tailwind.config.ts:39-56` remapea deliberadamente `gray/blue/red/green` de Tailwind a las rampas de `frontend/src/styles/tokens.ts` (hay un comentario explícito reconociendo que es para no tener que migrar 30 pantallas a la vez). No se encontró **ningún** color hardcodeado (`#fff`, `bg-[#...]`) en páginas — ese vector de deuda no existe.

Lo que sí quedó pendiente es la adopción de los **componentes React reutilizables** (`frontend/src/components/ui/`: Button, Card, Badge, Modal, Skeleton, ErrorState, EmptyState, Table):

- **Migradas (10/28):** LoginPage, BlacklistPage, GaritaPage (parcial), ResidentesPage, PagosPage, ResidentePage, NotFoundPage, DashboardPage, TicketsPage, AnunciosPage.
- **No migradas (18/28):** AdminReservasPage, AgentesPage, AreasComunesPage, ConfigCargosPage, ConfiguracionQrPage, ConfiguracionReservasPage, PreautPage, ReportesPage, ReservasAdminPage, ReservasPage, SalidaPage, VerificacionPage, admin_empresa/AdminEmpresaDashboard, admin_empresa/GestionSucursales, owner/AuditLogsPage, owner/EmpresaDetail, owner/OwnerDashboard, owner/OwnerEmpresas.
- Casos notables: `ReportesPage.tsx` no usa ni una sola clase `sg-*` (Tailwind manual puro); `PreautPage.tsx`, `owner/AuditLogsPage.tsx`, `owner/EmpresaDetail.tsx`, `AreasComunesPage.tsx` mezclan `sg-page` con decenas de clases Tailwind manuales para tarjetas/botones que `Card`/`Button` ya resolverían.

Es deuda de **adopción**, no de arquitectura: la base del design system está bien planteada, falta terminar de aplicarla.

### 1.2 Código duplicado que sobrevivió al refactor (Prioridad: **Media**)

1. **Patrón fetch/loading/error sin hook compartido** — bloque `setLoading(true) → api().then(...).catch(...).finally(...)` repetido casi idéntico en al menos 8 archivos: `ResidentesPage.tsx:63-69`, `AreasComunesPage.tsx:53-59`, `AgentesPage.tsx:21-31`, `AdminReservasPage.tsx:49`, `BlacklistPage.tsx:43`, `PagosPage.tsx:41`, `ConfigCargosPage.tsx:88`, `admin_empresa/GestionSucursales.tsx:50`. En total, 20 usos de `setLoading(true)` y 57 bloques `catch` en el frontend.
2. **`window.confirm()` nativo en vez de `Modal`** — 15 ocurrencias en 12 archivos que rompen el tema claro/oscuro (diálogo nativo del navegador): `BlacklistPage.tsx:108`, `ResidentesPage.tsx:126`, `PreautPage.tsx:73`, `ResidentePage.tsx:189,344`, `AnunciosPage.tsx:116`, `ConfigCargosPage.tsx:173,264`, `owner/OwnerDashboard.tsx:97`, `AreasComunesPage.tsx:143`, `owner/EmpresaDetail.tsx:56`, `owner/OwnerEmpresas.tsx:154`, `admin_empresa/GestionSucursales.tsx:131,142`, `components/TicketChat.tsx`.
3. **Badges de estado reimplementados a mano** en vez de `<Badge>`/`estados.ts` (que existen justo para esto): `GaritaPage.tsx:767-771` y `owner/OwnerDashboard.tsx:197-199`, ambos con ternarios de clases Tailwind duplicando la lógica visual que `Badge` centraliza.
4. **Loading/error manual sin `Skeleton`/`ErrorState`** pese a que ambos componentes existen: `ConfiguracionReservasPage.tsx:104` y `ConfiguracionQrPage.tsx:90`, ambos con `if (loading) return <p className="text-gray-400 text-sm">{t('common.loading')}</p>`.
5. Paginación manual solo en `owner/AuditLogsPage.tsx:55` — no hay componente de paginación compartido, pero por ahora es punto único (no duplicación real todavía).

### 1.3 Tipado débil en TypeScript (Prioridad: **Baja**)

Solo **5 ocurrencias** de `any` en todo el proyecto (excluyendo tests) — disciplina de tipos genuinamente buena:
`backend/src/utils/reservas.ts:58` y `backend/src/controllers/configQr.controller.ts:23` (`rows: any[]` en la interfaz `Consultable`, resultado genérico de `pg`), y `catch (error: any)` en `backend/src/controllers/residentes.controller.ts:83,124` y `backend/src/controllers/sucursales.controller.ts:56`. No hay concentración relevante en ningún archivo.

### 1.4 Manejo de errores inconsistente entre controllers (Prioridad: **Alta**)

El patrón dominante es correcto: los 22 controllers usan `try/catch` con la forma `res.status(500).json({ error, detail: String(error) })`. Pero hay grietas reales:

- **Sin middleware de error centralizado**: `backend/src/index.ts` no registra ningún handler `(err, req, res, next)`. Express 4.18 (confirmado en `package.json`) no reenvía automáticamente rechazos de promesas — si algún `catch` se omite, la petición cuelga sin respuesta.
- **`logout` sin try/catch**: `backend/src/controllers/auth.controller.ts:148-158` traga el error en silencio con `.catch(() => {})` en vez del `500` que da el resto de handlers.
- **Status code de validación inconsistente**: `backend/src/middleware/validate.middleware.ts:29-36` devuelve `422` vía `express-validator`, pero solo se usa en 2 de ~19 archivos de rutas (`auth.routes.ts`, `residentes.routes.ts`). En los otros ~79 casos de validación manual en controllers, el mismo tipo de error semántico devuelve `400`.
- **Fuga de información en producción**: todo error 500 expone `detail: String(error)` al cliente (ej. `backend/src/controllers/accesos.controller.ts:289`), lo que puede filtrar nombres de tablas/columnas de Postgres.
- **Sin logging server-side**: ningún `catch` llama a `console.error` en los controllers. El único rastro del error es lo que se envía al cliente — si el frontend no lo muestra, se pierde para siempre; no hay forma de depurar producción desde logs.
- **Caso más grave: error real enmascarado como éxito** — `backend/src/controllers/ocr.controller.ts:123` y `:136` usan `catch {}` vacío (sin loguear nada) y responden `200 OK` con campos vacíos (`{ nombre: '', ..., error: '...' }`) en vez de un `4xx`/`5xx`. Un fallo interno del servicio OCR (API caída, timeout, credencial inválida) es indistinguible para el cliente de "el documento no se pudo leer", y no queda ningún rastro en ningún log.

### 1.5 Tests faltantes (Prioridad: **Alta**)

El proyecto tiene 112 tests de frontend (7 archivos) y 97 de backend (14 archivos), pero la cobertura por módulo/página es desigual:

**Backend — controllers sin ningún test que los ejercite (8 de 22, 36%):**
`audit.controller.ts`, `cargos_programados.controller.ts`, `dashboard.controller.ts`, `empresas.controller.ts`, `invitacionesQr.controller.ts`, `ocr.controller.ts`, `reportes.controller.ts`, `sucursales.controller.ts`.
Preocupa especialmente que `empresas` y `sucursales` son el núcleo del modelo multi-tenant, y `cargos_programados` maneja cobros automáticos — son módulos con lógica de negocio/financiera sin cobertura.

**Frontend — páginas sin test (22 de 28, 79%):**
ConfiguracionReservasPage, BlacklistPage, GaritaPage, ReportesPage, AreasComunesPage, AgentesPage, PreautPage, ConfiguracionQrPage, ConfigCargosPage, AnunciosPage, ResidentePage, NotFoundPage, ReservasAdminPage, VerificacionPage, DashboardPage, SalidaPage, TicketsPage, admin_empresa/GestionSucursales, admin_empresa/AdminEmpresaDashboard, owner/EmpresaDetail, owner/AuditLogsPage, owner/OwnerEmpresas, owner/OwnerDashboard.
Solo 5 páginas tienen test propio: LoginPage, AdminReservasPage, ResidentesPage, ReservasPage, PagosPage (más `PagoTarjeta.test.tsx` y `ThemeToggle.test.tsx`, que cubren componentes, no páginas).

**Sin tests end-to-end**: se buscó Cypress, Playwright y archivos `.e2e.*` en todo el repo — no existe ninguno. Toda la cobertura actual es unitaria/de componente; no hay ninguna prueba que valide un flujo completo (login → acción → resultado) a través de frontend y backend integrados.

### 1.6 TODO/FIXME (Prioridad: N/A — hallazgo positivo)

`grep -rn "TODO\|FIXME\|XXX\|HACK" frontend/src backend/src --include="*.ts" --include="*.tsx"` → **0 coincidencias**. No hay marcadores de deuda explícitos dejados en el código.

### 1.7 Dependencias desactualizadas o con vulnerabilidades (Prioridad: **Alta** backend / **Media** frontend)

`npm audit` real (ejecutado el 2026-09-08):

**Backend — 8 vulnerabilidades (1 low, 3 moderate, 4 high):**
- `ip-address <=10.3.0` (high) — bypass de SSRF/trust-boundary por parsing incorrecto de octetos/CIDR.
- `js-yaml 3.0.0-3.15.0` (high) — DoS por consumo cuadrático de CPU en resolución `!!omap`.
- `qs 2.2.5-6.15.3` (moderate) — DoS vía `qs.stringify`/bypass de `array-limit`.
- `uuid <11.1.1` (moderate) — falta de validación de límites de buffer; requiere `npm audit fix --force` (rompe: actualiza `node-cron` a 4.6.0).

**Frontend — 10 vulnerabilidades (2 low, 1 moderate, 7 high):**
- `postcss <=8.5.22` (high) — XSS y lectura arbitraria de archivos vía `sourceMappingURL`.
- `postcss-selector-parser 6.1.0-6.1.2` — DoS por recursión de AST.
- `undici 7.0.0-7.28.0` (high) — desincronización de respuestas, fuga de información entre usuarios, inyección CRLF, inyección de atributos de cookies.
- `vite 8.0.0-8.0.15` (high) — path traversal, bypass de `server.fs.deny`, lectura arbitraria de archivos vía WebSocket del dev server.

La mayoría (excepto `uuid`) se resuelve con `npm audit fix` sin cambios incompatibles. Nota: `vite`/`postcss` son herramientas de build/dev, no se despliegan a producción, pero sí exponen riesgo en el entorno de desarrollo.

`npm outdated` (versiones mayores por detrás, no solo parches):

**Backend:** `typescript` 5.9.3 → 7.0.2 (dos versiones mayores), `express` 4.22.1 → 5.2.1, `@types/express` 4.x → 5.0.6, `jest`/`@types/jest` 29.x → 30.x, `dotenv` 16.x → 17.4.2, `node-cron` 3.0.3 → 4.6.0, `@types/node` 20.x → 26.5.0.
**Frontend:** `tailwindcss` 3.4.19 → 4.3.3 (relevante: el design system actual depende de la config de Tailwind 3 en `tailwind.config.ts`), `typescript` 5.9.3 → 7.0.2, `eslint` 9.x → 10.10.0, `@vitest/ui` 4.x → 5.0.0.

### 1.8 Endpoints o queries sin optimizar (Prioridad: **Alta**)

No se encontraron patrones N+1 reales en los controllers (no hay `for`/`.map(async...)` con queries dentro de loops sobre resultados de listas). Los jobs (`backend/src/jobs/mora.job.ts`, `recordatoriosReservas.job.ts`) usan SQL orientado a conjuntos (`UPDATE...RETURNING`, CTEs) correctamente, y `cargos_programados.controller.ts:96-181` usa `INSERT ... SELECT` masivo en vez de loop por residente.

El problema real es de **índices faltantes**: `database/init.sql` define 26 tablas y 25 índices explícitos, pero las dos tablas de mayor volumen y frecuencia de consulta no tienen índice propio:
- `registros_acceso` (`database/init.sql:68-80`) — filtrada/joinada por `sucursal_id`, `residente_id`, `visitante_id`, `timestamp_entrada` en dashboard (`dashboard.controller.ts:36-71`), reportes (`reportes.controller.ts:14-69`) y accesos, sin índice en ninguna de esas columnas.
- `pagos` (`database/init.sql:82-96`) — filtrada por `sucursal_id`, `residente_id`, `estado`, `fecha_pago` en los 10 handlers de `pagos.controller.ts`, tampoco tiene índice propio.

Esto no es un problema hoy con poco volumen de datos, pero escalará mal a medida que crezcan los registros de acceso y pagos históricos.

### 1.9 Configuración hardcodeada que debería ser variable de entorno (Prioridad: **Media**)

`frontend/src/services/api.ts:1-30` está bien resuelto (URL base dinámica por hostname con overrides `VITE_API_PORT`/`VITE_API_URL`). El backend sí tiene hardcodeos reales:
- `backend/src/controllers/auth.controller.ts:9-10` — `REFRESH_TTL_MS` (7 días) y `ACCESS_EXPIRES` (`'1h'`) fijos en código; cambiar la política de expiración de sesión exige redeploy.
- `backend/src/index.ts:69-78` — rate limiter general (`windowMs: 15*60*1000, max: 1000`) hardcodeado.
- `backend/src/index.ts:81-82` — límite de payload `50mb` fijo en `express.json`/`urlencoded`.
- `backend/.env.example` desactualizado: solo documenta `NODE_ENV, PORT, DATABASE_URL, JWT_SECRET, ALLOWED_ORIGINS`, pero el código también lee `APP_TZ` e `INIT_SQL_PATH` sin documentar — quien clona el repo no sabe que existen sin leer el código fuente. (La llave del OCR remoto que figuraba en esta lista ya no existe: desde el Sprint 10 el OCR es 100 % local, ver `docs/ocr_local_decision.md`.)

---

## 2. Tabla de priorización consolidada

| # | Ítem | Prioridad | Riesgo si no se atiende |
|---|------|-----------|--------------------------|
| D1 | 8/22 controllers backend sin test (empresas, sucursales, dashboard, reportes, cargos_programados, audit, invitacionesQr, ocr) | **Alta** | Regresiones silenciosas en lógica multi-tenant y de cobro automático |
| D2 | 22/28 páginas frontend sin test | **Alta** | Regresiones de UI no detectadas antes de producción |
| D3 | Falta de índices en `registros_acceso` y `pagos` | **Alta** | Degradación de rendimiento a medida que crece el histórico |
| D4 | Fuga de información (`detail: String(error)` en 500s) | **Alta** | Exposición de detalles internos de Postgres a clientes |
| D5 | Sin logging server-side (`console.error` ausente) | **Alta** | Imposible depurar errores de producción |
| D5b | `ocr.controller.ts` traga excepciones (`catch {}`) y responde `200` en vez de error | **Alta** | Fallos reales del servicio OCR quedan invisibles y se confunden con "documento inválido" |
| D6 | 8 vulnerabilidades npm en backend (4 high) | **Alta** | Superficie de ataque conocida y públicamente documentada |
| D7 | Sin middleware de error centralizado + `logout` sin try/catch | **Media** | Peticiones que cuelgan sin respuesta ante errores no capturados |
| D8 | Status code inconsistente (400 vs 422) en validación | **Media** | Contratos de API impredecibles para el frontend/clientes externos |
| D9 | 18/28 páginas sin migrar a componentes del design system | **Media** | Inconsistencia visual creciente, más esfuerzo futuro de migración |
| D10 | Patrón fetch/loading/error duplicado (8+ archivos) | **Media** | Bugs de estado de carga corregidos en un lugar y no en otro |
| D11 | `window.confirm()` nativo (15 sitios) | **Media** | Rompe tema claro/oscuro, inconsistente con el resto de la UI |
| D12 | Configuración hardcodeada (TTLs de sesión, rate limit, payload) | **Media** | Cambios de política requieren redeploy en vez de config |
| D13 | 10 vulnerabilidades npm en frontend (7 high, mayormente build tooling) | **Media** | Riesgo en entorno de desarrollo, no en producción servida |
| D14 | Dependencias mayores desactualizadas (TS, Express, Tailwind) | **Media** | Brecha creciente hace la migración futura más costosa |
| D15 | Sin tests end-to-end | **Media** | Bugs de integración entre frontend/backend no se detectan hasta QA manual |
| D16 | `.env.example` desactualizado | **Baja** | Fricción de onboarding, no afecta producción |
| D17 | Badges de estado reimplementados a mano (2 sitios) | **Baja** | Inconsistencia visual menor y aislada |
| D18 | Loading/error sin Skeleton/ErrorState (2 sitios) | **Baja** | Inconsistencia visual menor y aislada |
| D19 | Tipado `any` (5 ocurrencias totales) | **Baja** | Impacto mínimo, no concentrado |
| D20 | TODO/FIXME en código | N/A | No aplica — no se encontró ninguno |

---

## 3. Plan de refactorización (ítems Alta y Media)

### Sprint 8 — riesgos de producción y seguridad

| Ítem | Técnica de refactorización | Esfuerzo |
|------|------------------------------|----------|
| D4 — Fuga de información en errores 500 | Guard clause por entorno: solo incluir `detail` cuando `NODE_ENV !== 'production'` | 3h |
| D5 — Sin logging server-side | Introducir logging estructurado (`console.error` o Winston/Pino) en cada `catch`, previo a responder | 6h |
| D5b — `ocr.controller.ts` enmascara errores como éxito | *Replace catch-with-empty-response*: loguear la excepción real y devolver `422`/`500` según el caso en vez de `200` con campos vacíos | 2h |
| D6 — Vulnerabilidades npm backend (no-breaking) | `npm audit fix` para `ip-address`, `js-yaml`, `qs`; evaluar `--force` de `uuid`/`node-cron` por separado | 4h |
| D3 — Índices faltantes en `registros_acceso`/`pagos` | Migración `CREATE INDEX` sobre `sucursal_id`, `residente_id`, `timestamp_entrada`/`fecha_pago`, `estado` | 4h |
| D1 — Tests para controllers críticos (empresas, sucursales, cargos_programados) | Extract Test Cases siguiendo el patrón de `cargos.controller.test.ts`; priorizar lógica multi-tenant y de cobro | 16h |

**Subtotal S8: ~35h**

### Sprint 9 — consistencia de backend y adopción del design system

| Ítem | Técnica de refactorización | Esfuerzo |
|------|------------------------------|----------|
| D7 — Middleware de error centralizado + fix `logout` | Introduce Middleware (Express error-handling `(err, req, res, next)`) + añadir try/catch faltante | 8h |
| D8 — Unificar status codes de validación | Reemplazar validación manual (`400`) por `express-validator` (`422`) en las ~17 rutas restantes | 10h |
| D2 — Tests para páginas frontend restantes | Component testing con React Testing Library, siguiendo el patrón de `AdminReservasPage.test.tsx`; priorizar AreasComunesPage, GaritaPage, ConfigCargosPage | 20h |
| D9 — Migrar páginas restantes al design system | Extract Component: reemplazar wrappers Tailwind manuales por `Card`/`Button`/`Badge`/`Table` en las 18 páginas pendientes (por lotes de 4-5) | 24h |
| D11 — Reemplazar `window.confirm()` por `Modal` | Extract Component: `ConfirmModal` compartido reutilizado en los 15 sitios | 6h |
| D12 — Externalizar configuración hardcodeada | Introduce Parameter Object / variables de entorno para TTLs de sesión, rate limiter, payload limit | 4h |

**Subtotal S9: ~72h**

### Sprint 10 — deuda estructural y madurez de testing

| Ítem | Técnica de refactorización | Esfuerzo |
|------|------------------------------|----------|
| D10 — Hook compartido para fetch/loading/error | Extract Method → custom hook `useAsync`/`useFetch`, reemplazar los 8+ usos duplicados | 8h |
| D15 — Suite de tests end-to-end | Introducir Playwright; cubrir 5-8 flujos críticos (login, crear reserva, registrar pago, control de acceso) | 16h |
| D13 — Vulnerabilidades npm frontend | `npm audit fix` para `postcss`, `postcss-selector-parser`, `undici`, `vite`; verificar build tras el fix | 3h |
| D14 — Actualización de dependencias mayores | Upgrade escalonado de TypeScript, Express, Tailwind con suite de regresión entre cada paso | 12h |

**Subtotal S10: ~39h**

**Ítems de prioridad Baja (D16-D19)** no se planifican en un sprint específico — se recomienda resolverlos oportunistamente dentro de PRs que ya toquen esos archivos (ej. actualizar `.env.example` la próxima vez que se agregue una variable de entorno).

---

## 4. Resumen ejecutivo

El refactor visual de Sprint 7 construyó una base de design system sólida (tokens, alias de Tailwind, clases `sg-*`) sin colores hardcodeados, pero solo 10 de 28 páginas adoptaron los componentes React reutilizables — es deuda de adopción, no de arquitectura. El hallazgo de mayor riesgo es la cobertura de tests: 8 de 22 controllers backend (incluyendo el núcleo multi-tenant `empresas`/`sucursales` y el cobro automático `cargos_programados`) y 22 de 28 páginas frontend no tienen ningún test, y no existe ninguna prueba end-to-end que valide un flujo completo. En el backend, el manejo de errores es mayoritariamente consistente (22/22 controllers con try/catch) pero expone `detail: String(error)` en cada 500 sin registrar nada en logs del servidor, lo que combina fuga de información con imposibilidad de depurar producción. `npm audit` confirmó 8 vulnerabilidades en el backend (4 high) y 10 en el frontend (7 high, mayormente herramientas de build); la mayoría se resuelve sin cambios incompatibles. Finalmente, `registros_acceso` y `pagos` — las tablas de mayor volumen — no tienen índices propios pese a filtrarse constantemente por sucursal, residente y fecha. Positivamente, no se encontró ningún `TODO`/`FIXME` pendiente y el uso de `any` en TypeScript es mínimo (5 ocurrencias), lo que indica buena disciplina de tipos en general.
