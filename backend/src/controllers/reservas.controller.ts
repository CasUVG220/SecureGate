import { Request, Response } from 'express';
import pool from '../db/pool';
import { tenantFilter, ownershipClause, ownershipParams } from '../utils/tenant';
import {
  APP_TZ,
  calcularMonto,
  calcularReembolso,
  esViolacionExclusion,
  fechaISO,
  formatearFecha,
  formatearHora,
  getConfigEfectiva,
  horaAMinutos,
  notificarReserva,
  resolverAprobacion,
  Consultable,
  ConfigReservas,
} from '../utils/reservas';

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const RE_HORA = /^\d{1,2}:\d{2}(:\d{2})?$/;

const MSG_HORARIO_TOMADO = 'Este horario ya fue reservado, por favor elige otro';

/** Resuelve el perfil de residente del usuario logueado. */
async function getResidente(db: Consultable, usuario_id: string) {
  const r = await db.query('SELECT id, sucursal_id FROM residentes WHERE usuario_id = $1', [
    usuario_id,
  ]);
  return r.rows[0] ?? null;
}

const esStaff = (req: Request) => req.user!.rol !== 'residente';

/**
 * Verificación de solapamiento con buffer.
 *
 * El buffer se expande sobre UN SOLO lado de la comparación (el candidato):
 * expandir ambos intervalos exigiría un hueco de 2×buffer. Toda la aritmética
 * se hace sobre timestamp (fecha + hora) y nunca sobre TIME, porque TIME es
 * módulo 24h y '23:30'::time + interval '60 min' daría '00:30', invirtiendo
 * silenciosamente la comparación en reservas nocturnas.
 *
 * El rango `fecha ± 1 día` permite que un buffer que cruza medianoche alcance
 * al vecino del día adyacente sin perder el índice (area_id, fecha).
 */
const SQL_SOLAPE = `
  SELECT r.id, r.fecha, r.hora_inicio, r.hora_fin
    FROM reservas_areas r
   WHERE r.area_id = $1
     AND r.estado IN ('pendiente_aprobacion','confirmada')
     AND r.fecha BETWEEN ($2::date - 1) AND ($2::date + 1)
     AND (r.fecha + r.hora_inicio) < (($2::date + $4::time) + make_interval(mins => $5::int))
     AND (r.fecha + r.hora_fin)    > (($2::date + $3::time) - make_interval(mins => $5::int))
   ORDER BY r.fecha, r.hora_inicio
   LIMIT 1
   FOR UPDATE`;

// ── Disponibilidad ──────────────────────────────────────────────────────────

