import { Router } from 'express';
import * as ctrl from '../controllers/sucursales.controller';
import { requireAdminSucursal } from '../middleware/auth.middleware';

const router = Router();

router.get('/',              ctrl.getSucursales);
router.post('/',             ctrl.createSucursal);
router.put('/:id',           requireAdminSucursal, ctrl.updateSucursal);
router.delete('/:id',        requireAdminSucursal, ctrl.deleteSucursal);
router.post('/:id/admin',    requireAdminSucursal, ctrl.assignAdminSucursal);

export default router;
