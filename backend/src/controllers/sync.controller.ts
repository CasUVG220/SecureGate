import { Request, Response } from 'express';
import pool from '../db/pool';
import { serverError } from '../utils/http';

/**
 * GET /sync/garita — snapshot de lo que la app de escritorio necesita para
 * decidir accesos sin internet: residentes, blacklist vigente y
 * preautorizaciones vigentes de la sucursal de la LICENCIA (no del agente:
 * el dispositivo está fijo en una garita, la persona puede rotar).
 *
 * Es un pull completo, no incremental: son tablas pequeñas por sucursal
 * (cientos de filas) y así el espejo local nunca se desincroniza por perder
 * un evento. Si algún condominio crece hasta que esto pese, se añade
 * `?desde=` sobre updated_at.
 */
export const getSnapshotGarita = async (req: Request, res: Response) => {
  const sucursal_id = req.licencia!.sucursal_id;
  // La sesión del agente y la licencia del equipo tienen que ser de la misma
  // sucursal: sin esto, un agente de la sucursal A con la licencia robada de la
  // B descargaba el padrón completo de la B.
  if (req.user!.sucursal_id && req.user!.sucursal_id !== sucursal_id) {
    return res.status(403).json({ error: 'La sesión del agente no corresponde a la sucursal de esta licencia' });
  }
  try {
    const [residentes, blacklist, blacklistResidente, preautorizaciones] = await Promise.all([
      pool.query(
        `SELECT r.id, r.numero_casa, r.estado_pago, r.telefono, u.nombre
         FROM residentes r
         JOIN usuarios u ON u.id = r.usuario_id
         WHERE r.sucursal_id = $1 AND u.activo = TRUE
         ORDER BY r.numero_casa`,
        [sucursal_id],
      ),
      pool.query(
        `SELECT bl.id, v.numero_dpi, v.nombre AS visitante_nombre, bl.razon, bl.fecha_fin,
                NULL::uuid AS residente_id, bl.placa
         FROM visitante_blacklist bl
         LEFT JOIN visitantes v ON v.id = bl.visitante_id
         WHERE bl.sucursal_id = $1
           AND bl.activo = TRUE
           AND (bl.fecha_fin IS NULL OR bl.fecha_fin > NOW())`,
        [sucursal_id],
      ),
      pool.query(
        `SELECT rvbl.id, v.numero_dpi, v.nombre AS visitante_nombre, rvbl.razon,
                NULL::timestamp AS fecha_fin, rvbl.residente_id, NULL::varchar AS placa
         FROM residente_visitante_blacklist rvbl
         JOIN visitantes v ON v.id = rvbl.visitante_id
         JOIN residentes r ON r.id = rvbl.residente_id
         WHERE r.sucursal_id = $1 AND rvbl.activo = TRUE`,
        [sucursal_id],
      ),
      pool.query(
        `SELECT p.id, p.residente_id, p.nombre_visitante, p.numero_dpi, p.placa,
                p.fecha_inicio, p.fecha_fin
         FROM preautorizaciones p
         WHERE p.sucursal_id = $1
           AND p.activo = TRUE
           AND p.fecha_fin IS NOT NULL           -- sin fecha de fin es un visitante guardado, no un aviso
           AND p.fecha_fin >= CURRENT_DATE`,
        [sucursal_id],
      ),
    ]);

    res.json({
      sucursal_id,
      servidor_ahora: new Date().toISOString(),
      residentes: residentes.rows,
      blacklist: [...blacklist.rows, ...blacklistResidente.rows],
      preautorizaciones: preautorizaciones.rows,
    });
  } catch (error) {
    serverError(res, error, 'Error al generar snapshot de sincronización');
  }
};
