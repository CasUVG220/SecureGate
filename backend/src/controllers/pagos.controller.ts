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
  try {
    const result = await pool.query(
      `UPDATE pagos SET estado = 'rechazado' WHERE id = $1
       AND estado = 'pendiente' RETURNING *`,
      [id]
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