import { Request, Response } from 'express';
import pool from '../db/pool';
import { serverError } from '../utils/http';

/**
 * Resultado de una acción según su código HTTP (filtro «estado» del panel):
 *   ok         2xx/3xx   salió bien
 *   bloqueado  429       un límite de tasa la frenó
 *   rechazado  4xx ≠ 429 no se permitió o no era válida (401, 403, 404, 409, 423…)
 *   error      5xx       falló el servidor
 */
const FILTRO_ESTADO: Record<string, string> = {
  ok:        '(al.status_code IS NULL OR al.status_code < 400)',
  bloqueado: 'al.status_code = 429',
  rechazado: '(al.status_code >= 400 AND al.status_code < 500 AND al.status_code <> 429)',
  error:     'al.status_code >= 500',
};

export const getAuditLogs = async (req: Request, res: Response) => {
  const limit     = Math.min(parseInt(req.query.limit  as string) || 50, 200);
  const offset    = parseInt(req.query.offset     as string) || 0;
  const accion    = (req.query.accion     as string | undefined) || null;
  const usuarioId = (req.query.usuario_id as string | undefined) || null;
  const desde     = (req.query.desde      as string | undefined) || null;
  const hasta     = (req.query.hasta      as string | undefined) || null;
  const estado    = (req.query.estado     as string | undefined) || null;
  const buscar    = ((req.query.buscar    as string | undefined) || '').trim().slice(0, 100);

  if (estado && !(estado in FILTRO_ESTADO)) {
    return res.status(400).json({ error: 'estado debe ser: ok, rechazado, bloqueado o error' });
  }

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
  if (estado) conditions.push(FILTRO_ESTADO[estado]);
  if (buscar) {
    // Persona (nombre o correo de la cuenta) o, en los login sin sesión, el correo intentado.
    params.push(`%${buscar.replace(/[\\%_]/g, m => `\\${m}`)}%`);
    conditions.push(`(u.nombre ILIKE $${params.length} OR u.email ILIKE $${params.length} OR al.datos_nuevos->>'email' ILIKE $${params.length})`);
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
      `SELECT COUNT(*) FROM audit_logs al LEFT JOIN usuarios u ON al.usuario_id = u.id ${where}`,
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

/**
 * Acciones que existen en la bitácora (con cuántas filas tiene cada una), para llenar el filtro del panel: la lista ya
 * no está escrita a mano en el frontend —tenía 11 de ~75— así que una acción nueva aparece sola.
 */
export const getAuditAcciones = async (_req: Request, res: Response) => {
  try {
    const r = await pool.query(
      `SELECT accion, COUNT(*)::int AS total, MAX(created_at) AS ultima
         FROM audit_logs GROUP BY accion ORDER BY accion`);
    res.json({ acciones: r.rows });
  } catch (error) {
    serverError(res, error, 'Error al obtener las acciones de auditoría');
  }
};
