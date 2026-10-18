import { Request, Response } from 'express';
import pool from '../db/pool';
import { serverError } from '../utils/http';

/**
 * GET /sync/garita — snapshot de lo que la app de escritorio necesita para
 * decidir accesos sin internet: residentes, blacklist vigente, preautorizaciones
 * vigentes e invitaciones QR de la sucursal de la LICENCIA (no del agente:
 * el dispositivo está fijo en una garita, la persona puede rotar).
 *
 * Es un pull completo, no incremental: son tablas pequeñas por sucursal
 * (cientos de filas) y así el espejo local nunca se desincroniza por perder
 * un evento. Si algún condominio crece hasta que esto pese, se añade
 * `?desde=` sobre updated_at.
 *
 * Excepción (Sprint 10, ANPR): los VEHÍCULOS AUTORIZADOS de los residentes llevan versión. Con `?vehiculos_desde=<versión>` solo
 * vienen los que cambiaron desde entonces (incluidas las bajas, como filas con `activo: false`, para que la garita las borre de su
 * copia); sin el parámetro (o con 0) viene la lista completa de los que hoy pueden entrar. La versión sube también cuando cambia un
 * bloqueo por placa o se da de baja al usuario del residente (disparadores en init.sql). Ver docs/anpr_continuo.md.
 */
/** La mayor de dos versiones (texto de dígitos sin ceros a la izquierda; un bigint de Postgres no cabe siempre en un number). */
const mayorVersion = (a: string, b: string): string => (a.length !== b.length ? (a.length > b.length ? a : b) : a > b ? a : b);

export const getSnapshotGarita = async (req: Request, res: Response) => {
  const sucursal_id = req.licencia!.sucursal_id;
  // La sesión del agente y la licencia del equipo tienen que ser de la misma
  // sucursal: sin esto, un agente de la sucursal A con la licencia robada de la
  // B descargaba el padrón completo de la B.
  if (req.user!.sucursal_id && req.user!.sucursal_id !== sucursal_id) {
    return res.status(403).json({ error: 'La sesión del agente no corresponde a la sucursal de esta licencia' });
  }
  try {
    // Versión desde la que la garita ya tiene los vehículos (texto de dígitos: un bigint no cabe siempre en un number de JS).
    const desdeRaw = typeof req.query.vehiculos_desde === 'string' ? req.query.vehiculos_desde : '';
    const vehiculosDesde = /^\d{1,18}$/.test(desdeRaw) ? desdeRaw.replace(/^0+(?=\d)/, '') : '0';
    const [residentes, blacklist, blacklistResidente, preautorizaciones, invitacionesQr, vehiculos, versionVehiculos] = await Promise.all([
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
      // Invitaciones QR (SCRUM-126): copia para validarlas SIN red. Entran las que aún pueden servir por fecha (con un día
      // de margen contado en Guatemala; la garita decide con su propia fecha)
      // y, de las revocadas, solo las del último mes: así la garita puede decir «revocada» en vez de «no encontrada» sin que
      // el espejo crezca para siempre. Las fechas viajan como texto AAAA-MM-DD (no como instantes) para no depender de la
      // zona del servidor. Quedan fuera las ya vencidas de antes: sin red se rechazan igual («no está en la copia local»).
      pool.query(
        `SELECT i.id, i.tipo, i.etiqueta, i.nombre_visitante, i.numero_dpi, i.placa,
                i.residente_id, r.numero_casa, u.nombre AS residente_nombre,
                to_char(i.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
                to_char(i.fecha_fin,    'YYYY-MM-DD') AS fecha_fin,
                i.usos_maximos, i.usos_actuales, i.activo, i.bloqueado_hasta
         FROM invitaciones_qr i
         JOIN residentes r ON r.id = i.residente_id
         JOIN usuarios   u ON u.id = r.usuario_id
         WHERE i.sucursal_id = $1
           AND (i.fecha_fin IS NULL OR i.fecha_fin >= (NOW() AT TIME ZONE 'America/Guatemala')::date - 1)
           AND (i.activo = TRUE OR i.created_at > NOW() - INTERVAL '30 days')
         ORDER BY i.created_at DESC`,
        [sucursal_id],
      ),
      // Vehículos autorizados de los residentes (ANPR). `activo` ya combina la baja del vehículo con la del usuario del residente.
      // En el pull completo solo van los que pueden entrar (o vencieron ayer: la garita decide con su propia fecha); en el
      // incremental, todo lo que cambió.
      pool.query(
        `SELECT v.id, v.placa, v.residente_id, r.numero_casa, u.nombre AS residente_nombre,
                to_char(v.vigente_desde, 'YYYY-MM-DD') AS vigente_desde,
                to_char(v.vigente_hasta, 'YYYY-MM-DD') AS vigente_hasta,
                (v.activo AND u.activo) AS activo,
                EXISTS (SELECT 1 FROM visitante_blacklist bl
                         WHERE bl.sucursal_id = v.sucursal_id AND bl.placa = v.placa AND bl.activo = TRUE
                           AND (bl.fecha_fin IS NULL OR bl.fecha_fin > NOW())) AS en_lista_negra,
                v.version::text AS version
           FROM vehiculos_residentes v
           JOIN residentes r ON r.id = v.residente_id
           JOIN usuarios   u ON u.id = r.usuario_id
          WHERE v.sucursal_id = $1
            AND v.version > $2::bigint
            AND ($2::bigint > 0 OR (v.activo AND u.activo
                 AND (v.vigente_hasta IS NULL OR v.vigente_hasta >= (NOW() AT TIME ZONE 'America/Guatemala')::date - 1)))
          ORDER BY v.version`,
        [sucursal_id, vehiculosDesde],
      ),
      pool.query(`SELECT COALESCE(MAX(version), 0)::text AS version FROM vehiculos_residentes WHERE sucursal_id = $1`, [sucursal_id]),
    ]);

    res.json({
      sucursal_id,
      servidor_ahora: new Date().toISOString(),
      residentes: residentes.rows,
      blacklist: [...blacklist.rows, ...blacklistResidente.rows],
      preautorizaciones: preautorizaciones.rows,
      invitaciones_qr: invitacionesQr.rows,
      vehiculos: {
        modo: vehiculosDesde === '0' ? 'completo' : 'cambios',
        // Nunca menor que la que ya tenía la garita: si no cambió nada, se le devuelve la suya.
        version: mayorVersion(versionVehiculos.rows[0].version, vehiculosDesde),
        filas: vehiculos.rows,
      },
    });
  } catch (error) {
    serverError(res, error, 'Error al generar snapshot de sincronización');
  }
};