export const getDisponibilidad = async (req: Request, res: Response) => {
  const area_id = req.query.area_id as string | undefined;
  const fecha = req.query.fecha as string | undefined;

  if (!area_id || !fecha) {
    return res.status(400).json({ error: 'Campos requeridos: area_id, fecha' });
  }
  if (!RE_FECHA.test(fecha)) {
    return res.status(400).json({ error: 'fecha debe tener formato YYYY-MM-DD' });
  }

  try {
    const areaRes = await pool.query(
      `SELECT id, sucursal_id, nombre, activa, tarifa_tipo, tarifa_monto, requiere_aprobacion
         FROM areas_comunes WHERE id = $1`,
      [area_id]
    );
    if (areaRes.rows.length === 0) {
      return res.status(404).json({ error: 'Área común no encontrada' });
    }
    const area = areaRes.rows[0];

    if (!esStaff(req)) {
      const residente = await getResidente(pool, req.user!.id);
      if (!residente || residente.sucursal_id !== area.sucursal_id) {
        return res.status(403).json({ error: 'Sin acceso a esta área' });
      }
    }

    const config = await getConfigEfectiva(pool, area.sucursal_id);
    const buffer = config.buffer_minutos_entre_reservas;

    // Aquí el buffer se expande alrededor de las reservas EXISTENTES: el
    // frontend necesita ventanas bloqueadas para pintar, no un test de choque.
    const ocupados = await pool.query(
      `SELECT r.id, r.fecha, r.hora_inicio, r.hora_fin, r.estado,
              ((r.fecha + r.hora_inicio) - make_interval(mins => $3::int)) AS bloqueo_desde,
              ((r.fecha + r.hora_fin)    + make_interval(mins => $3::int)) AS bloqueo_hasta
         FROM reservas_areas r
        WHERE r.area_id = $1
          AND r.estado IN ('pendiente_aprobacion','confirmada')
          AND r.fecha BETWEEN ($2::date - 1) AND ($2::date + 1)
        ORDER BY r.fecha, r.hora_inicio`,
      [area_id, fecha, buffer]
    );

    res.json({
      area: {
        id: area.id,
        nombre: area.nombre,
        activa: area.activa,
        tarifa_tipo: area.tarifa_tipo,
        tarifa_monto: area.tarifa_monto,
      },
      fecha,
      buffer_minutos: buffer,
      buffer_motivo: config.buffer_motivo,
      ocupados: ocupados.rows,
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener disponibilidad', detail: String(error) });
  }
};

// ── Crear reserva ───────────────────────────────────────────────────────────

export const crearReserva = async (req: Request, res: Response) => {
  const { area_id, fecha, hora_inicio, hora_fin } = req.body;

  if (!area_id || !fecha || !hora_inicio || !hora_fin) {
    return res
      .status(400)
      .json({ error: 'Campos requeridos: area_id, fecha, hora_inicio, hora_fin' });
  }
  if (!RE_FECHA.test(fecha)) {
    return res.status(400).json({ error: 'fecha debe tener formato YYYY-MM-DD' });
  }
  if (!RE_HORA.test(hora_inicio) || !RE_HORA.test(hora_fin)) {
    return res.status(400).json({ error: 'hora_inicio y hora_fin deben tener formato HH:MM' });
  }
  const minInicio = horaAMinutos(hora_inicio);
  const minFin = horaAMinutos(hora_fin);
  if (!Number.isFinite(minInicio) || !Number.isFinite(minFin)) {
    return res.status(400).json({ error: 'hora_inicio y hora_fin deben tener formato HH:MM' });
  }
  if (minFin <= minInicio) {
    return res.status(400).json({ error: 'hora_fin debe ser posterior a hora_inicio' });
  }

  const residente = await getResidente(pool, req.user!.id);
  if (!residente) {
    return res.status(404).json({ error: 'Residente no encontrado' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Orden de locks FIJO en todos los handlers (residente → área) para que no
    // pueda formarse un ciclo de deadlock.
    //
    // 1) Residente con FOR NO KEY UPDATE: el lock del área no protege el límite
    //    de reservas activas, porque dos reservas concurrentes del mismo
    //    residente en áreas distintas pasarían ambas el conteo. Se usa el modo
    //    débil porque pagos/tickets/accesos referencian residentes y sus
    //    inserts toman FOR KEY SHARE, que conflictúa con FOR UPDATE.
    await client.query('SELECT id FROM residentes WHERE id = $1 FOR NO KEY UPDATE', [
      residente.id,
    ]);

    // 2) Área con FOR UPDATE: serializa todas las reservas concurrentes de esa
    //    área. Es lo que realmente evita el fantasma — un SELECT FOR UPDATE
    //    sobre reservas_areas no bloquea el INSERT de una fila que aún no
    //    existe. Además, insertar en reservas_areas toma FOR KEY SHARE sobre el
    //    área por la FK, y eso conflictúa con FOR UPDATE.
    const areaRes = await client.query(
      `SELECT id, sucursal_id, nombre, tarifa_tipo, tarifa_monto, requiere_aprobacion, activa
         FROM areas_comunes WHERE id = $1 FOR UPDATE`,
      [area_id]
    );
    if (areaRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Área común no encontrada' });
    }
    const area = areaRes.rows[0];
    if (!area.activa) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'El área no está disponible para reservas' });
    }
    if (area.sucursal_id !== residente.sucursal_id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Sin acceso a esta área' });
    }

    const config = await getConfigEfectiva(client, area.sucursal_id);

    // 3) Límite de reservas activas simultáneas (sólo si está configurado)
    if (config.max_reservas_activas_por_residente !== null) {
      const activas = await client.query(
        `SELECT COUNT(*)::int AS activas
           FROM reservas_areas r
          WHERE r.residente_id = $1
            AND r.estado IN ('pendiente_aprobacion','confirmada')
            AND (r.fecha + r.hora_fin) > (NOW() AT TIME ZONE $2::text)`,
        [residente.id, APP_TZ]
      );
      if (activas.rows[0].activas >= config.max_reservas_activas_por_residente) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Alcanzaste el máximo de ${config.max_reservas_activas_por_residente} reservas activas`,
          max_reservas_activas: config.max_reservas_activas_por_residente,
        });
      }
    }

    // 4) Solapamiento (incluyendo el buffer configurado)
    const solape = await client.query(SQL_SOLAPE, [
      area_id,
      fecha,
      hora_inicio,
      hora_fin,
      config.buffer_minutos_entre_reservas,
    ]);
    if (solape.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: MSG_HORARIO_TOMADO,
        buffer_minutos: config.buffer_minutos_entre_reservas,
        buffer_motivo: config.buffer_motivo,
      });
    }

    // 5) Cargo. Una reserva gratis no genera fila en pagos (la tabla tiene
    //    CHECK (monto > 0) y un pago de Q0 no significa nada).
    const monto = calcularMonto(area, hora_inicio, hora_fin);
    let cargo_id: string | null = null;

    if (monto > 0) {
      const cargo = await client.query(
        `INSERT INTO pagos
           (sucursal_id, residente_id, monto, metodo, estado, concepto, registrado_por)
         VALUES ($1, $2, $3, 'reserva', 'pendiente', $4, $5)
         RETURNING id`,
        [
          area.sucursal_id,
          residente.id,
          monto,
          `Reserva: ${area.nombre} - ${fecha}`,
          req.user!.id,
        ]
      );
      cargo_id = cargo.rows[0].id;

      await client.query(
        'UPDATE residentes SET saldo_pendiente = saldo_pendiente + $1 WHERE id = $2',
        [monto, residente.id]
      );
    }

    // 6) Estado inicial: el override del área gana sobre la config global
    const requiereAprobacion = resolverAprobacion(area, config);
    const estado = requiereAprobacion ? 'pendiente_aprobacion' : 'confirmada';

    const reserva = await client.query(
      `INSERT INTO reservas_areas
         (area_id, residente_id, fecha, hora_inicio, hora_fin, estado, cargo_id, monto_cargo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [area_id, residente.id, fecha, hora_inicio, hora_fin, estado, cargo_id, monto]
    );

    // 7) Notificación personal, dentro de la misma transacción
    await notificarReserva(client, {
      sucursal_id: area.sucursal_id,
      residente_id: residente.id,
      titulo: requiereAprobacion ? 'Reserva en revisión' : 'Reserva confirmada',
      contenido: requiereAprobacion
        ? `Tu solicitud de reserva de ${area.nombre} para el ${formatearFecha(fecha)} a las ${formatearHora(hora_inicio)} está pendiente de aprobación del administrador.`
        : `Tu reserva de ${area.nombre} para el ${formatearFecha(fecha)} a las ${formatearHora(hora_inicio)} fue confirmada.`,
      prioridad: requiereAprobacion ? 'importante' : 'normal',
      vigente_hasta: `${fecha} ${hora_fin}`,
      creado_por: req.user!.id,
    });

    await client.query('COMMIT');

    res.status(201).json({
      ...reserva.rows[0],
      area_nombre: area.nombre,
      monto,
      requiere_aprobacion: requiereAprobacion,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    // Red de seguridad de la BD: el EXCLUDE atrapó un solape que se coló.
    if (esViolacionExclusion(error)) {
      return res.status(409).json({ error: MSG_HORARIO_TOMADO });
    }
    res.status(500).json({ error: 'Error al crear la reserva', detail: String(error) });
  } finally {
    client.release();
  }
};

// ── Aprobar / rechazar (admin) ──────────────────────────────────────────────

/** Carga la reserva con su área, validando pertenencia del staff a la sucursal. */
const SQL_RESERVA_STAFF = (offset: number) => `
  SELECT r.id, r.estado, r.cargo_id, r.monto_cargo, r.residente_id,
         r.fecha, r.hora_inicio, r.hora_fin,
         a.sucursal_id, a.nombre AS area_nombre
    FROM reservas_areas r
    JOIN areas_comunes  a ON a.id = r.area_id
   WHERE r.id = $1
     AND ${ownershipClause('a', offset)}
   FOR UPDATE OF r`;

export const aprobarReserva = async (req: Request, res: Response) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const found = await client.query(SQL_RESERVA_STAFF(2), [id, ...ownershipParams(req.user!)]);
    if (found.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }
    const reserva = found.rows[0];

    if (reserva.estado !== 'pendiente_aprobacion') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `La reserva ya está '${reserva.estado}'` });
    }

    const actualizada = await client.query(
      `UPDATE reservas_areas SET estado = 'confirmada' WHERE id = $1 RETURNING *`,
      [id]
    );

    await notificarReserva(client, {
      sucursal_id: reserva.sucursal_id,
      residente_id: reserva.residente_id,
      titulo: 'Reserva confirmada',
      contenido: `Tu reserva de ${reserva.area_nombre} para el ${formatearFecha(reserva.fecha)} a las ${formatearHora(reserva.hora_inicio)} fue confirmada.`,
      prioridad: 'importante',
      vigente_hasta: `${fechaISO(reserva.fecha)} ${reserva.hora_fin}`,
      creado_por: req.user!.id,
    });

    await client.query('COMMIT');
    res.json({ ...actualizada.rows[0], area_nombre: reserva.area_nombre });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Error al aprobar la reserva', detail: String(error) });
  } finally {
    client.release();
  }
};

