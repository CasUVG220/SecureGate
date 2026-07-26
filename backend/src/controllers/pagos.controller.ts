import { Request, Response } from 'express';
import pool from '../db/pool';
import { tenantFilter, ownershipClause, ownershipParams } from '../utils/tenant';
import { APP_TZ, Consultable } from '../utils/reservas';

/**
 * Marca como saldados los cargos de reserva pendientes del residente.
 *
 * El flujo de pagos del proyecto liquida todo de una vez (pone
 * saldo_pendiente = 0 en vez de restar el monto). Los cargos de reserva viven
 * en la misma tabla `pagos` con metodo = 'reserva', así que sin esto quedarían
 * en 'pendiente' para siempre mientras el saldo que representan se borra: deuda
 * huérfana. Se conserva la semántica existente ("un pago liquida todo") y se
 * extiende a los cargos de reserva.
 */
export async function liquidarCargosReserva(
  db: Consultable,
  residente_id: string
): Promise<number> {
  const result = await db.query(
    `UPDATE pagos SET estado = 'aprobado'
      WHERE residente_id = $1 AND metodo = 'reserva' AND estado = 'pendiente'
      RETURNING id`,
    [residente_id]
  );
  return result.rowCount ?? 0;
}

export const getPagos = async (req: Request, res: Response) => {
  const ts = tenantFilter(req.user!, 'p');
  try {
    const result = await pool.query(
      `SELECT p.*, r.numero_casa, u.nombre AS residente_nombre
       FROM pagos p
       JOIN residentes r ON p.residente_id = r.id
       JOIN usuarios   u ON r.usuario_id   = u.id
       ${ts.joinClause}
       WHERE ${ts.whereClause}
       ORDER BY p.fecha_pago DESC`,
      ts.params
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener pagos', detail: String(error) });
  }
};

export const createPago = async (req: Request, res: Response) => {
  const { residente_id, monto, comprobante } = req.body;
  const registrado_por = req.user?.id;

  if (!residente_id || monto === undefined || !registrado_por) {
    return res.status(400).json({ error: 'Campos requeridos: residente_id, monto' });
  }
  if (Number(monto) <= 0) {
    return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get residente + sucursal_id in one query
    const residente = await client.query(
      'SELECT id, sucursal_id FROM residentes WHERE id = $1',
      [residente_id]
    );
    if (residente.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Residente no encontrado' });
    }
    const sucursal_id: string = residente.rows[0].sucursal_id;

    const pagoResult = await client.query(
      `INSERT INTO pagos
         (sucursal_id, residente_id, monto, metodo, estado, comprobante, registrado_por)
       VALUES ($1, $2, $3, 'efectivo', 'aprobado', $4, $5)
       RETURNING *`,
      [sucursal_id, residente_id, monto, comprobante || null, registrado_por]
    );

    await liquidarCargosReserva(client, residente_id);

    await client.query(
      `UPDATE residentes
       SET estado_pago = 'al_dia', saldo_pendiente = 0, fecha_ultimo_pago = NOW()
       WHERE id = $1`,
      [residente_id]
    );

    await client.query('COMMIT');
    res.status(201).json(pagoResult.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Error al crear pago', detail: String(error) });
  } finally {
    client.release();
  }
};

export const aprobarPago = async (req: Request, res: Response) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const pagoResult = await client.query(
      `SELECT p.residente_id, p.estado
       FROM pagos p
       WHERE p.id = $1
         AND ${ownershipClause('p', 2)}`,
      [id, ...ownershipParams(req.user!)]
    );
    if (pagoResult.rows.length === 0) {
      await client.query('ROLLBACK');
      const existe = await pool.query('SELECT id FROM pagos WHERE id = $1', [id]);
      return existe.rows.length === 0
        ? res.status(404).json({ error: 'Pago no encontrado' })
        : res.status(403).json({ error: 'Sin acceso a este pago' });
    }
    if (pagoResult.rows[0].estado === 'aprobado') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'El pago ya fue aprobado' });
    }

    const updated = await client.query(
      `UPDATE pagos SET estado = 'aprobado' WHERE id = $1 RETURNING *`, [id]
    );

    await liquidarCargosReserva(client, pagoResult.rows[0].residente_id);

    await client.query(
      `UPDATE residentes
       SET estado_pago = 'al_dia', saldo_pendiente = 0, fecha_ultimo_pago = NOW()
       WHERE id = $1`,
      [pagoResult.rows[0].residente_id]
    );

    await client.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Error al aprobar pago', detail: String(error) });
  } finally {
    client.release();
  }
};

