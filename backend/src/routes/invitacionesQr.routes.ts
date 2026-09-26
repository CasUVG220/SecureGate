import { Router } from 'express';
import { verifyToken, requireStaff } from '../middleware/auth.middleware';
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

// Sólo la garita valida un QR; un residente no debe poder consultar el de otro.
router.get('/verificar/:id', verifyToken, requireStaff, verificarInvitacion);

export default router;
