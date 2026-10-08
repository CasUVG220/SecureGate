import { Request, Response } from 'express';
import pool from '../db/pool';
import { tenantFilter, ownershipClause, ownershipParams, resolverSucursal } from '../utils/tenant';
import { serverError, esUuid } from '../utils/http';
import { normalizarPlaca, placaPlausible, PLACA_MIN, PLACA_MAX } from '../utils/placa';

export interface BlacklistMatch {
  id: string;
  razon: string;
  fecha_fin: string | null;
  /** Solo viene cuando el bloqueo coincidió por la PLACA del vehículo (por DPI se omite). */
  motivo?: 'placa';
}

/**
 * Returns the active blacklist record that blocks this entry in a sucursal, or
 * null. Not an endpoint — consumed by accesos.controller before registering an
 * access. An expired ban (fecha_fin in the past) does not block.
 *
 * Se bloquea por (en este orden): DPI del visitante en la lista de la sucursal,
 * DPI vetado por el residente destino y, si llega `placa`, la PLACA del vehículo
 * (entradas de la sucursal, con o sin visitante conocido). La placa se compara
 * normalizada (mayúsculas, sin separadores), así que el formato tecleado no importa.
 */
export const checkBlacklist = async (
  numero_dpi: string,
  sucursal_id: string,
  placa?: string | null,
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

  // Placa bloqueada en la sucursal (haya o no un visitante asociado a la entrada).
  const placaNorm = normalizarPlaca(placa);
  if (placaNorm.length >= 3) {
    const bp = await pool.query(
      `SELECT bl.id, bl.razon, bl.fecha_fin
       FROM visitante_blacklist bl
       WHERE bl.placa = $1
         AND bl.sucursal_id = $2
         AND bl.activo = TRUE
         AND (bl.fecha_fin IS NULL OR bl.fecha_fin > NOW())
       ORDER BY bl.created_at DESC
       LIMIT 1`,
      [placaNorm, sucursal_id],
    );
    if (bp.rows.length > 0) {
      return { id: bp.rows[0].id, razon: bp.rows[0].razon, fecha_fin: bp.rows[0].fecha_fin ?? null, motivo: 'placa' };
    }
  }

  return null;
};

export const getBlacklist = async (req: Request, res: Response) => {
  const ts = tenantFilter(req.user!, 'bl');
  try {
    const result = await pool.query(
      `SELECT bl.id, bl.razon, bl.fecha_inicio, bl.fecha_fin, bl.activo, bl.created_at,
              bl.placa,
              v.id     AS visitante_id,
              v.nombre AS visitante_nombre,
              v.numero_dpi,
              s.nombre AS sucursal_nombre,
              u.nombre AS creado_por_nombre
       FROM visitante_blacklist bl
       LEFT JOIN visitantes v ON bl.visitante_id = v.id
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
  const { visitante_id, placa, razon, duracion, dias, sucursal_id: bodySucursalId } = req.body as {
    visitante_id?: string;
    placa?: string;
    razon?: string;
    duracion?: Duracion;
    dias?: number | string;
    sucursal_id?: string;
  };

  if ((!visitante_id && !placa) || !razon || !duracion) {
    return res.status(400).json({ error: 'Campos requeridos: visitante_id (o placa), razon, duracion' });
  }
  if (typeof razon !== 'string' || razon.trim().length === 0) {
    return res.status(400).json({ error: 'La razón es requerida' });
  }
  if (visitante_id && !esUuid(visitante_id)) {
    return res.status(400).json({ error: 'visitante_id inválido' });
  }
  // La placa se guarda normalizada (P123ABC) sin importar cómo se haya tecleado.
  let placaNorm: string | null = null;
  if (placa !== undefined && placa !== null && placa !== '') {
    placaNorm = normalizarPlaca(placa);
    if (!placaPlausible(placaNorm)) {
      return res.status(400).json({ error: `La placa debe tener entre ${PLACA_MIN} y ${PLACA_MAX} letras o números` });
    }
  }
  if (!visitante_id && !placaNorm) {
    return res.status(400).json({ error: 'Campos requeridos: visitante_id (o placa), razon, duracion' });
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
    // Sin duplicados: un mismo visitante o una misma placa no se bloquea dos veces a la vez
    // en la misma sucursal (para cambiar la duración, se quita el bloqueo y se crea de nuevo).
    const repetido = await pool.query(
      `SELECT 1 FROM visitante_blacklist
        WHERE sucursal_id = $1
          AND activo = TRUE
          AND (fecha_fin IS NULL OR fecha_fin > NOW())
          AND (($2::uuid IS NOT NULL AND visitante_id = $2::uuid)
            OR ($3::text IS NOT NULL AND placa = $3::text))
        LIMIT 1`,
      [sucursalId, visitante_id ?? null, placaNorm],
    );
    if (repetido.rows.length > 0) {
      return res.status(409).json({
        error: placaNorm && !visitante_id ? 'Esa placa ya está bloqueada en esta sucursal' : 'Ya está bloqueado en esta sucursal',
      });
    }

    const result = await pool.query(
      `INSERT INTO visitante_blacklist
         (visitante_id, placa, sucursal_id, razon, fecha_fin, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [visitante_id ?? null, placaNorm, sucursalId, razon.trim(), fecha_fin, req.user!.id],
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