export const rechazarReserva = async (req: Request, res: Response) => {
  const { id } = req.params;
  const motivo: string | null = req.body?.motivo ?? null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const found = await client.query(SQL_RESERVA_STAFF(2), [id, ...ownershipParams(req.user!)]);
    if (found.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }
    const reserva = found.rows[0];

    if (reserva.estado !== 'pendiente_aprobacion') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `La reserva ya está '${reserva.estado}'` });
    }

    // El cargo se anula por completo: el residente no llegó a usar el área.
    if (reserva.cargo_id) {
      const anulado = await client.query(
        `UPDATE pagos SET estado = 'anulado', comentario_rechazo = $2
          WHERE id = $1 AND estado = 'pendiente'
          RETURNING id`,
        [reserva.cargo_id, motivo || 'Reserva rechazada']
      );
      if ((anulado.rowCount ?? 0) > 0) {
        await client.query(
          `UPDATE residentes
              SET saldo_pendiente = GREATEST(saldo_pendiente - $1, 0)
            WHERE id = $2`,
          [reserva.monto_cargo, reserva.residente_id]
        );
      }
    }

    const actualizada = await client.query(
      `UPDATE reservas_areas
          SET estado = 'rechazada', motivo_cancelacion = $2, reembolso_aplicado = 100
        WHERE id = $1
        RETURNING *`,
      [id, motivo]
    );

    await notificarReserva(client, {
      sucursal_id: reserva.sucursal_id,
      residente_id: reserva.residente_id,
      titulo: 'Reserva rechazada',
      contenido:
        `Tu reserva de ${reserva.area_nombre} para el ${formatearFecha(reserva.fecha)} fue rechazada.` +
        (motivo ? ` Motivo: ${motivo}` : ''),
      prioridad: 'importante',
      creado_por: req.user!.id,
    });

    await client.query('COMMIT');
    res.json({ ...actualizada.rows[0], area_nombre: reserva.area_nombre });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Error al rechazar la reserva', detail: String(error) });
  } finally {
    client.release();
  }
};

