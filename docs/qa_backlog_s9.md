# QA de solo lectura — Backlog Sprint 9

Rama `main` @ `ba5de8d` (2026-10-06). Auditoría por lectura de código, `git log`, `npm test` (backend) y `npm audit`. No se modificó código ni se hizo commit.

## Resumen (5 líneas)

1. De los 22 tickets, **ninguno está HECHO por completo**: 8 están PARCIAL, 13 NO HECHO y 1 no es verificable por código (H09+H10 y H05+H07 cuentan cada uno como un ticket).
2. Lo ya avanzado es infraestructura, no pantalla: botón base `Button` correcto en ambos temas, baja de usuarios en el backend, auditoría y límites de tasa, CI de integración, compuesto de producción con Cloud SQL, pasarela de tarjeta simulada con interruptor.
3. El Grupo 1 (UX) casi no se tocó: los defectos de H01, H03, H05–H12 siguen en el código tal como se describen (≈35 botones `bg-blue-600 text-white`, 20 diálogos nativos, fechas sin zona, «ban», doble alta de empresa).
4. Los tickets de seguridad **empeoraron respecto a los documentos**: `npm audit` del backend muestra 1 crítica (`proxy-addr`, se arregla sin cambio mayor) y el frontend 11 (6 altas) frente a las «3 moderadas» de S-13.
5. **Los puntos originales no están en el repo ni en tu mensaje**, así que la columna queda «n/d». Pásame las estimaciones y calculo los totales; mientras tanto doy el trabajo restante como % del ticket.

## Tabla resumen

"Resta" = fracción estimada del trabajo original que sigue pendiente (juicio mío, no medición). Puntos: n/d porque no los tengo.

| # | Ticket | Estado | Pts orig. | Pts sugeridos | Resta |
|---|---|---|---|---|---|
| 1 | H01 Botón principal ilegible en oscuro | PARCIAL | n/d | Bajar (es mecánico) | ~70 % |
| 2 | H02 Editar/baja de agentes | PARCIAL | n/d | Bajar (la baja ya existe) | ~60 % |
| 3 | H03 Lista negra por placa | NO HECHO | n/d | Sin cambio | 100 % |
| 4 | H04 Garita sin cámara / salida | PARCIAL | n/d | Sin cambio | ~75 % |
| 5 | H05+H07 Pagos y confirmaciones | NO HECHO | n/d | Sin cambio | ~90 % |
| 6 | H06+H08 Glosario y fechas | PARCIAL | n/d | Sin cambio | ~85 % |
| 7 | H09+H10 Pasos tras altas / preautorización | PARCIAL | n/d | Sin cambio | ~85 % |
| 8 | H11+H12 Reportes, anuncios, consistencia | NO HECHO | n/d | Sin cambio | ~95 % |
| 9 | Repetir pruebas UX 5, 6, 14, 15 | NO SE PUEDE VERIFICAR POR CÓDIGO | n/d | — | proceso |
| 10 | Windows + deuda mínima (audit, CI) | PARCIAL | n/d | Sin cambio | ~70 % |
| 11 | Cámaras IP (ONVIF + RTSP) | NO HECHO | n/d | Sin cambio | 100 % |
| 12 | Celular como cámara IP | NO HECHO | n/d | Sin cambio | 100 % |
| 13 | OCR local del DPI | NO HECHO | n/d | Sin cambio | 100 % |
| 14 | Actualizaciones firmadas Tauri | NO HECHO | n/d | Sin cambio | 100 % |
| 15 | 2FA para administradores | NO HECHO | n/d | Sin cambio | 100 % |
| 16 | S-06 y S-17 | NO HECHO | n/d | Sin cambio | 100 % |
| 17 | Auditoría completa y límites (RNF-10) | PARCIAL | n/d | Bajar (la base existe) | ~30 % |
| 18 | Espejo local de invitaciones QR | NO HECHO | n/d | Sin cambio | 100 % |
| 19 | SaaS: planes y onboarding | NO HECHO | n/d | Sin cambio | 100 % |
| 20 | Landing y despliegue de producción | PARCIAL | n/d | Sin cambio | ~70 % |
| 21 | Cutover de pagos a Visanet | NO HECHO | n/d | Sin cambio | ~95 % |
| 22 | Deuda de seguridad S-11/13/14/15 | NO HECHO | n/d | Sin cambio | 100 % |

