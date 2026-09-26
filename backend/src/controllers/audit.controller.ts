import { Request, Response } from 'express';
import pool from '../db/pool';
import { serverError } from '../utils/http';

export const getAuditLogs = async (req: Request, res: Response) => {
  const limit     = Math.min(parseInt(req.query.limit  as string) || 50, 200);
  const offset    = parseInt(req.query.offset     as string) || 0;
  const accion    = (req.query.accion     as string | undefined) || null;
  const usuarioId = (req.query.usuario_id as string | undefined) || null;
  const desde     = (req.query.desde      as string | undefined) || null;
  const hasta     = (req.query.hasta      as string | undefined) || null;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (accion) {
    params.push(accion);
    conditions.push(`al.accion = $${params.length}`);
  }
  if (usuarioId) {
    params.push(usuarioId);
    conditions.push(`al.usuario_id = $${params.length}`);
  }
  if (desde) {
    params.push(desde);
    conditions.push(`al.created_at >= $${params.length}`);
  }
  if (hasta) {
    // Include the entire "hasta" day by pushing the upper bound to end of day
    params.push(hasta);
    conditions.push(`al.created_at <= ($${params.length}::date + INTERVAL '1 day')`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await pool.query(
      `SELECT al.id, al.accion, al.tabla_afectada, al.registro_id,
              al.ip_address, al.user_agent, al.sucursal_id, al.created_at,
              al.status_code, al.datos_nuevos,
              u.nombre AS usuario_nombre, u.email AS usuario_email
       FROM audit_logs al
       LEFT JOIN usuarios u ON al.usuario_id = u.id
       ${where}
       ORDER BY al.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM audit_logs al ${where}`,
      params,
    );

    res.json({
      logs:   result.rows,
      total:  parseInt(countResult.rows[0].count),
      limit,
      offset,
    });
  } catch (error) {
    serverError(res, error, 'Error al obtener logs de auditoría');
  }
};
