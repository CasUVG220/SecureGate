import { Router } from 'express';
import {
  getConfiguracion,
  createConfiguracion,
  updateConfiguracion,
  aplicarCargo,
} from '../controllers/cargos.controller';

const router = Router();

router.get('/configuracion',      getConfiguracion);
router.post('/configuracion',     createConfiguracion);
router.put('/configuracion/:id',  updateConfiguracion);
router.patch('/:id/aplicar',      aplicarCargo);

export default router;