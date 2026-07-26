import { Router } from 'express';
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
router.post('/',         requireAdminSucursal, createCargo);
router.put('/:id',       requireAdminSucursal, updateCargo);
router.delete('/:id',    requireAdminSucursal, deleteCargo);
router.post('/:id/aplicar',  requireAdminSucursal, aplicarCargo);
router.get('/:id/historial', getHistorial);

export default router;
