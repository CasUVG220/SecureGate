import pool from '../db/pool';

export interface RevisionMoraResumen {
  movidos_a_pendiente: number;
  movidos_a_mora: number;
}

/**
 * Recorre los residentes con deuda y mueve su estado_pago según la antigüedad
 * del último pago:
 *   - Sin pago registrado o hace más de 30 días  → 'mora'
 *   - Entre 15 y 30 días (y aún 'al_dia')        → 'pendiente'
 *
 * Se ejecuta a diario vía node-cron y también puede dispararse manualmente
 * desde POST /api/admin/ejecutar-revision-mora (requireOwner).
 */
export const revisarEstadosMora = async (): Promise<RevisionMoraResumen> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Deuda vencida (>30 días o sin pago) → mora
    const mora = await client.query(
      `UPDATE residentes
       SET estado_pago = 'mora'
       WHERE saldo_pendiente > 0
         AND estado_pago <> 'mora'
         AND (fecha_ultimo_pago IS NULL
              OR fecha_ultimo_pago < NOW() - INTERVAL '30 days')
       RETURNING id`
    );

    // Deuda de 15–30 días y todavía al día → pendiente
    const pendiente = await client.query(
      `UPDATE residentes
       SET estado_pago = 'pendiente'
       WHERE saldo_pendiente > 0
         AND estado_pago = 'al_dia'
         AND fecha_ultimo_pago IS NOT NULL
         AND fecha_ultimo_pago <  NOW() - INTERVAL '15 days'
         AND fecha_ultimo_pago >= NOW() - INTERVAL '30 days'
       RETURNING id`
    );

    await client.query('COMMIT');

    return {
      movidos_a_pendiente: pendiente.rowCount ?? 0,
      movidos_a_mora:      mora.rowCount ?? 0,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
