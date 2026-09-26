# Resultados — Pruebas de carga y estrés (Sprint 8)

Alcance: los cuatro endpoints que introdujo el Sprint 8 para la **app de escritorio de la garita** y que el
Sprint 7 no cubría: `POST /api/licencias/activar`, `POST /api/licencias/heartbeat`, `GET /api/sync/garita` y
`POST /api/accesos` con `id_cliente` (cola offline idempotente) y licencia de dispositivo.

Ambiente: local (`docker-compose.yml`), backend Node 20 + PostgreSQL 15 en contenedores separados sobre la misma
máquina, con el **pool de `pg` en `max: 20`** (`DB_POOL_MAX`) y los datos semilla de desarrollo. No se corrió contra
la VM de GCP ni contra Cloud SQL: no deben recibir carga sintética y la prueba local no mide su latencia de red.

Fecha de ejecución: 2026-09-29. Herramienta: Artillery 2.0.34 (la misma del Sprint 7). El reporte del Sprint 7
(login, dashboard, estrés de `POST /accesos` y el fix del pool) se conserva íntegro en
[`RESULTADOS-sprint7.md`](RESULTADOS-sprint7.md); aquí se compara contra él en la sección 6.

## Resumen

- **0 errores en 94 761 peticiones** (2 corridas completas de los 4 escenarios + 2 corridas extra de accesos, una de ellas
  con el pool en 10). Ningún 5xx ni timeout; sin excepciones en los logs del backend de la corrida 2.
- **`activar`, `heartbeat` y `sync/garita` no muestran degradación** en el rango probado (hasta 150, 200 y 80 req/s;
  p99 ≤ 19 ms). Con 6–8 de las 20 conexiones del pool y el backend a ≤ 71 % de un núcleo.
- **`POST /accesos` con licencia e `id_cliente` es el único que llega a exigir al sistema:** a partir de ~185 req/s la
  latencia de cola sube (p99 entre 11 y 262 ms según la corrida), el pool llegó a **20 de 20 conexiones** y
  Postgres a **92 % de un núcleo** en su pico. Siguió sin errores.
- **La idempotencia se cumple bajo carga, comprobada en la base:** 10 400 altas nuevas (201) y 3 138 reintentos con el
  mismo `id_cliente` (200 `duplicado`) dejaron **10 400 filas, 10 400 `id_cliente` distintos**, todas `origen = desktop`.
- **La variabilidad entre corridas es grande en la cola** (p99 de 16.9, 130 y 39 ms con la misma configuración), por
  lo que estos números son un orden de magnitud, no una garantía. Ver sección 4e.
- **Lo que no se midió y pesa:** producción usa Cloud SQL (latencia de red por consulta) y `DB_POOL_MAX=10` por
  defecto; `sync/garita` se probó con una sucursal casi vacía (respuesta de 283 bytes). Ver sección 8.

## 1. Herramienta usada

