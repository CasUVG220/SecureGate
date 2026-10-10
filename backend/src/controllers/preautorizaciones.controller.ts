import { Request, Response } from 'express';
import pool from '../db/pool';
import { tenantFilter, ownershipClause, ownershipParams } from '../utils/tenant';
import { serverError, esUuid } from '../utils/http';
import { normalizarPlaca, placaPlausible, sqlPlacaNormalizada, PLACA_MIN, PLACA_MAX } from '../utils/placa';

const ERROR_PLACA = `La placa debe tener entre ${PLACA_MIN} y ${PLACA_MAX} letras o números`;

/**
 * Verifica si existe una preautorización activa y vigente para el residente que
 * coincida con el DPI del visitante o, si la preautorización es sólo de placa,
 * con la placa.
 *
 * Antes `numero_dpi IS NULL` contaba como comodín: una preautorización creada
 * sólo con placa marcaba como "preautorizado" a CUALQUIER visitante de ese
 * residente.
 */
export const checkPreautorizacion = async (
  numero_dpi: string,
  residente_id: string,
  placa?: string | null,
): Promise<boolean> => {
  const result = await pool.query(
    `SELECT 1 FROM preautorizaciones
     WHERE residente_id = $1
       AND (
         numero_dpi = $2
         OR (numero_dpi IS NULL AND placa IS NOT NULL AND $3::text IS NOT NULL AND ${sqlPlacaNormalizada('placa')} = $3::text)
       )
       AND activo = TRUE
       AND fecha_inicio <= NOW()::date
       AND fecha_fin IS NOT NULL
       AND fecha_fin >= NOW()::date
     LIMIT 1`,
    [residente_id, numero_dpi, normalizarPlaca(placa) || null]
  );
  return result.rows.length > 0;
};

