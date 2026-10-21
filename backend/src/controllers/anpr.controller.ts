import { Request, Response } from 'express';
import crypto from 'crypto';
import pool from '../db/pool';
import { esUuid, serverError } from '../utils/http';
import { esPlacaGuatemalteca, formatearPlaca, normalizarPlaca, placaPlausible } from '../utils/placa';
import { APP_TZ } from '../utils/reservas';
import { ownershipClause, ownershipParams, tenantFilter } from '../utils/tenant';
import { resolverRegistradoEn } from './accesos.controller';

/**
 * ANPR continuo (Sprint 10). Ver docs/anpr_continuo.md.
 *
 * - Vehículos AUTORIZADOS de los residentes (`vehiculos_residentes`): la administración los da de alta; la garita los baja en
 *   `GET /sync/garita` (con versión, solo los cambios) y decide SIN red contra esa copia.
 * - `POST /anpr/accesos` y `/anpr/salidas`: lo que la garita registró sola (o con un toque del agente) y sube desde su cola
 *   offline. `id_cliente` / `id_cliente_salida` hacen idempotente cada reintento. El servidor vuelve a validar (vehículo activo y
 *   vigente, residente activo, sin bloqueo por placa): si algo cambió mientras la garita estaba sin red, responde 409/403 y la cola
 *   lo marca «rechazado» para que el agente lo vea, igual que con los accesos de visitantes.
 * - `POST /anpr/eventos`: lo que no es un acceso pero debe quedar en la bitácora (alerta de lista negra, verificación resuelta sin
 *   registro, vehículo ilegible, falla del actuador).
 * - `POST /anpr/evidencias`: recorte de la placa / del vehículo (JPEG ≤ 256 KB) de un acceso o evento YA recibido; se purga a los
 *   7 días.
 *
 * Todas las rutas de la garita exigen sesión de agente + licencia del equipo de la MISMA sucursal (empresa suspendida → 423 desde
 * `verifyLicencia`).
 */

export const MAX_EVIDENCIA_BYTES = 256 * 1024;
export const RETENCION_EVIDENCIA_DIAS = 7;
const TEXTO_CORTO = /^[A-Za-z0-9_.:-]{1,64}$/;

/** Acción de bitácora según el modo con que la garita registró el acceso (el middleware usa `res.locals.auditoriaAccion`). */
const ACCION_ACCESO = {
  automatico: { accion: 'ANPR_ACCESO_AUTOMATICO' },
  verificacion: { accion: 'ANPR_ACCESO_VERIFICADO' },
} as const;

const ACCION_EVENTO = {
  alerta_lista_negra: { accion: 'ANPR_ALERTA_LISTA_NEGRA' },
  verificacion_resuelta: { accion: 'ANPR_VERIFICACION_RESUELTA' },
  ilegible: { accion: 'ANPR_ILEGIBLE' },
  actuador_fallo: { accion: 'ANPR_ACTUADOR_FALLO' },
} as const;
type TipoEvento = keyof typeof ACCION_EVENTO;

/** La sesión del agente y la licencia del equipo tienen que ser de la misma sucursal (como en `/sync/garita` y `/accesos`). */
const sucursalDeGarita = (req: Request, res: Response): string | null => {
  const sucursal = req.licencia?.sucursal_id;
  if (!sucursal || (req.user!.sucursal_id && req.user!.sucursal_id !== sucursal)) {
    res.status(403).json({ error: 'La sesión del agente no corresponde a la sucursal de esta licencia' });
    return null;
  }
  return sucursal;
};

const confianzaValida = (v: unknown): number | null | undefined => {
  if (v === undefined || v === null) return null;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? Math.round(v * 10000) / 10000 : undefined;
};

/** Validación común de lo que manda la garita. Devuelve el error a responder (400) o null. */
function validarComun(b: Record<string, unknown>): string | null {
  if (!esUuid(b.id_cliente)) return 'id_cliente debe ser un UUID';
  if (confianzaValida(b.confianza) === undefined) return 'confianza debe ser un número entre 0 y 1';
  if (b.track_id != null && (typeof b.track_id !== 'string' || !TEXTO_CORTO.test(b.track_id))) return 'track_id inválido';
  if (b.carril != null && (typeof b.carril !== 'string' || !TEXTO_CORTO.test(b.carril))) return 'carril inválido';
  return null;
}

