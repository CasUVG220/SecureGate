# SaaS · núcleo de planes, suscripciones y uso (Sprint 9 continuación)

> **Estado:** T10 (planes, suscripciones, medición de uso y límites) y T11 (facturación interna mensual, cobro manual y avisos) hechas. Los paneles, el onboarding y la exportación (T12) se agregan abajo cuando esa tarea se complete.
> **Importante:** no existía ningún análisis de modelo de negocio SaaS en `docs/` (el ítem 19 de `docs/qa_backlog_s9.md` dice «NO HECHO» y `PRODUCT.md` no existe).
> Por eso los tres planes de abajo son **SUPUESTOS A CONFIRMAR POR EL EQUIPO**. Están en una tabla (`planes`) con la columna `supuesto = TRUE`; ningún precio está escrito en el código.

## 1. Planes (supuestos a confirmar por el equipo)

Dinero en **centavos enteros** (`BIGINT`), moneda GTQ. Nunca decimales ni `float`: un precio con decimales se rechaza con 400.

| Código | Nombre | Cuota mensual | Visitas incluidas / mes | Visita excedente | Sucursales | Garitas | Prueba |
|---|---|---:|---:|---:|---:|---:|---:|
| `basico` | Básico | Q250.00 (25 000) | 500 | Q0.50 (50) | 1 | 1 | 14 días |
| `estandar` | Estándar | Q600.00 (60 000) | 2 000 | Q0.35 (35) | 3 | 3 | 14 días |
| `profesional` | Profesional | Q1,500.00 (150 000) | 8 000 | Q0.25 (25) | 10 | 10 | 14 días |

- Se siembran con `INSERT … ON CONFLICT (codigo) DO NOTHING`: volver a migrar **no pisa** un precio que el owner ya confirmó o editó (hay prueba).
- Para cambiar un precio se edita la fila (`PUT /api/planes/:id`, solo owner, auditado como `PLAN_ACTUALIZADO`). Un plan nuevo es `POST /api/planes` (`PLAN_CREADO`).
  Un plan con `activo = FALSE` deja de poder asignarse pero las suscripciones que ya lo usan siguen intactas.
- `NULL` en `max_sucursales` / `max_garitas` = sin límite.
- **Qué debe decidir el equipo:** los montos, las visitas incluidas, si la prueba son 14 días, si el excedente se cobra por visita o por bloques, el IVA (hoy los montos son «tal cual», sin impuestos) y si hace falta un plan «a la medida».

## 2. Modelo de datos (`database/init.sql`, idempotente, todas las fechas `TIMESTAMPTZ`)

| Tabla | Para qué |
|---|---|
| `planes` | Catálogo (ver arriba). `codigo` único con formato `[a-z0-9_-]{2,30}`. |
| `suscripciones` | **Una por empresa** (`empresa_id UNIQUE`). `estado` ∈ `prueba` · `activa` · `vencida` · `cancelada`; `ciclo = 'mensual'`; `prueba_hasta`, `cancelada_en`. |
| `suscripcion_historial` | Cada alta o cambio de plan/estado: plan y estado anteriores y nuevos, motivo, quién lo hizo y cuándo. Indexada por `(empresa_id, created_at)`. |

- Una empresa **sin suscripción** (las anteriores a los planes) **no tiene límites** ni cuota: el sistema no le cambia nada hasta que el owner le asigne un plan.
- Al asignar el primer plan, la suscripción nace en `prueba` con `prueba_hasta = ahora + dias_prueba` del plan. Volver a `prueba` desde otro estado reinicia esa fecha.
- El borrado definitivo de una empresa (`eliminar-definitivo`) borra también su histórico y su suscripción.
- No se borra ni se archiva nada de la empresa al vencer o cancelar: `estado` solo informa (tampoco se suspende sola: sección 6.5).

## 3. Medición de uso

**Definición de «visita»:** una fila de `registros_acceso` (la salida actualiza la misma fila, así que entrada + salida son **una** visita) con `autorizado = TRUE`.
No cuentan: las **rechazadas** (`autorizado = FALSE`) ni los duplicados idempotentes. El reenvío de la cola offline lleva el mismo `id_cliente`; el índice único `idx_registros_acceso_id_cliente` ya impide la segunda fila y, además, el conteo usa `COUNT(DISTINCT COALESCE(id_cliente, id))` por si alguna vez llegaran dos.

