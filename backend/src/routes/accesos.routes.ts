import { Router } from 'express';
import { verifyToken } from '../middleware/auth.middleware';
import { registrarAcceso, registrarSalida, registrarSalidaPut, getAccesoActivo } from '../controllers/accesos.controller';

const router = Router();

router.get('/activo',       verifyToken, getAccesoActivo);
router.post('/',            verifyToken, registrarAcceso);
router.patch('/:id/salida', verifyToken, registrarSalida);
router.put('/:id/salida',   verifyToken, registrarSalidaPut);

export default router;