// ── Vehículos de residentes (administración) ─────────────────────────────────────────────────────────────────

const COLUMNAS_VEHICULO = `v.id, v.sucursal_id, v.residente_id, v.placa, v.descripcion,
  to_char(v.vigente_desde, 'YYYY-MM-DD') AS vigente_desde, to_char(v.vigente_hasta, 'YYYY-MM-DD') AS vigente_hasta,
  v.activo, v.created_at, v.updated_at`;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const fechaValida = (v: unknown): v is string => typeof v === 'string' && FECHA.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

const PLACA_FORMATO = 'La placa debe tener el formato guatemalteco, por ejemplo P-123ABC: el reconocimiento automático solo lee ese formato';

/**
 * ¿La placa ya está autorizada (activa) para otro vehículo de la MISMA empresa? Devuelve el mensaje del 409 o null.
 * - Misma sucursal: se dice para qué casa, para que la administración la dé de baja allí primero (una placa, un residente).
 * - Otra sucursal de la empresa: se rechaza sin nombrarla (el admin de sucursal no ve las demás); lo revisa la empresa.
 * - Otra empresa: se permite y no se revela nada (cada condominio decide sobre su propia talanquera).
 */
async function placaOcupada(placa: string, sucursalId: string, excluirId: string | null = null): Promise<string | null> {
  const r = await pool.query<{ misma: boolean; numero_casa: string }>(
    `SELECT v.sucursal_id = $2 AS misma, r.numero_casa
       FROM vehiculos_residentes v
       JOIN residentes r ON r.id = v.residente_id
       JOIN sucursales s ON s.id = v.sucursal_id
      WHERE v.activo AND v.placa = $1 AND ($3::uuid IS NULL OR v.id <> $3)
        AND s.empresa_id = (SELECT empresa_id FROM sucursales WHERE id = $2)
      ORDER BY (v.sucursal_id = $2) DESC
      LIMIT 1`,
    [placa, sucursalId, excluirId],
  );
  const f = r.rows[0];
  if (!f) return null;
  return f.misma
    ? `La placa ${formatearPlaca(placa)} ya está autorizada para la casa ${f.numero_casa} de esta sucursal. Dala de baja allí antes de asignarla a otra casa.`
    : `La placa ${formatearPlaca(placa)} ya está autorizada en otra sucursal de la empresa. Pide a la administración de la empresa que la revise.`;
}

export const listarVehiculos = async (req: Request, res: Response) => {
  const ts = tenantFilter(req.user!, 'v');
  const params: unknown[] = [...ts.params];
  let extra = '';
  if (req.query.residente_id !== undefined) {
    if (!esUuid(req.query.residente_id)) return res.status(400).json({ error: 'residente_id debe ser un UUID' });
    params.push(req.query.residente_id);
    extra += ` AND v.residente_id = $${params.length}`;
  }
  if (req.query.incluir_bajas !== 'true') extra += ' AND v.activo';
  try {
    const r = await pool.query(
      `SELECT ${COLUMNAS_VEHICULO}, r.numero_casa, u.nombre AS residente_nombre
         FROM vehiculos_residentes v
         JOIN residentes r ON r.id = v.residente_id
         JOIN usuarios u ON u.id = r.usuario_id
         ${ts.joinClause}
        WHERE ${ts.whereClause}${extra}
        ORDER BY r.numero_casa, v.placa
        LIMIT 2000`,
      params,
    );
    res.json(r.rows);
  } catch (error) {
    serverError(res, error, 'Error al listar vehículos');
  }
};

