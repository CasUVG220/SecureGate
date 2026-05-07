import { Request, Response } from 'express';
import pool from '../db/pool';

export const getSucursales = async (req: Request, res: Response) => {
  const { rol, empresa_id } = req.user!;

  try {
    const whereClause = rol === 'owner'
      ? ''
      : 'WHERE s.empresa_id = $1';

    const params = rol === 'owner' ? [] : [empresa_id];

    const result = await pool.query(
      `SELECT s.*,
              e.nombre                        AS empresa_nombre,
              COUNT(DISTINCT r.id)::int       AS total_residentes,
              COUNT(DISTINCT u.id)::int       AS total_agentes
       FROM sucursales s
       JOIN empresas e ON s.empresa_id = e.id
       LEFT JOIN residentes r ON r.sucursal_id = s.id
       LEFT JOIN usuarios u
         ON u.sucursal_id = s.id AND u.rol = 'agente' AND u.activo = TRUE
       ${whereClause}
       GROUP BY s.id, e.nombre
       ORDER BY e.nombre, s.nombre`,
      params
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener sucursales', detail: String(error) });
  }
};

export const createSucursal = async (req: Request, res: Response) => {
  const { empresa_id: bodyEmpresaId, nombre, direccion, tipo } = req.body;

  if (!bodyEmpresaId || !nombre) {
    return res.status(400).json({ error: 'Campos requeridos: empresa_id, nombre' });
  }

  // admin_empresa can only create sucursales within their own empresa
  if (req.user!.rol === 'admin_empresa' && req.user!.empresa_id !== bodyEmpresaId) {
    return res.status(403).json({ error: 'No puedes crear sucursales en otra empresa' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO sucursales (empresa_id, nombre, direccion, tipo)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [bodyEmpresaId, nombre, direccion ?? null, tipo ?? null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    if (error.code === '23503') {
      return res.status(400).json({ error: 'La empresa especificada no existe' });
    }
    res.status(500).json({ error: 'Error al crear sucursal', detail: String(error) });
  }
};

export const updateSucursal = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { nombre, direccion, tipo, activo } = req.body;

  try {
    const result = await pool.query(
      `UPDATE sucursales
       SET nombre    = COALESCE($1, nombre),
           direccion = COALESCE($2, direccion),
           tipo      = COALESCE($3, tipo),
           activo    = COALESCE($4, activo)
       WHERE id = $5
       RETURNING *`,
      [nombre ?? null, direccion ?? null, tipo ?? null, activo ?? null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Sucursal no encontrada' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar sucursal', detail: String(error) });
  }
};

export const assignAdminSucursal = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { usuario_id } = req.body;

  if (!usuario_id) {
    return res.status(400).json({ error: 'Campo requerido: usuario_id' });
  }

  try {
    // Verify the sucursal exists
    const sucursalCheck = await pool.query(
      'SELECT id FROM sucursales WHERE id = $1',
      [id]
    );
    if (sucursalCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Sucursal no encontrada' });
    }

    const result = await pool.query(
      `UPDATE usuarios
       SET sucursal_id = $1, rol = 'admin_sucursal'
       WHERE id = $2
       RETURNING id, nombre, email, rol, sucursal_id`,
      [id, usuario_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al asignar admin de sucursal', detail: String(error) });
  }
};
