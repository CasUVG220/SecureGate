import type { Consultable } from './reservas';

/**
 * Regla de pagos (T1, Sprint 9 continuación): **un pago resta su monto al saldo**.
 *
 *  - Pago menor al saldo (parcial): el saldo baja por el monto y queda el resto.
 *  - Pago igual al saldo: el saldo queda en 0, el residente pasa a «al día» y se
 *    saldan los cargos de reserva que seguían pendientes.
 *  - Pago mayor al saldo (o con saldo en 0): se rechaza con 422. No hay saldo a favor.
 *
 * Antes un pago ponía `saldo_pendiente` en 0 sin restar el monto: uno parcial borraba la
 * deuda y uno mayor registraba un ingreso inflado. Los pagos históricos no se tocan.
 *
 * Todo el dinero se compara en CENTAVOS (enteros) y se resta en NUMERIC dentro de SQL:
 * nunca se acumulan decimales de punto flotante.
 */

export class ExcedeSaldoError extends Error {
  constructor(public readonly saldoCentavos: number, public readonly montoCentavos: number) {
    super('El monto supera el saldo pendiente');
    this.name = 'ExcedeSaldoError';
  }
}

export const aCentavos = (v: unknown): number => Math.round(Number(v) * 100);
export const deCentavos = (c: number): string => (c / 100).toFixed(2);
const quetzales = (c: number): string => `Q${deCentavos(c)}`;

/** Mensaje de la respuesta 422 (español de Guatemala, dice qué pasó y qué hacer). */
export function mensajeExcedeSaldo(e: ExcedeSaldoError): string {
  return e.saldoCentavos <= 0
    ? 'Este residente no tiene saldo pendiente: no hay nada que pagar.'
    : `El monto (${quetzales(e.montoCentavos)}) supera el saldo pendiente (${quetzales(e.saldoCentavos)}). ` +
      `Registra un pago de hasta ${quetzales(e.saldoCentavos)}.`;
}

/** Cuerpo JSON del 422, con el saldo para que la pantalla lo muestre sin otra consulta. */
export function cuerpoExcedeSaldo(e: ExcedeSaldoError) {
  return { error: mensajeExcedeSaldo(e), codigo: 'EXCEDE_SALDO', saldo_pendiente: deCentavos(e.saldoCentavos) };
}

/**
 * Bloquea la fila del residente (`FOR UPDATE`) y devuelve su saldo en centavos.
 * Debe llamarse dentro de una transacción: dos pagos simultáneos del mismo residente
 * se serializan aquí y el segundo ve el saldo que dejó el primero.
 */
export async function bloquearSaldo(db: Consultable, residente_id: string): Promise<number | null> {
  const r = await db.query(
    'SELECT saldo_pendiente FROM residentes WHERE id = $1 FOR UPDATE',
    [residente_id],
  );
  if (r.rows.length === 0) return null;
  return aCentavos(r.rows[0].saldo_pendiente);
}

/** Lanza `ExcedeSaldoError` si el monto no cabe en el saldo (ya bloqueado) del residente. */
export function exigirQueCabe(saldoCentavos: number, montoCentavos: number): void {
  if (montoCentavos > saldoCentavos) throw new ExcedeSaldoError(saldoCentavos, montoCentavos);
}

/**
 * Resta `montoCentavos` al saldo del residente. El `WHERE saldo_pendiente >= monto` es la
 * segunda defensa: aunque alguien llamara sin bloquear antes, la base nunca deja un
 * saldo negativo (además del CHECK de la tabla). Devuelve el saldo que queda, en centavos.
 */
export async function restarDelSaldo(db: Consultable, residente_id: string, montoCentavos: number): Promise<number> {
  const r = await db.query(
    `UPDATE residentes
        SET saldo_pendiente   = saldo_pendiente - $2::numeric,
            estado_pago       = CASE WHEN saldo_pendiente - $2::numeric = 0 THEN 'al_dia' ELSE estado_pago END,
            fecha_ultimo_pago = NOW()
      WHERE id = $1 AND saldo_pendiente >= $2::numeric
      RETURNING saldo_pendiente`,
    [residente_id, deCentavos(montoCentavos)],
  );
  if (r.rows.length === 0) {
    const actual = await db.query('SELECT saldo_pendiente FROM residentes WHERE id = $1', [residente_id]);
    throw new ExcedeSaldoError(aCentavos(actual.rows[0]?.saldo_pendiente ?? 0), montoCentavos);
  }
  return aCentavos(r.rows[0].saldo_pendiente);
}
