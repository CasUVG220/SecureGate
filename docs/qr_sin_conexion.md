# Invitaciones QR sin conexión (SCRUM-126)

Antes, escanear el QR de una invitación **exigía internet**: la vigencia, los usos y la revocación viven en el servidor, y la garita sin red solo podía seguir por el DPI a mano.
Ahora cada equipo de garita guarda una **copia local de las invitaciones de su sucursal** y, cuando el servidor no responde, valida contra ella: un QR vigente se acepta; uno vencido,
revocado o agotado se rechaza. El uso viaja en la cola offline y el servidor lo descuenta **una sola vez** al sincronizar.

## Cómo funciona

| Paso | Qué pasa |
|---|---|
| **Copia local** (SCRUM-181) | `GET /api/sync/garita` ahora trae `invitaciones_qr`. La app la guarda en la tabla `invitaciones_qr_local` del SQLite cifrado y la **reemplaza completa en cada sincronización** (al arrancar, cada 5 min y a mano). Un servidor anterior que no las mande deja la copia vacía, sin error |
| **Qué entra en la copia** | Las invitaciones de la sucursal **de la licencia** que aún pueden servir por fecha (con un día de margen: el servidor mide `CURRENT_DATE` en UTC, que cambia a las 18:00 de Guatemala) y, de las revocadas, solo las del último mes. Las fechas viajan como texto `AAAA-MM-DD`. Quedan fuera las vencidas de antes de ayer y las revocadas viejas |
| **Escanear** (SCRUM-182) | `garita_verificar_qr` pregunta primero al servidor. **Solo** si no hay red o el servidor responde 5xx usa la copia. Un 404/409 del servidor es una decisión suya y se respeta (no se discute con una copia que puede estar vieja) |
| **Reglas sin red** | Las mismas y en el mismo orden que `verificarInvitacion` del backend: revocada → bloqueada por intentos → aún no vigente → vencida → agotada. Los mensajes son los del servidor, con «(revisada sin conexión, con la copia local de este equipo)» al final. Las fechas se comparan con el **día local** de la PC |
| **Usos de este equipo** | La copia trae `usos_actuales` tal como estaba en el servidor. Al validar se le suman los usos que **este equipo** hizo y el servidor aún no cuenta: los que siguen en la cola (`pendiente`) y los que se subieron *después* de pedir la copia (`qr_snapshot_desde`). Los rechazados no cuentan. Así una invitación de **un solo uso no se acepta dos veces** en el mismo equipo, ni siquiera dos paneles a la vez (`encolar_acceso` lo vuelve a comprobar con el bloqueo de la base) |
| **La cola** | `accesos_pendientes.invitacion_qr_id` (columna nueva, con migración que rellena las filas anteriores desde su `payload`) y el mismo `invitacion_qr_id` dentro del `payload` que viaja a `POST /api/accesos` |
| **Descuento en el servidor** (SCRUM-183) | `POST /api/accesos` ya validaba y descontaba con la fila bloqueada (`FOR UPDATE`) y es **idempotente por `id_cliente`**: un reenvío responde `200 duplicado:true` sin volver a descontar, y la carrera entre dos reintentos la resuelve el índice único. Lo nuevo: las **fechas** de vigencia se miden al **día en que entró la persona** (`registrado_en` en la zona de la app) y no al día en que se sincroniza |
| **Aviso en pantalla** | Una invitación validada con la copia lo dice en el aviso y en el formulario: «Validada sin conexión con la copia de este equipo: el servidor la confirma al sincronizar» |

## Qué pasa si un QR se revoca (o se agota) mientras la garita está sin red

La garita decide con lo que sabía en la **última sincronización**. Lo que cambió después no lo ve hasta volver a sincronizar:

| Situación | Sin red (en la garita) | Al volver la red (el uso sube a `POST /api/accesos`) |
|---|---|---|
| La residente **revoca** la invitación después de la última copia | La garita la **acepta** (copia vieja) y la persona entra | El servidor responde **409 «Invitación QR no vigente»**: la fila queda **`rechazado`** con ese motivo en «Registrados en este equipo»; **no se descuenta** ningún uso y **la entrada no se registra en el servidor** (hoy es así para todo rechazo de negocio de la cola, p. ej. lista negra) |
| La invitación se **agota en OTRA garita** (ambas sin red, o la otra ya sincronizó) | Cada garita acepta con lo que sabe | El que sube primero se descuenta; el siguiente recibe **409 «máximo de usos»** y queda `rechazado` |
| **Bloqueada** por intentos fallidos de DPI después de la última copia | Se acepta | 409 «bloqueada temporalmente» → `rechazado` |
| **Vence por fecha** mientras la garita estaba sin red | Se **rechaza** bien: la copia trae `fecha_fin` y se compara con el día local | — |
| Venció **ayer** pero la persona entró **ayer** y la cola sube hoy | Se aceptó ayer (vigente ese día) | **Se acepta**: la vigencia por fechas se mide al día de la entrada, no al de la sincronización |
| La invitación se **creó después** de la última copia | La copia no la conoce: «no está en la copia local… verifícala con conexión o registra con el DPI». El agente puede registrar a mano | Si el agente la registró por el DPI, entra como cualquier visita sin QR |
| El mismo QR se escanea **dos veces seguidas en el mismo equipo** (un solo uso) | La segunda vez se rechaza: la copia suma el uso que ya está en la cola | — |

**Qué ve el equipo de administración:** las entradas rechazadas se conservan siempre en la cola local (no se purgan, a diferencia de las sincronizadas) y el agente las ve con su motivo. El riesgo que se asume es el de cualquier espejo:
**durante la ventana sin red, una invitación revocada entre una sincronización y la siguiente todavía abre la garita**. Se acota por diseño: la copia se refresca cada 5 minutos con red, el servidor revisa todo al subir el uso y el
uso no se descuenta si se rechaza.

## Lo que sigue decidiéndose solo en el servidor

- **El DPI de una invitación individual** (que coincida con el invitado, y el bloqueo tras varios fallos) y **la placa obligatoria** (`configuracion_qr.requiere_placa`) se comprueban al sincronizar: la copia no lleva esa configuración.
- Una **entrada ya ocurrida que el servidor rechaza** al sincronizar (revocada, agotada…) hoy **no se registra**. Siguiente paso recomendado: registrarla igual con una marca «revisar» (la persona ya pasó y la bitácora debería reflejarlo), y que el panel de administración liste los rechazos de la cola.
- `bloqueado_hasta` es de la columna `TIMESTAMP` y hereda el desfase de la deuda **S-17** (se lee 6 h corrido); con S-17 resuelto el bloqueo vale lo que debe.

## Pruebas

- Backend, `integration/qr.offline.int.test.ts` (**I-17**, 16 casos): snapshot (aislamiento por sucursal, qué entra y qué no, formato de fechas, bloqueo), descuento único (reenvío, carrera, un solo uso, 3 de 3), revocada mientras estaba sin red, otra sucursal, y la vigencia al día de la entrada (ayer/hoy, primer y último día, reloj adelantado, sin `registrado_en`).
- Escritorio (Rust, `garita.rs`, `sync.rs`, `db.rs`): cada motivo de rechazo y su orden, fronteras de fecha, id en mayúsculas o con espacios, bloqueo temporal, suma de los usos locales (pendientes / rechazados / subidos antes o después de la copia), `encolar_acceso` (columna, payload y rechazo del segundo uso), reemplazo de la copia, servidor viejo y la migración de una cola anterior.
- Escritorio (vitest): el escáner y el código manual **siguen funcionando sin red**, y el aviso de «validada sin conexión» en el formulario.
