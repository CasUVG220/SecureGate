import { Router } from 'express';
import * as ctrl from '../controllers/empresas.controller';
import { requireOwner, requireAdminEmpresa } from '../middleware/auth.middleware';
import { auditLog } from '../middleware/audit.middleware';

const router = Router();

router.get('/',               requireOwner,        ctrl.getEmpresas);
router.post('/',              requireOwner,        auditLog({ accion: 'EMPRESA_CREADA',   tabla: 'empresas' }), ctrl.createEmpresa);
router.get('/:id/stats',      requireAdminEmpresa, ctrl.getEmpresaStats);
router.put('/:id',            requireOwner,        ctrl.updateEmpresa);
router.delete('/:id',         requireOwner,        auditLog({ accion: 'EMPRESA_ELIMINADA', tabla: 'empresas' }), ctrl.deleteEmpresa);
router.post('/:id/admin',     requireOwner,        ctrl.assignAdminEmpresa);

export default router;
