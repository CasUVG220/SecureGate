import { Request, Response } from 'express';
import pool from '../db/pool';
import { JwtPayload } from '../middleware/auth.middleware';

interface TenantCondition {
  accesos: string;
  residentes: string;
  pagos: string;
  params: (string | null)[];
}

function buildConditions(user: JwtPayload): TenantCondition {
  if (user.rol === 'owner') {
    return { accesos: 'TRUE', residentes: 'TRUE', pagos: 'TRUE', params: [] };
  }
  if (user.rol === 'admin_empresa') {
    return {
      accesos:    'EXISTS (SELECT 1 FROM sucursales _s WHERE _s.id = ra.sucursal_id AND _s.empresa_id = $1)',
      residentes: 'EXISTS (SELECT 1 FROM sucursales _s WHERE _s.id = r.sucursal_id  AND _s.empresa_id = $1)',
      pagos:      'EXISTS (SELECT 1 FROM sucursales _s WHERE _s.id = p.sucursal_id  AND _s.empresa_id = $1)',
      params: [user.empresa_id],
    };
  }
  return {
    accesos:    'ra.sucursal_id = $1',
    residentes: 'r.sucursal_id  = $1',
    pagos:      'p.sucursal_id  = $1',
    params: [user.sucursal_id],
  };
}

export const getDashboard = async (req: Request, res: Response) => {
  const cond = buildConditions(req.user!);

  try {
    const [accesosHoy, residentesMora, pagosPendientes, accesosRecientes] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM registros_acceso ra
         WHERE DATE(ra.timestamp_entrada) = CURRENT_DATE
           AND ${cond.accesos}`,
        cond.params
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM residentes r
         WHERE r.estado_pago = 'mora'
           AND ${cond.residentes}`,
        cond.params
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM pagos p
         WHERE p.estado = 'pendiente'
           AND ${cond.pagos}`,
        cond.params
      ),
      pool.query(
        `SELECT ra.id,
                v.nombre  AS nombre_visitante,
                r.numero_casa,
                ra.timestamp_entrada,
                ra.timestamp_salida
         FROM registros_acceso ra
         JOIN visitantes v ON ra.visitante_id = v.id
         JOIN residentes r ON ra.residente_id = r.id
         WHERE ${cond.accesos}
         ORDER BY ra.timestamp_entrada DESC
         LIMIT 10`,
        cond.params
      ),
    ]);

    res.json({
      accesos_hoy:       accesosHoy.rows[0].total,
      residentes_mora:   residentesMora.rows[0].total,
      pagos_pendientes:  pagosPendientes.rows[0].total,
      accesos_recientes: accesosRecientes.rows,
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener datos del dashboard', detail: String(error) });
  }
};
