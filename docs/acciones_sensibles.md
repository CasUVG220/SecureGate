# Acciones sensibles y su rastro de auditoría (RNF-10)

**Regla:** toda acción que cambia datos, abre o cierra el acceso de una persona, mueve dinero o descarga datos personales deja una fila en
`audit_logs` con **quién** (`usuario_id`), **cuándo** (`created_at`), **desde dónde** (`ip_address`, `user_agent`), **qué** (`accion`, `tabla_afectada`,
`registro_id`, `sucursal_id`) y **cómo terminó** (`status_code`). Una acción *rechazada* (401/403/409/429) también se audita: lo que alguien intentó y no pudo
es justo lo que se busca después de un incidente. Las rutas con rol exigido auditan el rechazo en el propio guard (`ACCESO_DENEGADO`); los 401 sin sesión (escáneres anónimos) no.

Las filas se escriben **al terminar la respuesta** (con el código HTTP real), nunca antes, y la IP sale de `req.ip` (respeta `trust proxy`; no se lee
`X-Forwarded-For` a ciegas). El detalle (`datos_nuevos`) nunca lleva contraseñas, tokens ni imágenes: sólo nombres de campos, identificadores y el correo intentado en un login.

Dos pruebas mantienen esta lista honesta:

- `backend/src/__tests__/auditoria.cobertura.test.ts` recorre el router **real**: toda ruta que modifica algo debe llevar `auditLog(...)` o estar en la lista de
  exenciones de abajo, y toda acción que aparezca en el código debe estar en esta tabla (y al revés).
- `backend/src/__tests__/integration/auditoria.int.test.ts` ejecuta **cada** acción de la tabla contra Postgres y comprueba que la fila trae usuario (cuando hay sesión),
  fecha y IP. Es la meta del 100 % del ticket SCRUM-125.

## Acciones auditadas

