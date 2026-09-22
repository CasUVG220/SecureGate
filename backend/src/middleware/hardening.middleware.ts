import type { Request, Response, NextFunction } from 'express';

/**
 * Respuestas de la API: nunca cacheables. El JWT del login y los datos
 * personales no deben quedar en un proxy ni en la caché del navegador (ZAP
 * 10049; sin Cache-Control Express sólo manda ETag y los clientes asumen una
 * vida heurística). Permissions-Policy: la API no usa ninguna función del
 * navegador (ZAP 10063).
 */
export const cabecerasApi = (_req: Request, res: Response, next: NextFunction): void => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  // En TODA respuesta (también los 404 fuera de /api, que ZAP marcó como cacheables).
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
};

/**
 * Ruta inexistente: JSON, no la página HTML «Cannot GET …» de Express. Además el
 * 404 por defecto de Express pisa el CSP de helmet con uno mínimo (ZAP 10055).
 */
export const noEncontrado = (_req: Request, res: Response): void => {
  res.status(404).json({ error: 'No encontrado' });
};