Recuento: PARCIAL = 1, 2, 4, 6, 7, 10, 17, 20 (8). NO HECHO = 3, 5, 8, 11, 12, 13, 14, 15, 16, 18, 19, 21, 22 (13). NO SE PUEDE VERIFICAR = 9 (1). Total 22.

## Totales

- Puntos del backlog original: **n/d** (no se proporcionaron).
- Puntos que realmente quedan: **n/d**. Con tus estimaciones: `Σ(puntos_i × Resta_i)`. Por orden de magnitud, los tickets con Resta ≥ 95 % (3, 8, 11–16, 18, 19, 21, 22) son casi todo el backlog; los únicos con descuento real son 1, 2 y 17.
- Ahorro realista sobre el backlog completo: bajo, porque lo ya hecho cubre sobre todo piezas base (botón, baja de usuario, middleware de auditoría), no los hallazgos.

## Detalle por ticket

### 1. H01 — Botón principal ilegible en tema oscuro — PARCIAL

- **Hecho:** el componente base está bien. `frontend/src/components/ui/Button.tsx:17` usa `bg-brand-500 text-brand-ink`; `index.css:215` define `--c-brand-ink: 24 24 27` en oscuro y `.sg-btn-primary` (`index.css:412`) lo usa igual.
- **Causa que sigue viva:** en oscuro `--c-brand-500` = `228 228 231` y `--c-brand-600` = `244 244 245` (`index.css:137-138`, casi blanco), y `tailwind.config.ts` mapea `blue`, `teal`, `emerald`, etc. a `brand`. Todo botón escrito como `bg-blue-600 … text-white` queda blanco sobre casi blanco. La regla de `index.css:563` solo corrige `text-white` en tema **claro**.
- **Sitios afectados (≈35 coincidencias):** `AreasComunesPage.tsx:394` (Guardar áreas), `ConfiguracionQrPage.tsx:183` (Guardar reglas QR), `ConfiguracionReservasPage.tsx:240`, `PreautPage.tsx:109` (+ Nueva Preautorización) y `:219`, `owner/OwnerDashboard.tsx:251` y `owner/EmpresaDetail.tsx:155,265,303` (Crear empresa y similares), `ReservasAdminPage.tsx:37` (pestaña/selector «Todos»), `owner/OwnerEmpresas.tsx:460`, `admin_empresa/GestionSucursales.tsx:362,475,521`, `TicketChat.tsx:149,182` (burbuja del chat), `ConfigCargosPage.tsx:359,415`, `ResidentePage.tsx:710`, `QrInviteModal.tsx:155`, `SalidaPage.tsx:329`.
- **Valor actual:** texto `#fff` sobre `rgb(244 244 245)` en hover/600 y `rgb(228 228 231)` en 500. Ratio de contraste ≈ 1,1:1.
- **Falta:** migrar estos sitios a `<Button>` o `text-brand-ink`, o una regla CSS en oscuro para `[class*='bg-blue-']` + `text-white`. Las variantes `emerald/green` (fondo verde, texto blanco) sí se leen y no son el problema. La burbuja del chat del admin (`TicketChat.tsx:149`) es el mismo patrón.
- **Ajuste:** bajar puntos si se resuelve con una regla global; es una causa única. La confirmación final es visual.

### 2. H02 — Editar y dar de baja agentes — PARCIAL

