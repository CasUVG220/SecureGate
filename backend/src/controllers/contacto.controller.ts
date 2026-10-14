import { NextFunction, Request, Response } from 'express';
import { validationResult } from 'express-validator';
import pool from '../db/pool';
import { serverError } from '../utils/http';

/**
 * Formulario «Pedir demo» de la página pública (`/`). Público y sin sesión: límite por IP (contacto.routes.ts), campo
 * trampa y auditoría. Solo PERSISTE en `contactos`; no manda correos.
 *
 * La respuesta nunca lleva datos de nadie (ni el correo enviado ni el de la empresa): solo un aviso fijo.
 */
export const RESPUESTA_CONTACTO = {
  ok: true,
  mensaje: 'Recibimos tu solicitud. Te vamos a escribir para coordinar la demo.',
} as const;

/**
 * Campo trampa (`sitio_web`): invisible para una persona, lo llenan los robots. Se responde IGUAL que el éxito, para no
 * darle pistas, y no se guarda nada. Va antes de la validación: un robot que además manda basura no recibe un 400 que
 * le enseñe qué corregir.
 */
export const descartarTrampa = (req: Request, res: Response, next: NextFunction) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  if (typeof b.sitio_web === 'string' && b.sitio_web.trim() !== '') {
    res.locals.auditoria = { motivo: 'honeypot' };
    return res.status(201).json(RESPUESTA_CONTACTO);
  }
  next();
};

/** 400 con el primer error de cada campo, en español, para pintarlo junto al campo. */
export const responderErrores = (req: Request, res: Response, next: NextFunction) => {
  const r = validationResult(req);
  if (r.isEmpty()) return next();
  const campos: Record<string, string> = {};
  for (const e of r.array()) {
    if (e.type === 'field' && !(e.path in campos)) campos[e.path] = String(e.msg);
  }
  res.locals.auditoria = { motivo: 'invalido', campos: Object.keys(campos) };
  return res.status(400).json({ error: 'Revisá los datos del formulario.', campos });
};

/** POST /api/contacto */
export const crearContacto = async (req: Request, res: Response) => {
  // Los validadores ya normalizaron (customSanitizer): aquí todo es texto limpio.
  const { nombre, residencial, hogares, telefono, email, mensaje } = req.body as Record<string, string | undefined>;
  try {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO contactos (nombre, residencial, hogares, telefono, email, mensaje, ip_origen)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [nombre, residencial, hogares, telefono, email, mensaje || null, (req.ip ?? '').slice(0, 64) || null],
    );
    // En la bitácora va el id y el tramo; nunca el nombre, el teléfono ni el correo.
    res.locals.auditoria = { contacto_id: r.rows[0].id, hogares };

    // TODO(notificación): avisar al equipo comercial de cada contacto nuevo (correo con services/email.ts o WhatsApp).
    // Esta tarea solo persiste. Al hacerlo: mandar DESPUÉS de guardar, sin bloquear la respuesta, y escapar el HTML
    // del mensaje (es texto libre: se aceptan < y >). Mientras tanto, los contactos se leen con la consulta de
    // docs/landing.md («Leer los contactos»).
    res.status(201).json(RESPUESTA_CONTACTO);
  } catch (error) {
    serverError(res, error, 'Error al registrar la solicitud');
  }
};