| Acción | Qué es | Ruta | Quién | Límite de tasa |
|---|---|---|---|---|
| **Sesión y acceso** | | | | |
| `LOGIN` | Inicio de sesión (correcto, fallido o bloqueado). Guarda el correo intentado; con contraseña correcta, también la persona. Con la verificación en dos pasos activa, la contraseña correcta responde 200 con `segundo_paso: pendiente` en el detalle (aún sin sesión) y el ingreso se completa en `TWOFA_VERIFICACION` | `POST /api/auth/login` | Cualquiera | 20 fallos/15 min por IP y 10 por cuenta; los bloqueos (429) se auditan |
| `LOGOUT` | Cierre de sesión (revoca el refresh token) | `POST /api/auth/logout` | Cualquiera con cookie | 120/15 min por IP |
| `REFRESH_RECHAZADO` | Renovación de sesión rechazada: token desconocido, vencido, revocado, usuario dado de baja o empresa suspendida (423). Las renovaciones buenas **no** se auditan | `POST /api/auth/refresh` | Cualquiera con cookie | 120/15 min por IP |
| `REFRESH_REUTILIZADO` | Un refresh token que ya se había rotado se presentó otra vez **fuera de la ventana de gracia** (10 s): alguien tiene una copia (robo) o el dueño original usó un token ya cambiado. Se **cierra toda la familia de sesiones** de ese inicio de sesión y se cortan los access tokens vigentes de la persona. Detalle: motivo y cuántos tokens se cerraron. Dentro de la gracia (dos pestañas renovando a la vez) no es un evento | `POST /api/auth/refresh` | Cualquiera con cookie | 120/15 min por IP |
| `ACCESO_DENEGADO` | Una persona **con sesión** pidió algo que su rol no permite (403 de un guard de rol). Detalle: guard, método, ruta y rol. Señal de alguien que prueba rutas de administración. Los 401 sin sesión no se auditan | cualquier ruta protegida | Cualquiera con sesión | General por IP |
| `LIMITE_SESION` | Intento de refresh/logout bloqueado por límite (429) | `/api/auth/refresh`, `/logout` | — | — |
| `LIMITE_TASA_GENERAL` | Petición bloqueada por el límite general por IP (429). **Una fila por IP y minuto**, con la cuenta de lo callado | cualquier ruta | — | 1 000/15 min por IP |
| **Empresas** (owner) | | | | |
| `EMPRESA_CREADA` | Alta de empresa | `POST /api/empresas` | owner | — |
| `EMPRESA_ACTUALIZADA` | Cambio de nombre, NIT o logo | `PUT /api/empresas/:id` | owner | — |
| `EMPRESA_ELIMINADA` | Baja (desactiva sucursales, personal, equipos y sesiones) | `DELETE /api/empresas/:id` | owner | — |
| `EMPRESA_SUSPENDIDA` | Pausa reversible con motivo (impago…) | `PATCH /api/empresas/:id/suspender` | owner | — |
| `EMPRESA_REACTIVADA` | Levanta la suspensión | `PATCH /api/empresas/:id/reactivar` | owner | — |
| `EMPRESA_ELIMINADA_DEFINITIVO` | Borrado físico e irreversible, con la contraseña del owner | `POST /api/empresas/:id/eliminar-definitivo` | owner | 5/15 min por usuario; los bloqueos se auditan |
| `ADMIN_EMPRESA_ASIGNADO` | Asigna el administrador de una empresa | `POST /api/empresas/:id/admin` | owner | — |
| **Planes y suscripciones** (SaaS, T10) | | | | |
| `PLAN_CREADO` | Alta de un plan del catálogo (precio mensual, visitas incluidas, excedente, límites) | `POST /api/planes` | owner | — |
| `PLAN_ACTUALIZADO` | Cambio de precios, cupos o estado de un plan | `PUT /api/planes/:id` | owner | — |
| `SUSCRIPCION_ACTUALIZADA` | Asigna o cambia el plan y/o el estado (prueba/activa/vencida/cancelada) de una empresa; escribe además `suscripcion_historial` | `PUT /api/empresas/:id/suscripcion` | owner | — |
| **Facturación SaaS** (T11) | | | | |
| `FACTURAS_SAAS_GENERADAS` | Corre a mano la facturación mensual (por defecto el mes anterior; `mes` opcional, solo un mes cerrado). Idempotente: una factura por empresa y mes. Manda los avisos de factura emitida | `POST /api/facturas-saas/generar` | owner | 5/15 min por usuario; los bloqueos se auditan |
| `FACTURAS_SAAS_REVISADAS` | Marca como vencidas las facturas pendientes que pasaron su fecha y manda los avisos de pago vencido (pasada la gracia) | `POST /api/facturas-saas/revisar-vencidas` | owner | 5/15 min por usuario; los bloqueos se auditan |
| `FACTURA_SAAS_PAGADA` | El owner confirma el pago de una factura (transferencia, depósito, efectivo u otro) con su referencia. Con `COBRO_PROVEEDOR=visanet` responde 503 y también se audita | `POST /api/facturas-saas/:id/pagar` | owner | — |
| `FACTURA_SAAS_ANULADA` | Anula una factura pendiente o vencida con motivo; la del mes no se vuelve a generar | `POST /api/facturas-saas/:id/anular` | owner | — |
| **Alta autoservicio** (T12; rutas públicas, sin sesión) | | | | |
| `ONBOARDING_SOLICITADO` | Alguien pide dar de alta una empresa con su correo; se manda el enlace del asistente (nunca se revela si el correo ya tenía cuenta). Detalle: dominio del correo y resultado; el campo trampa lo marca `honeypot` | `POST /api/onboarding/solicitar` | Cualquiera | 5/hora por IP + 3/24 h por correo; los bloqueos (429) se auditan |
| `ONBOARDING_BORRADOR_GUARDADO` | Se guarda el borrador del asistente (empresa, sucursal, plan). Detalle: solo los nombres de los campos. También es la acción de los bloqueos (429) de las consultas del enlace | `PUT /api/onboarding/:token/borrador` (y `GET …/:token`) | Quien tiene el enlace | 60/15 min por IP |
| `ONBOARDING_COMPLETADO` | En una sola transacción crea la empresa, su primera sucursal, la suscripción en prueba y la invitación de administrador. Detalle: id de la solicitud y de la empresa | `POST /api/onboarding/:token/completar` | Quien tiene el enlace | 10/hora por IP |
| `ONBOARDING_INVITACION_REENVIADA` | Reenvía la invitación del administrador con enlace nuevo (el anterior deja de servir; máximo 3) | `POST /api/onboarding/:token/reenviar` | Quien tiene el enlace | 10/hora por IP |
| **Página pública** (landing en `/`; ruta pública, sin sesión) | | | | |
| `CONTACTO_RECIBIDO` | Alguien pide una demo desde el formulario del landing; se guarda en `contactos` (no se manda correo). Detalle: solo el id del contacto y el tramo de hogares, nunca el nombre, el teléfono ni el correo. El campo trampa lo marca `honeypot` (responde 201 y no guarda nada); los datos inválidos, `invalido` con los nombres de los campos | `POST /api/contacto` | Cualquiera | 5/hora por IP (`RATE_LIMIT_CONTACTO_MAX`); los bloqueos (429) se auditan |
| **Portabilidad de datos** (T12) | | | | |
| `DATOS_EMPRESA_EXPORTADOS` | Descarga de los datos de la empresa en un .zip de CSV (sucursales, personal, residentes, visitas, pagos, garitas, facturas): incluye datos personales. Detalle: filas por archivo. Nunca contraseñas ni códigos de activación | `GET /api/empresas/:id/exportar` | owner o el admin de esa empresa | 3/hora por usuario; los bloqueos se auditan |
| **Sucursales** | | | | |
| `SUCURSAL_CREADA` | Alta de sucursal | `POST /api/sucursales` | admin de empresa | — |
| `SUCURSAL_ACTUALIZADA` | Edición de sucursal | `PUT /api/sucursales/:id` | admin de empresa | — |
| `SUCURSAL_DESACTIVADA` | Baja de sucursal | `DELETE /api/sucursales/:id` | admin de empresa | — |
| `ADMIN_SUCURSAL_ASIGNADO` | Asigna el administrador de una sucursal | `POST /api/sucursales/:id/admin` | admin de empresa | — |
| **Invitaciones administrativas** | | | | |
| `INVITACION_CREADA` | Invita a un administrador de empresa (owner) o de sucursal (admin de empresa) | `POST /api/invitaciones` | owner / admin de empresa | — |
| `INVITACION_REVOCADA` | Revoca una invitación pendiente | `PATCH /api/invitaciones/:id/revocar` | owner / admin de empresa | — |
| `INVITACION_REENVIADA` | Reenvía una invitación | `POST /api/invitaciones/:id/reenviar` | owner / admin de empresa | — |
| `INVITACION_ACEPTADA` | La persona invitada crea su cuenta (ruta pública con token de un solo uso) | `POST /api/invitaciones/:token/aceptar` | Público | 30/15 min por IP; los bloqueos se auditan |
| **Personal y residentes** | | | | |
| `USUARIO_CREADO` | Alta de cuenta (agente, administrador…) | `POST /api/usuarios` | admin de sucursal o superior | — |
| `USUARIO_EDITADO` | Cambio de nombre, correo, rol o contraseña (sólo los nombres de campo quedan en el detalle; si el cambio de rol le quitó la verificación en dos pasos, `dos_pasos_quitada`) | `PUT /api/usuarios/:id` | admin de sucursal o superior | — |
| `USUARIO_DESACTIVADO` | Baja de una cuenta (cierra sus sesiones) | `DELETE /api/usuarios/:id` | admin de sucursal o superior | — |
| `RESIDENTE_CREADO` | Alta de residente y su cuenta | `POST /api/residentes` | admin de sucursal | — |
| `RESIDENTE_ACTUALIZADO` | Edición de residente | `PUT /api/residentes/:id` | admin de sucursal | — |
| `RESIDENTE_ELIMINADO` | Baja de residente | `DELETE /api/residentes/:id` | admin de sucursal | — |
| **Verificación en dos pasos** (administradores, SCRUM-123) | | | | |
| `TWOFA_INICIADO` | Empieza a configurar el segundo factor: entrega el secreto para el QR (el secreto no se guarda en la bitácora) | `POST /api/auth/2fa/iniciar` | owner, admin de empresa o de sucursal | — |
| `TWOFA_ACTIVADO` | Confirma la contraseña **y** el primer código y la activa; entrega una sola vez los 10 códigos de recuperación. También queda el intento sin contraseña o con una errada (400), con un código errado (400) o bloqueado (429) | `POST /api/auth/2fa/confirmar` | owner, admin de empresa o de sucursal | 10 fallos/15 min por usuario y 5 por persona (bloqueo de 15 min); los bloqueos se auditan |
| `TWOFA_DESACTIVADO` | La desactiva; exige la contraseña **y** un código (TOTP o de recuperación) | `POST /api/auth/2fa/desactivar` | owner, admin de empresa o de sucursal | 5 fallos/15 min por usuario y 5 por persona; los bloqueos se auditan |
| `TWOFA_CODIGOS_REGENERADOS` | Genera 10 códigos de recuperación nuevos (los anteriores dejan de valer); exige un código TOTP | `POST /api/auth/2fa/codigos-recuperacion` | owner, admin de empresa o de sucursal | 10 fallos/15 min por usuario y 5 por persona; los bloqueos se auditan |
| `TWOFA_VERIFICACION` | Segundo paso del ingreso: canjea el desafío del login y un código por la sesión. Correcto (detalle: `via` = `totp` o `recuperacion`), incorrecto (401) o bloqueado (429, detalle: `motivo` o `limite`). **Nunca guarda el código** | `POST /api/auth/2fa/verificar` | Público (con el desafío de 5 min que da el login) | 30 fallos/15 min por IP y 5 por persona (bloqueo de 15 min); los bloqueos se auditan |
| `TWOFA_RESTABLECIDO` | Un superior borra el segundo factor de alguien que perdió el teléfono y los códigos; cierra sus sesiones. Misma regla de alcance que la baja. (El owner se restablece desde la consola: `npm run cuenta:restablecer-2fa`, que deja la misma fila con `via: consola`) | `DELETE /api/usuarios/:id/2fa` | admin de sucursal o superior | — |
| **Equipos de garita** | | | | |
| `LICENCIA_EMITIDA` | Genera un código de activación | `POST /api/licencias` | admin de sucursal o superior | — |
| `LICENCIA_ACTIVADA` | Un equipo canjea su código (ruta pública; la fila lleva la licencia, el equipo y la sucursal) | `POST /api/licencias/activar` | Público | 10/15 min por IP; los bloqueos se auditan |
| `LICENCIA_REVOCADA` | Revoca el código de un equipo | `PATCH /api/licencias/:id/revocar` | admin de sucursal o superior | — |
| `LICENCIA_HEARTBEAT` | Sólo los bloqueos por límite (429); el latido normal está exento | `POST /api/licencias/heartbeat` | Equipo | 60/15 min por IP |
| **Garita y visitantes** | | | | |
| `REGISTRO_ENTRADA` | Entrada de un visitante (también las que llegan de la cola offline) | `POST /api/accesos` | personal | — |
| `REGISTRO_SALIDA` | Salida de un visitante | `PATCH`/`PUT /api/accesos/:id/salida` | personal | — |
| `PREAUTORIZACION_CREADA` | Aviso de visita (administrador o residente) | `POST /api/preautorizaciones`, `/mis` | admin / residente | — |
| `PREAUTORIZACION_ELIMINADA` | Elimina un aviso o un visitante guardado | `DELETE /api/preautorizaciones/:id`, `/mis/:id` | admin / residente | — |
| `BLACKLIST_AGREGADO` | Bloquea a una persona o un vehículo | `POST /api/blacklist` | personal | — |
| `BLACKLIST_REMOVIDO` | Quita un bloqueo | `DELETE /api/blacklist/:id` | personal | — |
| `INVITACION_QR_CREADA` | Invitación con QR de un residente | `POST /api/invitaciones-qr/mis` | residente | — |
| `INVITACION_QR_REVOCADA` | Revoca una invitación con QR | `DELETE /api/invitaciones-qr/mis/:id` | residente | — |
| `CONFIG_QR_ACTUALIZADA` | Cambia las reglas de validación de los QR | `PUT /api/config-qr` | admin de sucursal | — |
| `OCR_DPI` | Lectura de la foto de un DPI (datos personales; cuesta dinero por llamada). La imagen no se guarda | `POST /api/ocr/dpi` | personal | 30/min por usuario |
| `OCR_PLACA` | Lectura de la foto de una placa | `POST /api/ocr/placa` | personal | 30/min por usuario |
| `OCR_ESCANEO` | Lectura bloqueada por límite (429) | `/api/ocr/*` | — | — |
| **Dinero** | | | | |
| `PAGO_TARJETA_SIMULADO` | Intento de pago con tarjeta (aprobado, rechazado, o **422** si el monto supera el saldo). El pago **resta su monto del saldo** (`docs/pagos_saldo.md`) | `POST /api/pagos/tarjeta` | residente | 10/15 min por usuario; los bloqueos se auditan |
| `PAGO_TRANSFERENCIA_ENVIADA` | El residente sube el comprobante de una transferencia (**422** si el monto supera su saldo) | `POST /api/pagos/transferencia` | residente | 10/15 min por usuario; los bloqueos se auditan |
| `PAGO_EFECTIVO` | Registro de un pago en efectivo; resta su monto del saldo (**422** si lo supera) | `POST /api/pagos` | admin de sucursal | — |
| `PAGO_APROBADO` | Aprueba un comprobante; resta su monto del saldo (**422** si ya no cabe: sigue pendiente y hay que rechazarlo) | `PUT /api/pagos/:id/aprobar` | admin de sucursal | — |
| `PAGO_RECHAZADO` | Rechaza un comprobante | `PUT /api/pagos/:id/rechazar` | admin de sucursal | — |
| `CARGO_CONFIG_CREADA` | Alta de una regla de cargo por mora | `POST /api/cargos/configuracion`, `/api/configuracion-cargos` | admin de sucursal | — |
| `CARGO_CONFIG_ACTUALIZADA` | Edición de una regla de cargo | `PUT /api/cargos/configuracion/:id`, `/api/configuracion-cargos/:id` | admin de sucursal | — |
| `CARGO_CONFIG_ELIMINADA` | Baja de una regla de cargo | `DELETE /api/configuracion-cargos/:id` | admin de sucursal | — |
| `CARGO_APLICADO` | Aplica un cargo automático | `PATCH /api/cargos/:id/aplicar` | admin de sucursal | — |
| `CARGO_PROGRAMADO_CREADO` | Alta de un cargo programado | `POST /api/cargos-programados` | admin de sucursal | — |
| `CARGO_PROGRAMADO_ACTUALIZADO` | Edición de un cargo programado | `PUT /api/cargos-programados/:id` | admin de sucursal | — |
| `CARGO_PROGRAMADO_ELIMINADO` | Baja de un cargo programado | `DELETE /api/cargos-programados/:id` | admin de sucursal | — |
| `CARGO_PROGRAMADO_APLICADO` | Aplica un cargo programado a los residentes | `POST /api/cargos-programados/:id/aplicar` | admin de sucursal | — |
| **Comunidad** | | | | |
| `ANUNCIO_CREADO` | Publica un anuncio | `POST /api/anuncios` | admin de sucursal | — |
| `ANUNCIO_EDITADO` | Edita un anuncio | `PUT /api/anuncios/:id` | admin de sucursal | — |
| `ANUNCIO_ELIMINADO` | Elimina un anuncio | `DELETE /api/anuncios/:id` | admin de sucursal | — |
| `AREA_CREADA` | Alta de un área común | `POST /api/areas` | admin de sucursal | — |
| `AREA_ACTUALIZADA` | Edición de un área común | `PUT /api/areas/:id` | admin de sucursal | — |
| `AREA_ELIMINADA` | Baja de un área común | `DELETE /api/areas/:id` | admin de sucursal | — |
| `CREAR_RESERVA` | Reserva de un área (puede generar un cargo) | `POST /api/reservas` | residente / personal | — |
| `RESERVA_CANCELADA` | Cancela una reserva | `PATCH /api/reservas/:id/cancelar` | residente / personal | — |
| `RESERVA_APROBADA` | Aprueba una reserva pendiente | `PATCH /api/reservas/:id/aprobar` | admin de sucursal | — |
| `RESERVA_RECHAZADA` | Rechaza una reserva pendiente | `PATCH /api/reservas/:id/rechazar` | admin de sucursal | — |
| `CONFIG_RESERVAS_ACTUALIZADA` | Cambia las reglas de reservas | `PUT /api/config-reservas` | admin de sucursal | — |
| `TICKET_CREADO` | El residente abre una solicitud | `POST /api/tickets` | residente | 10/15 min por usuario; los bloqueos se auditan |
| `TICKET_CERRADO` | El personal cierra una solicitud | `PUT /api/tickets/:id/cerrar` | personal | — |
| `TICKET_MENSAJE_ENVIADO` | Mensaje en el chat de una solicitud (el texto no se guarda en la bitácora) | `POST /api/tickets/:id/mensajes` | residente / personal | 40/min por usuario; los bloqueos se auditan |
| **Descarga de datos personales** | | | | |
| `REPORTE_ACCESOS_EXPORTADO` | CSV de entradas (DPI, nombre, placa de los visitantes) | `GET /api/reportes/accesos` | admin de sucursal o superior | — |
| `REPORTE_PAGOS_EXPORTADO` | CSV de pagos | `GET /api/reportes/pagos` | admin de sucursal o superior | — |
| **Operación del sistema** (owner) | | | | |
| `JOB_MORA_EJECUTADO` | Dispara a mano la revisión de mora | `POST /api/admin/ejecutar-revision-mora` | owner | — |
| `JOB_RECORDATORIOS_EJECUTADO` | Dispara a mano los recordatorios de reservas | `POST /api/admin/ejecutar-recordatorios-reservas` | owner | — |
| `JOB_INVITACIONES_EJECUTADO` | Dispara a mano la expiración de invitaciones | `POST /api/admin/ejecutar-expiracion-invitaciones` | owner | — |

