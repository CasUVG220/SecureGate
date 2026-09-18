import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import pool from '../db/pool';
import { evaluarEmpresa, mensajeBloqueo, HTTP_BLOQUEO } from '../utils/suspension';

/**
 * Token de licencia de la app de escritorio. Es un JWT firmado con el mismo
 * secreto que las sesiones de usuario pero con `typ: 'licencia'`, así uno no
 * puede hacerse pasar por el otro. Autoriza al DISPOSITIVO; la sesión del
 * agente (verifyToken) autoriza a la PERSONA. Son independientes y cada uno se
 * revoca por su lado.
 */
export interface LicenciaPayload {
  typ: 'licencia';
  lic: string;          // licencias_dispositivo.id
  sucursal_id: string;
  empresa_id: string | null;
  fp: string;           // sha256(fingerprint) — el fingerprint crudo nunca viaja en el token
}

export interface LicenciaActiva {
  id: string;
  sucursal_id: string;
  empresa_id: string | null;
}

declare global {
  namespace Express {
    interface Request {
      licencia?: LicenciaActiva;
    }
  }
}

export const LICENCIA_HEADER = 'x-licencia-token';
export const LICENCIA_TOKEN_TTL = '365d';
export const HEARTBEAT_INTERVALO_MIN = 15;
export const GRACIA_OFFLINE_HORAS = 72;

export const hashFingerprint = (fp: string): string =>
  crypto.createHash('sha256').update(fp.trim()).digest('hex');

export const firmarLicencia = (p: Omit<LicenciaPayload, 'typ'>): string =>
  jwt.sign({ typ: 'licencia', ...p }, process.env.JWT_SECRET as string, { expiresIn: LICENCIA_TOKEN_TTL });

export type ResultadoLicencia =
  | { ok: true; licencia: LicenciaActiva }
  | { ok: false; status: number; error: string; estado?: 'revocada' | 'invalida' | 'suspendida' };

/**
 * Valida un token de licencia contra la BD. Además del JWT comprueba que la
 * fila siga activa (kill switch) y, si el cliente manda su fingerprint, que
 * coincida con el vinculado — un token copiado a otra máquina no sirve.
 */
export const validarLicencia = async (
  token: string | undefined,
  fingerprint?: string,
): Promise<ResultadoLicencia> => {
  if (!token) return { ok: false, status: 401, error: 'Token de licencia no proporcionado' };

  let payload: LicenciaPayload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET as string, { algorithms: ['HS256'] }) as LicenciaPayload;
  } catch {
    return { ok: false, status: 403, error: 'Token de licencia inválido o expirado', estado: 'invalida' };
  }
  if (payload.typ !== 'licencia' || !payload.lic) {
    return { ok: false, status: 403, error: 'Token de licencia inválido', estado: 'invalida' };
  }

  const found = await pool.query(
    `SELECT l.id, l.sucursal_id, l.estado, l.fingerprint, s.empresa_id,
            e.id AS e_id, e.nombre AS e_nombre, e.activo AS e_activo, e.suspendida AS e_suspendida,
            e.suspension_motivo AS e_motivo, e.suspendida_en AS e_desde
     FROM licencias_dispositivo l
     JOIN sucursales s ON s.id = l.sucursal_id
     JOIN empresas   e ON e.id = s.empresa_id
     WHERE l.id = $1`,
    [payload.lic],
  );
  if (found.rows.length === 0) {
    return { ok: false, status: 403, error: 'Licencia no encontrada', estado: 'invalida' };
  }
  const row = found.rows[0];
  if (row.estado === 'revocada') {
    return { ok: false, status: 403, error: 'Licencia revocada', estado: 'revocada' };
  }
  // Empresa suspendida o de baja: la garita deja de sincronizar y de
  // registrar. La licencia en sí no se toca: al reactivar la empresa, el
  // siguiente heartbeat la vuelve a dar por buena.
  const bloqueo = evaluarEmpresa({
    id: row.e_id, nombre: row.e_nombre, activo: row.e_activo, suspendida: row.e_suspendida,
    suspension_motivo: row.e_motivo, suspendida_en: row.e_desde,
  });
  if (bloqueo) {
    return { ok: false, status: HTTP_BLOQUEO, error: mensajeBloqueo(bloqueo), estado: 'suspendida' };
  }
  if (!row.fingerprint || hashFingerprint(row.fingerprint) !== payload.fp) {
    return { ok: false, status: 403, error: 'La licencia no corresponde a este dispositivo', estado: 'invalida' };
  }
  if (fingerprint !== undefined && fingerprint.trim() !== row.fingerprint) {
    return { ok: false, status: 403, error: 'La licencia no corresponde a este dispositivo', estado: 'invalida' };
  }

  return { ok: true, licencia: { id: row.id, sucursal_id: row.sucursal_id, empresa_id: row.empresa_id ?? null } };
};

/** Exige licencia válida en el header X-Licencia-Token. */
export const verifyLicencia = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = await validarLicencia(req.headers[LICENCIA_HEADER] as string | undefined);
    if (r.ok === false) return res.status(r.status).json({ error: r.error, estado: r.estado });
    req.licencia = r.licencia;
    next();
  } catch {
    res.status(500).json({ error: 'Error al validar la licencia' });
  }
};

/**
 * Si la petición trae licencia la valida (y rechaza si está revocada); si no
 * la trae, sigue como petición web normal. Para rutas compartidas entre la web
 * y la app (p. ej. POST /accesos): la web nunca manda el header, la app siempre.
 */
export const licenciaOpcional = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers[LICENCIA_HEADER] as string | undefined;
  if (!token) return next();
  try {
    const r = await validarLicencia(token);
    if (r.ok === false) return res.status(r.status).json({ error: r.error, estado: r.estado });
    req.licencia = r.licencia;
    next();
  } catch {
    res.status(500).json({ error: 'Error al validar la licencia' });
  }
};
