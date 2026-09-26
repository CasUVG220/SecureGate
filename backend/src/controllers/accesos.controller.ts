import { Request, Response } from 'express';
import pool from '../db/pool';
import { checkPreautorizacion } from './preautorizaciones.controller';
import { checkBlacklist } from './blacklist.controller';
import { getConfigQrEfectiva } from './configQr.controller';
import { tenantFilter, ownershipClause, ownershipParams } from '../utils/tenant';
import { serverError } from '../utils/http';

/**
 * Marca de tiempo que reporta la garita offline. Se guarda tal cual en
 * `registrado_en` (el servidor no la corrige), pero como `timestamp_entrada`
 * alimenta reportes y cargos, ahí se acota: nunca en el futuro respecto al
 * servidor, y nunca más antigua que la ventana de gracia offline (con margen).
 * Devuelve null si el valor no es una fecha — el caller responde 400.
 */
export const MAX_ANTIGUEDAD_REGISTRO_DIAS = 30;
export const resolverRegistradoEn = (raw: unknown, ahora: Date = new Date()): Date | null | undefined => {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) return null;
  const minimo = ahora.getTime() - MAX_ANTIGUEDAD_REGISTRO_DIAS * 24 * 60 * 60 * 1000;
  if (d.getTime() < minimo) return null;
  return d;
};

