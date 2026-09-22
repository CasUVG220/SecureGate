import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import pool from '../db/pool';
import { bloqueoDeUsuario, responderBloqueo } from '../utils/suspension';
import { serverError } from '../utils/http';

const hashToken = (raw: string): string =>
  crypto.createHash('sha256').update(raw).digest('hex');

/**
 * Hash bcrypt (costo 12, el mismo que BCRYPT_COST) de una cadena que no es la
 * clave de nadie. Sólo sirve para gastar el mismo tiempo cuando el correo no existe.
 */
const HASH_SENUELO = '$2a$12$ZRX2V39MIy1HIarQEHLajeuzmFASGyluyDeLaPb957LHVr9LBhDya';

const REFRESH_TTL_MS  = 7 * 24 * 60 * 60 * 1000;
const ACCESS_EXPIRES  = '1h';

const cookieOpts = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge:   REFRESH_TTL_MS,
};

// `req.ip` respeta `trust proxy` (index.ts). No se lee X-Forwarded-For a mano:
// cualquier cliente podía falsificarlo y quedar registrado con otra IP.
const clientIp = (req: Request): string | null => (req.ip ?? '').slice(0, 45) || null;

/**
 * Cierra todas las sesiones de un usuario. Lo usan la desactivación de
 * cuentas y los cambios de rol: el JWT de acceso vigente caduca solo en ≤ 1 h,
 * pero sin refresh token no puede renovarse.
 */
export const revocarSesionesDeUsuario = async (
  db: { query: (sql: string, p?: unknown[]) => Promise<unknown> },
  usuarioId: string,
): Promise<void> => {
  await db.query('UPDATE refresh_tokens SET revoked = TRUE WHERE usuario_id = $1 AND revoked = FALSE', [usuarioId]);
};

/** Portales de entrada. Un rol pertenece a uno y sólo a uno. */
const PORTALES = ['personal', 'residente'] as const;
type Portal = (typeof PORTALES)[number];

const portalDeRol = (rol: string): Portal => (rol === 'residente' ? 'residente' : 'personal');


/** Fila mínima de `usuarios` que necesita una sesión. */
export interface UsuarioSesion {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  sucursal_id: string | null;
  empresa_id: string | null;
  empresa_id_via_sucursal?: string | null;
  idioma?: string;
  tema?: string;
}

/**
 * Emite la sesión completa (JWT de acceso + refresh token en cookie httpOnly)
 * y responde con el mismo cuerpo que /auth/login. Lo comparten el login y la
 * aceptación de invitaciones, que entra en sesión sin pasar por el login.
 */
export const emitirSesion = async (req: Request, res: Response, u: UsuarioSesion): Promise<void> => {
  const empresa_id:  string | null = u.empresa_id  ?? u.empresa_id_via_sucursal ?? null;
  const sucursal_id: string | null = u.sucursal_id ?? null;

  const payload = { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, sucursal_id, empresa_id };
  const accessToken = jwt.sign(payload, process.env.JWT_SECRET as string, { expiresIn: ACCESS_EXPIRES });

  const refreshRaw = crypto.randomBytes(64).toString('hex');
  const expiresAt  = new Date(Date.now() + REFRESH_TTL_MS);

  await pool.query(
    `INSERT INTO refresh_tokens (usuario_id, token_hash, expires_at, ip_address)
     VALUES ($1, $2, $3, $4)`,
    [u.id, hashToken(refreshRaw), expiresAt, clientIp(req)],
  );

  res.cookie('refresh_token', refreshRaw, cookieOpts);
  res.json({
    token: accessToken,
    usuario: { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, idioma: u.idioma, tema: u.tema },
  });
};

