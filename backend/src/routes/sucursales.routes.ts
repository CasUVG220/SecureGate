import { Router } from 'express';
import * as ctrl from '../controllers/sucursales.controller';
import { requireAdminSucursal } from '../middleware/auth.middleware';
import { auditLog } from '../middleware/audit.middleware';

const router = Router();

router.get('/',              ctrl.getSucursales);
router.post('/',             auditLog({ accion: 'SUCURSAL_CREADA', tabla: 'sucursales' }), ctrl.createSucursal);
router.put('/:id',           requireAdminSucursal, auditLog({ accion: 'SUCURSAL_ACTUALIZADA', tabla: 'sucursales' }), ctrl.updateSucursal);
router.delete('/:id',        requireAdminSucursal, auditLog({ accion: 'SUCURSAL_DESACTIVADA', tabla: 'sucursales' }), ctrl.deleteSucursal);
router.post('/:id/admin',    requireAdminSucursal, auditLog({ accion: 'ADMIN_SUCURSAL_ASIGNADO', tabla: 'usuarios' }), ctrl.assignAdminSucursal);

export default router;
