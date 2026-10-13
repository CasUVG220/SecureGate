import { Router } from 'express';
import * as ctrl from '../controllers/planes.controller';
import { requireOwner, requireAdminEmpresa } from '../middleware/auth.middleware';
import { auditLog } from '../middleware/audit.middleware';

const router = Router();

// Catálogo de planes (los precios son SUPUESTOS a confirmar: ver docs/saas_nucleo.md).
router.get('/',     requireAdminEmpresa, ctrl.getPlanes);
router.get('/uso',  requireOwner,        ctrl.getUsoTodas);
router.post('/',    requireOwner, auditLog({ accion: 'PLAN_CREADO',      tabla: 'planes' }), ctrl.createPlan);
router.put('/:id',  requireOwner, auditLog({ accion: 'PLAN_ACTUALIZADO', tabla: 'planes' }), ctrl.updatePlan);

export default router;
