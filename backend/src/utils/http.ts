import type { Request, Response, NextFunction } from 'express';

/**
 * Códigos SQLSTATE que significan «el cliente mandó un dato que la base no
 * acepta» y no «el servidor falló»:
 *   clase 22  data exception: UUID/fecha/número mal formado (22P02, 22007,
 *             22008), texto demasiado largo (22001), byte NUL (22021), fuera de rango…
 *   23502     not_null_violation      23503  foreign_key_violation
 *   23514     check_violation         23505  unique_violation (→ 409)
 *
 * Antes todos terminaban en HTTP 500. Las pruebas de seguridad del Sprint 8
 * (backend/securitytest, hallazgo S-03) hicieron 462 peticiones con un UUID
 * inválido, un byte NUL o un texto largo y todas devolvieron 500: ruido en los
 * logs, falsas alarmas de disponibilidad y ninguna pista al cliente.
 */
const ERROR_DE_DATOS = /^(22|23502|23503|23514)/;

export const esErrorDeDatos = (code: unknown): boolean => typeof code === 'string' && ERROR_DE_DATOS.test(code);
export const esConflictoUnico = (code: unknown): boolean => code === '23505';

/**
 * Responde un error sin filtrar internos al cliente.
 *
 * Antes cada catch devolvía `detail: String(error)`, y con `pg` eso incluye el
 * nombre de tablas, columnas y constraints. Ahora el detalle sólo va al log del
 * servidor y el cliente recibe únicamente el mensaje funcional.
 *
 * Los errores de datos del cliente (ver arriba) salen como 400 (o 409 si es un
 * duplicado) con un mensaje genérico; el resto sigue siendo 500.
 */
export const serverError = (res: Response, error: unknown, mensaje: string): Response => {
  const e = error as { code?: string; message?: string } | undefined;
  if (esConflictoUnico(e?.code)) {
    return res.status(409).json({ error: 'Ya existe un registro con esos datos' });
  }
  if (esErrorDeDatos(e?.code)) {
    return res.status(400).json({ error: 'Alguno de los datos enviados tiene un formato, longitud o valor inválido' });
  }
  console.error(`[error] ${mensaje}`, { code: e?.code, message: e?.message ?? String(error) });
  return res.status(500).json({ error: mensaje });
};

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const esUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/**
 * Los parámetros de consulta son texto. `?dpi=a&dpi=b` llega como arreglo y
 * `?dpi[x]=1` como objeto (parser `qs` de Express); los controladores llaman
 * `.trim()` sobre ellos y reventaban con 500. Se rechazan de entrada.
 */
export const soloQueryTexto = (req: Request, res: Response, next: NextFunction): void => {
  for (const valor of Object.values(req.query)) {
    if (typeof valor !== 'string') {
      res.status(400).json({ error: 'Parámetros de consulta inválidos: cada parámetro debe ser un solo valor de texto' });
      return;
    }
  }
  next();
};