export const registrarAcceso = async (req: Request, res: Response) => {
  const {
    nombre_visitante, numero_dpi, foto, residente_id, placa, notas, invitacion_qr_id,
    registrado_en, capturado_manualmente, id_cliente,
  } = req.body;

  // El agente que registra es SIEMPRE el de la sesión. Antes se leía `agente_id`
  // del body, así que cualquiera podía atribuir un acceso a otra persona y
  // ensuciar la auditoría.
  const agente_id: string = req.user!.id;

  if (!nombre_visitante || !numero_dpi || !residente_id) {
    return res.status(400).json({
      error: 'Campos requeridos: nombre_visitante, numero_dpi, residente_id',
    });
  }
  if (String(nombre_visitante).length > 150 || String(numero_dpi).length > 20 ||
      (placa != null && String(placa).length > 20) ||
      (foto != null && (typeof foto !== 'string' || foto.length > 500)) ||
      (notas != null && String(notas).length > 500)) {
    return res.status(400).json({ error: 'Alguno de los campos excede su longitud máxima' });
  }

  // Un equipo de garita sólo registra en la sucursal de su licencia: la sesión
  // del agente y la licencia del dispositivo tienen que coincidir.
  if (req.licencia && req.user!.sucursal_id !== req.licencia.sucursal_id) {
    return res.status(403).json({ error: 'La sesión del agente no corresponde a la sucursal de esta licencia' });
  }

  // Campos de la app de escritorio. `registrado_en` = reloj del dispositivo;
  // `recibido_en` lo sella el INSERT con NOW(). Nunca se fusionan.
  const registradoEn = resolverRegistradoEn(registrado_en);
  if (registradoEn === null) {
    return res.status(400).json({ error: 'registrado_en inválido o demasiado antiguo' });
  }
  const origen: 'web' | 'desktop' = req.licencia ? 'desktop' : 'web';
  const manual = capturado_manualmente === true || capturado_manualmente === 'true';

  // Idempotencia de la cola offline: si este id_cliente ya se recibió (un
  // reintento tras perder la respuesta), se devuelve el registro existente en
  // vez de duplicarlo. 200, no 201: no se creó nada nuevo.
  if (id_cliente) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id_cliente))) {
      return res.status(400).json({ error: 'id_cliente debe ser un UUID' });
    }
    const previo = await pool.query(
      'SELECT * FROM registros_acceso WHERE id_cliente = $1', [id_cliente]
    );
    if (previo.rows.length > 0) {
      return res.status(200).json({ registro: previo.rows[0], duplicado: true });
    }
  }

  // Lectura independiente de la transacción: no depende de ninguna fila
  // resuelta más abajo (solo de numero_dpi/residente_id, ya en el body), así
  // que se resuelve antes de pedir un cliente del pool en vez de mientras
  // éste queda retenido sin usarse (hallazgo de carga: backend/loadtest/RESULTADOS-sprint7.md).
  const preautorizado = await checkPreautorizacion(numero_dpi, residente_id);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // El residente tiene que pertenecer al alcance de quien registra: antes se
    // aceptaba cualquier id, así que un agente podía registrar una visita (y
    // disparar el cargo por mora) contra un residente de otra empresa.
    const residenteResult = await client.query(
      `SELECT id, estado_pago, sucursal_id, saldo_pendiente FROM residentes WHERE id = $1
         AND ${ownershipClause('residentes', 2)}`,
      [residente_id, ...ownershipParams(req.user!)]
    );
    if (residenteResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Residente no encontrado' });
    }

    // Resolve sucursal_id: from JWT (agente/admin_sucursal) or from residente record
    const sucursal_id: string = req.user!.sucursal_id ?? residenteResult.rows[0].sucursal_id;
    if (!sucursal_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No se pudo determinar la sucursal del registro' });
    }

    // Verify agente exists with a valid staff role
    const agenteResult = await client.query(
      `SELECT id FROM usuarios
       WHERE id = $1 AND activo = TRUE
         AND rol IN ('agente', 'admin_sucursal', 'admin_empresa', 'owner')`,
      [agente_id]
    );
    if (agenteResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Agente no encontrado o inactivo' });
    }

    // Blacklist check — antes del upsert de visitante para no escribir (y
    // luego revertir) esa fila cuando el registro se va a rechazar igual.
    const ban = await checkBlacklist(numero_dpi, sucursal_id);
    if (ban) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error:     'Visitante en blacklist',
        razon:     ban.razon,
        fecha_fin: ban.fecha_fin ?? null,
      });
    }

    // Upsert visitante
    const visitanteExistente = await client.query(
      'SELECT id FROM visitantes WHERE numero_dpi = $1',
      [numero_dpi]
    );
    let visitante_id: string;
    let visitante: object;
    if (visitanteExistente.rows.length > 0) {
      visitante_id = visitanteExistente.rows[0].id;
      const v = await client.query('SELECT * FROM visitantes WHERE id = $1', [visitante_id]);
      // `visitantes` es global (un DPI = una fila para todos los condominios):
      // no se devuelve la foto que subió otro tenant.
      const { id, nombre, numero_dpi: dpi } = v.rows[0];
      visitante = { id, nombre, numero_dpi: dpi };
    } else {
      const nuevoVisitante = await client.query(
        'INSERT INTO visitantes (nombre, numero_dpi, foto) VALUES ($1, $2, $3) RETURNING *',
        [nombre_visitante, numero_dpi, foto || null]
      );
      visitante_id = nuevoVisitante.rows[0].id;
      visitante = nuevoVisitante.rows[0];
    }

    // Validate + consume invitación QR, if this entry comes from a scanned code.
    // Locked with FOR UPDATE so two garitas scanning the same single-use code
    // at once can't both succeed (re-checks everything verificarInvitacion
    // already checked — that call is only advisory, this is authoritative).
    if (invitacion_qr_id) {
      const invResult = await client.query(
        `SELECT id, sucursal_id, tipo, numero_dpi, placa, activo, usos_maximos, usos_actuales,
                intentos_fallidos_dpi, bloqueado_hasta,
                (fecha_inicio <= CURRENT_DATE) AS ya_vigente,
                (fecha_fin IS NULL OR fecha_fin >= CURRENT_DATE) AS no_vencida
         FROM invitaciones_qr WHERE id = $1 FOR UPDATE`,
        [invitacion_qr_id]
      );
      if (invResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Invitación QR no encontrada' });
      }
      const inv = invResult.rows[0];
      if (inv.sucursal_id !== sucursal_id) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Esta invitación pertenece a otra sucursal' });
      }
      if (inv.bloqueado_hasta && new Date(inv.bloqueado_hasta) > new Date()) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Invitación QR bloqueada temporalmente por intentos fallidos' });
      }
      if (!inv.activo || !inv.ya_vigente || !inv.no_vencida) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Invitación QR no vigente' });
      }
      if (inv.usos_maximos != null && inv.usos_actuales >= inv.usos_maximos) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Invitación QR ya alcanzó el máximo de usos' });
      }

      const configQr = await getConfigQrEfectiva(client, sucursal_id);

      if (inv.tipo === 'individual' && inv.numero_dpi &&
          inv.numero_dpi.trim().toUpperCase() !== String(numero_dpi).trim().toUpperCase()) {
        // El ROLLBACK va primero: libera el FOR UPDATE que la transacción
        // todavía tiene sobre esta fila. Si el UPDATE del contador (en una
        // query aparte, sobre `pool`, para que sobreviva al rollback) se
        // hiciera antes, esa conexión separada quedaría esperando para
        // siempre el lock que sólo el propio ROLLBACK libera — auto-deadlock.
        await client.query('ROLLBACK');
        const intentos = inv.intentos_fallidos_dpi + 1;
        const bloquear = intentos >= configQr.max_intentos_fallidos;
        await pool.query(
          `UPDATE invitaciones_qr
             SET intentos_fallidos_dpi = $2,
                 bloqueado_hasta = CASE WHEN $3::boolean
                   THEN NOW() + ($4 || ' minutes')::interval ELSE bloqueado_hasta END
           WHERE id = $1`,
          [invitacion_qr_id, intentos, bloquear, configQr.bloqueo_minutos]
        );
        return res.status(409).json({ error: 'El DPI no coincide con la invitación' });
      }

      if (configQr.requiere_placa) {
        if (!placa) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'Este QR requiere registrar la placa del vehículo' });
        }
        if (inv.placa && inv.placa.trim().toUpperCase() !== String(placa).trim().toUpperCase()) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'La placa no coincide con la invitación' });
        }
      }

      await client.query(
        `UPDATE invitaciones_qr
           SET usos_actuales = usos_actuales + 1, intentos_fallidos_dpi = 0
         WHERE id = $1`,
        [invitacion_qr_id]
      );
    }

    // Register vehicle if plate provided
    let vehiculo_id: string | null = null;
    if (placa) {
      const vehiculoResult = await client.query(
        'INSERT INTO vehiculos (visitante_id, placa) VALUES ($1, $2) RETURNING id',
        [visitante_id, placa]
      );
      vehiculo_id = vehiculoResult.rows[0].id;
    }

    // Create access record with sucursal_id.
    // timestamp_entrada = hora real de la visita (reloj de la garita, acotado a
    // NOW() para que un reloj adelantado no cree entradas en el futuro);
    // recibido_en = NOW() del servidor, siempre.
    const registroResult = await client.query(
      `INSERT INTO registros_acceso
         (sucursal_id, visitante_id, residente_id, vehiculo_id, agente_id, tipo, notas, invitacion_qr_id,
          timestamp_entrada, registrado_en, recibido_en, capturado_manualmente, origen, id_cliente, licencia_id)
       VALUES ($1, $2, $3, $4, $5, 'entrada', $6, $7,
               LEAST(COALESCE($8::timestamptz, NOW()), NOW()), $8::timestamptz, NOW(), $9, $10, $11, $12)
       RETURNING *`,
      [sucursal_id, visitante_id, residente_id, vehiculo_id, agente_id, notas || null, invitacion_qr_id || null,
       registradoEn ?? null, manual, origen, id_cliente || null, req.licencia?.id ?? null]
    );
    const registro = registroResult.rows[0];

    let cargo_generado: { monto: string; nombre: string; frecuencia: string } | null = null;
    let cargo_extra_mora: number | null = null;
    let saldo_pendiente_actualizado: number = parseFloat(residenteResult.rows[0].saldo_pendiente ?? '0');

    // Extra charge for entering while in mora (T-S5-03) — additive, never blocks access
    if (residenteResult.rows[0].estado_pago === 'mora') {
      const restriccion = await client.query(
        `SELECT costo_extra_visita_mora FROM configuracion_cargos
         WHERE activo = TRUE AND sucursal_id = $1
           AND restringir_visitas_mora = TRUE
           AND costo_extra_visita_mora > 0
         LIMIT 1`,
        [sucursal_id]
      );

      if (restriccion.rows.length > 0) {
        const costoExtra = restriccion.rows[0].costo_extra_visita_mora;

        await client.query(
          `INSERT INTO cargos_automaticos
             (registro_acceso_id, residente_id, monto, descripcion, aplicado)
           VALUES ($1, $2, $3, $4, TRUE)`,
          [registro.id, residente_id, costoExtra, 'Cargo extra por visita en mora']
        );

        const saldoExtra = await client.query(
          `UPDATE residentes
           SET saldo_pendiente = saldo_pendiente + $1
           WHERE id = $2
           RETURNING saldo_pendiente`,
          [costoExtra, residente_id]
        );

        saldo_pendiente_actualizado = parseFloat(saldoExtra.rows[0].saldo_pendiente);
        cargo_extra_mora = parseFloat(costoExtra);
      }
    }

    // Auto-charge if residente is in mora — with frecuencia deduplication
    if (residenteResult.rows[0].estado_pago === 'mora') {
      const configResult = await client.query(
        `SELECT id, nombre, monto, frecuencia FROM configuracion_cargos
         WHERE activo = TRUE AND sucursal_id = $1
         LIMIT 1`,
        [sucursal_id]
      );

      if (configResult.rows.length > 0) {
        const config = configResult.rows[0];
        const frecuencia: string = config.frecuencia ?? 'mensual';

        // Deduplication: check if charge already fired this period
        let dupQuery: string;
        if (frecuencia === 'unica_vez') {
          dupQuery = `SELECT 1 FROM cargos_automaticos
            WHERE residente_id = $1 AND created_at > NOW() - INTERVAL '30 days' LIMIT 1`;
        } else if (frecuencia === 'quincenal') {
          dupQuery = `SELECT 1 FROM cargos_automaticos
            WHERE residente_id = $1 AND created_at > NOW() - INTERVAL '15 days' LIMIT 1`;
        } else {
          // mensual — same calendar month
          dupQuery = `SELECT 1 FROM cargos_automaticos
            WHERE residente_id = $1
              AND EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM NOW())
              AND EXTRACT(YEAR  FROM created_at) = EXTRACT(YEAR  FROM NOW())
            LIMIT 1`;
        }

        const dupResult = await client.query(dupQuery, [residente_id]);

        if (dupResult.rows.length === 0) {
          // No duplicate — apply charge atomically
          await client.query(
            `INSERT INTO cargos_automaticos
               (registro_acceso_id, residente_id, monto, descripcion, aplicado)
             VALUES ($1, $2, $3, $4, TRUE)`,
            [registro.id, residente_id, config.monto,
             `Cargo por acceso con mora — ${config.nombre}`]
          );

          const saldoResult = await client.query(
            `UPDATE residentes
             SET saldo_pendiente = saldo_pendiente + $1
             WHERE id = $2
             RETURNING saldo_pendiente`,
            [config.monto, residente_id]
          );

          saldo_pendiente_actualizado = parseFloat(saldoResult.rows[0].saldo_pendiente);
          cargo_generado = {
            monto:     config.monto,
            nombre:    config.nombre,
            frecuencia,
          };
        }
      }
    }

    await client.query('COMMIT');
    res.status(201).json({
      registro,
      visitante,
      cargo_generado,
      cargo_extra_mora,
      preautorizado,
      saldo_pendiente_actualizado,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    // Carrera entre dos reintentos del mismo id_cliente: el índice único
    // detiene al segundo; responde como duplicado en vez de 500.
    if (id_cliente && (error as { code?: string }).code === '23505') {
      const previo = await pool.query('SELECT * FROM registros_acceso WHERE id_cliente = $1', [id_cliente]);
      if (previo.rows.length > 0) {
        return res.status(200).json({ registro: previo.rows[0], duplicado: true });
      }
    }
    serverError(res, error, 'Error al registrar acceso');
  } finally {
    client.release();
  }
};

