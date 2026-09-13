import { Router } from 'express';
import { body } from 'express-validator';
import * as ctrl from '../controllers/residentes.controller';
import { verifyToken, requireStaff, requireAdminSucursal } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validate.middleware';
import { auditLog } from '../middleware/audit.middleware';

const router = Router();

// El padrón completo es información del personal: nombre, correo, casa y saldo
// de todos los vecinos. Un residente sólo puede verse a sí mismo, vía /me.
// La garita sí lo necesita para asignar la visita a una casa, así que el filtro
// es requireStaff y no requireAdminSucursal.
router.get('/',           verifyToken, requireStaff, ctrl.getResidentes);
router.get('/me',         verifyToken, ctrl.getResidenteMe);
router.get('/:id/pago',   verifyToken, requireStaff, ctrl.getResidentePago);
router.get('/:id',        verifyToken, requireStaff, ctrl.getResidenteById);
router.post(
  '/',
  verifyToken,
  body('numero_casa').notEmpty().isLength({ max: 20 }),
  body('telefono').optional({ nullable: true, checkFalsy: true }).isMobilePhone('any'),
  validateRequest,
  ctrl.createResidente,
);
router.put('/:id',        verifyToken, requireAdminSucursal, ctrl.updateResidente);
router.delete('/:id',     verifyToken, auditLog({ accion: 'RESIDENTE_ELIMINADO', tabla: 'residentes' }), ctrl.deleteResidente);

export default router;