// ── Cancelar ────────────────────────────────────────────────────────────────

/**
 * Carga la reserva junto con las horas que faltan para su inicio.
 * El cálculo va en SQL y no en JS: un solo reloj, una sola fila, sin deriva
 * entre la lectura y la decisión de reembolso.
 */
const SQL_RESERVA_CANCELACION = `
  SELECT r.id, r.estado, r.cargo_id, r.monto_cargo, r.residente_id,
         r.fecha, r.hora_inicio, r.hora_fin,
         a.sucursal_id, a.nombre AS area_nombre,
         EXTRACT(EPOCH FROM ((r.fecha + r.hora_inicio) - (NOW() AT TIME ZONE $2::text))) / 3600.0
           AS horas_restantes
    FROM reservas_areas r
    JOIN areas_comunes  a ON a.id = r.area_id
   WHERE r.id = $1
   FOR UPDATE OF r`;

/** Autoriza a cancelar: el residente dueño, o staff de esa sucursal. */
async function puedeGestionar(
  db: Consultable,
  req: Request,
  reserva: { residente_id: string; sucursal_id: string }
): Promise<boolean> {
  if (esStaff(req)) {
    const r = await db.query(
      `SELECT 1 FROM sucursales _os WHERE _os.id = $1
         AND ($2::text = 'owner'
              OR ($2::text = 'admin_empresa' AND _os.empresa_id = $3)
              OR _os.id = $4)`,
      [reserva.sucursal_id, ...ownershipParams(req.user!)]
    );
    return r.rows.length > 0;
  }
  const residente = await getResidente(db, req.user!.id);
  return !!residente && residente.id === reserva.residente_id;
}