## Exenciones (rutas que modifican algo y NO se auditan, con el porqué)

La prueba de cobertura falla si aparece una ruta que modifica datos y no está aquí ni lleva `auditLog`.

| Ruta | Por qué |
|---|---|
| `POST /api/auth/refresh` | Una renovación buena ocurre cada hora por sesión y no es una acción sensible. Las **rechazadas** sí se auditan (`REFRESH_RECHAZADO`, dentro del controlador). |
| `PUT /api/usuarios/me/preferencias` | Tema e idioma de la propia persona. |
| `POST /api/anuncios/:id/leer` | Acuse de lectura propio, de alto volumen; el conteo ya vive en `anuncio_lecturas`. |
| `POST /api/licencias/heartbeat` | Latido del equipo cada pocos minutos. Los **bloqueos por límite** (429) sí se auditan (`LICENCIA_HEARTBEAT`). |

Lecturas que **no** se auditan a propósito: listados y consultas del día a día (alto volumen, sin descarga masiva), el padrón que baja la garita (`/api/sync/garita`,
autenticado con licencia, cada pocos minutos) y la propia consulta de la bitácora. Las descargas de datos personales en bloque (CSV) sí.

## Cómo leerlo en el panel

El owner ve la bitácora en **Registro de auditoría**: filtra por **acción** (todas las de arriba, agrupadas), por **resultado** (correctas, rechazadas, **bloqueadas por límite**),
por fechas y por persona. Los intentos bloqueados por un límite de tasa llevan `status_code = 429` y, en el detalle, el nombre del límite que los frenó (`limite`).

## Decisión sobre el bloqueo de login por cuenta (S-10)

Ver `backend/DEUDA_TECNICA.md`, S-10. Resumen de la decisión tomada en el Sprint 9: **se mantiene el bloqueo por cuenta** (10 fallos en 15 min), porque es la única
defensa contra fuerza bruta distribuida (muchas IPs contra un correo), y se compensa así: (1) cada bloqueo queda auditado con el correo y la IP; (2) el bloqueo sólo cuenta
**fallos** (un acceso correcto no lo gasta); (3) los administradores pueden activar la verificación en dos pasos (SCRUM-123, `docs/verificacion_dos_pasos.md`), cuyo bloqueo se cuenta por
intentos propios del segundo factor —que sólo alcanza quien ya sabe la contraseña— y no por los de cualquiera que conozca el correo. Alternativas descartadas y por qué, en el mismo documento.