- **Baja (backend):** `DELETE /usuarios/:id` (`routes/usuarios.routes.ts:23`) con `auditLog USUARIO_DESACTIVADO`; `deleteUsuario` (`controllers/usuarios.controller.ts:77`) hace baja suave con control por rol y empresa.
- **Edición:** no existe. `usuarios.routes.ts` solo tiene GET, GET `/sucursal`, POST, DELETE y `PUT /me/preferencias`. Busqué `updateUsuario`, `PUT /usuarios` en rutas y controlador.
- **Frontend:** `AgentesPage.tsx:~145-175` pinta 4 columnas (nombre, email, rol, estado); no hay columna de acciones ni `RowActions`. `services/api.ts` solo exporta `getUsuarios`/`createUsuario` (no hay función de baja ni de edición en esa sección, `api.ts:1149-1185`).
- **Falta:** `PUT /usuarios/:id` (nombre, email, rol, contraseña opcional) con auditoría y control de alcance, funciones de API, columna de acciones con modal de edición y confirmación de baja.

### 3. H03 — Lista negra por placa — NO HECHO

- La búsqueda y los registros usan solo DPI: `BlacklistPage.tsx:52-69` (`buscarVisitantesPorDpi`, etiqueta `blacklist.searchByDpi`, `translations.ts:390`), `blacklist.controller.ts:13-48` consulta `v.numero_dpi`. La tabla `visitante_blacklist` (`database/init.sql:207`) cuelga de `visitante_id`; no guarda placa.
- No hay mensaje de «sin resultados» en el desplegable (`BlacklistPage.tsx:241-254` solo pinta cuando `dpiResults.length > 0`).
- Busqué `placa` en `blacklist.controller.ts`, `BlacklistPage.tsx`, `translations.ts` (claves `blacklist.*`): sin coincidencias útiles.
- **Falta:** decisión de modelo (¿bloquear la placa suelta o el visitante?), consulta y comprobación en `accesos.controller.ts`, selector DPI/placa, mensaje de sin resultados, etiqueta «Buscar visitante por DPI o placa».

### 4. H04 — Garita sin cámara — PARCIAL

- **Web:** `SalidaPage.tsx:236-246` permite teclear la placa y buscar; el botón de escanear solo aparece si hay cámara (`:191`). Salida por **QR tecleado**: no existe. `GaritaPage.tsx:453-461` con `!hasCamera` muestra solo «cámara no disponible / requiere HTTPS» en la columna izquierda, sin alternativa visible para el QR.
- **Escritorio:** `components/garita/CameraPane.tsx:~170` deshabilita «Dar salida» con `disabled={!activa || ocupado || bloqueado}`; si no hay cámara el botón queda apagado y el único texto es el `title`. `pages/GaritaPage.tsx:44,118,121` solo abre `SalidaDialog` (que sí permite teclear la placa, `SalidaDialog.tsx:88-95`) tras una captura o un fallo de captura: sin cámara no hay forma de llegar al diálogo.
- **Panel derecho:** `GaritaPage.tsx` (escritorio) muestra siempre la tarjeta «Registrar acceso» con `VisitanteForm` (botón «Registrar entrada», `VisitanteForm.tsx:242`) aunque la pestaña activa sea Salida.
- **Además:** `CameraPane.tsx:39` exige red para la salida (`requiere: 'red'`); conflicta con el modo sin conexión.
- **Falta:** botón «Escribir placa» que abra `SalidaDialog` sin cámara, explicar el estado deshabilitado, cambiar el panel derecho según el modo, entrada manual de QR, decidir si la salida debe poder hacerse offline.

### 5. H05 + H07 — Pagos y confirmaciones — NO HECHO

