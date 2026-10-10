# S-17 · TIMESTAMP → TIMESTAMPTZ (SCRUM-124 / SCRUM-177)

Resuelve el «desfase de 6 horas»: Postgres corre en **UTC** y el backend en **America/Guatemala** (UTC−6). Una columna `TIMESTAMP` guarda una hora de reloj **sin zona**; lo que
escribe `NOW()` es la hora UTC, pero el driver `pg` la leía como si fuera hora local de Node, así que la fecha llegaba 6 h corrida. Con `TIMESTAMPTZ` la base guarda el
**instante** y no hay nada que interpretar.

## Qué se veía mal (y ahora está bien)

| Dónde | Antes | Ahora |
|---|---|---|
| Hora de cada fila de la **bitácora de auditoría** (y de tickets, pagos, anuncios, accesos…) | llegaba 6 h adelantada (una acción a las 10:26 se mostraba 16:26) | la hora real, en la zona de Guatemala |
| `refresh_tokens.expires_at` | el token duraba **6 d 18 h** en vez de 7 d | 7 d exactos |
| Fin de un bloqueo temporal de la **lista negra** (`visitante_blacklist.fecha_fin`) | terminaba 6 h antes de lo pedido | termina cuando se pidió |
| Bloqueo de una invitación **QR** por DPI equivocado (`bloqueado_hasta`) | ~6 h 15 min en vez de 15 min | 15 min |
| `invitaciones.expira_en` | Postgres decidía bien (S-02) pero la API la devolvía corrida; el rodeo `expira_en_utc` | un solo valor, sin rodeo |
| Mes de un pago pendiente (`pagos.controller`) | mezclaba la hora UTC del pago con el mes de Guatemala | los dos en Guatemala |

## Cómo se migra (la sección final de `database/init.sql`)

- **Regla general: todas** las columnas `timestamp without time zone` del esquema pasan a `TIMESTAMPTZ`, para que ninguna se quede atrás. Es **idempotente** (solo toca lo que sigue siendo `timestamp`) y corre en cada
  arranque del backend, como el resto de `init.sql`. Los `DEFAULT NOW()`, los índices y las restricciones se conservan.
- **Qué instante tienen los datos que ya existen.** Se conserva lo que Postgres hacía al *comparar* contra `NOW()` (en una sesión UTC, la hora de reloj de una columna `TIMESTAMP` se leía como UTC), así que la conversión es `AT TIME ZONE 'UTC'` y **ninguna comparación en SQL cambia de resultado**.
  Solo dos columnas las escribió Node (un `Date` serializado en hora de Guatemala) y se leen con esa zona: **`refresh_tokens.expires_at`** y **`visitante_blacklist.fecha_fin`**.
- **Qué se escribe desde ahora.** Un `Date` de Node viaja con su zona y se guarda como el instante correcto sin conversión. Lo que el SQL escribe con `NOW()` ya era un instante. Los campos de fecha que se teclean como `AAAA-MM-DD` (anuncios) siguen
  significando «las 00:00 UTC» de ese día, como antes.
- **Si una columna no se puede convertir** (una vista que depende de ella, por ejemplo) se emite un `WARNING` (`[init] S-17: no se pudo convertir tabla.columna…`) y **las demás migraciones del arranque no se pierden** —`init.sql` corre como una sola transacción y un error suelto
  las descartaría todas—. La columna rezagada se comporta como antes. Ver el log del backend tras un despliegue.
- Se corrigió un detalle que habría deshecho todo: `init.sql` volvía a ensanchar `visitante_blacklist.fecha_inicio/fecha_fin` a `TIMESTAMP` **en cada arranque**; ahora solo lo hace si siguen siendo `DATE`.

## Cómo se probó

Sin tocar nunca una base real (solo el Postgres desechable local; el guardia exige una base `*_test`):

- **`esquema.s17.int.test.ts` (I-19)** arma en un esquema aparte el esquema **anterior** (todo `init.sql` hasta la sección S-17), le mete filas con horas de reloj conocidas, corre la migración como lo hará un despliegue sobre datos existentes y comprueba: ninguna columna sin zona;
  los instantes (UTC para lo escrito por Postgres, UTC−6 para los dos casos de Node); los NULL; los `DEFAULT NOW()`; que un `Date` de Node ya se guarda bien; que repetir la migración (y un arranque completo) no cambia nada; y que una columna imposible de convertir no frena a las demás.
- **`horas.int.test.ts` (I-20)** hace acciones reales por HTTP y compara el **instante** que devuelve la API con el momento en que ocurrieron: bitácora, 7 días del refresh token, lista negra, bloqueo de QR, caducidad de invitaciones y hora de entrada. Se comprobó que **las 7 pruebas fallan con el esquema viejo** y pasan con el nuevo.
- **R-2** se reescribió (su causa raíz cambió): ahora también fija que Node lee `expira_en` como un instante pasado y que la columna es `TIMESTAMPTZ`; la prueba nueva **falla con el esquema viejo**. R-1 y R-3 se re-ejecutaron sin cambios.

## Antes de desplegar en producción (lo hace una persona)

Esta sesión no tocó Cloud SQL ni la VM. SCRUM-177 pide probar la migración sobre **una copia de la base real**; las pruebas de arriba usan datos sintéticos. Procedimiento sugerido:

1. `pg_dump` de la base de producción (o un respaldo de Cloud SQL) restaurado en un Postgres **local** descartable.
2. Arrancar el backend de esta rama apuntando a esa copia (`DATABASE_URL` local) y leer el log: debe decir `Esquema al día.` y **ningún** `S-17: no se pudo convertir`.
3. Comprobar: `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND data_type='timestamp without time zone';` → **0 filas**; la hora de la última fila de `audit_logs` en la pantalla de auditoría contra la hora real; un inicio de sesión y una renovación.
4. Recién entonces desplegar. La conversión reescribe cada tabla (bloqueo exclusivo breve): con los volúmenes de hoy son segundos; el backend no atiende peticiones hasta que termina.
5. Marcha atrás: la conversión conserva el instante, así que `ALTER COLUMN … TYPE TIMESTAMP USING col AT TIME ZONE 'UTC'` devuelve la hora de reloj UTC; lo más práctico es restaurar el respaldo previo al despliegue.

## Lo que esto NO cambia (y conviene hacer después)

- Las consultas que agrupan por día u hora (`DATE(timestamp_entrada)`, `EXTRACT(HOUR …)`, `TO_CHAR(…, 'HH24:MI:SS')`, `CURRENT_DATE`) siguen usando la **zona de la sesión de Postgres, UTC**: el tablero de «entradas por hora», el mapa de calor de estadísticas y la hora de entrada del reporte CSV muestran horas UTC, 6 h adelantadas
  respecto a Guatemala (ya era así). Con `TIMESTAMPTZ` el arreglo es de una línea por consulta (`AT TIME ZONE 'America/Guatemala'`) o de una sola vez fijando la zona de sesión del pool (`options: -c timezone=America/Guatemala`); se dejó fuera para no cambiar de golpe tableros y reportes en este ticket.
- `CURRENT_DATE` (UTC) cambia de día a las 18:00 de Guatemala: la vigencia de las invitaciones QR y los avisos de visita se mide con él (el espejo QR de la garita ya usa la fecha local y deja un día de margen).
