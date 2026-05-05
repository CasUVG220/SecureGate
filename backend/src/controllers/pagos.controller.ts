import { Request, Response } from 'express';
import pool from '../db/pool';

export const getPagos = async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT p.*, r.numero_casa, u.nombre AS residente_nombre
       FROM pagos p
       JOIN residentes r ON p.residente_id = r.id
       JOIN usuarios   u ON r.usuario_id   = u.id
       ORDER BY p.fecha_pago DESC`
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

    const residente = await client.query(
      'SELECT id FROM residentes WHERE id = $1',
      [residente_id]
    );
    if (residente.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Residente no encontrado' });
    }

    const pagoResult = await client.query(
      `INSERT INTO pagos (residente_id, monto, metodo, estado, comprobante, registrado_por)
       VALUES ($1, $2, 'efectivo', 'aprobado', $3, $4)
       RETURNING *`,
      [residente_id, monto, comprobante || null, registrado_por]
    );

    await client.query(
      `UPDATE residentes
       SET estado_pago = 'al_dia', saldo_pendiente = 0
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
      'SELECT residente_id, estado FROM pagos WHERE id = $1',
      [id]
    );
    if (pagoResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pago no encontrado' });
    }
    if (pagoResult.rows[0].estado === 'aprobado') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'El pago ya fue aprobado' });
    }

    const updated = await client.query(
      `UPDATE pagos SET estado = 'aprobado' WHERE id = $1 RETURNING *`,
      [id]
    );

    await client.query(
      `UPDATE residentes
       SET estado_pago = 'al_dia', saldo_pendiente = 0
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
      `UPDATE pagos SET estado = 'rechazado', comentario_rechazo = $2
       WHERE id = $1 AND estado = 'pendiente' RETURNING *`,
      [id, comentario_rechazo || null]
    );
    if (result.rows.length === 0) {
      const existe = await pool.query('SELECT id, estado FROM pagos WHERE id = $1', [id]);
      if (existe.rows.length === 0) {
        return res.status(404).json({ error: 'Pago no encontrado' });
      }
      return res.status(409).json({ error: `El pago ya tiene estado '${existe.rows[0].estado}'` });
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
    return res.status(400).json({ error: 'Campos requeridos: monto, referencia, banco, fecha_transferencia' });
  }
  if (Number(monto) <= 0) {
    return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
  }

  try {
    const residente = await pool.query(
      'SELECT id FROM residentes WHERE usuario_id = $1', [usuario_id]
    );
    if (residente.rows.length === 0) {
      return res.status(404).json({ error: 'Residente no encontrado' });
    }
    const result = await pool.query(
      `INSERT INTO pagos (residente_id, monto, metodo, estado, referencia, banco, fecha_transferencia, comprobante, registrado_por)
       VALUES ($1, $2, 'transferencia', 'pendiente', $3, $4, $5, $6, $7)
       RETURNING *`,
      [residente.rows[0].id, monto, referencia, banco, fecha_transferencia, comprobante || null, usuario_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al registrar comprobante', detail: String(error) });
  }
};

export const getPendientesVerificacion = async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT p.*,
              r.numero_casa, r.saldo_pendiente, r.estado_pago,
              u.nombre AS residente_nombre, u.email AS residente_email,
              r.telefono AS residente_telefono
       FROM pagos p
       JOIN residentes r ON p.residente_id = r.id
       JOIN usuarios   u ON r.usuario_id   = u.id
       WHERE p.metodo = 'transferencia' AND p.estado = 'pendiente'
       ORDER BY p.fecha_pago ASC`
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
      `SELECT * FROM pagos WHERE residente_id = $1
       ORDER BY fecha_pago DESC LIMIT 20`,
      [residente.rows[0].id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener pagos', detail: String(error) });
  }
};
