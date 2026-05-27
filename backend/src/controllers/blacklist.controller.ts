import { Request, Response } from 'express';
import pool from '../db/pool';

export interface BlacklistCheckResult {
  bloqueado: boolean;
  razon?: string;
  tipo?: string;
  fecha_fin?: string | null;
}

export const checkBlacklist = async (
  visitante_id: string,
  sucursal_id: string
): Promise<BlacklistCheckResult> => {
  // Check sucursal-level blacklist (expired bans are ignored)
  const bl = await pool.query(
    `SELECT razon, tipo, fecha_fin FROM visitante_blacklist
     WHERE visitante_id = $1
       AND sucursal_id  = $2
       AND activo = TRUE
       AND (fecha_fin IS NULL OR fecha_fin >= CURRENT_DATE)`,
    [visitante_id, sucursal_id]
  );
  if (bl.rows.length > 0) {
    return {
      bloqueado: true,
      razon:     bl.rows[0].razon,
      tipo:      bl.rows[0].tipo,
      fecha_fin: bl.rows[0].fecha_fin ?? null,
    };
  }

  // Check resident-level blacklist for this sucursal
  const rvbl = await pool.query(
    `SELECT rvbl.razon FROM residente_visitante_blacklist rvbl
     JOIN residentes r ON rvbl.residente_id = r.id
     WHERE rvbl.visitante_id = $1
       AND r.sucursal_id     = $2
       AND rvbl.activo = TRUE`,
    [visitante_id, sucursal_id]
  );
  if (rvbl.rows.length > 0) {
    return {
      bloqueado: true,
      razon:     rvbl.rows[0].razon,
      tipo:      'residente',
    };
  }

  return { bloqueado: false };
};

export const getBlacklist = async (req: Request, res: Response) => {
  const user = req.user!;
  let whereClause: string;
  let params: unknown[];

  if (user.rol === 'owner') {
    whereClause = '1=1';
    params = [];
  } else if (user.rol === 'admin_empresa' && user.empresa_id) {
    whereClause = 's.empresa_id = $1';
    params = [user.empresa_id];
  } else if (user.sucursal_id) {
    whereClause = 'bl.sucursal_id = $1';
    params = [user.sucursal_id];
  } else {
    return res.status(403).json({ error: 'Sin sucursal asignada' });
  }

  try {
    const result = await pool.query(
      `SELECT
         bl.id,
         bl.tipo,
         bl.razon,
         bl.fecha_inicio,
         bl.fecha_fin,
         bl.activo,
         bl.created_at,
         v.id   AS visitante_id,
         v.nombre AS visitante_nombre,
         v.numero_dpi,
         s.nombre AS sucursal_nombre,
         u.nombre AS creado_por_nombre
       FROM visitante_blacklist bl
       JOIN visitantes v ON bl.visitante_id = v.id
       JOIN sucursales s ON bl.sucursal_id  = s.id
       JOIN usuarios   u ON bl.creado_por   = u.id
       WHERE ${whereClause}
         AND bl.activo = TRUE
         AND (bl.fecha_fin IS NULL OR bl.fecha_fin >= CURRENT_DATE)
       ORDER BY bl.created_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener blacklist', detail: String(error) });
  }
};

export const addToBlacklist = async (req: Request, res: Response) => {
  const user = req.user!;
  if (!user.sucursal_id && user.rol !== 'owner' && user.rol !== 'admin_empresa') {
    return res.status(403).json({ error: 'Sin sucursal asignada' });
  }

  const { visitante_id, tipo, razon, fecha_fin, sucursal_id: bodySucursalId } = req.body as {
    visitante_id: string;
    tipo: 'temporal' | 'permanente';
    razon: string;
    fecha_fin?: string;
    sucursal_id?: string;
  };

  if (!visitante_id || !tipo || !razon) {
    return res.status(400).json({ error: 'Campos requeridos: visitante_id, tipo, razon' });
  }
  if (!['temporal', 'permanente'].includes(tipo)) {
    return res.status(400).json({ error: 'tipo debe ser temporal o permanente' });
  }

  const targetSucursalId: string = bodySucursalId ?? user.sucursal_id ?? '';
  if (!targetSucursalId) {
    return res.status(400).json({ error: 'sucursal_id requerido' });
  }

  const finDate = tipo === 'permanente' ? null : (fecha_fin ?? null);

  try {
    const result = await pool.query(
      `INSERT INTO visitante_blacklist
         (visitante_id, sucursal_id, tipo, razon, fecha_fin, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (visitante_id, sucursal_id)
       DO UPDATE SET
         tipo       = EXCLUDED.tipo,
         razon      = EXCLUDED.razon,
         fecha_fin  = EXCLUDED.fecha_fin,
         fecha_inicio = CURRENT_DATE,
         activo     = TRUE,
         creado_por = EXCLUDED.creado_por
       RETURNING *`,
      [visitante_id, targetSucursalId, tipo, razon, finDate, user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al agregar a blacklist', detail: String(error) });
  }
};

export const removeFromBlacklist = async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = req.user!;

  let whereExtra = '';
  const params: unknown[] = [id];

  if (user.rol !== 'owner' && user.rol !== 'admin_empresa') {
    whereExtra = ' AND sucursal_id = $2';
    params.push(user.sucursal_id);
  }

  try {
    const result = await pool.query(
      `UPDATE visitante_blacklist SET activo = FALSE
       WHERE id = $1${whereExtra}
       RETURNING id`,
      params
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Entrada no encontrada o sin permiso' });
    }
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Error al remover de blacklist', detail: String(error) });
  }
};
