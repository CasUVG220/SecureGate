import { Request, Response } from 'express';
import pool from '../db/pool';
import { esUuid } from '../utils/http';
import { revocarSesionesDeUsuario } from './auth.controller';
import { revocarAccesoDeUsuario } from '../utils/revocacion';
import { serverError } from '../utils/http';

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
              COUNT(DISTINCT u.id)::int       AS total_agentes,
              EXISTS (SELECT 1 FROM usuarios a
                       WHERE a.sucursal_id = s.id AND a.rol = 'admin_sucursal' AND a.activo = TRUE) AS tiene_admin,
              EXISTS (SELECT 1 FROM invitaciones i
                       WHERE i.sucursal_id = s.id AND i.rol_invitado = 'admin_sucursal'
                         AND i.estado = 'pendiente' AND i.expira_en > NOW()) AS invitacion_pendiente
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
    serverError(res, error, 'Error al obtener sucursales');
  }
};

export const createSucursal = async (req: Request, res: Response) => {
  const { empresa_id: bodyEmpresaId, nombre, direccion, tipo } = req.body;

  if (!bodyEmpresaId || !nombre) {
    return res.status(400).json({ error: 'Campos requeridos: empresa_id, nombre' });
  }

  if (!esUuid(bodyEmpresaId)) {
    return res.status(400).json({ error: 'empresa_id inválido' });
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
    serverError(res, error, 'Error al crear sucursal');
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
         AND ($6::text = 'owner' OR empresa_id = $7)
       RETURNING *`,
      [nombre ?? null, direccion ?? null, tipo ?? null, activo ?? null, id, req.user!.rol, req.user!.empresa_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Sucursal no encontrada' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    serverError(res, error, 'Error al actualizar sucursal');
  }
};

export const deleteSucursal = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE sucursales SET activo = FALSE
        WHERE id = $1 AND ($2::text = 'owner' OR empresa_id = $3)
        RETURNING *`,
      [id, req.user!.rol, req.user!.empresa_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Sucursal no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    serverError(res, error, 'Error al eliminar sucursal');
  }
};

/**
 * Asigna un usuario existente como admin_sucursal de una sucursal.
 *
 * Reglas (antes el UPDATE aceptaba cualquier `usuario_id`, así que un admin de
 * empresa podía degradar al owner o ascender a un residente de otra empresa):
 * - la sucursal tiene que estar dentro del alcance de quien llama;
 * - el usuario tiene que ser agente o admin_sucursal (nunca owner, admin de
 *   empresa ni residente) y pertenecer a la MISMA empresa que la sucursal;
 * - se cierran sus sesiones para que el cambio de rol se aplique de inmediato.
 */
export const assignAdminSucursal = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { usuario_id } = req.body;

  if (!esUuid(usuario_id)) {
    return res.status(400).json({ error: 'Campo requerido: usuario_id (UUID)' });
  }

  try {
    const sucursal = await pool.query(
      `SELECT id, empresa_id FROM sucursales
        WHERE id = $1 AND ($2::text = 'owner' OR empresa_id = $3)`,
      [id, req.user!.rol, req.user!.empresa_id]
    );
    if (sucursal.rows.length === 0) {
      return res.status(404).json({ error: 'Sucursal no encontrada o sin acceso' });
    }

    const result = await pool.query(
      `UPDATE usuarios u
          SET sucursal_id = $1, rol = 'admin_sucursal'
        WHERE u.id = $2
          AND u.activo = TRUE
          AND u.rol IN ('agente', 'admin_sucursal')
          AND (
            u.empresa_id = $3
            OR EXISTS (SELECT 1 FROM sucursales s WHERE s.id = u.sucursal_id AND s.empresa_id = $3)
          )
        RETURNING u.id, u.nombre, u.email, u.rol, u.sucursal_id`,
      [id, usuario_id, sucursal.rows[0].empresa_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado, inactivo o de otra empresa' });
    }

    await revocarSesionesDeUsuario(pool, usuario_id);
    revocarAccesoDeUsuario(usuario_id);
    res.json(result.rows[0]);
  } catch (error) {
    serverError(res, error, 'Error al asignar admin de sucursal');
  }
};
