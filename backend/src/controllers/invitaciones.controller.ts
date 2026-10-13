import { Request, Response } from 'express';
import crypto from 'crypto';
import pool from '../db/pool';
import { emitirSesion } from './auth.controller';
import { appUrl, enviarEmail } from '../services/email';
import { serverError } from '../utils/http';
import { validarPassword, BCRYPT_COST } from '../utils/password';

/**
 * Aprovisionamiento en cascada por invitación.
 *
 *   owner ──invita──▶ admin_empresa ──invita──▶ admin_sucursal
 *
 * Cada nivel sólo invita al inmediato inferior y sólo dentro de su alcance:
 * el owner a admins de empresa (creando la empresa al aceptarse, o sumando
 * un admin a una existente); el admin de empresa a admins de sucursales que
 * pertenezcan a SU empresa. El `sucursal_id` que manda el cliente nunca se
 * usa sin comprobar esa pertenencia contra la base.
 *
 * El enlace es de un solo uso y caduca a las 72 h. En la base sólo vive el
 * SHA-256 del token (como en refresh_tokens): una fuga de la tabla no regala
 * enlaces vivos.
 *
 * Esto es independiente del sistema de licencias de la app de garita
 * (licencias_dispositivo, license.rs): aquello vincula una MÁQUINA por
 * huella de hardware; esto invita a una PERSONA por correo.
 */

export const INVITACION_TTL_HORAS = 72;
export const ROLES_INVITABLES = ['admin_empresa', 'admin_sucursal'] as const;
export type RolInvitado = (typeof ROLES_INVITABLES)[number];

export const hashToken = (raw: string): string => crypto.createHash('sha256').update(raw).digest('hex');
/** 256 bits de entropía, seguros para URL. */
export const generarToken = (): string => crypto.randomBytes(32).toString('base64url');
export const enlaceInvitacion = (token: string): string => `${appUrl()}/invitacion/${token}`;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const NOMBRE_ROL: Record<RolInvitado, string> = {
  admin_empresa: 'Administrador de empresa',
  admin_sucursal: 'Administrador de sucursal',
};

export interface FilaInvitacion {
  id: string;
  email: string;
  rol_invitado: RolInvitado;
  empresa_id: string | null;
  empresa_nombre: string | null;
  sucursal_id: string | null;
  /** `null` en las invitaciones de autoservicio (T12): nadie las emitió, las pidió el propio invitado. */
  invitado_por: string | null;
  estado: 'pendiente' | 'aceptada' | 'expirada' | 'revocada';
  expira_en: Date;
  created_at: Date;
  aceptada_en: Date | null;
  revocada_en: Date | null;
  empresa_nombre_actual: string | null;
  sucursal_nombre: string | null;
  invitado_por_nombre?: string;
  /** Calculado por Postgres (`expira_en <= NOW()`): ver estadoEfectivo. */
  vencida?: boolean;
}

/**
 * Estado efectivo: una pendiente cuya fecha ya pasó se reporta (y se trata)
 * como expirada aunque el job diario todavía no la haya marcado.
 *
 * La comparación la hace POSTGRES (`vencida`), no Node. Antes `expira_en` era un
 * TIMESTAMP sin zona escrito con NOW() en UTC mientras el backend corre con
 * TZ=America/Guatemala: `pg` lo interpretaba como hora local, lo leía 6 h en el
 * futuro y una invitación vencida seguía aceptándose hasta 6 h después (hallazgo
 * S-02 de backend/securitytest). Desde S-17 la columna es TIMESTAMPTZ y Node
 * también la lee bien, pero decidir en SQL sigue siendo lo correcto (la hora
 * del servidor de base de datos manda). Sólo si la fila no trae `vencida`
 * (tests, filas parciales) se cae a la comparación en JS.
 */
export const estadoEfectivo = (
  inv: Pick<FilaInvitacion, 'estado' | 'expira_en'> & { vencida?: boolean },
  ahora = new Date(),
): FilaInvitacion['estado'] => {
  if (inv.estado !== 'pendiente') return inv.estado;
  const vencida = typeof inv.vencida === 'boolean' ? inv.vencida : new Date(inv.expira_en).getTime() <= ahora.getTime();
  return vencida ? 'expirada' : inv.estado;
};