**Mes calendario en hora de Guatemala**, no en UTC. El rango se arma con `make_timestamptz(año, mes, 1, 0, 0, 0, 'America/Guatemala')`:

| Instante | En Guatemala | En UTC | Cuenta para |
|---|---|---|---|
| `2031-09-30 23:59:59-06` | 30-sep 23:59:59 | 1-oct 05:59:59 | **septiembre** (aunque en UTC ya sea octubre) |
| `2031-10-01 00:00:00-06` | 1-oct 00:00:00 | 1-oct 06:00:00 | **octubre** |

Guatemala no usa horario de verano (UTC−6 todo el año), pero el cálculo lo resuelve Postgres con la zona, no con un desfase fijo en el código.

**Índice:** `idx_registros_acceso_sucursal_entrada ON registros_acceso (sucursal_id, timestamp_entrada) WHERE autorizado = TRUE` (parcial: solo las visitas facturables). La consulta mensual agrupa por empresa con un `JOIN` a `sucursales`.

**Endpoints**

| Ruta | Quién | Qué |
|---|---|---|
| `GET /api/planes` | admin de empresa / owner | Catálogo activo (el owner puede pedir `?todos=1`). |
| `POST /api/planes`, `PUT /api/planes/:id` | owner | Crea / edita planes. Auditado. |
| `GET /api/planes/uso?mes=AAAA-MM` | owner | Consumo de todas las empresas (visitas, incluidas, excedente en centavos). |
| `GET /api/empresas/:id/suscripcion` | owner, o el admin de **esa** empresa | Plan y estado. |
| `PUT /api/empresas/:id/suscripcion` | owner | `plan_id` o `plan_codigo` y/o `estado`, y `motivo`. Auditado (`SUSCRIPCION_ACTUALIZADA`) y con histórico. |
| `GET /api/empresas/:id/suscripcion/historial` | owner, o el admin de esa empresa | Cambios, el más reciente primero. |
| `GET /api/empresas/:id/uso?mes=AAAA-MM` | owner, o el admin de esa empresa | `{ periodo, visitas, incluidas, excedente, excedente_centavos, plan }`. Sin `mes` = el mes actual de Guatemala. |

Un admin de empresa que pide la de otra recibe **404** (igual que «no existe»), para no confirmar qué empresas existen.

## 4. Límites del plan

- `POST /api/sucursales` y `POST /api/licencias` (la «garita» = una licencia de dispositivo no revocada) llaman a `reservarCupo`: toma un candado de transacción por empresa (`pg_advisory_xact_lock`), cuenta lo usado y, si ya se llegó al tope, responde **403** con `{ codigo: 'LIMITE_PLAN', limite, usados, error }`
  («Tu plan Básico permite hasta 1 sucursales… Pide un plan mayor»). El candado hace que **ocho altas simultáneas con tope 3 dejen exactamente 3** (hay prueba).
- Cuentan las sucursales **activas** y las licencias **no revocadas**: revocar una libera el cupo.
- Los límites **no cierran nada ya existente**: bajar de plan a una empresa que ya excede el tope no desactiva sucursales; solo impide crear más.

## 5. Decisiones y cosas que NO se hicieron

- Los precios no se leen del código en ningún lado; el cálculo del excedente usa `precio_visita_extra_centavos` de la fila del plan.
- El cobro está en la sección 6 (factura interna mensual) y lo que falta para cobrar de verdad, en la 7.
- No se agregó la suscripción al alta de empresa (`POST /api/empresas`): se mantiene el comportamiento de siempre y el owner asigna el plan. El asistente de onboarding (T12) la crea.

## 6. Facturación interna mensual (T11)

Cada mes se genera **una factura por empresa** (`facturas_saas`, `UNIQUE (empresa_id, periodo)`) con la cuota del plan y las visitas excedentes. Es un **control de cobro interno**: no es un documento tributario (no pasa por la SAT)
y vive en **tablas propias**, separadas de los pagos y cargos de los residentes (`pagos`, `cargos_*`). Tablas: `facturas_saas`, `facturas_saas_avisos` (un aviso por factura y tipo) y `saas_contadores` (el correlativo).

### 6.1 Cuándo corre