- **Saldo insuficiente:** `PagoTarjetaModal.tsx` precarga el monto con el saldo (`:39`) pero no compara monto con saldo ni advierte; el backend (`pagos.controller.ts:258-330`) solo valida `monto > 0`.
- **Texto de implementación al residente:** `translations.ts:95-96` — «Pago simulado — aún no se conecta con Visanet.» y «Entorno de prueba…»; se pintan en el modal (`PagoTarjetaModal.tsx:~97`, `description={t('card.subtitle')}`). Sigue visible.
- **Rechazos en el historial:** `pagarConTarjeta` inserta la fila antes de decidir el resultado (`pagos.controller.ts:~296-305`, `estado = simularAutorizacionTarjeta(...)`), por lo que cada intento rechazado se guarda.
- **Avisos temporales:** `components/ui/Toast.tsx:30` fija `DURATION_MS = 4000` sin pausa al pasar el ratón ni cierre manual obligatorio; no hay variante persistente para errores.
- **Estado del ticket:** `TicketsPage.tsx` no tiene `setInterval`/sondeo (busqué `setInterval|refetch` en `TicketsPage.tsx`, `TicketChat.tsx`); el chat tampoco refresca el estado del encabezado.
- **Admin avisado de reservas pendientes:** no encontré aviso fuera de la propia página de reservas (`AdminReservasPage.tsx`) y de la gráfica de `EstadisticasPage.tsx:558`; el dashboard (`dashboard.controller.ts`) cuenta `pagos_pendientes`, no reservas.
- **«Anuncio creado»:** la clave existe (`translations.ts:367`, `AnunciosPage.tsx:105`); si es suficientemente claro es juicio visual.
- **Reserva nueva visible / Guardar accesible:** NO SE PUEDE VERIFICAR POR CÓDIGO (comportamiento de pantalla). Archivos: `ReservasPage.tsx:123`, `AreasComunesPage.tsx:394` (el pie del modal).
- **Falta:** casi todo. Lo más barato: ocultar textos de simulación al residente (por bandera de entorno), no persistir los rechazados (o marcarlos y excluirlos del historial), advertencia de saldo, sondeo del ticket.

### 6. H06 + H08 — Glosario y fechas — PARCIAL

- **Glosario, parcial:** ya hay «Garitas y códigos de activación» (`translations.ts:14`) y «Solicitudes» en menú (`:58,188`). Persisten mezclas: «Solicitudes / Tickets» (`:313`), «+ Nuevo ticket» (`:316`), «Agregar ban», «Remover ban», «Duración del ban» (`:375,384,393`), mientras en otros textos se dice «bloquear» (`:92`). No hay un glosario documentado.
- **Fechas:** 32 llamadas a `toLocale*` con `es-GT` y sin `timeZone: 'America/Guatemala'` (`grep toLocale` en `frontend/src`); dos usan `timeZone: 'UTC'` para fechas sin hora (`ReservasPage.tsx:31`, `AdminReservasPage.tsx:33`). Resultado: la hora depende de la zona del navegador. `frontend/src/utils/tiempo.ts` solo tiene tiempo relativo e inicial.
- **Placa:** placeholders distintos, `P123ABC` (`QrInviteModal.tsx:245`) y `P-123ABC` (`GaritaPage.tsx:632`, `SalidaPage.tsx:241`, `ResidentePage.tsx:700`, `PreautPage.tsx:201`). El escritorio normaliza con `lib/placa.ts` (sin guion). No hay normalización común en el frontend web.
- **Falta:** glosario y pasada de textos, utilidad única de formato (`America/Guatemala`), normalizar placa (un guion o ninguno) en entrada, guardado y visualización.

### 7. H09 + H10 — Pasos siguientes y preautorización — PARCIAL