export const SELECT_INVITACION = `
  SELECT i.*,
         (i.expira_en <= NOW())              AS vencida,
         e.nombre AS empresa_nombre_actual,
         s.nombre AS sucursal_nombre,
         u.nombre AS invitado_por_nombre
  FROM invitaciones i
  LEFT JOIN empresas   e ON e.id = i.empresa_id
  LEFT JOIN sucursales s ON s.id = i.sucursal_id
  LEFT JOIN usuarios   u ON u.id = i.invitado_por`;

/** Lo que se devuelve a los administradores (nunca el token). */
const dto = (i: FilaInvitacion) => ({
  id: i.id,
  email: i.email,
  rol_invitado: i.rol_invitado,
  empresa_id: i.empresa_id,
  empresa_nombre: i.empresa_nombre_actual ?? i.empresa_nombre,
  crea_empresa: i.empresa_id === null && i.rol_invitado === 'admin_empresa',
  sucursal_id: i.sucursal_id,
  sucursal_nombre: i.sucursal_nombre,
  invitado_por: i.invitado_por,
  invitado_por_nombre: i.invitado_por_nombre ?? null,
  estado: estadoEfectivo(i),
  expira_en: i.expira_en,
  created_at: i.created_at,
  aceptada_en: i.aceptada_en,
  revocada_en: i.revocada_en,
});

const describirAlcance = (i: FilaInvitacion): string =>
  i.rol_invitado === 'admin_sucursal'
    ? `${i.sucursal_nombre ?? 'sucursal'} (${i.empresa_nombre_actual ?? 'empresa'})`
    : (i.empresa_nombre_actual ?? i.empresa_nombre ?? 'empresa');

const escHtml = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const enviarCorreoInvitacion = async (i: FilaInvitacion, token: string): Promise<void> => {
  const enlace = enlaceInvitacion(token);
  const rol = NOMBRE_ROL[i.rol_invitado];
  const alcance = describirAlcance(i);
  const texto = [
    `Hola,`,
    ``,
    i.invitado_por === null
      ? `Pediste crear ${alcance} en SecureGate; tu cuenta será ${rol}.`
      : `${i.invitado_por_nombre ?? 'Un administrador'} te invitó a SecureGate como ${rol} de ${alcance}.`,
    ``,
    `Para crear tu cuenta abre este enlace (válido ${INVITACION_TTL_HORAS} horas, un solo uso):`,
    enlace,
    ``,
    `Si no esperabas esta invitación, ignora este correo.`,
  ].join('\n');
  await enviarEmail({
    to: i.email,
    subject: `Invitación a SecureGate: ${rol} de ${alcance}`,
    text: texto,
    // Nombres de empresa/sucursal/persona son texto libre: se escapan antes de
    // ir dentro del HTML del correo.
    html: `<p>Hola,</p><p>${i.invitado_por === null ? `Pediste crear <strong>${escHtml(alcance)}</strong> en SecureGate; tu cuenta será <strong>${escHtml(rol)}</strong>.` : `${escHtml(i.invitado_por_nombre ?? 'Un administrador')} te invitó a SecureGate como <strong>${escHtml(rol)}</strong> de <strong>${escHtml(alcance)}</strong>.`}</p><p><a href="${escHtml(enlace)}">Crear mi cuenta</a> (válido ${INVITACION_TTL_HORAS} horas, un solo uso)</p><p>Si no esperabas esta invitación, ignora este correo.</p>`,
  });
};

/** Filtro de alcance para listar/revocar/reenviar. `null` = sin acceso. */
const alcanceDe = (user: NonNullable<Request['user']>): { where: string; params: (string | null)[] } | null => {
  if (user.rol === 'owner') return { where: `i.rol_invitado = 'admin_empresa'`, params: [] };
  if (user.rol === 'admin_empresa' && user.empresa_id) {
    return { where: `i.rol_invitado = 'admin_sucursal' AND i.empresa_id = $1`, params: [user.empresa_id] };
  }
  return null;
};

