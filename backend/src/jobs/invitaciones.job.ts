import pool from '../db/pool';

export interface ExpiracionInvitacionesResumen {
  expiradas: number;
}

/**
 * Marca como 'expirada' toda invitación pendiente cuyo plazo (72 h) ya pasó.
 *
 * Es contabilidad, no seguridad: los endpoints ya tratan una pendiente vencida
 * como expirada al vuelo (ver estadoEfectivo). El job deja la tabla limpia
 * para los listados y reportes. Corre a diario vía node-cron y se puede
 * disparar a mano desde POST /api/admin/ejecutar-expiracion-invitaciones.
 */
export const expirarInvitaciones = async (): Promise<ExpiracionInvitacionesResumen> => {
  const r = await pool.query(
    `UPDATE invitaciones
     SET estado = 'expirada'
     WHERE estado = 'pendiente' AND expira_en <= NOW()
     RETURNING id`,
  );
  return { expiradas: r.rowCount ?? 0 };
};
