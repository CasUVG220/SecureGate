import { Router } from 'express';
import {
  getConfiguracion,
  createConfiguracion,
  updateConfiguracion,
  deleteConfiguracion,
} from '../controllers/cargos.controller';
import { verifyToken } from '../middleware/auth.middleware';

const router = Router();

router.get('/',     verifyToken, getConfiguracion);
router.post('/',    verifyToken, createConfiguracion);
router.put('/:id',  verifyToken, updateConfiguracion);
router.delete('/:id', verifyToken, deleteConfiguracion);

export default router;
