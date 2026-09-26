import { Request, Response } from 'express';
import pool from '../db/pool';
import { tenantFilter, ownershipClause, ownershipParams, resolverSucursal } from '../utils/tenant';
import { serverError } from '../utils/http';

export interface BlacklistMatch {
  id: string;
  razon: string;
  fecha_fin: string | null;
}

/**
 * Returns the active blacklist record for a visitor (by DPI) in a sucursal,
 * or null. Not an endpoint — consumed by accesos.controller before registering
 * an access. An expired ban (fecha_fin in the past) does not block.
 */
export const checkBlacklist = async (
  numero_dpi: string,
  sucursal_id: string,
): Promise<BlacklistMatch | null> => {
  // Sucursal-level blacklist (NULL fecha_fin = indefinido)
  const bl = await pool.query(
    `SELECT bl.id, bl.razon, bl.fecha_fin
     FROM visitante_blacklist bl
     JOIN visitantes v ON bl.visitante_id = v.id
     WHERE v.numero_dpi = $1
       AND bl.sucursal_id = $2
       AND bl.activo = TRUE
       AND (bl.fecha_fin IS NULL OR bl.fecha_fin > NOW())
     ORDER BY bl.created_at DESC
     LIMIT 1`,
    [numero_dpi, sucursal_id],
  );
  if (bl.rows.length > 0) {
    return { id: bl.rows[0].id, razon: bl.rows[0].razon, fecha_fin: bl.rows[0].fecha_fin ?? null };
  }

  // Resident-level blacklist for this sucursal (no expiry)
  const rvbl = await pool.query(
    `SELECT rvbl.id, rvbl.razon
     FROM residente_visitante_blacklist rvbl
     JOIN visitantes v ON rvbl.visitante_id = v.id
     JOIN residentes r ON rvbl.residente_id = r.id
     WHERE v.numero_dpi = $1
       AND r.sucursal_id = $2
       AND rvbl.activo = TRUE
     LIMIT 1`,
    [numero_dpi, sucursal_id],
  );
  if (rvbl.rows.length > 0) {
    return { id: rvbl.rows[0].id, razon: rvbl.rows[0].razon, fecha_fin: null };
  }

  return null;
};

export const getBlacklist = async (req: Request, res: Response) => {
  const ts = tenantFilter(req.user!, 'bl');
  try {
    const result = await pool.query(
      `SELECT bl.id, bl.razon, bl.fecha_inicio, bl.fecha_fin, bl.activo, bl.created_at,
              v.id     AS visitante_id,
              v.nombre AS visitante_nombre,
              v.numero_dpi,
              s.nombre AS sucursal_nombre,
              u.nombre AS creado_por_nombre
       FROM visitante_blacklist bl
       JOIN visitantes v ON bl.visitante_id = v.id
       JOIN sucursales s ON bl.sucursal_id  = s.id
       JOIN usuarios   u ON bl.creado_por   = u.id
       ${ts.joinClause}
       WHERE ${ts.whereClause}
         AND bl.activo = TRUE
         AND (bl.fecha_fin IS NULL OR bl.fecha_fin > NOW())
       ORDER BY bl.created_at DESC`,
      ts.params,
    );
    res.json(result.rows);
  } catch (error) {
    serverError(res, error, 'Error al obtener blacklist');
  }
};

type Duracion = 'temporal_dias' | '30_dias' | 'indefinido';

export const createBlacklist = async (req: Request, res: Response) => {
  const { visitante_id, razon, duracion, dias, sucursal_id: bodySucursalId } = req.body as {
    visitante_id?: string;
    razon?: string;
    duracion?: Duracion;
    dias?: number | string;
    sucursal_id?: string;
  };

  if (!visitante_id || !razon || !duracion) {
    return res.status(400).json({ error: 'Campos requeridos: visitante_id, razon, duracion' });
  }

  // Resolve fecha_fin from duracion
  let fecha_fin: Date | null;
  if (duracion === 'temporal_dias') {
    const d = typeof dias === 'string' ? parseInt(dias, 10) : dias;
    if (!d || Number.isNaN(d) || d < 1) {
      return res.status(400).json({ error: "duracion 'temporal_dias' requiere 'dias' >= 1" });
    }
    fecha_fin = new Date(Date.now() + d * 24 * 60 * 60 * 1000);
  } else if (duracion === '30_dias') {
    fecha_fin = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  } else if (duracion === 'indefinido') {
    fecha_fin = null;
  } else {
    return res.status(400).json({ error: "duracion debe ser 'temporal_dias', '30_dias' o 'indefinido'" });
  }

  const sucResuelta = await resolverSucursal(req.user!, bodySucursalId, pool);
  if (sucResuelta.ok === false) {
    return res.status(sucResuelta.status).json({ error: sucResuelta.error });
  }
  const sucursalId = sucResuelta.id;

  try {
    const result = await pool.query(
      `INSERT INTO visitante_blacklist
         (visitante_id, sucursal_id, razon, fecha_fin, creado_por)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [visitante_id, sucursalId, razon, fecha_fin, req.user!.id],
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    serverError(res, error, 'Error al agregar a blacklist');
  }
};

export const deleteBlacklist = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE visitante_blacklist
       SET activo = FALSE
       WHERE id = $1
         AND ${ownershipClause('visitante_blacklist', 2)}
       RETURNING id`,
      [id, ...ownershipParams(req.user!)],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Entrada no encontrada o sin permiso' });
    }
    res.json({ id: result.rows[0].id, removed: true });
  } catch (error) {
    serverError(res, error, 'Error al remover de blacklist');
  }
};
