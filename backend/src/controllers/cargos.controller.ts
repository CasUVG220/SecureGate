import { Request, Response } from 'express';
import pool from '../db/pool';

export const getConfiguracion = async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT * FROM configuracion_cargos ORDER BY created_at'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener configuración de cargos', detail: String(error) });
  }
};

export const createConfiguracion = async (req: Request, res: Response) => {
  const { nombre, monto, activo, sucursal_id } = req.body;
  if (!nombre || monto === undefined) {
    return res.status(400).json({ error: 'Campos requeridos: nombre, monto' });
  }
  // If caller doesn't supply sucursal_id, fall back to the user's own sucursal
  const resolvedSucursalId: string | null = sucursal_id ?? (req.user as { sucursal_id?: string | null } | undefined)?.sucursal_id ?? null;
  try {
    const result = await pool.query(
      `INSERT INTO configuracion_cargos (nombre, monto, activo, sucursal_id)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [nombre, monto, activo !== undefined ? activo : true, resolvedSucursalId]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear configuración de cargo', detail: String(error) });
  }
};

export const updateConfiguracion = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { nombre, monto, activo } = req.body;
  try {
    const result = await pool.query(
      `UPDATE configuracion_cargos
       SET nombre = COALESCE($1, nombre),
           monto  = COALESCE($2, monto),
           activo = COALESCE($3, activo)
       WHERE id = $4
       RETURNING *`,
      [nombre ?? null, monto ?? null, activo ?? null, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Configuración de cargo no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar configuración', detail: String(error) });
  }
};

export const deleteConfiguracion = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE configuracion_cargos SET activo = FALSE WHERE id = $1 RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Configuración de cargo no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar configuración', detail: String(error) });
  }
};

export const aplicarCargo = async (req: Request, res: Response) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cargoResult = await client.query(
      'SELECT residente_id, monto, aplicado FROM cargos_automaticos WHERE id = $1',
      [id]
    );
    if (cargoResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cargo automático no encontrado' });
    }

    const cargo = cargoResult.rows[0];
    if (cargo.aplicado) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'El cargo ya fue aplicado' });
    }

    await client.query(
      'UPDATE cargos_automaticos SET aplicado = TRUE WHERE id = $1',
      [id]
    );

    const residenteResult = await client.query(
      `UPDATE residentes
       SET saldo_pendiente = saldo_pendiente + $1
       WHERE id = $2
       RETURNING saldo_pendiente`,
      [cargo.monto, cargo.residente_id]
    );

    await client.query('COMMIT');

    res.json({
      cargo_id: id,
      aplicado: true,
      monto_aplicado: cargo.monto,
      nuevo_saldo_pendiente: residenteResult.rows[0].saldo_pendiente,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Error al aplicar cargo', detail: String(error) });
  } finally {
    client.release();
  }
};