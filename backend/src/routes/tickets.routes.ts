import { Router } from 'express';
import * as ctrl from '../controllers/tickets.controller';
import { requireStaff } from '../middleware/auth.middleware';

const router = Router();

// Residente
router.post('/',    ctrl.createTicket);
router.get('/mis',  ctrl.getMisTickets);

// Admin / staff
router.get('/',       requireStaff, ctrl.getTickets);
router.put('/:id/cerrar', requireStaff, ctrl.cerrarTicket);

// Ambos roles (autorización dentro del controlador)
router.get('/:id/mensajes',  ctrl.getMensajes);
router.post('/:id/mensajes', ctrl.addMensaje);

export default router;
