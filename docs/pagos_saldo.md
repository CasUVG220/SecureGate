# Pagos y saldo pendiente — regla vigente (T1, Sprint 9 continuación)

**Un pago resta su monto del saldo.** Antes, un pago ponía `residentes.saldo_pendiente` en 0 sin restar nada: uno parcial borraba la deuda y uno mayor
registraba como ingreso más de lo que se debía (se vio en tarjeta, efectivo y aprobación de transferencias).

| Caso | Resultado |
|---|---|
| Monto **menor** al saldo (pago parcial) | Se acepta. El saldo baja por el monto y queda el resto. El estado (`al_dia` / `mora` / `pendiente`) no cambia. |
| Monto **igual** al saldo | Se acepta. Saldo 0, residente `al_dia`, y se saldan los cargos de reserva que seguían pendientes. |
| Monto **mayor** al saldo (o saldo en 0) | **422** `{ codigo: "EXCEDE_SALDO", saldo_pendiente, error }` con un mensaje en español; no se crea el pago, no se toca el saldo, no se autoriza la tarjeta. No existe «saldo a favor». |
| Monto con más de dos decimales o ≤ 0 | 400 (los centavos son exactos). |

Se aplica igual en los tres métodos:

- **Efectivo** (`POST /api/pagos`, administrador de sucursal): el 422 sale antes de insertar el pago.
- **Transferencia** (`POST /api/pagos/transferencia` + `PUT /api/pagos/:id/aprobar`): el comprobante se rechaza de entrada con 422 si pasa del saldo
  (aviso temprano); la **aprobación** vuelve a comprobarlo con la fila bloqueada, porque el saldo pudo bajar desde que se subió (otro pago). Si ya no cabe,
  responde 422, el pago sigue `pendiente` y quien aprueba debe rechazarlo con un comentario.
- **Tarjeta** (`POST /api/pagos/tarjeta`): se bloquea el saldo y se comprueba **antes** de autorizar el cobro, para no autorizar algo que luego no se
  pueda acreditar.

## Concurrencia
Cada pago corre en una transacción que primero hace `SELECT … FOR UPDATE` sobre la fila del residente (`utils/saldo.ts`, `bloquearSaldo`) y compara en
**centavos enteros**. El `UPDATE` que resta lleva además `WHERE saldo_pendiente >= monto` y la tabla tiene `CHECK (saldo_pendiente >= 0)`: tres capas, así
que dos pagos simultáneos nunca dejan saldo negativo (pruebas en `pagos.int.test.ts`: 5 efectivos a la vez, 2 aprobaciones a la vez, tarjeta + efectivo).
Orden de bloqueos: primero el pago (`FOR UPDATE OF p` al aprobar), después el residente; nunca al revés.

## Cargos de reserva
Los cargos de reserva son filas de `pagos` con `metodo = 'reserva'` y suman al saldo. Un pago parcial **no** elige a cuál cargo se aplica: los cargos siguen
`pendiente` hasta que el saldo llega a 0, y entonces se marcan `aprobado`. (Si se cancela una reserva con cargo pendiente, su monto se resta del saldo con
piso en 0, como antes.)

## Datos históricos
**No se migran ni se tocan.** Los pagos aprobados antes de este cambio pueden tener un monto distinto de lo que realmente abonaron al saldo; los reportes de
ingresos siguen sumando `pagos.monto` aprobado, que desde ahora coincide con lo abonado al saldo.
