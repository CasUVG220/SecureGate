import { Router } from 'express';
import * as ctrl from '../controllers/tickets.controller';
import { requireStaff } from '../middleware/auth.middleware';
import { auditLog } from '../middleware/audit.middleware';
import { crearLimitador } from '../middleware/limitadores';

const router = Router();

// Límites POR USUARIO (RNF-10): crear solicitudes y escribir en el chat eran las únicas mutaciones sin tope ni rastro. Un
// residente (o una sesión robada) podía llenar la bandeja de la administración o el chat de mensajes sin que nada lo frenara.
// Los intentos bloqueados quedan en audit_logs con status 429.
const crearLimiter = crearLimitador({
  nombre: 'ticket-crear-usuario', windowMs: 15 * 60 * 1000, max: parseInt(process.env.RATE_LIMIT_TICKET_CREAR_MAX || '10', 10),
  porUsuario: true, accion: 'TICKET_CREADO', tabla: 'tickets', mensaje: 'Demasiadas solicitudes nuevas; espera unos minutos',
});
const mensajeLimiter = crearLimitador({
  nombre: 'ticket-mensaje-usuario', windowMs: 60 * 1000, max: parseInt(process.env.RATE_LIMIT_TICKET_MENSAJE_MAX || '40', 10),
  porUsuario: true, accion: 'TICKET_MENSAJE_ENVIADO', tabla: 'tickets', mensaje: 'Estás escribiendo muy rápido; espera un momento',
});

// Residente
router.post('/',    crearLimiter, auditLog({ accion: 'TICKET_CREADO', tabla: 'tickets' }), ctrl.createTicket);
router.get('/mis',  ctrl.getMisTickets);

// Admin / staff
router.get('/',       requireStaff, ctrl.getTickets);
router.put('/:id/cerrar', requireStaff, auditLog({ accion: 'TICKET_CERRADO', tabla: 'tickets' }), ctrl.cerrarTicket);

// Ambos roles (autorización dentro del controlador)
router.get('/:id/mensajes',  ctrl.getMensajes);
router.post('/:id/mensajes', mensajeLimiter, auditLog({ accion: 'TICKET_MENSAJE_ENVIADO', tabla: 'tickets' }), ctrl.addMensaje);

export default router;
