import { Request, Response } from 'express';
import pool from '../db/pool';
import { serverError } from '../utils/http';
import { enviarCorreoInvitacion, SELECT_INVITACION, generarToken, hashToken, type FilaInvitacion } from './invitaciones.controller';
import { listarPlanes } from '../services/suscripciones';
import {
  MAX_REENVIOS, OnboardingError, completarSolicitud, guardarBorrador, progresoDeEmpresa, solicitar, solicitudPorToken, validarBorrador, validarSolicitud,
  INVITACION_TTL_HORAS_AUTOSERVICIO, type Solicitud,
} from '../services/onboarding';

/** Misma respuesta exista o no una cuenta con ese correo: el formulario público no sirve para averiguar quién usa SecureGate. */
const RESPUESTA_GENERICA = { ok: true, mensaje: 'Si el correo puede crear una cuenta, te enviamos un enlace para continuar. Revisa tu bandeja (y el spam).' };

/** POST /onboarding/solicitar — público. */
export const solicitarAlta = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  // Campo trampa: una persona no lo ve ni lo llena. Respuesta idéntica al éxito, para no darle información al robot, y no se crea nada.
  if (typeof body.sitio_web === 'string' && body.sitio_web.trim() !== '') {
    res.locals.auditoria = { motivo: 'honeypot' };
    return res.status(202).json(RESPUESTA_GENERICA);
  }
  const v = validarSolicitud(body);
  if (v.ok === false) return res.status(400).json({ error: v.error });
  try {
    const r = await solicitar(pool, v.valores, (req.ip ?? '').slice(0, 64) || null);
    res.locals.auditoria = { dominio_correo: v.valores.email.split('@')[1], resultado: r.tipo === 'limite_correo' ? 'limite_correo' : 'aceptada' };
    if (r.tipo === 'limite_correo') {
      return res.status(429).json({ error: 'Ya pediste varios enlaces con este correo; revisa tu bandeja o inténtalo mañana' });
    }
    res.status(202).json(RESPUESTA_GENERICA);
  } catch (error) {
    serverError(res, error, 'Error al registrar la solicitud');
  }
};

/** Carga la solicitud del enlace o responde por qué no sirve. Mismo 404 para «no existe» y «mal formado». */
const cargar = async (req: Request, res: Response, opts: { bloquear?: boolean; db?: Parameters<typeof solicitudPorToken>[0] } = {}): Promise<Solicitud | null> => {
  const s = await solicitudPorToken(opts.db ?? pool, req.params.token, opts.bloquear);
  if (!s) { res.status(404).json({ error: 'Enlace no válido' }); return null; }
  if (s.vencida) { res.status(410).json({ error: 'El enlace venció: vuelve a pedir el alta' }); return null; }
  return s;
};

const planesPublicos = async () =>
  (await listarPlanes(pool, true)).map(p => ({
    codigo: p.codigo, nombre: p.nombre, descripcion: p.descripcion, precio_mensual_centavos: p.precio_mensual_centavos, visitas_incluidas: p.visitas_incluidas,
    precio_visita_extra_centavos: p.precio_visita_extra_centavos, max_sucursales: p.max_sucursales, max_garitas: p.max_garitas, dias_prueba: p.dias_prueba,
    moneda: p.moneda, supuesto: p.supuesto,
  }));

/** GET /onboarding/:token — estado del asistente para retomarlo. */
export const getOnboarding = async (req: Request, res: Response) => {
  try {
    const s = await cargar(req, res);
    if (!s) return;
    let invitacion: { estado: string; puede_reenviar: boolean } | null = null;
    if (s.invitacion_id) {
      const i = await pool.query(`SELECT estado, (expira_en <= NOW()) AS vencida FROM invitaciones WHERE id = $1`, [s.invitacion_id]);
      if (i.rows[0]) {
        const estado = i.rows[0].estado === 'pendiente' && i.rows[0].vencida ? 'expirada' : i.rows[0].estado;
        invitacion = { estado, puede_reenviar: estado !== 'aceptada' && estado !== 'revocada' && s.reenvios < MAX_REENVIOS };
      }
    }
    res.json({
      estado: s.estado, email: s.email, borrador: s.borrador, expira_en: s.expira_en, invitacion,
      planes: s.estado === 'abierta' ? await planesPublicos() : [],
    });
  } catch (error) {
    serverError(res, error, 'Error al consultar el alta');
  }
};