- **Dos caminos para crear empresa:** `owner/OwnerDashboard.tsx:60` y `owner/OwnerEmpresas.tsx:128` llaman a `createEmpresa`, cada uno con su modal.
- **Rótulo ADMINISTRACIÓN GLOBAL:** `App.tsx:126` reutiliza `nav.group.global` en `ADMIN_EMPRESA_NAV`, por lo que el admin de empresa lo ve (`translations.ts:10`). No oculto.
- **Bienvenida al panel vacío / empresas sin administrador / mostrar contraseña:** busqué `bienvenid|welcome|onboard|primeros pasos` en `frontend/src` sin resultados; no hay botón de mostrar contraseña en los formularios de `owner/` y `admin_empresa/` (`type="password"` sin conmutador: `GestionSucursales.tsx:547`).
- **Preautorización:** parcial. Acepta rango de fechas (`PreautPage.tsx:208-213`, `fecha_inicio`/`fecha_fin`, el backend lo usa en `preautorizaciones.controller.ts:28-30,67-69`), por lo que «más de un día» existe a nivel de datos. Pero la **placa no se muestra** en la tabla (columnas: casa, visitante, DPI, desde, hasta, acciones; `PreautPage.tsx:128-144`), y el flujo sigue en `PreautPage` (admin) y `ResidentePage` por separado. El backend exige `fecha_fin` no nula (`:29`), aunque el formulario la presenta como opcional.
- **Falta:** bienvenida y estados vacíos con siguiente paso, aviso de empresa/sucursal sin admin, ojo de contraseña, un solo alta de empresa, ocultar el rótulo por rol, columna de placa, decidir `fecha_fin` obligatoria o no, unir flujos.

### 8. H11 + H12 — Reportes, anuncios y consistencia — NO HECHO

- **Reportes:** `App.tsx:380-384` enruta `reportes` a `EstadisticasPage` (commits `cfc042b`, `5b8a545`, `a14bfc4` con export CSV/PDF). Longitud, claridad de «ingresos» y utilidad del gráfico: NO SE PUEDE VERIFICAR POR CÓDIGO (`pages/EstadisticasPage.tsx`, `components/charts/*`, claves `stats.*` en `translations.ts:614-672`).
- **Diálogos nativos:** 20 sitios con `window.confirm`/`window.prompt`: `TicketChat.tsx:84`, `InvitacionesPanel.tsx:107,112`, `LicenciasPage.tsx:102,107`, `AdminReservasPage.tsx:76`, `BlacklistPage.tsx:108`, `ResidentesPage.tsx:127`, `PreautPage.tsx:74`, `AreasComunesPage.tsx:144`, `ConfigCargosPage.tsx:174,265`, `ResidentePage.tsx:189,344`, `AnunciosPage.tsx:116`, `GestionSucursales.tsx:134,145`, `EmpresaDetail.tsx:59`, `OwnerEmpresas.tsx:210`, `OwnerDashboard.tsx:83`. El componente `Modal` ya existe (`components/ui/Modal.tsx`).
- **Anuncios separados de la campana:** `AnunciosPage` (admin) y `AnnouncementsBell` (solo residente, `App.tsx:503`) son componentes separados, pero el residente no tiene página propia de anuncios (busqué `announce` en `ResidentePage.tsx`: nada). «LECTURAS» aparece como columna (`AnunciosPage.tsx:157`) sin explicación.
- **«Remover ban» no en verde, acciones destructivas, plurales, «Tipo» como selector:** el filtro de tipo de tickets ya es `<select>` (`TicketsPage.tsx:64`); el resto es visual o está sin tocar (`blacklist.remove` sigue con «ban», `BlacklistPage.tsx:154`). Plurales: no encontré lógica de plural (`(s)`) ni utilidad común.
- **«Logo URL»:** sigue igual (`translations.ts:868,1895`, `OwnerDashboard.tsx:233`).
- **Falta:** sustituir los 20 diálogos, página de anuncios del residente, textos y estilos pendientes.

### 9. Repetir pruebas UX 5, 6, 14, 15 — NO SE PUEDE VERIFICAR POR CÓDIGO

- No hay evidencia previa de esas pruebas en el repo. Busqué `UX`, `Tarea 3`, `prueba ux` en `docs/`, `README.md`, `backlog/`. `docs/tarea5_*` y `backend/securitytest/RESULTADOS.md` cubren seguridad e integración, no pruebas UX con usuarios.

### 10. Windows + deuda técnica mínima — PARCIAL