export const cancelarReserva = async (req: Request, res: Response) => {
  const { id } = req.params;
  const motivo: string | null = req.body?.motivo ?? null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const found = await client.query(SQL_RESERVA_CANCELACION, [id, APP_TZ]);
    if (found.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }
    const reserva = found.rows[0];

    if (!(await puedeGestionar(client, req, reserva))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'No puedes cancelar esta reserva' });
    }

    if (!['confirmada', 'pendiente_aprobacion'].includes(reserva.estado)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `La reserva ya está '${reserva.estado}'` });
    }

    const config = await getConfigEfectiva(client, reserva.sucursal_id);
    if (!config.permite_cancelacion) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'La cancelación de reservas está deshabilitada en este residencial',
      });
    }

    const horas = Number(reserva.horas_restantes);
    const reembolso = calcularReembolso(horas, config);
    const montoOriginal = Number(reserva.monto_cargo) || 0;

    let cargoAnulado = false;
    let reembolsoPendienteGestion = false;
    let montoReembolsado = 0;

    if (reserva.cargo_id && reembolso > 0) {
      const montoRestante = Math.round(montoOriginal * (1 - reembolso / 100) * 100) / 100;

      if (montoRestante <= 0) {
        // Reembolso total. No puede expresarse como monto = 0: la tabla pagos
        // tiene CHECK (monto > 0). Se anula la fila entera.
        const anulado = await client.query(
          `UPDATE pagos SET estado = 'anulado', comentario_rechazo = $2
            WHERE id = $1 AND estado = 'pendiente'
            RETURNING id`,
          [reserva.cargo_id, `Reserva cancelada — reembolso ${reembolso}%`]
        );
        cargoAnulado = (anulado.rowCount ?? 0) > 0;
        reembolsoPendienteGestion = !cargoAnulado;
        if (cargoAnulado) montoReembolsado = montoOriginal;
      } else {
        // Reembolso parcial: se reduce el cargo pendiente proporcionalmente.
        const ajustado = await client.query(
          `UPDATE pagos SET monto = $2,
                            concepto = COALESCE(concepto, '') || ' (reembolso ' || $3::text || '%)'
            WHERE id = $1 AND estado = 'pendiente'
            RETURNING id`,
          [reserva.cargo_id, montoRestante, reembolso]
        );
        if ((ajustado.rowCount ?? 0) > 0) {
          montoReembolsado = Math.round((montoOriginal - montoRestante) * 100) / 100;
        } else {
          // El cargo ya se había cobrado: queda para gestión manual del admin.
          reembolsoPendienteGestion = true;
        }
      }

      if (montoReembolsado > 0) {
        await client.query(
          `UPDATE residentes SET saldo_pendiente = GREATEST(saldo_pendiente - $1, 0) WHERE id = $2`,
          [montoReembolsado, reserva.residente_id]
        );
      }
    }

    const actualizada = await client.query(
      `UPDATE reservas_areas
          SET estado = 'cancelada', motivo_cancelacion = $2, reembolso_aplicado = $3
        WHERE id = $1
        RETURNING *`,
      [id, motivo, reembolso]
    );

    await notificarReserva(client, {
      sucursal_id: reserva.sucursal_id,
      residente_id: reserva.residente_id,
      titulo: 'Reserva cancelada',
      contenido:
        `Tu reserva de ${reserva.area_nombre} del ${formatearFecha(reserva.fecha)} fue cancelada.` +
        (montoOriginal > 0 ? ` Reembolso aplicado: ${reembolso}%.` : ''),
      prioridad: 'importante',
      creado_por: req.user!.id,
    });

    await client.query('COMMIT');

    res.json({
      ...actualizada.rows[0],
      area_nombre: reserva.area_nombre,
      horas_restantes: Math.round(horas * 100) / 100,
      reembolso_aplicado: reembolso,
      monto_reembolsado: montoReembolsado,
      cargo_anulado: cargoAnulado,
      reembolso_pendiente_gestion: reembolsoPendienteGestion,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Error al cancelar la reserva', detail: String(error) });
  } finally {
    client.release();
  }
};

/**
 * Qué reembolso aplicaría si se cancelara ahora, sin cancelar nada.
 * La UI lo usa para avisar al residente ANTES de que confirme.
 */
