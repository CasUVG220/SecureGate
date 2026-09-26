import { Request, Response } from 'express';
import pool from '../db/pool';
import { tenantFilter, ownershipClause, ownershipParams, resolverSucursal } from '../utils/tenant';
import { serverError } from '../utils/http';

const FRECUENCIAS = ['unica_vez', 'quincenal', 'mensual'];

/** Monto positivo y con tope razonable; devuelve el número o null si no es válido. */
const montoValido = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 1_000_000 ? n : null;
};

export const getConfiguracion = async (req: Request, res: Response) => {
  const ts = tenantFilter(req.user!, 'c');
  try {
    const result = await pool.query(
      `SELECT c.* FROM configuracion_cargos c
       ${ts.joinClause}
       WHERE ${ts.whereClause}
       ORDER BY c.created_at`,
      ts.params
    );
    res.json(result.rows);
  } catch (error) {
    serverError(res, error, 'Error al obtener configuración de cargos');
  }
};

export const createConfiguracion = async (req: Request, res: Response) => {
  const { nombre, monto, activo, sucursal_id, frecuencia, restringir_visitas_mora, costo_extra_visita_mora } = req.body;
  if (!nombre || monto === undefined) {
    return res.status(400).json({ error: 'Campos requeridos: nombre, monto' });
  }
  if (montoValido(monto) === null) {
    return res.status(400).json({ error: 'monto debe ser un número mayor a 0' });
  }
  const resolvedFrecuencia: string = frecuencia ?? 'mensual';
  if (!FRECUENCIAS.includes(resolvedFrecuencia)) {
    return res.status(400).json({ error: 'frecuencia debe ser: unica_vez, quincenal o mensual' });
  }
  if (costo_extra_visita_mora !== undefined && !(Number(costo_extra_visita_mora) >= 0)) {
    return res.status(400).json({ error: 'costo_extra_visita_mora no puede ser negativo' });
  }

  // La sucursal se resuelve y valida contra el alcance del usuario: antes se
  // tomaba tal cual del body, así que se podía crear configuración en cualquier
  // sucursal de cualquier empresa.
  const sucResuelta = await resolverSucursal(req.user!, sucursal_id, pool);
  if (sucResuelta.ok === false) {
    return res.status(sucResuelta.status).json({ error: sucResuelta.error });
  }

  try {
    const result = await pool.query(
      `INSERT INTO configuracion_cargos
         (nombre, monto, activo, sucursal_id, frecuencia, restringir_visitas_mora, costo_extra_visita_mora)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        nombre, monto, activo !== undefined ? activo : true, sucResuelta.id, resolvedFrecuencia,
        restringir_visitas_mora ?? false, costo_extra_visita_mora ?? 0,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    serverError(res, error, 'Error al crear configuración de cargo');
  }
};

export const updateConfiguracion = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { nombre, monto, activo, frecuencia, restringir_visitas_mora, costo_extra_visita_mora } = req.body;
  if (monto !== undefined && montoValido(monto) === null) {
    return res.status(400).json({ error: 'monto debe ser un número mayor a 0' });
  }
  if (frecuencia !== undefined && !FRECUENCIAS.includes(frecuencia)) {
    return res.status(400).json({ error: 'frecuencia debe ser: unica_vez, quincenal o mensual' });
  }
  try {
    const result = await pool.query(
      `UPDATE configuracion_cargos
       SET nombre    = COALESCE($1, nombre),
           monto     = COALESCE($2, monto),
           activo    = COALESCE($3, activo),
           frecuencia = COALESCE($4, frecuencia),
           restringir_visitas_mora = COALESCE($5, restringir_visitas_mora),
           costo_extra_visita_mora = COALESCE($6, costo_extra_visita_mora)
       WHERE id = $7
         AND ${ownershipClause('configuracion_cargos', 8)}
       RETURNING *`,
      [
        nombre ?? null, monto ?? null, activo ?? null, frecuencia ?? null,
        restringir_visitas_mora ?? null, costo_extra_visita_mora ?? null,
        id,
        ...ownershipParams(req.user!),
      ]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Configuración de cargo no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    serverError(res, error, 'Error al actualizar configuración');
  }
};

export const deleteConfiguracion = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE configuracion_cargos SET activo = FALSE
       WHERE id = $1 AND ${ownershipClause('configuracion_cargos', 2)}
       RETURNING *`,
      [id, ...ownershipParams(req.user!)]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Configuración de cargo no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    serverError(res, error, 'Error al eliminar configuración');
  }
};

export const aplicarCargo = async (req: Request, res: Response) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Sólo cargos de residentes del alcance del usuario; FOR UPDATE serializa
    // dos aplicaciones simultáneas del mismo cargo.
    const cargoResult = await client.query(
      `SELECT ca.residente_id, ca.monto, ca.aplicado
         FROM cargos_automaticos ca
         JOIN residentes r ON r.id = ca.residente_id
        WHERE ca.id = $1
          AND ${ownershipClause('r', 2)}
        FOR UPDATE OF ca`,
      [id, ...ownershipParams(req.user!)]
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
    serverError(res, error, 'Error al aplicar cargo');
  } finally {
    client.release();
  }
};
