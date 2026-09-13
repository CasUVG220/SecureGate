import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import pool from '../db/pool';

const hashToken = (raw: string): string =>
  crypto.createHash('sha256').update(raw).digest('hex');

const REFRESH_TTL_MS  = 7 * 24 * 60 * 60 * 1000;
const ACCESS_EXPIRES  = '1h';

const cookieOpts = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge:   REFRESH_TTL_MS,
};

const clientIp = (req: Request): string | null =>
  ((req.headers['x-forwarded-for'] as string | undefined)
    ?.split(',')[0]
    ?.trim() ?? req.ip ?? '').slice(0, 45) || null;

/** Portales de entrada. Un rol pertenece a uno y sólo a uno. */
const PORTALES = ['personal', 'residente'] as const;
type Portal = (typeof PORTALES)[number];

const portalDeRol = (rol: string): Portal => (rol === 'residente' ? 'residente' : 'personal');

export const login = async (req: Request, res: Response) => {
  const { email, password, portal } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Campos requeridos: email, password' });
  }
  if (portal !== undefined && !PORTALES.includes(portal)) {
    return res.status(400).json({ error: `portal debe ser uno de: ${PORTALES.join(', ')}` });
  }

  try {
    const result = await pool.query(
      `SELECT u.id, u.nombre, u.email, u.rol,
              u.sucursal_id, u.empresa_id, u.idioma, u.tema,
              s.empresa_id AS empresa_id_via_sucursal
       FROM usuarios u
       LEFT JOIN sucursales s ON s.id = u.sucursal_id
       WHERE u.email = $1
         AND u.activo = TRUE
         AND u.password_hash = crypt($2, u.password_hash)`,
      [email, password],
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const u = result.rows[0];

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
  } catch (error) {
    res.status(500).json({ error: 'Error en el servidor', detail: String(error) });
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
         AND rt.expires_at > NOW()`,
      [hashToken(refreshRaw)],
    );

    if (found.rows.length === 0) {
      res.clearCookie('refresh_token', { httpOnly: true, secure: cookieOpts.secure, sameSite: 'strict' });
      return res.status(401).json({ error: 'Refresh token inválido o expirado' });
    }

    const row = found.rows[0];
    const empresa_id:  string | null = row.empresa_id  ?? row.empresa_id_via_sucursal ?? null;
    const sucursal_id: string | null = row.sucursal_id ?? null;

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
    res.status(500).json({ error: 'Error al renovar sesión', detail: String(error) });
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