export const getPreviewCancelacion = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const found = await pool.query(
      `SELECT r.id, r.estado, r.cargo_id, r.monto_cargo, r.residente_id,
              r.fecha, r.hora_inicio,
              a.sucursal_id, a.nombre AS area_nombre,
              EXTRACT(EPOCH FROM ((r.fecha + r.hora_inicio) - (NOW() AT TIME ZONE $2::text))) / 3600.0
                AS horas_restantes
         FROM reservas_areas r
         JOIN areas_comunes  a ON a.id = r.area_id
        WHERE r.id = $1`,
      [id, APP_TZ]
    );
    if (found.rows.length === 0) {
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }
    const reserva = found.rows[0];

    if (!(await puedeGestionar(pool, req, reserva))) {
      return res.status(403).json({ error: 'No puedes cancelar esta reserva' });
    }

    const config = await getConfigEfectiva(pool, reserva.sucursal_id);
    const horas = Number(reserva.horas_restantes);
    const reembolso = config.permite_cancelacion ? calcularReembolso(horas, config) : 0;
    const montoOriginal = Number(reserva.monto_cargo) || 0;

    res.json({
      reserva_id: reserva.id,
      estado: reserva.estado,
      permite_cancelacion: config.permite_cancelacion,
      cancelable:
        config.permite_cancelacion &&
        ['confirmada', 'pendiente_aprobacion'].includes(reserva.estado),
      horas_restantes: Math.round(horas * 100) / 100,
      reembolso_aplicado: reembolso,
      monto_cargo: montoOriginal,
      monto_reembolso: Math.round(((montoOriginal * reembolso) / 100) * 100) / 100,
      horas_limite_cancelacion_completa: config.horas_limite_cancelacion_completa,
      horas_limite_cancelacion_parcial: config.horas_limite_cancelacion_parcial,
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: 'Error al calcular el reembolso', detail: String(error) });
  }
};

// ── Listados ────────────────────────────────────────────────────────────────

export const getMisReservas = async (req: Request, res: Response) => {
  try {
    const residente = await getResidente(pool, req.user!.id);
    if (!residente) {
      return res.status(404).json({ error: 'Residente no encontrado' });
    }

    const result = await pool.query(
      `SELECT r.*, a.nombre AS area_nombre, a.imagen_url, a.tarifa_tipo,
              p.monto AS cargo_monto, p.estado AS cargo_estado, p.concepto AS cargo_concepto,
              ((r.fecha + r.hora_fin) > (NOW() AT TIME ZONE $2::text)) AS es_futura
         FROM reservas_areas r
         JOIN areas_comunes a ON a.id = r.area_id
         LEFT JOIN pagos    p ON p.id = r.cargo_id
        WHERE r.residente_id = $1
        ORDER BY r.fecha DESC, r.hora_inicio DESC`,
      [residente.id, APP_TZ]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener tus reservas', detail: String(error) });
  }
};

export const getReservas = async (req: Request, res: Response) => {
  const ts = tenantFilter(req.user!, 'a');
  const off = ts.params.length + 1;
  const { area_id, estado, fecha_desde, fecha_hasta } = req.query;

  try {
    const result = await pool.query(
      `SELECT r.*, a.nombre AS area_nombre, a.tarifa_tipo, a.imagen_url,
              res.numero_casa, u.nombre AS residente_nombre,
              p.monto AS cargo_monto, p.estado AS cargo_estado
         FROM reservas_areas r
         JOIN areas_comunes a   ON a.id   = r.area_id
         JOIN residentes    res ON res.id = r.residente_id
         JOIN usuarios      u   ON u.id   = res.usuario_id
         LEFT JOIN pagos    p   ON p.id   = r.cargo_id
         ${ts.joinClause}
        WHERE ${ts.whereClause}
          AND ($${off}::uuid IS NULL OR r.area_id = $${off})
          AND ($${off + 1}::text IS NULL OR r.estado = $${off + 1})
          AND ($${off + 2}::date IS NULL OR r.fecha >= $${off + 2})
          AND ($${off + 3}::date IS NULL OR r.fecha <= $${off + 3})
        ORDER BY r.fecha DESC, r.hora_inicio DESC`,
      [
        ...ts.params,
        (area_id as string) || null,
        (estado as string) || null,
        (fecha_desde as string) || null,
        (fecha_hasta as string) || null,
      ]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener reservas', detail: String(error) });
  }
};