export const login = async (req: Request, res: Response) => {
  const { email, password, portal } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Campos requeridos: email, password' });
  }
  if (portal !== undefined && !PORTALES.includes(portal)) {
    return res.status(400).json({ error: `portal debe ser uno de: ${PORTALES.join(', ')}` });
  }

  try {
    // Se busca la cuenta SIN comparar la contraseña y luego se ejecuta SIEMPRE un
    // crypt(): contra el hash real si la cuenta existe y está activa, contra un
    // hash señuelo (mismo costo) si no. Antes la comparación iba dentro del WHERE
    // y con un correo inexistente no corría bcrypt: 2 ms contra ~190 ms con un
    // correo real, así que la latencia delataba qué cuentas existen (hallazgo S-01
    // de backend/securitytest; el mensaje 401 ya era idéntico en ambos casos).
    const result = await pool.query(
      `SELECT u.id, u.nombre, u.email, u.rol, u.password_hash,
              u.sucursal_id, u.empresa_id, u.idioma, u.tema,
              s.empresa_id AS empresa_id_via_sucursal
       FROM usuarios u
       LEFT JOIN sucursales s ON s.id = u.sucursal_id
       WHERE u.email = $1
         AND u.activo = TRUE`,
      [email],
    );
    const candidato = result.rows[0];
    const hashComparado: string = candidato?.password_hash ?? HASH_SENUELO;
    const comparacion = await pool.query('SELECT crypt($1, $2) = $2 AS ok', [password, hashComparado]);

    if (!candidato || comparacion.rows[0]?.ok !== true) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const { password_hash: _hash, ...u } = candidato;

    /**
     * Cada portal admite sólo a su público: las credenciales de un residente no
     * abren el portal de personal ni al revés. La comprobación va DESPUÉS de
     * validar la contraseña a propósito — así el mensaje "portal equivocado"
     * sólo lo ve quien ya demostró ser el titular de la cuenta, y no sirve para
     * averiguar desde fuera qué correos existen ni con qué rol.
     */
    if (portal && portalDeRol(u.rol) !== portal) {
      return res.status(403).json({
        error: 'Estas credenciales no pertenecen a este portal',
        portalCorrecto: portalDeRol(u.rol),
      });
    }

    // Empresa suspendida o dada de baja: credenciales correctas, pero nadie
    // de esa empresa opera. Va después de la contraseña para no revelar el
    // estado de una empresa a quien no es de ella.
    const bloqueo = await bloqueoDeUsuario(pool, { rol: u.rol, empresa_id: u.empresa_id ?? u.empresa_id_via_sucursal ?? null, sucursal_id: u.sucursal_id });
    if (bloqueo) return responderBloqueo(res, bloqueo);

    await emitirSesion(req, res, u);
  } catch (error) {
    serverError(res, error, 'Error en el servidor');
  }
};

export const refresh = async (req: Request, res: Response) => {
  const refreshRaw: string | undefined = req.cookies?.refresh_token;
  if (!refreshRaw) {
    return res.status(401).json({ error: 'Refresh token no encontrado' });
  }

  try {
    const found = await pool.query(
      `SELECT rt.id, rt.usuario_id,
              u.nombre, u.email, u.rol, u.sucursal_id, u.empresa_id,
              s.empresa_id AS empresa_id_via_sucursal
       FROM refresh_tokens rt
       JOIN  usuarios   u ON rt.usuario_id = u.id
       LEFT JOIN sucursales s ON s.id = u.sucursal_id
       WHERE rt.token_hash = $1
         AND rt.revoked    = FALSE
         AND rt.expires_at > NOW()
         AND u.activo      = TRUE`,
      [hashToken(refreshRaw)],
    );

    if (found.rows.length === 0) {
      res.clearCookie('refresh_token', { httpOnly: true, secure: cookieOpts.secure, sameSite: 'strict' });
      return res.status(401).json({ error: 'Refresh token inválido o expirado' });
    }

    const row = found.rows[0];
    const empresa_id:  string | null = row.empresa_id  ?? row.empresa_id_via_sucursal ?? null;
    const sucursal_id: string | null = row.sucursal_id ?? null;

    // Una empresa suspendida corta también las sesiones vivas: el access
    // token dura 1 h y aquí muere el refresh.
    const bloqueo = await bloqueoDeUsuario(pool, { rol: row.rol, empresa_id, sucursal_id });
    if (bloqueo) {
      await pool.query('UPDATE refresh_tokens SET revoked = TRUE WHERE id = $1', [row.id]);
      res.clearCookie('refresh_token', { httpOnly: true, secure: cookieOpts.secure, sameSite: 'strict' });
      return responderBloqueo(res, bloqueo);
    }

    // Rotate: revoke old, issue new
    await pool.query('UPDATE refresh_tokens SET revoked = TRUE WHERE id = $1', [row.id]);

    const newRefreshRaw = crypto.randomBytes(64).toString('hex');
    const expiresAt     = new Date(Date.now() + REFRESH_TTL_MS);

    await pool.query(
      `INSERT INTO refresh_tokens (usuario_id, token_hash, expires_at, ip_address)
       VALUES ($1, $2, $3, $4)`,
      [row.usuario_id, hashToken(newRefreshRaw), expiresAt, clientIp(req)],
    );

    const payload = { id: row.usuario_id, nombre: row.nombre, email: row.email, rol: row.rol, sucursal_id, empresa_id };
    const newAccessToken = jwt.sign(payload, process.env.JWT_SECRET as string, { expiresIn: ACCESS_EXPIRES });

    res.cookie('refresh_token', newRefreshRaw, cookieOpts);
    res.json({ token: newAccessToken });
  } catch (error) {
    serverError(res, error, 'Error al renovar sesión');
  }
};

export const logout = async (req: Request, res: Response) => {
  const refreshRaw: string | undefined = req.cookies?.refresh_token;
  if (refreshRaw) {
    await pool.query(
      'UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = $1',
      [hashToken(refreshRaw)],
    ).catch(() => {});
  }
  res.clearCookie('refresh_token', { httpOnly: true, secure: cookieOpts.secure, sameSite: 'strict' });
  res.json({ message: 'Sesion cerrada' });
};