**[Artillery](https://www.artillery.io/) 2.0.34** (`backend/package.json`, devDependency), como en el Sprint 7:
escenarios YAML versionados, `capture`/variables de entorno para inyectar tokens, salida con percentiles por ventana
de 10 s y reportes HTML estáticos propios (`npm run loadtest:report`; `artillery report` está deprecado en 2.x).

Para el Sprint 8 se añadió:
- **`sprint8-processor.js`**: genera un `id_cliente` (UUID v4) y un DPI sintético por iteración, tal como lo hace la app
  antes de encolar un acceso.
- **Payload CSV** (`results/activar-codigos.csv`) con 300 códigos de activación, cada uno con su fingerprint, recorrido
  al azar: ~mitad primeras activaciones (`UPDATE … WHERE fingerprint IS NULL`) y ~mitad reactivaciones desde la misma
  máquina (token nuevo).
- **`muestreo-recursos.sh`**: cada ~1 s toma `docker stats` (CPU y memoria de backend y Postgres) y `pg_stat_activity`
  (conexiones totales y consultas activas) para saber **cuánto** se cargó el sistema y no solo cuánto tardó.
- **`sprint8-resumen.js`**: genera las tablas de este documento directamente desde los JSON y CSV.

## 2. Ambiente y ajuste previo: rate limiting

Los limitadores por IP frenarían a Artillery (una sola IP) mucho antes que al backend: `activar` 10 / 15 min,
`heartbeat` 60 / 15 min, general 1 000 / 15 min. `docker-compose.yml` solo expone algunos de esos overrides, así que en
lugar de tocarlo se creó **`docker-compose.loadtest.yml`**, un override **solo para carga** (límites en 100 000 y
`DB_POOL_MAX` configurable, 20 por defecto):

```bash
docker compose -f docker-compose.yml -f backend/loadtest/docker-compose.loadtest.yml up -d backend
backend/loadtest/run-sprint8.sh        # prepara datos, corre los 4 escenarios y muestrea recursos
docker compose up -d backend           # al terminar: vuelve a los límites de producción
```

Después de cada tanda se volvió a los límites de producción y se restauró la base (los datos sintéticos —10 400
registros de acceso, 300 licencias de prueba— no quedan). Que los límites de producción **sí** funcionan (10
activaciones, 60 heartbeats y 1 000 peticiones por IP, con 429 al superarlos) está medido en
`backend/securitytest/RESULTADOS.md`, sección 3f.

Datos de prueba (`setup-sprint8.sh`, contra las cuentas demo del compose de desarrollo): token de `agente1`, un
`residente_id`, **una licencia activada** (token + fingerprint) de la misma sucursal que el agente y 300 códigos sin
activar.

## 3. Escenarios

| Escenario | Endpoint y qué ejercita | Fases (20 s cada una) |
|---|---|---|
| `sprint8-activar.yml` | `POST /licencias/activar`: búsqueda del código con JOIN a sucursal y empresa, `UPDATE` condicional y firma del JWT de licencia | 10 → 25 → 50 → 100 → 150 VU/s |
| `sprint8-heartbeat.yml` | `POST /licencias/heartbeat`: verifica el JWT, JOIN licencia+sucursal+empresa, comprueba el fingerprint y hace un `UPDATE` | 25 → 50 → 100 → 150 → 200 VU/s |
| `sprint8-sync-garita.yml` | `GET /sync/garita`: doble llave (sesión de agente + licencia) y el snapshot del espejo offline | 5 → 10 → 20 → 40 → 80 VU/s |
| `sprint8-accesos-idcliente.yml` | `POST /accesos` como lo manda la app: con `X-Licencia-Token` (validación extra de licencia) e `id_cliente`. **70 %** altas nuevas y **30 %** reintentos que envían el mismo `id_cliente` dos veces | 20 → 60 → 100 → 140 → 200 VU/s |

En el escenario de accesos las peticiones por segundo superan a los VU/s porque el 30 % de los usuarios virtuales
hace dos peticiones: 200 VU/s ≈ 260 req/s.

## 4. Resultados

Los números de las tablas 4a a 4d son de la **corrida 2** (la que tiene el muestreo de recursos). Las corridas 1 y 3,
sin muestreo, están en la sección 4e. Latencias en milisegundos.

### 4a. Resumen por escenario

| Escenario | VU creados | Peticiones | Duración | req/s medio | Códigos | Errores | p50 | p95 | p99 | p99.9 | máx |
|---|---|---|---|---|---|---|---|---|---|---|---|
| activar | 6700 | 6700 | 100 s | 67 | 200 ×6700 | **0** | 3 | 10.1 | 15 | 47.9 | 89 |
| heartbeat | 10500 | 10500 | 100 s | 105 | 200 ×10500 | **0** | 3 | 7.9 | 19.1 | 104.6 | 138 |
| sync-garita | 3100 | 3100 | 99 s | 31 | 200 ×3100 | **0** | 5 | 10.9 | 13.9 | 22 | 49 |
| accesos-idcliente | 10400 | 13538 | 100 s | 135 | 201 ×10400, 200 ×3138 | **0** | 5 | 18 | 130.3 | 290.1 | 374 |

### 4b. Recursos durante la carga

| Escenario | Backend CPU (media / pico) | Backend memoria (pico) | Postgres CPU (media / pico) | Postgres memoria (pico) | Conexiones a Postgres (pico de 20) | Consultas activas (pico) |
|---|---|---|---|---|---|---|
| activar | 23.1 % / **71 %** | 288.1 MiB | 5.6 % / 8.4 % | 104.8 MiB | **6** | 1 |
| heartbeat | 25.6 % / **70.9 %** | 275.6 MiB | 5.6 % / 8.2 % | 104.9 MiB | **6** | 1 |
| sync | 25.4 % / **59.8 %** | 265.4 MiB | 7.7 % / 10.5 % | 110.1 MiB | **8** | 2 |
| accesos-idcliente | 37.4 % / **253.9 %** | 290.3 MiB | 20.6 % / 92.3 % | 143 MiB | **20** | 2 |

Notas: el CPU de Docker es porcentaje de **un núcleo** (253.9 % ≈ 2.5 núcleos de la VM de Docker); la media se calcula
sobre las muestras con carga real (backend > 15 %). El pool de `pg` tiene `max: 20`.

### 4c. `activar`, `heartbeat` y `sync/garita`

Sin errores ni degradación. Los tres usan **6–8 conexiones** del pool y el backend nunca pasa de 71 % de un núcleo. La
ventana más lenta de cada escenario es la **primera** (calentamiento del JIT y del pool), no la de mayor carga:

- **`activar`:** de 3 a 150 req/s el p50 baja de ~10 a 2 ms. Es una consulta con JOIN por clave primaria y un
  `UPDATE` de una fila; la mitad de las peticiones son reactivaciones y no compiten por el `UPDATE` condicional
  (comprobado en la base: las 300 licencias del pool quedaron activadas).
- **`heartbeat`:** hasta 200 req/s el p50 es 2 ms. Hubo dos ventanas con cola más alta (p99 de 102 y 93 ms a 50 y 148
  req/s, sin relación con la carga: la ventana de 200 req/s tiene p99 de 7 ms), coherente con ruido del host.
- **`sync/garita`:** p99 ≤ 22 ms hasta 80 req/s. **Cuidado con la lectura:** la respuesta pesa **283 bytes de media**
  porque la sucursal demo casi no tiene datos; el costo real del snapshot depende del tamaño de la sucursal
  (sección 8).

**activar: ventanas de 10 s**

| Ventana | req/s | p50 | p95 | p99 | máx | errores |
|---|---|---|---|---|---|---|
| 0–10 s | 3 | 10.1 | 15 | 16 | 19 | 0 |
| 10–20 s | 10 | 10.9 | 19.1 | 53 | 89 | 0 |
| 20–30 s | 15 | 8.9 | 13.1 | 16 | 21 | 0 |
| 30–40 s | 25 | 7.9 | 10.9 | 13.9 | 18 | 0 |
| 40–50 s | 33 | 7 | 10.9 | 15 | 30 | 0 |
| 50–60 s | 50 | 5 | 10.1 | 16 | 54 | 0 |
| 60–70 s | 67 | 4 | 7.9 | 8.9 | 14 | 0 |
| 70–80 s | 100 | 3 | 6 | 16 | 50 | 0 |
| 80–90 s | 117 | 3 | 6 | 8.9 | 15 | 0 |
| 90–100 s | 150 | 2 | 6 | 23.8 | 72 | 0 |
| 100–110 s | 100 | 2 | 6 | 10.1 | 16 | 0 |

**heartbeat: ventanas de 10 s**

| Ventana | req/s | p50 | p95 | p99 | máx | errores |
|---|---|---|---|---|---|---|
| 0–10 s | 23 | 7 | 10.9 | 12.1 | 18 | 0 |
| 10–20 s | 25 | 7 | 10.9 | 13.9 | 15 | 0 |
| 20–30 s | 49 | 5 | 10.1 | 13.9 | 18 | 0 |
| 30–40 s | 50 | 5 | 13.9 | 102.5 | 138 | 0 |
| 40–50 s | 97 | 3 | 7 | 19.9 | 80 | 0 |
| 50–60 s | 100 | 3 | 6 | 10.9 | 32 | 0 |
| 60–70 s | 148 | 2 | 7 | 92.8 | 116 | 0 |
| 70–80 s | 150 | 2 | 7.9 | 29.1 | 41 | 0 |
| 80–90 s | 197 | 2 | 5 | 7 | 14 | 0 |
| 90–100 s | 200 | 2 | 5 | 7 | 30 | 0 |
| 100–110 s | 11 | 2 | 4 | 5 | 5 | 0 |

**sync: ventanas de 10 s**

| Ventana | req/s | p50 | p95 | p99 | máx | errores |
|---|---|---|---|---|---|---|
| 0–10 s | 2 | 7.9 | 10.1 | 10.1 | 16 | 0 |
| 10–20 s | 5 | 8.9 | 13.1 | 16 | 20 | 0 |
| 20–30 s | 7 | 8.9 | 13.1 | 13.9 | 16 | 0 |
| 30–40 s | 10 | 8.9 | 13.1 | 15 | 18 | 0 |
| 40–50 s | 15 | 8.9 | 16 | 22 | 31 | 0 |
| 50–60 s | 20 | 8.9 | 12.1 | 16.9 | 49 | 0 |
| 60–70 s | 30 | 7 | 10.9 | 13.9 | 19 | 0 |
| 70–80 s | 40 | 6 | 10.1 | 13.1 | 18 | 0 |
| 80–90 s | 60 | 5 | 7.9 | 10.1 | 13 | 0 |
| 90–100 s | 80 | 4 | 7 | 8.9 | 10 | 0 |
| 100–110 s | 41 | 4 | 7 | 7.9 | 9 | 0 |

**accesos-idcliente: ventanas de 10 s**

| Ventana | req/s | p50 | p95 | p99 | máx | errores |
|---|---|---|---|---|---|---|
| 0–10 s | 25 | 10.1 | 16 | 19.9 | 26 | 0 |
| 10–20 s | 27 | 8.9 | 15 | 19.1 | 22 | 0 |
| 20–30 s | 77 | 4 | 7.9 | 10.9 | 19 | 0 |
| 30–40 s | 77 | 4 | 7.9 | 13.9 | 35 | 0 |
| 40–50 s | 131 | 3 | 6 | 8.9 | 26 | 0 |
| 50–60 s | 130 | 4 | 7.9 | 16.9 | 58 | 0 |
| 60–70 s | 185 | 7.9 | 46.1 | 262.5 | 374 | 0 |
| 70–80 s | 181 | 7 | 19.9 | 71.5 | 143 | 0 |
| 80–90 s | 262 | 5 | 58.6 | 183.1 | 225 | 0 |
| 90–100 s | 260 | 5 | 12.1 | 74.4 | 104 | 0 |


### 4d. `POST /accesos` con `id_cliente` y licencia

Es el endpoint caliente de la garita: cada petición valida la licencia (consulta con JOIN), busca un posible reintento por
`id_cliente`, comprueba la preautorización y luego abre una transacción de ~6 consultas (residente, agente, blacklist,
upsert de visitante, inserción del registro).

- **De 20 a ~130 req/s:** p99 de 9–20 ms, pool en 5–8 conexiones.
- **Desde ~185 req/s:** aparece la cola. En la corrida 2 el pool pasó a **20/20 conexiones** justo en esa ventana
  y Postgres subió a **92 % de un núcleo** (pico); el p99 llegó a 262 ms y el máximo a 374 ms. A 260 req/s la
  cola siguió alta (p99 183 y 74 ms). El p50 se mantuvo en 5–8 ms: la mayoría de las peticiones no notó nada.
- **Sin errores en ningún momento:** las peticiones esperaron pool pero ninguna llegó al `connectionTimeoutMillis` de
  5 s ni devolvió 5xx.

**Idempotencia (corrida 2), en la base de datos:**

| Comprobación | Resultado |
|---|---|
| Peticiones con `id_cliente` nuevo → 201 | 10 400 |
| Reintentos con el mismo `id_cliente` → 200 `{duplicado: true}` | 3 138 |
| Filas en `registros_acceso` con `id_cliente` | **10 400** |
| `id_cliente` distintos | **10 400** (ningún reintento creó un registro) |
| `origen` de esas filas | `desktop` (viene de la licencia) |

### 4e. Variabilidad entre corridas (mismo escenario, misma configuración)

| Escenario | Corrida 1 (sin muestreo): p50/p95/p99/máx | Corrida 2 (con muestreo): p50/p95/p99/máx |
|---|---|---|
| activar | 3 / 10.1 / 16.9 / 142 ms | 3 / 10.1 / 15 / 89 ms |
| heartbeat | 3 / 7 / 10.1 / 40 ms | 3 / 7.9 / 19.1 / 138 ms |
| sync-garita | 6 / 10.9 / 13.9 / 35 ms | 5 / 10.9 / 13.9 / 49 ms |
| accesos-idcliente | 5 / 10.9 / 16.9 / 95 ms | 5 / 18 / 130.3 / 374 ms |

Por eso se repitió `POST /accesos` (el único con diferencia notable), incluyendo una corrida con el pool en 10:

| Corrida | Pool | Peticiones | Errores | p50 / p95 / p99 / p99.9 / máx | Ventana más lenta |
|---|---|---|---|---|---|
| 1 · sin muestreo | 20 | 13 566 | 0 | 5 / 10.9 / 16.9 / 48.9 / 95 ms | 209 req/s: p99 44.3 ms |
| 2 · con muestreo | 20 | 13 538 | 0 | 5 / 18 / 130.3 / 290.1 / 374 ms | 185 req/s: p99 262.5 ms |
| 3 · sin muestreo | 20 | 13 563 | 0 | 5 / 10.9 / 39.3 / 106.7 / 159 ms | 263 req/s: p99 96.6 ms |
| 4 · sin muestreo | **10** | 13 494 | 0 | 4 / 10.9 / 16 / 47.9 / 59 ms | 206 req/s: p99 30.3 ms |

Lectura: **la cola varía más entre corridas idénticas que entre configuraciones**. La corrida 2 (la peor) es también la que
tuvo el muestreo de `docker stats`/`psql` cada segundo y la desktop de desarrollo corriendo en la misma máquina;
la corrida con pool 10 salió tan bien como la mejor de pool 20. No se puede atribuir la diferencia a una causa
única con este montaje; lo defendible es el rango: **a 185–260 req/s el p99 de `POST /accesos` oscila entre ~11 y ~260 ms,
con 0 errores**, y el pool de 20 puede llegar a saturarse.

## 5. Punto de saturación y capacidad

- **No se encontró punto de quiebre** (errores o timeouts) en ningún escenario ni corrida. El colapso del Sprint 7
  (96 % de fallos a 160 VU/s con el pool en 10) **no reaparece**: aquel fix (mover consultas fuera de la transacción y
  fijar `max`) sigue funcionando también con la consulta extra de licencia.
- **Inicio de saturación de `POST /accesos`: ~185 req/s (≈ 140 VU/s de altas),** cuando el pool toca 20/20 y la cola se
  alarga. Es el mismo orden de magnitud en el que el Sprint 7 empezaba a degradar (140 VU/s), esta vez sin caer.
- **Dimensionamiento.** Una garita manda 1 heartbeat cada 15 min (1/900 req/s); si se supone del orden de un acceso por
  minuto por garita en hora pico (supuesto, no medido), los 200 req/s de heartbeat equivalen a ~180 000 garitas y los
  ~185 req/s de accesos (≈ 11 000 por minuto) a miles de garitas en pico. La capacidad excede por órdenes de magnitud el uso esperado. **El escenario que sí importa es
  la reconexión:** una garita que vuelve tras horas offline vacía su cola de golpe. Por ejemplo, si 50 garitas reconectan a la vez con
  ~500 registros cada una son 25 000 peticiones; que esa ráfaga se reparta (backoff con jitter en la cola de la app)
  importa más que el pool.
- **Restricciones operativas de los límites de producción** (medidas en `securitytest`, sección 3f): `activar`
  admite **10 intentos por IP cada 15 min** (instalar más de 10 garitas desde una misma red en ese lapso da 429) y
  `heartbeat` **60 por IP cada 15 min** (cada garita usa 1, así que hasta ~60 garitas detrás de una misma IP pública).

## 6. Comparación con el Sprint 7

| | Sprint 7 (tras el fix) | Sprint 8 |
|---|---|---|
| Endpoint de referencia | `POST /accesos` (agente, sin licencia) | `POST /accesos` con licencia + `id_cliente` (el 30 % son reintentos) |
| Carga máxima | 200 VU/s (200 req/s), 33 000 peticiones | 200 VU/s (~260 req/s), ~13 500 peticiones por corrida |
| Errores | 0 | 0 (4 corridas) |
| p50 / p95 / p99 | 3 / 7.9 / 12.1 ms | 4–5 / 10.9–18 / 16–130 ms |
| Máximo | 38 ms | 59–374 ms |
| Pool | 20 | 20 (y una corrida con 10) |

`POST /accesos` cuesta algo más que en el Sprint 7 y su cola es más ancha: hay una consulta más de validación de
licencia por petición, una de búsqueda por `id_cliente`, y las ráfagas de 260 req/s exceden lo que el Sprint 7 llegó a
probar. Los tres endpoints nuevos restantes no tienen equivalente previo.

## 7. Relación con las pruebas de seguridad del Sprint 8

Las pruebas de seguridad (`backend/securitytest/RESULTADOS.md`) tocan la carga en tres puntos:

- **Login (S-01):** para cerrar la enumeración de cuentas por tiempo, ahora el login **siempre** ejecuta un `crypt()` de
  costo 12 (~200 ms) también con un correo inexistente. Los intentos fallidos cuestan lo mismo que uno válido; el límite
  de 20 fallos por IP y 10 por cuenta cada 15 min acota el gasto de CPU que puede provocar un atacante.
- **Límites por IP:** los valores usados aquí (relajados) son **solo** para esta medición; los de producción están
  verificados en la suite `09-ratelimit` (429 exacto en el intento 11 de `activar`, 61 de `heartbeat`, 1 001 general).
- **Errores 400 en lugar de 500:** tras S-03 las entradas mal formadas responden 400, así que los 5xx de un tablero de
  monitoreo vuelven a significar fallos reales del servidor.

## 8. Limitaciones

- **Una sola máquina y sin red:** cliente, backend y Postgres comparten CPU con la desktop de desarrollo, el dev server de
  Vite y el propio muestreo. De ahí la variabilidad de la cola (sección 4e). No hay latencia de red entre backend y base.
- **Producción usa otra configuración.** `docker-compose.prod.yml` fija `DB_POOL_MAX=10` (Cloud SQL micro admite 25
  conexiones) y las consultas viajan por el Cloud SQL Auth Proxy: cada consulta tarda más y las conexiones se retienen
  más tiempo. La corrida con pool 10 en local no lo cubre; **antes de dar por bueno el número de producción hay que
  repetir el escenario de accesos contra un Cloud SQL de pruebas** (no contra el de producción).
- **`sync/garita` con datos casi vacíos.** La respuesta pesa 283 bytes de media; con miles de residentes y
  preautorizaciones el costo por petición será mucho mayor. Esta prueba demuestra que el endpoint no tiene un costo fijo
  alto, no que escale a volumen real (misma advertencia que D3 en el Sprint 7: sin datos, el índice no importa).
- **`registros_acceso` crece:** cada corrida de accesos añadió ~10 400 filas; la tabla no tiene aún los índices de D3
  (`backlog/DEUDA_TECNICA.md`), y la corrida 3 partió con ~10 400 filas más que las demás (venía de la corrida 2 sin restaurar la base; la 4 sí
  partió de una base limpia). No se observó un efecto claro, pero es un factor de confusión.
- **CPU de Docker Desktop:** el porcentaje es relativo a un núcleo de la VM, no a la máquina física.
- **Tamaño de la muestra:** 3–4 corridas por escenario; sin repeticiones suficientes para intervalos de confianza.

## 9. Recomendaciones (priorizadas)

1. **Repetir `POST /accesos` y `sync/garita` contra un Cloud SQL de pruebas** con `DB_POOL_MAX=10` y una sucursal
   poblada (miles de residentes). Es lo que separa «funciona en local» de «funciona en producción».
2. **Verificar que la cola offline de la app reintente con backoff y jitter** (la ráfaga de reconexión es el caso
   realista más duro, sección 5) y, si no lo hace, añadirlo.
3. **Hacer visible la saturación del pool:** registrar `pool.waitingCount` cuando sea > 0 (o exponerlo en `/api/status`).
   Hoy solo se nota por la latencia.
4. **Índices de `registros_acceso` y `pagos` (D3)** antes de que el histórico crezca: son la primera causa probable de
   que el CPU de Postgres suba a 90 % con la carga de accesos.
5. **Subir `DB_POOL_MAX` solo junto con `max_connections` de Postgres** (o de Cloud SQL); más conexiones sin más CPU de
   base no bajan la cola, como muestra que el pool 10 rindió igual que el 20.
6. **Documentar en el onboarding** los límites por IP (10 activaciones y ~60 garitas por IP cada 15 min).

## 10. Archivos generados

- `backend/loadtest/sprint8-{activar,heartbeat,sync-garita,accesos-idcliente}.yml` — los 4 escenarios;
  `sprint8-processor.js`, `setup-sprint8.sh`, `run-sprint8.sh`, `muestreo-recursos.sh`, `sprint8-resumen.js`,
  `docker-compose.loadtest.yml`.
- `backend/loadtest/results/sprint8-*.json` y `.html` — salida cruda y reportes de la corrida 2;
  `results/recursos-*.csv` — muestreo de CPU, memoria y conexiones por escenario.
- `results/corrida-1-sin-muestreo/`, `results/corrida-3-accesos-sin-muestreo/`, `results/corrida-4-accesos-pool10/` —
  las otras corridas, para la sección 4e.
- Scripts de npm: `loadtest:activar`, `loadtest:heartbeat`, `loadtest:sync`, `loadtest:accesos-idcliente`.
- `backend/loadtest/RESULTADOS-sprint7.md` — el reporte del Sprint 7, sin cambios.