| Tarea (`src/jobs/programacion.ts`, zona America/Guatemala) | Cuándo | Qué hace |
|---|---|---|
| `facturacion.mensual` | día 1 de cada mes, 01:20 | Factura el **mes que terminó** para todas las empresas con suscripción y manda los avisos de «factura emitida». |
| `facturacion.vencidas` | todos los días, 07:30 | Marca `vencida` las pendientes cuya fecha de pago ya pasó y manda los avisos de «pago vencido» que toquen. |

A mano (solo owner, auditado, con límite de 5 por 15 min por usuario, y los bloqueos también se auditan): `POST /api/facturas-saas/generar` (`{ "mes": "AAAA-MM" }` opcional; por defecto el mes anterior; un mes que no terminó responde 422) y `POST /api/facturas-saas/revisar-vencidas`.
**Idempotente**: volver a correrlo no duplica facturas ni gasta números (hay prueba). Cada empresa va en su propia transacción: si una falla, las demás se facturan y el error queda en el registro.

### 6.2 Cómo se calcula (todo en centavos enteros)

1. **Días cobrados.** Empieza el día en que termina la prueba (`prueba_hasta`) —o el día del alta si no hubo prueba— y, si se canceló, termina el día de la cancelación (inclusive). Los días se cuentan en **hora de Guatemala**. Salir de `prueba` (activar, cancelar…) da la prueba por terminada ese día.
2. **Cuota** = cuota del plan si se cobra el mes completo; si no, `round(cuota × días cobrados / días del mes)` (mitades hacia arriba, con enteros).
3. **Visitas incluidas** = las del plan; en un mes parcial se prorratean **hacia arriba** (a favor del cliente): `ceil(incluidas × días cobrados / días del mes)`. Solo cuentan las visitas autorizadas de los días cobrados (mismas reglas de la sección 3).
4. **Excedente** = `max(0, visitas − incluidas) × precio por visita excedente`. **Total** = cuota + excedente (un `CHECK` de la tabla lo exige).
5. Una factura de Q0.00 no se genera. Se factura con el plan vigente al generar la factura (un cambio de plan a mitad de mes aplica a todo ese mes: simplificación a revisar con el equipo).

**Ejemplos** (plan Básico: Q250.00, 500 visitas incluidas, Q0.50 por visita extra; son los de `facturacion.test.ts`):

| Caso | Cálculo | Total |
|---|---|---:|
| Mes completo, 480 visitas | cuota Q250.00, sin excedente | **Q250.00** |
| Mes completo, 620 visitas | Q250.00 + (620 − 500) × Q0.50 = Q250.00 + Q60.00 | **Q310.00** |
| Junio (30 días), 20 días cobrados, 400 visitas | cuota 25 000 × 20 / 30 = 16 666,67 → Q166.67; incluidas ceil(500 × 20 / 30) = 334; excedente (400 − 334) × 50 = Q33.00 | **Q199.67** |
| Febrero (28 días), cancelada el día 14 | cuota 25 000 × 14 / 28 = Q125.00; incluidas 250 | **Q125.00** |
| Alta con prueba que termina el 12 de julio (31 días) | 20 días cobrados (12 al 31); las visitas de la prueba no cuentan | cuota × 20 / 31 |

El **detalle** de cada factura queda en `detalle` (JSON con las líneas «Cuota del plan…» y «Visitas adicionales…»), junto con los datos del plan **de ese momento**: cambiar después el precio del plan no altera facturas ya emitidas.

### 6.3 Número, estados y vencimiento

- **Número correlativo sin huecos**: `SG-000001`, `SG-000002`… Sale de `saas_contadores` con un `UPDATE … RETURNING` en la misma transacción que inserta la factura: si algo falla, el número no se gasta. (Una `SEQUENCE` de Postgres sí deja huecos al hacer rollback.)
  Costo: las emisiones se serializan; con decenas de empresas por mes es irrelevante. Borrar una empresa definitivamente borra también sus facturas y habría huecos: ver «Pendientes».
- **Estados**: `pendiente` → `pagada` (la marca el owner) · `pendiente` → `vencida` (por fecha, la marca el job) · `anulada` (el owner, con motivo, para un error de generación; esa factura **no se regenera**). Una pagada no se anula ni se vuelve a pagar (409).
- **Vencimiento** = fecha de emisión + `SAAS_DIAS_PAGO` días (por defecto 10). Una factura que vence hoy sigue «pendiente» hoy.

### 6.4 Cobro y avisos