export const crearVehiculo = async (req: Request, res: Response) => {
  const { residente_id, placa, descripcion, vigente_desde, vigente_hasta } = req.body ?? {};
  if (!esUuid(residente_id)) return res.status(400).json({ error: 'residente_id debe ser un UUID' });
  const p = normalizarPlaca(placa);
  if (!p) return res.status(400).json({ error: 'Escribe la placa' });
  if (!esPlacaGuatemalteca(p)) return res.status(400).json({ error: PLACA_FORMATO });
  if (descripcion != null && (typeof descripcion !== 'string' || descripcion.length > 100)) return res.status(400).json({ error: 'La descripción admite hasta 100 caracteres' });
  if (vigente_desde != null && !fechaValida(vigente_desde)) return res.status(400).json({ error: 'vigente_desde debe ser AAAA-MM-DD' });
  if (vigente_hasta != null && !fechaValida(vigente_hasta)) return res.status(400).json({ error: 'vigente_hasta debe ser AAAA-MM-DD' });
  if (vigente_desde && vigente_hasta && vigente_hasta < vigente_desde) return res.status(400).json({ error: 'vigente_hasta debe ser igual o posterior a vigente_desde' });
  try {
    const residente = await pool.query(
      `SELECT r.id, r.sucursal_id FROM residentes r WHERE r.id = $1 AND ${ownershipClause('r', 2)}`,
      [residente_id, ...ownershipParams(req.user!)],
    );
    if (residente.rows.length === 0) return res.status(404).json({ error: 'Residente no encontrado' });
    const ocupada = await placaOcupada(p, residente.rows[0].sucursal_id);
    if (ocupada) return res.status(409).json({ error: ocupada });
    const r = await pool.query(
      `INSERT INTO vehiculos_residentes (sucursal_id, residente_id, placa, descripcion, vigente_desde, vigente_hasta, creado_por)
       VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE), $6::date, $7)
       RETURNING id`,
      [residente.rows[0].sucursal_id, residente_id, p, descripcion?.trim() || null, vigente_desde ?? null, vigente_hasta ?? null, req.user!.id],
    );
    const fila = await pool.query(`SELECT ${COLUMNAS_VEHICULO} FROM vehiculos_residentes v WHERE v.id = $1`, [r.rows[0].id]);
    res.locals.auditoria = { placa: p, residente_id };
    res.status(201).json(fila.rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      return res.status(409).json({ error: 'Esa placa ya está registrada como vehículo de un residente de esta sucursal' });
    }
    serverError(res, error, 'Error al registrar el vehículo');
  }
};

export const actualizarVehiculo = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { descripcion, vigente_desde, vigente_hasta, activo } = req.body ?? {};
  if (!esUuid(id)) return res.status(404).json({ error: 'Vehículo no encontrado' });
  if (descripcion !== undefined && descripcion !== null && (typeof descripcion !== 'string' || descripcion.length > 100)) {
    return res.status(400).json({ error: 'La descripción admite hasta 100 caracteres' });
  }
  if (vigente_desde !== undefined && !fechaValida(vigente_desde)) return res.status(400).json({ error: 'vigente_desde debe ser AAAA-MM-DD' });
  if (vigente_hasta !== undefined && vigente_hasta !== null && !fechaValida(vigente_hasta)) return res.status(400).json({ error: 'vigente_hasta debe ser AAAA-MM-DD' });
  if (activo !== undefined && typeof activo !== 'boolean') return res.status(400).json({ error: 'activo debe ser verdadero o falso' });
  try {
    if (activo === true) {
      // Reactivar es volver a autorizar la placa: misma regla que el alta.
      const actual = await pool.query(
        `SELECT v.placa, v.sucursal_id FROM vehiculos_residentes v WHERE v.id = $1 AND ${ownershipClause('v', 2)}`,
        [id, ...ownershipParams(req.user!)],
      );
      if (actual.rows.length === 0) return res.status(404).json({ error: 'Vehículo no encontrado' });
      const ocupada = await placaOcupada(actual.rows[0].placa, actual.rows[0].sucursal_id, id);
      if (ocupada) return res.status(409).json({ error: ocupada });
    }
    const r = await pool.query(
      `UPDATE vehiculos_residentes v SET
         descripcion   = CASE WHEN $2::boolean THEN $3 ELSE descripcion END,
         vigente_desde = COALESCE($4::date, vigente_desde),
         vigente_hasta = CASE WHEN $5::boolean THEN $6::date ELSE vigente_hasta END,
         activo        = COALESCE($7::boolean, activo)
       WHERE v.id = $1 AND ${ownershipClause('v', 8)}
       RETURNING v.id`,
      [id, descripcion !== undefined, typeof descripcion === 'string' ? descripcion.trim() || null : null, vigente_desde ?? null,
        vigente_hasta !== undefined, vigente_hasta ?? null, activo ?? null, ...ownershipParams(req.user!)],
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Vehículo no encontrado' });
    const fila = await pool.query(`SELECT ${COLUMNAS_VEHICULO} FROM vehiculos_residentes v WHERE v.id = $1`, [id]);
    res.locals.auditoria = { campos: Object.keys(req.body ?? {}).filter(k => ['descripcion', 'vigente_desde', 'vigente_hasta', 'activo'].includes(k)) };
    res.json(fila.rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code === '23514') return res.status(400).json({ error: 'vigente_hasta debe ser igual o posterior a vigente_desde' });
    if ((error as { code?: string }).code === '23505') return res.status(409).json({ error: 'Esa placa ya está activa para otro residente de esta sucursal' });
    serverError(res, error, 'Error al actualizar el vehículo');
  }
};

