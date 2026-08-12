import pool from '../db/pool';
import { APP_TZ } from '../utils/reservas';

export interface RecordatoriosResumen {
  recordatorios_enviados: number;
  reservas_completadas: number;
}

/**
 * Avisa a cada residente de las reservas confirmadas que tiene para mañana, y
 * cierra las que ya pasaron.
 *
 * El recordatorio se hace con una sola sentencia y una CTE modificadora: marcar
 * la reserva como avisada e insertar la notificación quedan atómicos, de modo
 * que dos réplicas del backend corriendo el cron a la vez no pueden duplicar el
 * aviso — los row locks del UPDATE ... WHERE recordatorio_enviado = FALSE
 * deciden el ganador.
 *
 * Las comparaciones usan (NOW() AT TIME ZONE APP_TZ) porque las columnas
 * fecha/hora guardan hora local mientras que NOW() en el contenedor es UTC:
 * a secas, "mañana" sería el día equivocado durante seis horas de cada día.
 *
 * Se ejecuta a diario vía node-cron y también puede dispararse manualmente
 * desde POST /api/admin/ejecutar-recordatorios-reservas (requireOwner).
 */
export const enviarRecordatoriosReservas = async (): Promise<RecordatoriosResumen> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const recordatorios = await client.query(
      `WITH pendientes AS (
         UPDATE reservas_areas r
            SET recordatorio_enviado = TRUE
          WHERE r.estado = 'confirmada'
            AND r.recordatorio_enviado = FALSE
            AND r.fecha = ((NOW() AT TIME ZONE $1::text)::date + 1)
          RETURNING r.id, r.area_id, r.residente_id, r.fecha, r.hora_inicio, r.hora_fin
       )
       INSERT INTO anuncios
         (sucursal_id, residente_id, titulo, contenido, prioridad,
          vigente_desde, vigente_hasta, creado_por)
       SELECT a.sucursal_id, p.residente_id,
              'Recordatorio de reserva',
              'Recordatorio: tienes reservado ' || a.nombre || ' el '
                || to_char(p.fecha, 'DD/MM/YYYY') || ' a las '
                || to_char(p.hora_inicio, 'HH24:MI') || '.',
              'importante', NOW(), (p.fecha + p.hora_fin), NULL
         FROM pendientes p
         JOIN areas_comunes a ON a.id = p.area_id
       RETURNING id`,
      [APP_TZ]
    );

    // Nada más en el flujo escribe 'completada': una reserva confirmada cuyo
    // horario ya terminó se cierra aquí.
    const completadas = await client.query(
      `UPDATE reservas_areas
          SET estado = 'completada'
        WHERE estado = 'confirmada'
          AND (fecha + hora_fin) < (NOW() AT TIME ZONE $1::text)
        RETURNING id`,
      [APP_TZ]
    );

    await client.query('COMMIT');

    return {
      recordatorios_enviados: recordatorios.rowCount ?? 0,
      reservas_completadas: completadas.rowCount ?? 0,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
