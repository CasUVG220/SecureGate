# SaaS · núcleo de planes, suscripciones y uso (Sprint 9 continuación)

> **Estado:** T10 hecha (planes, suscripciones, medición de uso y límites). Las secciones de facturación (T11) y de paneles, onboarding y exportación (T12) se agregan abajo cuando esas tareas se completan.
> **Importante:** no existía ningún análisis de modelo de negocio SaaS en `docs/` (el ítem 19 de `docs/qa_backlog_s9.md` dice «NO HECHO» y `PRODUCT.md` no existe).
> Por eso los tres planes de abajo son **SUPUESTOS A CONFIRMAR POR EL EQUIPO**. Están en una tabla (`planes`) con la columna `supuesto = TRUE`; ningún precio está escrito en el código.

## 1. Planes (supuestos a confirmar por el equipo)

Dinero en **centavos enteros** (`BIGINT`), moneda GTQ. Nunca decimales ni `float`: un precio con decimales se rechaza con 400.

| Código | Nombre | Cuota mensual | Visitas incluidas / mes | Visita excedente | Sucursales | Garitas | Prueba |
|---|---|---:|---:|---:|---:|---:|---:|
| `basico` | Básico | Q250,00 (25 000) | 500 | Q0,50 (50) | 1 | 1 | 14 días |
| `estandar` | Estándar | Q600,00 (60 000) | 2 000 | Q0,35 (35) | 3 | 3 | 14 días |
| `profesional` | Profesional | Q1 500,00 (150 000) | 8 000 | Q0,25 (25) | 10 | 10 | 14 días |

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
- No se borra ni se archiva nada de la empresa al vencer o cancelar: `estado` solo informa (ver T11: tampoco se suspende sola).

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
- No hay cobro todavía: ver T11 (factura interna mensual) y la sección «Qué falta para cobrar de verdad» al final cuando exista.
- No se agregó la suscripción al alta de empresa (`POST /api/empresas`): se mantiene el comportamiento de siempre y el owner asigna el plan. El asistente de onboarding (T12) la crea.