- **Windows:** `desktop/src-tauri/tauri.conf.json:28` ya define `targets: ["nsis","msi"]` y existe `sidecar:prepare:windows` (`desktop/package.json:15`); hay un commit de Docker en Windows (`7a2a260`, abril). No hay evidencia de que alguien lo haya compilado o probado en Windows (ni CI en `windows-latest`).
- **`npm audit --omit=dev` (ejecutado hoy):** backend **3 vulnerabilidades (1 crítica `proxy-addr`, 2 moderadas `uuid`/`node-cron`)**; frontend 0; desktop 0. La crítica se arregla con `npm audit fix` sin cambio mayor.
- **CI:** `.github/workflows/ci-integracion.yml:20` usa `runs-on: ubuntu-latest` (hay que fijar `ubuntu-24.04`) y solo ejecuta pruebas de integración y regresión; no hay job de pruebas unitarias (`npm test` de backend: 30 suites / 594 pruebas pasan localmente; frontend y desktop tienen `vitest` sin job).
- **Falta:** `npm audit fix` en backend, fijar runner, añadir job unitario (backend, frontend, desktop), compilar y probar el instalador en Windows.

### 11. Cámaras IP por LAN (ONVIF + RTSP) — NO HECHO

- Busqué `onvif`, `rtsp`, `ip cam` en `desktop/src`, `desktop/src-tauri/src`, `backend/src`, `frontend/src`, `README.md`, `docs`: cero coincidencias. Las cámaras actuales son webcam USB por `getUserMedia` (`desktop/src/lib/camara.ts`, commit `ca57e5b`).

### 12. Celular como cámara IP — NO HECHO

- Búsqueda de `ipwebcam`, `droidcam`, `mjpeg`: nada. Depende de 11.

### 13. OCR local del DPI — NO HECHO

- Confirmado: `desktop/src-tauri/src/ocr.rs:267-277` (`ocr_dpi_remoto`) envía a `/ocr/dpi`, y `backend/src/controllers/ocr.controller.ts:3,31` llama a `vision.googleapis.com` con `GOOGLE_CLOUD_API_KEY`. El sidecar local (`desktop/sidecar-ocr`, `ppu-paddle-ocr`) lee solo placas. Existe captura manual de DPI como alternativa (commit `cc39528`).

### 14. Actualizaciones firmadas de Tauri — NO HECHO

- `desktop/src-tauri/Cargo.toml:14-19` solo tiene `tauri-plugin-shell` y `tauri-plugin-log`; ni `tauri-plugin-updater` ni `pubkey`/`endpoints` en `tauri.conf.json`. Sin claves ni endpoint.

### 15. 2FA para administradores — NO HECHO

- Busqué `totp|2fa|two-factor|otplib|speakeasy|mfa` en `backend/src`, `backend/package.json`, `frontend/src`, `database`: sin resultados (solo un falso positivo de `HASH_SENUELO`).

### 16. S-06 y S-17 — NO HECHO

- **S-06:** `refresh_tokens` tiene `revoked BOOLEAN` pero no `revoked_at` ni familia (`database/init.sql:192-200`). `auth.controller.ts:153-207` rota el token pero no detecta reutilización: un token ya revocado simplemente da 401. `securitytest/RESULTADOS.md:148` lo confirma («No existe»).
- **S-17:** `init.sql` tiene 49 columnas `TIMESTAMP` y 0 `TIMESTAMPTZ`; `db/pool.ts` no registra `setTypeParser(1114, …)`. `bloqueado_hasta` sigue comparándose en JS según `DEUDA_TECNICA.md`. El único cambio relacionado es el de caducidad de invitaciones en SQL. Las migraciones (`ALTER … TYPE TIMESTAMP`, `init.sql:357,359`) van en sentido contrario.

### 17. Auditoría completa y límites de tasa (RNF-10) — PARCIAL

