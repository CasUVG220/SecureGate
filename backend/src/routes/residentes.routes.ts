import { Router } from 'express';
import * as ctrl from '../controllers/residentes.controller';
import { verifyToken } from '../middleware/auth.middleware';

const router = Router();

router.get('/',           ctrl.getResidentes);
router.get('/me',         verifyToken, ctrl.getResidenteMe);
router.get('/:id/pago',   ctrl.getResidentePago);
router.get('/:id',        ctrl.getResidenteById);
router.post('/',      ctrl.createResidente);
router.put('/:id',    ctrl.updateResidente);
router.delete('/:id', ctrl.deleteResidente);

export default router;
