import { Router } from 'express';
import * as ctrl from '../controllers/residentes.controller';
import { verifyToken } from '../middleware/auth.middleware';

const router = Router();

router.get('/',           verifyToken, ctrl.getResidentes);
router.get('/me',         verifyToken, ctrl.getResidenteMe);
router.get('/:id/pago',   verifyToken, ctrl.getResidentePago);
router.get('/:id',        verifyToken, ctrl.getResidenteById);
router.post('/',          verifyToken, ctrl.createResidente);
router.put('/:id',        verifyToken, ctrl.updateResidente);
router.delete('/:id',     verifyToken, ctrl.deleteResidente);

export default router;
