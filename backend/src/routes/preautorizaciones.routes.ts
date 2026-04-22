import { Router } from 'express';
import { verifyToken } from '../middleware/auth.middleware';
import {
  getPreautorizaciones,
  createPreautorizacion,
  deletePreautorizacion,
  getMisPreautorizaciones,
  createMisPreautorizacion,
  deleteMisPreautorizacion,
} from '../controllers/preautorizaciones.controller';

const router = Router();

router.get('/mis',        verifyToken, getMisPreautorizaciones);
router.post('/mis',       verifyToken, createMisPreautorizacion);
router.delete('/mis/:id', verifyToken, deleteMisPreautorizacion);

router.get('/',       verifyToken, getPreautorizaciones);
router.post('/',      verifyToken, createPreautorizacion);
router.delete('/:id', verifyToken, deletePreautorizacion);

export default router;
