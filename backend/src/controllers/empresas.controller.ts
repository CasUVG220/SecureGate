import { Request, Response } from 'express';
import pool from '../db/pool';

export const getEmpresas = async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT e.*, COUNT(s.id)::int AS total_sucursales
       FROM empresas e
       LEFT JOIN sucursales s ON s.empresa_id = e.id AND s.activo = TRUE
       WHERE e.activo = TRUE
       GROUP BY e.id
       ORDER BY e.created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener empresas', detail: String(error) });
  }
};

export const createEmpresa = async (req: Request, res: Response) => {
  const { nombre, nit, logo_url } = req.body;
  if (!nombre) {
    return res.status(400).json({ error: 'Campo requerido: nombre' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO empresas (nombre, nit, logo_url)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [nombre, nit ?? null, logo_url ?? null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear empresa', detail: String(error) });
  }
};

export const updateEmpresa = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { nombre, nit, logo_url, activo } = req.body;

  try {
    const result = await pool.query(
      `UPDATE empresas
       SET nombre   = COALESCE($1, nombre),
           nit      = COALESCE($2, nit),
           logo_url = COALESCE($3, logo_url),
           activo   = COALESCE($4, activo)
       WHERE id = $5
       RETURNING *`,
      [nombre ?? null, nit ?? null, logo_url ?? null, activo ?? null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar empresa', detail: String(error) });
  }
};

export const deleteEmpresa = async (req: Request, res: Response) => {
  const { id } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get all sucursal IDs for this empresa
    const sucRes = await client.query(
      `SELECT id FROM sucursales WHERE empresa_id = $1`,
      [id]
    );
    const sucIds: string[] = sucRes.rows.map((r: { id: string }) => r.id);

    if (sucIds.length > 0) {
      // Deactivate cargos automáticos for residents of these sucursales
      await client.query(
        `UPDATE cargos_automaticos SET aplicado = TRUE
         WHERE residente_id IN (
           SELECT id FROM residentes WHERE sucursal_id = ANY($1::uuid[])
         )`,
        [sucIds]
      );

      // Deactivate preautorizaciones
      await client.query(
        `UPDATE preautorizaciones SET activo = FALSE
         WHERE sucursal_id = ANY($1::uuid[])`,
        [sucIds]
      );

      // Deactivate pagos
      await client.query(
        `UPDATE pagos SET estado = 'rechazado'
         WHERE sucursal_id = ANY($1::uuid[]) AND estado = 'pendiente'`,
        [sucIds]
      );

      // Deactivate residentes
      await client.query(
        `UPDATE residentes SET estado_pago = 'pendiente'
         WHERE sucursal_id = ANY($1::uuid[])`,
        [sucIds]
      );

      // Deactivate all staff users in those sucursales
      await client.query(
        `UPDATE usuarios SET activo = FALSE
         WHERE sucursal_id = ANY($1::uuid[])`,
        [sucIds]
      );

      // Deactivate all sucursales
      await client.query(
        `UPDATE sucursales SET activo = FALSE WHERE empresa_id = $1`,
        [id]
      );
    }

    // Deactivate empresa-level users (admin_empresa)
    await client.query(
      `UPDATE usuarios SET activo = FALSE, empresa_id = NULL
       WHERE empresa_id = $1 AND rol = 'admin_empresa'`,
      [id]
    );

    // Deactivate empresa
    const result = await client.query(
      `UPDATE empresas SET activo = FALSE WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }

    await client.query('COMMIT');
    res.json({ message: 'Empresa y todos sus recursos desactivados', id });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Error al eliminar empresa', detail: String(error) });
  } finally {
    client.release();
  }
};

export const assignAdminEmpresa = async (req: Request, res: Response) => {
  const { id } = req.params; // empresa_id
  const { usuario_id } = req.body;

  if (!usuario_id) {
    return res.status(400).json({ error: 'Campo requerido: usuario_id' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify empresa exists
    const empCheck = await client.query(
      'SELECT id FROM empresas WHERE id = $1 AND activo = TRUE',
      [id]
    );
    if (empCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }

    // Remove current admin_empresa of this empresa (demote to agente)
    await client.query(
      `UPDATE usuarios SET rol = 'agente', empresa_id = NULL
       WHERE empresa_id = $1 AND rol = 'admin_empresa'`,
      [id]
    );

    // Assign new admin_empresa
    const result = await client.query(
      `UPDATE usuarios
       SET rol = 'admin_empresa', empresa_id = $1, activo = TRUE
       WHERE id = $2
       RETURNING id, nombre, email, rol, empresa_id`,
      [id, usuario_id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Error al asignar admin empresa', detail: String(error) });
  } finally {
    client.release();
  }
};

export const getEmpresaStats = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const [
      sucursalesRes,
      residentesRes,
      accesosRes,
      pagosRes,
      sucursalesDetalle,
    ] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM sucursales
         WHERE empresa_id = $1 AND activo = TRUE`,
        [id]
      ),
      pool.query(
        `SELECT COUNT(DISTINCT r.id)::int AS total
         FROM residentes r
         JOIN sucursales s ON r.sucursal_id = s.id
         WHERE s.empresa_id = $1`,
        [id]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM registros_acceso ra
         JOIN sucursales s ON ra.sucursal_id = s.id
         WHERE s.empresa_id = $1
           AND DATE(ra.timestamp_entrada) = CURRENT_DATE`,
        [id]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM pagos p
         JOIN sucursales s ON p.sucursal_id = s.id
         WHERE s.empresa_id = $1 AND p.estado = 'pendiente'`,
        [id]
      ),
      pool.query(
        `SELECT s.id, s.nombre, COUNT(ra.id)::int AS accesos_hoy
         FROM sucursales s
         LEFT JOIN registros_acceso ra
           ON ra.sucursal_id = s.id
           AND DATE(ra.timestamp_entrada) = CURRENT_DATE
         WHERE s.empresa_id = $1 AND s.activo = TRUE
         GROUP BY s.id, s.nombre
         ORDER BY s.nombre`,
        [id]
      ),
    ]);

    res.json({
      total_sucursales:       sucursalesRes.rows[0].total,
      total_residentes:       residentesRes.rows[0].total,
      total_accesos_hoy:      accesosRes.rows[0].total,
      total_pagos_pendientes: pagosRes.rows[0].total,
      sucursales:             sucursalesDetalle.rows,
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener estadísticas', detail: String(error) });
  }
};
