import { Router } from 'express';
import { requireAdminSucursal } from '../middleware/auth.middleware';
import { auditLog } from '../middleware/audit.middleware';
import {
  getConfigReservas,
  updateConfigReservas,
} from '../controllers/configReservas.controller';

const router = Router();

router.get('/', requireAdminSucursal, getConfigReservas);
router.put(
  '/',
  requireAdminSucursal,
  auditLog({ accion: 'CONFIG_RESERVAS_ACTUALIZADA', tabla: 'configuracion_reservas' }),
  updateConfigReservas
);

export default router;
