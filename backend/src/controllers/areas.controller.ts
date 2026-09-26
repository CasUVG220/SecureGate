import { Request, Response } from 'express';
import pool from '../db/pool';
import { tenantFilter, ownershipClause, ownershipParams, resolverSucursal } from '../utils/tenant';
import { TarifaTipo } from '../utils/reservas';
import { serverError } from '../utils/http';

const TARIFAS: TarifaTipo[] = ['gratis', 'por_hora', 'unica'];

/**
 * Valida el par tarifa_tipo/tarifa_monto.
 * Devuelve el monto normalizado (0 forzado para 'gratis') o un mensaje de error.
 */
function validarTarifa(
  tarifa_tipo: string,
  tarifa_monto: unknown
): { monto: number } | { error: string } {
  if (!TARIFAS.includes(tarifa_tipo as TarifaTipo)) {
    return { error: 'tarifa_tipo debe ser: gratis, por_hora o unica' };
  }
  if (tarifa_tipo === 'gratis') return { monto: 0 };

  const monto = Number(tarifa_monto);
  if (!Number.isFinite(monto) || monto <= 0) {
    return { error: 'tarifa_monto debe ser mayor a 0 cuando la tarifa no es gratis' };
  }
  return { monto };
}

/**
 * requiere_aprobacion es tri-estado (true / false / NULL = hereda la config de
 * la sucursal), así que se distingue "no lo mandaron" de "lo mandaron en null".
 */
function leerRequiereAprobacion(body: Record<string, unknown>): boolean | null {
  const v = body.requiere_aprobacion;
  if (v === null || v === undefined || v === '' || v === 'global') return null;
  return v === true || v === 'true';
}

export const getAreas = async (req: Request, res: Response) => {
  const ts = tenantFilter(req.user!, 'a');
  // Los residentes sólo ven áreas habilitadas; el staff puede pedir todas.
  const soloActivas = req.user!.rol === 'residente' || req.query.activa === 'true';
  const offset = ts.params.length + 1;

  try {
    const result = await pool.query(
      `SELECT a.id, a.sucursal_id, a.nombre, a.descripcion, a.imagen_url,
              a.tarifa_tipo, a.tarifa_monto, a.requiere_aprobacion, a.activa, a.created_at,
              (SELECT COUNT(*) FROM reservas_areas r
                WHERE r.area_id = a.id AND r.estado IN ('pendiente_aprobacion','confirmada'))
                AS reservas_activas
       FROM areas_comunes a
       ${ts.joinClause}
       WHERE ${ts.whereClause}
         AND ($${offset}::boolean IS NOT TRUE OR a.activa = TRUE)
       ORDER BY a.activa DESC, a.nombre`,
      [...ts.params, soloActivas]
    );
    res.json(result.rows);
  } catch (error) {
    serverError(res, error, 'Error al obtener áreas comunes');
  }
};