/** Baja suave: la fila queda (con su historial) y la garita se entera en el siguiente pull. */
export const darDeBajaVehiculo = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!esUuid(id)) return res.status(404).json({ error: 'Vehículo no encontrado' });
  try {
    const r = await pool.query(
      `UPDATE vehiculos_residentes v SET activo = FALSE WHERE v.id = $1 AND ${ownershipClause('v', 2)} RETURNING v.id, v.placa`,
      [id, ...ownershipParams(req.user!)],
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Vehículo no encontrado' });
    res.locals.auditoria = { placa: r.rows[0].placa };
    res.json({ id, activo: false });
  } catch (error) {
    serverError(res, error, 'Error al dar de baja el vehículo');
  }
};

// ── Lo que sube la garita ────────────────────────────────────────────────────────────────────────────────────

/** Día (en la zona de la app) en que ocurrió el movimiento, acotado a hoy: con él se mide la vigencia del vehículo. */
const SQL_DIA = `(LEAST(COALESCE($2::timestamptz, NOW()), NOW()) AT TIME ZONE $3)::date`;

export const registrarAccesoAnpr = async (req: Request, res: Response) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const sucursal = sucursalDeGarita(req, res);
  if (!sucursal) return;
  const invalido = validarComun(b);
  if (invalido) return res.status(400).json({ error: invalido });
  if (!esUuid(b.vehiculo_id)) return res.status(400).json({ error: 'vehiculo_id debe ser un UUID' });
  const modo = b.modo === 'verificacion' ? 'verificacion' : b.modo === 'automatico' || b.modo === undefined ? 'automatico' : null;
  if (!modo) return res.status(400).json({ error: 'modo debe ser automatico o verificacion' });
  const placa = normalizarPlaca(b.placa);
  const registradoEn = resolverRegistradoEn(b.registrado_en);
  if (registradoEn === null) return res.status(400).json({ error: 'registrado_en inválido o demasiado antiguo' });
  res.locals.auditoriaAccion = ACCION_ACCESO[modo].accion;
  res.locals.auditoria = { id_cliente: b.id_cliente, placa, track_id: b.track_id ?? null, carril: b.carril ?? null, confianza: b.confianza ?? null, modo };

  try {
    const previo = await pool.query('SELECT * FROM registros_acceso WHERE id_cliente = $1', [b.id_cliente]);
    if (previo.rows.length > 0) return res.status(200).json({ registro: previo.rows[0], duplicado: true });

    const v = await pool.query(
      `SELECT v.id, v.residente_id, v.placa, v.activo, u.activo AS residente_activo,
              (v.vigente_desde <= ${SQL_DIA} AND (v.vigente_hasta IS NULL OR v.vigente_hasta >= ${SQL_DIA})) AS vigente
         FROM vehiculos_residentes v
         JOIN residentes r ON r.id = v.residente_id
         JOIN usuarios u ON u.id = r.usuario_id
        WHERE v.id = $1 AND v.sucursal_id = $4`,
      [b.vehiculo_id, registradoEn ?? null, APP_TZ, sucursal],
    );
    if (v.rows.length === 0) return res.status(404).json({ error: 'Vehículo no encontrado en esta sucursal' });
    const veh = v.rows[0];
    if (placa && placa !== veh.placa) return res.status(409).json({ error: 'La placa leída no coincide con la del vehículo autorizado' });
    if (!veh.activo) return res.status(409).json({ error: 'El vehículo ya no está autorizado', motivo: 'vehiculo_inactivo' });
    if (!veh.residente_activo) return res.status(409).json({ error: 'El residente está dado de baja', motivo: 'residente_inactivo' });
    if (!veh.vigente) return res.status(409).json({ error: 'La autorización del vehículo no estaba vigente ese día', motivo: 'vehiculo_no_vigente' });

    const bloqueo = await pool.query(
      `SELECT razon, fecha_fin FROM visitante_blacklist
        WHERE placa = $1 AND sucursal_id = $2 AND activo = TRUE AND (fecha_fin IS NULL OR fecha_fin > NOW())
        LIMIT 1`,
      [veh.placa, sucursal],
    );
    if (bloqueo.rows.length > 0) {
      return res.status(403).json({ error: 'Vehículo en lista negra', motivo: 'placa', razon: bloqueo.rows[0].razon });
    }

    const r = await pool.query(
      `INSERT INTO registros_acceso
         (sucursal_id, visitante_id, residente_id, vehiculo_id, vehiculo_residente_id, agente_id, tipo, notas,
          timestamp_entrada, registrado_en, recibido_en, capturado_manualmente, origen, id_cliente, licencia_id,
          confianza, track_id, evidencia_ref, verificado_por)
       VALUES ($1, NULL, $2, NULL, $3, $4, 'entrada', $5,
               LEAST(COALESCE($6::timestamptz, NOW()), NOW()), $6::timestamptz, NOW(), FALSE, 'anpr', $7, $8,
               $9, $10, $11, $12)
       RETURNING *`,
      [sucursal, veh.residente_id, veh.id, req.user!.id, b.carril ? `ANPR · carril ${b.carril}` : 'ANPR',
        registradoEn ?? null, b.id_cliente, req.licencia!.id,
        confianzaValida(b.confianza), b.track_id ?? null, `anpr:${b.id_cliente}`, modo === 'verificacion' ? req.user!.id : null],
    );
    res.status(201).json({ registro: r.rows[0], duplicado: false });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      const previo = await pool.query('SELECT * FROM registros_acceso WHERE id_cliente = $1', [b.id_cliente]);
      if (previo.rows.length > 0) return res.status(200).json({ registro: previo.rows[0], duplicado: true });
    }
    serverError(res, error, 'Error al registrar el acceso automático');
  }
};