- **Hecho:** `middleware/audit.middleware.ts` escribe al terminar la respuesta con código HTTP real; `auditLog(` se usa en 58 rutas. Límites: `app.ts:81` (general), `auth.routes.ts:27,36,50` (login por IP, por cuenta, sesión), `licencias.routes.ts:15,34`, `invitaciones.routes.ts:16`, `routes/index.ts:57` (OCR), `empresas.routes.ts:26`.
- **Huecos:** `tickets.routes.ts` (crear, cerrar, mensajes: 3 mutaciones, 0 auditoría, 0 límite propio), `ocr.routes.ts` (0 auditoría; tiene límite). No encontré el texto «RNF-10» en `README.md`, `docs/` ni `SECURITY_REVIEW.md`, así que no puedo contrastar con el requisito original.
- **Falta:** cubrir los huecos, definir qué es «sensible» según RNF-10, límite al chat y a la creación de tickets.

### 18. Espejo local de invitaciones QR — NO HECHO

- SQLite local (`desktop/src-tauri/src/db.rs:93-153`) tiene `residentes_local`, `blacklist_local`, `preautorizaciones_local`, `accesos_pendientes` y `config_hardware`; **sin** tabla de invitaciones QR. `CameraPane.tsx:36,~165` declara que verificar un QR requiere conexión.

### 19. SaaS: planes y onboarding — NO HECHO

- Busqué `plan|suscrip|subscription|stripe|trial` en `backend/src`, `database/init.sql`, `frontend/src`: sin tablas ni rutas de planes (las coincidencias son palabras como «plan» en comentarios). Lo que existe es el aprovisionamiento por invitación owner → empresa → sucursal (commit `c62ea07`), que es onboarding de bajo nivel, sin planes, límites ni cobro.

### 20. Landing y despliegue de producción — PARCIAL

- **Producción:** `docker-compose.prod.yml` con backend, nginx y Cloud SQL Auth Proxy; migración a Cloud SQL (`861d873`, `scripts/migrate-to-cloudsql.sh`), backups a GCS. `nginx/nginx.conf:33,44,46` todavía tiene el literal `DOMINIO`. `scripts/deploy.sh:9` usa por defecto `docker-compose.yml` (desarrollo). Que producción esté realmente en pie: NO SE PUEDE VERIFICAR POR CÓDIGO.
- **Landing:** no hay página ni proyecto de landing en el repo (busqué `landing` en `*.md`, `*.yml`, `*.tsx` y carpetas). La memoria de diseño menciona una paleta del landing, pero no hay código.

### 21. Cutover de pagos a Visanet — NO HECHO

- **Real:** modelo de pagos y liquidación de saldo (`pagos.controller.ts:90-160, 296-330`), validación de tarjeta en el navegador (`utils/tarjeta.ts`), solo se envían los últimos 4 dígitos, columna `es_simulado`, y un interruptor `PAGOS_TARJETA_SIMULADA` que en producción responde **501** (`pagos.controller.ts:265-271`; `docker-compose.prod.yml:65` no lo define).
- **Simulado:** la autorización: `simularAutorizacionTarjeta` aprueba todo salvo tarjetas que terminan en 1 (`:252`). No hay SDK, credenciales, 3-D Secure, webhooks, conciliación ni reembolsos. Búsqueda de `visanet` solo da comentarios y textos.

### 22. Deuda de seguridad S-11, S-13, S-14, S-15 — NO HECHO (con discrepancias)

- **S-11 (refresh 401 en vez de 423):** sin cambio; `RESULTADOS.md:190,259` lo mantiene como deuda.
- **S-13 (frontend):** el documento dice 3 avisos moderados tras `npm audit fix`; hoy `npm audit` completo en `frontend/` da **11 (6 altas)**, entre ellas `@vitest/mocker`, `postcss-selector-parser`, `source-map-js`. Con `--omit=dev` da 0. O el `audit fix` no quedó en el lockfile, o hay avisos nuevos. Verificar.
- **S-14 (backend):** el documento dice 4 moderadas; hoy hay **3, una crítica** (`proxy-addr`, spoofing de IP con subredes IPv4 mapeadas), más `uuid`/`node-cron`. La crítica afecta directamente a los límites de tasa y a la auditoría de IP si se confía en el proxy.
- **S-15 (Rust):** `Cargo.toml` pide `tauri = "2"` sin tope; no ejecuté `cargo audit` (no instalé nada), así que el estado de los 7 avisos es el del documento. Se resolvería con el ticket 14.