- **Interfaz `ProveedorCobro`** (`src/services/cobros/`): `manual` (por defecto) y `visanet`. **Manual**: el owner confirma el pago de una transferencia, un depósito, efectivo u otro (`POST /api/facturas-saas/:id/pagar`, auditado); la **referencia/boleta es obligatoria** en transferencia y depósito.
  **Visanet** es solo el **punto de enchufe**: elegirlo (`COBRO_PROVEEDOR=visanet`) responde 503 sin tocar la factura. No hay credenciales ni contrato: ver `docs/visanet_integracion.md`. Un `COBRO_PROVEEDOR` desconocido lanza error (no cae en silencio al manual).
- **Avisos** (correo por el servicio existente `services/email.ts`, hoy con transporte `log`: **no sale ningún correo real** hasta conectar un proveedor): a los `admin_empresa` activos de la empresa. «Factura emitida» al generarla y «Pago vencido» cuando pasan `SAAS_DIAS_GRACIA` días (por defecto 5) **después** del vencimiento.
  Un aviso por factura y tipo (`UNIQUE`); si la empresa no tiene a quién avisar no se marca como enviado (se reintenta cuando haya un administrador).

### 6.5 Por qué NO se suspende automáticamente

Existe la suspensión manual de una empresa (`PATCH /api/empresas/:id/suspender`), pero **el sistema no la usa por impago**, a propósito:
1. SecureGate controla **el acceso físico** de un condominio: suspender deja sin sistema a la garita y a todos sus residentes por un asunto entre SecureGate y el administrador. Es una decisión humana con contrato en mano.
2. Una factura puede estar mal (error de generación, pago hecho y sin registrar, disputa). Un fallo del job no debe dejar sin servicio a decenas de condominios a la vez.
3. No hay conciliación bancaria automática: «vencida» solo significa «nadie registró el pago».
Por eso el aviso dice «Tu servicio sigue funcionando». El owner decide con la lista de vencidas (`GET /api/facturas-saas?estado=vencida`). Tampoco cambia el `estado` de la suscripción. Hay prueba de que una factura vencida con aviso no suspende ni cambia nada.

### 6.6 Endpoints

| Ruta | Quién | Qué |
|---|---|---|
| `GET /api/facturas-saas?estado=&empresa_id=&periodo=` | owner | Lista (hasta 100). |
| `GET /api/facturas-saas/:id` | owner, o el admin de la empresa dueña | Una factura con su detalle (de otra empresa: 404). |
| `GET /api/empresas/:id/facturas` | owner, o el admin de **esa** empresa | Historial de facturas de la empresa. |
| `POST /api/facturas-saas/generar` · `…/revisar-vencidas` | owner | Corre el job a mano. Auditado, con límite de tasa. |
| `POST /api/facturas-saas/:id/pagar` · `…/anular` | owner | Marca pagada (método, referencia, nota) · anula (motivo). Auditado. |

Configuración: `SAAS_DIAS_PAGO` (1–90, por defecto 10), `SAAS_DIAS_GRACIA` (0–90, por defecto 5), `COBRO_PROVEEDOR` (`manual`|`visanet`), `RATE_LIMIT_FACTURACION_MAX` (por defecto 5).

## 7. Qué falta para cobrar de verdad

- **Confirmar planes y precios** (sección 1): hoy son supuestos.
- **Cobro real**: integración con Visanet/NeoNet (contrato, credenciales, cobro recurrente o enlace de pago, conciliación y manejo de rechazos) detrás de `ProveedorCobro`; hoy solo hay cobro manual.
- **Correo real**: conectar un proveedor (SMTP/SES/SendGrid…) en `services/email.ts`; hoy los avisos solo se escriben en el registro del servidor.
- **Documento tributario**: la factura interna **no** es una factura electrónica (FEL) ni cumple requisitos de la SAT; si SecureGate va a cobrar formalmente hace falta emitir el documento fiscal (certificador FEL), IVA y datos fiscales de cada empresa (NIT, nombre fiscal, dirección).
- **Cambios de plan a mitad de mes** con prorrateo por tramos (hoy aplica el plan vigente al cierre), créditos/notas de abono, descuentos y planes a la medida.
- **Retención de registros**: decidir si el borrado definitivo de una empresa debe conservar sus facturas (hoy las borra con ella).
- **Conciliación**: importar el estado de cuenta del banco para marcar pagos sin intervención manual.