/**
 * Salida por placa (carril de salida): cierra el acceso ABIERTO más reciente de esa placa en la sucursal, sea de un vehículo de
 * residente (ANPR) o de un visitante con vehículo (misma búsqueda que `GET /accesos/activo`). Idempotente por `id_cliente`.
 */
export const registrarSalidaAnpr = async (req: Request, res: Response) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const sucursal = sucursalDeGarita(req, res);
  if (!sucursal) return;
  const invalido = validarComun(b);
  if (invalido) return res.status(400).json({ error: invalido });
  const placa = normalizarPlaca(b.placa);
  if (!placaPlausible(placa)) return res.status(400).json({ error: 'Placa inválida' });
  const registradoEn = resolverRegistradoEn(b.registrado_en);
  if (registradoEn === null) return res.status(400).json({ error: 'registrado_en inválido o demasiado antiguo' });
  res.locals.auditoria = { id_cliente: b.id_cliente, placa, track_id: b.track_id ?? null, carril: b.carril ?? null, confianza: b.confianza ?? null };

  const client = await pool.connect();
  try {
    const previo = await client.query('SELECT * FROM registros_acceso WHERE id_cliente_salida = $1', [b.id_cliente]);
    if (previo.rows.length > 0) return res.status(200).json({ registro: previo.rows[0], duplicado: true });
    await client.query('BEGIN');
    const abierto = await client.query(
      `SELECT ra.id FROM registros_acceso ra
         LEFT JOIN vehiculos veh ON veh.id = ra.vehiculo_id
         LEFT JOIN vehiculos_residentes vr ON vr.id = ra.vehiculo_residente_id
        WHERE ra.sucursal_id = $1 AND ra.timestamp_salida IS NULL
          AND (vr.placa = $2 OR regexp_replace(upper(veh.placa), '[^A-Z0-9]', '', 'g') = $2)
        ORDER BY ra.timestamp_entrada DESC
        LIMIT 1
        FOR UPDATE OF ra`,
      [sucursal, placa],
    );
    if (abierto.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No hay un acceso abierto para esa placa' });
    }
    const r = await client.query(
      `UPDATE registros_acceso
          SET tipo = 'salida', id_cliente_salida = $2,
              timestamp_salida = GREATEST(timestamp_entrada, LEAST(COALESCE($3::timestamptz, NOW()), NOW()))
        WHERE id = $1
        RETURNING *`,
      [abierto.rows[0].id, b.id_cliente, registradoEn ?? null],
    );
    await client.query('COMMIT');
    res.status(201).json({ registro: r.rows[0], duplicado: false });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if ((error as { code?: string }).code === '23505') {
      const previo = await pool.query('SELECT * FROM registros_acceso WHERE id_cliente_salida = $1', [b.id_cliente]);
      if (previo.rows.length > 0) return res.status(200).json({ registro: previo.rows[0], duplicado: true });
    }
    serverError(res, error, 'Error al registrar la salida automática');
  } finally {
    client.release();
  }
};

