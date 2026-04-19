import { Router } from 'express';
import * as ctrl from '../controllers/residentes.controller';

const router = Router();

router.get('/',           ctrl.getResidentes);
router.get('/:id/pago',   ctrl.getResidentePago);
router.get('/:id',        ctrl.getResidenteById);
router.post('/',      ctrl.createResidente);
router.put('/:id',    ctrl.updateResidente);
router.delete('/:id', ctrl.deleteResidente);

export default router;