export const rechazarPago = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { comentario_rechazo } = req.body ?? {};
  try {
    const result = await pool.query(
      `UPDATE pagos
       SET estado = 'rechazado', comentario_rechazo = $2
       WHERE id = $1
         AND estado = 'pendiente'
         AND ${ownershipClause('pagos', 3)}
       RETURNING *`,
      [id, comentario_rechazo || null, ...ownershipParams(req.user!)]
    );
    if (result.rows.length === 0) {
      const existe = await pool.query('SELECT id, estado FROM pagos WHERE id = $1', [id]);
      if (existe.rows.length === 0) {
        return res.status(404).json({ error: 'Pago no encontrado' });
      }
      if (existe.rows[0].estado !== 'pendiente') {
        return res.status(409).json({ error: `El pago ya tiene estado '${existe.rows[0].estado}'` });
      }
      return res.status(403).json({ error: 'Sin acceso a este pago' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al rechazar pago', detail: String(error) });
  }
};

export const crearTransferencia = async (req: Request, res: Response) => {
  const usuario_id = req.user?.id;
  const { monto, referencia, banco, fecha_transferencia, comprobante } = req.body;

  if (!monto || !referencia || !banco || !fecha_transferencia) {
    return res.status(400).json({
      error: 'Campos requeridos: monto, referencia, banco, fecha_transferencia',
    });
  }
  if (Number(monto) <= 0) {
    return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
  }

  try {
    const residente = await pool.query(
      'SELECT id, sucursal_id FROM residentes WHERE usuario_id = $1', [usuario_id]
    );
    if (residente.rows.length === 0) {
      return res.status(404).json({ error: 'Residente no encontrado' });
    }
    const { id: residente_id, sucursal_id } = residente.rows[0];

    const result = await pool.query(
      `INSERT INTO pagos
         (sucursal_id, residente_id, monto, metodo, estado,
          referencia, banco, fecha_transferencia, comprobante, registrado_por)
       VALUES ($1, $2, $3, 'transferencia', 'pendiente', $4, $5, $6, $7, $8)
       RETURNING *`,
      [sucursal_id, residente_id, monto, referencia, banco,
       fecha_transferencia, comprobante || null, usuario_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al registrar comprobante', detail: String(error) });
  }
};

export const getPendientesVerificacion = async (req: Request, res: Response) => {
  const ts = tenantFilter(req.user!, 'p');
  const extraOffset = ts.params.length + 1;
  try {
    const result = await pool.query(
      `SELECT p.*,
              r.numero_casa, r.saldo_pendiente, r.estado_pago,
              u.nombre AS residente_nombre, u.email AS residente_email,
              r.telefono AS residente_telefono
       FROM pagos p
       JOIN residentes r ON p.residente_id = r.id
       JOIN usuarios   u ON r.usuario_id   = u.id
       ${ts.joinClause}
       WHERE ${ts.whereClause}
         AND p.metodo = 'transferencia'
         AND p.estado = $${extraOffset}
       ORDER BY p.fecha_pago ASC`,
      [...ts.params, 'pendiente']
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener pagos pendientes', detail: String(error) });
  }
};

export const getMisPagos = async (req: Request, res: Response) => {
  const usuario_id = req.user?.id;
  try {
    const residente = await pool.query(
      'SELECT id FROM residentes WHERE usuario_id = $1', [usuario_id]
    );
    if (residente.rows.length === 0) {
      return res.status(404).json({ error: 'Residente no encontrado' });
    }
    const result = await pool.query(
      `SELECT * FROM pagos WHERE residente_id = $1 ORDER BY fecha_pago DESC LIMIT 20`,
      [residente.rows[0].id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener pagos', detail: String(error) });
  }
};

/**
 * Resumen de la factura del mes en curso para el residente logueado.
 *
 * Desglosa los cargos pendientes por concepto (cuota de mantenimiento, reservas
 * de áreas comunes, etc.) para que el residente vea de dónde sale su saldo y no
 * confunda el cargo de una reserva con la cuota.
 */
export const getMiResumenMes = async (req: Request, res: Response) => {
  const usuario_id = req.user?.id;
  try {
    const residente = await pool.query(
      'SELECT id, saldo_pendiente, estado_pago FROM residentes WHERE usuario_id = $1',
      [usuario_id]
    );
    if (residente.rows.length === 0) {
      return res.status(404).json({ error: 'Residente no encontrado' });
    }
    const { id, saldo_pendiente, estado_pago } = residente.rows[0];

    const items = await pool.query(
      `SELECT p.id, p.concepto, p.monto, p.metodo, p.estado, p.fecha_pago,
              r.id AS reserva_id, a.nombre AS area_nombre, r.fecha AS reserva_fecha
         FROM pagos p
         LEFT JOIN reservas_areas r ON r.cargo_id = p.id
         LEFT JOIN areas_comunes  a ON a.id = r.area_id
        WHERE p.residente_id = $1
          AND p.estado = 'pendiente'
          AND date_trunc('month', p.fecha_pago) =
              date_trunc('month', (NOW() AT TIME ZONE $2::text))
        ORDER BY p.fecha_pago ASC`,
      [id, APP_TZ]
    );

    const total = items.rows.reduce((sum, row) => sum + Number(row.monto), 0);

    res.json({
      periodo: new Date().toISOString().slice(0, 7),
      items: items.rows,
      total_pendiente: Math.round(total * 100) / 100,
      saldo_pendiente: Number(saldo_pendiente),
      estado_pago,
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: 'Error al obtener el resumen del mes', detail: String(error) });
  }
};
