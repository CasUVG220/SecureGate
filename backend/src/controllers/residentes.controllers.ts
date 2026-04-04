import { Request, Response } from 'express';
import pool from '../db/pool';

export const getResidentes = async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.usuario_id, r.numero_casa, r.estado_pago, r.telefono, r.saldo_pendiente,
              u.nombre, u.email
       FROM residentes r
       JOIN usuarios u ON r.usuario_id = u.id
       ORDER BY r.numero_casa`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener residentes', detail: String(error) });
  }
};

export const getResidenteById = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT r.id, r.usuario_id, r.numero_casa, r.estado_pago, r.telefono, r.saldo_pendiente,
              u.nombre, u.email
       FROM residentes r
       JOIN usuarios u ON r.usuario_id = u.id
       WHERE r.id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Residente no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener residente', detail: String(error) });
  }
};

export const createResidente = async (req: Request, res: Response) => {
  const { nombre, email, password, numero_casa, telefono } = req.body;
  if (!nombre || !email || !password || !numero_casa) {
    return res.status(400).json({ error: 'Campos requeridos: nombre, email, password, numero_casa' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const usuarioResult = await client.query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol)
       VALUES ($1, $2, $3, 'residente')
       RETURNING id`,
      [nombre, email, password]
    );
    const usuario_id = usuarioResult.rows[0].id;
    const residenteResult = await client.query(
      `INSERT INTO residentes (usuario_id, numero_casa, telefono)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [usuario_id, numero_casa, telefono || null]
    );
    await client.query('COMMIT');
    res.status(201).json({ ...residenteResult.rows[0], nombre, email });
  } catch (error: any) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      return res.status(409).json({ error: 'El email o numero_casa ya existe' });
    }
    res.status(500).json({ error: 'Error al crear residente', detail: String(error) });
  } finally {
    client.release();
  }
};

export const updateResidente = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { numero_casa, estado_pago, telefono, saldo_pendiente } = req.body;
  const estadosValidos = ['al_dia', 'mora', 'pendiente'];
  if (estado_pago && !estadosValidos.includes(estado_pago)) {
    return res.status(400).json({ error: 'estado_pago debe ser: al_dia, mora o pendiente' });
  }
  try {
    const result = await pool.query(
      `UPDATE residentes
       SET numero_casa     = COALESCE($1, numero_casa),
           estado_pago     = COALESCE($2, estado_pago),
           telefono        = COALESCE($3, telefono),
           saldo_pendiente = COALESCE($4, saldo_pendiente)
       WHERE id = $5
       RETURNING *`,
      [numero_casa || null, estado_pago || null, telefono || null, saldo_pendiente ?? null, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Residente no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'El numero_casa ya existe' });
    }
    res.status(500).json({ error: 'Error al actualizar residente', detail: String(error) });
  }
};

export const deleteResidente = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'DELETE FROM residentes WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Residente no encontrado' });
    }
    res.json({ message: 'Residente eliminado correctamente', id: result.rows[0].id });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar residente', detail: String(error) });
  }
};