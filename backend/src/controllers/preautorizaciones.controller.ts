import { Request, Response } from 'express';
import pool from '../db/pool';
import { tenantFilter, ownershipClause, ownershipParams } from '../utils/tenant';
import { serverError, esUuid } from '../utils/http';
import { normalizarPlaca, placaPlausible, sqlPlacaNormalizada, PLACA_MIN, PLACA_MAX } from '../utils/placa';

const ERROR_PLACA = `La placa debe tener entre ${PLACA_MIN} y ${PLACA_MAX} letras o números`;

/**
 * Qué es una fila de `preautorizaciones` (SCRUM-114 / H10; en pantalla se llama «aviso de visita»):
 *   - con `fecha_fin`: una visita avisada, vale para entrar entre `fecha_inicio` y `fecha_fin`;
 *   - SIN `fecha_fin`: un «visitante guardado» de la libreta del residente (POST /mis). NO autoriza
 *     entradas: ni `checkPreautorizacion`, ni `buscarPreautorizacion`, ni el padrón de la garita
 *     (`/sync/garita`) ni la evaluación local del escritorio la toman en cuenta.
 * Por eso el alta del administrador exige `fecha_fin`: sin ella la fila quedaría muerta sin avisar a nadie.
 */
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const esFecha = (v: unknown): v is string => {
  if (typeof v !== 'string' || !FECHA_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  // `toISOString` lanza con una fecha imposible (2026-13-45); y «2026-02-31» se corre a marzo: se compara de vuelta.
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

/** Devuelve el mensaje de error de las fechas del aviso, o null si están bien. */
const errorDeFechas = (inicio: unknown, fin: unknown, finRequerida: boolean): string | null => {
  if (!esFecha(inicio)) return 'fecha_inicio inválida: use el formato AAAA-MM-DD';
  const hayFin = fin !== undefined && fin !== null && fin !== '';
  if (!hayFin) return finRequerida ? 'fecha_fin es requerida: una visita sin fecha de fin no autoriza entradas' : null;
  if (!esFecha(fin)) return 'fecha_fin inválida: use el formato AAAA-MM-DD';
  if (fin < inicio) return 'La fecha de fin no puede ser anterior a la de inicio';
  return null;
};

/**
 * ¿Ya hay un aviso idéntico? Misma persona o vehículo (DPI y placa normalizada) y las mismas fechas.
 * Dos visitantes distintos que llegan en el mismo carro no se pisan: tienen DPI distinto.
 * Un visitante guardado (sin `fecha_fin`) se repite aunque se guarde otro día.
 */
const buscarDuplicada = async (
  residenteId: string, dpi: string | null, placa: string, inicio: string, fin: string | null,
): Promise<string | null> => {
  const r = await pool.query(
    `SELECT id FROM preautorizaciones
      WHERE residente_id = $1 AND activo = TRUE
        AND NULLIF(numero_dpi, '') IS NOT DISTINCT FROM NULLIF($2::text, '')
        AND NULLIF(${sqlPlacaNormalizada('placa')}, '') IS NOT DISTINCT FROM NULLIF($3::text, '')
        AND fecha_fin IS NOT DISTINCT FROM $4::date
        AND ($4::date IS NULL OR fecha_inicio = $5::date)
      LIMIT 1`,
    [residenteId, dpi || null, placa || null, fin, inicio],
  );
  return r.rows[0]?.id ?? null;
};

const mensajeDuplicada = (fin: string | null) =>
  fin ? 'Esa visita ya está avisada para esas fechas' : 'Ese visitante ya está guardado';

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
  const errorFechas = errorDeFechas(fecha_inicio, fecha_fin, true);
  if (errorFechas) return res.status(400).json({ error: errorFechas });

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

    const duplicada = await buscarDuplicada(residente_id, numero_dpi, placa, fecha_inicio, fecha_fin);
    if (duplicada) return res.status(409).json({ error: mensajeDuplicada(fecha_fin), id: duplicada });

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
  // Sin fecha_fin se guarda el visitante en la libreta del residente (no autoriza entradas; ver arriba).
  const errorFechas = errorDeFechas(fecha_inicio, fecha_fin, false);
  if (errorFechas) return res.status(400).json({ error: errorFechas });

  const residente = await getResidenteIdFromUser(req.user!.id);
  if (!residente) return res.status(404).json({ error: 'Residente no encontrado' });

  try {
    const duplicada = await buscarDuplicada(residente.id, numero_dpi, placa, fecha_inicio, fecha_fin || null);
    if (duplicada) return res.status(409).json({ error: mensajeDuplicada(fecha_fin || null), id: duplicada });

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
