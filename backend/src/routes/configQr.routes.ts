import { Router } from 'express';
import { verifyToken, requireAdminSucursal } from '../middleware/auth.middleware';
import { auditLog } from '../middleware/audit.middleware';
import { getConfigQr, updateConfigQr } from '../controllers/configQr.controller';

const router = Router();

// Lectura abierta a cualquier usuario autenticado de la sucursal: el
// residente necesita saber si el DPI o la placa son obligatorios para armar
// bien el formulario de creación del QR.
router.get('/', verifyToken, getConfigQr);

router.put(
  '/',
  verifyToken,
  requireAdminSucursal,
  auditLog({ accion: 'CONFIG_QR_ACTUALIZADA', tabla: 'configuracion_qr' }),
  updateConfigQr
);

export default router;