// ── POST /invitaciones ───────────────────────────────────────────────────────
export const crearInvitacion = async (req: Request, res: Response) => {
  const user = req.user!;
  const { email, rol_invitado, empresa_id, empresa_nombre, sucursal_id } = req.body as {
    email?: string; rol_invitado?: string; empresa_id?: string; empresa_nombre?: string; sucursal_id?: string;
  };

  const correo = (email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(correo)) return res.status(400).json({ error: 'email inválido' });
  if (!ROLES_INVITABLES.includes(rol_invitado as RolInvitado)) {
    return res.status(400).json({ error: `rol_invitado debe ser uno de: ${ROLES_INVITABLES.join(', ')}` });
  }
  const rol = rol_invitado as RolInvitado;

  try {
    // Alcance resuelto SIEMPRE desde el JWT + la base, nunca desde el body.
    let empresaId: string | null = null;
    let empresaNombre: string | null = null;
    let sucursalId: string | null = null;

    if (rol === 'admin_empresa') {
      if (user.rol !== 'owner') {
        return res.status(403).json({ error: 'Sólo el owner puede invitar administradores de empresa' });
      }
      if (empresa_id) {
        const emp = await pool.query('SELECT id FROM empresas WHERE id = $1 AND activo = TRUE', [empresa_id]);
        if (emp.rows.length === 0) return res.status(404).json({ error: 'Empresa no encontrada' });
        empresaId = emp.rows[0].id;
      } else {
        empresaNombre = (empresa_nombre ?? '').trim();
        if (empresaNombre.length < 2 || empresaNombre.length > 150) {
          return res.status(400).json({ error: 'Indica empresa_id (empresa existente) o empresa_nombre (empresa nueva, 2-150 caracteres)' });
        }
      }
    } else {
      if (user.rol !== 'admin_empresa' || !user.empresa_id) {
        return res.status(403).json({ error: 'Sólo el administrador de la empresa puede invitar administradores de sucursal' });
      }
      if (!sucursal_id) return res.status(400).json({ error: 'sucursal_id es requerido' });
      // Pertenencia: la sucursal tiene que ser de la empresa del JWT.
      const suc = await pool.query(
        'SELECT id, empresa_id FROM sucursales WHERE id = $1 AND empresa_id = $2 AND activo = TRUE',
        [sucursal_id, user.empresa_id],
      );
      if (suc.rows.length === 0) {
        return res.status(403).json({ error: 'La sucursal no pertenece a tu empresa' });
      }
      sucursalId = suc.rows[0].id;
      empresaId = user.empresa_id;
    }

    const existente = await pool.query('SELECT id FROM usuarios WHERE email = $1', [correo]);
    if (existente.rows.length > 0) {
      return res.status(409).json({ error: 'Ya existe un usuario con ese correo' });
    }
    const pendiente = await pool.query(
      `SELECT id FROM invitaciones WHERE email = $1 AND estado = 'pendiente' AND expira_en > NOW()`,
      [correo],
    );
    if (pendiente.rows.length > 0) {
      return res.status(409).json({ error: 'Ese correo ya tiene una invitación pendiente; revócala o reenvíala' });
    }

    const token = generarToken();
    const insert = await pool.query(
      `INSERT INTO invitaciones (email, rol_invitado, empresa_id, empresa_nombre, sucursal_id, token_hash, invitado_por, expira_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + ($8 || ' hours')::interval)
       RETURNING id`,
      [correo, rol, empresaId, empresaNombre, sucursalId, hashToken(token), user.id, String(INVITACION_TTL_HORAS)],
    );
    const fila = await pool.query<FilaInvitacion>(`${SELECT_INVITACION} WHERE i.id = $1`, [insert.rows[0].id]);
    const inv = fila.rows[0];

    await enviarCorreoInvitacion(inv, token);

    // El enlace se devuelve a quien invita: puede reenviarlo por otro canal
    // (y en desarrollo, sin proveedor de email, es la única forma de usarlo).
    res.status(201).json({ ...dto(inv), enlace: enlaceInvitacion(token) });
  } catch (error) {
    serverError(res, error, 'Error al crear la invitación');
  }
};