/** Busca una preautorización vigente hoy por DPI o placa (para auto-entrada en garita). */
export const buscarPreautorizacion = async (req: Request, res: Response) => {
  const { dpi, placa } = req.query as { dpi?: string; placa?: string };
  if (!dpi && !placa) {
    return res.status(400).json({ error: 'Se requiere dpi o placa' });
  }

  const ts = tenantFilter(req.user!, 'p');
  const extraParams: unknown[] = [...ts.params];
  const conditions: string[] = [];

  if (dpi) {
    conditions.push(`p.numero_dpi = $${extraParams.length + 1}`);
    extraParams.push(dpi);
  }
  if (placa) {
    // Se compara normalizada (P123ABC): «p-123 abc» y «P123ABC» son el mismo vehículo, también en las filas viejas.
    conditions.push(`${sqlPlacaNormalizada('p.placa')} = $${extraParams.length + 1}`);
    extraParams.push(normalizarPlaca(placa));
  }

  try {
    const result = await pool.query(
      `SELECT p.residente_id, p.nombre_visitante, p.numero_dpi, p.placa,
              r.numero_casa, u.nombre AS residente_nombre
       FROM preautorizaciones p
       JOIN residentes r ON p.residente_id = r.id
       JOIN usuarios   u ON r.usuario_id   = u.id
       ${ts.joinClause}
       WHERE ${ts.whereClause}
         AND p.activo = TRUE
         AND p.fecha_inicio <= CURRENT_DATE
         AND p.fecha_fin IS NOT NULL
         AND p.fecha_fin >= CURRENT_DATE
         AND (${conditions.join(' OR ')})
       LIMIT 1`,
      extraParams
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Sin preautorización activa para hoy' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    serverError(res, error, 'Error al buscar preautorización');
  }
};

export const getPreautorizaciones = async (req: Request, res: Response) => {
  const ts = tenantFilter(req.user!, 'p');
  try {
    const result = await pool.query(
      `SELECT p.*, r.numero_casa, u.nombre AS residente_nombre
       FROM preautorizaciones p
       JOIN residentes r ON p.residente_id = r.id
       JOIN usuarios   u ON r.usuario_id   = u.id
       ${ts.joinClause}
       WHERE ${ts.whereClause}
         AND p.activo = TRUE
       ORDER BY p.fecha_inicio DESC`,
      ts.params
    );
    res.json(result.rows);
  } catch (error) {
    serverError(res, error, 'Error al obtener preautorizaciones');
  }
};

export const createPreautorizacion = async (req: Request, res: Response) => {
  const { residente_id, nombre_visitante, numero_dpi, placa: placaCruda, fecha_inicio, fecha_fin } = req.body;
  const placa = normalizarPlaca(placaCruda);       // se guarda siempre en la forma canónica (P123ABC)

  if (!residente_id || !nombre_visitante || !fecha_inicio) {
    return res.status(400).json({
      error: 'Campos requeridos: residente_id, nombre_visitante, fecha_inicio',
    });
  }
  if (!numero_dpi && !placa) {
    return res.status(400).json({ error: 'Se requiere al menos DPI o placa del visitante' });
  }
  if (placa && !placaPlausible(placa)) {
    return res.status(400).json({ error: ERROR_PLACA });
  }

  try {
    // Get residente and their sucursal_id
    // Sólo residentes del alcance de quien crea la preautorización.
    const residente = await pool.query(
      `SELECT id, sucursal_id FROM residentes WHERE id = $1
         AND ${ownershipClause('residentes', 2)}`,
      [residente_id, ...ownershipParams(req.user!)]
    );
    if (residente.rows.length === 0) {
      return res.status(404).json({ error: 'Residente no encontrado' });
    }
    const sucursal_id: string = residente.rows[0].sucursal_id;

    const result = await pool.query(
      `INSERT INTO preautorizaciones
         (sucursal_id, residente_id, nombre_visitante, numero_dpi, placa, fecha_inicio, fecha_fin)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [sucursal_id, residente_id, nombre_visitante, numero_dpi || null,
       placa || null, fecha_inicio, fecha_fin || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    serverError(res, error, 'Error al crear preautorización');
  }
};

export const deletePreautorizacion = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE preautorizaciones
       SET activo = FALSE
       WHERE id = $1
         AND activo = TRUE
         AND ${ownershipClause('preautorizaciones', 2)}
       RETURNING id`,
      [id, ...ownershipParams(req.user!)]
    );
    if (result.rows.length === 0) {
      const existe = await pool.query(
        'SELECT id, activo FROM preautorizaciones WHERE id = $1', [id]
      );
      if (existe.rows.length === 0) {
        return res.status(404).json({ error: 'Preautorización no encontrada' });
      }
      if (!existe.rows[0].activo) {
        return res.status(404).json({ error: 'Preautorización ya inactiva' });
      }
      return res.status(403).json({ error: 'Sin acceso a esta preautorización' });
    }
    res.json({ message: 'Preautorización eliminada', id: result.rows[0].id });
  } catch (error) {
    serverError(res, error, 'Error al eliminar preautorización');
  }
};

const getResidenteIdFromUser = async (
  usuarioId: string
): Promise<{ id: string; sucursal_id: string } | null> => {
  const r = await pool.query(
    'SELECT id, sucursal_id FROM residentes WHERE usuario_id = $1', [usuarioId]
  );
  return r.rows.length > 0 ? r.rows[0] : null;
};

export const getMisPreautorizaciones = async (req: Request, res: Response) => {
  const residente = await getResidenteIdFromUser(req.user!.id);
  if (!residente) return res.status(404).json({ error: 'Residente no encontrado' });

  try {
    const result = await pool.query(
      `SELECT id, nombre_visitante, numero_dpi, placa, fecha_inicio, fecha_fin, activo, created_at
       FROM preautorizaciones
       WHERE residente_id = $1 AND activo = TRUE
       ORDER BY created_at DESC`,
      [residente.id]
    );
    res.json(result.rows);
  } catch (error) {
    serverError(res, error, 'Error al obtener preautorizaciones');
  }
};

export const createMisPreautorizacion = async (req: Request, res: Response) => {
  const { nombre_visitante, numero_dpi, placa: placaCruda, fecha_inicio, fecha_fin } = req.body;
  const placa = normalizarPlaca(placaCruda);

  if (!nombre_visitante || !fecha_inicio) {
    return res.status(400).json({ error: 'Campos requeridos: nombre_visitante, fecha_inicio' });
  }
  if (!numero_dpi && !placa) {
    return res.status(400).json({ error: 'Se requiere al menos DPI o placa del visitante' });
  }
  if (placa && !placaPlausible(placa)) {
    return res.status(400).json({ error: ERROR_PLACA });
  }

  const residente = await getResidenteIdFromUser(req.user!.id);
  if (!residente) return res.status(404).json({ error: 'Residente no encontrado' });

  try {
    const result = await pool.query(
      `INSERT INTO preautorizaciones
         (sucursal_id, residente_id, nombre_visitante, numero_dpi, placa, fecha_inicio, fecha_fin)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [residente.sucursal_id, residente.id, nombre_visitante,
       numero_dpi || null, placa || null, fecha_inicio, fecha_fin || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    serverError(res, error, 'Error al crear preautorización');
  }
};

export const deleteMisPreautorizacion = async (req: Request, res: Response) => {
  const { id } = req.params;

  const residente = await getResidenteIdFromUser(req.user!.id);
  if (!residente) return res.status(404).json({ error: 'Residente no encontrado' });

  try {
    const result = await pool.query(
      `UPDATE preautorizaciones SET activo = FALSE
       WHERE id = $1 AND residente_id = $2 AND activo = TRUE
       RETURNING id`,
      [id, residente.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Preautorización no encontrada' });
    }
    res.json({ message: 'Preautorización eliminada' });
  } catch (error) {
    serverError(res, error, 'Error al eliminar preautorización');
  }
};