## Cosas que encontré y no están en ninguno de los 22 tickets

1. **`proxy-addr` crítica en el backend** (ver 10 y 22): `npm audit fix` sin cambios mayores. Prioridad alta; afecta a `req.ip` (límites y auditoría).
2. **Discrepancia entre docs y realidad en S-13/S-14**: `backend/DEUDA_TECNICA.md` y `securitytest/RESULTADOS.md` declaran números que ya no coinciden con `npm audit`. Conviene reejecutar `run-deps.sh` y actualizar los documentos.
3. **El despliegue por defecto usa el compose de desarrollo** (`scripts/deploy.sh:9`), que activa `PAGOS_TARJETA_SIMULADA: "true"` (`docker-compose.yml:46`) y el dev server de Vite. Si la VM se desplegó así, los residentes pueden «pagar» y dejar el saldo en 0 con una tarjeta falsa. Los documentos ya dicen que no se pudo comprobar.
4. **Causa raíz sistémica de H01**: los alias `blue/teal/emerald… → brand` en `tailwind.config.ts` hacen que cualquier clase heredada cambie de significado entre temas. Cada pantalla nueva con `bg-blue-*` reintroduce el fallo.
5. **Salida y QR de escritorio dependen de red** (`CameraPane.tsx:36,39`): contradice el diseño offline del resto de la garita. Relacionado con 4 y 18.
6. **`fecha_fin` obligatoria en la práctica**: el formulario la muestra opcional (`PreautPage.tsx:213`), pero el backend ignora preautorizaciones sin `fecha_fin` (`preautorizaciones.controller.ts:29,68`). Una preautorización sin fecha de fin nunca se activa.
7. **Intentos de pago rechazados se guardan** como filas en `pagos` (parte de H05) y pueden contaminar reportes de ingresos si estos no filtran por estado; revisar `reportes.controller.ts`.
8. **Código duplicado en pantallas del owner**: `OwnerDashboard.tsx` y `OwnerEmpresas.tsx` repiten alta, baja y modales de empresa (origen del doble camino de H09).
9. **Sin job unitario en CI y `push` sin filtro de rama** (`ci-integracion.yml:3-5`): corre en todos los pushes, pero no ejecuta las 594 pruebas unitarias del backend ni las de frontend/desktop.
10. **`nginx/nginx.conf` con `DOMINIO` literal** y sin pasos automáticos para sustituirlo; fácil de olvidar al desplegar.
11. **Ruido en pruebas**: `migrate.test.ts` imprime «init.sql no encontrado» (`db/migrate.ts:85`); es solo un aviso en el entorno de pruebas, pero oculta si la ruta falla de verdad.
12. **Commits de demostración** `ca9e7a2` / `ba5de8d` (quita y restablece `ownershipClause`): el diff neto entre `ca9e7a2~1` y `ba5de8d` está vacío, es decir, el estado actual es correcto. Ojo con que el historial publicado contiene una regresión de aislamiento multi-tenant.
13. **Secretos históricos (S-12)** siguen pendientes y fuera de estos 22 tickets; requieren rotación manual en producción.
14. **S-10 (bloqueo de login por cuenta = denegación dirigida)** y **S-16 (revisar `dangerouslySetInnerHTML`)** no están en el backlog. Sobre S-16: busqué `dangerouslySetInnerHTML` en `frontend/src` y `desktop/src` y no hay usos fuera de pruebas.

## Qué no verifiqué

- No ejecuté pruebas de `frontend/` ni `desktop/` (ni `cargo test`/`cargo audit`), ni la app en pantalla; todo lo visual queda marcado como no verificable por código.
- No contacté la VM, Cloud SQL ni GitHub Actions; el estado real de producción y del CI remoto es desconocido.
- No tengo las estimaciones de puntos ni el texto original de los hallazgos H01–H12 salvo lo que pegaste; los criterios de aceptación los leí de tu descripción.