/**
 * Marca la salida de un acceso. Un id fuera del alcance del usuario responde
 * 404 igual que uno inexistente: distinguirlos (403 vs 404) revelaba qué UUID
 * existían en otros condominios.
 */
const marcarSalida = async (req: Request, res: Response, tipoSalida: boolean) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE registros_acceso
       SET ${tipoSalida ? "tipo = 'salida', " : ''}timestamp_salida = NOW()
       WHERE id = $1
         AND timestamp_salida IS NULL
         AND ${ownershipClause('registros_acceso', 2)}
       RETURNING *`,
      [id, ...ownershipParams(req.user!)]
    );
    if (result.rows.length > 0) return res.json(result.rows[0]);

    const visible = await pool.query(
      `SELECT id, timestamp_salida FROM registros_acceso
        WHERE id = $1 AND ${ownershipClause('registros_acceso', 2)}`,
      [id, ...ownershipParams(req.user!)]
    );
    if (visible.rows.length === 0) {
      return res.status(404).json({ error: 'Registro de acceso no encontrado' });
    }
    return res.status(409).json({ error: 'La salida ya fue registrada para este acceso' });
  } catch (error) {
    return serverError(res, error, 'Error al registrar salida');
  }
};

export const registrarSalida = (req: Request, res: Response) => marcarSalida(req, res, true);

export const getAccesoActivo = async (req: Request, res: Response) => {
  const { placa } = req.query as { placa?: string };
  if (!placa) {
    return res.status(400).json({ error: 'Parámetro requerido: placa' });
  }

  const ts = tenantFilter(req.user!, 'ra');
  const placaOffset = ts.params.length + 1;

  try {
    const result = await pool.query(
      `SELECT
         ra.id              AS registro_id,
         ra.timestamp_entrada,
         v.id               AS visitante_id,
         v.nombre           AS visitante_nombre,
         v.numero_dpi       AS visitante_dpi,
         r.id               AS residente_id,
         r.numero_casa      AS residente_casa,
         u.nombre           AS residente_nombre,
         veh.placa
       FROM registros_acceso ra
       JOIN visitantes  v   ON ra.visitante_id  = v.id
       JOIN residentes  r   ON ra.residente_id  = r.id
       JOIN usuarios    u   ON r.usuario_id     = u.id
       JOIN vehiculos   veh ON ra.vehiculo_id   = veh.id
       ${ts.joinClause}
       WHERE ${ts.whereClause}
         AND UPPER(veh.placa) = UPPER($${placaOffset})
         AND ra.timestamp_salida IS NULL
       ORDER BY ra.timestamp_entrada DESC
       LIMIT 1`,
      [...ts.params, placa]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No hay acceso activo para esa placa' });
    }
    const row = result.rows[0];
    res.json({
      registro_id:       row.registro_id,
      timestamp_entrada: row.timestamp_entrada,
      visitante: {
        id:         row.visitante_id,
        nombre:     row.visitante_nombre,
        numero_dpi: row.visitante_dpi,
      },
      residente: {
        id:          row.residente_id,
        numero_casa: row.residente_casa,
        nombre:      row.residente_nombre,
      },
      placa: row.placa,
    });
  } catch (error) {
    serverError(res, error, 'Error al buscar acceso activo');
  }
};

export const registrarSalidaPut = (req: Request, res: Response) => marcarSalida(req, res, false);

export const getAccesosActivos = async (req: Request, res: Response) => {
  const ts = tenantFilter(req.user!, 'ra');
  try {
    const result = await pool.query(
      `SELECT
         ra.id              AS registro_id,
         ra.timestamp_entrada,
         v.id               AS visitante_id,
         v.nombre           AS visitante_nombre,
         v.numero_dpi       AS visitante_dpi,
         r.id               AS residente_id,
         r.numero_casa      AS residente_casa,
         u.nombre           AS residente_nombre,
         veh.placa
       FROM registros_acceso ra
       JOIN visitantes  v   ON ra.visitante_id  = v.id
       JOIN residentes  r   ON ra.residente_id  = r.id
       JOIN usuarios    u   ON r.usuario_id     = u.id
       LEFT JOIN vehiculos  veh ON ra.vehiculo_id = veh.id
       ${ts.joinClause}
       WHERE ${ts.whereClause}
         AND ra.timestamp_salida IS NULL
       ORDER BY ra.timestamp_entrada DESC`,
      ts.params
    );
    res.json(result.rows.map(row => ({
      registro_id:       row.registro_id,
      timestamp_entrada: row.timestamp_entrada,
      visitante: {
        id:         row.visitante_id,
        nombre:     row.visitante_nombre,
        numero_dpi: row.visitante_dpi,
      },
      residente: {
        id:          row.residente_id,
        numero_casa: row.residente_casa,
        nombre:      row.residente_nombre,
      },
      placa: row.placa ?? null,
    })));
  } catch (error) {
    serverError(res, error, 'Error al obtener accesos activos');
  }
};

export const getMisAccesos = async (req: Request, res: Response) => {
  const usuarioId = req.user?.id;
  try {
    const r = await pool.query(
      'SELECT id FROM residentes WHERE usuario_id = $1', [usuarioId]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ error: 'Residente no encontrado' });
    }
    const residenteId = r.rows[0].id;

    const result = await pool.query(
      `SELECT ra.id, ra.timestamp_entrada, ra.timestamp_salida,
              v.nombre AS nombre_visitante, v.numero_dpi, ve.placa
       FROM registros_acceso ra
       JOIN visitantes v ON ra.visitante_id = v.id
       LEFT JOIN vehiculos ve ON ra.vehiculo_id = ve.id
       WHERE ra.residente_id = $1
       ORDER BY ra.timestamp_entrada DESC
       LIMIT 20`,
      [residenteId]
    );
    res.json(result.rows);
  } catch (error) {
    serverError(res, error, 'Error al obtener historial de accesos');
  }
};