/** PUT /onboarding/:token/borrador — guarda lo que se lleva llenado (retomable). */
export const putBorrador = async (req: Request, res: Response) => {
  const v = validarBorrador((req.body ?? {}) as Record<string, unknown>, true);
  if (v.ok === false) return res.status(400).json({ error: v.error });
  try {
    const s = await cargar(req, res);
    if (!s) return;
    if (s.estado !== 'abierta') return res.status(409).json({ error: 'Esta solicitud ya se completó', codigo: 'YA_COMPLETADA' });
    if (v.valores.plan_codigo) {
      const plan = (await planesPublicos()).find(p => p.codigo === v.valores.plan_codigo);
      if (!plan) return res.status(422).json({ error: 'Ese plan no está disponible' });
    }
    res.locals.auditoria = { campos: Object.keys(v.valores) };
    res.json({ borrador: await guardarBorrador(pool, s.id, v.valores) });
  } catch (error) {
    serverError(res, error, 'Error al guardar el borrador');
  }
};

/** POST /onboarding/:token/completar — crea empresa, primera sucursal, suscripción en prueba e invitación del administrador, todo o nada. */
export const completar = async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const s = await cargar(req, res, { bloquear: true, db: client });
    if (!s) { await client.query('ROLLBACK'); return; }
    const completo = validarBorrador(s.borrador as Record<string, unknown>, false);
    if (completo.ok === false) { await client.query('ROLLBACK'); return res.status(422).json({ error: completo.error, codigo: 'BORRADOR_INCOMPLETO' }); }

    const r = await completarSolicitud(client, s);
    await client.query('COMMIT');
    res.locals.auditoria = { solicitud_id: s.id, empresa_id: r.empresaId };

    // El correo sale DESPUÉS de confirmar: si fallara, la invitación existe y se puede reenviar.
    const fila = await pool.query<FilaInvitacion>(`${SELECT_INVITACION} WHERE i.id = $1`, [r.invitacionId]);
    await enviarCorreoInvitacion(fila.rows[0], r.token).catch(err => console.error('[onboarding] No se pudo mandar la invitación:', (err as Error).message));
    res.status(201).json({ ok: true, estado: 'invitada', email: s.email, mensaje: 'Te mandamos la invitación para crear tu cuenta de administrador.' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (error instanceof OnboardingError) return res.status(error.status).json({ error: error.message, codigo: error.codigo });
    serverError(res, error, 'Error al completar el alta');
  } finally {
    client.release();
  }
};

/** POST /onboarding/:token/reenviar — vuelve a mandar la invitación (enlace nuevo; el anterior deja de servir). Hasta 3 veces. */
export const reenviar = async (req: Request, res: Response) => {
  try {
    const s = await cargar(req, res);
    if (!s) return;
    if (s.estado !== 'invitada' || !s.invitacion_id) return res.status(409).json({ error: 'Todavía no hay una invitación que reenviar' });
    if (s.reenvios >= MAX_REENVIOS) return res.status(429).json({ error: 'Ya reenviamos la invitación varias veces; escríbenos si no te llega' });

    const token = generarToken();
    const r = await pool.query(
      `UPDATE invitaciones SET token_hash = $2, estado = 'pendiente', expira_en = NOW() + make_interval(hours => $3::int)
        WHERE id = $1 AND estado IN ('pendiente', 'expirada') RETURNING id`,
      [s.invitacion_id, hashToken(token), INVITACION_TTL_HORAS_AUTOSERVICIO],
    );
    if (r.rows.length === 0) return res.status(409).json({ error: 'La invitación ya fue aceptada o cancelada' });
    await pool.query(`UPDATE onboarding_solicitudes SET reenvios = reenvios + 1, updated_at = NOW() WHERE id = $1`, [s.id]);
    const fila = await pool.query<FilaInvitacion>(`${SELECT_INVITACION} WHERE i.id = $1`, [s.invitacion_id]);
    await enviarCorreoInvitacion(fila.rows[0], token);
    res.locals.auditoria = { solicitud_id: s.id, reenvios: s.reenvios + 1 };
    res.json({ ok: true, mensaje: 'Reenviamos la invitación.' });
  } catch (error) {
    serverError(res, error, 'Error al reenviar la invitación');
  }
};

/** GET /onboarding/progreso — admin_empresa: los pasos del asistente, derivados de lo que ya existe. */
export const getProgreso = async (req: Request, res: Response) => {
  const empresaId = req.user!.empresa_id;
  if (!empresaId) return res.status(404).json({ error: 'Sin empresa' });
  try {
    res.json(await progresoDeEmpresa(pool, empresaId));
  } catch (error) {
    serverError(res, error, 'Error al consultar el progreso');
  }
};