export const createArea = async (req: Request, res: Response) => {
  const {
    nombre, descripcion, imagen_url,
    tarifa_tipo, tarifa_monto, activa,
    sucursal_id: bodySucursalId,
  } = req.body;

  if (!nombre) {
    return res.status(400).json({ error: 'Campos requeridos: nombre' });
  }

  const tarifa = validarTarifa(tarifa_tipo ?? 'gratis', tarifa_monto);
  if ('error' in tarifa) return res.status(400).json({ error: tarifa.error });

  const sucResuelta = await resolverSucursal(req.user!, bodySucursalId, pool);
  if (sucResuelta.ok === false) {
    return res.status(sucResuelta.status).json({ error: sucResuelta.error });
  }
  const sucursal_id = sucResuelta.id;

  try {
    const result = await pool.query(
      `INSERT INTO areas_comunes
         (sucursal_id, nombre, descripcion, imagen_url, tarifa_tipo, tarifa_monto,
          requiere_aprobacion, activa)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, TRUE))
       RETURNING *`,
      [
        sucursal_id, nombre, descripcion || null, imagen_url || null,
        tarifa_tipo ?? 'gratis', tarifa.monto,
        leerRequiereAprobacion(req.body),
        activa ?? null,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    serverError(res, error, 'Error al crear área común');
  }
};

export const updateArea = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { nombre, descripcion, imagen_url, tarifa_tipo, tarifa_monto, activa } = req.body;

  // Si tocan la tarifa, hay que revalidar el par tipo/monto contra lo que quede.
  let tipoFinal: string | null = null;
  let montoFinal: number | null = null;
  if (tarifa_tipo !== undefined) {
    const actual = await pool.query('SELECT tarifa_monto FROM areas_comunes WHERE id = $1', [id]);
    if (actual.rows.length === 0) {
      return res.status(404).json({ error: 'Área común no encontrada' });
    }
    const tarifa = validarTarifa(tarifa_tipo, tarifa_monto ?? actual.rows[0].tarifa_monto);
    if ('error' in tarifa) return res.status(400).json({ error: tarifa.error });
    tipoFinal = tarifa_tipo;
    montoFinal = tarifa.monto;
  } else if (tarifa_monto !== undefined) {
    const monto = Number(tarifa_monto);
    if (!Number.isFinite(monto) || monto < 0) {
      return res.status(400).json({ error: 'tarifa_monto no puede ser negativo' });
    }
    montoFinal = monto;
  }

  // requiere_aprobacion es tri-estado: COALESCE nunca podría devolverlo a NULL,
  // así que se usa un centinela booleano para saber si vino en el body.
  const tocaAprobacion = Object.prototype.hasOwnProperty.call(req.body, 'requiere_aprobacion');
  const valorAprobacion = tocaAprobacion ? leerRequiereAprobacion(req.body) : null;

  try {
    const result = await pool.query(
      `UPDATE areas_comunes
          SET nombre       = COALESCE($1, nombre),
              descripcion  = COALESCE($2, descripcion),
              imagen_url   = CASE WHEN $3::boolean THEN $4::text ELSE imagen_url END,
              tarifa_tipo  = COALESCE($5, tarifa_tipo),
              tarifa_monto = COALESCE($6, tarifa_monto),
              requiere_aprobacion =
                CASE WHEN $7::boolean THEN $8::boolean ELSE requiere_aprobacion END,
              activa       = COALESCE($9, activa)
        WHERE id = $10
          AND ${ownershipClause('areas_comunes', 11)}
        RETURNING *`,
      [
        nombre ?? null,
        descripcion ?? null,
        Object.prototype.hasOwnProperty.call(req.body, 'imagen_url'),
        imagen_url || null,
        tipoFinal,
        montoFinal,
        tocaAprobacion,
        valorAprobacion,
        activa ?? null,
        id,
        ...ownershipParams(req.user!),
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Área común no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    serverError(res, error, 'Error al actualizar área común');
  }
};

/**
 * Baja lógica: nunca se borra la fila porque las reservas históricas la
 * referencian. Se rechaza si quedan reservas futuras sin resolver, para no
 * dejarlas huérfanas en silencio.
 */
export const deleteArea = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const futuras = await pool.query(
      `SELECT COUNT(*)::int AS n
         FROM reservas_areas
        WHERE area_id = $1
          AND estado IN ('pendiente_aprobacion','confirmada')
          AND (fecha + hora_fin) > NOW()`,
      [id]
    );
    if (futuras.rows[0].n > 0) {
      return res.status(409).json({
        error: `El área tiene ${futuras.rows[0].n} reserva(s) futura(s). Cancélalas antes de desactivarla.`,
        reservas_futuras: futuras.rows[0].n,
      });
    }

    const result = await pool.query(
      `UPDATE areas_comunes SET activa = FALSE
        WHERE id = $1 AND ${ownershipClause('areas_comunes', 2)}
        RETURNING *`,
      [id, ...ownershipParams(req.user!)]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Área común no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    serverError(res, error, 'Error al eliminar área común');
  }
};