export const registrarEventoAnpr = async (req: Request, res: Response) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const sucursal = sucursalDeGarita(req, res);
  if (!sucursal) return;
  const invalido = validarComun(b);
  if (invalido) return res.status(400).json({ error: invalido });
  if (typeof b.tipo !== 'string' || !(b.tipo in ACCION_EVENTO)) {
    return res.status(400).json({ error: `tipo debe ser uno de: ${Object.keys(ACCION_EVENTO).join(', ')}` });
  }
  const tipo = b.tipo as TipoEvento;
  const placa = b.placa == null ? null : normalizarPlaca(b.placa) || null;
  const detalle = b.detalle ?? null;
  if (detalle !== null && (typeof detalle !== 'object' || Array.isArray(detalle) || JSON.stringify(detalle).length > 4000)) {
    return res.status(400).json({ error: 'detalle debe ser un objeto de hasta 4 000 caracteres' });
  }
  const registradoEn = resolverRegistradoEn(b.registrado_en);
  if (registradoEn === null) return res.status(400).json({ error: 'registrado_en inválido o demasiado antiguo' });
  try {
    const r = await pool.query(
      `INSERT INTO anpr_eventos (id_cliente, sucursal_id, licencia_id, agente_id, tipo, placa, carril, track_id, detalle, registrado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::timestamptz)
       ON CONFLICT (id_cliente) DO NOTHING
       RETURNING id_cliente, tipo, recibido_en`,
      [b.id_cliente, sucursal, req.licencia!.id, req.user!.id, tipo, placa, b.carril ?? null, b.track_id ?? null,
        detalle === null ? null : JSON.stringify(detalle), registradoEn ?? null],
    );
    res.locals.auditoriaAccion = ACCION_EVENTO[tipo].accion;
    if (r.rows.length === 0) {
      // Reintento de la cola: ya estaba. Queda en la bitácora como 200 marcado, sin una fila nueva.
      res.locals.auditoria = { id_cliente: b.id_cliente, duplicado: true };
      return res.status(200).json({ evento: { id_cliente: b.id_cliente, tipo }, duplicado: true });
    }
    res.locals.auditoria = { id_cliente: b.id_cliente, placa, carril: b.carril ?? null, track_id: b.track_id ?? null, ...(detalle as object | null) };
    res.status(201).json({ evento: r.rows[0], duplicado: false });
  } catch (error) {
    serverError(res, error, 'Error al registrar el evento');
  }
};

