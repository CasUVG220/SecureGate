import { Request, Response } from 'express';
import pool from '../db/pool';
import { tenantFilter, ownershipClause, ownershipParams } from '../utils/tenant';
import { serverError } from '../utils/http';

export const getCargos = async (req: Request, res: Response) => {
  const ts = tenantFilter(req.user!, 'cp');
  try {
    const result = await pool.query(
      `SELECT cp.*,
         (SELECT COUNT(*) FROM cargos_programados_historial cph
          WHERE cph.cargo_programado_id = cp.id) AS veces_aplicado,
         (SELECT COUNT(DISTINCT cph.residente_id) FROM cargos_programados_historial cph
          WHERE cph.cargo_programado_id = cp.id) AS residentes_afectados
       FROM cargos_programados cp
       ${ts.joinClause}
       WHERE ${ts.whereClause}
       ORDER BY cp.created_at DESC`,
      ts.params
    );
    res.json(result.rows);
  } catch (error) {
    serverError(res, error, 'Error al obtener cargos programados');
  }
};

export const createCargo = async (req: Request, res: Response) => {
  const { nombre, descripcion, monto, frecuencia, aplica_a } = req.body;
  if (!nombre || monto === undefined) {
    return res.status(400).json({ error: 'Campos requeridos: nombre, monto' });
  }
  const montoNum = Number(monto);
  if (!Number.isFinite(montoNum) || montoNum <= 0 || montoNum > 1_000_000) {
    return res.status(400).json({ error: 'monto debe ser un número mayor a 0' });
  }
  const sucursal_id = req.user!.sucursal_id;
  if (!sucursal_id) {
    return res.status(400).json({ error: 'Se requiere sucursal_id' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO cargos_programados
         (sucursal_id, nombre, descripcion, monto, frecuencia, aplica_a, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        sucursal_id,
        nombre,
        descripcion || null,
        monto,
        frecuencia || 'mensual',
        aplica_a || 'todos',
        req.user!.id,
      ]
    );
    res.status(201).json({ ...result.rows[0], veces_aplicado: 0, residentes_afectados: 0 });
  } catch (error) {
    serverError(res, error, 'Error al crear cargo programado');
  }
};

export const updateCargo = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { nombre, descripcion, monto, frecuencia, activo } = req.body;
  try {
    const result = await pool.query(
      `UPDATE cargos_programados
       SET nombre      = COALESCE($1, nombre),
           descripcion = COALESCE($2, descripcion),
           monto       = COALESCE($3, monto),
           frecuencia  = COALESCE($4, frecuencia),
           activo      = COALESCE($5, activo)
       WHERE id = $6
         AND ${ownershipClause('cargos_programados', 7)}
       RETURNING *`,
      [nombre ?? null, descripcion ?? null, monto ?? null, frecuencia ?? null, activo ?? null, id, ...ownershipParams(req.user!)]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cargo programado no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    serverError(res, error, 'Error al actualizar cargo programado');
  }
};

export const deleteCargo = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE cargos_programados SET activo = FALSE
        WHERE id = $1 AND ${ownershipClause('cargos_programados', 2)}
        RETURNING *`,
      [id, ...ownershipParams(req.user!)]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cargo programado no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    serverError(res, error, 'Error al eliminar cargo programado');
  }
};

export const aplicarCargo = async (req: Request, res: Response) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Alcance + FOR UPDATE: dos aplicaciones simultáneas del mismo cargo se
    // serializan sobre la fila, así el chequeo de duplicado de abajo es fiable.
    const cargoResult = await client.query(
      `SELECT * FROM cargos_programados
        WHERE id = $1 AND activo = TRUE
          AND ${ownershipClause('cargos_programados', 2)}
        FOR UPDATE`,
      [id, ...ownershipParams(req.user!)]
    );
    if (cargoResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cargo programado no encontrado o inactivo' });
    }
    const cargo = cargoResult.rows[0];

    // Deduplication check per frecuencia
    const frecuencia: string = cargo.frecuencia;
    let dupQuery: string;
    if (frecuencia === 'unica_vez') {
      dupQuery = `SELECT applied_at FROM cargos_programados_historial
        WHERE cargo_programado_id = $1 LIMIT 1`;
    } else if (frecuencia === 'quincenal') {
      dupQuery = `SELECT applied_at FROM cargos_programados_historial
        WHERE cargo_programado_id = $1 AND applied_at > NOW() - INTERVAL '15 days' LIMIT 1`;
    } else {
      dupQuery = `SELECT applied_at FROM cargos_programados_historial
        WHERE cargo_programado_id = $1
          AND EXTRACT(MONTH FROM applied_at) = EXTRACT(MONTH FROM NOW())
          AND EXTRACT(YEAR  FROM applied_at) = EXTRACT(YEAR  FROM NOW())
        LIMIT 1`;
    }
    const dupResult = await client.query(dupQuery, [id]);
    if (dupResult.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Este cargo ya fue aplicado en el periodo actual',
        ultimo_aplicado: cargo.ultimo_aplicado,
      });
    }

    // Bulk insert historial for all residents
    const insertResult = await client.query(
      `INSERT INTO cargos_programados_historial
         (cargo_programado_id, residente_id, monto, aplicado_por)
       SELECT $1, r.id, $2, $3
       FROM residentes r
       WHERE r.sucursal_id = $4`,
      [id, cargo.monto, req.user!.id, cargo.sucursal_id]
    );
    const aplicadoA = insertResult.rowCount ?? 0;
    if (aplicadoA === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No hay residentes en la sucursal' });
    }

    // Bulk update saldo and estado_pago
    await client.query(
      `UPDATE residentes
       SET saldo_pendiente = saldo_pendiente + $1,
           estado_pago = CASE WHEN estado_pago = 'al_dia' THEN 'mora' ELSE estado_pago END
       WHERE sucursal_id = $2`,
      [cargo.monto, cargo.sucursal_id]
    );

    await client.query(
      `UPDATE cargos_programados SET ultimo_aplicado = NOW() WHERE id = $1`,
      [id]
    );

    await client.query('COMMIT');
    res.json({
      aplicado_a: aplicadoA,
      monto_total: (parseFloat(cargo.monto) * aplicadoA).toFixed(2),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    serverError(res, error, 'Error al aplicar cargo programado');
  } finally {
    client.release();
  }
};

export const getHistorial = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT
         h.applied_at,
         COUNT(*)        AS residentes,
         SUM(h.monto)    AS monto_total,
         u.nombre        AS aplicado_por_nombre
       FROM cargos_programados_historial h
       JOIN usuarios u ON u.id = h.aplicado_por
       JOIN cargos_programados cp ON cp.id = h.cargo_programado_id
       WHERE h.cargo_programado_id = $1
         AND ${ownershipClause('cp', 2)}
       GROUP BY h.applied_at, h.aplicado_por, u.nombre
       ORDER BY h.applied_at DESC`,
      [id, ...ownershipParams(req.user!)]
    );
    res.json(result.rows);
  } catch (error) {
    serverError(res, error, 'Error al obtener historial');
  }
};
