import { Router } from 'express';
import { body } from 'express-validator';
import * as ctrl from '../controllers/residentes.controller';
import { verifyToken } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validate.middleware';

const router = Router();

router.get('/',           verifyToken, ctrl.getResidentes);
router.get('/me',         verifyToken, ctrl.getResidenteMe);
router.get('/:id/pago',   verifyToken, ctrl.getResidentePago);
router.get('/:id',        verifyToken, ctrl.getResidenteById);
router.post(
  '/',
  verifyToken,
  body('numero_casa').notEmpty().isLength({ max: 20 }),
  body('telefono').optional({ nullable: true, checkFalsy: true }).isMobilePhone('any'),
  validateRequest,
  ctrl.createResidente,
);
router.put('/:id',        verifyToken, ctrl.updateResidente);
router.delete('/:id',     verifyToken, ctrl.deleteResidente);

export default router;