// ── GET /invitaciones/:token (público) ───────────────────────────────────────
export const getInvitacionPorToken = async (req: Request, res: Response) => {
  const { token } = req.params;
  if (!token || token.length < 20) return res.status(404).json({ error: 'Invitación no encontrada' });
  try {
    const r = await pool.query<FilaInvitacion>(`${SELECT_INVITACION} WHERE i.token_hash = $1`, [hashToken(token)]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Invitación no encontrada' });
    const inv = r.rows[0];
    const estado = estadoEfectivo(inv);
    if (estado === 'expirada') return res.status(410).json({ error: 'La invitación expiró', estado });
    if (estado !== 'pendiente') return res.status(409).json({ error: `La invitación ya fue ${estado}`, estado });

    // Sólo lo necesario para la pantalla "te invitaron como…"; sin ids
    // internos ni quién la emitió.
    res.json({
      email: inv.email,
      rol_invitado: inv.rol_invitado,
      rol_nombre: NOMBRE_ROL[inv.rol_invitado],
      empresa_nombre: inv.empresa_nombre_actual ?? inv.empresa_nombre,
      crea_empresa: inv.empresa_id === null,
      sucursal_nombre: inv.sucursal_nombre,
      expira_en: inv.expira_en,
    });
  } catch (error) {
    serverError(res, error, 'Error al consultar la invitación');
  }
};

// ── POST /invitaciones/:token/aceptar (público) ──────────────────────────────
export const aceptarInvitacion = async (req: Request, res: Response) => {
  const { token } = req.params;
  const { nombre, password } = req.body as { nombre?: string; password?: string };
  const nombreLimpio = (nombre ?? '').trim();
  if (nombreLimpio.length < 2 || nombreLimpio.length > 100) {
    return res.status(400).json({ error: 'nombre debe tener entre 2 y 100 caracteres' });
  }
  const problemaPassword = validarPassword(password);
  if (problemaPassword) return res.status(400).json({ error: problemaPassword });
  if (!token || token.length < 20) return res.status(404).json({ error: 'Invitación no encontrada' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // FOR UPDATE: dos aceptaciones simultáneas del mismo enlace no crean dos usuarios.
    const r = await client.query<FilaInvitacion>(
      `${SELECT_INVITACION} WHERE i.token_hash = $1 FOR UPDATE OF i`,
      [hashToken(token)],
    );
    if (r.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Invitación no encontrada' });
    }
    const inv = r.rows[0];
    const estado = estadoEfectivo(inv);
    if (estado === 'expirada') {
      await client.query('ROLLBACK');
      return res.status(410).json({ error: 'La invitación expiró', estado });
    }
    if (estado !== 'pendiente') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `La invitación ya fue ${estado}`, estado });
    }

    const existente = await client.query('SELECT id FROM usuarios WHERE email = $1', [inv.email]);
    if (existente.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Ya existe un usuario con ese correo' });
    }

    let empresaId = inv.empresa_id;
    if (inv.rol_invitado === 'admin_empresa' && !empresaId) {
      const emp = await client.query(
        'INSERT INTO empresas (nombre) VALUES ($1) RETURNING id',
        [inv.empresa_nombre],
      );
      empresaId = emp.rows[0].id;
    }

    const usuario = await client.query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol, sucursal_id, empresa_id, activo)
       VALUES ($1, $2, crypt($3, gen_salt('bf', ${BCRYPT_COST})), $4, $5, $6, TRUE)
       RETURNING id, nombre, email, rol, sucursal_id, empresa_id, idioma, tema`,
      [nombreLimpio, inv.email, password, inv.rol_invitado, inv.sucursal_id, empresaId],
    );
    const u = usuario.rows[0];
    // Ruta pública: la fila de auditoría (INVITACION_ACEPTADA) lleva a la persona que acaba de crear su cuenta.
    res.locals.auditoriaUsuarioId = u.id;
    res.locals.auditoriaSucursalId = u.sucursal_id ?? null;

    await client.query(
      `UPDATE invitaciones SET estado = 'aceptada', aceptada_en = NOW(), usuario_id = $2, empresa_id = COALESCE(empresa_id, $3)
       WHERE id = $1`,
      [inv.id, u.id, empresaId],
    );
    await client.query('COMMIT');

    await emitirSesion(req, res, u);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    serverError(res, error, 'Error al aceptar la invitación');
  } finally {
    client.release();
  }
};

// ── GET /invitaciones (admin) ────────────────────────────────────────────────
export const getInvitaciones = async (req: Request, res: Response) => {
  const alcance = alcanceDe(req.user!);
  if (!alcance) return res.status(403).json({ error: 'Sin alcance para ver invitaciones' });
  try {
    const r = await pool.query<FilaInvitacion>(
      `${SELECT_INVITACION} WHERE ${alcance.where} ORDER BY i.created_at DESC LIMIT 200`,
      alcance.params,
    );
    res.json(r.rows.map(dto));
  } catch (error) {
    serverError(res, error, 'Error al listar invitaciones');
  }
};

/** Carga una invitación comprobando que cae dentro del alcance del usuario. */
const cargarEnAlcance = async (req: Request, id: string): Promise<FilaInvitacion | null | 'sin_alcance'> => {
  const alcance = alcanceDe(req.user!);
  if (!alcance) return 'sin_alcance';
  const r = await pool.query<FilaInvitacion>(
    `${SELECT_INVITACION} WHERE i.id = $${alcance.params.length + 1} AND ${alcance.where}`,
    [...alcance.params, id],
  );
  return r.rows[0] ?? null;
};

// ── PATCH /invitaciones/:id/revocar (admin) ──────────────────────────────────
export const revocarInvitacion = async (req: Request, res: Response) => {
  try {
    const inv = await cargarEnAlcance(req, req.params.id);
    if (inv === 'sin_alcance') return res.status(403).json({ error: 'Sin alcance para revocar invitaciones' });
    if (!inv) return res.status(404).json({ error: 'Invitación no encontrada' });
    if (estadoEfectivo(inv) !== 'pendiente') {
      return res.status(409).json({ error: `Sólo se revocan invitaciones pendientes (estado: ${estadoEfectivo(inv)})` });
    }
    const r = await pool.query<FilaInvitacion>(
      `UPDATE invitaciones SET estado = 'revocada', revocada_en = NOW() WHERE id = $1 AND estado = 'pendiente' RETURNING *`,
      [inv.id],
    );
    if (r.rows.length === 0) return res.status(409).json({ error: 'La invitación ya no está pendiente' });
    res.json(dto({ ...inv, ...r.rows[0] }));
  } catch (error) {
    serverError(res, error, 'Error al revocar la invitación');
  }
};

// ── POST /invitaciones/:id/reenviar (admin) ──────────────────────────────────
/**
 * Genera un token nuevo (el anterior deja de servir), renueva las 72 h y
 * vuelve a mandar el correo. Vale para pendientes y para expiradas; una
 * aceptada o revocada no se reenvía: se crea otra.
 */
export const reenviarInvitacion = async (req: Request, res: Response) => {
  try {
    const inv = await cargarEnAlcance(req, req.params.id);
    if (inv === 'sin_alcance') return res.status(403).json({ error: 'Sin alcance para reenviar invitaciones' });
    if (!inv) return res.status(404).json({ error: 'Invitación no encontrada' });
    const estado = estadoEfectivo(inv);
    if (estado !== 'pendiente' && estado !== 'expirada') {
      return res.status(409).json({ error: `No se puede reenviar una invitación ${estado}` });
    }
    const token = generarToken();
    const r = await pool.query<FilaInvitacion>(
      `UPDATE invitaciones
       SET token_hash = $2, estado = 'pendiente', expira_en = NOW() + ($3 || ' hours')::interval
       WHERE id = $1 RETURNING *`,
      [inv.id, hashToken(token), String(INVITACION_TTL_HORAS)],
    );
    // Recién renovada: el `vencida` de la fila vieja ya no vale.
    const actualizada = { ...inv, ...r.rows[0], vencida: false };
    await enviarCorreoInvitacion(actualizada, token);
    res.json({ ...dto(actualizada), enlace: enlaceInvitacion(token) });
  } catch (error) {
    serverError(res, error, 'Error al reenviar la invitación');
  }
};
