import { Router } from 'express';
import { auditLog } from '../middleware/audit.middleware';
import {
  getCargos,
  createCargo,
  updateCargo,
  deleteCargo,
  aplicarCargo,
  getHistorial,
} from '../controllers/cargos_programados.controller';
import { requireAdminSucursal } from '../middleware/auth.middleware';

const router = Router();

router.get('/',          getCargos);
router.post('/',         requireAdminSucursal, auditLog({ accion: 'CARGO_PROGRAMADO_CREADO', tabla: 'cargos_programados' }), createCargo);
router.put('/:id',       requireAdminSucursal, auditLog({ accion: 'CARGO_PROGRAMADO_ACTUALIZADO', tabla: 'cargos_programados' }), updateCargo);
router.delete('/:id',    requireAdminSucursal, auditLog({ accion: 'CARGO_PROGRAMADO_ELIMINADO', tabla: 'cargos_programados' }), deleteCargo);
router.post('/:id/aplicar',  requireAdminSucursal, auditLog({ accion: 'CARGO_PROGRAMADO_APLICADO', tabla: 'cargos_programados' }), aplicarCargo);
router.get('/:id/historial', getHistorial);

export default router;
