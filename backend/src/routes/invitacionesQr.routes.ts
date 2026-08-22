import { Router } from 'express';
import { verifyToken } from '../middleware/auth.middleware';
import { auditLog } from '../middleware/audit.middleware';
import {
  getMisInvitaciones,
  createMisInvitacion,
  deleteMisInvitacion,
  verificarInvitacion,
} from '../controllers/invitacionesQr.controller';

const router = Router();

router.get('/mis',        verifyToken, getMisInvitaciones);
router.post('/mis',       verifyToken, auditLog({ accion: 'INVITACION_QR_CREADA', tabla: 'invitaciones_qr' }), createMisInvitacion);
router.delete('/mis/:id', verifyToken, auditLog({ accion: 'INVITACION_QR_REVOCADA', tabla: 'invitaciones_qr' }), deleteMisInvitacion);

router.get('/verificar/:id', verifyToken, verificarInvitacion);

export default router;
