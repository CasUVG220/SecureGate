import { Request, Response, NextFunction } from 'express';
import pool from '../db/pool';
import { esUuid } from '../utils/http';

export interface AuditOptions {
  accion: string;
  tabla?: string;
}

/**
 * Bitácora de auditoría.
 *
 * Se escribe al TERMINAR la respuesta (`finish`), no al entrar: así queda el
 * código HTTP real, y un intento rechazado (401/403/409) se distingue de una
 * acción efectiva. Antes se insertaba antes de ejecutar el handler y no había
 * forma de saber si la acción había ocurrido.
 *
 * - `ip_address` sale de `req.ip`, que respeta `trust proxy` (ver index.ts). Ya
 *   no se lee `X-Forwarded-For` a ciegas: cualquier cliente podía falsificarlo.
 * - En los login (no hay sesión todavía) se guarda el correo intentado en
 *   `datos_nuevos`; la contraseña jamás.
 * - `registro_id` se llena cuando la ruta trae un `:id` UUID.
 * - Un handler puede dejar en `res.locals.auditoria` un objeto con el detalle de lo
 *   que cambió (qué campos, rol anterior/nuevo…); se guarda en `datos_nuevos`.
 *   Jamás debe llevar contraseñas ni tokens: solo nombres de campos y valores no
 *   sensibles.
 * - Rutas SIN sesión de usuario (login, logout, activar una licencia): el handler deja en
 *   `res.locals.auditoriaUsuarioId` / `auditoriaSucursalId` a quién corresponde la acción, para que la fila
 *   no quede sin usuario cuando se sabe quién es (RNF-10: usuario, fecha e IP en cada acción sensible).
 */
export interface Procedencia { usuarioId?: string | null; sucursalId?: string | null }

/** Escribe una fila de auditoría para `req` con el código HTTP dado. Nunca lanza. */
export const registrarAuditoria = (
  req: Request, opts: AuditOptions, statusCode: number, detalle?: unknown, quien: Procedencia = {},
): void => {
  const ip = (req.ip ?? '').slice(0, 45) || null;
  const userAgent = ((req.headers?.['user-agent'] as string | undefined) ?? '').slice(0, 255) || null;

  const id = req.params?.id;
  const registroId = esUuid(id) ? id : null;

  const email = typeof req.body?.email === 'string' ? req.body.email.trim().slice(0, 150) : null;
  // En el login el correo intentado es lo único que identifica a quien llama (la contraseña, jamás); si además hay detalle
  // (p. ej. el límite que lo bloqueó) se guarda junto.
  const conDetalle = detalle !== undefined && detalle !== null && typeof detalle === 'object' ? detalle as Record<string, unknown> : null;
  const datos = opts.accion === 'LOGIN' && email
    ? JSON.stringify({ email, ...conDetalle })
    : detalle !== undefined && detalle !== null ? JSON.stringify(detalle) : null;

  // «Nunca lanza»: ni por un fallo de la base (se ignora) ni porque el pool falle de forma síncrona.
  try {
    Promise.resolve(pool.query(
      `INSERT INTO audit_logs
         (usuario_id, accion, tabla_afectada, registro_id, ip_address, user_agent,
          sucursal_id, status_code, datos_nuevos)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        req.user?.id          ?? quien.usuarioId ?? null,
        opts.accion,
        opts.tabla            ?? null,
        registroId,
        ip,
        userAgent,
        req.user?.sucursal_id ?? quien.sucursalId ?? null,
        statusCode,
        datos,
      ],
    )).catch(() => { /* la auditoría nunca debe tumbar ni retrasar la petición */ });
  } catch { /* idem */ }
};

/**
 * Marca del middleware de auditoría: permite a las pruebas recorrer el router real y comprobar que cada ruta que
 * modifica algo la lleva (ver `__tests__/auditoria.cobertura.test.ts`, RNF-10).
 */
export interface MarcaAuditoria { esAuditoria: true; accion: string; tabla?: string }

export const auditLog = (opts: AuditOptions) => {
  const mw = (req: Request, res: Response, next: NextFunction): void => {
    res.on('finish', () => registrarAuditoria(req, opts, res.statusCode, res.locals?.auditoria, {
      usuarioId: res.locals?.auditoriaUsuarioId, sucursalId: res.locals?.auditoriaSucursalId,
    }));

    next();
  };
  return Object.assign(mw, { esAuditoria: true as const, accion: opts.accion, tabla: opts.tabla });
};
