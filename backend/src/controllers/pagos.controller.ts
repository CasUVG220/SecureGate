import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import pool from '../db/pool';
import { tenantFilter, ownershipClause, ownershipParams } from '../utils/tenant';
import { APP_TZ, Consultable } from '../utils/reservas';
import { serverError } from '../utils/http';
import { ProveedorNoConfiguradoError, obtenerProveedorPago, simularAutorizacionTarjeta as _simular } from '../services/pagos';
import {
  ExcedeSaldoError, aCentavos, bloquearSaldo, cuerpoExcedeSaldo, exigirQueCabe, restarDelSaldo,
} from '../utils/saldo';

/**
 * Marca como saldados los cargos de reserva pendientes del residente.
 *
 * Los cargos de reserva viven en la misma tabla `pagos` con metodo = 'reserva' y suman
 * al `saldo_pendiente`. Regla (T1): se saldan **solo cuando el pago deja el saldo en 0**;
 * un pago parcial reduce el saldo pero no elige a cuál cargo se aplica, así que los cargos
 * siguen «pendientes» hasta que la deuda total quede pagada.
 */
export async function liquidarCargosReserva(
  db: Consultable,
  residente_id: string
): Promise<number> {
  const result = await db.query(
    `UPDATE pagos SET estado = 'aprobado'
      WHERE residente_id = $1 AND metodo = 'reserva' AND estado = 'pendiente'
      RETURNING id`,
    [residente_id]
  );
  return result.rowCount ?? 0;
}

/** Monto positivo, finito, con tope razonable y a lo más con dos decimales (centavos exactos). */
const montoValido = (v: unknown): boolean => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 1_000_000 && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
};

/** Responde 422 si el error es «excede el saldo»; devuelve true si lo manejó. */
const responderExcede = (res: Response, error: unknown): boolean => {
  if (!(error instanceof ExcedeSaldoError)) return false;
  res.status(422).json(cuerpoExcedeSaldo(error));
  return true;
};

/** El comprobante es un data URI; ~5 MB de imagen ≈ 7 M caracteres en base64. */
const COMPROBANTE_MAX_CHARS = 7_000_000;

export const getPagos = async (req: Request, res: Response) => {
  const ts = tenantFilter(req.user!, 'p');
  try {
    const result = await pool.query(
      `SELECT p.*, r.numero_casa, u.nombre AS residente_nombre
       FROM pagos p
       JOIN residentes r ON p.residente_id = r.id
       JOIN usuarios   u ON r.usuario_id   = u.id
       ${ts.joinClause}
       WHERE ${ts.whereClause}
       ORDER BY p.fecha_pago DESC`,
      ts.params
    );
    res.json(result.rows);
  } catch (error) {
    serverError(res, error, 'Error al obtener pagos');
  }
};

export const createPago = async (req: Request, res: Response) => {
  const { residente_id, monto, comprobante } = req.body;
  const registrado_por = req.user?.id;

  if (!residente_id || monto === undefined || !registrado_por) {
    return res.status(400).json({ error: 'Campos requeridos: residente_id, monto' });
  }
  if (!montoValido(monto)) {
    return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Residente dentro del alcance de quien cobra (antes se aceptaba cualquiera).
    const residente = await client.query(
      `SELECT id, sucursal_id FROM residentes WHERE id = $1
         AND ${ownershipClause('residentes', 2)}`,
      [residente_id, ...ownershipParams(req.user!)]
    );
    if (residente.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Residente no encontrado' });
    }
    const sucursal_id: string = residente.rows[0].sucursal_id;

    // Fila del residente bloqueada: dos pagos simultáneos se serializan y nunca dejan saldo negativo.
    const montoC = aCentavos(monto);
    exigirQueCabe((await bloquearSaldo(client, residente_id))!, montoC);

    const pagoResult = await client.query(
      `INSERT INTO pagos
         (sucursal_id, residente_id, monto, metodo, estado, comprobante, registrado_por)
       VALUES ($1, $2, $3, 'efectivo', 'aprobado', $4, $5)
       RETURNING *`,
      [sucursal_id, residente_id, monto, comprobante || null, registrado_por]
    );

    if (await restarDelSaldo(client, residente_id, montoC) === 0) {
      await liquidarCargosReserva(client, residente_id);
    }

    await client.query('COMMIT');
    res.status(201).json(pagoResult.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (responderExcede(res, error)) return;
    serverError(res, error, 'Error al crear pago');
  } finally {
    client.release();
  }
};

export const aprobarPago = async (req: Request, res: Response) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const pagoResult = await client.query(
      `SELECT p.residente_id, p.estado, p.monto
       FROM pagos p
       WHERE p.id = $1
         AND ${ownershipClause('p', 2)}
       FOR UPDATE OF p`,
      [id, ...ownershipParams(req.user!)]
    );
    if (pagoResult.rows.length === 0) {
      await client.query('ROLLBACK');
      const existe = await pool.query('SELECT id FROM pagos WHERE id = $1', [id]);
      return existe.rows.length === 0
        ? res.status(404).json({ error: 'Pago no encontrado' })
        : res.status(403).json({ error: 'Sin acceso a este pago' });
    }
    if (pagoResult.rows[0].estado === 'aprobado') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'El pago ya fue aprobado' });
    }
    // Un pago rechazado no se "resucita" aprobándolo después: hay que registrar
    // otro. (Con FOR UPDATE dos aprobaciones simultáneas ya no liquidan dos veces.)
    if (pagoResult.rows[0].estado !== 'pendiente') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `El pago tiene estado '${pagoResult.rows[0].estado}' y no puede aprobarse` });
    }

    // El saldo puede haber bajado desde que el residente subió el comprobante (otro pago, un ajuste):
    // se vuelve a comprobar con la fila del residente bloqueada. Si ya no cabe, el pago sigue
    // pendiente y quien aprueba debe rechazarlo con un comentario.
    const { residente_id, monto } = pagoResult.rows[0];
    const montoC = aCentavos(monto);
    exigirQueCabe((await bloquearSaldo(client, residente_id))!, montoC);

    const updated = await client.query(
      `UPDATE pagos SET estado = 'aprobado' WHERE id = $1 RETURNING *`, [id]
    );

    if (await restarDelSaldo(client, residente_id, montoC) === 0) {
      await liquidarCargosReserva(client, residente_id);
    }

    await client.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (responderExcede(res, error)) return;
    serverError(res, error, 'Error al aprobar pago');
  } finally {
    client.release();
  }
};

