import { Router } from 'express';
import { auditLog } from '../middleware/audit.middleware';
import {
  getConfiguracion,
  createConfiguracion,
  updateConfiguracion,
  aplicarCargo,
} from '../controllers/cargos.controller';

const router = Router();

router.get('/configuracion',      getConfiguracion);
router.post('/configuracion',     auditLog({ accion: 'CARGO_CONFIG_CREADA', tabla: 'configuracion_cargos' }), createConfiguracion);
router.put('/configuracion/:id',  auditLog({ accion: 'CARGO_CONFIG_ACTUALIZADA', tabla: 'configuracion_cargos' }), updateConfiguracion);
router.patch('/:id/aplicar',      auditLog({ accion: 'CARGO_APLICADO', tabla: 'cargos_automaticos' }), aplicarCargo);

export default router;