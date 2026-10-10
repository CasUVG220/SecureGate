import type { Request, RequestHandler } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { registrarAuditoria } from './audit.middleware';

/**
 * Límites de tasa con rastro (RNF-10, SCRUM-125).
 *
 * Un límite que bloquea sin dejar huella es medio límite: quien insiste tras el bloqueo (fuerza bruta, un token robado,
 * un script) no aparecía en `audit_logs`, porque el limitador corre ANTES de `auditLog` y la petición no llega a él.
 * Con esta fábrica cada intento bloqueado queda en la bitácora con la acción que intentaba, `status_code = 429`, la IP
 * y —si ya hay sesión— el usuario, y en `datos_nuevos` el nombre del límite que lo frenó.
 *
 * - `porUsuario`: el cupo es de la persona (JWT), no de la IP; si aún no hay sesión, cae a la IP. Es lo correcto para
 *   acciones autenticadas: un tercero detrás de la misma IP no agota el cupo ajeno y un JWT robado no gana cupos nuevos
 *   cambiando de IP (hallazgo S-07).
 * - `soloFallidos`: sólo cuentan las respuestas con error (login: un equipo entrando bien no se bloquea a sí mismo).
 * - `coalescerAuditoriaMs`: para límites anónimos y muy expuestos (el general por IP), una inundación de peticiones
 *   bloqueadas no debe convertirse en una inundación de escrituras en la base: se escribe UNA fila por clave y ventana y
 *   la siguiente lleva la cuenta de lo que se calló. Los límites por ruta no lo usan: ya están acotados por el general.
 */
export interface OpcionesLimitador {
  /** Nombre corto que queda en la bitácora (`datos_nuevos.limite`). */
  nombre: string;
  windowMs: number;
  max: number;
  /** Acción de auditoría del intento bloqueado (normalmente la de la ruta que protege). */
  accion: string;
  tabla?: string;
  mensaje: string;
  porUsuario?: boolean;
  /** Clave propia (login por cuenta). */
  clave?: (req: Request) => string;
  soloFallidos?: boolean;
  skip?: (req: Request) => boolean;
  coalescerAuditoriaMs?: number;
}

export const crearLimitador = (o: OpcionesLimitador): RequestHandler => {
  const ultimaAuditoria = new Map<string, { en: number; callados: number }>();

  return rateLimit({
    windowMs: o.windowMs,
    max: o.max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: o.soloFallidos,
    skip: o.skip,
    keyGenerator: o.clave
      ?? (o.porUsuario
        ? (req: Request) => `usuario:${req.user?.id ?? ipKeyGenerator(req.ip ?? '')}`
        : (req: Request) => ipKeyGenerator(req.ip ?? '')),
    handler: (req, res) => {
      let detalle: Record<string, unknown> = { limite: o.nombre };
      let escribir = true;
      if (o.coalescerAuditoriaMs) {
        const clave = ipKeyGenerator(req.ip ?? '');
        const ahora = Date.now();
        const previa = ultimaAuditoria.get(clave);
        if (previa && ahora - previa.en < o.coalescerAuditoriaMs) {
          previa.callados += 1;
          escribir = false;
        } else {
          detalle = { ...detalle, intentos_callados: previa?.callados ?? 0 };
          ultimaAuditoria.set(clave, { en: ahora, callados: 0 });
          // El mapa no crece sin límite: se barre lo vencido de vez en cuando.
          if (ultimaAuditoria.size > 5000) for (const [k, v] of ultimaAuditoria) if (ahora - v.en > o.coalescerAuditoriaMs) ultimaAuditoria.delete(k);
        }
      }
      if (escribir) registrarAuditoria(req, { accion: o.accion, tabla: o.tabla }, 429, detalle);
      res.status(429).json({ error: o.mensaje });
    },
  });
};