export const rechazarPago = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { comentario_rechazo } = req.body ?? {};
  try {
    const result = await pool.query(
      `UPDATE pagos
       SET estado = 'rechazado', comentario_rechazo = $2
       WHERE id = $1
         AND estado = 'pendiente'
         AND ${ownershipClause('pagos', 3)}
       RETURNING *`,
      [id, comentario_rechazo || null, ...ownershipParams(req.user!)]
    );
    if (result.rows.length === 0) {
      const existe = await pool.query('SELECT id, estado FROM pagos WHERE id = $1', [id]);
      if (existe.rows.length === 0) {
        return res.status(404).json({ error: 'Pago no encontrado' });
      }
      if (existe.rows[0].estado !== 'pendiente') {
        return res.status(409).json({ error: `El pago ya tiene estado '${existe.rows[0].estado}'` });
      }
      return res.status(403).json({ error: 'Sin acceso a este pago' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    serverError(res, error, 'Error al rechazar pago');
  }
};

export const crearTransferencia = async (req: Request, res: Response) => {
  const usuario_id = req.user?.id;
  const { monto, referencia, banco, fecha_transferencia, comprobante } = req.body;

  if (!monto || !referencia || !banco || !fecha_transferencia) {
    return res.status(400).json({
      error: 'Campos requeridos: monto, referencia, banco, fecha_transferencia',
    });
  }
  if (!montoValido(monto)) {
    return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
  }
  if (String(referencia).length > 100 || String(banco).length > 100 ||
      Number.isNaN(Date.parse(String(fecha_transferencia)))) {
    return res.status(400).json({ error: 'referencia, banco o fecha_transferencia inválidos' });
  }
  if (comprobante != null && (typeof comprobante !== 'string' || comprobante.length > COMPROBANTE_MAX_CHARS)) {
    return res.status(413).json({ error: 'El comprobante es demasiado grande (máx. 5 MB)' });
  }

  try {
    const residente = await pool.query(
      'SELECT id, sucursal_id FROM residentes WHERE usuario_id = $1', [usuario_id]
    );
    if (residente.rows.length === 0) {
      return res.status(404).json({ error: 'Residente no encontrado' });
    }
    const { id: residente_id, sucursal_id } = residente.rows[0];

    // Aviso temprano: un comprobante por más de lo que se debe no puede aprobarse después.
    // (La comprobación que manda es la de la aprobación, con la fila bloqueada.)
    const saldoC = aCentavos((await pool.query(
      'SELECT saldo_pendiente FROM residentes WHERE id = $1', [residente_id],
    )).rows[0].saldo_pendiente);
    if (aCentavos(monto) > saldoC) {
      return res.status(422).json(cuerpoExcedeSaldo(new ExcedeSaldoError(saldoC, aCentavos(monto))));
    }

    const result = await pool.query(
      `INSERT INTO pagos
         (sucursal_id, residente_id, monto, metodo, estado,
          referencia, banco, fecha_transferencia, comprobante, registrado_por)
       VALUES ($1, $2, $3, 'transferencia', 'pendiente', $4, $5, $6, $7, $8)
       RETURNING *`,
      [sucursal_id, residente_id, monto, referencia, banco,
       fecha_transferencia, comprobante || null, usuario_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    serverError(res, error, 'Error al registrar comprobante');
  }
};

/**
 * La regla de la pasarela simulada vive ahora en `services/pagos/simulado.ts` (T2); se reexporta aquí para no romper
 * a quien la importaba desde el controlador.
 */
export const simularAutorizacionTarjeta = _simular;

/**
 * Cobro con tarjeta del residente logueado, a través de la interfaz `ProveedorPago` (T2): hoy la pasarela simulada;
 * el adaptador de Visanet falla de forma controlada (503, auditado) hasta que exista la integración real.
 *
 * Sólo llegan los últimos 4 dígitos: el número completo, el CVV y la fecha de
 * vencimiento se validan en el navegador y nunca salen de él, así que el
 * backend no los recibe ni los almacena.
 */
export const pagarConTarjeta = async (req: Request, res: Response) => {
  // La pasarela es un MOCK que acepta cualquier tarjeta. Sólo se
  // habilita de forma explícita (PAGOS_TARJETA_SIMULADA=true, docker-compose de
  // desarrollo); en producción responde 501 hasta que exista la integración
  // real. Sin este interruptor, cualquier residente podía dejar su saldo en 0
  // con una sola petición.
  const proveedor = obtenerProveedorPago();
  if (!proveedor) {
    return res.status(501).json({ error: 'El pago con tarjeta no está disponible todavía' });
  }

  const usuario_id = req.user?.id;
  const { monto, ultimos4, titular } = req.body ?? {};

  if (monto === undefined || !ultimos4) {
    return res.status(400).json({ error: 'Campos requeridos: monto, ultimos4' });
  }
  if (!montoValido(monto)) {
    return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
  }
  if (!/^[0-9]{4}$/.test(String(ultimos4))) {
    return res.status(400).json({ error: 'ultimos4 debe tener exactamente 4 dígitos' });
  }

  const client = await pool.connect();
  try {
    const residente = await client.query(
      'SELECT id, sucursal_id FROM residentes WHERE usuario_id = $1', [usuario_id]
    );
    if (residente.rows.length === 0) {
      return res.status(404).json({ error: 'Residente no encontrado' });
    }
    const { id: residente_id, sucursal_id } = residente.rows[0];

    // Primero se bloquea la fila del residente y se comprueba que el monto cabe en el saldo: así
    // nunca se autoriza un cobro que después no se podría acreditar (y dos cobros simultáneos
    // del mismo residente se serializan).
    await client.query('BEGIN');
    const montoC = aCentavos(monto);
    exigirQueCabe((await bloquearSaldo(client, residente_id))!, montoC);

    let autorizacion;
    try {
      autorizacion = await proveedor.autorizar({
        montoCentavos: montoC,
        ultimos4: String(ultimos4),
        titular: titular ? String(titular).slice(0, 80) : undefined,
        referenciaInterna: randomUUID(),
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error instanceof ProveedorNoConfiguradoError) {
        // Falla controlada: nada se cobró ni se guardó. La fila de auditoría (PAGO_TARJETA_SIMULADO, 503) lleva el proveedor.
        res.locals.auditoria = { proveedor: error.proveedor, motivo: 'proveedor_no_configurado' };
        return res.status(503).json({
          error: 'El pago con tarjeta no está disponible todavía',
          codigo: 'PROVEEDOR_NO_CONFIGURADO',
        });
      }
      res.locals.auditoria = { proveedor: proveedor.nombre, motivo: 'error_del_proveedor' };
      return res.status(502).json({ error: 'No se pudo comunicar con el procesador de pagos. Intenta de nuevo en unos minutos.', codigo: 'PROVEEDOR_ERROR' });
    }
    const estado = autorizacion.estado;
    res.locals.auditoria = { proveedor: proveedor.nombre, estado };

    // Una tarjeta rechazada NO es un pago: no se guarda en `pagos`. Antes cada intento
    // fallido quedaba como una fila 'rechazado' que ensuciaba el historial del residente
    // y del administrador y se colaba en los reportes. El intento no se pierde: la ruta
    // lleva auditoría (PAGO_TARJETA_SIMULADO) con usuario, IP y este código 402.
    if (estado === 'rechazado') {
      await client.query('ROLLBACK');
      return res.status(402).json({
        error: 'Pago rechazado por el emisor. Intenta con otra tarjeta.',
        estado: 'rechazado',
      });
    }

    const result = await client.query(
      `INSERT INTO pagos
         (sucursal_id, residente_id, monto, metodo, estado, concepto,
          tarjeta_ultimos4, es_simulado, referencia, registrado_por)
       VALUES ($1, $2, $3, 'tarjeta', $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [sucursal_id, residente_id, monto, estado,
       titular ? `Pago con tarjeta — ${String(titular).slice(0, 80)}` : 'Pago con tarjeta',
       String(ultimos4), proveedor.simulado, autorizacion.idTransaccion ?? null, usuario_id]
    );

    // La autorización aprobada resta su monto del saldo igual que un pago en efectivo aprobado.
    if (await restarDelSaldo(client, residente_id, montoC) === 0) {
      await liquidarCargosReserva(client, residente_id);
    }

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (responderExcede(res, error)) return;
    serverError(res, error, 'Error al procesar el pago con tarjeta');
  } finally {
    client.release();
  }
};

/**
 * ¿Está disponible el pago con tarjeta y es simulado? Lo consulta el portal del residente
 * para decidir si muestra el botón y, SOLO en entornos de prueba, el aviso de «pago
 * simulado». En producción con Visanet real `simulada` será false y el residente jamás
 * verá textos de implementación.
 */
export const getEstadoTarjeta = (_req: Request, res: Response) => {
  const simulada = obtenerProveedorPago()?.simulado === true;
  res.json({ disponible: simulada, simulada });
};

export const getPendientesVerificacion = async (req: Request, res: Response) => {
  const ts = tenantFilter(req.user!, 'p');
  const extraOffset = ts.params.length + 1;
  try {
    const result = await pool.query(
      `SELECT p.*,
              r.numero_casa, r.saldo_pendiente, r.estado_pago,
              u.nombre AS residente_nombre, u.email AS residente_email,
              r.telefono AS residente_telefono
       FROM pagos p
       JOIN residentes r ON p.residente_id = r.id
       JOIN usuarios   u ON r.usuario_id   = u.id
       ${ts.joinClause}
       WHERE ${ts.whereClause}
         AND p.metodo = 'transferencia'
         AND p.estado = $${extraOffset}
       ORDER BY p.fecha_pago ASC`,
      [...ts.params, 'pendiente']
    );
    res.json(result.rows);
  } catch (error) {
    serverError(res, error, 'Error al obtener pagos pendientes');
  }
};

export const getMisPagos = async (req: Request, res: Response) => {
  const usuario_id = req.user?.id;
  try {
    const residente = await pool.query(
      'SELECT id FROM residentes WHERE usuario_id = $1', [usuario_id]
    );
    if (residente.rows.length === 0) {
      return res.status(404).json({ error: 'Residente no encontrado' });
    }
    const result = await pool.query(
      `SELECT * FROM pagos WHERE residente_id = $1 ORDER BY fecha_pago DESC LIMIT 20`,
      [residente.rows[0].id]
    );
    res.json(result.rows);
  } catch (error) {
    serverError(res, error, 'Error al obtener pagos');
  }
};

/**
 * Resumen de la factura del mes en curso para el residente logueado.
 *
 * Desglosa los cargos pendientes por concepto (cuota de mantenimiento, reservas
 * de áreas comunes, etc.) para que el residente vea de dónde sale su saldo y no
 * confunda el cargo de una reserva con la cuota.
 */
export const getMiResumenMes = async (req: Request, res: Response) => {
  const usuario_id = req.user?.id;
  try {
    const residente = await pool.query(
      'SELECT id, saldo_pendiente, estado_pago FROM residentes WHERE usuario_id = $1',
      [usuario_id]
    );
    if (residente.rows.length === 0) {
      return res.status(404).json({ error: 'Residente no encontrado' });
    }
    const { id, saldo_pendiente, estado_pago } = residente.rows[0];

    const items = await pool.query(
      `SELECT p.id, p.concepto, p.monto, p.metodo, p.estado, p.fecha_pago,
              r.id AS reserva_id, a.nombre AS area_nombre, r.fecha AS reserva_fecha
         FROM pagos p
         LEFT JOIN reservas_areas r ON r.cargo_id = p.id
         LEFT JOIN areas_comunes  a ON a.id = r.area_id
        WHERE p.residente_id = $1
          AND p.estado = 'pendiente'
          AND date_trunc('month', (p.fecha_pago AT TIME ZONE $2::text)) =
              date_trunc('month', (NOW() AT TIME ZONE $2::text))
        ORDER BY p.fecha_pago ASC`,
      [id, APP_TZ]
    );

    const total = items.rows.reduce((sum, row) => sum + Number(row.monto), 0);

    res.json({
      periodo: new Date().toISOString().slice(0, 7),
      items: items.rows,
      total_pendiente: Math.round(total * 100) / 100,
      saldo_pendiente: Number(saldo_pendiente),
      estado_pago,
    });
  } catch (error) {
    serverError(res, error, 'Error al obtener el resumen del mes');
  }
};
