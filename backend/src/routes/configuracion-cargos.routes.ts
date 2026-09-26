import { Router } from 'express';
import { auditLog } from '../middleware/audit.middleware';
import {
  getConfiguracion,
  createConfiguracion,
  updateConfiguracion,
  deleteConfiguracion,
} from '../controllers/cargos.controller';
import { verifyToken } from '../middleware/auth.middleware';

const router = Router();

router.get('/',     verifyToken, getConfiguracion);
router.post('/',    verifyToken, auditLog({ accion: 'CARGO_CONFIG_CREADA', tabla: 'configuracion_cargos' }), createConfiguracion);
router.put('/:id',  verifyToken, auditLog({ accion: 'CARGO_CONFIG_ACTUALIZADA', tabla: 'configuracion_cargos' }), updateConfiguracion);
router.delete('/:id', verifyToken, auditLog({ accion: 'CARGO_CONFIG_ELIMINADA', tabla: 'configuracion_cargos' }), deleteConfiguracion);

export default router;
