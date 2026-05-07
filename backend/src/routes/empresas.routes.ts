import { Router } from 'express';
import * as ctrl from '../controllers/empresas.controller';
import { requireOwner, requireAdminEmpresa } from '../middleware/auth.middleware';

const router = Router();

router.get('/',           requireOwner, ctrl.getEmpresas);
router.post('/',          requireOwner, ctrl.createEmpresa);
router.get('/:id/stats',  requireAdminEmpresa, ctrl.getEmpresaStats);
router.put('/:id',        requireOwner, ctrl.updateEmpresa);
router.delete('/:id',     requireOwner, ctrl.deleteEmpresa);

export default router;
