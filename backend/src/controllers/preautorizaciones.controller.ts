import { Request, Response } from 'express';
import pool from '../db/pool';

/** Verifica si existe una preautorización activa y vigente para el DPI + residente. */
export const checkPreautorizacion = async (
  numero_dpi: string,
  residente_id: string
): Promise<boolean> => {
  const result = await pool.query(
    `SELECT 1 FROM preautorizaciones
     WHERE residente_id = $1
       AND (numero_dpi = $2 OR numero_dpi IS NULL)
       AND activo = TRUE
       AND fecha_inicio <= NOW()::date
       AND (fecha_fin IS NULL OR fecha_fin >= NOW()::date)
     LIMIT 1`,
    [residente_id, numero_dpi]
  );
  return result.rows.length > 0;
};

export const getPreautorizaciones = async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT p.*, r.numero_casa, u.nombre AS residente_nombre
       FROM preautorizaciones p
       JOIN residentes r ON p.residente_id = r.id
       JOIN usuarios   u ON r.usuario_id   = u.id
       WHERE p.activo = TRUE
       ORDER BY p.fecha_inicio DESC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener preautorizaciones', detail: String(error) });
  }
};

export const createPreautorizacion = async (req: Request, res: Response) => {
  const { residente_id, nombre_visitante, numero_dpi, fecha_inicio, fecha_fin } = req.body;

  if (!residente_id || !nombre_visitante || !fecha_inicio) {
    return res.status(400).json({
      error: 'Campos requeridos: residente_id, nombre_visitante, fecha_inicio',
    });
  }

  try {
    const residente = await pool.query(
      'SELECT id FROM residentes WHERE id = $1',
      [residente_id]
    );
    if (residente.rows.length === 0) {
      return res.status(404).json({ error: 'Residente no encontrado' });
    }

    const result = await pool.query(
      `INSERT INTO preautorizaciones
         (residente_id, nombre_visitante, numero_dpi, fecha_inicio, fecha_fin)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [residente_id, nombre_visitante, numero_dpi || null, fecha_inicio, fecha_fin || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear preautorización', detail: String(error) });
  }
};

export const deletePreautorizacion = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE preautorizaciones SET activo = FALSE
       WHERE id = $1 AND activo = TRUE
       RETURNING id`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Preautorización no encontrada o ya inactiva' });
    }
    res.json({ message: 'Preautorización eliminada', id: result.rows[0].id });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar preautorización', detail: String(error) });
  }
};
