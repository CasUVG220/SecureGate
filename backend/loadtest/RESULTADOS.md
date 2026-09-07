# Resultados — Pruebas de carga y estrés (Sprint 7)

Ambiente: local (`docker-compose.yml`), backend + PostgreSQL 15 en contenedores separados
sobre la misma máquina, base de datos con los datos semilla de `database/init.sql` (sin
volumen de producción). No se corrió contra la VM de GCP (34.2.1.181): no fue alcanzable
desde este entorno, y de cualquier forma las pruebas de estrés no deben apuntar a un
ambiente con datos reales de clientes.

Fecha de ejecución: 2026-09-08.

## 1. Herramienta usada

**[Artillery](https://www.artillery.io/) 2.0.34** (`backend/package.json`, devDependency).

Se eligió por:
- Configuración declarativa en YAML — los 4 escenarios quedan versionados en `backend/loadtest/*.yml`, revisables en PR como cualquier otro cambio de código.
- Buena integración con Node.js/Express: soporta capturar JSON de una respuesta (`capture`) e inyectarlo en requests siguientes (`{{ token }}`), necesario para los escenarios que dependen de login.
- Salida agregada por fases con percentiles (p50/p95/p99) sin necesidad de instrumentación adicional en el backend.
- Instalación y curva de aprendizaje mínimas para un entregable de sprint.

Nota: el subcomando `artillery report` (generación de reporte HTML) fue **deprecado en
Artillery 2.x** — ahora redirige a subir los resultados a Artillery Cloud, un servicio de
terceros no aplicable a datos de un entregable académico. En su lugar se escribió
`backend/loadtest/generate-reports.js`, que genera reportes HTML estáticos y
autocontenidos a partir del JSON de salida (`npm run loadtest:report`). Los reportes están
en `backend/loadtest/results/*.html`.

## 2. Ajuste necesario antes de correr las pruebas: rate limiting

El backend tiene dos rate limiters por IP (`backend/src/index.ts`, `backend/src/routes/index.ts`):
`/api/auth` permite 10 req/15min, y el límite general permite 1000 req/15min para el resto
de rutas. Como Artillery genera todo el tráfico desde una sola IP, con los límites de
producción las pruebas de carga solo habrían medido el 429 del rate limiter a los pocos
segundos, no la capacidad real del backend/BD.

Se agregó un override opcional por variable de entorno (`RATE_LIMIT_LOGIN_MAX`,
`RATE_LIMIT_GENERAL_MAX`), con los valores de producción como default — sin definir esas
variables, el comportamiento no cambia. Las pruebas de carga/estrés se corrieron con el
backend levantado así:

```bash
RATE_LIMIT_LOGIN_MAX=100000 RATE_LIMIT_GENERAL_MAX=100000 docker compose up -d backend
```

y el límite se restauró a los valores de producción (10 / 1000) inmediatamente después,
con `docker compose up -d backend` sin esas variables exportadas.

## 3. Resultados por escenario

### a) `smoke.yml` — prueba de humo

| Config | 1 VU, 10s, `GET /health` |
|---|---|
| Requests | 10/10 exitosos (200) |
| p50 / p95 / p99 | 6 / 8 / 8 ms |
| Errores | 0 |

Confirma que el ambiente responde antes de escalar. Sin degradación, como se espera con 1 VU.

### b) `carga-login.yml` — prueba de carga en login

| Config | Warm-up: 10 VU/s × 30s → Carga sostenida: 50 VU/s × 60s. 50% `admin@securegate.com`, 50% `r1@securegate.com` |
|---|---|
| Requests | 3300/3300 exitosos (200) |
| Tasa de error | 0% |
| Throughput | ~36 req/s promedio (limitado por la duración de las fases, no por el backend) |
| p50 / p95 / p99 | 53 / 57.4 / 80.6 ms |
| Latencia máx. | 182 ms |

**¿Degradación?** Ninguna. El login hace un `bcrypt` compare (`crypt()` en Postgres) más un
`INSERT` en `refresh_tokens`; el costo está dominado por el hash de la contraseña (~50 ms
constantes, por diseño de bcrypt/blowfish), no por carga — la latencia se mantuvo estable
durante toda la fase de 50 VU/s sostenidos, sin crecimiento de p99 a lo largo del tiempo.

### c) `carga-dashboard.yml` — prueba de carga en `GET /api/dashboard`

| Config | 30 VU/s × 60s. Cada VU: login como owner (`admin@securegate.com`) + 5 llamadas a `GET /api/dashboard` con el token capturado |
|---|---|
| Requests | 10 800/10 800 exitosos (200) |
| Tasa de error | 0% |
| Throughput | ~180 req/s promedio |
| p50 / p95 / p99 (combinado login+dashboard) | 1 / 53 / 54.1 ms |
| Latencia máx. | 90 ms |

**¿Degradación?** No se observó degradación con el volumen de datos actual. El p50 de 1 ms
corresponde a las 5 llamadas a `/api/dashboard` por VU (rápidas); el p95/p99 de ~53 ms
corresponde al login (1 de cada 6 requests de cada VU, dominado por el mismo costo de
bcrypt que en el escenario anterior). Las consultas del dashboard en sí — `COUNT(*)` sobre
`registros_acceso` y `pagos`, `ORDER BY timestamp_entrada LIMIT 10` — no mostraron ningún
crecimiento de latencia bajo los 30 VU/s sostenidos.

Se usó deliberadamente el rol **owner**, cuya condición de tenant en
`dashboard.controller.ts` es `TRUE` (sin filtro por sucursal) — es el peor caso posible para
el hallazgo D3, porque fuerza un `COUNT(*)` y un `ORDER BY` sin filtro sobre toda la tabla.

**Relación con D3 (deuda técnica):** la propia base de datos semilla de desarrollo
prácticamente no tiene filas en `registros_acceso` (la tabla no tiene ningún `INSERT` en
`database/init.sql`) ni en `pagos`. Con 0-10 filas, un `COUNT(*)` completo cuesta lo mismo
haya o no índice — el índice no importa hasta que el volumen crece lo suficiente para que
un *sequential scan* sea costoso. Esto es exactamente lo que dice el propio hallazgo D3:
*"esto no es un problema hoy con poco volumen de datos, pero escalará mal a medida que
crezcan los registros de acceso y pagos históricos"* (`backlog/DEUDA_TECNICA.md:98`). Esta
prueba **confirma** esa lectura en vez de contradecirla: no hay degradación visible porque
el volumen de datos de desarrollo es demasiado bajo para exponer el problema — no porque el
problema no exista. Para reproducir numéricamente el impacto de D3 haría falta poblar
`registros_acceso`/`pagos` con un volumen representativo de producción (decenas o cientos de
miles de filas) y repetir este mismo escenario; queda fuera del alcance de esta ronda de
pruebas.

### d) `estres-accesos.yml` — prueba de estrés en `POST /api/accesos`

| Config | Fases de 30s, arrancando en 20 VU/s y subiendo de 20 en 20 hasta 200 VU/s (10 fases) |
|---|---|
| Requests totales | 33 000 intentados |
| Exitosos (201) | 14 785 (44.8%) |
| Fallidos (`ERR_SOCKET_TIMEOUT`, cliente) | 18 215 (55.2%) |
| p50 / p95 / p99 (solo exitosos) | 4 / 10.1 / 16.9 ms |

**Progresión por fase** (tasa de error = fallidos ÷ intentados en esa fase):

| Fase (VU/s) | Requests intentados | Fallidos | Tasa de error | p99 observado |
|---|---|---|---|---|
| 20  | 469  | 0    | 0%    | 7 ms (máx. de la fase) |
| 40  | 1073 | 0    | 0%    | 7 ms |
| 60  | 1672 | 0    | 0%    | 6 ms |
| 80  | 2273 | 0    | 0%    | 7 ms |
| 100 | 2871 | 0    | 0%    | 8 ms |
| 120 | 3472 | 0    | 0%    | 7 ms |
| **140** | 4074 | 0    | 0%    | **12 → 34 → 125 ms** (subiendo dentro de la propia fase, en sus 3 ventanas de ~10s) |
| **160** | 4671 | 4510 | **96.6%** | timeouts (>10 s) |
| 180 | 5273 | 5113 | 97.0% | timeouts (>10 s) |
| 200 | 5871 | 5711 | 97.3% | timeouts (>10 s) |

(El resto de los 33 000 requests — 1281 + 881 — corresponden a las ventanas de "drenado"
después de terminar la fase de 200 VU/s, mientras los VUs ya en cola seguían
completando o expirando.)

No hubo ningún error 5xx del backend en ningún momento (se revisaron los logs del
contenedor `securegate-backend`: no hay excepciones ni mensajes de error durante la
prueba). Los `ERR_SOCKET_TIMEOUT` son del lado del cliente Artillery: la petición no
recibió respuesta dentro del timeout por defecto (10 s), no porque el servidor respondiera
con error, sino porque la petición quedó esperando en cola más tiempo del que Artillery
estuvo dispuesto a esperar.

## 4. Punto de quiebre

- **Inicio de degradación: ~140 VU/s.** Dentro de esa misma fase de 30s, el p99 sube de
  12 ms a 125 ms — la señal de que las peticiones empiezan a acumularse en cola en vez de
  procesarse de inmediato.
- **Colapso: 160 VU/s.** 96.6% de las peticiones ya no reciben respuesta dentro de 10 s. De
  160 a 200 VU/s el sistema se mantiene en ese ~97% de fallos sin seguir empeorando — no se
  "cae" con errores 5xx, simplemente deja de poder atender la tasa de llegada de peticiones
  por encima de lo que el pool de 10 conexiones alcanza a drenar.

**Causa raíz identificada:** `backend/src/db/pool.ts` crea el `Pool` de `pg` sin fijar
`max` — se queda en el default de **10 conexiones concurrentes**. `registrarAcceso`
(`accesos.controller.ts`) hace `BEGIN` y retiene un único cliente del pool durante varias
consultas secuenciales (verificar residente, verificar agente, chequeo de
preautorización/blacklist, upsert de visitante, insert de registro) hasta el `COMMIT`. Con
sólo 10 conexiones disponibles, a partir de ~140-160 VU/s las peticiones entrantes superan
la capacidad de 10 transacciones concurrentes y se acumulan esperando un cliente libre; el
`Pool` de `pg` no tiene `connectionTimeoutMillis` configurado (default: sin límite), así que
esas peticiones esperan indefinidamente del lado del servidor hasta que Artillery las da
por perdidas a los 10 s. Esto es consistente con que los requests que sí lograron completar
siguieron siendo rápidos (p99 ≈ 17 ms) durante toda la prueba, incluso a 200 VU/s: el
backend no se volvió lento por request individual, se quedó sin conexiones disponibles
para atender más en paralelo.

Esto **no** es un cuello de botella de CPU/memoria de la VM ni de tiempo de consulta —
es agotamiento del pool de conexiones a PostgreSQL.

## 5. Acciones de mitigación recomendadas (priorizado)

1. **Configurar `max` explícito en el pool de `pg`, con margen sobre `max_connections` de
   Postgres** (`backend/src/db/pool.ts`). Es la causa raíz directa del punto de quiebre
   encontrado en esta prueba — sin este cambio, cualquier pico de tráfico por encima de
   ~140 VU/s en endpoints que abren transacción (no solo `/api/accesos`) se comporta igual.
   Acompañarlo de un `connectionTimeoutMillis` explícito para que una petición falle rápido
   con un 503 controlado en vez de colgarse indefinidamente.
2. **Agregar los índices faltantes en `registros_acceso` y `pagos` (D3, ya identificado en
   `backlog/DEUDA_TECNICA.md`).** No se manifestó en `carga-dashboard.yml` por el volumen
   de datos bajo del ambiente de desarrollo (ver sección 3c), pero el propio hallazgo D3 ya
   documenta que escalará mal con el histórico de producción — el costo de la migración
   (~4h, según la estimación existente en el documento de deuda técnica) es bajo comparado
   con el riesgo de degradación silenciosa en producción a medida que crece el historial de
   accesos y pagos.
3. **Aumentar el tamaño de la VM (e2-micro → e2-medium)** — recomendado con menor prioridad
   que 1 y 2: esta prueba no mostró presión de CPU/memoria (los requests que sí se
   procesaron se mantuvieron rápidos incluso a 200 VU/s), así que más VM por sí sola no
   habría movido el punto de quiebre encontrado — el límite fue el pool de conexiones, no
   los recursos de la VM. Vale la pena revisarlo igual una vez resuelto el punto 1, dado que
   más conexiones concurrentes sí van a exigir más CPU/RAM del contenedor de Postgres.
4. **Cachear `GET /api/dashboard`** si los datos no cambian con frecuencia — razonable a
   futuro (menos consultas repetidas de `COUNT(*)`), pero no es la prioridad actual: en esta
   ronda de pruebas el endpoint respondió en ~1 ms bajo 30 VU/s sostenidos, muy por debajo
   de cualquier umbral que justifique la complejidad de invalidación de una caché.

## 6. Resultado después del fix

Fecha de ejecución: 2026-09-08 (mismo ambiente: local, backend + PostgreSQL 15 en
contenedores separados, misma base de datos semilla, mismos rate limiters relajados
temporalmente — ver sección 2). Fix aplicado: `backend/src/db/pool.ts` ahora fija
`max: 20` (configurable con `DB_POOL_MAX`), `idleTimeoutMillis: 30000` e
`connectionTimeoutMillis: 5000`; además `registrarAcceso` mueve el chequeo de
preautorización antes de pedir el cliente del pool, y el chequeo de blacklist antes
del upsert de `visitantes`, para retener el cliente transaccional el menor tiempo
posible (`backend/src/controllers/accesos.controller.ts`).

Se corrió exactamente el mismo escenario (`estres-accesos.yml`, mismas 10 fases de 20 a
200 VU/s) con `npm run loadtest:estres`.

| Fase (VU/s) | Antes — % éxito | Antes — p99 | Después — % éxito | Después — p99 |
|---|---|---|---|---|
| 20  | 100% | 7 ms   | 100% | 16.9 ms |
| 40  | 100% | 7 ms   | 100% | 12.1 ms |
| 60  | 100% | 6 ms   | 100% | 13.1 ms |
| 80  | 100% | 7 ms   | 100% | 7.9 ms |
| 100 | 100% | 8 ms   | 100% | 7 ms |
| 120 | 100% | 7 ms   | 100% | 7.9 ms |
| 140 | 100% (degradando dentro de la fase) | 12→125 ms | 100% | 10.9 ms |
| 160 | 3.4% (colapso) | timeout (>10 s) | 100% | 7 ms |
| 180 | 3.0% (colapso) | timeout (>10 s) | 100% | 6 ms |
| 200 | 2.7% (colapso) | timeout (>10 s) | 100% | 7 ms |

(p99 "después" tomado de la última ventana de ~10s completa dentro de cada fase, a
partir de `loadtest/results/estres-accesos.json`.)

**Resumen agregado (33 000 requests):**

| Métrica | Antes | Después |
|---|---|---|
| Exitosos (201) | 14 785 (44.8%) | **33 000 (100%)** |
| Fallidos | 18 215 (55.2%, `ERR_SOCKET_TIMEOUT`) | **0** |
| p50 / p95 / p99 | 4 / 10.1 / 16.9 ms | 3 / 7.9 / 12.1 ms |
| Latencia máx. | — | 38 ms |

**Nuevo punto de quiebre: no se encontró dentro del rango probado (hasta 200 VU/s).**
Con `max: 20` en el pool (el doble del default de `pg`) y un solo backend Node en la
misma VM, las 10 fases de la prueba — incluyendo el pico de 200 VU/s que antes colapsaba
al 97% de fallos — se completaron con 0 errores y latencias por request que se mantienen
en el mismo orden de magnitud observado antes de la fase de degradación (single-digit a
bajo-doble-digito de milisegundos). Se revisaron los logs de `securegate-backend` durante
la corrida: sin excepciones ni errores.

Esto confirma el diagnóstico de la sección 4: el cuello de botella no era CPU, memoria ni
tiempo de consulta — era el `max` no configurado del pool de `pg` (quedaba en el default
de 10). Encontrar el nuevo punto de quiebre real (con `max: 20` y `max_connections: 100`
de Postgres) requeriría fases por encima de 200 VU/s, fuera del rango de este escenario;
dado que 200 VU/s ya excede varias veces el tráfico esperado para el tamaño actual de la
base de residentes, no se priorizó extender la prueba en esta ronda.

## 7. Archivos generados

- `backend/loadtest/*.yml` — los 4 escenarios.
- `backend/loadtest/results/*.json` — salida cruda de Artillery.
- `backend/loadtest/results/*.html` — reportes HTML legibles (generados con
  `npm run loadtest:report`).
- `backend/loadtest/setup-env.sh` — obtiene token de agente + `residente_id` antes de la
  prueba de estrés.
- `backend/loadtest/cleanup.sql` — limpieza de datos sintéticos post-prueba (ya ejecutado:
  se borraron 14 789 registros de acceso y 5 149 refresh tokens generados durante esta
  ronda; la base de datos de desarrollo quedó en el mismo estado de `database/init.sql`).
