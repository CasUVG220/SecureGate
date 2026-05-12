import { Router } from 'express';
import { verifyToken } from '../middleware/auth.middleware';
import { registrarAcceso, registrarSalida, registrarSalidaPut, getAccesoActivo, getAccesosActivos, getMisAccesos } from '../controllers/accesos.controller';

const router = Router();

router.get('/activos', verifyToken, getAccesosActivos);
router.get('/activo',  verifyToken, getAccesoActivo);
router.get('/mis',     verifyToken, getMisAccesos);
router.post('/',            verifyToken, registrarAcceso);
router.patch('/:id/salida', verifyToken, registrarSalida);
router.put('/:id/salida',   verifyToken, registrarSalidaPut);

export default router;
