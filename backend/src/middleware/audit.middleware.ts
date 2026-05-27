import { Request, Response, NextFunction } from 'express';
import pool from '../db/pool';

interface AuditOptions {
  accion: string;
  tabla?: string;
}

export const auditLog = (opts: AuditOptions) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const ip = ((req.headers['x-forwarded-for'] as string | undefined)
      ?.split(',')[0]
      ?.trim() ?? req.ip ?? '').slice(0, 45) || null;
    const userAgent = ((req.headers['user-agent'] as string | undefined) ?? '').slice(0, 255) || null;

    pool.query(
      `INSERT INTO audit_logs
         (usuario_id, accion, tabla_afectada, ip_address, user_agent, sucursal_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        req.user?.id       ?? null,
        opts.accion,
        opts.tabla         ?? null,
        ip,
        userAgent,
        req.user?.sucursal_id ?? null,
      ],
    ).catch(() => { /* never block the request on audit failure */ });

    next();
  };
