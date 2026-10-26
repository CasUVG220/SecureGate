import { Request, Response } from 'express';
import pool from '../db/pool';
import { JwtPayload } from '../middleware/auth.middleware';
import { serverError } from '../utils/http';
import { JOINS_ACCESO, METODO_SQL, PLACA_ACCESO_SQL } from '../utils/accesos';

interface TenantCondition {
  accesos: string;
  residentes: string;
  pagos: string;
  /** Alcance sobre `areas_comunes a` (las reservas cuelgan del área). */
  reservas: string;
  params: (string | null)[];
}

function buildConditions(user: JwtPayload): TenantCondition {
  if (user.rol === 'owner') {
    return { accesos: 'TRUE', residentes: 'TRUE', pagos: 'TRUE', reservas: 'TRUE', params: [] };
  }
  if (user.rol === 'admin_empresa') {
    return {
      accesos:    'EXISTS (SELECT 1 FROM sucursales _s WHERE _s.id = ra.sucursal_id AND _s.empresa_id = $1)',
      residentes: 'EXISTS (SELECT 1 FROM sucursales _s WHERE _s.id = r.sucursal_id  AND _s.empresa_id = $1)',
      pagos:      'EXISTS (SELECT 1 FROM sucursales _s WHERE _s.id = p.sucursal_id  AND _s.empresa_id = $1)',
      reservas:   'EXISTS (SELECT 1 FROM sucursales _s WHERE _s.id = a.sucursal_id  AND _s.empresa_id = $1)',
      params: [user.empresa_id],
    };
  }
  return {
    accesos:    'ra.sucursal_id = $1',
    residentes: 'r.sucursal_id  = $1',
    pagos:      'p.sucursal_id  = $1',
    reservas:   'a.sucursal_id  = $1',
    params: [user.sucursal_id],
  };
}

export const getDashboard = async (req: Request, res: Response) => {
  const cond = buildConditions(req.user!);

  try {
    const [accesosHoy, residentesMora, pagosPendientes, accesosRecientes, porHora, ayer, dentro, reservasPendientes] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM registros_acceso ra
         WHERE DATE(ra.timestamp_entrada) = CURRENT_DATE
           AND ${cond.accesos}`,
        cond.params
      ),
      // Un solo recorrido da la mora y el padrón completo: con `registrados = 0` el panel
      // enseña los primeros pasos en vez de un tablero de ceros.
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE r.estado_pago = 'mora')::int AS total,
                COUNT(*)::int AS registrados
         FROM residentes r
         WHERE ${cond.residentes}`,
        cond.params
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM pagos p
         WHERE p.estado = 'pendiente'
           AND ${cond.pagos}`,
        cond.params
      ),
      // Visitantes y residentes (sus entradas por placas, Sprint 10): el administrador también ve lo que el sistema abrió solo.
      pool.query(
        `SELECT ra.id,
                COALESCE(v.nombre, ur.nombre) AS nombre_visitante,
                r.numero_casa,
                ra.timestamp_entrada,
                ra.timestamp_salida,
                (${METODO_SQL}) AS metodo,
                (ra.visitante_id IS NULL) AS es_residente,
                (ra.verificado_por IS NOT NULL) AS verificado,
                ${PLACA_ACCESO_SQL} AS placa
         FROM registros_acceso ra
         ${JOINS_ACCESO}
         WHERE ${cond.accesos}
         ORDER BY ra.timestamp_entrada DESC
         LIMIT 10`,
        cond.params
      ),
      pool.query(
        `SELECT EXTRACT(HOUR FROM ra.timestamp_entrada)::int AS hora, COUNT(*)::int AS total
         FROM registros_acceso ra
         WHERE DATE(ra.timestamp_entrada) = CURRENT_DATE
           AND ${cond.accesos}
         GROUP BY 1`,
        cond.params
      ),
      // Ayer hasta esta misma hora: comparar el día en curso contra el día
      // completo de ayer diría "bajaron" cada mañana.
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM registros_acceso ra
         WHERE DATE(ra.timestamp_entrada) = CURRENT_DATE - 1
           AND ra.timestamp_entrada::time <= LOCALTIME
           AND ${cond.accesos}`,
        cond.params
      ),
      // Quién sigue dentro: entradas sin salida de las últimas 24 h. Antes la
      // pantalla lo deducía de los 10 accesos recientes y se quedaba corta.
      // El límite de 24 h deja fuera las salidas olvidadas de días atrás.
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM registros_acceso ra
         WHERE ra.timestamp_salida IS NULL
           AND ra.timestamp_entrada >= NOW() - INTERVAL '24 hours'
           AND ${cond.accesos}`,
        cond.params
      ),
      // Reservas que esperan una decisión del administrador: sin aviso, el residente se queda
      // sin respuesta hasta que alguien abre la pantalla de reservas por casualidad.
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM reservas_areas rv
         JOIN areas_comunes a ON a.id = rv.area_id
         WHERE rv.estado = 'pendiente_aprobacion'
           AND ${cond.reservas}`,
        cond.params
      ),
    ]);

    const accesosPorHora = Array<number>(24).fill(0);
    for (const f of porHora.rows) {
      if (f.hora >= 0 && f.hora < 24) accesosPorHora[f.hora] = f.total;
    }

    res.json({
      accesos_hoy:       accesosHoy.rows[0].total,
      residentes_mora:   residentesMora.rows[0].total,
      total_residentes:  residentesMora.rows[0].registrados ?? 0,
      pagos_pendientes:  pagosPendientes.rows[0].total,
      reservas_pendientes: reservasPendientes.rows[0]?.total ?? 0,
      accesos_recientes: accesosRecientes.rows,
      accesos_por_hora:  accesosPorHora,
      accesos_ayer_misma_hora: ayer.rows[0]?.total ?? 0,
      dentro_ahora:      dentro.rows[0]?.total ?? 0,
    });
  } catch (error) {
    serverError(res, error, 'Error al obtener datos del dashboard');
  }
};
