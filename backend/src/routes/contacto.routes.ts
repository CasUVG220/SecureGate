import { Router } from 'express';
import { body } from 'express-validator';
import { auditLog } from '../middleware/audit.middleware';
import { crearLimitador } from '../middleware/limitadores';
import { crearContacto, descartarTrampa, responderErrores } from '../controllers/contacto.controller';
import { normalizarEmail, texto } from '../services/onboarding';

const router = Router();

/** Tramos de la tabla de precios del landing (frontend/src/landing/planes.ts). */
export const TRAMOS_HOGARES = ['50', '100', '200', '500', '1000', '1000+'];

/** Teléfono o WhatsApp: dígitos con espacios, guiones, puntos o paréntesis y un + inicial opcional; de 8 a 15 dígitos. */
export const normalizarTelefono = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!/^\+?[\d\s().-]+$/.test(t)) return null;
  const digitos = t.replace(/\D/g, '');
  if (digitos.length < 8 || digitos.length > 15) return null;
  return (t.startsWith('+') ? '+' : '') + digitos;
};

/** Mensaje libre: hasta 1,000 caracteres, con saltos de línea; sin otros caracteres de control. */
export const normalizarMensaje = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  return t.length <= 1000 && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(t) ? t : null;
};

/**
 * Formulario público: 5 por hora por IP (RATE_LIMIT_CONTACTO_MAX). Una persona lo manda una vez; más que eso desde la
 * misma conexión es un robot o un error. Los bloqueos (429) quedan auditados con la acción de la ruta.
 */
const contactoLimiter = crearLimitador({
  nombre: 'contacto-ip',
  windowMs: 60 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_CONTACTO_MAX || '5', 10),
  accion: 'CONTACTO_RECIBIDO',
  tabla: 'contactos',
  mensaje: 'Recibimos varias solicitudes desde esta conexión. Intentá de nuevo en una hora o escribinos por WhatsApp.',
});

const reglas = [
  body('nombre').custom(v => texto(v, 2, 100) !== null).withMessage('Escribí tu nombre (de 2 a 100 caracteres).')
    .bail().customSanitizer(v => texto(v, 2, 100)),
  body('residencial').custom(v => texto(v, 2, 150) !== null).withMessage('Escribí el nombre de la residencial (de 2 a 150 caracteres).')
    .bail().customSanitizer(v => texto(v, 2, 150)),
  body('hogares').custom(v => (typeof v === 'string' || typeof v === 'number') && TRAMOS_HOGARES.includes(String(v)))
    .withMessage('Elegí el número de hogares.').bail().customSanitizer(v => String(v)),
  body('telefono').custom(v => normalizarTelefono(v) !== null).withMessage('Escribí un teléfono o WhatsApp de 8 a 15 dígitos.')
    .bail().customSanitizer(normalizarTelefono),
  body('email').custom(v => normalizarEmail(v) !== null).withMessage('Escribí un correo válido.')
    .bail().customSanitizer(normalizarEmail),
  body('mensaje').optional({ values: 'falsy' }).custom(v => normalizarMensaje(v) !== null)
    .withMessage('El mensaje admite hasta 1,000 caracteres.').bail().customSanitizer(normalizarMensaje),
];

router.post(
  '/',
  contactoLimiter,
  auditLog({ accion: 'CONTACTO_RECIBIDO', tabla: 'contactos' }),
  descartarTrampa,
  ...reglas,
  responderErrores,
  crearContacto,
);

export default router;