export const subirEvidencia = async (req: Request, res: Response) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const sucursal = sucursalDeGarita(req, res);
  if (!sucursal) return;
  if (!esUuid(b.id_cliente)) return res.status(400).json({ error: 'id_cliente debe ser un UUID' });
  if (b.tipo !== 'placa' && b.tipo !== 'vehiculo') return res.status(400).json({ error: 'tipo debe ser placa o vehiculo' });
  if (typeof b.jpeg !== 'string' || !b.jpeg) return res.status(400).json({ error: 'Falta la imagen (jpeg en base64)' });
  if (b.jpeg.length > Math.ceil((MAX_EVIDENCIA_BYTES * 4) / 3) + 4) return res.status(413).json({ error: 'La evidencia supera 256 KB' });
  const imagen = Buffer.from(b.jpeg, 'base64');
  if (imagen.length === 0 || imagen.length > MAX_EVIDENCIA_BYTES) return res.status(413).json({ error: 'La evidencia supera 256 KB' });
  if (imagen[0] !== 0xff || imagen[1] !== 0xd8 || imagen[2] !== 0xff) return res.status(400).json({ error: 'La evidencia debe ser un JPEG' });
  const sha256 = crypto.createHash('sha256').update(imagen).digest('hex');
  if (b.sha256 != null && b.sha256 !== sha256) return res.status(400).json({ error: 'El SHA-256 no coincide con la imagen' });
  res.locals.auditoria = { id_cliente: b.id_cliente, tipo: b.tipo, bytes: imagen.length };
  try {
    // Solo se acepta evidencia de algo que esta sucursal ya registró: no es un almacén de archivos abierto.
    const duena = await pool.query(
      `SELECT 1 FROM registros_acceso WHERE (id_cliente = $1 OR id_cliente_salida = $1) AND sucursal_id = $2
       UNION ALL
       SELECT 1 FROM anpr_eventos WHERE id_cliente = $1 AND sucursal_id = $2
       LIMIT 1`,
      [b.id_cliente, sucursal],
    );
    if (duena.rows.length === 0) return res.status(404).json({ error: 'No hay un acceso o evento con ese id_cliente en esta sucursal' });
    const r = await pool.query(
      `INSERT INTO evidencias_anpr (sucursal_id, id_cliente, tipo, sha256, imagen, tamano, licencia_id, expira_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + make_interval(days => $8))
       ON CONFLICT (id_cliente, tipo) DO NOTHING
       RETURNING id, expira_en`,
      [sucursal, b.id_cliente, b.tipo, sha256, imagen, imagen.length, req.licencia!.id, RETENCION_EVIDENCIA_DIAS],
    );
    if (r.rows.length === 0) return res.status(200).json({ duplicado: true });
    res.status(201).json({ id: r.rows[0].id, expira_en: r.rows[0].expira_en, duplicado: false });
  } catch (error) {
    serverError(res, error, 'Error al guardar la evidencia');
  }
};

/** La imagen de una evidencia, para revisar un acceso o una alerta (personal de la sucursal o administración con alcance). */
export const verEvidencia = async (req: Request, res: Response) => {
  const { id_cliente, tipo } = req.params;
  if (!esUuid(id_cliente) || (tipo !== 'placa' && tipo !== 'vehiculo')) return res.status(404).json({ error: 'Evidencia no encontrada' });
  const ts = tenantFilter(req.user!, 'e');
  try {
    const r = await pool.query(
      `SELECT e.imagen FROM evidencias_anpr e ${ts.joinClause}
        WHERE ${ts.whereClause} AND e.id_cliente = $${ts.params.length + 1} AND e.tipo = $${ts.params.length + 2} AND e.expira_en > NOW()`,
      [...ts.params, id_cliente, tipo],
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Evidencia no encontrada' });
    res.set('Content-Type', 'image/jpeg').set('Cache-Control', 'no-store').send(r.rows[0].imagen);
  } catch (error) {
    serverError(res, error, 'Error al leer la evidencia');
  }
};

/** Purga de la evidencia vencida (tarea programada diaria). */
export async function purgarEvidenciasAnpr(db: { query: (sql: string) => Promise<{ rowCount: number | null }> } = pool): Promise<{ purgadas: number }> {
  const r = await db.query('DELETE FROM evidencias_anpr WHERE expira_en < NOW()');
  return { purgadas: r.rowCount ?? 0 };
}
