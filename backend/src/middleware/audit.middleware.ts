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
 */
/** Escribe una fila de auditoría para `req` con el código HTTP dado. Nunca lanza. */
export const registrarAuditoria = (req: Request, opts: AuditOptions, statusCode: number, detalle?: unknown): void => {
  const ip = (req.ip ?? '').slice(0, 45) || null;
  const userAgent = ((req.headers['user-agent'] as string | undefined) ?? '').slice(0, 255) || null;

  const id = req.params?.id;
  const registroId = esUuid(id) ? id : null;

  const email = typeof req.body?.email === 'string' ? req.body.email.trim().slice(0, 150) : null;
  const datos = opts.accion === 'LOGIN' && email
    ? JSON.stringify({ email })
    : detalle !== undefined && detalle !== null ? JSON.stringify(detalle) : null;

  pool.query(
    `INSERT INTO audit_logs
       (usuario_id, accion, tabla_afectada, registro_id, ip_address, user_agent,
        sucursal_id, status_code, datos_nuevos)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [
      req.user?.id          ?? null,
      opts.accion,
      opts.tabla            ?? null,
      registroId,
      ip,
      userAgent,
      req.user?.sucursal_id ?? null,
      statusCode,
      datos,
    ],
  ).catch(() => { /* la auditoría nunca debe tumbar ni retrasar la petición */ });
};

export const auditLog = (opts: AuditOptions) =>
  (req: Request, res: Response, next: NextFunction): void => {
    res.on('finish', () => registrarAuditoria(req, opts, res.statusCode, res.locals?.auditoria));

    next();
  };
