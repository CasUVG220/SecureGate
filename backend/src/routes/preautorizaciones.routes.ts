import { Router } from 'express';
import { verifyToken } from '../middleware/auth.middleware';
import {
  getPreautorizaciones,
  createPreautorizacion,
  deletePreautorizacion,
} from '../controllers/preautorizaciones.controller';

const router = Router();

router.get('/',     verifyToken, getPreautorizaciones);
router.post('/',    verifyToken, createPreautorizacion);
router.delete('/:id', verifyToken, deletePreautorizacion);

export default router;
